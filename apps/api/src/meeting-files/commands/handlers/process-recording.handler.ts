import { Logger } from '@nestjs/common';
import { CommandHandler, ICommandHandler } from '@nestjs/cqrs';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { PrismaService } from '../../../prisma/prisma.service.js';
import { FilesStorageService } from '../../files-storage.service.js';
import { RecordingError, extractAudio, probeMedia } from '../../processing/media.js';
import {
  FAILURE_REASONS,
  RECORDING_PREPARE_TIMEOUT_MS,
  documentJobTimeoutMs,
  maxRecordingMinutes,
  tooLongReason,
  transcriptionTimeoutMs,
} from '../../processing/processing.config.js';
import { Summarizer, SummaryError } from '../../processing/summarizer.js';
import { Transcriber, TranscriptionError } from '../../processing/transcriber.js';
import { ProcessRecordingCommand } from '../process-recording.command.js';

@CommandHandler(ProcessRecordingCommand)
export class ProcessRecordingHandler implements ICommandHandler<ProcessRecordingCommand> {
  private readonly logger = new Logger(ProcessRecordingHandler.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: FilesStorageService,
    private readonly transcriber: Transcriber,
    private readonly summarizer: Summarizer,
  ) {}

  async execute({ fileId, attempt, signal }: ProcessRecordingCommand): Promise<void> {
    // Every write below is conditional on this: the file is still PROCESSING for this attempt.
    const current = { id: fileId, status: 'PROCESSING' as const, processingAttempt: attempt };
    const file = await this.prisma.meetingFile.findFirst({ where: current });
    if (!file) {
      return; // deleted, or superseded by a newer attempt
    }

    // Each stage has its own timeout, the transcription one derived from the duration. Only the
    // running stage's timeout counts: an earlier one may fire later without meaning anything.
    let stageTimeout: AbortSignal | null = null;
    const stage = (ms: number): AbortSignal => {
      stageTimeout = AbortSignal.timeout(ms);
      return AbortSignal.any([signal, stageTimeout]);
    };

    const workDir = this.storage.workDirOf(fileId);
    try {
      // A crashed earlier run of this job may have left its files behind.
      await this.storage.removeWorkDir(fileId);
      await mkdir(workDir, { recursive: true });

      const limitMinutes = maxRecordingMinutes();
      const limitMs = limitMinutes * 60 * 1000;
      const prepare = stage(RECORDING_PREPARE_TIMEOUT_MS);
      const original = this.storage.pathOf(file.storageKey);
      const media = await probeMedia(original, prepare);
      if (media.durationMs !== null) {
        await this.prisma.meetingFile.updateMany({
          where: current,
          data: { durationMs: media.durationMs },
        });
      }
      if (!media.hasAudio) {
        throw new RecordingError(FAILURE_REASONS.noAudio);
      }
      if (media.durationMs !== null && media.durationMs > limitMs) {
        throw new RecordingError(tooLongReason(limitMinutes));
      }

      // Stops just over the limit, so a container without a stated duration is caught here.
      const audio = path.join(workDir, 'audio.wav');
      const audioMs = await extractAudio(original, audio, limitMs, prepare);
      if (audioMs > limitMs) {
        await this.prisma.meetingFile.updateMany({ where: current, data: { durationMs: audioMs } });
        throw new RecordingError(tooLongReason(limitMinutes));
      }

      const pieces = await this.transcriber.transcribe(
        audio,
        stage(transcriptionTimeoutMs(audioMs)),
      );
      if (pieces.length === 0) {
        throw new RecordingError(FAILURE_REASONS.noSpeech);
      }
      const text = pieces.map((piece) => piece.text).join('\n');
      const summary = await this.summarizer.summarize(
        text,
        stage(documentJobTimeoutMs()),
        'transcript',
      );

      // Status, transcript and summary together: a file deleted meanwhile (0 rows) gets nothing
      // back.
      await this.prisma.$transaction(async (tx) => {
        const { count } = await tx.meetingFile.updateMany({
          where: current,
          data: { status: 'READY', failureReason: null, durationMs: media.durationMs ?? audioMs },
        });
        if (count === 0) {
          return;
        }
        await tx.transcriptSegment.deleteMany({ where: { fileId } });
        await tx.transcriptSegment.createMany({
          data: pieces.map((piece, position) => ({ fileId, position, ...piece })),
        });
        await tx.meetingFileSummary.upsert({
          where: { fileId },
          create: { fileId, text: summary },
          update: { text: summary, createdAt: new Date() },
        });
      });
    } catch (error) {
      const timedOut = (stageTimeout as AbortSignal | null)?.aborted ?? false;
      if (signal.aborted && !timedOut) {
        throw error; // shutdown or expiration: pg-boss retries the job
      }
      await this.prisma.meetingFile.updateMany({
        where: current,
        data: { status: 'FAILED', failureReason: this.reasonFor(error, timedOut) },
      });
    } finally {
      // The extracted audio is about 115 MB per hour of recording.
      await this.storage.removeWorkDir(fileId).catch((error: unknown) => {
        this.logger.warn(`Could not remove the work directory of ${fileId}: ${String(error)}`);
      });
    }
  }

  private reasonFor(error: unknown, timedOut: boolean): string {
    if (timedOut) {
      return FAILURE_REASONS.timeout;
    }
    if (error instanceof RecordingError) {
      return error.reason;
    }
    if (error instanceof TranscriptionError) {
      return FAILURE_REASONS.transcription;
    }
    if (error instanceof SummaryError) {
      return FAILURE_REASONS.summary;
    }
    this.logger.error(`Processing of a recording failed unexpectedly: ${String(error)}`);
    return FAILURE_REASONS.unexpected;
  }
}

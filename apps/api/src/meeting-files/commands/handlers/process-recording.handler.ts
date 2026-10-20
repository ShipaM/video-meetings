import { Logger } from '@nestjs/common';
import { CommandHandler, ICommandHandler } from '@nestjs/cqrs';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import type { MeetingFile } from '../../../generated/prisma/client.js';
import { PrismaService } from '../../../prisma/prisma.service.js';
import { FilesStorageService } from '../../files-storage.service.js';
import { RecordingError, extractAudio, probeMedia } from '../../processing/media.js';
import {
  FAILURE_REASONS,
  RECORDING_PREPARE_TIMEOUT_MS,
  maxRecordingMinutes,
  tooLongReason,
  transcriptSummaryTimeoutMs,
  transcriptionTimeoutMs,
} from '../../processing/processing.config.js';
import { Summarizer, SummaryError } from '../../processing/summarizer.js';
import {
  type TranscriptPiece,
  Transcriber,
  TranscriptionError,
} from '../../processing/transcriber.js';
import { ProcessRecordingCommand } from '../process-recording.command.js';

/**
 * Writing thousands of transcript segments takes longer than Prisma's default 5 s for an
 * interactive transaction on a slow disk.
 */
const RESULT_TRANSACTION_TIMEOUT_MS = 60_000;

/** A stage ran out of its own time (not the job's signal: that one is a shutdown). */
class StageTimeoutError extends Error {
  override readonly name = 'StageTimeoutError';
}

/** Runs one stage of the job with the job's signal and the stage's own timeout. */
type Stage = <T>(timeoutMs: number, work: (signal: AbortSignal) => Promise<T>) => Promise<T>;

/** Which file and attempt a job works on; every write is conditional on it. */
interface JobTarget {
  id: string;
  status: 'PROCESSING';
  processingAttempt: number;
}

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
    const current: JobTarget = { id: fileId, status: 'PROCESSING', processingAttempt: attempt };
    const file = await this.prisma.meetingFile.findFirst({ where: current });
    if (!file) {
      return; // deleted, or superseded by a newer attempt
    }

    // Each stage has its own timeout; running out of it becomes a StageTimeoutError at once, so a
    // failure after a stage has ended is never mistaken for a timeout.
    const stage: Stage = async (timeoutMs, work) => {
      const timeout = AbortSignal.timeout(timeoutMs);
      try {
        return await work(AbortSignal.any([signal, timeout]));
      } catch (error) {
        throw timeout.aborted && !signal.aborted
          ? new StageTimeoutError('Stage timed out', { cause: error })
          : error;
      }
    };

    try {
      // A transcript stored by an earlier attempt (whose summary failed) is reused: only the
      // summary is made again, not hours of transcription.
      const stored = await this.prisma.transcriptSegment.findMany({
        where: { fileId },
        orderBy: { position: 'asc' },
        select: { startMs: true, endMs: true, text: true },
      });
      const { pieces, durationMs } =
        stored.length > 0
          ? { pieces: stored, durationMs: file.durationMs ?? 0 }
          : await this.transcribe(file, current, stage);

      const summary = await stage(transcriptSummaryTimeoutMs(durationMs), (summarySignal) =>
        this.summarizer.summarize(
          pieces.map((piece) => piece.text).join('\n'),
          summarySignal,
          'transcript',
        ),
      );

      // Status and summary together: a file deleted meanwhile (0 rows) gets nothing back.
      await this.prisma.$transaction(
        async (tx) => {
          const { count } = await tx.meetingFile.updateMany({
            where: current,
            data: { status: 'READY', failureReason: null },
          });
          if (count > 0) {
            await tx.meetingFileSummary.upsert({
              where: { fileId },
              create: { fileId, text: summary },
              update: { text: summary, createdAt: new Date() },
            });
          }
        },
        { timeout: RESULT_TRANSACTION_TIMEOUT_MS },
      );
    } catch (error) {
      if (signal.aborted && !(error instanceof StageTimeoutError)) {
        throw error; // shutdown or expiration: pg-boss retries the job
      }
      await this.prisma.meetingFile.updateMany({
        where: current,
        data: { status: 'FAILED', failureReason: this.reasonFor(error) },
      });
    } finally {
      // The extracted audio is about 115 MB per hour of recording.
      await this.storage.removeWorkDir(fileId, attempt).catch((error: unknown) => {
        this.logger.warn(`Could not remove the work directory of ${fileId}: ${String(error)}`);
      });
    }
  }

  /**
   * Probes the recording, extracts its audio, transcribes it and stores the transcript (before the
   * summary, so a failed summary does not cost the transcription).
   */
  private async transcribe(
    file: MeetingFile,
    current: JobTarget,
    stage: Stage,
  ): Promise<{ pieces: TranscriptPiece[]; durationMs: number }> {
    const workDir = this.storage.workDirOf(file.id, current.processingAttempt);
    // A crashed earlier run of this attempt may have left its files behind.
    await this.storage.removeWorkDir(file.id, current.processingAttempt);
    await mkdir(workDir, { recursive: true });
    const audio = path.join(workDir, 'audio.wav');
    const original = this.storage.pathOf(file.storageKey);
    const limitMinutes = maxRecordingMinutes();
    const limitMs = limitMinutes * 60 * 1000;

    const durationMs = await stage(RECORDING_PREPARE_TIMEOUT_MS, async (prepare) => {
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
      const audioMs = await extractAudio(original, audio, limitMs, prepare);
      if (audioMs > limitMs) {
        await this.prisma.meetingFile.updateMany({ where: current, data: { durationMs: audioMs } });
        throw new RecordingError(tooLongReason(limitMinutes));
      }
      return media.durationMs ?? audioMs;
    });

    const pieces = await stage(transcriptionTimeoutMs(durationMs), (transcribeSignal) =>
      this.transcriber.transcribe(audio, transcribeSignal),
    );
    if (pieces.length === 0) {
      throw new RecordingError(FAILURE_REASONS.noSpeech);
    }

    // Conditional like every write: a file deleted or superseded meanwhile gets no transcript.
    await this.prisma.$transaction(
      async (tx) => {
        const { count } = await tx.meetingFile.updateMany({
          where: current,
          data: { durationMs },
        });
        if (count === 0) {
          return;
        }
        await tx.transcriptSegment.deleteMany({ where: { fileId: file.id } });
        await tx.transcriptSegment.createMany({
          data: pieces.map((piece, position) => ({ fileId: file.id, position, ...piece })),
        });
      },
      { timeout: RESULT_TRANSACTION_TIMEOUT_MS },
    );
    return { pieces, durationMs };
  }

  private reasonFor(error: unknown): string {
    if (error instanceof StageTimeoutError) {
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

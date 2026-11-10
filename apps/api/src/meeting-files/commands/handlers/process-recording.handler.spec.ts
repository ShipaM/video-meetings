import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { PrismaService } from '../../../prisma/prisma.service.js';
import type { FilesStorageService } from '../../../storage/files-storage.service.js';
import { RecordingError, extractAudio, probeMedia } from '../../processing/media.js';
import { SummaryError } from '../../processing/summarizer.js';
import { TranscriptionError } from '../../processing/transcriber.js';
import { ProcessRecordingCommand } from '../process-recording.command.js';
import { ProcessRecordingHandler } from './process-recording.handler.js';

vi.mock('../../processing/media.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../processing/media.js')>()),
  probeMedia: vi.fn(),
  extractAudio: vi.fn(),
}));

describe('ProcessRecordingHandler', () => {
  const findFirst = vi.fn();
  const updateMany = vi.fn();
  const txUpdateMany = vi.fn();
  const deleteSegments = vi.fn();
  const createSegments = vi.fn();
  const deleteInsights = vi.fn();
  const createInsights = vi.fn();
  const findSegments = vi.fn();
  const transaction = vi.fn();
  const transcribe = vi.fn();
  const analyze = vi.fn();
  const probe = vi.mocked(probeMedia);
  const extract = vi.mocked(extractAudio);
  let root: string;

  const tx = {
    meetingFile: { updateMany: txUpdateMany },
    transcriptSegment: { deleteMany: deleteSegments, createMany: createSegments },
    recordingInsights: { deleteMany: deleteInsights, create: createInsights },
  };
  const storage = {
    pathOf: (key: string) => path.join(root, 'uploads', key),
    workDirOf: (id: string, attempt: number) => path.join(root, 'derived', `${id}.${attempt}`),
    removeWorkDir: (id: string, attempt: number) =>
      rm(path.join(root, 'derived', `${id}.${attempt}`), { recursive: true, force: true }),
  };
  const handler = new ProcessRecordingHandler(
    {
      meetingFile: { findFirst, updateMany },
      transcriptSegment: { findMany: findSegments },
      $transaction: transaction,
    } as unknown as PrismaService,
    storage as unknown as FilesStorageService,
    { transcribe },
    { analyze },
  );

  const current = { id: 'f1', status: 'PROCESSING', processingAttempt: 2 };
  const file = {
    ...current,
    storageKey: 'f1',
    kind: 'VIDEO',
    mimeType: 'video/mp4',
    durationMs: null,
  };
  const pieces = [
    { startMs: 0, endMs: 1500, text: 'Ship on Friday.' },
    { startMs: 1500, endMs: 3000, text: 'Mark fixes the bug.' },
  ];
  const insights = {
    summary: '- Ship on Friday',
    actionItems: [
      { description: 'Fix the bug', assignee: 'Mark' },
      { description: 'Write the release notes', assignee: null },
    ],
    decisions: [{ text: 'Ship on Friday' }],
  };
  /** The rows of `insights` in order, as written to the database. */
  const actionItemRows = [
    { position: 0, description: 'Fix the bug', assignee: 'Mark' },
    { position: 1, description: 'Write the release notes', assignee: null },
  ];
  const decisionRows = [{ position: 0, text: 'Ship on Friday' }];
  const run = (signal = new AbortController().signal) =>
    handler.execute(new ProcessRecordingCommand('f1', 2, signal));
  const failedWith = (failureReason: string) =>
    expect(updateMany).toHaveBeenCalledWith({
      where: current,
      data: { status: 'FAILED', failureReason },
    });

  beforeAll(async () => {
    root = await mkdtemp(path.join(tmpdir(), 'process-recording-'));
  });

  afterAll(async () => {
    await rm(root, { recursive: true, force: true });
  });

  beforeEach(() => {
    vi.resetAllMocks();
    vi.unstubAllEnvs();
    findFirst.mockResolvedValue(file);
    updateMany.mockResolvedValue({ count: 1 });
    txUpdateMany.mockResolvedValue({ count: 1 });
    findSegments.mockResolvedValue([]);
    transaction.mockImplementation((work: (client: typeof tx) => Promise<unknown>) => work(tx));
    probe.mockResolvedValue({ durationMs: 3000, hasAudio: true });
    extract.mockResolvedValue(3000);
    transcribe.mockResolvedValue(pieces);
    analyze.mockResolvedValue(insights);
  });

  describe('processing stage', () => {
    const stages = () =>
      updateMany.mock.calls
        .map(([args]) => (args as { data: { processingStage?: string } }).data.processingStage)
        .filter(Boolean);

    it('enters each stage before its work, conditional on the attempt', async () => {
      const seen: Record<string, unknown[]> = {};
      probe.mockImplementation(() => {
        seen.probe = stages();
        return Promise.resolve({ durationMs: 3000, hasAudio: true });
      });
      transcribe.mockImplementation(() => {
        seen.transcribe = stages();
        return Promise.resolve(pieces);
      });
      analyze.mockImplementation(() => {
        seen.analyze = stages();
        return Promise.resolve(insights);
      });

      await run();

      expect(seen).toEqual({
        probe: ['PREPARING_AUDIO'],
        transcribe: ['PREPARING_AUDIO', 'TRANSCRIBING'],
        analyze: ['PREPARING_AUDIO', 'TRANSCRIBING', 'SUMMARIZING'],
      });
      expect(updateMany).toHaveBeenCalledWith({
        where: current,
        data: { processingStage: 'PREPARING_AUDIO' },
      });
    });

    it('goes straight to SUMMARIZING with a stored transcript', async () => {
      findSegments.mockResolvedValue(pieces);

      await run();

      expect(stages()).toEqual(['SUMMARIZING']);
      expect(probe).not.toHaveBeenCalled();
    });
  });

  it('stores the transcript, then its insights, and marks the file READY', async () => {
    await run();

    const workDir = path.join(root, 'derived', 'f1.2');
    const audio = path.join(workDir, 'audio.wav');
    expect(probe).toHaveBeenCalledWith(path.join(root, 'uploads', 'f1'), expect.any(AbortSignal));
    expect(extract).toHaveBeenCalledWith(
      path.join(root, 'uploads', 'f1'),
      audio,
      180 * 60 * 1000,
      expect.any(AbortSignal),
    );
    expect(transcribe).toHaveBeenCalledWith(audio, expect.any(AbortSignal));
    expect(analyze).toHaveBeenCalledWith(
      'Ship on Friday.\nMark fixes the bug.',
      expect.any(AbortSignal),
    );
    // The transcript is stored first (kept if the analysis fails), then the status and insights.
    expect(txUpdateMany).toHaveBeenNthCalledWith(1, { where: current, data: { durationMs: 3000 } });
    expect(txUpdateMany).toHaveBeenNthCalledWith(2, {
      where: current,
      data: { status: 'READY', failureReason: null },
    });
    expect(transaction).toHaveBeenCalledWith(expect.any(Function), { timeout: 60_000 });
    expect(deleteSegments).toHaveBeenCalledWith({ where: { fileId: 'f1' } });
    expect(createSegments).toHaveBeenCalledWith({
      data: [
        { fileId: 'f1', position: 0, ...pieces[0] },
        { fileId: 'f1', position: 1, ...pieces[1] },
      ],
    });
    // Any earlier result is replaced, with its lists (cascade).
    expect(deleteInsights).toHaveBeenCalledWith({ where: { fileId: 'f1' } });
    expect(createInsights).toHaveBeenCalledWith({
      data: {
        fileId: 'f1',
        summary: '- Ship on Friday',
        actionItems: { createMany: { data: actionItemRows } },
        decisions: { createMany: { data: decisionRows } },
      },
    });
    expect(deleteInsights.mock.invocationCallOrder[0]).toBeLessThan(
      createInsights.mock.invocationCallOrder[0],
    );
    // The work directory with the extracted audio is gone.
    expect(await readdir(path.join(root, 'derived'))).toEqual([]);
  });

  it('writes the insights in the transaction that marks the file READY, after it matched', async () => {
    await run();

    // The second transaction holds the result: READY first, then the insights in the same client.
    expect(transaction).toHaveBeenCalledTimes(2);
    const ready = txUpdateMany.mock.invocationCallOrder[1];
    expect(deleteInsights.mock.invocationCallOrder[0]).toBeGreaterThan(ready);
  });

  it('stores empty lists when the analysis found no action items or decisions', async () => {
    analyze.mockResolvedValue({ summary: '- Small talk', actionItems: [], decisions: [] });

    await run();

    expect(createInsights).toHaveBeenCalledWith({
      data: {
        fileId: 'f1',
        summary: '- Small talk',
        actionItems: { createMany: { data: [] } },
        decisions: { createMany: { data: [] } },
      },
    });
  });

  it('writes no insights when the file was deleted or superseded during the analysis', async () => {
    txUpdateMany.mockResolvedValueOnce({ count: 1 }).mockResolvedValueOnce({ count: 0 });

    await run();

    expect(createSegments).toHaveBeenCalledTimes(1);
    expect(createInsights).not.toHaveBeenCalled();
  });

  it('does nothing for a deleted file or a stale attempt', async () => {
    findFirst.mockResolvedValue(null);

    await run();

    expect(findFirst).toHaveBeenCalledWith({ where: current });
    expect(probe).not.toHaveBeenCalled();
    expect(updateMany).not.toHaveBeenCalled();
  });

  it('stores no transcript when the file was deleted while it was processed', async () => {
    txUpdateMany.mockResolvedValue({ count: 0 });

    await run();

    expect(createSegments).not.toHaveBeenCalled();
    expect(createInsights).not.toHaveBeenCalled();
  });

  it('fails a recording over MAX_RECORDING_MINUTES before extracting anything', async () => {
    vi.stubEnv('MAX_RECORDING_MINUTES', '60');
    probe.mockResolvedValue({ durationMs: 61 * 60 * 1000, hasAudio: true });

    await run();

    expect(updateMany).toHaveBeenCalledWith({
      where: current,
      data: { durationMs: 61 * 60 * 1000 },
    });
    failedWith('Recording is longer than 60 minutes');
    expect(extract).not.toHaveBeenCalled();
  });

  it('fails a recording without a stated duration once its audio runs past the limit', async () => {
    vi.stubEnv('MAX_RECORDING_MINUTES', '1');
    probe.mockResolvedValue({ durationMs: null, hasAudio: true });
    extract.mockResolvedValue(61_000);

    await run();

    expect(extract).toHaveBeenCalledWith(
      expect.any(String),
      expect.any(String),
      60_000,
      expect.any(AbortSignal),
    );
    failedWith('Recording is longer than 1 minute');
    expect(transcribe).not.toHaveBeenCalled();
  });

  it('fails a recording without a sound track', async () => {
    probe.mockResolvedValue({ durationMs: 3000, hasAudio: false });

    await run();

    failedWith('No audio found in the recording');
    expect(extract).not.toHaveBeenCalled();
  });

  it('fails a file ffprobe cannot read', async () => {
    probe.mockRejectedValue(new RecordingError('The recording could not be read'));

    await run();

    failedWith('The recording could not be read');
  });

  it('fails a recording without speech, without asking for an analysis', async () => {
    transcribe.mockResolvedValue([]);

    await run();

    failedWith('No speech found in the recording');
    expect(analyze).not.toHaveBeenCalled();
  });

  it('fails with "The recording could not be transcribed" when the transcriber fails', async () => {
    transcribe.mockRejectedValue(new TranscriptionError('whisper crashed'));

    await run();

    failedWith('The recording could not be transcribed');
    expect(await readdir(path.join(root, 'derived'))).toEqual([]);
  });

  it('fails with "Summary could not be generated" when the model fails, keeping the transcript', async () => {
    analyze.mockRejectedValue(new SummaryError('model down'));

    await run();

    failedWith('Summary could not be generated');
    expect(createSegments).toHaveBeenCalledTimes(1);
    expect(createInsights).not.toHaveBeenCalled();
  });

  it('reuses a stored transcript: only the insights are made again', async () => {
    findFirst.mockResolvedValue({ ...file, durationMs: 3000 });
    findSegments.mockResolvedValue(pieces);

    await run();

    expect(findSegments).toHaveBeenCalledWith({
      where: { fileId: 'f1' },
      orderBy: { position: 'asc' },
      select: { startMs: true, endMs: true, text: true },
    });
    expect(probe).not.toHaveBeenCalled();
    expect(transcribe).not.toHaveBeenCalled();
    expect(createSegments).not.toHaveBeenCalled();
    expect(analyze).toHaveBeenCalledWith(
      'Ship on Friday.\nMark fixes the bug.',
      expect.any(AbortSignal),
    );
    expect(txUpdateMany).toHaveBeenCalledWith({
      where: current,
      data: { status: 'READY', failureReason: null },
    });
    expect(createInsights).toHaveBeenCalled();
  });

  it('does not call a failure after a finished stage a timeout', async () => {
    // A 20 ms analysis budget: the analysis itself ignores it and ends after its timer has fired,
    // then the final write fails for another reason.
    vi.stubEnv('DOCUMENT_PROCESSING_TIMEOUT_SECONDS', '0.02');
    analyze.mockImplementation(
      () => new Promise((resolve) => setTimeout(() => resolve(insights), 100)),
    );
    transaction
      .mockImplementationOnce((work: (client: typeof tx) => Promise<unknown>) => work(tx))
      .mockRejectedValueOnce(new Error('Transaction already closed'));

    await run();

    failedWith('Processing failed');
  });

  it('fails with a generic reason for an unexpected error', async () => {
    extract.mockRejectedValue(new Error('spawn ffmpeg ENOENT'));

    await run();

    failedWith('Processing failed');
  });

  it('gives the transcriber a timeout derived from the duration', async () => {
    vi.stubEnv('WHISPER_SPEED_FACTOR', '1');
    vi.stubEnv('TRANSCRIPTION_TIMEOUT_MARGIN_SECONDS', '0');
    extract.mockResolvedValue(50);
    transcribe.mockImplementation(
      (_audio: string, signal: AbortSignal) =>
        new Promise((_resolve, reject) => {
          signal.addEventListener('abort', () => reject(signal.reason as Error), { once: true });
        }),
    );

    await run();

    failedWith('Processing took too long');
  });

  it('rethrows when pg-boss aborts the job (shutdown), leaving the file to the retry', async () => {
    const controller = new AbortController();
    transcribe.mockImplementation(() => {
      controller.abort(new Error('stopping'));
      return Promise.reject(new Error('stopping'));
    });

    await expect(run(controller.signal)).rejects.toThrow('stopping');
    expect(updateMany).not.toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: 'FAILED' }) as object }),
    );
  });
});

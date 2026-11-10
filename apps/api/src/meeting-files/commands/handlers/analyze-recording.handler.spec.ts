import type { PrismaService } from '../../../prisma/prisma.service.js';
import { SummaryError } from '../../processing/summarizer.js';
import { AnalyzeRecordingCommand } from '../analyze-recording.command.js';
import { AnalyzeRecordingHandler } from './analyze-recording.handler.js';

describe('AnalyzeRecordingHandler', () => {
  const findFirst = vi.fn();
  const updateMany = vi.fn();
  const findSegments = vi.fn();
  const transaction = vi.fn();
  const txUpdateMany = vi.fn();
  const deleteInsights = vi.fn();
  const createInsights = vi.fn();
  const deleteSummary = vi.fn();
  const analyze = vi.fn();

  const tx = {
    meetingFile: { updateMany: txUpdateMany },
    recordingInsights: { deleteMany: deleteInsights, create: createInsights },
    meetingFileSummary: { deleteMany: deleteSummary },
  };
  const handler = new AnalyzeRecordingHandler(
    {
      meetingFile: { findFirst, updateMany },
      transcriptSegment: { findMany: findSegments },
      $transaction: transaction,
    } as unknown as PrismaService,
    { analyze },
  );

  const running = { id: 'f1', status: 'READY', analysisStatus: 'RUNNING' };
  const insights = {
    summary: '- Ship on Friday',
    actionItems: [
      { description: 'Fix the bug', assignee: 'Mark' },
      { description: 'Write the release notes', assignee: null },
    ],
    decisions: [{ text: 'Ship on Friday' }],
  };
  const run = (signal = new AbortController().signal) =>
    handler.execute(new AnalyzeRecordingCommand('f1', signal));
  const failed = () =>
    expect(updateMany).toHaveBeenCalledWith({
      where: running,
      data: { analysisStatus: 'FAILED' },
    });

  beforeEach(() => {
    vi.resetAllMocks();
    findFirst.mockResolvedValue({ ...running, durationMs: 3000 });
    updateMany.mockResolvedValue({ count: 1 });
    txUpdateMany.mockResolvedValue({ count: 1 });
    findSegments.mockResolvedValue([{ text: 'Ship on Friday.' }, { text: 'Mark fixes the bug.' }]);
    transaction.mockImplementation((work: (client: typeof tx) => Promise<unknown>) => work(tx));
    analyze.mockResolvedValue(insights);
  });

  it('does nothing when the file is gone or no analysis is running', async () => {
    findFirst.mockResolvedValue(null);

    await run();

    expect(findFirst).toHaveBeenCalledWith({ where: running, select: { durationMs: true } });
    expect(analyze).not.toHaveBeenCalled();
    expect(updateMany).not.toHaveBeenCalled();
    expect(transaction).not.toHaveBeenCalled();
  });

  it('analyzes the stored transcript in order', async () => {
    await run();

    expect(findSegments).toHaveBeenCalledWith({
      where: { fileId: 'f1' },
      orderBy: { position: 'asc' },
      select: { text: true },
    });
    expect(analyze).toHaveBeenCalledWith(
      'Ship on Friday.\nMark fixes the bug.',
      expect.any(AbortSignal),
    );
  });

  it('stores the insights, removes the old summary and clears the status in one transaction', async () => {
    await run();

    expect(txUpdateMany).toHaveBeenCalledWith({
      where: running,
      data: { analysisStatus: null },
    });
    expect(deleteInsights).toHaveBeenCalledWith({ where: { fileId: 'f1' } });
    expect(createInsights).toHaveBeenCalledWith({
      data: {
        fileId: 'f1',
        summary: insights.summary,
        actionItems: {
          createMany: {
            data: [
              { position: 0, description: 'Fix the bug', assignee: 'Mark' },
              { position: 1, description: 'Write the release notes', assignee: null },
            ],
          },
        },
        decisions: { createMany: { data: [{ position: 0, text: 'Ship on Friday' }] } },
      },
    });
    expect(deleteSummary).toHaveBeenCalledWith({ where: { fileId: 'f1' } });
    expect(updateMany).not.toHaveBeenCalled();
  });

  it('stores nothing when the file was deleted or the analysis ended meanwhile', async () => {
    txUpdateMany.mockResolvedValue({ count: 0 });

    await run();

    expect(deleteInsights).not.toHaveBeenCalled();
    expect(createInsights).not.toHaveBeenCalled();
    expect(deleteSummary).not.toHaveBeenCalled();
  });

  it('sets FAILED when the analyzer fails, keeping the transcript and the old summary', async () => {
    analyze.mockRejectedValue(new SummaryError('bad answer'));

    await run();

    failed();
    expect(transaction).not.toHaveBeenCalled();
  });

  it('sets FAILED on an unexpected error', async () => {
    analyze.mockRejectedValue(new Error('boom'));

    await run();

    failed();
  });

  it('sets FAILED when the analysis runs out of its time', async () => {
    vi.stubEnv('DOCUMENT_PROCESSING_TIMEOUT_SECONDS', '0.01');
    analyze.mockImplementation(
      (_text: string, signal: AbortSignal) =>
        new Promise((_resolve, reject) => {
          signal.addEventListener('abort', () => reject(signal.reason as Error));
        }),
    );

    await run();

    failed();
    vi.unstubAllEnvs();
  });

  it('rethrows when the job signal is aborted, so pg-boss retries the job', async () => {
    const controller = new AbortController();
    analyze.mockImplementation(() => {
      controller.abort(new Error('shutdown'));
      return Promise.reject(new Error('shutdown'));
    });

    await expect(run(controller.signal)).rejects.toThrow('shutdown');
    expect(updateMany).not.toHaveBeenCalled();
  });
});

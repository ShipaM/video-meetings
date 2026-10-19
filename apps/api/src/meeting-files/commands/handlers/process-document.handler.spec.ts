import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { PrismaService } from '../../../prisma/prisma.service.js';
import type { FilesStorageService } from '../../files-storage.service.js';
import { SummaryError } from '../../processing/summarizer.js';
import { ProcessDocumentCommand } from '../process-document.command.js';
import { ProcessDocumentHandler } from './process-document.handler.js';

describe('ProcessDocumentHandler', () => {
  const findFirst = vi.fn();
  const updateMany = vi.fn();
  const txUpdateMany = vi.fn();
  const upsert = vi.fn();
  const summarize = vi.fn();
  let dir: string;

  const tx = { meetingFile: { updateMany: txUpdateMany }, meetingFileSummary: { upsert } };
  const handler = new ProcessDocumentHandler(
    {
      meetingFile: { findFirst, updateMany },
      $transaction: (run: (client: typeof tx) => Promise<unknown>) => run(tx),
    } as unknown as PrismaService,
    { pathOf: (key: string) => path.join(dir, key) } as unknown as FilesStorageService,
    { summarize },
  );

  const current = { id: 'f1', status: 'PROCESSING', processingAttempt: 2 };
  const file = { ...current, storageKey: 'f1', mimeType: 'text/plain' };
  const run = (signal = new AbortController().signal) =>
    handler.execute(new ProcessDocumentCommand('f1', 2, signal));

  beforeAll(async () => {
    dir = await mkdtemp(path.join(tmpdir(), 'process-document-'));
  });

  afterAll(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  beforeEach(async () => {
    vi.resetAllMocks();
    await writeFile(path.join(dir, 'f1'), '  Weekly sync. Ship on Friday.  ');
    findFirst.mockResolvedValue(file);
    txUpdateMany.mockResolvedValue({ count: 1 });
  });

  it('stores the summary of the extracted text and marks the file READY', async () => {
    summarize.mockResolvedValue('- Ship on Friday');

    await run();

    expect(summarize).toHaveBeenCalledWith('Weekly sync. Ship on Friday.', expect.any(AbortSignal));
    expect(txUpdateMany).toHaveBeenCalledWith({
      where: current,
      data: { status: 'READY', failureReason: null },
    });
    expect(upsert).toHaveBeenCalledWith({
      where: { fileId: 'f1' },
      create: { fileId: 'f1', text: '- Ship on Friday' },
      update: { text: '- Ship on Friday', createdAt: expect.any(Date) as Date },
    });
    expect(updateMany).not.toHaveBeenCalled();
  });

  it('does nothing for a deleted file or a stale attempt', async () => {
    findFirst.mockResolvedValue(null);

    await run();

    expect(findFirst).toHaveBeenCalledWith({ where: current });
    expect(summarize).not.toHaveBeenCalled();
    expect(updateMany).not.toHaveBeenCalled();
  });

  it('stores no summary when the file was deleted while it was summarized', async () => {
    summarize.mockResolvedValue('- Ship on Friday');
    txUpdateMany.mockResolvedValue({ count: 0 });

    await run();

    expect(upsert).not.toHaveBeenCalled();
  });

  it('fails with "Summary could not be generated" when the model fails', async () => {
    summarize.mockRejectedValue(new SummaryError('model down'));

    await run();

    expect(updateMany).toHaveBeenCalledWith({
      where: current,
      data: { status: 'FAILED', failureReason: 'Summary could not be generated' },
    });
  });

  it('fails with "No text found in the document" for a blank document', async () => {
    await writeFile(path.join(dir, 'f1'), ' \n\t ');

    await run();

    expect(summarize).not.toHaveBeenCalled();
    expect(updateMany).toHaveBeenCalledWith({
      where: current,
      data: { status: 'FAILED', failureReason: 'No text found in the document' },
    });
  });

  it('fails with a generic reason for an unexpected error', async () => {
    summarize.mockRejectedValue(new Error('boom'));

    await run();

    expect(updateMany).toHaveBeenCalledWith({
      where: current,
      data: { status: 'FAILED', failureReason: 'Processing failed' },
    });
  });

  it('rethrows when pg-boss aborts the job (shutdown), leaving the file to the retry', async () => {
    const controller = new AbortController();
    summarize.mockImplementation(() => {
      controller.abort(new Error('stopping'));
      return Promise.reject(new Error('stopping'));
    });

    await expect(run(controller.signal)).rejects.toThrow('stopping');
    expect(updateMany).not.toHaveBeenCalled();
  });
});

import { copyFile, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { DocumentTextError, extractDocumentText } from './document-text.js';

const FIXTURES = path.resolve(import.meta.dirname, '../../../test/fixtures');
const TEXT = 'Quarterly planning meeting.';

describe('extractDocumentText', () => {
  let dir: string;

  beforeAll(async () => {
    dir = await mkdtemp(path.join(tmpdir(), 'document-text-'));
  });

  afterAll(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it.each([
    ['notes.txt', 'text/plain'],
    ['notes.pdf', 'application/pdf'],
    ['notes.docx', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'],
    ['slides.pptx', 'application/vnd.openxmlformats-officedocument.presentationml.presentation'],
  ])('extracts the text of %s', async (name, mimeType) => {
    const text = await extractDocumentText(path.join(FIXTURES, name), mimeType);

    expect(text).toContain(TEXT);
    expect(text).toContain('Action item: Anna prepares the release notes.');
  });

  it('reads a stored file without an extension (storage keys have none)', async () => {
    const stored = path.join(dir, 'b7c1f0de-0000-4000-8000-000000000000');
    await copyFile(path.join(FIXTURES, 'slides.pptx'), stored);

    await expect(
      extractDocumentText(
        stored,
        'application/vnd.openxmlformats-officedocument.presentationml.presentation',
      ),
    ).resolves.toContain(TEXT);
  });

  it('rejects a blank document with "No text found in the document"', async () => {
    const blank = path.join(dir, 'blank');
    await writeFile(blank, ' \n\t\n ');

    await expect(extractDocumentText(blank, 'text/plain')).rejects.toMatchObject({
      reason: 'No text found in the document',
    });
  });

  it('rejects an unreadable document with "The document could not be read"', async () => {
    const broken = path.join(dir, 'broken.pdf');
    await writeFile(broken, '%PDF-1.4 not really a pdf');

    const error = await extractDocumentText(broken, 'application/pdf').catch((e: unknown) => e);
    expect(error).toBeInstanceOf(DocumentTextError);
    expect(error).toMatchObject({ reason: 'The document could not be read' });
  });

  it('rejects text that is not valid UTF-8', async () => {
    const latin1 = path.join(dir, 'latin1.txt');
    await writeFile(latin1, Buffer.from([0x4e, 0x6f, 0x74, 0x65, 0x73, 0xe9, 0x20, 0x41]));

    await expect(extractDocumentText(latin1, 'text/plain')).rejects.toMatchObject({
      reason: 'The document could not be read',
    });
  });
});

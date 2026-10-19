// Worker thread that extracts the text of one stored document (see document-text.ts). Parsing
// runs here, not on the API's event loop, under a memory limit, and the job ends it with
// `terminate()` on a timeout. Plain JavaScript so that Node (dist) and Vitest (src) both run it
// as is; nest-cli.json copies it into dist.
import { open, readFile } from 'node:fs/promises';
import { parentPort, workerData } from 'node:worker_threads';
import mammoth from 'mammoth';
import { OfficeParser } from 'officeparser';
import { extractText, getDocumentProxy } from 'unpdf';

/** @type {{ filePath: string; mimeType: string; maxChars: number }} */
const { filePath, mimeType, maxChars } = workerData;

/** Reads at most `maxChars` characters of a UTF-8 file without loading the rest. */
async function plainText() {
  // A UTF-8 character takes at most 4 bytes.
  const limit = maxChars * 4;
  const handle = await open(filePath, 'r');
  try {
    const { buffer, bytesRead } = await handle.read(Buffer.alloc(limit), 0, limit, 0);
    // `stream: true` tolerates a multi-byte character cut at the end; invalid UTF-8 throws.
    return new TextDecoder('utf-8', { fatal: true }).decode(buffer.subarray(0, bytesRead), {
      stream: true,
    });
  } finally {
    await handle.close();
  }
}

async function pdfText() {
  const pdf = await getDocumentProxy(new Uint8Array(await readFile(filePath)));
  return (await extractText(pdf, { mergePages: true })).text;
}

async function docxText() {
  return (await mammoth.extractRawText({ path: filePath })).value;
}

async function pptxText() {
  // A buffer, not the path: stored files have no extension, which officeparser would go by.
  const ast = await OfficeParser.parseOffice(await readFile(filePath), {
    ocr: false,
    extractAttachments: false,
  });
  return (await ast.to('text')).value;
}

const EXTRACTORS = {
  'text/plain': plainText,
  'application/pdf': pdfText,
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': docxText,
  'application/vnd.openxmlformats-officedocument.presentationml.presentation': pptxText,
};

const extract = EXTRACTORS[mimeType];
if (!extract) {
  throw new Error(`No text extractor for ${mimeType}`);
}
const text = await extract();
parentPort.postMessage(text.trim().slice(0, maxChars));

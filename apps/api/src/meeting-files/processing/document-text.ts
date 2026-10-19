import { readFile } from 'node:fs/promises';
import mammoth from 'mammoth';
import { OfficeParser } from 'officeparser';
import { extractText, getDocumentProxy } from 'unpdf';
import { MAX_EXTRACTED_CHARS } from './processing.config.js';

/** Why a document has no usable text; `reason` is shown to the user as the failure reason. */
export class DocumentTextError extends Error {
  override readonly name = 'DocumentTextError';

  constructor(
    readonly reason: string,
    options?: ErrorOptions,
  ) {
    super(reason, options);
  }
}

export const NO_TEXT_REASON = 'No text found in the document';
export const UNREADABLE_REASON = 'The document could not be read';

async function pdfText(filePath: string): Promise<string> {
  const pdf = await getDocumentProxy(new Uint8Array(await readFile(filePath)));
  return (await extractText(pdf, { mergePages: true })).text;
}

async function docxText(filePath: string): Promise<string> {
  return (await mammoth.extractRawText({ path: filePath })).value;
}

async function pptxText(filePath: string): Promise<string> {
  // A buffer, not the path: stored files have no extension, which officeparser would go by.
  const ast = await OfficeParser.parseOffice(await readFile(filePath), {
    ocr: false,
    extractAttachments: false,
  });
  return (await ast.to('text')).value;
}

async function plainText(filePath: string): Promise<string> {
  // Upload completion already checked a sample; the whole file must be valid UTF-8 too.
  return new TextDecoder('utf-8', { fatal: true }).decode(await readFile(filePath));
}

/** Extractors by the verified (stored) MIME type of a document. */
const EXTRACTORS: Record<string, (filePath: string) => Promise<string>> = {
  'application/pdf': pdfText,
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': docxText,
  'application/vnd.openxmlformats-officedocument.presentationml.presentation': pptxText,
  'text/plain': plainText,
};

export const isExtractable = (mimeType: string): boolean => mimeType in EXTRACTORS;

/**
 * The plain text of a stored document, trimmed and capped at `MAX_EXTRACTED_CHARS`. Rejects with
 * `DocumentTextError` for a file that cannot be read or holds no text (a scanned PDF: no OCR).
 */
export async function extractDocumentText(filePath: string, mimeType: string): Promise<string> {
  const extract = EXTRACTORS[mimeType];
  if (!extract) {
    throw new DocumentTextError(UNREADABLE_REASON);
  }
  let text: string;
  try {
    text = await extract(filePath);
  } catch (error) {
    throw new DocumentTextError(UNREADABLE_REASON, { cause: error });
  }
  const trimmed = text.trim();
  if (!trimmed) {
    throw new DocumentTextError(NO_TEXT_REASON);
  }
  return trimmed.slice(0, MAX_EXTRACTED_CHARS);
}

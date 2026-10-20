import { open } from 'node:fs/promises';
import path from 'node:path';
import { fileTypeFromFile } from 'file-type';
import { MeetingFileKind } from '../generated/prisma/enums.js';

interface AllowedType {
  extensions: string[];
  kind: MeetingFileKind;
  /** Stored MIME type (the canonical one for the extension). */
  mimeType: string;
  /** MIME types a client may declare for this entry (browsers are not consistent). */
  declared: string[];
  /** Extensions `file-type` may detect for a genuine file, or `text` for plain UTF-8 text. */
  detected: string[] | 'text';
}

/**
 * The allow-list from the PRD. Order matters for `webm`: with no declared type it is taken as video.
 * Duplicated in the web app (no shared package yet), keep both in sync.
 */
const ALLOWED_TYPES: AllowedType[] = [
  {
    extensions: ['mp3'],
    kind: 'AUDIO',
    mimeType: 'audio/mpeg',
    declared: ['audio/mpeg', 'audio/mp3'],
    detected: ['mp3'],
  },
  {
    extensions: ['m4a'],
    kind: 'AUDIO',
    mimeType: 'audio/mp4',
    declared: ['audio/mp4', 'audio/x-m4a', 'audio/m4a'],
    detected: ['m4a', 'mp4'],
  },
  {
    extensions: ['wav'],
    kind: 'AUDIO',
    mimeType: 'audio/wav',
    declared: ['audio/wav', 'audio/x-wav', 'audio/wave', 'audio/vnd.wave'],
    detected: ['wav'],
  },
  {
    extensions: ['webm'],
    kind: 'VIDEO',
    mimeType: 'video/webm',
    declared: ['video/webm'],
    detected: ['webm'],
  },
  {
    extensions: ['webm'],
    kind: 'AUDIO',
    mimeType: 'audio/webm',
    declared: ['audio/webm'],
    detected: ['webm'],
  },
  {
    extensions: ['mp4'],
    kind: 'VIDEO',
    mimeType: 'video/mp4',
    declared: ['video/mp4'],
    detected: ['mp4', 'm4v'],
  },
  {
    extensions: ['mov'],
    kind: 'VIDEO',
    mimeType: 'video/quicktime',
    declared: ['video/quicktime'],
    detected: ['mov', 'mp4'],
  },
  {
    extensions: ['pdf'],
    kind: 'DOCUMENT',
    mimeType: 'application/pdf',
    declared: ['application/pdf'],
    detected: ['pdf'],
  },
  {
    extensions: ['docx'],
    kind: 'DOCUMENT',
    mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    declared: ['application/vnd.openxmlformats-officedocument.wordprocessingml.document'],
    detected: ['docx'],
  },
  {
    extensions: ['pptx'],
    kind: 'DOCUMENT',
    mimeType: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    declared: ['application/vnd.openxmlformats-officedocument.presentationml.presentation'],
    detected: ['pptx'],
  },
  {
    extensions: ['txt'],
    kind: 'DOCUMENT',
    mimeType: 'text/plain',
    declared: ['text/plain'],
    detected: 'text',
  },
  {
    extensions: ['png'],
    kind: 'IMAGE',
    mimeType: 'image/png',
    declared: ['image/png'],
    detected: ['png'],
  },
  {
    extensions: ['jpg', 'jpeg'],
    kind: 'IMAGE',
    mimeType: 'image/jpeg',
    declared: ['image/jpeg', 'image/jpg'],
    detected: ['jpg'],
  },
];

/** Declared types that carry no information; the extension decides then. */
const UNKNOWN_DECLARED = ['', 'application/octet-stream'];

/** Kinds that are transcribed: audio and video recordings. */
export const RECORDING_KINDS: readonly MeetingFileKind[] = ['AUDIO', 'VIDEO'];

export const isRecording = (kind: MeetingFileKind): boolean => RECORDING_KINDS.includes(kind);

export interface ResolvedFileType {
  kind: MeetingFileKind;
  mimeType: string;
}

/**
 * Resolves the stored type from the file name and the client-declared MIME type. The extension is
 * primary; a declared type must agree with it. Returns `null` for anything outside the allow-list.
 */
export function resolveFileType(fileName: string, declared = ''): ResolvedFileType | null {
  const extension = path.extname(fileName).slice(1).toLowerCase();
  const type = declared.split(';')[0].trim().toLowerCase();
  const candidates = ALLOWED_TYPES.filter((entry) => entry.extensions.includes(extension));

  const match = UNKNOWN_DECLARED.includes(type)
    ? candidates[0]
    : candidates.find((entry) => entry.declared.includes(type));

  return match ? { kind: match.kind, mimeType: match.mimeType } : null;
}

const TEXT_SAMPLE_BYTES = 64 * 1024;

async function looksLikeText(filePath: string): Promise<boolean> {
  const handle = await open(filePath, 'r');
  try {
    const { buffer, bytesRead } = await handle.read(
      Buffer.alloc(TEXT_SAMPLE_BYTES),
      0,
      TEXT_SAMPLE_BYTES,
      0,
    );
    const sample = buffer.subarray(0, bytesRead);
    if (sample.includes(0)) {
      return false;
    }
    // `stream: true` tolerates a multi-byte character cut at the end of the sample.
    new TextDecoder('utf-8', { fatal: true }).decode(sample, { stream: true });
    return true;
  } catch {
    return false;
  } finally {
    await handle.close();
  }
}

/**
 * Checks the file's magic bytes against its stored MIME type (the client declaration is not
 * trusted). A file that cannot be read counts as not matching.
 */
export async function contentMatchesType(filePath: string, mimeType: string): Promise<boolean> {
  const entry = ALLOWED_TYPES.find((item) => item.mimeType === mimeType);
  if (!entry) {
    return false;
  }
  try {
    if (entry.detected === 'text') {
      return await looksLikeText(filePath);
    }
    const detected = await fileTypeFromFile(filePath);
    return detected !== undefined && entry.detected.includes(detected.ext);
  } catch {
    return false;
  }
}

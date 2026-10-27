import path from 'node:path';
import { fileTypeFromFile } from 'file-type';

/** 5 MiB, the PRD limit for an avatar image. */
export const MAX_AVATAR_SIZE = 5 * 1024 ** 2;

interface AvatarType {
  extensions: string[];
  /** Stored MIME type (the canonical one for the extension). */
  mimeType: string;
  /** MIME types a client may declare for this entry (browsers are not consistent). */
  declared: string[];
  /** Extension `file-type` detects for a genuine file. */
  detected: string;
}

/** The avatar allow-list from the PRD. Duplicated in the web app (no shared package yet). */
const AVATAR_TYPES: AvatarType[] = [
  { extensions: ['png'], mimeType: 'image/png', declared: ['image/png'], detected: 'png' },
  {
    extensions: ['jpg', 'jpeg'],
    mimeType: 'image/jpeg',
    declared: ['image/jpeg', 'image/jpg'],
    detected: 'jpg',
  },
  { extensions: ['webp'], mimeType: 'image/webp', declared: ['image/webp'], detected: 'webp' },
];

/** Declared types that carry no information; the extension decides then. */
const UNKNOWN_DECLARED = ['', 'application/octet-stream'];

/**
 * Resolves the stored MIME type from the file name and the client-declared type. The extension is
 * primary; a declared type must agree with it. Returns `null` for anything outside the allow-list.
 */
export function resolveAvatarType(fileName: string, declared = ''): string | null {
  const extension = path.extname(fileName).slice(1).toLowerCase();
  const type = declared.split(';')[0].trim().toLowerCase();
  const entry = AVATAR_TYPES.find((item) => item.extensions.includes(extension));
  if (!entry || !(UNKNOWN_DECLARED.includes(type) || entry.declared.includes(type))) {
    return null;
  }
  return entry.mimeType;
}

/**
 * Checks the file's magic bytes against its stored MIME type (the client declaration is not
 * trusted). A file that cannot be read counts as not matching.
 */
export async function avatarContentMatches(filePath: string, mimeType: string): Promise<boolean> {
  const entry = AVATAR_TYPES.find((item) => item.mimeType === mimeType);
  if (!entry) {
    return false;
  }
  try {
    return (await fileTypeFromFile(filePath))?.ext === entry.detected;
  } catch {
    return false;
  }
}

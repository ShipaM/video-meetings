import { mkdirSync } from 'node:fs';
import path from 'node:path';

/** 2 GiB, the PRD limit for a single file. */
export const MAX_FILE_SIZE = 2 * 1024 ** 3;

/**
 * Absolute storage directory for meeting files (`FILES_DIR`, default `./storage`, relative to the
 * working directory, which is apps/api for the npm scripts). It is created if missing and must never
 * be served statically: files are only streamed after an access check.
 */
export function resolveFilesDir(): string {
  const dir = path.resolve(process.env.FILES_DIR ?? './storage');
  mkdirSync(dir, { recursive: true });
  return dir;
}

/** Lifetime of a signed download link. */
export const FILE_LINK_TTL_SECONDS = 5 * 60;

/** JWT audience of file links, so an access token can never be used as a link and vice versa. */
export const FILE_LINK_AUDIENCE = 'file-content';

/** Secret for file links (`FILE_LINK_SECRET`), separate from `JWT_SECRET`. */
export function fileLinkSecret(): string {
  const secret = process.env.FILE_LINK_SECRET;
  if (!secret) {
    throw new Error('FILE_LINK_SECRET is not set');
  }
  return secret;
}

/** An upload with no chunk for this long counts as abandoned (PRD: 24 hours after the last part). */
export const ABANDONED_UPLOAD_MS = 24 * 60 * 60 * 1000;

import { mkdirSync } from 'node:fs';
import path from 'node:path';

/**
 * Absolute storage directory for uploaded files (`FILES_DIR`, default `./storage`, relative to the
 * working directory, which is apps/api for the npm scripts). It is created if missing and must never
 * be served statically: files are only streamed after an access check.
 */
export function resolveFilesDir(): string {
  const dir = path.resolve(process.env.FILES_DIR ?? './storage');
  mkdirSync(dir, { recursive: true });
  return dir;
}

/**
 * Secret for signed links to stored files (`FILE_LINK_SECRET`), separate from `JWT_SECRET`. Each
 * kind of link has its own JWT audience, so links of one kind never open another.
 */
export function fileLinkSecret(): string {
  const secret = process.env.FILE_LINK_SECRET;
  if (!secret) {
    throw new Error('FILE_LINK_SECRET is not set');
  }
  return secret;
}

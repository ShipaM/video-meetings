import { createHash, randomBytes } from 'node:crypto';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import type { Response } from 'supertest';

export const TUS_VERSION = '1.0.0';

/** Builds a tus `Upload-Metadata` header: comma-separated `key base64(value)` pairs. */
export const tusMetadata = (values: Record<string, string>): string =>
  Object.entries(values)
    .map(([key, value]) => `${key} ${Buffer.from(value, 'utf8').toString('base64')}`)
    .join(',');

/** An MP4 header (`ftyp` box, brand `isom`) followed by random bytes: detected as video/mp4. */
export const fakeMp4 = (size: number): Buffer => {
  const header = Buffer.concat([
    Buffer.from([0, 0, 0, 0x18]),
    Buffer.from('ftypisom'),
    Buffer.from([0, 0, 2, 0]),
    Buffer.from('isomiso2'),
  ]);
  return Buffer.concat([header, randomBytes(size - header.length)]);
};

/** A PNG signature and IHDR chunk followed by filler bytes: detected as image/png. */
export const fakePng = (): Buffer =>
  Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    Buffer.from([0, 0, 0, 13]),
    Buffer.from('IHDR'),
    Buffer.alloc(64, 1),
  ]);

export const sha256 = (data: Buffer): string => createHash('sha256').update(data).digest('hex');

/**
 * Sends a PATCH that declares the whole body but writes only `sentBytes` of it and then drops the
 * connection, as a network cut in the middle of a chunk would.
 */
export const interruptedPatch = (
  server: Server,
  location: string,
  headers: Record<string, string>,
  body: Buffer,
  sentBytes: number,
): Promise<void> =>
  new Promise((resolve) => {
    const { port } = server.address() as AddressInfo;
    const req = http.request({
      host: '127.0.0.1',
      port,
      path: location,
      method: 'PATCH',
      headers: { ...headers, 'Content-Length': String(body.length) },
    });
    req.on('error', () => resolve());
    req.on('close', () => resolve());
    req.write(body.subarray(0, sentBytes), () => {
      setTimeout(() => req.destroy(), 300);
    });
  });

/** supertest parser that collects a binary response body into a Buffer. */
export const binaryParser = (
  res: Response,
  callback: (err: Error | null, body: Buffer) => void,
): void => {
  // In Node the superagent response is the readable HTTP response stream.
  const stream = res as unknown as NodeJS.ReadableStream;
  const chunks: Buffer[] = [];
  stream.on('data', (chunk: Buffer) => chunks.push(chunk));
  stream.on('end', () => callback(null, Buffer.concat(chunks)));
};

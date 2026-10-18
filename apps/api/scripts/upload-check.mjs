// End-to-end check of a large upload against a running API (Phase 1 "done when"):
// uploads a file with tus-js-client, checks it in the meeting's file list, downloads it through a
// signed link and compares SHA-256 with the source. Not part of the e2e run (too slow).
//
// Usage (from apps/api, with the API running):
//   node scripts/upload-check.mjs <file> [mime-type]
// Env: API_URL (default http://localhost:4000), EMAIL / PASSWORD (default: a new throwaway user).
import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import path from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { Upload } from 'tus-js-client';

const [filePath, mimeType = 'video/mp4'] = process.argv.slice(2);
if (!filePath) {
  console.error('Usage: node scripts/upload-check.mjs <file> [mime-type]');
  process.exit(1);
}

const api = process.env.API_URL ?? 'http://localhost:4000';
const email = process.env.EMAIL ?? `upload-check-${Date.now()}@example.com`;
const password = process.env.PASSWORD ?? 'Str0ngPassw0rd!';
const CHUNK_SIZE = 32 * 1024 ** 2;

async function call(method, route, token, body) {
  const res = await fetch(`${api}${route}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    throw new Error(`${method} ${route} -> ${res.status} ${await res.text()}`);
  }
  return res.json();
}

async function signIn() {
  if (!process.env.EMAIL) {
    return (await call('POST', '/auth/register', null, { email, password })).accessToken;
  }
  return (await call('POST', '/auth/login', null, { email, password })).accessToken;
}

async function sha256(stream) {
  const hash = createHash('sha256');
  await pipeline(stream, hash);
  return hash.digest('hex');
}

function upload(token, meetingId, size) {
  const started = Date.now();
  return new Promise((resolve, reject) => {
    const tus = new Upload(createReadStream(filePath), {
      endpoint: `${api}/uploads`,
      chunkSize: CHUNK_SIZE,
      uploadSize: size,
      retryDelays: [0, 1000, 3000, 5000],
      headers: { Authorization: `Bearer ${token}` },
      metadata: { meetingId, filename: path.basename(filePath), filetype: mimeType },
      onProgress: (sent, total) => {
        const mbps = sent / 1024 ** 2 / ((Date.now() - started) / 1000);
        process.stdout.write(
          `\rUploading ${((sent / total) * 100).toFixed(1)}% (${mbps.toFixed(1)} MiB/s)   `,
        );
      },
      onSuccess: () => {
        process.stdout.write('\n');
        resolve(tus.url);
      },
      onError: reject,
    });
    tus.start();
  });
}

const { size } = await stat(filePath);
console.log(`File: ${filePath} (${size} bytes), API: ${api}, user: ${email}`);

const sourceHash = sha256(createReadStream(filePath));
const token = await signIn();
const meeting = await call('POST', '/meetings', token, {
  title: 'Upload check',
  startsAt: new Date().toISOString(),
});

const url = await upload(token, meeting.id, size);
const fileId = url.split('/').pop();

const files = await call('GET', `/meetings/${meeting.id}/files`, token);
const file = files.find((item) => item.id === fileId);
console.log('Listed:', file);
if (!file || file.originalName !== path.basename(filePath) || file.size !== size) {
  throw new Error('The uploaded file is missing from the list or has a wrong name / size');
}

const link = await call('POST', `/meetings/${meeting.id}/files/${fileId}/link`, token);
const download = await fetch(`${api}${link.url}`);
if (!download.ok || !download.body) {
  throw new Error(`Download failed: ${download.status}`);
}
console.log('Content-Disposition:', download.headers.get('content-disposition'));
const [expected, actual] = await Promise.all([sourceHash, sha256(Readable.fromWeb(download.body))]);
console.log(`SHA-256 source:   ${expected}\nSHA-256 download: ${actual}`);
if (expected !== actual) {
  throw new Error('The download differs from the source');
}
console.log('OK: uploaded, listed and downloaded identical to the original.');

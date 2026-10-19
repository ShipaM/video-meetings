// Check of document processing against a running API (Phase 7 "done when"): uploads documents
// with tus-js-client, waits until each leaves PROCESSING and prints its status and summary. Run
// the API with AI_PROVIDER=local to go through the real model. Not part of the e2e run (slow).
//
// Usage (from apps/api, with the API running):
//   node scripts/processing-check.mjs [file ...]   (default: the four fixtures in test/fixtures)
// Env: API_URL (default http://localhost:4000), EMAIL / PASSWORD (default: a new throwaway user),
//      TIMEOUT_SECONDS (default 1200, per file).
import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import path from 'node:path';
import { Upload } from 'tus-js-client';

const FIXTURES = path.join(import.meta.dirname, '../test/fixtures');
const files = process.argv.slice(2);
if (files.length === 0) {
  files.push(
    ...['notes.txt', 'notes.pdf', 'notes.docx', 'slides.pptx'].map((name) =>
      path.join(FIXTURES, name),
    ),
  );
}

const MIME = {
  '.txt': 'text/plain',
  '.pdf': 'application/pdf',
  '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  '.pptx': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
};

const api = process.env.API_URL ?? 'http://localhost:4000';
const email = process.env.EMAIL ?? `processing-check-${Date.now()}@example.com`;
const password = process.env.PASSWORD ?? 'Str0ngPassw0rd!';
const timeoutMs = Number(process.env.TIMEOUT_SECONDS ?? 1200) * 1000;

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

async function upload(token, meetingId, filePath) {
  const filetype = MIME[path.extname(filePath).toLowerCase()];
  if (!filetype) {
    throw new Error(`Not a document type this check knows: ${filePath}`);
  }
  const { size } = await stat(filePath);
  return new Promise((resolve, reject) => {
    const tus = new Upload(createReadStream(filePath), {
      endpoint: `${api}/uploads`,
      uploadSize: size,
      headers: { Authorization: `Bearer ${token}` },
      metadata: { meetingId, filename: path.basename(filePath), filetype },
      onSuccess: () => resolve(tus.url.split('/').pop()),
      onError: reject,
    });
    tus.start();
  });
}

async function settled(token, meetingId, fileId) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const file = await call('GET', `/meetings/${meetingId}/files/${fileId}`, token);
    if (file.status !== 'PROCESSING') {
      return file;
    }
    if (Date.now() > deadline) {
      throw new Error(`${file.originalName} is still PROCESSING`);
    }
    await new Promise((resolve) => setTimeout(resolve, 2000));
  }
}

console.log(`API: ${api}, user: ${email}`);
const token = await signIn();
const meeting = await call('POST', '/meetings', token, {
  title: 'Processing check',
  startsAt: new Date().toISOString(),
});

let failed = 0;
for (const filePath of files) {
  const started = Date.now();
  const fileId = await upload(token, meeting.id, filePath);
  const file = await settled(token, meeting.id, fileId);
  const seconds = ((Date.now() - started) / 1000).toFixed(1);
  console.log(`\n== ${file.originalName}: ${file.status} after ${seconds} s`);
  if (file.status === 'READY' && file.summary) {
    console.log(file.summary);
  } else {
    failed += 1;
    console.log(`Failure reason: ${file.failureReason}`);
  }
}

if (failed > 0) {
  throw new Error(`${failed} of ${files.length} file(s) did not reach READY with a summary`);
}
console.log(`\nOK: ${files.length} document(s) reached READY with a summary.`);

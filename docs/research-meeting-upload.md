# Research: technical implementation of meeting file upload

**Plan:** [plan-meeting-file-upload.md](plan-meeting-file-upload.md)
**PRD:** [prd-meeting-file-upload.md](prd-meeting-file-upload.md)
**Date**: 2026-10-18

This document picks the libraries and designs for every phase of the plan, checked against the current stack
(NestJS 12 on Express 5, ESM, Prisma 7 + PostgreSQL 17, Next.js 16 / React 19, Node 25 locally) and against the
current npm versions. Sections follow the order of the plan; the summary table comes first.

**Everything stays on our server.** Files are stored on the API server's local disk, and transcription and
summarization also run locally (whisper.cpp and a local LLM through Ollama). No meeting content is sent to an
external service, so no third-party data terms apply. This closes the plan's open question on the AI provider.

## Summary of decisions

| Concern                       | Decision                                                                                      | Version checked                               |
| ----------------------------- | --------------------------------------------------------------------------------------------- | --------------------------------------------- |
| Resumable upload protocol     | **tus 1.0** (creation, termination, expiration extensions)                                    | -                                             |
| Upload server                 | `@tus/server` + `@tus/file-store`, mounted inside a Nest controller                           | 2.4.6 / 2.1.1                                 |
| Upload client                 | `tus-js-client` (no Uppy: we keep our own HeroUI UI)                                          | 4.3.1                                         |
| Content type check            | allow-list by extension + declared MIME on create, magic bytes with `file-type` on completion | 22.2.0                                        |
| Download / preview / playback | short-lived signed token (JWT, own audience) + `res.sendFile` (Range, ETag for free)          | -                                             |
| Background jobs               | `pg-boss` on the existing PostgreSQL (no Redis)                                               | 12.38.0                                       |
| Text extraction               | `unpdf` (PDF), `mammoth` (DOCX), `officeparser` (PPTX), `TextDecoder` (TXT)                   | 1.9.0 / 1.13.0 / 8.1.1                        |
| Media probe / audio extract   | `ffprobe` / `ffmpeg` binaries called with `child_process.spawn` (not `fluent-ffmpeg`)         | `ffmpeg-static` 5.3.0, `ffprobe-static` 3.1.0 |
| Transcriber                   | local **whisper.cpp** CLI (`whisper-cli`, English `.en` model) called with `spawn`            | -                                             |
| Summarizer                    | local LLM in **Ollama** (HTTP API on localhost, `ollama` npm client)                          | `ollama` 0.6.4                                |
| Live statuses                 | polling `GET /meetings/:id/files` every 3 s while any file is `PROCESSING`                    | -                                             |

## 1. Upload protocol: tus vs. alternatives

Requirements from the PRD: files up to 2 GB, per-file progress, resume after a network cut within the page session,
cancel, `413` on declared size over 2 GB, partial data removed.

| Option                                                                    | Verdict                                                                                                                                                                                                                                                                                                                                    |
| ------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Single `multipart/form-data` request (Multer)                             | Rejected: no resume, a 2 GB request is killed by any proxy or by Node's `requestTimeout`.                                                                                                                                                                                                                                                  |
| Own chunk protocol (`POST` create, `HEAD` offset, `PATCH` at offset)      | Possible, but it re-implements tus: offset bookkeeping, locking of concurrent `PATCH` on one upload, partial-chunk handling on disconnect, CORS headers, client retries.                                                                                                                                                                   |
| **tus 1.0**                                                               | **Chosen.** The plan's tasks (create, report offset, append chunk at offset, complete, cancel) map 1:1 to tus `POST` / `HEAD` / `PATCH` / `DELETE`. Maintained server (`@tus/server`) and client (`tus-js-client`) exist; the file store supports exactly the extensions we need: creation, creation-with-upload, expiration, termination. |
| IETF "Resumable Uploads for HTTP" (`draft-ietf-httpbis-resumable-upload`) | Not yet: still an Internet-Draft (revision 11 in March 2026, 12 in July 2026), header names can still change; the `104 Upload Resumption Supported` code is only a temporary IANA registration. It is the successor of tus (same lead author), so moving later is cheap.                                                                   |

### How the plan's e2e cases map onto tus

| Plan requirement                      | tus mechanism                                                                                                    |
| ------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| Create an upload                      | `POST /uploads` with `Upload-Length` and `Upload-Metadata` (`meetingId`, `filename`, `filetype`, base64-encoded) |
| `413` for declared size over 2 GB     | `maxSize: 2 * 1024 ** 3` option: the server answers `413` itself                                                 |
| `400` for a disallowed type           | `onUploadCreate` throws `{ status_code: 400, body }`                                                             |
| `404` foreign meeting, `401` no token | Nest guard before tus (401); `onUploadCreate` / `onIncomingRequest` check ownership (404)                        |
| Report received offset                | `HEAD /uploads/:id` returns `Upload-Offset`                                                                      |
| Append a chunk at an offset           | `PATCH /uploads/:id` with `Upload-Offset`, `Content-Type: application/offset+octet-stream`; mismatch gives `409` |
| Complete                              | `onUploadFinish` hook (status change, magic-byte check, enqueue processing)                                      |
| Cancel (Phase 3)                      | `DELETE /uploads/:id` (termination extension) + `POST_TERMINATE` event deletes the DB row                        |

## 2. Server side: `@tus/server` inside NestJS

### Mounting

The tus README shows Express integration as `app.use('/uploads', uploadApp)` with `server.handle.bind(server)`. In
Nest it is cleaner to keep it in a controller of `MeetingFilesModule`, so `JwtAuthGuard` and DI keep working:

```ts
// meeting-files/uploads.controller.ts (sketch)
@Controller('uploads')
@UseGuards(JwtAuthGuard)
export class UploadsController {
  constructor(private readonly tus: TusServerProvider) {}

  // Express 5 path syntax: a named wildcard is required.
  @All(['', '*path'])
  handle(@Req() req: AuthenticatedRequest, @Res() res: Response): Promise<void> {
    return this.tus.server.handle(req, res);
  }
}
```

Points to verify in the Phase 1 tracer bullet:

- **Body parsing.** Nest's default parsers only consume `application/json` and `application/x-www-form-urlencoded`,
  so a `PATCH` with `application/offset+octet-stream` reaches tus as an untouched stream. Never add a global raw body
  parser.
- **Route shape.** tus wants one base path and builds `Location: /uploads/<id>` itself. The meeting id therefore goes
  into `Upload-Metadata` (`meetingId`), not into the URL. Use `relativeLocation: true` (and
  `respectForwardedHeaders` behind a proxy).
- **CORS.** `app.enableCors()` in `main.ts` answers the preflight before tus. Add `exposedHeaders` for `Location`,
  `Upload-Offset`, `Upload-Length`, `Tus-Resumable`, `Upload-Expires`, otherwise the browser client cannot read them.
  The default `cors` behaviour reflects `Access-Control-Request-Headers`, so `Authorization`, `Upload-*`,
  `Tus-Resumable` are allowed.
- **Timeouts.** Node's `server.requestTimeout` defaults to 300 s. A `PATCH` of one chunk must fit into it, which is
  one reason to set a client `chunkSize` (section 4).
- **Locking.** The default `MemoryLocker` is fine for one API instance. Several instances would need a shared locker
  and shared storage, which is out of scope (local disk is a PRD constraint).

### Hooks and options

```ts
new Server({
  path: '/uploads',
  datastore: new FileStore({ directory: path.join(FILES_DIR, 'uploads') }),
  maxSize: MAX_FILE_SIZE, // 2 GiB -> 413
  relativeLocation: true,
  namingFunction: () => randomUUID(), // the tus id IS MeetingFile.id
  onIncomingRequest: async (req, uploadId) => {
    /* HEAD/PATCH/DELETE: the upload must belong to req.user, else 404 */
  },
  onUploadCreate: async (req, upload) => {
    /* validate meetingId (owner -> else 404, participant -> 403), extension + declared MIME (400),
       free disk space (507); insert MeetingFile { id: upload.id, status: UPLOADING } */
    return { metadata: upload.metadata };
  },
  onUploadFinish: async (req, res, upload) => {
    /* magic-byte check, status UPLOADING -> READY (Phase 1) or PROCESSING + enqueue job (Phase 7+) */
    return {};
  },
});
server.on(EVENTS.POST_RECEIVE, (req, upload) => {
  /* throttled update of MeetingFile.lastChunkAt (for the 24 h cleanup) */
});
server.on(EVENTS.POST_TERMINATE, (req, res, id) => {
  /* delete the UPLOADING MeetingFile row */
});
```

Errors thrown from hooks as `{ status_code, body }` abort the request with that status, which gives the plan's
`400` / `403` / `404` without extra plumbing. Keep the hooks thin: each one dispatches a CQRS command
(`CreateUploadCommand`, `CompleteUploadCommand`, `CancelUploadCommand`) so the logic stays unit-testable like the
other handlers.

### Abandoned uploads (Phase 3)

`FileStore`'s expiration extension counts from **creation**, not from the last received part, and does not remove
anything by itself (`server.cleanUpExpiredUploads()` must be called). The PRD wants "24 hours after the last received
part", and a slow 2 GB upload may legitimately take longer than 24 hours in total. So:

- do not rely on `expirationPeriodInMilliseconds`;
- store `lastChunkAt` on `MeetingFile` (updated from `POST_RECEIVE`, throttled with `postReceiveInterval`);
- an hourly scheduled job (`pg-boss` `schedule`, section 6) deletes `UPLOADING` rows with
  `lastChunkAt < now() - 24h` and removes the data file and its tus metadata sidecar through the datastore
  (`datastore.remove(id)`), so the tus internals stay encapsulated.

## 3. Storage layout and file lifecycle

```
FILES_DIR/
  uploads/<fileId>        # tus data file, written in place; becomes the stored original on completion
  uploads/<fileId>.json   # tus metadata sidecar (FileKvStore default)
  derived/<fileId>/...    # temporary artefacts of processing (extracted audio, chunks); removed after the job
```

- `storageKey = fileId`. Keeping the completed file where tus wrote it avoids copying 2 GB; the original name,
  MIME type and size live only in the database. File names on disk are never derived from user input (no path
  traversal, no Windows reserved names).
- `FILES_DIR` is resolved to an absolute path at startup, created if missing, and never registered with any static
  serving (`ServeStaticModule` must not be added).
- **Free space:** `fs.promises.statfs(FILES_DIR)` in `onUploadCreate`; reject with `507 Insufficient Storage` when
  `bavail * bsize < Upload-Length + reserve`.
- **Delete order** (Phase 3, 7): delete the DB row first (results cascade with it), then unlink files. A crash
  between the two leaves an orphan file, never a row pointing at nothing. A daily **orphan sweep** removes files in
  `uploads/` and `derived/` without a matching row; it also covers the PRD constraint that files must not outlive
  their meeting when a `User` / `Meeting` is deleted by a database cascade.

### Prisma model (Phase 1, extended later)

```prisma
enum MeetingFileStatus {
  UPLOADING
  PROCESSING
  READY
  FAILED
}

enum MeetingFileKind {
  AUDIO
  VIDEO
  DOCUMENT
  IMAGE
}

model MeetingFile {
  id            String            @id            // = tus upload id (UUID from namingFunction)
  meetingId     String
  meeting       Meeting           @relation(fields: [meetingId], references: [id], onDelete: Cascade)
  uploadedById  String
  uploadedBy    User              @relation(fields: [uploadedById], references: [id], onDelete: Cascade)
  originalName  String
  mimeType      String
  kind          MeetingFileKind
  size          BigInt                           // 2 GiB does not fit into Int (max 2^31 - 1)
  status        MeetingFileStatus @default(UPLOADING)
  failureReason String?
  processingAttempt Int           @default(0)    // guards against stale job results, section 6
  lastChunkAt   DateTime          @default(now())
  createdAt     DateTime          @default(now())
  completedAt   DateTime?
  updatedAt     DateTime          @updatedAt

  @@index([meetingId, status])
  @@index([status, lastChunkAt])
}
```

Note: `size` must be `BigInt` (exactly 2 GiB = 2^31 overflows a PostgreSQL `integer`); serialize it as a number in
responses (safe up to 2^53).

Later phases add `MeetingFileSummary` (1:1) and `TranscriptSegment` (`fileId`, `startMs`, `endMs`, `text`, ordered),
both with `onDelete: Cascade` to `MeetingFile`.

## 4. Client side: `tus-js-client` in the meeting page

- **Why not Uppy:** Uppy brings its own dashboard UI and styling, which clashes with HeroUI and the
  `ui-ux-pro-max` requirements. `tus-js-client` is the transport Uppy uses anyway; we render our own list.
- One `tus.Upload` per file, kept in a React state/ref map (`useFileUploads` hook), at most 3 running in parallel
  (a simple queue), the rest wait.
- Options:

  | Option                        | Value                                   | Why                                                                                                          |
  | ----------------------------- | --------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
  | `endpoint`                    | `${API_URL}/uploads`                    |                                                                                                              |
  | `headers`                     | `{ Authorization: 'Bearer ' + token }`  | same JWT as the rest of the API                                                                              |
  | `metadata`                    | `{ meetingId, filename, filetype }`     | server validates them again                                                                                  |
  | `chunkSize`                   | 16-32 MiB                               | each `PATCH` stays well under Node's 300 s `requestTimeout` and proxy body limits; a lost chunk costs little |
  | `retryDelays`                 | `[0, 1000, 3000, 5000]`                 | automatic retries for short blips; after that the UI shows "Retry"                                           |
  | `storeFingerprintForResuming` | `false`                                 | PRD: resume only within the page session; after reload the file is selected again (no stale URLs in storage) |
  | `onProgress`                  | per-file progress bar                   |                                                                                                              |
  | `onError` / `onSuccess`       | error state with "Retry" / refetch list |                                                                                                              |

- **Retry (Phase 4):** call `upload.start()` on the same `Upload` object: it sends `HEAD`, gets the server offset and
  continues from there; the `File` object is still in memory, so no re-selection.
- **Cancel (Phase 4):** `upload.abort(true)` stops the transfer and sends `DELETE` (termination), which triggers the
  server cleanup.
- **Pre-upload rejection (Phase 2):** check extension + `file.type` against the same allow-list and `file.size` against
  2 GiB before creating the `Upload`. Keep the allow-list in `apps/web/src/app/meetings/[id]/constants.ts`
  (convention: constants next to the component); duplicated on the API, since there is no shared package yet.
- **Token expiry:** with `JWT_EXPIRES_IN=7d` a long upload will not outlive its token; on `401` show the normal
  sign-in redirect.
- **Drag-and-drop:** native `dragenter` / `dragover` / `drop` on the upload area plus a hidden
  `<input type="file" multiple accept="...">`; no extra library is needed.

## 5. Download, preview and playback

The PRD forbids permanent public URLs, and `<a download>`, `<iframe>`, `<img>`, `<video>` cannot send an
`Authorization` header. So:

1. `POST /meetings/:id/files/:fileId/link` (bearer auth, owner or participant) returns
   `{ url: '/files/:fileId/content?token=...' }`.
2. The token is a JWT signed with a **separate** secret or audience (`aud: 'file-content'`), payload
   `{ sub: userId, fileId, disposition }`, short TTL.
3. `GET /files/:fileId/content?token=` has no `JwtAuthGuard`; it verifies the token and then **re-checks access in the
   database** (owner or current participant, file exists and is not `UPLOADING`). A removed participant or a deleted
   file therefore gets `404` even with an unexpired token (PRD acceptance criteria).
4. Streaming with Express `res.sendFile(absPath, { headers })` (through `@Res()`): it already implements `Range`
   (`206`, `Content-Range`, `416`), `ETag` / `Last-Modified` and conditional requests, which is exactly what Phase 9
   needs. Nest's `StreamableFile` does **not** handle `Range`, so do not use it here.
5. Headers: `Content-Type` = the verified MIME from the database; `Content-Disposition` via `res.attachment(name)`
   for downloads (it emits the RFC 6266 / RFC 5987 `filename*=UTF-8''...` form, so non-ASCII names survive) or
   `inline` for previews; `X-Content-Type-Options: nosniff`; `Cache-Control: private, no-store`. `inline` is only
   allowed for PDF, PNG, JPEG, audio and video; everything else is always `attachment`.

**TTL:** 5 minutes is enough for download and image/PDF preview (the request starts at once). Media playback issues
new `Range` requests while the user seeks, long after the page opened, so media links need a longer TTL (for example
the recording duration plus 30 minutes, capped at a few hours), or the player re-requests a link on a `403`/`404`
media error. Pick the first; it is simpler.

## 6. Background processing (Phase 7, 9)

| Option                               | Verdict                                                                                                                                                                                                                                                                                  |
| ------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| In-process `setImmediate` / EventBus | Rejected: jobs are lost on restart, a crash leaves files stuck in `PROCESSING` (violates the PRD).                                                                                                                                                                                       |
| BullMQ                               | Feature-rich, but needs Redis, i.e. new infrastructure in `docker-compose.yml`, `.env` and CI.                                                                                                                                                                                           |
| Graphile Worker                      | Postgres-only and fast, but its tasks are file-based and it brings its own migrations; less natural with Nest DI.                                                                                                                                                                        |
| **pg-boss**                          | **Chosen.** Uses the PostgreSQL we already run (`SKIP LOCKED`), persistent jobs, retries with backoff, per-job expiration (timeout), singleton keys, cron schedules (cleanup jobs), dead-letter queues. Requires Node >= 22.12 and PostgreSQL >= 13 (we have Node 25 and PostgreSQL 17). |

Design:

- `JobsModule` (global) creates one `PgBoss` from `DATABASE_URL`, `start()` in `onModuleInit`, `stop()` in
  `onModuleDestroy`. pg-boss keeps its tables in its own `pgboss` schema; Prisma only manages `public`, so
  `prisma migrate` does not see them.
- Queues: `process-document`, `process-recording`, `cleanup-abandoned-uploads` (hourly), `sweep-orphan-files`
  (daily). Workers are thin and dispatch CQRS commands.
- **Timeouts:** pg-boss job expiration (for example 15 min for documents, duration-based for recordings) **plus**
  `AbortSignal.timeout()` on every Ollama call and a kill timer on `ffmpeg` / `whisper-cli`. When a job finally fails
  (retries exhausted or expired) the worker's `catch` / a dead-letter handler sets `FAILED` with a short reason.
  A watchdog in the hourly job also fails rows stuck in `PROCESSING` longer than the maximum job time, so nothing
  stays `PROCESSING` forever, even after a crash.
- **Retry (`POST .../retry`):** `FAILED -> PROCESSING`, `processingAttempt += 1`, send a job with
  `singletonKey = fileId` (no duplicates).
- **Delete during processing:** the job writes its results in one transaction that first runs
  `updateMany({ where: { id, status: 'PROCESSING', processingAttempt: attempt }, data: { status: 'READY' } })`; if 0 rows
  were updated (file deleted, or a newer attempt started) the transaction is rolled back and the result discarded.
  Result rows also have a foreign key to `MeetingFile`, so an insert for a deleted file fails anyway. The job deletes
  its `derived/<fileId>` directory in `finally`.
- **e2e tests:** the worker runs inside the test app; tests poll `GET .../files/:fileId` until the status leaves
  `PROCESSING` (with a timeout). `Summarizer` / `Transcriber` are bound to fakes through an env switch
  (`AI_PROVIDER=fake`) or `overrideProvider` in the testing module; the fake can be told to fail or hang to cover
  `FAILED` and the timeout.

## 7. Document text extraction (Phase 7)

A `TextExtractor` per type, selected by the verified MIME type; all run in the worker, never in a request.

| Type | Library                                                            | Notes                                                                                                                                                                             |
| ---- | ------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| PDF  | `unpdf` (`getDocumentProxy` + `extractText({ mergePages: true })`) | bundles a serverless PDF.js build, no native deps, Node 22+. A PDF with no text layer (scan) yields empty text -> `FAILED` "No text found in the document" (OCR is out of scope). |
| DOCX | `mammoth` (`extractRawText({ path })`)                             | mature, DOCX-only, pure JS.                                                                                                                                                       |
| PPTX | `officeparser`                                                     | also parses DOCX/PDF, so it could be the single library; kept for PPTX only to keep the best tool per format.                                                                     |
| TXT  | `fs.readFile` + `new TextDecoder('utf-8', { fatal: true })`        | invalid UTF-8 -> `FAILED`.                                                                                                                                                        |

Safety: OOXML files are ZIP archives; cap the extracted text (for example 2 MB of characters) and the job time to
defend against zip bombs. A local model has a much smaller context window than a cloud one (section 8), so text
longer than one window is summarized in chunks and then the chunk summaries are summarized again (map-reduce).

## 8. Recordings: probe, audio extraction, transcription (Phase 9)

### ffmpeg / ffprobe

- `fluent-ffmpeg` is deprecated and unmaintained; call the binaries directly with `child_process.spawn` (no shell,
  arguments as an array).
- Binaries: `ffmpeg-static` / `ffprobe-static` for local development (neither is installed on the dev machine
  today); in a production Docker image prefer the distro `ffmpeg` package (full codec support) and pass the paths
  through `FFMPEG_PATH` / `FFPROBE_PATH`.
- Duration: `ffprobe -v error -show_entries format=duration:stream=codec_type -of json <file>`; compare with
  `MAX_RECORDING_MINUTES` and fail with "Recording is longer than N minutes". The same output tells whether a `WEBM`
  has a video stream (audio vs. video kind), which magic bytes alone cannot.
- Audio for the transcriber: `ffmpeg -i <in> -vn -ac 1 -ar 16000 -c:a pcm_s16le <derived>/audio.wav`. whisper.cpp
  expects 16 kHz mono 16-bit WAV; that is about 115 MB per hour of recording, a temporary file deleted when the job
  ends.

### Transcriber: local whisper.cpp

Requirements: long recordings (a 2 GB video can last hours), segment timestamps, English, and no data leaving the
server.

| Option                                                                                             | Verdict                                                                                                                                                                                                                                                                            |
| -------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **whisper.cpp CLI (`whisper-cli`) through `spawn`**                                                | **Chosen.** C++ port of OpenAI Whisper, runs on CPU with optional GPU (CUDA, Vulkan, Metal), no Python. A separate process: a crash or out-of-memory kills only the job, and a timeout is a plain `kill()`. Same pattern as `ffmpeg`. JSON output with segment timestamps (`-oj`). |
| Native Node bindings (`nodejs-whisper` 0.3.1, `@fugood/whisper.node` 1.2.0-rc, `whisper-cpp-node`) | Rejected for now: a native addon runs inside the API process, so a crash in C++ code takes the whole API down; the packages are young (0.x / release candidates) and some build whisper.cpp at `npm install`, which is fragile on Windows.                                         |
| `whisper-server` (HTTP server from whisper.cpp) as a sidecar                                       | Fine alternative if the model should stay loaded between jobs (saves the model load time per file). Adds one more process to run; consider it if load time matters.                                                                                                                |
| faster-whisper (Python, CTranslate2)                                                               | Faster on CPU in some benchmarks, but brings a Python runtime into a Node-only repository.                                                                                                                                                                                         |
| Transformers.js (`@huggingface/transformers` 4.3.1, ONNX Whisper)                                  | Pure JS, but slower than whisper.cpp on CPU for hours of audio.                                                                                                                                                                                                                    |

Usage:

```bash
whisper-cli -m models/ggml-small.en.bin -f derived/<fileId>/audio.wav -l en -t 4 -oj -of derived/<fileId>/transcript
```

- The JSON file contains `transcription[]` with `offsets.from` / `offsets.to` in milliseconds and `text`, which maps
  directly to `TranscriptSegment { startMs, endMs, text }`.
- **Model:** English-only `.en` models are more accurate for English at the same size (the PRD is English-only).
  Choose by hardware and measure on a real one-hour meeting: `base.en` for development and tests on a laptop,
  `small.en` or `medium.en` (or quantized `large-v3-turbo`) for production. Model files (`ggml-*.bin`) are downloaded
  once into a `WHISPER_MODELS_DIR` that is git-ignored.
- **Silence:** whisper.cpp supports a VAD model (Silero) to skip silent parts, which speeds up meetings with pauses and
  reduces hallucinated text in silence; enable it if the version used supports it.
- **Binaries:** whisper.cpp publishes release builds and Docker images; on the dev machine install a release build or
  build with CMake, and pass the path through `WHISPER_CLI_PATH`. Verify the Windows build in the Phase 9 tracer
  bullet.
- **Speed and limits:** transcription is CPU-bound. On the current dev laptop (4-core i7-8565U, 16 GB RAM, 2 GB
  MX250 GPU) expect roughly real time or slower for `small.en`; the exact factor must be measured. Consequences:
  - run at most **one** transcription job at a time (pg-boss worker `localConcurrency: 1`), documents in parallel;
  - the job timeout is derived from the duration: `duration * WHISPER_SPEED_FACTOR + margin`;
  - `MAX_RECORDING_MINUTES` now limits **compute time**, not a provider limit; pick it from the measured factor
    (for example, if one hour takes one hour, a 3-hour limit means a file can be `PROCESSING` for 3 hours).
- **Progress (optional):** whisper.cpp prints progress (`-pp`); the job can store a percentage for the UI.

### Summarizer: local LLM in Ollama

- **Ollama** runs open-weight models locally and exposes an HTTP API on `localhost:11434`; the API talks to it with
  the official `ollama` npm client (or plain `fetch`). It is not installed on the dev machine yet; for production add
  the `ollama/ollama` image to `docker-compose.yml` next to PostgreSQL, with a volume for the models.
- **Model:** 7-9B instruction models (for example the Qwen3 or Gemma 3 families) run on CPU with 16 GB RAM; smaller
  ones (Gemma 3 4B) are faster and good enough for short documents. The model name is configured with
  `OLLAMA_MODEL`; compare two or three on real meetings before fixing it.
- **Context:** set `num_ctx` explicitly (for example 16-32K tokens), because the default is small and longer input
  is silently cut. More context costs more RAM. One hour of speech is roughly 10K words (about 13K tokens), so long
  meetings and big documents go through map-reduce: split into chunks that fit, summarize each, then summarize the
  summaries.
- **Output:** ask for a fixed JSON shape with Ollama's `format` parameter (a JSON schema), validate it, and store the
  summary text. An empty or invalid answer is a job failure (`FAILED` "Summary could not be generated").
- **Timeouts and load:** CPU inference of a long summary can take minutes; use the same duration-based timeout and
  run summaries one at a time, like transcription.
- The `Summarizer` and `Transcriber` interfaces stay as in the plan, so a stronger machine or a GPU only changes
  configuration, not code.

## 9. Content type validation

Defence in depth, since the client-declared type is not trusted:

1. **On create** (`onUploadCreate`): the extension of `filename` and the declared `filetype` must both be in the
   allow-list and agree with each other -> otherwise `400`.
2. **On completion** (`onUploadFinish`): `fileTypeFromFile(path)` from `file-type` (ESM-only, fine for this ESM
   project) reads the first bytes and must give a MIME of the same kind. It distinguishes DOCX and PPTX inside ZIP
   by `[Content_Types].xml`. It does not detect plain text, so TXT is checked by "valid UTF-8, no NUL bytes in the
   first 64 KB". On mismatch: remove the data, set `FAILED` "File content does not match its type" (or delete the
   record; pick one and test it).
3. The stored `mimeType` is the verified one; download headers use it, not the original declaration.

Allow-list:

| Kind     | Extensions           | MIME types                                                                                                                                                                              |
| -------- | -------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Audio    | mp3, m4a, wav, webm  | `audio/mpeg`, `audio/mp4`, `audio/x-m4a`, `audio/wav`, `audio/x-wav`, `audio/webm`                                                                                                      |
| Video    | mp4, webm, mov       | `video/mp4`, `video/webm`, `video/quicktime`                                                                                                                                            |
| Document | pdf, docx, pptx, txt | `application/pdf`, `application/vnd.openxmlformats-officedocument.wordprocessingml.document`, `application/vnd.openxmlformats-officedocument.presentationml.presentation`, `text/plain` |
| Image    | png, jpg, jpeg       | `image/png`, `image/jpeg`                                                                                                                                                               |

Browsers report `file.type` inconsistently (empty for some `.m4a` / `.mov` on Windows), so the server treats the
extension as primary and an empty declared type as acceptable when the extension matches.

## 10. Live statuses (Phase 8)

Polling, as the plan says: `GET /meetings/:id/files` every 3 s while any file is `PROCESSING`, stopped when none is
and when the tab is hidden (`document.visibilityState`). It needs no new infrastructure and survives restarts.
Server-Sent Events would cut latency but add a long-lived authenticated connection (the bearer token cannot be sent
by `EventSource`), so they are not worth it at this scale.

`UPLOADING` rows are returned only to their uploader: the list query filters
`status != UPLOADING OR uploadedById = caller`; the owner's in-progress uploads come from client state anyway.

## 11. Testing strategy

- **e2e (supertest)** speaks the tus protocol directly: `POST` with `Tus-Resumable: 1.0.0`, `Upload-Length`,
  `Upload-Metadata`; `PATCH` with `Upload-Offset` and `Content-Type: application/offset+octet-stream`; `HEAD` for the
  offset; `DELETE` for cancel. A small helper in `test/` builds the base64 metadata. Each suite uses its own
  temporary `FILES_DIR` (`fs.mkdtemp`) and removes it in `afterAll`, and asserts that the directory is empty after
  cancel / cleanup / delete (Phase 3 "no leftovers").
- **Resume test:** send the first half, abort the request mid-stream, `HEAD` returns the stored offset, `PATCH` the
  rest, compare SHA-256 of the download with the source.
- **Cleanup test:** set `lastChunkAt` back by 25 h through Prisma and run the cleanup handler directly (no waiting
  for the schedule).
- **2 GB check (Phase 1 "Done when"):** a script in `apps/api/scripts/` using `tus-js-client` in Node with a
  generated or real 2 GB file, then compares hashes; not part of the regular e2e run (too slow).
- **Unit:** CQRS handlers with mocked Prisma, as today; extractors with small fixture files in `test/fixtures/`.

## 12. Configuration (`apps/api/.env.example`)

```bash
FILES_DIR=./storage              # absolute or relative to apps/api; never served statically
FILE_LINK_SECRET=change-me       # signs download/media tokens (separate from JWT_SECRET)
MAX_RECORDING_MINUTES=180        # default to be agreed (open question)
AI_PROVIDER=fake                 # fake | local
FFMPEG_PATH=                     # optional, defaults to ffmpeg-static / PATH
FFPROBE_PATH=
WHISPER_CLI_PATH=whisper-cli     # whisper.cpp binary
WHISPER_MODELS_DIR=./models      # ggml-*.bin files, never committed
WHISPER_MODEL=small.en
WHISPER_THREADS=4
WHISPER_SPEED_FACTOR=1.5         # measured processing time / audio duration, used for job timeouts
OLLAMA_URL=http://localhost:11434
OLLAMA_MODEL=                    # chosen after a comparison on real meetings
OLLAMA_NUM_CTX=16384
```

`storage/` and `models/` go into `.gitignore`.

## 13. Risks and open points

| Risk                                                          | Mitigation                                                                                        |
| ------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| tus CORS headers conflict with `app.enableCors()`             | Verify in the Phase 1 browser check; add `exposedHeaders`; disable one of the two if they clash.  |
| Media token expires during playback                           | Duration-based TTL for media links (section 5).                                                   |
| Disk fills up with parallel 2 GB uploads                      | `statfs` check on create (`507`), 24 h cleanup, orphan sweep.                                     |
| Long transcription jobs exceed job expiration                 | Expiration derived from the recording duration and the measured `WHISPER_SPEED_FACTOR`.           |
| Local CPU is slow: files wait long in `PROCESSING`            | One recording job at a time, documents in parallel; smaller model; GPU build (CUDA/Vulkan) later. |
| Local LLM summary quality is lower than a cloud model         | Compare models on real meetings before fixing `OLLAMA_MODEL`; map-reduce for long input.          |
| Windows dev: a file still open by a stream cannot be unlinked | Delete after the response stream closes; cleanup jobs retry on `EBUSY` / `EPERM`.                 |
| `MAX_RECORDING_MINUTES` default                               | Must be agreed before Phase 9 (plan); derive it from the measured transcription speed.            |

## Sources

- [@tus/server 2.4.0 README](https://cdn.jsdelivr.net/npm/@tus/server@2.4.0/README.md)
- [@tus/file-store README](https://cdn.jsdelivr.net/npm/@tus/file-store/README.md)
- [tus Node.js server 1.0.0 announcement](https://tus.io/blog/2023/09/04/tus-node-server-v100)
- [tus-js-client API docs](https://github.com/tus/tus-js-client/blob/main/docs/api.md)
- [IETF draft: Resumable Uploads for HTTP (rev. 11)](https://datatracker.ietf.org/doc/html/draft-ietf-httpbis-resumable-upload-11)
- [104 Upload Resumption Supported](https://http.dev/104)
- [pg-boss](https://github.com/timgit/pg-boss)
- [BullMQ vs pg-boss comparison (2026)](https://www.pkgpulse.com/guides/bullmq-vs-bee-queue-vs-pg-boss-job-queues-nodejs-2026)
- [unpdf](https://github.com/unjs/unpdf)
- [officeparser](https://www.jsdelivr.com/package/npm/officeparser)
- [file-type](https://github.com/sindresorhus/file-type)
- [fluent-ffmpeg deprecation notice](https://npmjs.com/package/fluent-ffmpeg)
- [whisper.cpp server example](https://github.com/ggml-org/whisper.cpp/tree/master/examples/server)
- [faster-whisper benchmarks (whisper.cpp comparison)](https://pypi.org/project/faster-whisper/)
- [@fugood/whisper.node README](https://cdn.jsdelivr.net/npm/@fugood/whisper.node@1.1.1/README.md)
- [whisper-cpp-node README](https://cdn.jsdelivr.net/npm/whisper-cpp-node@0.2.12/README.md)
- [nodejs-whisper](https://github.com/ChetanXpro/nodejs-whisper)
- [Best Ollama models in 2026](https://mljourney.com/best-ollama-models-in-2026-a-practical-guide-by-use-case/)
- npm registry (`npm view`, 2026-10-18) for the versions in the summary table

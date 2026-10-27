# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Stack

NestJS 12 on Express, TypeScript 6, ESM (`"type": "module"`, `module: nodenext`), so **relative imports need the `.js` extension** (e.g. `./app.service.js`). Tests use Vitest; linting uses ESLint with `typescript-eslint` (type-checked rules) and `eslint-config-prettier`.

## Commands (from this directory, or use `--workspace=api` from the root)

```bash
npm run start:dev    # nest start --watch, http://localhost:4000 (PORT env overrides)
npm run build        # prisma generate + nest build -> dist/
npm run prisma:migrate   # prisma migrate dev (needs `npm run db:up` from the root)
npm run prisma:generate  # regenerate the client in src/generated/prisma (also runs on postinstall)
npm run start:prod   # node dist/main
npm run gen:secret   # prints a random 64-char hex string, use it as JWT_SECRET
npm run lint | lint:fix
npm run test         # unit tests (src/**/*.spec.ts, handlers with mocked Prisma / buses), see Testing
npm run test:e2e     # e2e tests (test/*.e2e-spec.ts, vitest.config.e2e.ts), need the database, see Testing
npx vitest run src/meeting-files/file-types.spec.ts   # single test file
npx vitest run -t "name"                    # single test by name
node scripts/upload-check.mjs <file> [mime]  # large upload check against a running API, see Meeting files
node scripts/processing-check.mjs [file ...]  # summaries and transcripts through a running API, see Background processing
```

## Architecture and routes

Standard Nest module/controller/service layout:

- `src/main.ts` - bootstrap, listens on `PORT ?? 4000`; CORS for `WEB_ORIGIN` (exposes the tus headers)
- `src/app.module.ts` - root module (no routes of its own)
- `src/prisma/` - global `PrismaModule` / `PrismaService` (Prisma 7 with the `@prisma/adapter-pg` driver adapter; disconnects in `onApplicationShutdown`, the last shutdown phase, after pg-boss has stopped in `beforeApplicationShutdown`, so running jobs can still write their results)
- `src/config/env.ts` - `numberEnv(name, fallback, min)`: numeric settings, a bad value fails at startup
- `src/jobs/` - global `JobsModule` / `JobsService`: the app's single pg-boss instance (background jobs and schedules, see Background processing)
- `src/auth/` - `AuthModule`: `POST /auth/register`, `POST /auth/login` and `POST /auth/password`, token issuing and `JwtAuthGuard` (see below)
- `src/users/` - `UsersModule`: creating and looking up users, the caller's profile `GET` / `PATCH /users/me` (see below)
- `src/meetings/` - `MeetingsModule`: meetings and their participants, `/meetings[/:id[/participants]]` (see below)
- `src/storage/` - `StorageModule`: `FilesStorageService`, the files on disk (`FILES_DIR`, see Storage), shared by every module that stores uploads
- `src/meeting-files/` - `MeetingFilesModule`: resumable upload (tus), file list and details, signed downloads and streaming, background processing of documents and recordings (see below)
- `prisma/schema.prisma`, `prisma/migrations/`, `prisma.config.ts` - Prisma schema (`User`, `UserAvatar`, `Meeting`, `MeetingParticipant`, `MeetingFile`, `MeetingFileSummary`, `TranscriptSegment`), migrations and CLI config
- `test/auth.e2e-spec.ts`, `test/profile.e2e-spec.ts`, `test/meetings.e2e-spec.ts`, `test/meeting-files.e2e-spec.ts`, `test/meeting-participants.e2e-spec.ts`, `test/meeting-file-processing.e2e-spec.ts`, `test/meeting-file-transcription.e2e-spec.ts` - e2e tests using supertest against the Nest app and the real database (written first, TDD); `test/tus.helpers.ts` - tus metadata, fake MP4, interrupted PATCH, binary body parser; `test/media.helpers.ts` - `makeRecording` writes small genuine MP3 / MP4 files (tone, silence or no sound) with the app's ffmpeg on every run, so no media is committed; `test/fixtures/` - small genuine PDF, DOCX, PPTX and TXT documents (marked `binary` in their `.gitattributes`: a PDF's xref offsets break if line endings change)
- `src/**/handlers/*.handler.spec.ts` - unit tests of the CQRS handlers (Prisma and the buses are mocked)
- `scripts/upload-check.mjs`, `scripts/processing-check.mjs` - manual checks against a running API: large upload, summaries and transcripts (not part of any test run)

## Modules

`AppModule` imports `CqrsModule.forRoot()` (global `CommandBus` / `QueryBus`), `PrismaModule` and `JobsModule` (both global) and the four feature modules:

| Module               | Responsibility                                                                       | Public surface                                                                                                                             | Talks to                                                                                                        |
| -------------------- | ------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------- |
| `AuthModule`         | registration, login, password change, password hashing, JWT issuing and verification | `POST /auth/register`, `POST /auth/login`, `POST /auth/password`, `JwtAuthGuard`, `JwtModule`                                              | Users, through `CreateUserCommand` / `FindUserByEmailQuery` / `FindUserByIdQuery` / `UpdatePasswordHashCommand` |
| `UsersModule`        | the `User` and `UserAvatar` tables: users, the caller's profile, avatar uploads      | `GET` / `PATCH /users/me`; CQRS messages from `src/users/index.ts`                                                                         | Prisma; `StorageModule` (avatar files); imports `AuthModule` for `JwtAuthGuard` only                            |
| `MeetingsModule`     | meetings, their participants and the access rules (owner / participant)              | `/meetings`, `/meetings/:id`, `/meetings/:id/participants[/:userId]`; `GetMeetingQuery` (`src/meetings/index.ts`)                          | imports `AuthModule` for `JwtAuthGuard`; Users through `FindUserByEmailQuery` / `FindUsersByIdsQuery`           |
| `MeetingFilesModule` | the `MeetingFile` table and the files on disk (`FILES_DIR`)                          | `/uploads` (tus), `GET` / `DELETE /meetings/:id/files[/:fileId]`, `POST .../files/:fileId/retry` and `/link`, `GET /files/:fileId/content` | Meetings, through `GetMeetingQuery` (access rules); `AuthModule` for the guard and `JwtService`                 |

Dependencies point one way: MeetingFiles -> (buses) -> Meetings -> (buses) -> Users, and Meetings -> Auth -> (buses) -> Users. Users imports `AuthModule` only for the guard (Auth never imports Users, it uses the buses) and knows nothing about Meetings, Meetings nothing about files.

Layout of a feature module (Auth, Users, Meetings and MeetingFiles follow it):

```
src/<module>/
  <module>.module.ts        # providers: [...CommandHandlers, ...QueryHandlers]
  <module>.controller.ts    # Auth, Users, Meetings, MeetingFiles; builds messages, dispatches them
  dto/                      # class-validator request bodies
  commands/  <name>.command.ts, handlers/<name>.handler.ts (+ .spec.ts), index.ts
  queries/   <name>.query.ts,   handlers/<name>.handler.ts (+ .spec.ts), index.ts
  index.ts                  # Users, Meetings: the public API other modules import
```

Auth additionally has `token.service.ts` (signs the JWT), `jwt-auth.guard.ts` and `auth.constants.ts` (bcrypt rounds).

## Auth

Register and login take `{ email, password }` and return `201 { accessToken }` (JWT, payload `sub` + `email`). Passwords are hashed with bcrypt; e-mails are stored lower-cased.

`POST /auth/password` (bearer token, `JwtAuthGuard`) takes `{ oldPassword, newPassword }` (`ChangePasswordDto`, same length rules as registration) and returns `204`; the current token keeps working.

| Route                 | Errors                                                                                                                                                                                   |
| --------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `POST /auth/register` | `400` invalid e-mail / missing or too short (<8) password, `409` e-mail taken                                                                                                            |
| `POST /auth/login`    | `400` invalid e-mail / missing password, `401` unknown e-mail or wrong password (no user is created)                                                                                     |
| `POST /auth/password` | `400` missing old password / too short (<8) new password, `401` no or invalid token, `403` wrong old password (not `401`, which would sign the web app out); nothing is changed on error |

Auth registers `TokenService` (`issue(userId, email)` signs `{ sub, email }`) and `JwtAuthGuard`; it exports `JwtModule` and the guard, which is how Meetings protects its routes.

A global `ValidationPipe` (`whitelist: true`) is registered in `src/main.ts` and in the e2e tests; without it DTO validation does not return `400`.

## Users

`UsersModule` owns the `User` table; no other module touches `prisma.user`. `UsersController` serves the caller's own profile (bearer token, `JwtAuthGuard`; `401` without one):

| Route             | Behaviour                                                                                                                                                           |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET /users/me`   | `200 { email, name, avatar }` (`UserProfile`; `name` and `avatar` are `null` until set, `avatar` is always `null` for now), never the password hash                 |
| `PATCH /users/me` | body `{ name? }` (`UpdateProfileDto`): trimmed, at most 50 characters after trimming (else `400`, nothing saved); empty or spaces only stores `null`; `200` profile |

Other modules reach Users only through CQRS messages, which are exported from `src/users/index.ts` (the module's public API):

| Message                                                         | Result                                                                                                                                                                                                  |
| --------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `CreateUserCommand(email, hash)`                                | the stored `UserRecord`; lower-cases the e-mail, `409 ConflictException` when it is taken                                                                                                               |
| `FindUserByEmailQuery(email)`                                   | `UserRecord` or `null`; the lookup is case-insensitive (the e-mail is lower-cased)                                                                                                                      |
| `FindUserByIdQuery(id)`                                         | `UserRecord` or `null`                                                                                                                                                                                  |
| `FindUsersByIdsQuery(ids)`                                      | `UserContact[]` (`id`, `email`, no hash; unknown ids left out); one query, participant e-mails                                                                                                          |
| `GetProfileQuery(userId)`                                       | `UserProfile` (`email`, `name`, `avatar`); `404` for an unknown user                                                                                                                                    |
| `UpdateProfileCommand(userId, name?)`                           | the updated `UserProfile`; trims the name, empty or `null` clears it, omitted keeps it; `404` unknown user                                                                                              |
| `UpdatePasswordHashCommand(userId, hash)`                       | nothing; stores the new bcrypt hash (Auth hashes the password); `404` unknown user                                                                                                                      |
| `CreateAvatarUploadCommand(userId, uploadId, size, metadata)`   | nothing; `UPLOADING` `UserAvatar` (id = tus upload id = storage key); `413` over 5 MB, `400` outside PNG / JPEG / WebP (`filename` extension primary, `filetype` must agree), before any data is stored |
| `CompleteAvatarUploadCommand(uploadId)`                         | nothing; magic bytes (`file-type`) must match the stored type, else row then data are removed and `400`; `READY` otherwise; idempotent                                                                  |
| `CancelAvatarUploadCommand(userId, uploadId)`                   | nothing; deletes the caller's `UPLOADING` row (tus removes the data); `404` missing or foreign, `409` complete                                                                                          |
| `AuthorizeAvatarUploadRequestCommand(userId, uploadId, method)` | nothing; `404` missing or foreign upload, `409` `PATCH` once complete; records `lastChunkAt` on `PATCH`, completes an upload whose bytes are all stored                                                 |

`UserRecord` (`id`, `email`, `passwordHash`) is internal: never return it from a controller. Queries that serve other users' data return `UserContact` (`id`, `email`) instead, so the hash is never even loaded. Profile and other user features go into this module.

Auth does the credential work and talks to Users over the buses: `RegisterUserHandler` hashes the password with bcrypt and dispatches `CreateUserCommand`; `LoginHandler` dispatches `FindUserByEmailQuery`, compares the hash and issues the JWT through `TokenService`; `ChangePasswordHandler` dispatches `FindUserByIdQuery`, compares the old password (`403` on mismatch, `404` unknown user), hashes the new one and dispatches `UpdatePasswordHashCommand`. Auth never imports Prisma.

## Meetings

All routes require `Authorization: Bearer <accessToken>` (`JwtAuthGuard` in `src/auth/`, exported by `AuthModule`; it verifies the JWT and sets `request.user = { id, email }`, typed as `AuthenticatedRequest`). Missing or invalid token gives `401`.

| Route               | Behaviour                                                                                                        |
| ------------------- | ---------------------------------------------------------------------------------------------------------------- |
| `POST /meetings`    | body `{ title, startsAt }` (ISO date), `201` with the meeting (`role: 'owner'`); `400` on missing/invalid        |
| `GET /meetings`     | `200`, the meetings the caller owns **and** those shared with them, ordered by `startsAt`, each with its `role`  |
| `GET /meetings/:id` | `200` with `role`; `404` if it does not exist **or the caller is neither owner nor participant**; `400` non-UUID |

A meeting response (`MeetingView`) is `{ id, title, startsAt, ownerId, role, createdAt, updatedAt }`; `role` is `'owner'` or `'participant'` (a shared meeting). The `Meeting` Prisma model belongs to a `User` (`onDelete: Cascade`).

### Participants and access rules

The owner shares a meeting with registered users; `MeetingParticipant` (primary key `meetingId` + `userId`, both `onDelete: Cascade`) holds the pairs.

| Route                                       | Behaviour                                                                                                                                                                                                                                                           |
| ------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `POST /meetings/:id/participants`           | body `{ email }` (looked up case-insensitively through `FindUserByEmailQuery`); `201 { userId, email, addedAt }`. `404` unregistered e-mail, `400` the owner's own or an invalid e-mail, `409` already a participant (the primary key also settles concurrent adds) |
| `GET /meetings/:id/participants`            | `200 [{ userId, email, addedAt }]`, oldest first; e-mails come from Users (`FindUsersByIdsQuery`)                                                                                                                                                                   |
| `DELETE /meetings/:id/participants/:userId` | `204`; `404` if that user is not a participant, `400` non-UUID. Access ends at once, download links issued earlier included                                                                                                                                         |

All three are owner only: `403` for a participant, `404` for anybody else.

Every access check goes through `GetMeetingQuery(userId, meetingId, access = 'view')`, the only place that knows the rules. It returns the `MeetingView`:

| Caller       | `view`: meeting, meetings list, files list, download link and content | `manage`: upload, cancel, file deletion, participants |
| ------------ | --------------------------------------------------------------------- | ----------------------------------------------------- |
| owner        | allowed                                                               | allowed                                               |
| participant  | allowed                                                               | `403`                                                 |
| anybody else | `404` (a foreign meeting looks like a missing one)                    | `404`                                                 |

tus requests on an existing upload (`HEAD`, `PATCH`, `DELETE /uploads/:id`) read the upload once by id and pass it to `requireOwnUpload` (`src/meeting-files/upload-access.ts`): the uploader goes on, anyone else is decided by `GetMeetingQuery(..., 'manage')`, so a participant gets `403` and a stranger or a missing upload `404`. Participants never see `UPLOADING` files: the files list and download links skip them for everybody.

## Meeting files

`MeetingFilesModule` (`src/meeting-files/`) stores files of a meeting on local disk. Design and library choices: `docs/research-meeting-upload.md` (repository root). Access follows the meeting rules above: the owner and participants read, only the owner writes.

### Resumable upload (tus 1.0)

`@tus/server` + `@tus/file-store` run inside `UploadsController` (`TusService`), behind `JwtAuthGuard`; the tus hooks only dispatch CQRS messages. Upload id = `MeetingFile.id` (UUID). The meeting id travels in `Upload-Metadata` (`meetingId`, `filename`, `filetype`, base64), not in the URL. Every request needs `Tus-Resumable: 1.0.0` (else `412`).

| Route                 | Behaviour                                                                                                                                                                                                                                                                                                                                                                                                      |
| --------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `POST /uploads`       | `Upload-Length` + `Upload-Metadata`; `201` with `Location: /uploads/<id>`, creates an `UPLOADING` row (`CreateUploadCommand`). `413` over 2 GiB, `400` missing metadata or a type outside the allow-list, `404` foreign/missing meeting, `403` for a participant, `507` when free space minus the bytes active uploads still have to write (uploads with a chunk in the last 24 h) is below the size + 512 MiB |
| `HEAD /uploads/:id`   | `200` with `Upload-Offset` / `Upload-Length`; `404` if the upload is not the caller's, `403` for a participant of its meeting (`AuthorizeUploadRequestCommand`)                                                                                                                                                                                                                                                |
| `PATCH /uploads/:id`  | `Upload-Offset` + `Content-Type: application/offset+octet-stream`; `204` with the new offset, `409` on an offset mismatch or a completed upload, `404` if not the caller's, `403` for a participant. Each PATCH sets `lastChunkAt`; the last chunk runs `CompleteUploadCommand`                                                                                                                                |
| `DELETE /uploads/:id` | cancel (tus termination): `204`, removes the `UPLOADING` row (`CancelUploadCommand`, in `onIncomingRequest`), then tus removes the partial data under its upload lock (a chunk still being written is stopped). `409` for a completed upload (delete the file instead), `404` if not the caller's, `403` for a participant                                                                                     |

Completion checks the magic bytes (`file-type`; TXT: valid UTF-8 without NUL) against the stored type: a mismatch deletes the row and the data and answers `400`. Otherwise a document or a recording (audio, video) becomes `PROCESSING` (`processingAttempt + 1`) and its job is queued (see Background processing and Recordings); an image becomes `READY` at once. If completion fails with an unexpected error (e.g. the database), tus never calls the hook again; so `HEAD` / `PATCH` on an `UPLOADING` file whose bytes are all stored runs `CompleteUploadCommand` again (the client's retry). `CompleteUploadCommand` is idempotent (conditional `updateMany` / `deleteMany`). An unreadable data file counts as a type mismatch. tus `GET` is not routed. The allow-list (extension primary, declared MIME must agree, empty or `application/octet-stream` accepted) lives in `file-types.ts`.

### List and download

| Route                                   | Behaviour                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| --------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET /meetings/:id/files`               | bearer token; `200` completed files (not `UPLOADING`), newest first, `size` as a number, with `status`, `failureReason`, `previewable` (served inline as a whole, for a PDF or image preview), `playable` (served inline with byte ranges, for the audio or video player; see the content route), `durationMs` (a recording's length once probed, else `null`) and `summary` (as in the details, so a page polling the list gets summaries too), for the owner and participants; `404` foreign meeting, `400` non-UUID                                                                                                                                                                                                                                                                                                                                               |
| `GET /meetings/:id/files/:fileId`       | bearer token; `200` the file plus `summary` (string once a document or recording is `READY`, else `null`) and `transcript` (`[{ startMs, endMs, text }]` in order once a recording is `READY`, else `null`; only here, not in the list: a long meeting has thousands of segments), for the owner and participants (`GetMeetingFileQuery`); `404` foreign meeting, missing or `UPLOADING` file, `400` non-UUID                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| `POST /meetings/:id/files/:fileId/link` | bearer token; `201 { url, expiresAt }`, `url` = `/files/:fileId/content?token=...` (relative to the API), valid 5 minutes; for a recording the duration plus 30 minutes (an hour of play while the duration is unknown), at most 6 hours, because a player asks for new ranges whenever the user seeks (`mediaLinkTtlSeconds`); `404` foreign/missing/`UPLOADING` file                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| `GET /files/:fileId/content?token=`     | **no** bearer token (for `<a download>`); `401` missing/invalid/expired token or a token for another file, `404` when access is gone; streams with `res.sendFile` (Range, ETag), `Content-Type` = stored MIME, `Content-Disposition: attachment` with the original name (RFC 5987 `filename*` for non-ASCII; `&disposition=inline` makes it `inline` for a PDF, PNG or JPEG preview, `INLINE_MIME_TYPES`, and serves an audio or video file inline for the player **with** byte ranges (`PLAYABLE_MIME_TYPES`): `206` with `Content-Range`, open-ended and suffix ranges, `416` with `Content-Range: bytes */size` past the end; any other type stays an attachment; a preview has no byte ranges, so a PDF viewer gets the whole file while the link is valid instead of asking for ranges after it expired), `nosniff`, `no-store`, `Referrer-Policy: no-referrer` |

Link tokens are JWTs signed with `FILE_LINK_SECRET` and audience `file-content` (`{ sub: userId, fileId }`), so access tokens and link tokens are not interchangeable. The content route re-checks access in the database (`GetMeetingQuery`), so a deleted file or lost access stops working before the link expires.

### Delete a file

| Route                                | Behaviour                                                                                                                                                                                                                                                                              |
| ------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `DELETE /meetings/:id/files/:fileId` | bearer token; `204`, removes the row and then the stored original (`DeleteMeetingFileCommand`); links issued earlier then give `404`. `404` foreign/missing meeting or file and for an `UPLOADING` file (cancelled via `DELETE /uploads/:id`), `403` for a participant, `400` non-UUID |

### Background processing

Documents (PDF, DOCX, PPTX, TXT) are summarized, and recordings transcribed and summarized, in the background; design in `docs/research-meeting-upload.md` (sections 6-8). This section covers the shared machinery and documents; recordings follow in the next one.

- **Jobs:** pg-boss (`JobsService`, one `PgBoss` from `DATABASE_URL`, tables in the `PGBOSS_SCHEMA` schema, default `pgboss`; Prisma never sees them). `ProcessingQueue` (`processing/processing-queue.ts`) owns the `process-document` and `process-recording` queues (`PROCESSED_KINDS`: documents, audio, video). `queue(tx, kind, fileId, attempt)` adds `{ fileId, attempt }` to the queue of the kind **inside the Prisma transaction** that sets the file to `PROCESSING` (pg-boss writes through `tx.$queryRawUnsafe`): status and job commit together or not at all, so no file ever waits for a job that was never sent; upload completion and retry both use it (`updateManyAndReturn`, conditional on the previous status). Each queue's worker (`localConcurrency: 1`, a local model gains nothing from parallel requests) dispatches `ProcessDocumentCommand` / `ProcessRecordingCommand`; one document and one recording may run at the same time, so a document never waits behind an hours-long recording. Jobs survive restarts.
- **`ProcessDocumentCommand`:** reads the file only if it is still `PROCESSING` for that `attempt` (a deleted file or a newer attempt makes the job a no-op), extracts the text, summarizes it, then in **one transaction** sets `READY` with the same condition and upserts `MeetingFileSummary` only if that matched. So a file deleted during processing never comes back, and neither does its summary.
- **Text extraction** (`processing/document-text.ts`) runs in a **worker thread** (`extract-text.worker.mjs`, plain JavaScript so Node runs it from `dist` and Vitest from `src`; `nest-cli.json` copies `*.worker.mjs` into `dist` as an asset) with a 1 GB heap limit: parsing never blocks the API's event loop, a document that needs too much memory fails instead of the API, and the job's signal `terminate()`s the worker, so no parse keeps running after a timeout. `unpdf` (PDF), `mammoth` (DOCX), `officeparser` (PPTX, given a buffer because stored files have no extension); TXT is read only up to the cap (UTF-8, `fatal`). Text is trimmed and capped at 2 M characters; PDF, DOCX and PPTX over 100 MB are not parsed.
- **Failures** end in `FAILED` with a short `failureReason` (conditional on the attempt too): `No text found in the document` (blank, or a scanned PDF: no OCR), `The document could not be read`, `The document is too large to summarize (over 100 MB)`, `Summary could not be generated` (`SummaryError`), `Processing took too long` (the job's own `AbortSignal.timeout(DOCUMENT_PROCESSING_TIMEOUT_SECONDS)`, default 15 min, covers extraction and every model call), `Processing failed` (anything else, logged). Only an abort of the pg-boss job signal (shutdown, expiration) is rethrown, so pg-boss retries the job (`retryLimit: 2`, `retryDelay: 30` s, `expireInSeconds` = timeout + 60 s).
- **Watchdog:** `FailStuckProcessingCommand(cutoff = now - 15 min)` looks at files `PROCESSING` without a change since the cutoff and fails ("Processing was interrupted", conditional on the attempt) only those whose job is gone: `ProcessingQueue.hasLiveJob` finds no job for that file and attempt in `created`, `retry` or `active` in the queue of its kind (pg-boss `findJobs` by data). So a file waiting behind a long queue is never failed; one whose job ended without a result (retries used up after crashes or expirations) is. It runs with the hourly maintenance.
- **Summarizer:** `Summarizer` (abstract class, the DI token) is bound by `SummarizerProvider` through `AI_PROVIDER`: `fake` (default; `FakeSummarizer` quotes the start of the text; tests steer it through its `control`, a `FakeControl` shared with `FakeTranscriber`: fail, hang or hold) or `local` (`OllamaSummarizer`: `POST {OLLAMA_URL}/api/chat` with `fetch` and the job signal, `stream: false`, a JSON schema `format` (`{ summary }`), `num_ctx = OLLAMA_NUM_CTX`, `think: false` so thinking models such as Qwen3 answer directly; the prompt names the source, a meeting document or a meeting transcript (`summarize(text, signal, source)`); text longer than about `2 x OLLAMA_NUM_CTX` characters is summarized in parts and the part summaries are combined, map-reduce, for at most 3 rounds and only while they get shorter). An unreachable Ollama, an error status, a body or answer that is not the requested JSON (e.g. a proxy page) or an empty summary is a `SummaryError`. No meeting content leaves the server.
- **Local model:** Ollama runs as the `ollama` service of the root `docker-compose.yml` (`docker compose up -d ollama`, models in the `ollama_models` volume); pull the model once with `docker compose exec ollama ollama pull qwen3:4b`, then set `AI_PROVIDER=local` and `OLLAMA_MODEL=qwen3:4b` (the first request after a start loads the model, about 2-3 min on a CPU; a one-page summary then takes 10-100 s). `node scripts/processing-check.mjs [file ...]` uploads documents (default: the four fixtures) to a running API, waits for each to leave `PROCESSING` and prints status and summary.

| Route                                    | Behaviour                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| ---------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `POST /meetings/:id/files/:fileId/retry` | bearer token; owner only (`RetryFileProcessingCommand`); `202` with the file details, now `PROCESSING` (`failureReason` cleared, `processingAttempt + 1`, job queued on the queue of its kind in the same transaction; if queueing fails nothing changes and the answer is `500`). `409` unless the file is a `FAILED` document or recording (the update is conditional, so two retries at once start one attempt), `403` for a participant, `404` foreign meeting, missing or `UPLOADING` file, `400` non-UUID |

### Recordings

Audio (MP3, M4A, WAV, WebM) and video (MP4, WebM, MOV) get an English transcript with timestamps and a summary. `ProcessRecordingCommand` (`process-recording` queue) reads the file only if it is still `PROCESSING` for its attempt, like documents, and works in `FILES_DIR/derived/<fileId>.<attempt>` (one directory per attempt, cleared at the start, removed in `finally`; the extracted audio is about 115 MB per hour):

1. **Probe** (`processing/media.ts`, `ffprobe -show_entries format=duration:stream=codec_type -of json`): stores `durationMs` at once. No audio stream -> "No audio found in the recording"; longer than `MAX_RECORDING_MINUTES` (default 180) -> "Recording is longer than N minutes", before anything is extracted; a file ffprobe rejects -> "The recording could not be read".
2. **Audio:** `ffmpeg` writes the first audio track as 16 kHz mono 16-bit WAV (bit-exact 44-byte header, so duration = (size - 44) / 32 ms) and stops a second past the limit (`-t`), so a container that does not state its duration (a browser-recorded WebM) is caught here instead of filling the disk.
3. **Transcribe:** `Transcriber` (abstract class, DI token, bound by `TranscriberProvider` through `AI_PROVIDER`): `fake` (`FakeTranscriber`: every non-silent second of the WAV is a piece "Fake speech <n>.", so a tone is speech and silence has none; steered through `control`) or `local` (`WhisperTranscriber`: `whisper-cli -m <model> -f audio.wav -l en -t <threads> -oj -of audio.wav.whisper -np` as a child process, reads `audio.wav.whisper.json`: `transcription[].offsets.from/to` and the trimmed `text`; empty pieces and non-speech notes such as `[BLANK_AUDIO]` or `(music)` are dropped). No pieces -> "No speech found in the recording"; a CLI that fails, cannot start or writes unreadable output -> `TranscriptionError` -> "The recording could not be transcribed" (logged). The transcript is then **stored before the summary**: one transaction, conditional on the attempt, sets `durationMs` and replaces the `TranscriptSegment` rows (`fileId` + `position`, `startMs`, `endMs`, `text`; cascade with the file). So a failed summary does not cost the transcription: a job that finds stored segments (a retry after "Summary could not be generated") skips steps 1-3. Segments are shown only once the file is `READY`.
4. **Summarize** the joined transcript (`source: 'transcript'`), then in **one transaction** set `READY` (conditional on the attempt) and upsert the summary. A file deleted meanwhile gets nothing back. Both result transactions allow 60 s (`RESULT_TRANSACTION_TIMEOUT_MS`) instead of Prisma's 5 s: thousands of segments on a slow disk.

- **Timeouts per stage**, each `AbortSignal.any([job signal, stage timeout])`: probe and extraction `RECORDING_PREPARE_TIMEOUT_MS` (15 min), transcription `duration x WHISPER_SPEED_FACTOR (1.5) + TRANSCRIPTION_TIMEOUT_MARGIN_SECONDS (300, model loading)`, summary `DOCUMENT_PROCESSING_TIMEOUT_SECONDS` for every started hour of the recording (`transcriptSummaryTimeoutMs`: a long transcript is summarized in parts). A stage that runs out of its time throws `StageTimeoutError` at once, which alone means "Processing took too long", so a failure after a stage has ended keeps its real reason. The pg-boss expiration of a recording job covers every stage of the longest allowed recording plus a minute (`recordingJobExpirationSeconds`, set per job when it is sent); a `MAX_RECORDING_MINUTES` whose jobs would not fit into pg-boss's 24 h makes the app refuse to start, instead of jobs expiring mid-transcription.
- **Recordings uploaded before Phase 9** became `READY` without a transcript. Migration `20261020073521_fail_untranscribed_recordings` marks those without a summary `FAILED` ("Uploaded before recordings were transcribed; retry to transcribe it"), so the owner can start their transcription with Retry.
- **Child processes** (`processing/run-process.ts`, `runProcess`): `spawn` without a shell, arguments as an array, `windowsHide`; the abort signal kills the process, so a timeout or a shutdown never leaves ffmpeg or whisper running. A non-zero exit is a `ProcessError` with the stderr tail; a binary that cannot be started rejects with the spawn error (`ENOENT`), which media code treats as unexpected ("Processing failed", logged), not as a broken file.
- **Binaries:** `ffmpeg-static` and `@ffprobe-installer/ffprobe` (only the binary of the current platform, unlike the 350 MB `ffprobe-static`) install ffmpeg 6.1 and ffprobe; `FFMPEG_PATH` / `FFPROBE_PATH` override them (use the distro `ffmpeg` in a production image). whisper.cpp is not an npm package: install a release build (Windows: `whisper-bin-x64.zip` from the GitHub releases of `ggml-org/whisper.cpp`) and set `WHISPER_CLI_PATH`; download the model once into `WHISPER_MODELS_DIR` (`./models`, git-ignored): `curl -L -o models/ggml-small.en.bin https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-small.en.bin`. With `AI_PROVIDER=local` the app refuses to start without the model file.
- **Measured** on the dev laptop (4-core i7-8565U, CPU only, whisper.cpp 1.9.5, 4 threads, 49 s of speech): `base.en` 12 s (0.25 x the duration, one name misheard), `small.en` 36 s (0.7 x, no mistakes); hence the defaults `WHISPER_MODEL=small.en` and `WHISPER_SPEED_FACTOR=1.5`. With the default 180-minute limit a recording can take about 2 h to transcribe on this machine. `node scripts/processing-check.mjs <file.mp3> <file.mp4>` against an API with `AI_PROVIDER=local` prints the duration, the timed transcript and the summary.

### Abandoned uploads and orphan files

`StorageMaintenanceWorker` runs the storage maintenance as a pg-boss schedule (`storage-maintenance` queue, `STORAGE_MAINTENANCE_CRON` hourly, `singleton` policy so runs never overlap, also across instances) and once at startup: the two commands below, then `FailStuckProcessingCommand` (see Background processing). `FILES_CLEANUP=off` disables it; `vitest.config.e2e.ts` sets that, because the e2e suites share the dev database and point `FILES_DIR` at a temporary directory.

- `CleanupAbandonedUploadsCommand(cutoff = now - 24 h)` reads `UPLOADING` rows with `lastChunkAt < cutoff` in batches of 100 (keyset pagination by id). An upload whose bytes are all stored only lost its completion, so it is completed (`CompleteUploadCommand`) instead of removed. The others are deleted with the condition repeated in the `deleteMany` (a chunk that arrives meanwhile keeps the upload), then their data. e2e tests pass a cutoff in the year 2000 and move only their own rows before it, so developer uploads in the shared database are never touched.
- `SweepOrphanFilesCommand(olderThan = now - 1 h)` removes files in `uploads/` (UUID names only) that have no `MeetingFile` row and were last modified before `olderThan` (`ORPHAN_GRACE_MS`). The row is created before tus writes the file, so such a file can never get a row. It also removes work directories in `derived/` older than that, except the one of the attempt a file is `PROCESSING` with (left by a job that crashed or could not clear them). A retry gets a new attempt and so a new directory, which the sweep never mistakes for the stale one. It covers data whose removal failed after its row was deleted (e.g. Windows `EBUSY` while a download still streams the file, a tus lock timeout on cancel) and files of meetings removed by a database cascade (user deletion).

Removal order everywhere (cancel, cleanup, delete, type mismatch): **row first, then data**, so a crash or a failed removal leaves an orphan file for the sweep, never a row without data. Every data removal is idempotent (missing files are fine) and retries briefly: `FilesStorageService.remove`, and `MeetingFileStore`, the `FileStore` subclass whose `remove` tus calls on cancel. Handlers that have already deleted the row call `FilesStorageService.removeQuietly`, which only logs a failure. Concurrent requests never turn a vanished row into a `500`: `PATCH` updates `lastChunkAt` with a conditional `updateMany` and `CompleteUploadCommand` answers `404` when the upload was cancelled meanwhile.

### Storage

`StorageModule` (`src/storage/`) owns the files on disk: `FilesStorageService` (paths, the tus `FileStore`, removal, listing for the sweep, free space) and `resolveFilesDir` (`storage.config.ts`). Modules that store uploads import it; Nest gives them one shared instance. `UserAvatar` (id = tus upload id = storage key, `UPLOADING` | `READY`, `mimeType`, `size`, `lastChunkAt`, cascade with the user) describes avatar uploads, whose data lives in `uploads/` like meeting files.

`FILES_DIR` (default `./storage`, relative to the working directory, i.e. `apps/api` for npm scripts; git-ignored) is resolved and created at startup and **never served statically** (do not add `ServeStaticModule`). Layout: `uploads/<storageKey>` (data, written in place by tus; `storageKey` = file id, never user input), `uploads/<storageKey>.json` (tus metadata) and `derived/<fileId>.<attempt>/` (a processing job's temporary files, e.g. a recording's extracted audio). Original name, MIME type, kind and size live only in the database. `MeetingFile.size` is `BigInt` (2 GiB overflows `integer`).

### Large upload check

`scripts/upload-check.mjs` uploads a file with `tus-js-client` (32 MiB chunks) to a running API, checks name/size/type in the list, downloads it through a signed link and compares SHA-256. It registers a throwaway `upload-check-<ts>@example.com` user unless `EMAIL` / `PASSWORD` are set; `API_URL` defaults to `http://localhost:4000`. A 2 GiB file takes about a minute locally.

### CQRS pattern (auth, users, meetings and meeting files)

Controllers hold no logic: they build a `Command` (writes) or `Query` (reads) and dispatch it through `CommandBus` / `QueryBus`. Each module has `commands/` and `queries/` with the message class, a `handlers/` folder and an `index.ts` exporting the handler array that the module lists in `providers`. Handlers use `PrismaService` directly (no service layer), except Auth handlers, which call Users through the buses. Modules do not import each other's handlers or Prisma models; they send the other module's exported messages (`CommandBus` / `QueryBus` are global thanks to `CqrsModule.forRoot()` in `AppModule`). Authorization of data is done in the handlers: `GetMeetingQuery` filters by owner or participant and checks the requested access (`view` / `manage`); other modules dispatch it instead of filtering themselves.

## Testing

Two kinds of tests, both on Vitest (`globals: true`, so `describe` / `it` / `vi` need no import):

| Kind | Files                | Config                 | Needs                                 | What it covers                                                                                                                                                                                                                                     |
| ---- | -------------------- | ---------------------- | ------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Unit | `src/**/*.spec.ts`   | `vitest.config.ts`     | nothing (Prisma and the buses mocked) | each CQRS handler in isolation (Auth, Users, Meetings, MeetingFiles), the file type allow-list, text extraction (fixtures), the Ollama adapter (mocked `fetch`), ffprobe / ffmpeg on generated recordings, child processes, whisper output parsing |
| e2e  | `test/*.e2e-spec.ts` | `vitest.config.e2e.ts` | the database, `.env`                  | the whole Nest app over HTTP with supertest: `/auth/*`, `/users/me`, `/meetings*` (incl. participants, access rules and document processing), `/uploads`, `/files/*`                                                                               |

### Running unit tests

No setup is needed:

```bash
npm run test --workspace=api                              # all unit tests (from the root; `npm run test` there runs the same)
npm run test:watch                                        # re-run on change (from apps/api)
npm run test:cov                                          # with coverage
npx vitest run src/users                                  # one folder
npx vitest run src/auth/queries/handlers/login.handler.spec.ts   # one file
npx vitest run -t "rejects a wrong password"              # one test by name
```

### Running e2e tests

e2e tests talk to the real PostgreSQL database, so prepare it once:

1. From the repository root: `npm run db:up` (PostgreSQL in Docker; wait for the healthcheck).
2. `cp apps/api/.env.example apps/api/.env` and fill in `DATABASE_URL`, `JWT_SECRET` and `FILE_LINK_SECRET` (`npm run gen:secret --workspace=api` prints one).
3. `npm run prisma:migrate --workspace=api` to apply the migrations.

Then run them (there is no root-level e2e script):

```bash
npm run test:e2e --workspace=api                          # all e2e suites (from the root)
npx vitest run --config ./vitest.config.e2e.ts test/auth.e2e-spec.ts   # one suite (from apps/api)
npx vitest run --config ./vitest.config.e2e.ts -t "POST /auth/login"   # one test by name
```

Suites run one after another (`fileParallelism: false`) because they share the database. Each suite uses unique e-mails (`<name>-<timestamp>@example.com`) and deletes the users it created in `afterAll`, so reruns do not collide and the data stays clean; a crashed run can leave a few `*-<timestamp>@example.com` rows behind. `meeting-files.e2e-spec.ts` and `meeting-participants.e2e-spec.ts` set `FILES_DIR` to a fresh temporary directory before the app is created and remove it in `afterAll`. `meeting-files.e2e-spec.ts` also checks that cancel, cleanup and delete leave nothing of a file in it; it listens on a real port (`app.listen(0)`) to cut a `PATCH` mid-stream for the resume tests. `meeting-file-processing.e2e-spec.ts` runs the real pg-boss worker inside the test app and polls `GET /meetings/:id/files/:fileId` until the status leaves `PROCESSING`; it steers the fake through `app.get<Summarizer, FakeSummarizer>(Summarizer)` (`behave('fail' | 'hang')`, `hold()` / `started()` / `finished()`, `reset()` after each test). `meeting-file-transcription.e2e-spec.ts` generates its recordings with `makeRecording` (real ffmpeg / ffprobe, fake transcriber and summarizer) and covers MP3 / MP4 to `READY` with transcript and summary, the limit, no sound, no speech, broken media, the hang timeout, retry, deletion during transcription and `Range` responses. `vitest.config.e2e.ts` sets `testTimeout: 30_000` (tests wait for jobs; a cold first ffmpeg start on Windows takes seconds), `MAX_RECORDING_MINUTES=1`, `TRANSCRIPTION_TIMEOUT_MARGIN_SECONDS=2`, `AI_PROVIDER=fake`, `PGBOSS_SCHEMA=pgboss_e2e` (a running dev server never picks up test jobs, and the other way round), `JOBS_POLLING_INTERVAL_SECONDS=0.5` and `DOCUMENT_PROCESSING_TIMEOUT_SECONDS=3` (the timeout cases). A tus request answered with an error before its body is read (`404`, `409`) closes the connection, so such requests send a small body (a large one fails with `ECONNRESET`).

### Before you finish a change

Run lint, type check, unit and e2e tests and make sure all are green; start from a green baseline and re-run after each step of a refactor:

```bash
npm run lint && npx tsc --noEmit && npm run test && npm run test:e2e
```

### Writing tests

- Handler unit tests construct the handler directly with mocks (`{ user: { create } } as unknown as PrismaService`, `{ execute } as unknown as CommandBus`) and assert on the message sent and the result; keep the file next to the handler as `<name>.handler.spec.ts`.
- Reset mocks in `beforeEach(() => { mock.mockReset(); })` with braces: returning the mock from the callback makes Vitest call it as a cleanup function.
- New HTTP behaviour gets an e2e case first (TDD, as in `test/meetings.e2e-spec.ts`). The e2e app must register the same global `ValidationPipe({ whitelist: true })` as `main.ts`, otherwise DTO validation does not return `400`.

## Environment

Copy `.env.example` to `apps/api/.env` (`DATABASE_URL`, `JWT_SECRET`, `JWT_EXPIRES_IN`, `FILES_DIR`, `FILE_LINK_SECRET`; optional `WEB_ORIGIN` for CORS, default `http://localhost:3000`, and `FILES_CLEANUP=off` to disable the scheduled storage maintenance). Processing: `AI_PROVIDER` (`fake` default, or `local`), `OLLAMA_URL` (default `http://localhost:11434`), `OLLAMA_MODEL` (required with `local`, the app refuses to start without it), `OLLAMA_NUM_CTX` (default 16384), optional `DOCUMENT_PROCESSING_TIMEOUT_SECONDS` (default 900), `PGBOSS_SCHEMA` (default `pgboss`) and `JOBS_POLLING_INTERVAL_SECONDS` (default 2). Recordings: `MAX_RECORDING_MINUTES` (default 180), `FFMPEG_PATH` / `FFPROBE_PATH` (default: the npm-installed binaries), and with `AI_PROVIDER=local` `WHISPER_CLI_PATH` (default `whisper-cli`), `WHISPER_MODELS_DIR` (default `./models`), `WHISPER_MODEL` (default `small.en`, file `ggml-<model>.bin`, must exist), `WHISPER_THREADS` (default 4), `WHISPER_SPEED_FACTOR` (default 1.5) and `TRANSCRIPTION_TIMEOUT_MARGIN_SECONDS` (default 300). Without `FILE_LINK_SECRET` the app refuses to start (`MeetingFilesModule.onModuleInit`). `main.ts` loads it through `dotenv/config`; e2e tests load it via `setupFiles` in `vitest.config.e2e.ts`. The generated client (`src/generated`) is git-ignored. e2e tests need the database (`npm run db:up`, then `npm run prisma:migrate`) and delete the users they create in `afterAll`.

## Documentation

Update this file when modules, routes or tooling of this app change.

## File upload

Use this research for it: @../../docs/research-meeting-upload.md

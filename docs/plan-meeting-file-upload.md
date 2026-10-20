# Plan: Meeting file upload, storage and processing

**PRD:** [prd-meeting-file-upload.md](prd-meeting-file-upload.md)
**Date**: 2026-10-17

## Open questions carried over from the PRD

- **AI processing** is decided: transcription and summarization run locally on the API server (whisper.cpp and a
  local LLM through Ollama, see [research-meeting-upload.md](research-meeting-upload.md)), so no meeting content
  leaves the server. They stay behind `Transcriber` / `Summarizer` interfaces with a fake implementation for tests.
- **Maximum recording length** is a configurable limit (`MAX_RECORDING_MINUTES`). The default is **180 minutes**
  (agreed in Phase 9), from the measured speed: whisper.cpp `small.en` transcribes in about 0.7 x the duration on
  the dev laptop's CPU, so the longest recording takes about 2 hours.

## Implementation phases

### Phase 1: API tracer bullet - resumable upload, list and download for the owner

**Goal:** The owner can upload a file of up to 2 GB to their meeting through a resumable upload protocol, see it in
the meeting's file list and download the original. Files live on local disk, outside any public path.
**Affects:** backend / database
**Tasks**

- [x] Prisma `MeetingFile` model (meeting `onDelete: Cascade`, original name, MIME type, size, uploaded by, upload
      time, status `UPLOADING | PROCESSING | READY | FAILED`, failure reason, storage key) and a migration; configurable
      storage directory (`FILES_DIR` in `apps/api/.env.example`), never served statically.
- [x] e2e tests first (`test/meeting-files.e2e-spec.ts`): chunked upload, resume from the reported offset, list,
      byte-for-byte download with the original name, `400` for a disallowed type, `413` for a declared size over 2 GB,
      `404` for a foreign meeting/file, `401` without a token.
- [x] `MeetingFilesModule` (CQRS): create an upload (validates the type allow-list and the 2 GB limit), report the
      received offset, append a chunk at an offset, complete the upload; until completion the file is `UPLOADING` and
      is not returned by the list. In this phase a completed file becomes `READY`.
- [x] `GET /meetings/:id/files` (completed files only) and download: a short-lived signed download URL issued to an
      authorised caller, streamed with `Content-Disposition` carrying the original file name (no permanent public URL).
- [x] Update `apps/api/CLAUDE.md` (module, routes, `FILES_DIR`).
      **Done when:** the new e2e suite and the existing suites are green, and a 2 GB video uploaded with a script
      appears in the list with the correct name, size and type and downloads identical to the original.

### Phase 2: UI tracer bullet - meeting page with upload and file list

**Goal:** From the home page the owner opens `/meetings/[id]`, uploads several files at once and downloads them.
**Affects:** frontend
**Tasks**

- [x] Meetings on the home page link to `/meetings/[id]`; the page shows title, date and the file list (name, type,
      size, upload date, status, download); `404` from the API shows "not found".
- [x] Upload area with file picker and drag-and-drop, several files at once, a progress bar per file, using the
      resumable protocol from Phase 1.
- [x] Client-side rejection before upload of disallowed types and files over 2 GB, with a message naming the reason.
- [x] Apply `ui-ux-pro-max`, check the page at phone width, visual check through Playwright MCP; update
      `apps/web/CLAUDE.md`.
      **Done when:** in the browser the owner opens a meeting from the home page, uploads several files via picker and
      drag-and-drop with per-file progress, sees them in the list and downloads one; a disallowed / too large file is
      rejected with a reason.

### Phase 3: API - cancel, abandoned upload cleanup and file deletion

**Goal:** Cancelled and abandoned uploads leave no data; the owner can delete a file.
**Affects:** backend
**Tasks**

- [x] e2e tests first: cancel removes the upload and its partial data, delete makes the file, its download link and
      its details return `404`, resume after an interrupted chunk continues from the stored offset.
- [x] Cancel an upload: removes the `UPLOADING` record and the partial data on disk.
- [x] Scheduled cleanup of uploads with no received part for 24 hours (record and partial data).
- [x] `DELETE /meetings/:id/files/:fileId`: removes the stored original and the record (later phases extend it to
      results); update `apps/api/CLAUDE.md`.
      **Done when:** e2e suites are green and the storage directory contains no leftovers after cancel, cleanup and
      delete.

### Phase 4: UI - cancel, retry after a network error and delete

**Goal:** The owner controls each upload and can delete files from the page.
**Affects:** frontend
**Tasks**

- [x] Cancel button per upload in progress; the cancelled file disappears from the list.
- [x] A network error shows an error on that file with "Retry", which resumes from the server offset without
      re-selecting the file (same page session).
- [x] Delete with a confirmation dialog.
- [x] `ui-ux-pro-max` + Playwright MCP visual check, including an offline/online cut mid-upload.
      **Done when:** in the browser cancel leaves nothing in the list, a cut-and-restored upload continues from where
      it stopped after "Retry", and a deleted file disappears from the list.

### Phase 5: API - participants and access rules

**Goal:** The owner shares a meeting with registered users; participants have read-only access, everyone else gets
`404`.
**Affects:** backend / database
**Tasks**

- [x] Prisma `MeetingParticipant` model (meeting and user, both `onDelete: Cascade`, unique pair) and a migration.
- [x] e2e tests first: add by e-mail; unknown e-mail, the owner's e-mail and an existing participant return an error
      and add nobody; the participant sees the meeting in `GET /meetings` marked as shared, can open it, list and
      download files, and does not see a file still `UPLOADING`; upload, cancel, delete and participant management by a
      participant return `403`; a removed participant and a stranger get `404` for the meeting, files and download
      links.
- [x] `POST /meetings/:id/participants` (`{ email }`, looks the user up through `FindUserByEmailQuery`),
      `GET /meetings/:id/participants`, `DELETE /meetings/:id/participants/:userId` - owner only.
- [x] Read handlers (meetings list/details, files list, download link) allow owner or participant; write handlers
      return `403` for a participant and `404` for a stranger; meeting responses carry the caller's role / shared flag.
- [x] Unit tests for the new handlers; update `apps/api/CLAUDE.md`.
      **Done when:** all e2e and unit suites are green, including the existing "foreign meeting gives 404" cases.

### Phase 6: UI - participants and read-only view

**Goal:** The owner manages participants on the meeting page; participants see shared meetings and a read-only page.
**Affects:** frontend
**Tasks**

- [x] Participants section on the meeting page: list, add by e-mail with the API error shown, remove.
- [x] Shared meetings appear in the home meetings list with a "Shared" mark.
- [x] For a participant, hide upload, cancel, delete and participant-management controls.
- [x] `ui-ux-pro-max` + Playwright MCP visual check with an owner and a participant account.
      **Done when:** the owner adds a participant, who sees the meeting marked as shared, opens it without any write
      controls and downloads a file; after removal the participant gets "not found".

### Phase 7: API - background processing of documents

**Goal:** Uploaded documents are summarized in the background; failures end in `FAILED` with a reason and can be
retried; images are `READY` right away.
**Affects:** backend / database
**Tasks**

- [x] Background processing that does not block requests: a completed document becomes `PROCESSING`, an image `READY`;
      every job has a timeout so an error or hang of the local model ends in `FAILED` with a short reason.
- [x] Text extraction for PDF, DOCX, PPTX and TXT; `Summarizer` interface with a fake for tests and a local Ollama
      adapter (URL, model and context size configured through env); summary stored in a migration-backed table.
- [x] File details route returns status, failure reason and summary; `POST /meetings/:id/files/:fileId/retry` (owner
      only, `FAILED` files only).
- [x] Deleting a file in `PROCESSING` removes it and its results, and the finishing job does not recreate them.
- [x] e2e tests first with the fake summarizer: success to `READY` with a summary, failure to `FAILED` with a reason,
      retry to `READY`, delete during processing, participant `403` on retry; update `apps/api/CLAUDE.md`.
      **Done when:** the e2e suites are green and a real PDF, DOCX, PPTX and TXT reach `READY` with a summary through the
      local Ollama model.

### Phase 8: UI - live statuses, document summaries and previews

**Goal:** The page shows statuses live, document summaries, PDF/image previews and retry of failed files.
**Affects:** frontend
**Tasks**

- [x] Statuses update without a manual reload (polling while any file is `PROCESSING`); `UPLOADING` is shown only to
      the uploading owner.
- [x] `FAILED` shows the reason and, for the owner, a "Retry" button.
- [x] Summary for processed documents; inline preview for PDF and PNG/JPEG through the short-lived signed URL.
- [x] `ui-ux-pro-max` + Playwright MCP visual check.
      **Done when:** an uploaded PDF goes from Processing to Ready on screen without reload and shows a summary and a
      preview, an image previews right away, and a failed file can be retried to Ready.

### Phase 9: API - transcription of audio and video

**Goal:** Recordings get an English transcript with timestamps and a summary; playback streams under the same access
rules.
**Affects:** backend / database
**Tasks**

- [x] Duration check with the configurable `MAX_RECORDING_MINUTES`; a longer recording ends in `FAILED` with a reason
      naming the limit.
- [x] `Transcriber` interface with a fake for tests and a local whisper.cpp adapter (`whisper-cli` run as a child
      process, one recording at a time, timeout derived from the duration); audio track extracted with `ffmpeg`;
      transcript segments with timestamps stored, then summarized with `Summarizer`.
- [x] File details return the transcript segments and summary; deletion removes them too.
- [x] Signed media URL supports HTTP `Range` requests so the browser player can seek and stream.
- [x] e2e tests first with fakes: MP3 and MP4 to `READY` with transcript and summary, over-limit to `FAILED`, transcriber
      failure to `FAILED` then retry to `READY`, `Range` responses; update `apps/api/CLAUDE.md`.
      **Done when:** the e2e suites are green and a real MP3 and MP4 reach `READY` with an English transcript and a
      summary through the local whisper.cpp and Ollama models.

### Phase 10: UI - player and transcript

**Goal:** Recordings are played on the meeting page next to their transcript and summary.
**Affects:** frontend
**Tasks**

- [ ] Built-in audio and video player using the signed streaming URL.
- [ ] Transcript with timestamps and the summary for each processed recording.
- [ ] `ui-ux-pro-max` + Playwright MCP visual check (owner and participant, phone width).
- [ ] Final check from the repository root: lint, type check, unit and e2e tests green.
      **Done when:** an uploaded MP3 and MP4 move from Processing to Ready without reload and the page shows a working
      player, the transcript with timestamps and the summary, for both the owner and a participant.

## Acceptance criteria coverage

| Acceptance criterion                                                    | Phase   |
| ----------------------------------------------------------------------- | ------- |
| Meeting opens from the home list with title, date, participants, files  | 2, 6    |
| Several files via picker and drag-and-drop, per-file progress           | 2       |
| Over 2 GB / disallowed type rejected in UI and by the API (`400`/`413`) | 1, 2    |
| A 2 GB video uploads with the correct name, size and type               | 1       |
| Cancel leaves no file and no partial data                               | 3, 4    |
| Participant does not see a file still uploading                         | 5       |
| Retry after a network cut continues the upload                          | 3, 4    |
| MP3/MP4 to Ready without reload, player, transcript, summary            | 9, 10   |
| Documents reach Ready with a summary; PDF and image preview             | 7, 8    |
| Failed with a reason, never stuck in Processing, Retry to Ready         | 7, 8, 9 |
| Download is byte-for-byte with the original name                        | 1       |
| Deleted file disappears for everyone; its links and results give `404`  | 3, 4, 7 |
| Deleting during Processing does not bring the file back                 | 7       |
| Add participant by e-mail, shared mark, error cases                     | 5, 6    |
| Participant is read-only, no write controls, API `403`                  | 5, 6    |
| Removed participant gets `404`                                          | 5, 6    |
| Stranger gets `404`, no token gets `401`                                | 1, 5    |
| E2E coverage; lint, type check, unit and e2e green                      | 1-10    |

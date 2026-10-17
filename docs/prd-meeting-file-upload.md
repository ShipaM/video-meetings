# PRD: Meeting file upload, storage and processing

**Date**: 2026-10-17
**Status**: Draft

## Goal

Let the meeting owner attach files to a meeting (audio/video recordings and documents), store them, and get an
English transcript and summary for recordings and a summary for documents. Everything is viewable on the meeting
page, so the owner and the people they share the meeting with have the meeting's content and outcomes in one place.

## User scenarios

- The owner opens a meeting from the meetings list on the home page -> sees the meeting page (`/meetings/[id]`) with its title, date,
  participants and files.
- The owner selects or drags one or more files onto the upload area -> each file shows its own upload progress and,
  once uploaded, appears in the file list.
- The owner uploads a file of a type that is not allowed or larger than 2 GB -> the file is rejected before the upload
  starts, with a message naming the reason.
- The owner cancels an upload in progress -> the upload stops and the file does not appear in the list.
- The upload is interrupted by a network error -> the owner sees an error for that file and can retry it without
  re-selecting it.
- The owner uploads an audio or video recording -> the file goes through "Processing" and then becomes "Ready"; the
  meeting page shows a player, the transcript with timestamps and a summary.
- The owner uploads a PDF, DOCX, PPTX or TXT document -> after processing, the meeting page shows a summary of the
  document; a PDF can also be previewed on the page.
- The owner uploads a PNG or JPEG image -> it becomes "Ready" right away and can be previewed on the page.
- Processing of a file fails -> the file shows the "Failed" status with a short reason; the owner can start
  processing again.
- The owner downloads a file -> the original file is downloaded with its original name.
- The owner deletes a file -> after confirmation, the file, its transcript and its summary disappear for everyone,
  even if the file was still processing.
- The owner adds a participant by e-mail -> the registered user with that e-mail becomes a participant; an unknown
  e-mail gives an error and nobody is added. Adding the owner or an existing participant again gives an error too.
- The owner removes a participant -> that user loses access to the meeting and its files.
- A participant opens their meetings list -> sees the meetings shared with them, marked as shared, next to their own.
- A participant opens a shared meeting -> can view, play, preview and download files and read transcripts and
  summaries, but has no controls to upload or delete files or manage participants.
- A user who is neither the owner nor a participant opens the meeting page or a file link -> gets "not found".

## In scope

- Meeting page `/meetings/[id]` in the web app (title, date, participants, files), reachable from the meetings list
  on the home page.
- Meeting participants: the owner adds registered users by e-mail, sees the participant list and removes participants.
  Shared meetings appear in the participant's meetings list.
- Access rules:
  - The owner can view, upload, download and delete files and manage participants.
  - A participant can view and download only.
  - Everyone else gets "not found", for both the meeting and its files.
- File upload from the meeting page:
  - file picker and drag-and-drop, several files at once;
  - per-file progress, cancel and retry;
  - files up to 2 GB each, no limit on the number of files per meeting;
  - the upload survives a temporary network interruption without starting over from zero (within the same page
    session; after a page reload the file has to be selected again);
  - an upload that is cancelled or never completed leaves nothing behind: its partial data is removed (abandoned
    uploads at the latest 24 hours after the last received part).
- Allowed file types:
  - audio: MP3, M4A, WAV, WEBM (audio);
  - video: MP4, WEBM, MOV;
  - documents: PDF, DOCX, PPTX, TXT;
  - images: PNG, JPEG.
- Persistent storage of the original files and their metadata (original name, type, size, uploaded by, upload time).
- File list on the meeting page: name, type, size, upload date, status, download and delete (delete for the owner
  only).
- File statuses: Uploading, Processing, Ready, Failed. Uploading is shown only to the owner who is uploading; other
  viewers see a file only once its upload is complete. For files that are not processed (images), the status is Ready
  right after upload. Statuses update on the page without a manual reload.
- Processing:
  - audio/video: English transcript with timestamps plus a summary;
  - documents (PDF, DOCX, PPTX, TXT): extract the text and summarize it;
  - images: no processing;
  - the owner can restart processing of a Failed file.
- Display on the meeting page:
  - built-in player for audio and video;
  - inline preview for PDF and images;
  - transcript and summary for each processed file.
- Deleting a file removes the stored original, its transcript and its summary; a file still in Processing is deleted
  too and its result is discarded.

## Out of scope

- Deleting meetings (the API has no such operation yet). When it is added, it must remove all the meeting's files and
  processing results; see Technical constraints.
- Recording a live call in the browser (there are no calls in the product yet). Only files uploaded by the user are
  handled.
- Languages other than English for transcription and summaries. The result for non-English recordings is not
  guaranteed.
- One combined summary across all files of a meeting.
- Speaker identification (diarization), editing transcripts or summaries, and click-a-timestamp-to-seek in the player.
- Inline preview of DOCX and PPTX (download only).
- Uploading or deleting files by participants, participant roles beyond "viewer", and inviting people who are not
  registered (including e-mail invitations and notifications).
- Public or anonymous share links.
- Storage quotas, billing, antivirus scanning and file versioning.
- Search across transcripts and summaries.
- Changes to the mobile layout beyond the meeting page staying usable at phone width.

## Technical constraints

- Files are stored on the API server's local disk. No S3 or other object storage is set up. The storage location
  must be configurable, must not be served publicly, and must have enough free space for 2 GB files and their
  partial uploads.
- Files up to 2 GB cannot go through a single regular JSON request. The upload must support large bodies, progress and
  resuming after an interruption.
- Transcription and summarization take time (minutes for long recordings) and depend on external AI services. They
  must run in the background without blocking the API, and an external failure must end in the Failed status, not a
  hung Processing.
- The AI provider(s) for transcription and summarization are **not chosen yet** (open question). Meeting recordings
  and documents are sent to that provider, so its data retention and training terms must be acceptable for private
  meeting content.
- The maximum recording length that is transcribed is **not decided yet** (open question). A 2 GB video can last
  several hours; longer recordings than the chosen limit must end in Failed with a reason that names the limit.
- `Meeting` rows are deleted by a database cascade when their owner `User` is deleted. Any future meeting or account
  deletion must also remove the stored files, so stored files never outlive their meeting.
- Today `Meeting` belongs to a single owner, and all meeting routes return `404` for other users (filtering by
  `ownerId`). Participants change this rule for read access; the existing "foreign meeting gives 404" behaviour must
  stay for non-participants.
- Authentication is a JWT bearer token kept in `localStorage`. File download and media playback in the browser must
  work under the same access rules, without exposing files through permanent public URLs.
- Existing API conventions apply: NestJS feature module with CQRS commands/queries, Prisma migrations, a
  `ValidationPipe`, and e2e tests written first for new HTTP behaviour.
- Web UI changes must go through the `ui-ux-pro-max` skill and a visual check with Playwright MCP (see
  `apps/web/CLAUDE.md`).
- The repository and all generated UI text are English-only.

## Acceptance criteria

- [ ] Clicking a meeting in the meetings list on the home page opens `/meetings/[id]` with its title, date, participants and file list.
- [ ] The owner can upload several files at once via the file picker and via drag-and-drop. Each file shows its own
      progress bar.
- [ ] A file larger than 2 GB, or of a type outside the allowed list, is rejected before upload with a message naming
      the reason. The API also rejects such files when called directly (`400` / `413`).
- [ ] A 2 GB video file uploads successfully and appears in the list with the correct name, size and type.
- [ ] Cancelling an upload removes it from the list and leaves no file on the meeting and no partial data in storage.
- [ ] While the owner is uploading a file, a participant does not see it; it appears for the participant once the
      upload completes.
- [ ] After the network is cut mid-upload and restored, retrying continues the upload and does not start over from
      zero.
- [ ] An uploaded MP3 or MP4 moves from Processing to Ready without a page reload. The page then shows a working
      player, an English transcript with timestamps and a summary.
- [ ] An uploaded PDF, DOCX, PPTX or TXT reaches Ready and shows a summary. A PDF and a PNG/JPEG can be previewed on
      the page.
- [ ] When processing fails (for example, the AI service is unavailable), the file shows Failed with a reason, never
      stays in Processing indefinitely, and the owner's "Retry" brings it to Ready once the service is back.
- [ ] Download returns the original file, byte for byte, with its original file name.
- [ ] After the owner deletes a file, it disappears from the list for the owner and for participants. Its download
      link and its transcript/summary then return `404`.
- [ ] Deleting a file while it is in Processing removes it; it does not reappear when processing finishes.
- [ ] The owner can add a registered user by e-mail. That user then sees the meeting in their list marked as shared
      and can open it. An unregistered e-mail, the owner's own e-mail or an existing participant's e-mail returns an
      error and adds nobody.
- [ ] A participant can view, play, preview and download files and read transcripts and summaries. The participant
      sees no upload, delete or participant-management controls, and the API answers such requests from them with
      `403`.
- [ ] After the owner removes a participant, that user gets `404` for the meeting, its files and their download
      links.
- [ ] A user who is neither the owner nor a participant gets `404` for the meeting, every file and every download
      link. A request without a token gets `401`.
- [ ] E2E tests cover upload, list, download, delete, participant access and access denial. Lint, type check, unit
      tests and e2e tests are green.

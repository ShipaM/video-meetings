# PRD: Recording transcription stages and a lighter default Whisper model

**Date**: 2026-10-30
**Status**: Draft

## Goal

Show which stage an uploaded recording has reached instead of one general "Processing" status, so that people know
whether a file is waiting or working during processing that can take hours. Make the lighter `base.en` the default
Whisper model, so that transcripts arrive sooner.

Transcription itself already exists and stays as it is, see [prd-meeting-file-upload.md](prd-meeting-file-upload.md):
recordings are transcribed locally after upload, and the file list shows `Processing`, `Ready` or `Failed`.

## User scenarios

- The owner uploads an MP3 or MP4 while another recording is being processed -> the new file shows "Waiting in queue"
  until its turn comes.
- The owner or a participant has the meeting page open during processing -> the stage changes without a page reload:
  "Preparing audio", then "Transcribing", then "Summarizing", then the final `Ready` status.
- The owner reloads the page or opens it on another device during processing -> the file shows its current stage, not
  the first one.
- Processing fails -> the file shows `Failed` with the existing reason, and the owner can use Retry as today.
- The owner retries a recording whose transcript is already stored and only the summary failed -> the file goes to
  "Summarizing" without passing through "Preparing audio" and "Transcribing" again.
- A new recording is processed on a default configuration -> `base.en` transcribes it.

## In scope

- Four stages for recordings in `Processing`: **Waiting in queue**, **Preparing audio**, **Transcribing**,
  **Summarizing**.
- All recording kinds that are processed today get the stages: audio (MP3, M4A, WAV, WebM) and video (MP4, WebM, MOV).
- The current stage is stored on the server and returned with the file, so the owner and participants see the same
  stage, including after a reload.
- The file list shows the stage instead of the current "Transcribing the recording, which can take a while." text.
- A recording that is waiting for Retry to be picked up shows "Waiting in queue".
- `base.en` becomes the default value of `WHISPER_MODEL`, and `apps/api/.env.example` and the setup instructions are
  updated to match. The model stays configurable.

## Out of scope

- A percentage, a progress bar or a remaining-time estimate.
- Languages other than English: transcription stays English-only, as in the existing PRD.
- Stages for documents and images: they keep their current status text.
- Choosing a model per file or per meeting, or in the UI.
- Re-transcribing existing recordings with the new model: finished transcripts stay as they are.
- Changing the upload flow, the transcript view, the summary or the existing failure reasons.
- Pushing updates to the browser: the existing refresh of the file list while a file is processing stays.

## Technical constraints

- Transcription stays local: no meeting content leaves the server.
- Recordings are processed one at a time, so "Waiting in queue" can last as long as the recordings ahead of it.
- On the dev laptop (4-core CPU, 49 s of speech), `base.en` took 0.25 x the duration and misheard one name, and
  `small.en` took 0.7 x with no mistakes. The new default accepts this accuracy loss for speed.
- `base.en` is less accurate, so it is a one-line configuration change to go back to `small.en`.
- With `AI_PROVIDER=local` the API refuses to start without the configured model file. An environment without
  `ggml-base.en.bin` must download it, or set `WHISPER_MODEL` explicitly.
- An existing `.env` that sets `WHISPER_MODEL=small.en` keeps using `small.en` until it is changed.
- The stage is refreshed by the existing 3-second file list refresh, which stops while the tab is hidden.
- Files already in `PROCESSING` at deployment must still show a valid status and finish normally.

## Acceptance criteria

- [ ] A recording in `PROCESSING` returns one of the four stages from the file list and file details endpoints.
- [ ] A recording uploaded while another one is being processed shows "Waiting in queue" until its processing starts.
- [ ] With the page left open, one recording shows "Preparing audio", "Transcribing" and "Summarizing" in that order
      and then `Ready`, with no reload.
- [ ] Reloading the page during processing shows the current stage.
- [ ] The owner and a participant see the same stage for the same file.
- [ ] A recording that fails at any stage shows `Failed` with its reason and no stage, and the owner can retry it.
- [ ] After Retry the file shows "Waiting in queue" and then goes through the stages again.
- [ ] Retrying a recording with a stored transcript skips "Preparing audio" and "Transcribing".
- [ ] Documents and images in `PROCESSING` show the same text as before this change.
- [ ] A recording that was in `PROCESSING` before the deployment still shows a valid status and reaches `Ready` or
      `Failed`.
- [ ] Without `WHISPER_MODEL` set, the API uses `ggml-base.en.bin`, and it refuses to start with
      `AI_PROVIDER=local` if the file is missing.
- [ ] With `WHISPER_MODEL=small.en` set, the API still uses `small.en`.
- [ ] An MP3 and an MP4 with English speech, processed with `AI_PROVIDER=local` and `base.en`, both reach `Ready` with
      a timestamped transcript and a summary.
- [ ] `apps/api/.env.example` and `apps/api/CLAUDE.md` name `base.en` as the default.

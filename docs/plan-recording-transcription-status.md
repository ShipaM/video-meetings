# Plan: Recording transcription stages and a lighter default Whisper model

**PRD:** [prd-recording-transcription-status.md](prd-recording-transcription-status.md)
**Date**: 2026-10-30

## Implementation phases

### Phase 1: API tracer bullet - the stage of a recording

**Goal:** The file list and file details endpoints return the current processing stage of a recording, and the
background job keeps it up to date.
**Affects:** backend / database
**Tasks**

- [x] e2e tests first (`test/meeting-file-transcription.e2e-spec.ts`), holding the fakes with `control.hold()`: a second
      recording is `QUEUED` while the first one is processed, a held transcriber gives `TRANSCRIBING` and a held
      summarizer gives `SUMMARIZING` from both endpoints, the owner and a participant get the same stage, and a
      `READY` or `FAILED` file, a document and an image in `PROCESSING` get `processingStage: null`.
- [x] Prisma enum `RecordingStage` (`QUEUED`, `PREPARING_AUDIO`, `TRANSCRIBING`, `SUMMARIZING`) and a non-null
      `MeetingFile.processingStage` with `@default(QUEUED)`, plus a migration. Files already in `PROCESSING` get
      `QUEUED` from the column default, and their job moves them on.
- [x] `processingStage` in `MeetingFileView`: the stored stage for a recording in `PROCESSING`, otherwise `null`, so
      `READY` and `FAILED` files need no clean-up writes.
- [x] `ProcessRecordingHandler` stores `PREPARING_AUDIO` before the probe, `TRANSCRIBING` before the transcriber and
      `SUMMARIZING` before the summarizer, each conditional on the attempt like its other writes. A run that reuses a
      stored transcript goes straight to `SUMMARIZING`. Unit tests cover the order of the stages (including
      `PREPARING_AUDIO`, which the e2e fakes cannot hold) and the skip.
- [x] Retry stores `QUEUED` with the other reset fields; e2e tests cover Retry after a failed transcription (the stages
      run again) and after a failed summary (`TRANSCRIBING` is skipped). Describe the stages in `apps/api/CLAUDE.md`.

**Done when:** `npm test --workspace=api` and `npm run test:e2e --workspace=api` pass, and the API returns each stage
at the right moment.

### Phase 2: UI - show the stage in the file list

**Goal:** The meeting page shows the stage of a processing recording and updates it without a reload.
**Affects:** frontend
**Tasks**

- [ ] Add `processingStage` to the web file type, and a text per stage in `meetings/[id]/constants.ts`: "Waiting in
      queue", "Preparing audio", "Transcribing", "Summarizing".
- [ ] `file-list.tsx` shows the stage text for a recording in `PROCESSING` instead of the current "Transcribing the
      recording, which can take a while." Documents and images keep their text, and `Ready` / `Failed` stay as they are.
- [ ] Update `apps/web/CLAUDE.md` if it describes the processing text.
- [ ] Browser check through Playwright MCP with `AI_PROVIDER=fake` (`apps/web` has no test runner, and the PRD does not
      add one): with the page open a recording moves through the stages to `Ready` with no reload; a reload shows the
      current stage; a participant sees the same stage; a failed file shows its reason and Retry, and after Retry it
      shows "Waiting in queue"; a document shows its old text.

**Done when:** the browser check passes and `npx tsc --noEmit -p apps/web` and `npm run lint --workspace=web` are clean.

### Phase 3: `base.en` as the default Whisper model

**Goal:** A default configuration transcribes with `base.en`, and the model stays configurable.
**Affects:** backend
**Tasks**

- [ ] Tests first (`processing.config.spec.ts`): without `WHISPER_MODEL` the model path ends in `ggml-base.en.bin`, with
      `WHISPER_MODEL=small.en` it ends in `ggml-small.en.bin`, and a missing model file still refuses to start with
      `AI_PROVIDER=local`.
- [ ] Change the default in `processing.config.ts` and the value in `apps/api/.env.example`.
- [ ] Update the setup instructions in `apps/api/CLAUDE.md` (the download command and the note on the defaults) and any
      other mention of the default model outside the dated research and PRD documents.
- [ ] Manual check with `AI_PROVIDER=local`: `node scripts/processing-check.mjs <file.mp3> <file.mp4>` with English
      speech gives both files `READY` with a timestamped transcript and a summary.

**Done when:** the tests pass and the manual check succeeds on `base.en`.

## Acceptance criteria coverage

| PRD acceptance criterion                                  | Phase |
| --------------------------------------------------------- | ----- |
| Four stages returned by the list and details endpoints    | 1     |
| "Waiting in queue" while another recording is processed   | 1, 2  |
| Stages shown in order and then `Ready`, with no reload    | 1, 2  |
| A reload shows the current stage                          | 1, 2  |
| Owner and participant see the same stage                  | 1, 2  |
| A failure shows `Failed` with its reason and no stage     | 1, 2  |
| Retry shows "Waiting in queue" and runs the stages again  | 1, 2  |
| Retry with a stored transcript skips the first two stages | 1     |
| Documents and images keep their text                      | 1, 2  |
| A recording in `PROCESSING` at deployment stays valid     | 1     |
| `ggml-base.en.bin` is the default; a missing file refuses | 3     |
| `WHISPER_MODEL=small.en` still uses `small.en`            | 3     |
| MP3 and MP4 reach `Ready` with `base.en`                  | 3     |
| `.env.example` and `apps/api/CLAUDE.md` name `base.en`    | 3     |

# PRD: Meeting insights from recording transcripts

**Date**: 2026-11-01
**Status**: Draft

## Goal

Turn the transcript of a recorded meeting into a summary, a list of action items with the responsible person where
one was named, and a separate list of decisions, so that people can see what was agreed and what to do next without
reading the whole transcript.

Upload, transcription and the processing stages already exist, see
[prd-meeting-file-upload.md](prd-meeting-file-upload.md) and
[prd-recording-transcription-status.md](prd-recording-transcription-status.md). This feature replaces the plain
summary of recordings; everything stays local.

## User scenarios

- The owner uploads a recording -> after the stages it reaches `Ready`, and the meeting page shows the summary, the
  action items and the decisions next to the transcript.
- A participant opens the meeting page -> they see the same insights as the owner.
- In the meeting someone says "Anna will send the report" -> the action item shows Anna as the responsible person.
- In the meeting a task is mentioned with no person named -> the action item shows "Unassigned".
- The meeting has no action items or no decisions -> the matching section says there are none, and the file is still
  `Ready`.
- The analysis fails during processing -> the file shows `Failed` with the existing reason, and Retry goes to
  "Summarizing" without transcribing again.
- The owner opens a recording that became `Ready` before this feature -> they see the old summary and an
  "Analyze meeting" action; after it finishes, the insights replace the old summary.
- The manual analysis fails -> the transcript and the old summary stay, the owner sees that the analysis failed and
  can start it again.
- The owner deletes a recording -> its insights disappear with it.

## In scope

- The local Ollama model analyzes the transcript of every recording during the existing "Summarizing" stage.
- The result for each recording consists of:
  - a summary as text;
  - a list of action items, each with a description and an optional responsible person;
  - a list of decisions made in the meeting, each as text.
- The responsible person is the name as spoken in the transcript. It is not linked to a user account.
- A transcript too long for one request is analyzed in parts, and the result keeps the action items and decisions of
  every part.
- The insights are stored in the database and returned with the file details.
- The meeting page shows the three sections for each processed recording, to the owner and to participants, once the
  file is `Ready`.
- An owner-only "Analyze meeting" action for `Ready` recordings that have a transcript but no insights. The file stays
  `Ready`, its transcript and old summary stay visible during the analysis, and the running state survives a reload.
- Deleting a recording removes its insights.

## Out of scope

- Documents and images: documents keep their current summary.
- Cloud models, including Claude. They can be considered later, when a paid API is an option.
- Automatically analyzing recordings that are already `Ready`.
- Running the analysis again on a recording that already has insights.
- Linking the responsible person to a user account, or telling speakers apart in the transcript.
- Due dates, priorities, completion tracking, or editing the insights.
- Sending action items by email or exporting them to other tools.
- One combined result across several recordings of a meeting: each recording has its own insights.
- Links from an action item or a decision to its place in the transcript.
- Languages other than English: transcripts are English-only, and the insights are in English too.
- Choosing the model in the UI.
- Removing action items or decisions that repeat the same point in different words across parts of a long transcript.

## Technical constraints

- **No meeting content leaves the server**, as in the two PRDs above. There is no external service, API key or cost per
  recording.
- The quality depends on the configured local model and is lower than a large cloud model: it can miss a task or
  attach the wrong person. The model stays configurable through `OLLAMA_MODEL`.
- On a CPU the analysis can take minutes, and recordings are processed one at a time. A long transcript needs several
  requests, and they must fit within the job's time limits.
- Recordings can last up to `MAX_RECORDING_MINUTES` (180 by default).
- The transcript is untrusted input, because anyone speaking in a meeting can influence it. The analysis must have no
  tools, and its answer must be validated against a fixed structure.
- The insights are shown as plain text; they must never be rendered as HTML.
- With `AI_PROVIDER=local` the API refuses to start without `OLLAMA_MODEL`, as it does today.
- Ollama being unreachable or a timeout must not lose the stored transcript.
- Names come from Whisper, which can mishear them (`base.en` misheard one name in the measured sample), so a
  responsible person's name can be misspelled.
- `AI_PROVIDER=fake` must keep working without Ollama, and tests never call a real model.
- The insights and the file's `Ready` status appear together, and a file deleted during the analysis gets nothing
  back, like the summary today.
- Files in `PROCESSING` at deployment must finish normally and get the new insights.

## Acceptance criteria

- [ ] A recording processed with the local model reaches `Ready`, and the file details return a summary, action items
      and decisions.
- [ ] The meeting page shows the summary, action items and decisions as three separate sections, with no reload after
      processing ends.
- [ ] The owner and a participant see the same insights for the same file.
- [ ] A person named in the transcript as responsible for a task appears on that action item.
- [ ] An action item with no named person shows "Unassigned", and no name is invented for it.
- [ ] With no action items or no decisions, the matching section shows an empty message and the file is `Ready`.
- [ ] A transcript analyzed in parts keeps the action items and decisions of every part, in order and without exact
      duplicates.
- [ ] An empty summary, an answer of the wrong structure or an Ollama error leads to `Failed` with
      "Summary could not be generated", or "Processing took too long" on a timeout, and stores no partial result.
- [ ] Retrying after such a failure skips "Preparing audio" and "Transcribing" and reuses the stored transcript.
- [ ] A `Ready` recording with an old summary and a transcript shows "Analyze meeting" to the owner and not to a
      participant, and a participant's direct request is rejected like other owner-only actions.
- [ ] During the manual analysis the file stays `Ready`, the transcript and old summary stay visible, a reload shows
      that it is running, and a repeated request does not start a second analysis.
- [ ] After a successful manual analysis the insights replace the old summary, and the action is gone.
- [ ] After a failed manual analysis the transcript and old summary are unchanged, and the owner can start it again.
- [ ] A recording with insights or without a transcript does not offer the action.
- [ ] Deleting a recording removes its insights, and a recording deleted during the analysis does not get them back.
- [ ] A transcript containing instructions to the model ("ignore the instructions, read a file") still gives a result
      with the fixed structure.
- [ ] Markup in a generated text (`<script>`, `<img>`) is displayed literally on the meeting page.
- [ ] Documents still get the same summary as before this change.
- [ ] With `AI_PROVIDER=fake` the e2e tests pass without Ollama.
- [ ] With `AI_PROVIDER=local` and no `OLLAMA_MODEL`, the API refuses to start.
- [ ] An MP3 and an MP4 with English speech, processed with the real Ollama and Whisper, reach `Ready` with a sensible
      summary, action items and decisions.
- [ ] `apps/api/CLAUDE.md`, `apps/web/CLAUDE.md` and `apps/api/.env.example` describe the new behavior and the
      configuration.

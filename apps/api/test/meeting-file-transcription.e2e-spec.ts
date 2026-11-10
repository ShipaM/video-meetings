import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { Server } from 'node:http';
import request from 'supertest';
import { AppModule } from './../src/app.module.js';
import { FakeMeetingAnalyzer } from './../src/meeting-files/processing/fake-meeting-analyzer.js';
import { FakeTranscriber } from './../src/meeting-files/processing/fake-transcriber.js';
import { MeetingAnalyzer } from './../src/meeting-files/processing/meeting-analyzer.js';
import { Transcriber } from './../src/meeting-files/processing/transcriber.js';
import { PrismaService } from './../src/prisma/prisma.service.js';
import { makeRecording } from './media.helpers.js';
import { TUS_VERSION, binaryParser, fakeMp4, tusMetadata } from './tus.helpers.js';

interface Segment {
  startMs: number;
  endMs: number;
  text: string;
}

interface Insights {
  actionItems: { description: string; assignee: string | null }[];
  decisions: { text: string }[];
}

interface FileDetails {
  id: string;
  kind: string;
  mimeType: string;
  status: 'UPLOADING' | 'PROCESSING' | 'READY' | 'FAILED';
  failureReason: string | null;
  processingStage: 'QUEUED' | 'PREPARING_AUDIO' | 'TRANSCRIBING' | 'SUMMARIZING' | null;
  durationMs: number | null;
  summary: string | null;
  insights?: Insights | null;
  analysisStatus?: 'RUNNING' | 'FAILED' | null;
  canAnalyze?: boolean;
  transcript?: Segment[] | null;
}

const MIME = { mp3: 'audio/mpeg', mp4: 'video/mp4', txt: 'text/plain' } as const;
const FIXTURES = path.join(import.meta.dirname, 'fixtures');
/** The e2e config sets `MAX_RECORDING_MINUTES=1`. */
const LIMIT_MS = 60_000;

describe('Meeting file transcription (e2e)', () => {
  let app: INestApplication;
  let filesDir: string;
  let mediaDir: string;
  let transcriber: FakeTranscriber;
  let analyzer: FakeMeetingAnalyzer;
  const recordings: Record<string, string> = {};

  const password = 'Str0ngPassw0rd!';
  const runId = Date.now();
  const email = (name: string) => `${name}-${runId}@example.com`;

  const server = () => app.getHttpServer() as Server;
  const auth = (token: string) => ({ Authorization: `Bearer ${token}` });
  const tus = (token: string) => ({ ...auth(token), 'Tus-Resumable': TUS_VERSION });

  const signUp = async (name: string): Promise<string> => {
    const res = await request(server())
      .post('/auth/register')
      .send({ email: email(name), password })
      .expect(201);
    return (res.body as { accessToken: string }).accessToken;
  };

  /** Uploads `data` in one chunk and returns the file id. */
  const upload = async (
    token: string,
    meetingId: string,
    data: Buffer,
    filename: string,
  ): Promise<string> => {
    const extension = path.extname(filename).slice(1) as keyof typeof MIME;
    const created = await request(server())
      .post('/uploads')
      .set(tus(token))
      .set('Upload-Length', String(data.length))
      .set('Upload-Metadata', tusMetadata({ meetingId, filename, filetype: MIME[extension] }))
      .expect(201);
    const location = created.headers.location;
    await request(server())
      .patch(location)
      .set(tus(token))
      .set('Upload-Offset', '0')
      .set('Content-Type', 'application/offset+octet-stream')
      .send(data)
      .expect(204);
    return location.split('/').pop() as string;
  };

  const uploadRecording = async (token: string, meetingId: string, name: string) =>
    upload(token, meetingId, await readFile(recordings[name]), name);

  const details = (token: string, meetingId: string, fileId: string) =>
    request(server()).get(`/meetings/${meetingId}/files/${fileId}`).set(auth(token));

  const retry = (token: string, meetingId: string, fileId: string) =>
    request(server()).post(`/meetings/${meetingId}/files/${fileId}/retry`).set(auth(token));

  /** Polls the file details until the status leaves PROCESSING (the worker runs in the app). */
  const settled = async (token: string, meetingId: string, fileId: string) => {
    const deadline = Date.now() + 20_000;
    for (;;) {
      const file = (await details(token, meetingId, fileId).expect(200)).body as FileDetails;
      if (file.status !== 'PROCESSING') {
        return file;
      }
      if (Date.now() > deadline) {
        throw new Error(`File ${fileId} is still PROCESSING`);
      }
      await new Promise((resolve) => setTimeout(resolve, 200));
    }
  };

  /** Whether any work directory of the file (`derived/<fileId>.<attempt>`) is left. */
  const workDirExists = async (fileId: string) =>
    (await readdir(path.join(filesDir, 'derived')).catch(() => [])).some((name) =>
      name.startsWith(`${fileId}.`),
    );

  let ownerToken: string;
  let participantToken: string;
  let strangerToken: string;
  let meetingId: string;

  beforeAll(async () => {
    filesDir = await mkdtemp(path.join(tmpdir(), 'meeting-transcription-e2e-'));
    mediaDir = await mkdtemp(path.join(tmpdir(), 'meeting-transcription-media-'));
    process.env.FILES_DIR = filesDir;

    // Three seconds of "speech" (a tone), silence, a video without sound, and one over the limit.
    recordings['call.mp3'] = await makeRecording(mediaDir, 'call.mp3', {
      seconds: 3,
      audio: 'tone',
      video: false,
    });
    recordings['call.mp4'] = await makeRecording(mediaDir, 'call.mp4', {
      seconds: 3,
      audio: 'tone',
      video: true,
    });
    recordings['quiet.mp3'] = await makeRecording(mediaDir, 'quiet.mp3', {
      seconds: 3,
      audio: 'silence',
      video: false,
    });
    recordings['mute.mp4'] = await makeRecording(mediaDir, 'mute.mp4', {
      seconds: 3,
      audio: 'none',
      video: true,
    });
    recordings['long.mp3'] = await makeRecording(mediaDir, 'long.mp3', {
      seconds: LIMIT_MS / 1000 + 5,
      audio: 'tone',
      video: false,
    });

    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true }));
    await app.init();
    transcriber = app.get<Transcriber, FakeTranscriber>(Transcriber);
    analyzer = app.get<MeetingAnalyzer, FakeMeetingAnalyzer>(MeetingAnalyzer);

    ownerToken = await signUp('transcription-owner');
    participantToken = await signUp('transcription-participant');
    strangerToken = await signUp('transcription-stranger');
    const meeting = await request(server())
      .post('/meetings')
      .set(auth(ownerToken))
      .send({ title: 'Transcription', startsAt: '2030-01-01T10:00:00.000Z' })
      .expect(201);
    meetingId = (meeting.body as { id: string }).id;
    await request(server())
      .post(`/meetings/${meetingId}/participants`)
      .set(auth(ownerToken))
      .send({ email: email('transcription-participant') })
      .expect(201);
  });

  afterEach(() => {
    transcriber.control.reset();
    analyzer.control.reset();
  });

  afterAll(async () => {
    // Meetings, files, transcripts and summaries go with their users (cascade).
    await app.get(PrismaService).user.deleteMany({
      where: { email: { endsWith: `-${runId}@example.com` } },
    });
    await app.close();
    await rm(filesDir, { recursive: true, force: true, maxRetries: 5 });
    await rm(mediaDir, { recursive: true, force: true, maxRetries: 5 });
  });

  describe('recordings', () => {
    it.each(['call.mp3', 'call.mp4'])(
      'transcribes and summarizes %s in the background: PROCESSING, then READY',
      async (name) => {
        const release = transcriber.control.hold();
        const fileId = await uploadRecording(ownerToken, meetingId, name);

        // The upload request does not wait for the transcript.
        const processing = (await details(ownerToken, meetingId, fileId).expect(200))
          .body as FileDetails;
        expect(processing).toMatchObject({ status: 'PROCESSING', transcript: null, summary: null });
        // The extracted audio waits in the job's work directory while it is transcribed.
        await transcriber.control.started();
        expect(await workDirExists(fileId)).toBe(true);

        release();
        const file = await settled(ownerToken, meetingId, fileId);
        expect(file).toMatchObject({ status: 'READY', failureReason: null });
        expect(file.durationMs).toBeGreaterThan(2_800);
        expect(file.durationMs).toBeLessThan(3_300);
        // The fake hears one second of speech per segment, in order, with timestamps.
        expect(file.transcript).toEqual([
          { startMs: 0, endMs: 1000, text: 'Fake speech 1.' },
          { startMs: 1000, endMs: 2000, text: 'Fake speech 2.' },
          { startMs: 2000, endMs: expect.any(Number) as number, text: 'Fake speech 3.' },
        ]);
        expect(file.summary).toContain('Fake speech 1. Fake speech 2. Fake speech 3.');
        // The extracted audio is temporary.
        expect(await workDirExists(fileId)).toBe(false);
      },
    );

    it('lists a recording with its duration and summary, but not its transcript', async () => {
      const fileId = await uploadRecording(ownerToken, meetingId, 'call.mp3');
      await settled(ownerToken, meetingId, fileId);

      const res = await request(server())
        .get(`/meetings/${meetingId}/files`)
        .set(auth(ownerToken))
        .expect(200);
      const listed = (res.body as FileDetails[]).find((file) => file.id === fileId);
      // Served inline with ranges for the player, not as a preview.
      expect(listed).toMatchObject({
        kind: 'AUDIO',
        status: 'READY',
        playable: true,
        previewable: false,
      });
      expect(listed?.durationMs).toBeGreaterThan(2_800);
      expect(listed?.summary).toContain('Fake speech 1.');
      expect(listed).not.toHaveProperty('transcript');
    });

    it('fails a recording longer than MAX_RECORDING_MINUTES, naming the limit', async () => {
      const fileId = await uploadRecording(ownerToken, meetingId, 'long.mp3');

      const file = await settled(ownerToken, meetingId, fileId);
      expect(file).toMatchObject({
        status: 'FAILED',
        failureReason: 'Recording is longer than 1 minute',
        transcript: null,
        summary: null,
      });
      expect(file.durationMs).toBeGreaterThan(LIMIT_MS);
      expect(transcriber.control.calls).toBe(0);
    });

    it('fails a video without a sound track', async () => {
      const fileId = await uploadRecording(ownerToken, meetingId, 'mute.mp4');

      const file = await settled(ownerToken, meetingId, fileId);
      expect(file).toMatchObject({
        status: 'FAILED',
        failureReason: 'No audio found in the recording',
      });
    });

    it('fails a recording without speech', async () => {
      const fileId = await uploadRecording(ownerToken, meetingId, 'quiet.mp3');

      const file = await settled(ownerToken, meetingId, fileId);
      expect(file).toMatchObject({
        status: 'FAILED',
        failureReason: 'No speech found in the recording',
      });
      expect(analyzer.control.calls).toBe(0);
    });

    it('fails a file whose media cannot be decoded', async () => {
      // An MP4 header followed by noise: it passes the magic bytes check, not ffprobe.
      const fileId = await upload(ownerToken, meetingId, fakeMp4(4096), 'broken.mp4');

      const file = await settled(ownerToken, meetingId, fileId);
      expect(file).toMatchObject({
        status: 'FAILED',
        failureReason: 'The recording could not be read',
      });
    });

    it('fails with a reason when the transcriber hangs past its duration-based timeout', async () => {
      transcriber.control.behave('hang');
      const fileId = await uploadRecording(ownerToken, meetingId, 'call.mp3');

      // Times out after 3 s x WHISPER_SPEED_FACTOR 1.5 + a 2 s margin (e2e config).
      const file = await settled(ownerToken, meetingId, fileId);
      expect(file).toMatchObject({ status: 'FAILED', failureReason: 'Processing took too long' });
      expect(await workDirExists(fileId)).toBe(false);
    });

    it('fails when the transcript cannot be summarized; a retry reuses the transcript', async () => {
      analyzer.control.behave('fail');
      const fileId = await uploadRecording(ownerToken, meetingId, 'call.mp3');

      const file = await settled(ownerToken, meetingId, fileId);
      expect(file).toMatchObject({
        status: 'FAILED',
        failureReason: 'Summary could not be generated',
        transcript: null,
      });

      transcriber.control.reset();
      analyzer.control.behave('ok');
      await retry(ownerToken, meetingId, fileId).expect(202);
      const ready = await settled(ownerToken, meetingId, fileId);
      expect(ready).toMatchObject({ status: 'READY' });
      expect(ready.transcript).toHaveLength(3);
      expect(ready.summary).toContain('Fake speech 1.');
      // Only the summary was made again.
      expect(transcriber.control.calls).toBe(0);
    });
  });

  describe('insights', () => {
    /**
     * The fake analyzer quotes the transcript: a summary, an action item with an assignee, one
     * without (nobody was named), and a decision.
     */
    const fakeInsights: Insights = {
      actionItems: [
        {
          description: expect.stringContaining('Fake speech') as string,
          assignee: expect.stringMatching(/\S/) as string,
        },
        { description: expect.stringContaining('Fake speech') as string, assignee: null },
      ],
      decisions: [{ text: expect.stringContaining('Fake speech') as string }],
    };

    const listed = async (token: string, fileId: string) => {
      const res = await request(server())
        .get(`/meetings/${meetingId}/files`)
        .set(auth(token))
        .expect(200);
      return (res.body as FileDetails[]).find((file) => file.id === fileId);
    };

    it('ends a recording READY with a summary, action items and decisions in the details and the list', async () => {
      const fileId = await uploadRecording(ownerToken, meetingId, 'call.mp3');

      const file = await settled(ownerToken, meetingId, fileId);
      expect(file).toMatchObject({ status: 'READY', failureReason: null });
      expect(file.summary).toContain('Fake speech 1. Fake speech 2. Fake speech 3.');
      expect(file.insights).toEqual(fakeInsights);

      const inList = await listed(ownerToken, fileId);
      expect(inList?.summary).toBe(file.summary);
      expect(inList?.insights).toEqual(file.insights);
    });

    it('gives the owner and a participant the same summary and insights', async () => {
      const fileId = await uploadRecording(ownerToken, meetingId, 'call.mp4');
      const owners = await settled(ownerToken, meetingId, fileId);

      const participants = (await details(participantToken, meetingId, fileId).expect(200))
        .body as FileDetails;
      expect(participants.summary).toBe(owners.summary);
      expect(participants.insights).toEqual(owners.insights);
      expect(participants.insights).toEqual(fakeInsights);

      const inList = await listed(participantToken, fileId);
      expect(inList?.summary).toBe(owners.summary);
      expect(inList?.insights).toEqual(owners.insights);
    });

    it('returns an action item without an assignee as null, not an invented name', async () => {
      const fileId = await uploadRecording(ownerToken, meetingId, 'call.mp3');

      const file = await settled(ownerToken, meetingId, fileId);
      const unassigned = file.insights?.actionItems.filter((item) => item.assignee === null);
      expect(unassigned).toHaveLength(1);
      expect(unassigned?.[0]).toEqual({
        description: expect.stringContaining('Fake speech') as string,
        assignee: null,
      });
    });

    it('gives a document a summary and insights: null', async () => {
      const data = await readFile(path.join(FIXTURES, 'notes.txt'));
      const fileId = await upload(ownerToken, meetingId, data, 'notes.txt');

      const file = await settled(ownerToken, meetingId, fileId);
      expect(file).toMatchObject({ status: 'READY', insights: null });
      expect(file.summary).toEqual(expect.any(String));

      const inList = await listed(participantToken, fileId);
      expect(inList).toMatchObject({ status: 'READY', summary: file.summary, insights: null });
    });

    describe('analysis failures', () => {
      const storedInsights = (fileId: string) =>
        app.get(PrismaService).recordingInsights.findUnique({ where: { fileId } });

      it('fails with "Summary could not be generated" and stores no result', async () => {
        analyzer.control.behave('fail');
        const fileId = await uploadRecording(ownerToken, meetingId, 'call.mp3');

        const file = await settled(ownerToken, meetingId, fileId);
        expect(file).toMatchObject({
          status: 'FAILED',
          failureReason: 'Summary could not be generated',
          summary: null,
          insights: null,
          transcript: null,
        });
        expect(await storedInsights(fileId)).toBeNull();
        expect(await listed(participantToken, fileId)).toMatchObject({
          status: 'FAILED',
          summary: null,
          insights: null,
        });
        // The transcript is kept (not shown) for a retry.
        expect(await app.get(PrismaService).transcriptSegment.count({ where: { fileId } })).toBe(3);
        expect(await workDirExists(fileId)).toBe(false);
      });

      it('fails with "Processing took too long" when the analyzer hangs', async () => {
        analyzer.control.behave('hang');
        const fileId = await uploadRecording(ownerToken, meetingId, 'call.mp3');

        // Times out after DOCUMENT_PROCESSING_TIMEOUT_SECONDS (3 s in the e2e config) per started hour.
        const file = await settled(ownerToken, meetingId, fileId);
        expect(file).toMatchObject({
          status: 'FAILED',
          failureReason: 'Processing took too long',
          summary: null,
          insights: null,
        });
        expect(await storedInsights(fileId)).toBeNull();
        expect(await workDirExists(fileId)).toBe(false);
      });

      it('a retry reuses the stored transcript: the transcriber is not called', async () => {
        analyzer.control.behave('fail');
        const fileId = await uploadRecording(ownerToken, meetingId, 'call.mp3');
        await settled(ownerToken, meetingId, fileId);

        transcriber.control.reset();
        analyzer.control.reset();
        await retry(ownerToken, meetingId, fileId).expect(202);

        const file = await settled(ownerToken, meetingId, fileId);
        expect(file).toMatchObject({ status: 'READY', failureReason: null });
        expect(file.insights).toEqual(fakeInsights);
        expect(file.summary).toContain('Fake speech 1. Fake speech 2. Fake speech 3.');
        expect(file.transcript).toHaveLength(3);
        expect(transcriber.control.calls).toBe(0);
        expect(analyzer.control.calls).toBe(1);
      });

      it('deleting during the analysis brings back neither the file nor its insights', async () => {
        const release = analyzer.control.hold();
        const fileId = await uploadRecording(ownerToken, meetingId, 'call.mp3');
        await analyzer.control.started();

        await request(server())
          .delete(`/meetings/${meetingId}/files/${fileId}`)
          .set(auth(ownerToken))
          .expect(204);

        // The analysis finishes after the file is gone.
        release();
        await analyzer.control.finished();
        await new Promise((resolve) => setTimeout(resolve, 500));

        const prisma = app.get(PrismaService);
        expect(await prisma.meetingFile.findUnique({ where: { id: fileId } })).toBeNull();
        expect(await prisma.transcriptSegment.count({ where: { fileId } })).toBe(0);
        expect(await storedInsights(fileId)).toBeNull();
        expect(await workDirExists(fileId)).toBe(false);
        await details(ownerToken, meetingId, fileId).expect(404);
      });
    });
  });

  describe('manual analysis', () => {
    const OLD_SUMMARY = 'Summary written before the meeting insights.';

    const analyze = (token: string, meeting: string, fileId: string) =>
      request(server()).post(`/meetings/${meeting}/files/${fileId}/analyze`).set(auth(token));

    const listed = async (token: string, fileId: string) => {
      const res = await request(server())
        .get(`/meetings/${meetingId}/files`)
        .set(auth(token))
        .expect(200);
      return (res.body as FileDetails[]).find((file) => file.id === fileId);
    };

    /**
     * A recording processed before the meeting insights: READY with a transcript and an older
     * `MeetingFileSummary`, but no `RecordingInsights`.
     */
    const olderRecording = async (): Promise<string> => {
      const fileId = await uploadRecording(ownerToken, meetingId, 'call.mp3');
      await settled(ownerToken, meetingId, fileId);
      const prisma = app.get(PrismaService);
      await prisma.recordingInsights.delete({ where: { fileId } });
      await prisma.meetingFileSummary.create({ data: { fileId, text: OLD_SUMMARY } });
      analyzer.control.reset();
      return fileId;
    };

    it('both endpoints offer the analysis of an older recording only', async () => {
      const older = await olderRecording();
      const analyzed = await uploadRecording(ownerToken, meetingId, 'call.mp3');
      await settled(ownerToken, meetingId, analyzed);

      for (const token of [ownerToken, participantToken]) {
        for (const [fileId, canAnalyze] of [
          [older, true],
          [analyzed, false],
        ] as const) {
          const file = (await details(token, meetingId, fileId).expect(200)).body as FileDetails;
          expect(file).toMatchObject({ analysisStatus: null, canAnalyze });
          expect(await listed(token, fileId)).toMatchObject({ analysisStatus: null, canAnalyze });
        }
      }
    });

    it('answers 202 to the owner while the file stays READY with its transcript and old summary', async () => {
      const fileId = await olderRecording();
      const release = analyzer.control.hold();

      const res = await analyze(ownerToken, meetingId, fileId).expect(202);
      expect(res.body).toMatchObject({ id: fileId, status: 'READY', analysisStatus: 'RUNNING' });
      await analyzer.control.started();

      // Both endpoints report the running analysis, for the owner and a participant (a reload).
      for (const token of [ownerToken, participantToken]) {
        const file = (await details(token, meetingId, fileId).expect(200)).body as FileDetails;
        expect(file).toMatchObject({
          status: 'READY',
          failureReason: null,
          processingStage: null,
          analysisStatus: 'RUNNING',
          summary: OLD_SUMMARY,
          insights: null,
        });
        expect(file.transcript).toHaveLength(3);
        expect(await listed(token, fileId)).toMatchObject({
          status: 'READY',
          analysisStatus: 'RUNNING',
          summary: OLD_SUMMARY,
          insights: null,
        });
      }

      // A repeated request does not start a second analysis.
      await analyze(ownerToken, meetingId, fileId).expect(409);

      release();
      await analyzer.control.finished();
      expect(analyzer.control.calls).toBe(1);
    });

    it('answers 403 to a participant and starts nothing', async () => {
      const fileId = await olderRecording();

      await analyze(participantToken, meetingId, fileId).expect(403);

      const file = (await details(ownerToken, meetingId, fileId).expect(200)).body as FileDetails;
      expect(file).toMatchObject({ status: 'READY', analysisStatus: null, summary: OLD_SUMMARY });
      expect(analyzer.control.calls).toBe(0);
    });

    it('answers 404 for a stranger, a file of another meeting and a missing file', async () => {
      const fileId = await olderRecording();
      const other = await request(server())
        .post('/meetings')
        .set(auth(ownerToken))
        .send({ title: 'Other', startsAt: '2030-01-02T10:00:00.000Z' })
        .expect(201);
      const otherMeetingId = (other.body as { id: string }).id;

      await analyze(strangerToken, meetingId, fileId).expect(404);
      await analyze(ownerToken, otherMeetingId, fileId).expect(404);
      await analyze(ownerToken, meetingId, '00000000-0000-4000-8000-000000000000').expect(404);
      expect(analyzer.control.calls).toBe(0);
    });

    it('answers 409 for a recording that already has insights', async () => {
      const fileId = await uploadRecording(ownerToken, meetingId, 'call.mp3');
      await settled(ownerToken, meetingId, fileId);
      analyzer.control.reset();

      await analyze(ownerToken, meetingId, fileId).expect(409);
      expect(analyzer.control.calls).toBe(0);
    });

    it('answers 409 for a recording without a transcript and for a document', async () => {
      const fileId = await olderRecording();
      await app.get(PrismaService).transcriptSegment.deleteMany({ where: { fileId } });
      await analyze(ownerToken, meetingId, fileId).expect(409);

      const data = await readFile(path.join(FIXTURES, 'notes.txt'));
      const documentId = await upload(ownerToken, meetingId, data, 'notes.txt');
      await settled(ownerToken, meetingId, documentId);
      await analyze(ownerToken, meetingId, documentId).expect(409);

      const file = (await details(ownerToken, meetingId, fileId).expect(200)).body as FileDetails;
      expect(file).toMatchObject({ status: 'READY', analysisStatus: null, summary: OLD_SUMMARY });
    });
  });

  describe('processing stage', () => {
    const stage = async (token: string, fileId: string) =>
      ((await details(token, meetingId, fileId).expect(200)).body as FileDetails).processingStage;

    const listedStage = async (token: string, fileId: string) => {
      const res = await request(server())
        .get(`/meetings/${meetingId}/files`)
        .set(auth(token))
        .expect(200);
      return (res.body as FileDetails[]).find((file) => file.id === fileId)?.processingStage;
    };

    it('follows the job for the owner and a participant, and queues the next recording', async () => {
      const releaseTranscriber = transcriber.control.hold();
      const releaseSummarizer = analyzer.control.hold();
      const first = await uploadRecording(ownerToken, meetingId, 'call.mp3');
      await transcriber.control.started();

      for (const token of [ownerToken, participantToken]) {
        expect(await stage(token, first)).toBe('TRANSCRIBING');
        expect(await listedStage(token, first)).toBe('TRANSCRIBING');
      }

      // Recordings are processed one at a time.
      const second = await uploadRecording(ownerToken, meetingId, 'call.mp4');
      expect(await stage(ownerToken, second)).toBe('QUEUED');
      expect(await listedStage(participantToken, second)).toBe('QUEUED');

      releaseTranscriber();
      await analyzer.control.started();
      for (const token of [ownerToken, participantToken]) {
        expect(await stage(token, first)).toBe('SUMMARIZING');
        expect(await listedStage(token, first)).toBe('SUMMARIZING');
      }
      expect(await stage(ownerToken, second)).toBe('QUEUED');

      releaseSummarizer();
      expect(await settled(ownerToken, meetingId, first)).toMatchObject({
        status: 'READY',
        processingStage: null,
      });
      expect(await settled(ownerToken, meetingId, second)).toMatchObject({
        status: 'READY',
        processingStage: null,
      });
    });

    it('runs the stages again after a retry of a failed transcription', async () => {
      transcriber.control.behave('fail');
      const fileId = await uploadRecording(ownerToken, meetingId, 'call.mp3');
      expect(await settled(ownerToken, meetingId, fileId)).toMatchObject({
        status: 'FAILED',
        processingStage: null,
      });

      transcriber.control.reset();
      const release = transcriber.control.hold();
      const res = await retry(ownerToken, meetingId, fileId).expect(202);
      expect(res.body).toMatchObject({ status: 'PROCESSING', processingStage: 'QUEUED' });

      await transcriber.control.started();
      expect(await stage(ownerToken, fileId)).toBe('TRANSCRIBING');
      release();
      expect(await settled(ownerToken, meetingId, fileId)).toMatchObject({ status: 'READY' });
    });

    it('goes straight to SUMMARIZING after a retry of a failed summary', async () => {
      analyzer.control.behave('fail');
      const fileId = await uploadRecording(ownerToken, meetingId, 'call.mp3');
      expect(await settled(ownerToken, meetingId, fileId)).toMatchObject({
        status: 'FAILED',
        processingStage: null,
      });

      transcriber.control.reset();
      analyzer.control.reset();
      const release = analyzer.control.hold();
      await retry(ownerToken, meetingId, fileId).expect(202);

      await analyzer.control.started();
      expect(await stage(ownerToken, fileId)).toBe('SUMMARIZING');
      expect(transcriber.control.calls).toBe(0);
      release();
      expect(await settled(ownerToken, meetingId, fileId)).toMatchObject({ status: 'READY' });
    });
  });

  describe('retry', () => {
    it('fails when the transcriber fails, then a retry goes to READY', async () => {
      transcriber.control.behave('fail');
      const fileId = await uploadRecording(ownerToken, meetingId, 'call.mp4');
      expect(await settled(ownerToken, meetingId, fileId)).toMatchObject({
        status: 'FAILED',
        failureReason: 'The recording could not be transcribed',
        transcript: null,
      });

      transcriber.control.behave('ok');
      const res = await retry(ownerToken, meetingId, fileId).expect(202);
      expect(res.body).toMatchObject({ id: fileId, status: 'PROCESSING', failureReason: null });

      const file = await settled(ownerToken, meetingId, fileId);
      expect(file).toMatchObject({ status: 'READY', failureReason: null });
      expect(file.transcript).toHaveLength(3);
      expect(file.summary).toContain('Fake speech 1.');
    });

    it('answers 403 to a participant and 409 for a recording that has not failed', async () => {
      transcriber.control.behave('fail');
      const failed = await uploadRecording(ownerToken, meetingId, 'call.mp3');
      await settled(ownerToken, meetingId, failed);
      await retry(participantToken, meetingId, failed).expect(403);
      await retry(strangerToken, meetingId, failed).expect(404);

      transcriber.control.behave('ok');
      const ready = await uploadRecording(ownerToken, meetingId, 'call.mp3');
      await settled(ownerToken, meetingId, ready);
      await retry(ownerToken, meetingId, ready).expect(409);
    });
  });

  describe('access and deletion', () => {
    it('gives the transcript and summary to a participant, 404 to a stranger', async () => {
      const fileId = await uploadRecording(ownerToken, meetingId, 'call.mp3');
      await settled(ownerToken, meetingId, fileId);

      const res = await details(participantToken, meetingId, fileId).expect(200);
      expect((res.body as FileDetails).transcript).toHaveLength(3);
      expect((res.body as FileDetails).summary).toContain('Fake speech 1.');
      await details(strangerToken, meetingId, fileId).expect(404);
    });

    it('deletes the transcript and insights with the file', async () => {
      const fileId = await uploadRecording(ownerToken, meetingId, 'call.mp3');
      await settled(ownerToken, meetingId, fileId);
      const prisma = app.get(PrismaService);
      const insights = await prisma.recordingInsights.findUniqueOrThrow({ where: { fileId } });

      await request(server())
        .delete(`/meetings/${meetingId}/files/${fileId}`)
        .set(auth(ownerToken))
        .expect(204);

      expect(await prisma.transcriptSegment.count({ where: { fileId } })).toBe(0);
      expect(await prisma.recordingInsights.findUnique({ where: { fileId } })).toBeNull();
      expect(await prisma.actionItem.count({ where: { insightsId: insights.id } })).toBe(0);
      expect(await prisma.meetingDecision.count({ where: { insightsId: insights.id } })).toBe(0);
      await details(ownerToken, meetingId, fileId).expect(404);
    });

    it('deletes the insights, their action items and decisions with the file', async () => {
      const fileId = await uploadRecording(ownerToken, meetingId, 'call.mp3');
      await settled(ownerToken, meetingId, fileId);

      const prisma = app.get(PrismaService);
      const insights = await prisma.recordingInsights.upsert({
        where: { fileId },
        update: {},
        create: {
          fileId,
          summary: 'A summary.',
          actionItems: {
            create: [
              { position: 0, description: 'Send the notes', assignee: 'Alice' },
              { position: 1, description: 'Book a room' },
            ],
          },
          decisions: { create: [{ position: 0, text: 'Ship on Friday' }] },
        },
      });

      await request(server())
        .delete(`/meetings/${meetingId}/files/${fileId}`)
        .set(auth(ownerToken))
        .expect(204);

      expect(await prisma.recordingInsights.findUnique({ where: { fileId } })).toBeNull();
      expect(await prisma.actionItem.count({ where: { insightsId: insights.id } })).toBe(0);
      expect(await prisma.meetingDecision.count({ where: { insightsId: insights.id } })).toBe(0);
    });

    it('deleting during transcription brings back neither the file nor its transcript', async () => {
      const release = transcriber.control.hold();
      const fileId = await uploadRecording(ownerToken, meetingId, 'call.mp3');
      await transcriber.control.started();

      await request(server())
        .delete(`/meetings/${meetingId}/files/${fileId}`)
        .set(auth(ownerToken))
        .expect(204);

      // The job finishes its transcript after the file is gone.
      release();
      await transcriber.control.finished();
      await new Promise((resolve) => setTimeout(resolve, 500));

      const prisma = app.get(PrismaService);
      expect(await prisma.meetingFile.findUnique({ where: { id: fileId } })).toBeNull();
      expect(await prisma.transcriptSegment.count({ where: { fileId } })).toBe(0);
      expect(await prisma.recordingInsights.findUnique({ where: { fileId } })).toBeNull();
      expect(await workDirExists(fileId)).toBe(false);
    });
  });

  describe('streaming a recording through a signed link', () => {
    let fileId: string;
    let data: Buffer;

    beforeAll(async () => {
      data = await readFile(recordings['call.mp4']);
      fileId = await uploadRecording(ownerToken, meetingId, 'call.mp4');
      await settled(ownerToken, meetingId, fileId);
    });

    const link = async (token = ownerToken) => {
      const res = await request(server())
        .post(`/meetings/${meetingId}/files/${fileId}/link`)
        .set(auth(token))
        .expect(201);
      return res.body as { url: string; expiresAt: string };
    };

    const get = (url: string) => request(server()).get(url).buffer(true).parse(binaryParser);

    it('issues a media link that outlives the recording plus 30 minutes', async () => {
      const { expiresAt } = await link();
      const lifetimeMs = new Date(expiresAt).getTime() - Date.now();
      expect(lifetimeMs).toBeGreaterThan(30 * 60 * 1000);
      expect(lifetimeMs).toBeLessThanOrEqual(6 * 60 * 60 * 1000);
    });

    it('answers a byte range with 206 and Content-Range', async () => {
      const { url } = await link();

      const res = await get(url).set('Range', 'bytes=0-99').expect(206);
      expect(res.headers['content-range']).toBe(`bytes 0-99/${data.length}`);
      expect(res.headers['accept-ranges']).toBe('bytes');
      expect(res.headers['content-type']).toBe('video/mp4');
      expect(res.body).toEqual(data.subarray(0, 100));
    });

    it('answers open-ended and suffix ranges', async () => {
      const { url } = await link();

      const tail = await get(url).set('Range', 'bytes=1000-').expect(206);
      expect(tail.headers['content-range']).toBe(`bytes 1000-${data.length - 1}/${data.length}`);
      expect(tail.body).toEqual(data.subarray(1000));

      const suffix = await get(url).set('Range', 'bytes=-200').expect(206);
      expect(suffix.body).toEqual(data.subarray(data.length - 200));
    });

    it('answers 416 for a range past the end', async () => {
      const { url } = await link();

      const res = await get(url).set('Range', `bytes=${data.length}-`).expect(416);
      expect(res.headers['content-range']).toBe(`bytes */${data.length}`);
    });

    it('streams inline for the player and still answers ranges', async () => {
      const { url } = await link(participantToken);

      const res = await get(`${url}&disposition=inline`).set('Range', 'bytes=10-19').expect(206);
      expect(res.headers['content-disposition']).toMatch(/^inline; filename="call.mp4"/);
      expect(res.body).toEqual(data.subarray(10, 20));
    });

    it('answers the whole recording without a Range header', async () => {
      const { url } = await link();

      const res = await get(url).expect(200);
      expect(res.headers['accept-ranges']).toBe('bytes');
      expect(res.body).toEqual(data);
    });
  });
});

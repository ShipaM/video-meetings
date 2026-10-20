import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { Server } from 'node:http';
import request from 'supertest';
import { AppModule } from './../src/app.module.js';
import { FakeTranscriber } from './../src/meeting-files/processing/fake-transcriber.js';
import { FakeSummarizer } from './../src/meeting-files/processing/fake-summarizer.js';
import { Summarizer } from './../src/meeting-files/processing/summarizer.js';
import { Transcriber } from './../src/meeting-files/processing/transcriber.js';
import { PrismaService } from './../src/prisma/prisma.service.js';
import { makeRecording } from './media.helpers.js';
import { TUS_VERSION, binaryParser, fakeMp4, tusMetadata } from './tus.helpers.js';

interface Segment {
  startMs: number;
  endMs: number;
  text: string;
}

interface FileDetails {
  id: string;
  kind: string;
  mimeType: string;
  status: 'UPLOADING' | 'PROCESSING' | 'READY' | 'FAILED';
  failureReason: string | null;
  durationMs: number | null;
  summary: string | null;
  transcript?: Segment[] | null;
}

const MIME = { mp3: 'audio/mpeg', mp4: 'video/mp4' } as const;
/** The e2e config sets `MAX_RECORDING_MINUTES=1`. */
const LIMIT_MS = 60_000;

describe('Meeting file transcription (e2e)', () => {
  let app: INestApplication;
  let filesDir: string;
  let mediaDir: string;
  let transcriber: FakeTranscriber;
  let summarizer: FakeSummarizer;
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
    summarizer = app.get<Summarizer, FakeSummarizer>(Summarizer);

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
    summarizer.control.reset();
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
      expect(summarizer.control.calls).toBe(0);
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
      summarizer.control.behave('fail');
      const fileId = await uploadRecording(ownerToken, meetingId, 'call.mp3');

      const file = await settled(ownerToken, meetingId, fileId);
      expect(file).toMatchObject({
        status: 'FAILED',
        failureReason: 'Summary could not be generated',
        transcript: null,
      });

      transcriber.control.reset();
      summarizer.control.behave('ok');
      await retry(ownerToken, meetingId, fileId).expect(202);
      const ready = await settled(ownerToken, meetingId, fileId);
      expect(ready).toMatchObject({ status: 'READY' });
      expect(ready.transcript).toHaveLength(3);
      expect(ready.summary).toContain('Fake speech 1.');
      // Only the summary was made again.
      expect(transcriber.control.calls).toBe(0);
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

    it('deletes the transcript and summary with the file', async () => {
      const fileId = await uploadRecording(ownerToken, meetingId, 'call.mp3');
      await settled(ownerToken, meetingId, fileId);

      await request(server())
        .delete(`/meetings/${meetingId}/files/${fileId}`)
        .set(auth(ownerToken))
        .expect(204);

      const prisma = app.get(PrismaService);
      expect(await prisma.transcriptSegment.count({ where: { fileId } })).toBe(0);
      expect(await prisma.meetingFileSummary.findUnique({ where: { fileId } })).toBeNull();
      await details(ownerToken, meetingId, fileId).expect(404);
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
      expect(await prisma.meetingFileSummary.findUnique({ where: { fileId } })).toBeNull();
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

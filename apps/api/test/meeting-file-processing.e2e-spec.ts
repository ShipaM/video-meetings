import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { CommandBus } from '@nestjs/cqrs';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { Server } from 'node:http';
import request from 'supertest';
import { AppModule } from './../src/app.module.js';
import { FailStuckProcessingCommand } from './../src/meeting-files/commands/index.js';
import { FakeSummarizer } from './../src/meeting-files/processing/fake-summarizer.js';
import { Summarizer } from './../src/meeting-files/processing/summarizer.js';
import { PrismaService } from './../src/prisma/prisma.service.js';
import { TUS_VERSION, fakeMp4, fakePng, tusMetadata } from './tus.helpers.js';

interface FileDetails {
  id: string;
  meetingId: string;
  originalName: string;
  kind: string;
  status: 'UPLOADING' | 'PROCESSING' | 'READY' | 'FAILED';
  failureReason: string | null;
  summary: string | null;
}

const FIXTURES = path.join(import.meta.dirname, 'fixtures');
/** Text of every document fixture (notes.txt, notes.pdf, notes.docx, slides.pptx). */
const FIXTURE_TEXT = 'Quarterly planning meeting.';

const MIME = {
  txt: 'text/plain',
  pdf: 'application/pdf',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  png: 'image/png',
  mp4: 'video/mp4',
} as const;

describe('Meeting file processing (e2e)', () => {
  let app: INestApplication;
  let filesDir: string;
  let summarizer: FakeSummarizer;

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

  const createMeeting = async (token: string): Promise<string> => {
    const res = await request(server())
      .post('/meetings')
      .set(auth(token))
      .send({ title: 'Processing', startsAt: '2030-01-01T10:00:00.000Z' })
      .expect(201);
    return (res.body as { id: string }).id;
  };

  /** Uploads `data` in one chunk and returns the file id. */
  const upload = async (
    token: string,
    meetingId: string,
    data: Buffer,
    filename: string,
    filetype: string,
  ): Promise<string> => {
    const created = await request(server())
      .post('/uploads')
      .set(tus(token))
      .set('Upload-Length', String(data.length))
      .set('Upload-Metadata', tusMetadata({ meetingId, filename, filetype }))
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

  const uploadFixture = async (token: string, meetingId: string, name: string) => {
    const extension = path.extname(name).slice(1) as keyof typeof MIME;
    return upload(
      token,
      meetingId,
      await readFile(path.join(FIXTURES, name)),
      name,
      MIME[extension],
    );
  };

  const details = (token: string, meetingId: string, fileId: string) =>
    request(server()).get(`/meetings/${meetingId}/files/${fileId}`).set(auth(token));

  const retry = (token: string, meetingId: string, fileId: string) =>
    request(server()).post(`/meetings/${meetingId}/files/${fileId}/retry`).set(auth(token));

  /** Polls the file details until `done` holds (the worker runs inside the test app). */
  const waitFor = async (
    token: string,
    meetingId: string,
    fileId: string,
    done: (file: FileDetails) => boolean,
    timeoutMs = 20_000,
  ): Promise<FileDetails> => {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      const res = await details(token, meetingId, fileId).expect(200);
      const file = res.body as FileDetails;
      if (done(file)) {
        return file;
      }
      if (Date.now() > deadline) {
        throw new Error(`File ${fileId} is still ${file.status}`);
      }
      await new Promise((resolve) => setTimeout(resolve, 200));
    }
  };

  const settled = (token: string, meetingId: string, fileId: string) =>
    waitFor(token, meetingId, fileId, (file) => file.status !== 'PROCESSING');

  let ownerToken: string;
  let participantToken: string;
  let strangerToken: string;
  let meetingId: string;

  beforeAll(async () => {
    filesDir = await mkdtemp(path.join(tmpdir(), 'meeting-processing-e2e-'));
    process.env.FILES_DIR = filesDir;

    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true }));
    await app.init();
    summarizer = app.get<Summarizer, FakeSummarizer>(Summarizer);

    ownerToken = await signUp('processing-owner');
    participantToken = await signUp('processing-participant');
    strangerToken = await signUp('processing-stranger');
    meetingId = await createMeeting(ownerToken);
    await request(server())
      .post(`/meetings/${meetingId}/participants`)
      .set(auth(ownerToken))
      .send({ email: email('processing-participant') })
      .expect(201);
  });

  afterEach(() => {
    summarizer.reset();
  });

  afterAll(async () => {
    // Meetings, files and summaries are removed together with their users (cascade).
    await app.get(PrismaService).user.deleteMany({
      where: { email: { endsWith: `-${runId}@example.com` } },
    });
    await app.close();
    await rm(filesDir, { recursive: true, force: true, maxRetries: 5 });
  });

  describe('documents', () => {
    it.each(['notes.txt', 'notes.pdf', 'notes.docx', 'slides.pptx'])(
      'summarizes %s in the background: PROCESSING, then READY with a summary',
      async (name) => {
        const release = summarizer.hold();
        const fileId = await uploadFixture(ownerToken, meetingId, name);

        // The upload request does not wait for the summary.
        const processing = (await details(ownerToken, meetingId, fileId).expect(200))
          .body as FileDetails;
        expect(processing).toMatchObject({ status: 'PROCESSING', summary: null });

        release();
        const file = await settled(ownerToken, meetingId, fileId);
        expect(file).toMatchObject({ status: 'READY', failureReason: null, originalName: name });
        expect(file.summary).toContain(FIXTURE_TEXT);
      },
    );

    it('lists a document with its status, and with its summary once it is READY', async () => {
      const release = summarizer.hold();
      const fileId = await uploadFixture(ownerToken, meetingId, 'notes.txt');
      const listed = async () => {
        const res = await request(server())
          .get(`/meetings/${meetingId}/files`)
          .set(auth(ownerToken))
          .expect(200);
        return (res.body as FileDetails[]).find((file) => file.id === fileId);
      };

      expect(await listed()).toMatchObject({
        status: 'PROCESSING',
        failureReason: null,
        summary: null,
      });

      release();
      await settled(ownerToken, meetingId, fileId);
      const ready = await listed();
      expect(ready).toMatchObject({ status: 'READY' });
      expect(ready?.summary).toContain(FIXTURE_TEXT);
    });

    it('fails with a reason when the summary cannot be generated', async () => {
      summarizer.behave('fail');
      const fileId = await uploadFixture(ownerToken, meetingId, 'notes.txt');

      const file = await settled(ownerToken, meetingId, fileId);
      expect(file).toMatchObject({
        status: 'FAILED',
        failureReason: 'Summary could not be generated',
        summary: null,
      });
    });

    it('fails with a reason when the document has no text', async () => {
      const fileId = await upload(
        ownerToken,
        meetingId,
        Buffer.from(' \n\t\n  \n'),
        'blank.txt',
        MIME.txt,
      );

      const file = await settled(ownerToken, meetingId, fileId);
      expect(file).toMatchObject({
        status: 'FAILED',
        failureReason: 'No text found in the document',
      });
    });

    it('fails with a reason when processing hangs past the job timeout', async () => {
      summarizer.behave('hang');
      const fileId = await uploadFixture(ownerToken, meetingId, 'notes.txt');

      const file = await settled(ownerToken, meetingId, fileId);
      expect(file).toMatchObject({ status: 'FAILED', failureReason: 'Processing took too long' });
    });
  });

  describe('other kinds', () => {
    it('makes an image READY at once, without processing', async () => {
      const fileId = await upload(ownerToken, meetingId, fakePng(), 'board.png', MIME.png);

      const file = (await details(ownerToken, meetingId, fileId).expect(200)).body as FileDetails;
      expect(file).toMatchObject({ kind: 'IMAGE', status: 'READY', summary: null });
      expect(summarizer.calls).toBe(0);
    });

    it('keeps recordings READY at once until they are transcribed (Phase 9)', async () => {
      const fileId = await upload(ownerToken, meetingId, fakeMp4(4096), 'call.mp4', MIME.mp4);

      const file = (await details(ownerToken, meetingId, fileId).expect(200)).body as FileDetails;
      expect(file).toMatchObject({ kind: 'VIDEO', status: 'READY', summary: null });
    });
  });

  describe('GET /meetings/:id/files/:fileId', () => {
    it('gives the details to a participant too', async () => {
      const fileId = await uploadFixture(ownerToken, meetingId, 'notes.txt');
      await settled(ownerToken, meetingId, fileId);

      const res = await details(participantToken, meetingId, fileId).expect(200);
      expect(res.body).toMatchObject({ id: fileId, status: 'READY' });
      expect((res.body as FileDetails).summary).toContain(FIXTURE_TEXT);
    });

    it('answers 404 to a stranger, for a missing file and for an upload in progress', async () => {
      const fileId = await uploadFixture(ownerToken, meetingId, 'notes.txt');
      await settled(ownerToken, meetingId, fileId);
      await details(strangerToken, meetingId, fileId).expect(404);
      await details(ownerToken, meetingId, '00000000-0000-4000-8000-000000000000').expect(404);

      const created = await request(server())
        .post('/uploads')
        .set(tus(ownerToken))
        .set('Upload-Length', '100')
        .set(
          'Upload-Metadata',
          tusMetadata({ meetingId, filename: 'partial.txt', filetype: MIME.txt }),
        )
        .expect(201);
      const uploading = created.headers.location.split('/').pop() as string;
      await details(ownerToken, meetingId, uploading).expect(404);
    });

    it('answers 401 without a token and 400 for a malformed id', async () => {
      await request(server()).get(`/meetings/${meetingId}/files/${meetingId}`).expect(401);
      await details(ownerToken, meetingId, 'not-a-uuid').expect(400);
    });
  });

  describe('POST /meetings/:id/files/:fileId/retry', () => {
    it('processes a failed document again, to READY with a summary', async () => {
      summarizer.behave('fail');
      const fileId = await uploadFixture(ownerToken, meetingId, 'notes.docx');
      expect(await settled(ownerToken, meetingId, fileId)).toMatchObject({ status: 'FAILED' });

      summarizer.behave('ok');
      const res = await retry(ownerToken, meetingId, fileId).expect(202);
      expect(res.body).toMatchObject({ id: fileId, status: 'PROCESSING', failureReason: null });

      const file = await settled(ownerToken, meetingId, fileId);
      expect(file).toMatchObject({ status: 'READY', failureReason: null });
      expect(file.summary).toContain(FIXTURE_TEXT);
    });

    it('answers 409 for a file that has not failed', async () => {
      const fileId = await uploadFixture(ownerToken, meetingId, 'notes.txt');
      await settled(ownerToken, meetingId, fileId);
      await retry(ownerToken, meetingId, fileId).expect(409);

      const image = await upload(ownerToken, meetingId, fakePng(), 'retry.png', MIME.png);
      await retry(ownerToken, meetingId, image).expect(409);
    });

    it('answers 403 to a participant and 404 to a stranger or for a missing file', async () => {
      summarizer.behave('fail');
      const fileId = await uploadFixture(ownerToken, meetingId, 'notes.txt');
      await settled(ownerToken, meetingId, fileId);

      await retry(participantToken, meetingId, fileId).expect(403);
      await retry(strangerToken, meetingId, fileId).expect(404);
      await retry(ownerToken, meetingId, '00000000-0000-4000-8000-000000000000').expect(404);
      // Nothing was retried: the file is still FAILED.
      const file = (await details(ownerToken, meetingId, fileId).expect(200)).body as FileDetails;
      expect(file.status).toBe('FAILED');
    });
  });

  describe('deleting a file during processing', () => {
    it('removes it, and the finishing job does not bring it or its summary back', async () => {
      const release = summarizer.hold();
      const fileId = await uploadFixture(ownerToken, meetingId, 'notes.txt');
      await summarizer.started();

      await request(server())
        .delete(`/meetings/${meetingId}/files/${fileId}`)
        .set(auth(ownerToken))
        .expect(204);

      // The job finishes its summary after the file is gone.
      release();
      await summarizer.finished();
      await new Promise((resolve) => setTimeout(resolve, 500));

      const prisma = app.get(PrismaService);
      expect(await prisma.meetingFile.findUnique({ where: { id: fileId } })).toBeNull();
      expect(await prisma.meetingFileSummary.findUnique({ where: { fileId } })).toBeNull();
      await details(ownerToken, meetingId, fileId).expect(404);
    });
  });

  describe('stuck processing', () => {
    it('fails a file left PROCESSING longer than the job timeout (e.g. after a crash)', async () => {
      const fileId = await uploadFixture(ownerToken, meetingId, 'notes.txt');
      await settled(ownerToken, meetingId, fileId);

      const prisma = app.get(PrismaService);
      await prisma.meetingFile.update({
        where: { id: fileId },
        data: { status: 'PROCESSING', updatedAt: new Date(Date.now() - 24 * 60 * 60 * 1000) },
      });

      const failed = await app.get(CommandBus).execute(new FailStuckProcessingCommand());
      expect(failed).toBeGreaterThanOrEqual(1);
      const file = (await details(ownerToken, meetingId, fileId).expect(200)).body as FileDetails;
      expect(file).toMatchObject({ status: 'FAILED', failureReason: 'Processing was interrupted' });
    });
  });
});

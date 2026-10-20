import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { mkdtemp, readFile, readdir, rm, utimes, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { Server } from 'node:http';
import request from 'supertest';
import { CommandBus } from '@nestjs/cqrs';
import { AppModule } from './../src/app.module.js';
import {
  CleanupAbandonedUploadsCommand,
  SweepOrphanFilesCommand,
} from './../src/meeting-files/commands/index.js';
import { PrismaService } from './../src/prisma/prisma.service.js';
import {
  TUS_VERSION,
  binaryParser,
  fakeMp4,
  fakePng,
  interruptedPatch,
  sha256,
  tusMetadata,
} from './tus.helpers.js';

interface FileBody {
  id: string;
  meetingId: string;
  originalName: string;
  mimeType: string;
  kind: string;
  size: number;
  status: string;
  createdAt: string;
}

interface LinkBody {
  url: string;
  expiresAt: string;
}

const MAX_FILE_SIZE = 2 * 1024 ** 3;
const PDF_FIXTURE = path.join(import.meta.dirname, 'fixtures', 'notes.pdf');
const MiB = 1024 ** 2;

describe('Meeting files (e2e)', () => {
  let app: INestApplication;
  let filesDir: string;

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
      .send({ title: 'Files', startsAt: '2030-01-01T10:00:00.000Z' })
      .expect(201);
    return (res.body as { id: string }).id;
  };

  const createUpload = (
    token: string,
    meetingId: string,
    size: number,
    filename = 'recording.mp4',
    filetype = 'video/mp4',
  ) =>
    request(server())
      .post('/uploads')
      .set(tus(token))
      .set('Upload-Length', String(size))
      .set('Upload-Metadata', tusMetadata({ meetingId, filename, filetype }));

  const patchChunk = (token: string, location: string, offset: number, chunk: Buffer) =>
    request(server())
      .patch(location)
      .set(tus(token))
      .set('Upload-Offset', String(offset))
      .set('Content-Type', 'application/offset+octet-stream')
      .send(chunk);

  const headOffset = async (token: string, location: string): Promise<number> => {
    const res = await request(server()).head(location).set(tus(token)).expect(200);
    return Number(res.headers['upload-offset']);
  };

  /** Creates an upload and sends `data` in chunks of `chunkSize`; returns the upload location. */
  const upload = async (
    token: string,
    meetingId: string,
    data: Buffer,
    filename = 'recording.mp4',
    filetype = 'video/mp4',
    chunkSize = MiB,
  ): Promise<string> => {
    const created = await createUpload(token, meetingId, data.length, filename, filetype).expect(
      201,
    );
    const location = created.headers.location;
    for (let offset = 0; offset < data.length; offset += chunkSize) {
      const chunk = data.subarray(offset, offset + chunkSize);
      await patchChunk(token, location, offset, chunk).expect(204);
    }
    return location;
  };

  const fileIdOf = (location: string) => location.split('/').pop() as string;

  const listFiles = async (token: string, meetingId: string): Promise<FileBody[]> => {
    const res = await request(server())
      .get(`/meetings/${meetingId}/files`)
      .set(auth(token))
      .expect(200);
    return res.body as FileBody[];
  };

  const requestLink = (token: string, meetingId: string, fileId: string) =>
    request(server()).post(`/meetings/${meetingId}/files/${fileId}/link`).set(auth(token));

  const download = (url: string) => request(server()).get(url).buffer(true).parse(binaryParser);

  const cancelUpload = (token: string, location: string) =>
    request(server()).delete(location).set(tus(token));

  const deleteFile = (token: string, meeting: string, fileId: string) =>
    request(server()).delete(`/meetings/${meeting}/files/${fileId}`).set(auth(token));

  /** Names in the storage directory that belong to a file (its data and its tus metadata). */
  const storedEntries = async (fileId: string): Promise<string[]> =>
    (await readdir(path.join(filesDir, 'uploads'))).filter((name) => name.startsWith(fileId));

  let ownerToken: string;
  let otherToken: string;
  let meetingId: string;
  let foreignMeetingId: string;

  beforeAll(async () => {
    filesDir = await mkdtemp(path.join(tmpdir(), 'meeting-files-e2e-'));
    process.env.FILES_DIR = filesDir;

    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true }));
    // A real port is needed to cut a request in the middle (resume test).
    await app.listen(0, '127.0.0.1');

    ownerToken = await signUp('files-owner');
    otherToken = await signUp('files-other');
    meetingId = await createMeeting(ownerToken);
    foreignMeetingId = await createMeeting(otherToken);
  });

  afterAll(async () => {
    // Meetings and their files are removed together with their owners (cascade).
    await app.get(PrismaService).user.deleteMany({
      where: { email: { endsWith: `-${runId}@example.com` } },
    });
    await app.close();
    await rm(filesDir, { recursive: true, force: true, maxRetries: 5 });
  });

  describe('resumable upload (tus)', () => {
    it('uploads a file in chunks and lists it only once it is complete', async () => {
      const data = fakeMp4(3 * MiB + 123);
      const created = await createUpload(ownerToken, meetingId, data.length, 'Chunked.mp4').expect(
        201,
      );
      const location = created.headers.location;
      expect(location).toMatch(/^\/uploads\/[0-9a-f-]{36}$/);

      await patchChunk(ownerToken, location, 0, data.subarray(0, 2 * MiB)).expect(204);
      expect(await headOffset(ownerToken, location)).toBe(2 * MiB);

      // An UPLOADING file is not part of the list.
      const before = await listFiles(ownerToken, meetingId);
      expect(before.map((file) => file.id)).not.toContain(fileIdOf(location));

      const last = await patchChunk(ownerToken, location, 2 * MiB, data.subarray(2 * MiB)).expect(
        204,
      );
      expect(Number(last.headers['upload-offset'])).toBe(data.length);

      const after = await listFiles(ownerToken, meetingId);
      const file = after.find((item) => item.id === fileIdOf(location));
      expect(file).toMatchObject({
        meetingId,
        originalName: 'Chunked.mp4',
        mimeType: 'video/mp4',
        kind: 'VIDEO',
        size: data.length,
        status: 'READY',
      });
    });

    it('rejects a chunk sent at a wrong offset (409)', async () => {
      const data = fakeMp4(MiB);
      const created = await createUpload(ownerToken, meetingId, data.length).expect(201);
      const location = created.headers.location;

      // A small body: tus answers before reading it and closes the connection.
      await patchChunk(ownerToken, location, 100, data.subarray(100, 110)).expect(409);
    });

    it('resumes an interrupted upload from the offset reported by the server', async () => {
      const data = fakeMp4(3 * MiB);
      const created = await createUpload(ownerToken, meetingId, data.length, 'Resumed.mp4').expect(
        201,
      );
      const location = created.headers.location;

      await interruptedPatch(
        server(),
        location,
        {
          ...tus(ownerToken),
          'Upload-Offset': '0',
          'Content-Type': 'application/offset+octet-stream',
        },
        data,
        MiB + 7,
      );

      const offset = await headOffset(ownerToken, location);
      expect(offset).toBeGreaterThan(0);
      expect(offset).toBeLessThan(data.length);

      await patchChunk(ownerToken, location, offset, data.subarray(offset)).expect(204);

      const link = await requestLink(ownerToken, meetingId, fileIdOf(location)).expect(201);
      const res = await download((link.body as LinkBody).url).expect(200);
      expect(sha256(res.body as Buffer)).toBe(sha256(data));
    });

    it('records the time of the last chunk', async () => {
      const data = fakeMp4(2 * MiB);
      const created = await createUpload(ownerToken, meetingId, data.length).expect(201);
      const location = created.headers.location;
      const prisma = app.get(PrismaService);
      const longAgo = new Date('2020-01-01T00:00:00.000Z');
      await prisma.meetingFile.update({
        where: { id: fileIdOf(location) },
        data: { lastChunkAt: longAgo },
      });

      await patchChunk(ownerToken, location, 0, data.subarray(0, MiB)).expect(204);

      const file = await prisma.meetingFile.findUniqueOrThrow({
        where: { id: fileIdOf(location) },
      });
      expect(file.lastChunkAt.getTime()).toBeGreaterThan(longAgo.getTime());
    });

    it('completes on HEAD an upload whose completion failed after the last chunk', async () => {
      const data = fakeMp4(MiB);
      const location = await upload(ownerToken, meetingId, data);
      // Simulate a failed completion hook (e.g. a database error): all bytes stored, row UPLOADING.
      await app.get(PrismaService).meetingFile.update({
        where: { id: fileIdOf(location) },
        data: { status: 'UPLOADING', completedAt: null },
      });
      expect((await listFiles(ownerToken, meetingId)).map((f) => f.id)).not.toContain(
        fileIdOf(location),
      );

      // tus-js-client retries with HEAD; it sees the full offset and reports success.
      expect(await headOffset(ownerToken, location)).toBe(data.length);

      const file = (await listFiles(ownerToken, meetingId)).find(
        (item) => item.id === fileIdOf(location),
      );
      expect(file).toMatchObject({ status: 'READY', size: data.length });
    });

    it('rejects writing to a completed upload (409)', async () => {
      const data = fakeMp4(1024);
      const location = await upload(ownerToken, meetingId, data);

      await patchChunk(ownerToken, location, data.length, Buffer.from('x')).expect(409);
    });

    it('accepts a plain text document', async () => {
      const data = Buffer.from('Meeting notes\nAction items: none\n', 'utf8');
      const location = await upload(ownerToken, meetingId, data, 'notes.txt', 'text/plain');

      const file = (await listFiles(ownerToken, meetingId)).find(
        (item) => item.id === fileIdOf(location),
      );
      expect(file).toMatchObject({ mimeType: 'text/plain', kind: 'DOCUMENT' });
      // A document is summarized in the background (meeting-file-processing.e2e-spec.ts).
      expect(['PROCESSING', 'READY']).toContain(file?.status);
    });

    it('rejects a disallowed file type (400)', async () => {
      await createUpload(
        ownerToken,
        meetingId,
        1024,
        'setup.exe',
        'application/x-msdownload',
      ).expect(400);
    });

    it('rejects a type that does not match the extension (400)', async () => {
      await createUpload(ownerToken, meetingId, 1024, 'slides.pdf', 'video/mp4').expect(400);
    });

    it('rejects a file whose content does not match its type and does not list it', async () => {
      const data = Buffer.from('this is not a video', 'utf8');
      const created = await createUpload(ownerToken, meetingId, data.length, 'fake.mp4').expect(
        201,
      );
      const location = created.headers.location;

      await patchChunk(ownerToken, location, 0, data).expect(400);

      const files = await listFiles(ownerToken, meetingId);
      expect(files.map((file) => file.id)).not.toContain(fileIdOf(location));
      expect(await readdir(path.join(filesDir, 'uploads'))).not.toContain(fileIdOf(location));
    });

    it('rejects a declared size over 2 GB (413)', async () => {
      await createUpload(ownerToken, meetingId, MAX_FILE_SIZE + 1).expect(413);
    });

    it('rejects an upload without meeting metadata (400)', async () => {
      await request(server())
        .post('/uploads')
        .set(tus(ownerToken))
        .set('Upload-Length', '1024')
        .set('Upload-Metadata', tusMetadata({ filename: 'a.mp4', filetype: 'video/mp4' }))
        .expect(400);
    });

    it("rejects an upload to another user's meeting (404)", async () => {
      await createUpload(ownerToken, foreignMeetingId, 1024).expect(404);
    });

    it("hides another user's upload from HEAD and PATCH (404)", async () => {
      const data = fakeMp4(1024);
      const created = await createUpload(ownerToken, meetingId, data.length).expect(201);
      const location = created.headers.location;

      await request(server()).head(location).set(tus(otherToken)).expect(404);
      await patchChunk(otherToken, location, 0, data).expect(404);
    });

    it('rejects requests without a token (401)', async () => {
      await request(server())
        .post('/uploads')
        .set('Tus-Resumable', TUS_VERSION)
        .set('Upload-Length', '1024')
        .set(
          'Upload-Metadata',
          tusMetadata({ meetingId, filename: 'a.mp4', filetype: 'video/mp4' }),
        )
        .expect(401);

      const created = await createUpload(ownerToken, meetingId, 1024).expect(201);
      await request(server())
        .head(created.headers.location)
        .set('Tus-Resumable', TUS_VERSION)
        .expect(401);
    });
  });

  describe('GET /meetings/:id/files', () => {
    it("hides another user's meeting (404)", async () => {
      await request(server())
        .get(`/meetings/${foreignMeetingId}/files`)
        .set(auth(ownerToken))
        .expect(404);
    });

    it('rejects a non-UUID meeting id (400)', async () => {
      await request(server()).get('/meetings/not-a-uuid/files').set(auth(ownerToken)).expect(400);
    });

    it('rejects a request without a token (401)', async () => {
      await request(server()).get(`/meetings/${meetingId}/files`).expect(401);
    });
  });

  describe('download', () => {
    it('downloads the original byte for byte with its original name', async () => {
      const data = fakeMp4(2 * MiB + 5);
      const location = await upload(ownerToken, meetingId, data, 'Weekly sync.mp4');

      const link = await requestLink(ownerToken, meetingId, fileIdOf(location)).expect(201);
      const { url, expiresAt } = link.body as LinkBody;
      expect(url).toMatch(new RegExp(`^/files/${fileIdOf(location)}/content\\?token=`));
      expect(new Date(expiresAt).getTime()).toBeGreaterThan(Date.now());

      const res = await download(url).expect(200);
      expect(res.headers['content-type']).toBe('video/mp4');
      expect(res.headers['content-disposition']).toContain('attachment');
      expect(res.headers['content-disposition']).toContain('filename="Weekly sync.mp4"');
      expect(res.headers['x-content-type-options']).toBe('nosniff');
      expect(res.headers['referrer-policy']).toBe('no-referrer');
      expect(sha256(res.body as Buffer)).toBe(sha256(data));
    });

    it('keeps a non-ASCII file name', async () => {
      const location = await upload(ownerToken, meetingId, fakeMp4(1024), 'Встреча.mp4');

      const link = await requestLink(ownerToken, meetingId, fileIdOf(location)).expect(201);
      const res = await download((link.body as LinkBody).url).expect(200);
      expect(res.headers['content-disposition']).toContain(
        `filename*=UTF-8''${encodeURIComponent('Встреча.mp4')}`,
      );
    });

    it('serves a PDF or an image inline for a preview when asked', async () => {
      const pdf = await upload(
        ownerToken,
        meetingId,
        await readFile(PDF_FIXTURE),
        'notes.pdf',
        'application/pdf',
      );
      const png = await upload(ownerToken, meetingId, fakePng(), 'board.png', 'image/png');

      for (const [location, type, name] of [
        [pdf, 'application/pdf', 'notes.pdf'],
        [png, 'image/png', 'board.png'],
      ]) {
        const link = await requestLink(ownerToken, meetingId, fileIdOf(location)).expect(201);
        const res = await download(`${(link.body as LinkBody).url}&disposition=inline`).expect(200);
        expect(res.headers['content-type']).toBe(type);
        expect(res.headers['content-disposition']).toBe(`inline; filename="${name}"`);
        expect(res.headers['x-content-type-options']).toBe('nosniff');
      }
    });

    it('keeps other types an attachment even when inline is asked', async () => {
      const location = await upload(ownerToken, meetingId, fakeMp4(1024), 'call.mp4');

      const link = await requestLink(ownerToken, meetingId, fileIdOf(location)).expect(201);
      const res = await download(`${(link.body as LinkBody).url}&disposition=inline`).expect(200);
      expect(res.headers['content-disposition']).toBe('attachment; filename="call.mp4"');
    });

    it('does not issue a link for an upload that is not complete (404)', async () => {
      const created = await createUpload(ownerToken, meetingId, 1024).expect(201);
      await requestLink(ownerToken, meetingId, fileIdOf(created.headers.location)).expect(404);
    });

    it("does not issue a link for another user's file (404)", async () => {
      const location = await upload(otherToken, foreignMeetingId, fakeMp4(1024));
      const fileId = fileIdOf(location);

      await requestLink(ownerToken, foreignMeetingId, fileId).expect(404);
      // A file of another meeting is not reachable through one's own meeting either.
      await requestLink(ownerToken, meetingId, fileId).expect(404);
    });

    it('does not issue a link without a token (401)', async () => {
      await request(server())
        .post(`/meetings/${meetingId}/files/00000000-0000-4000-8000-000000000000/link`)
        .expect(401);
    });

    it('rejects a missing or forged download token (401)', async () => {
      const location = await upload(ownerToken, meetingId, fakeMp4(1024));
      const fileId = fileIdOf(location);

      await request(server()).get(`/files/${fileId}/content`).expect(401);
      await request(server()).get(`/files/${fileId}/content?token=forged`).expect(401);
    });

    it('rejects a token issued for another file (401)', async () => {
      const first = fileIdOf(await upload(ownerToken, meetingId, fakeMp4(1024)));
      const second = fileIdOf(await upload(ownerToken, meetingId, fakeMp4(1024)));

      const link = await requestLink(ownerToken, meetingId, first).expect(201);
      const token = new URL((link.body as LinkBody).url, 'http://x').searchParams.get('token');

      await request(server()).get(`/files/${second}/content?token=${token}`).expect(401);
    });
  });

  describe('cancel an upload (tus termination)', () => {
    it('removes the upload and its partial data', async () => {
      const data = fakeMp4(2 * MiB);
      const created = await createUpload(ownerToken, meetingId, data.length).expect(201);
      const location = created.headers.location;
      const fileId = fileIdOf(location);
      await patchChunk(ownerToken, location, 0, data.subarray(0, MiB)).expect(204);
      expect(await storedEntries(fileId)).not.toHaveLength(0);

      await cancelUpload(ownerToken, location).expect(204);

      expect(await storedEntries(fileId)).toEqual([]);
      expect(await app.get(PrismaService).meetingFile.findUnique({ where: { id: fileId } })).toBe(
        null,
      );
      await request(server()).head(location).set(tus(ownerToken)).expect(404);
      // A small body: tus answers before reading it and closes the connection.
      await patchChunk(ownerToken, location, MiB, data.subarray(MiB, MiB + 10)).expect(404);
      expect((await listFiles(ownerToken, meetingId)).map((file) => file.id)).not.toContain(fileId);
    });

    it('cancels an upload that has received no data yet', async () => {
      const created = await createUpload(ownerToken, meetingId, 1024).expect(201);
      const fileId = fileIdOf(created.headers.location);

      await cancelUpload(ownerToken, created.headers.location).expect(204);

      expect(await storedEntries(fileId)).toEqual([]);
    });

    it('does not cancel a completed upload (409) and keeps the file', async () => {
      const data = fakeMp4(1024);
      const location = await upload(ownerToken, meetingId, data);
      const fileId = fileIdOf(location);

      await cancelUpload(ownerToken, location).expect(409);

      expect(await storedEntries(fileId)).toContain(fileId);
      const link = await requestLink(ownerToken, meetingId, fileId).expect(201);
      const res = await download((link.body as LinkBody).url).expect(200);
      expect(sha256(res.body as Buffer)).toBe(sha256(data));
    });

    it("hides another user's upload (404) and keeps its data", async () => {
      const created = await createUpload(ownerToken, meetingId, 1024).expect(201);
      const location = created.headers.location;

      await cancelUpload(otherToken, location).expect(404);

      expect(await headOffset(ownerToken, location)).toBe(0);
    });

    it('rejects a cancel without a token (401)', async () => {
      const created = await createUpload(ownerToken, meetingId, 1024).expect(201);

      await request(server())
        .delete(created.headers.location)
        .set('Tus-Resumable', TUS_VERSION)
        .expect(401);
    });
  });

  describe('resume after an interrupted chunk', () => {
    it('continues a later chunk from the stored offset', async () => {
      const data = fakeMp4(4 * MiB + 11);
      const created = await createUpload(ownerToken, meetingId, data.length, 'Later.mp4').expect(
        201,
      );
      const location = created.headers.location;
      await patchChunk(ownerToken, location, 0, data.subarray(0, MiB)).expect(204);

      // The second chunk is cut by the network after part of it has arrived.
      await interruptedPatch(
        server(),
        location,
        {
          ...tus(ownerToken),
          'Upload-Offset': String(MiB),
          'Content-Type': 'application/offset+octet-stream',
        },
        data.subarray(MiB, 3 * MiB),
        MiB / 2,
      );

      const offset = await headOffset(ownerToken, location);
      expect(offset).toBeGreaterThan(MiB);
      expect(offset).toBeLessThan(3 * MiB);
      // The stored offset is authoritative: resending from the start of the chunk is refused.
      await patchChunk(ownerToken, location, MiB, data.subarray(MiB, MiB + 10)).expect(409);

      for (let from = offset; from < data.length; from += MiB) {
        await patchChunk(ownerToken, location, from, data.subarray(from, from + MiB)).expect(204);
      }

      const link = await requestLink(ownerToken, meetingId, fileIdOf(location)).expect(201);
      const res = await download((link.body as LinkBody).url).expect(200);
      expect(sha256(res.body as Buffer)).toBe(sha256(data));
    });
  });

  describe('abandoned upload cleanup', () => {
    // The suites share the dev database: the cutoff is far in the past and only rows this suite
    // moved before it are candidates, so uploads of a developer are never touched.
    const cutoff = new Date('2000-01-02T00:00:00.000Z');
    const abandonedAt = new Date('2000-01-01T00:00:00.000Z');
    const cleanUp = () => app.get(CommandBus).execute(new CleanupAbandonedUploadsCommand(cutoff));
    const setLastChunkAt = (id: string, lastChunkAt: Date) =>
      app.get(PrismaService).meetingFile.update({ where: { id }, data: { lastChunkAt } });

    it('removes uploads with no chunk since the cutoff, with their partial data', async () => {
      const data = fakeMp4(2 * MiB);
      const created = await createUpload(ownerToken, meetingId, data.length).expect(201);
      const location = created.headers.location;
      const fileId = fileIdOf(location);
      await patchChunk(ownerToken, location, 0, data.subarray(0, MiB)).expect(204);
      await setLastChunkAt(fileId, abandonedAt);

      expect(await cleanUp()).toBeGreaterThanOrEqual(1);

      expect(await storedEntries(fileId)).toEqual([]);
      expect(await app.get(PrismaService).meetingFile.findUnique({ where: { id: fileId } })).toBe(
        null,
      );
      await request(server()).head(location).set(tus(ownerToken)).expect(404);
    });

    it('keeps active uploads and completed files', async () => {
      const active = await createUpload(ownerToken, meetingId, 1024).expect(201);
      const activeId = fileIdOf(active.headers.location);
      await setLastChunkAt(activeId, new Date('2000-01-03T00:00:00.000Z'));
      const completedId = fileIdOf(await upload(ownerToken, meetingId, fakeMp4(1024)));
      await setLastChunkAt(completedId, abandonedAt);

      await cleanUp();

      expect(await headOffset(ownerToken, active.headers.location)).toBe(0);
      expect(await storedEntries(completedId)).toContain(completedId);
      expect((await listFiles(ownerToken, meetingId)).map((file) => file.id)).toContain(
        completedId,
      );
    });

    it('completes an upload whose bytes are all stored instead of removing it', async () => {
      const data = fakeMp4(MiB);
      const fileId = fileIdOf(await upload(ownerToken, meetingId, data));
      // A failed completion hook that the client never retried: all bytes stored, row UPLOADING.
      await app.get(PrismaService).meetingFile.update({
        where: { id: fileId },
        data: { status: 'UPLOADING', completedAt: null, lastChunkAt: abandonedAt },
      });

      await cleanUp();

      const file = (await listFiles(ownerToken, meetingId)).find((item) => item.id === fileId);
      expect(file).toMatchObject({ status: 'READY', size: data.length });
      expect(await storedEntries(fileId)).toContain(fileId);
    });
  });

  describe('orphan file sweep', () => {
    const sweep = () => app.get(CommandBus).execute(new SweepOrphanFilesCommand(new Date()));

    it('removes old files without a row and keeps the files of existing rows', async () => {
      const orphanId = randomUUID();
      const orphanPath = path.join(filesDir, 'uploads', orphanId);
      await writeFile(orphanPath, 'left behind');
      await writeFile(`${orphanPath}.json`, '{}');
      const old = new Date(Date.now() - 2 * 60 * 60 * 1000);
      await utimes(orphanPath, old, old);
      await utimes(`${orphanPath}.json`, old, old);
      const keptId = fileIdOf(await upload(ownerToken, meetingId, fakeMp4(1024)));
      const pending = await createUpload(ownerToken, meetingId, 1024).expect(201);
      const pendingId = fileIdOf(pending.headers.location);

      expect(await sweep()).toBeGreaterThanOrEqual(1);

      expect(await storedEntries(orphanId)).toEqual([]);
      expect(await storedEntries(keptId)).toContain(keptId);
      expect(await storedEntries(pendingId)).toContain(pendingId);
    });

    it('keeps a recent file without a row (removal may still be in progress)', async () => {
      const recentId = randomUUID();
      await writeFile(path.join(filesDir, 'uploads', recentId), 'just written');

      await app.get(CommandBus).execute(new SweepOrphanFilesCommand());

      expect(await storedEntries(recentId)).toEqual([recentId]);
    });
  });

  describe('DELETE /meetings/:id/files/:fileId', () => {
    it('removes the file, its stored original, its list entry and its download links', async () => {
      const location = await upload(ownerToken, meetingId, fakeMp4(MiB), 'Delete me.mp4');
      const fileId = fileIdOf(location);
      const link = await requestLink(ownerToken, meetingId, fileId).expect(201);

      await deleteFile(ownerToken, meetingId, fileId).expect(204);

      expect(await storedEntries(fileId)).toEqual([]);
      expect((await listFiles(ownerToken, meetingId)).map((file) => file.id)).not.toContain(fileId);
      await requestLink(ownerToken, meetingId, fileId).expect(404);
      // A link issued before the delete stops working although its token has not expired.
      await download((link.body as LinkBody).url).expect(404);
      await deleteFile(ownerToken, meetingId, fileId).expect(404);
    });

    it('does not delete an upload in progress (404); it is cancelled through tus', async () => {
      const created = await createUpload(ownerToken, meetingId, 1024).expect(201);

      await deleteFile(ownerToken, meetingId, fileIdOf(created.headers.location)).expect(404);

      expect(await headOffset(ownerToken, created.headers.location)).toBe(0);
    });

    it("hides another user's file (404) and keeps it", async () => {
      const location = await upload(otherToken, foreignMeetingId, fakeMp4(1024));
      const fileId = fileIdOf(location);

      await deleteFile(ownerToken, foreignMeetingId, fileId).expect(404);
      await deleteFile(ownerToken, meetingId, fileId).expect(404);

      expect(await storedEntries(fileId)).toContain(fileId);
      expect((await listFiles(otherToken, foreignMeetingId)).map((file) => file.id)).toContain(
        fileId,
      );
    });

    it('rejects a non-UUID id (400)', async () => {
      await deleteFile(ownerToken, meetingId, 'not-a-uuid').expect(400);
    });

    it('rejects a request without a token (401)', async () => {
      await request(server())
        .delete(`/meetings/${meetingId}/files/00000000-0000-4000-8000-000000000000`)
        .expect(401);
    });
  });
});

import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { Server } from 'node:http';
import request from 'supertest';
import { AppModule } from './../src/app.module.js';
import { PrismaService } from './../src/prisma/prisma.service.js';
import {
  TUS_VERSION,
  binaryParser,
  fakeMp4,
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

    it('accepts a plain text document', async () => {
      const data = Buffer.from('Meeting notes\nAction items: none\n', 'utf8');
      const location = await upload(ownerToken, meetingId, data, 'notes.txt', 'text/plain');

      const file = (await listFiles(ownerToken, meetingId)).find(
        (item) => item.id === fileIdOf(location),
      );
      expect(file).toMatchObject({ mimeType: 'text/plain', kind: 'DOCUMENT', status: 'READY' });
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
});

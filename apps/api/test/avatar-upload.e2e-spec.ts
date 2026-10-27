import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { Server } from 'node:http';
import request from 'supertest';
import { AppModule } from './../src/app.module.js';
import { PrismaService } from './../src/prisma/prisma.service.js';
import { TUS_VERSION, fakePng, tusMetadata } from './tus.helpers.js';

const MiB = 1024 ** 2;
const MAX_AVATAR_SIZE = 5 * MiB;

/** A JPEG start of image and JFIF APP0 marker followed by filler bytes: detected as image/jpeg. */
const fakeJpeg = (): Buffer =>
  Buffer.concat([
    Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]),
    Buffer.from('JFIF\0'),
    Buffer.alloc(64, 1),
  ]);

/** A RIFF container of form type WEBP with a VP8 chunk followed by filler bytes: image/webp. */
const fakeWebp = (): Buffer => {
  const chunk = Buffer.concat([Buffer.from('VP8 '), Buffer.from([56, 0, 0, 0]), randomBytes(56)]);
  const size = Buffer.alloc(4);
  size.writeUInt32LE(4 + chunk.length);
  return Buffer.concat([Buffer.from('RIFF'), size, Buffer.from('WEBP'), chunk]);
};

describe('Avatar upload (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
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

  const userIdOf = async (name: string): Promise<string> =>
    (await prisma.user.findUniqueOrThrow({ where: { email: email(name) } })).id;

  /** Starts an avatar upload: `purpose=avatar` and no `meetingId` in the metadata. */
  const createAvatarUpload = (token: string, size: number, filename: string, filetype: string) =>
    request(server())
      .post('/uploads')
      .set(tus(token))
      .set('Upload-Length', String(size))
      .set('Upload-Metadata', tusMetadata({ purpose: 'avatar', filename, filetype }));

  const patchChunk = (token: string, location: string, offset: number, chunk: Buffer) =>
    request(server())
      .patch(location)
      .set(tus(token))
      .set('Upload-Offset', String(offset))
      .set('Content-Type', 'application/offset+octet-stream')
      .send(chunk);

  const uploadIdOf = (location: string) => location.split('/').pop() as string;

  /** Names in the storage directory that belong to an upload (its data and its tus metadata). */
  const storedEntries = async (uploadId: string): Promise<string[]> =>
    (await readdir(path.join(filesDir, 'uploads'))).filter((name) => name.startsWith(uploadId));

  /** Number of entries in the storage directory, to check that nothing was stored. */
  const storedCount = async (): Promise<number> =>
    (await readdir(path.join(filesDir, 'uploads'))).length;

  let ownerToken: string;
  let otherToken: string;
  let ownerId: string;
  let meetingId: string;

  beforeAll(async () => {
    filesDir = await mkdtemp(path.join(tmpdir(), 'avatar-upload-e2e-'));
    process.env.FILES_DIR = filesDir;

    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true }));
    await app.init();
    prisma = app.get(PrismaService);

    ownerToken = await signUp('avatar-owner');
    otherToken = await signUp('avatar-other');
    ownerId = await userIdOf('avatar-owner');

    const meeting = await request(server())
      .post('/meetings')
      .set(auth(ownerToken))
      .send({ title: 'Avatar', startsAt: '2030-01-01T10:00:00.000Z' })
      .expect(201);
    meetingId = (meeting.body as { id: string }).id;
  });

  afterAll(async () => {
    // Avatar uploads and meetings are removed together with their users (cascade).
    await prisma.user.deleteMany({ where: { email: { endsWith: `-${runId}@example.com` } } });
    await app.close();
    await rm(filesDir, { recursive: true, force: true, maxRetries: 5 });
  });

  describe('POST /uploads with purpose=avatar', () => {
    it.each([
      ['PNG', 'me.png', 'image/png', fakePng()],
      ['JPEG', 'me.jpg', 'image/jpeg', fakeJpeg()],
      ['WebP', 'me.webp', 'image/webp', fakeWebp()],
    ])('uploads a %s avatar without a meeting', async (_kind, filename, filetype, data) => {
      const created = await createAvatarUpload(ownerToken, data.length, filename, filetype).expect(
        201,
      );
      const location = created.headers.location;
      expect(location).toMatch(/^\/uploads\/[0-9a-f-]{36}$/);
      const uploadId = uploadIdOf(location);

      const last = await patchChunk(ownerToken, location, 0, data).expect(204);
      expect(Number(last.headers['upload-offset'])).toBe(data.length);

      const avatar = await prisma.userAvatar.findUnique({ where: { id: uploadId } });
      expect(avatar).toMatchObject({
        userId: ownerId,
        mimeType: filetype,
        size: data.length,
        status: 'READY',
      });
      expect(await storedEntries(uploadId)).toContain(uploadId);
    });

    it('creates no meeting file and shows nothing in any meeting', async () => {
      const data = fakePng();
      const created = await createAvatarUpload(ownerToken, data.length, 'me.png', 'image/png');
      expect(created.status).toBe(201);
      const uploadId = uploadIdOf(created.headers.location);
      await patchChunk(ownerToken, created.headers.location, 0, data).expect(204);

      expect(await prisma.meetingFile.findUnique({ where: { id: uploadId } })).toBeNull();
      expect(await prisma.meetingFile.count({ where: { uploadedById: ownerId } })).toBe(0);

      const files = await request(server())
        .get(`/meetings/${meetingId}/files`)
        .set(auth(ownerToken))
        .expect(200);
      expect(files.body).toEqual([]);
    });

    it('rejects a type outside PNG, JPEG and WebP (400) before any data is stored', async () => {
      const before = await storedCount();
      const avatars = await prisma.userAvatar.count({ where: { userId: ownerId } });

      await createAvatarUpload(ownerToken, 1024, 'me.gif', 'image/gif').expect(400);
      await createAvatarUpload(ownerToken, 1024, 'notes.pdf', 'application/pdf').expect(400);

      expect(await storedCount()).toBe(before);
      expect(await prisma.userAvatar.count({ where: { userId: ownerId } })).toBe(avatars);
    });

    it('rejects a declared size over 5 MB (413) before any data is stored', async () => {
      const before = await storedCount();
      const avatars = await prisma.userAvatar.count({ where: { userId: ownerId } });

      await createAvatarUpload(ownerToken, MAX_AVATAR_SIZE + 1, 'me.png', 'image/png').expect(413);

      expect(await storedCount()).toBe(before);
      expect(await prisma.userAvatar.count({ where: { userId: ownerId } })).toBe(avatars);
    });

    it('rejects content that does not match the type (400) and removes row and data', async () => {
      const data = fakeJpeg();
      const created = await createAvatarUpload(ownerToken, data.length, 'me.png', 'image/png');
      expect(created.status).toBe(201);
      const location = created.headers.location;
      const uploadId = uploadIdOf(location);

      await patchChunk(ownerToken, location, 0, data).expect(400);

      expect(await prisma.userAvatar.findUnique({ where: { id: uploadId } })).toBeNull();
      expect(await storedEntries(uploadId)).toEqual([]);
    });
  });

  describe("another user's avatar upload", () => {
    it('is hidden from HEAD, PATCH and DELETE (404) and kept', async () => {
      const data = fakePng();
      const created = await createAvatarUpload(ownerToken, data.length, 'me.png', 'image/png');
      expect(created.status).toBe(201);
      const location = created.headers.location;
      const uploadId = uploadIdOf(location);

      await request(server()).head(location).set(tus(otherToken)).expect(404);
      // A small body: tus answers before reading it and closes the connection.
      await patchChunk(otherToken, location, 0, data.subarray(0, 10)).expect(404);
      await request(server()).delete(location).set(tus(otherToken)).expect(404);

      expect(await prisma.userAvatar.findUnique({ where: { id: uploadId } })).toMatchObject({
        userId: ownerId,
        status: 'UPLOADING',
      });
      expect(await storedEntries(uploadId)).toContain(uploadId);

      // The owner can still finish it.
      await patchChunk(ownerToken, location, 0, data).expect(204);
    });
  });

  describe('without a token', () => {
    it('rejects creating and continuing an avatar upload (401)', async () => {
      await request(server())
        .post('/uploads')
        .set('Tus-Resumable', TUS_VERSION)
        .set('Upload-Length', '1024')
        .set(
          'Upload-Metadata',
          tusMetadata({ purpose: 'avatar', filename: 'me.png', filetype: 'image/png' }),
        )
        .expect(401);

      const data = fakePng();
      const created = await createAvatarUpload(ownerToken, data.length, 'me.png', 'image/png');
      expect(created.status).toBe(201);
      const location = created.headers.location;

      await request(server()).head(location).set('Tus-Resumable', TUS_VERSION).expect(401);
      await request(server())
        .patch(location)
        .set('Tus-Resumable', TUS_VERSION)
        .set('Upload-Offset', '0')
        .set('Content-Type', 'application/offset+octet-stream')
        .send(data.subarray(0, 10))
        .expect(401);
      await request(server()).delete(location).set('Tus-Resumable', TUS_VERSION).expect(401);
    });
  });
});

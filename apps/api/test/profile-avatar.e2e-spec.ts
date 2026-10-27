import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { Server } from 'node:http';
import request from 'supertest';
import { AppModule } from './../src/app.module.js';
import { PrismaService } from './../src/prisma/prisma.service.js';
import { TUS_VERSION, binaryParser, fakePng, tusMetadata } from './tus.helpers.js';

interface ProfileBody {
  email: string;
  name: string | null;
  avatar: string | null;
}

/** A PNG that differs from `fakePng()` in its last byte, so a replaced avatar is told apart. */
const otherPng = (): Buffer => Buffer.concat([fakePng(), Buffer.from([7])]);

describe('Profile avatar (e2e)', () => {
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

  const getProfile = (token: string) => request(server()).get('/users/me').set(auth(token));
  const updateProfile = (token: string, body: object) =>
    request(server()).patch('/users/me').set(auth(token)).send(body);

  const avatarOf = async (token: string): Promise<string | null> =>
    ((await getProfile(token).expect(200)).body as ProfileBody).avatar;

  /**
   * Uploads an avatar through tus and returns its upload id. With `sentBytes` only that many bytes
   * are sent, which leaves the upload unfinished (`UPLOADING`).
   */
  const uploadAvatar = async (token: string, data = fakePng(), sentBytes = data.length) => {
    const created = await request(server())
      .post('/uploads')
      .set(tus(token))
      .set('Upload-Length', String(data.length))
      .set(
        'Upload-Metadata',
        tusMetadata({ purpose: 'avatar', filename: 'me.png', filetype: 'image/png' }),
      )
      .expect(201);
    const location = created.headers.location;
    await request(server())
      .patch(location)
      .set(tus(token))
      .set('Upload-Offset', '0')
      .set('Content-Type', 'application/offset+octet-stream')
      .send(data.subarray(0, sentBytes))
      .expect(204);
    return location.split('/').pop() as string;
  };

  /** Uploads an avatar and attaches it to the profile; returns its upload id and URL. */
  const setAvatar = async (token: string, data = fakePng()) => {
    const avatarUploadId = await uploadAvatar(token, data);
    const res = await updateProfile(token, { avatarUploadId }).expect(200);
    return { id: avatarUploadId, url: (res.body as ProfileBody).avatar as string };
  };

  const getContent = (url: string) => request(server()).get(url).buffer(true).parse(binaryParser);

  /** Names in the storage directory that belong to an upload (its data and its tus metadata). */
  const storedEntries = async (uploadId: string): Promise<string[]> =>
    (await readdir(path.join(filesDir, 'uploads'))).filter((name) => name.startsWith(uploadId));

  const avatarUrlPattern = (id: string) =>
    new RegExp(`^/avatars/${id}/content\\?token=[A-Za-z0-9._-]+$`);

  beforeAll(async () => {
    filesDir = await mkdtemp(path.join(tmpdir(), 'profile-avatar-e2e-'));
    process.env.FILES_DIR = filesDir;

    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true }));
    await app.init();
    prisma = app.get(PrismaService);
  });

  afterAll(async () => {
    // Avatars are removed together with their users (cascade).
    await prisma.user.deleteMany({ where: { email: { endsWith: `-${runId}@example.com` } } });
    await app.close();
    await rm(filesDir, { recursive: true, force: true, maxRetries: 5 });
  });

  describe('PATCH /users/me with avatarUploadId', () => {
    let token: string;
    let otherToken: string;

    beforeAll(async () => {
      token = await signUp('avatar-set');
      otherToken = await signUp('avatar-set-other');
    });

    it("sets the user's own completed avatar upload (200)", async () => {
      const avatarUploadId = await uploadAvatar(token);

      const res = await updateProfile(token, { avatarUploadId }).expect(200);

      const body = res.body as ProfileBody;
      expect(body).toMatchObject({ email: email('avatar-set'), name: null });
      expect(body.avatar).toMatch(avatarUrlPattern(avatarUploadId));
      expect(await avatarOf(token)).toMatch(avatarUrlPattern(avatarUploadId));
    });

    it('replaces the avatar and removes the previous one with its data', async () => {
      const previous = await setAvatar(token);

      const next = await setAvatar(token, otherPng());

      expect(next.url).toMatch(avatarUrlPattern(next.id));
      expect(await prisma.userAvatar.findUnique({ where: { id: previous.id } })).toBeNull();
      expect(await storedEntries(previous.id)).toEqual([]);
      expect(await storedEntries(next.id)).toContain(next.id);
    });

    it('keeps the avatar when only the name changes', async () => {
      const { id } = await setAvatar(token);

      const res = await updateProfile(token, { name: 'Ada' }).expect(200);

      expect((res.body as ProfileBody).avatar).toMatch(avatarUrlPattern(id));
    });

    it("rejects another user's avatar upload (404) and keeps both avatars", async () => {
      const own = await setAvatar(token);
      const foreignId = await uploadAvatar(otherToken);

      await updateProfile(token, { avatarUploadId: foreignId }).expect(404);

      expect(await avatarOf(token)).toMatch(avatarUrlPattern(own.id));
      expect(await prisma.userAvatar.findUnique({ where: { id: foreignId } })).not.toBeNull();
      expect(await storedEntries(foreignId)).toContain(foreignId);
    });

    it('rejects a missing avatar upload (404) and keeps the avatar', async () => {
      const own = await setAvatar(token);

      await updateProfile(token, { avatarUploadId: randomUUID() }).expect(404);

      expect(await avatarOf(token)).toMatch(avatarUrlPattern(own.id));
    });

    it('rejects an unfinished avatar upload (409) and keeps the avatar', async () => {
      const own = await setAvatar(token);
      const unfinishedId = await uploadAvatar(token, fakePng(), 10);

      await updateProfile(token, { avatarUploadId: unfinishedId }).expect(409);

      expect(await avatarOf(token)).toMatch(avatarUrlPattern(own.id));
      expect(await prisma.userAvatar.findUnique({ where: { id: unfinishedId } })).toMatchObject({
        status: 'UPLOADING',
      });
    });

    it('rejects an avatarUploadId that is not a UUID (400)', async () => {
      await updateProfile(token, { avatarUploadId: 'not-a-uuid' }).expect(400);
    });

    it('rejects a request without a token (401)', async () => {
      const avatarUploadId = await uploadAvatar(token);

      await request(server()).patch('/users/me').send({ avatarUploadId }).expect(401);
    });
  });

  describe('PATCH /users/me with avatar: null', () => {
    let token: string;

    beforeAll(async () => {
      token = await signUp('avatar-remove');
    });

    it('removes the avatar with its data (200)', async () => {
      const { id } = await setAvatar(token);

      const res = await updateProfile(token, { avatar: null }).expect(200);

      expect((res.body as ProfileBody).avatar).toBeNull();
      expect(await avatarOf(token)).toBeNull();
      expect(await prisma.userAvatar.findUnique({ where: { id } })).toBeNull();
      expect(await storedEntries(id)).toEqual([]);
    });

    it('is accepted when there is no avatar (200)', async () => {
      const res = await updateProfile(token, { avatar: null }).expect(200);

      expect((res.body as ProfileBody).avatar).toBeNull();
    });
  });

  describe('GET /users/me', () => {
    it('returns null without an avatar', async () => {
      const token = await signUp('avatar-none');

      expect(await avatarOf(token)).toBeNull();
    });

    it('returns the same avatar URL on repeated loads', async () => {
      const token = await signUp('avatar-stable');
      const { id } = await setAvatar(token);

      const first = await avatarOf(token);
      const second = await avatarOf(token);

      expect(first).toMatch(avatarUrlPattern(id));
      expect(second).toBe(first);
    });

    it('does not attach a completed upload on its own', async () => {
      const token = await signUp('avatar-unattached');
      await uploadAvatar(token);

      expect(await avatarOf(token)).toBeNull();
    });
  });

  describe('GET /avatars/:id/content', () => {
    let token: string;

    beforeAll(async () => {
      token = await signUp('avatar-content');
    });

    it('serves the image with its MIME type, private caching and nosniff (200)', async () => {
      const data = fakePng();
      const { url } = await setAvatar(token, data);

      const res = await getContent(url).expect(200);

      expect(res.headers['content-type']).toMatch(/^image\/png/);
      expect(res.headers['x-content-type-options']).toBe('nosniff');
      expect(res.headers['cache-control']).toMatch(/private/);
      expect(res.headers['cache-control']).toMatch(/max-age=\d+/);
      expect(Buffer.compare(res.body as Buffer, data)).toBe(0);
    });

    it('rejects a missing token (401)', async () => {
      const { id } = await setAvatar(token);

      await request(server()).get(`/avatars/${id}/content`).expect(401);
    });

    it('rejects an invalid token (401)', async () => {
      const { id } = await setAvatar(token);

      await request(server()).get(`/avatars/${id}/content?token=not-a-token`).expect(401);
    });

    it('rejects an access token instead of an avatar token (401)', async () => {
      const { id } = await setAvatar(token);

      await request(server()).get(`/avatars/${id}/content?token=${token}`).expect(401);
    });

    it('rejects a token issued for another avatar (401)', async () => {
      const otherToken = await signUp('avatar-content-other');
      const own = await setAvatar(token);
      const other = await setAvatar(otherToken);
      const ownToken = new URL(own.url, 'http://api').searchParams.get('token') as string;

      await request(server()).get(`/avatars/${other.id}/content?token=${ownToken}`).expect(401);
    });

    it('answers 404 once the avatar is replaced', async () => {
      const previous = await setAvatar(token);
      await setAvatar(token, otherPng());

      await getContent(previous.url).expect(404);
    });

    it('answers 404 once the avatar is removed', async () => {
      const { url } = await setAvatar(token);
      await updateProfile(token, { avatar: null }).expect(200);

      await getContent(url).expect(404);
    });
  });

  describe('storage', () => {
    it('holds no data of replaced or removed avatars', async () => {
      // Every replaced or removed avatar lost its row (checked above), so the data left must be
      // exactly that of the remaining rows: the current avatars plus the uploads never attached
      // (foreign, unfinished, unattached), which the cleanup of the next phase removes.
      const avatars = await prisma.userAvatar.findMany({
        where: { user: { email: { endsWith: `-${runId}@example.com` } } },
        select: { id: true },
      });

      const stored = await readdir(path.join(filesDir, 'uploads'));
      const storedIds = new Set(stored.map((name) => name.replace(/\.json$/, '')));

      expect([...storedIds].sort()).toEqual(avatars.map((avatar) => avatar.id).sort());
    });
  });
});

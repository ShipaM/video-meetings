import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { CommandBus } from '@nestjs/cqrs';
import { mkdtemp, readdir, rm, utimes } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { Server } from 'node:http';
import request from 'supertest';
import { AppModule } from './../src/app.module.js';
import { SweepOrphanFilesCommand } from './../src/meeting-files/commands/index.js';
import { PrismaService } from './../src/prisma/prisma.service.js';
import { CleanupAvatarUploadsCommand } from './../src/users/index.js';
import { TUS_VERSION, binaryParser, fakePng, tusMetadata } from './tus.helpers.js';

describe('Avatar cleanup (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let filesDir: string;

  const password = 'Str0ngPassw0rd!';
  const runId = Date.now();
  const email = (name: string) => `${name}-${runId}@example.com`;

  // The suites share the dev database: the cutoff is far in the past and only rows this suite
  // moved before it are candidates, so avatars of a developer are never touched.
  const cutoff = new Date('2000-01-02T00:00:00.000Z');
  const abandonedAt = new Date('2000-01-01T00:00:00.000Z');

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

  /**
   * Uploads an avatar through tus and returns its location. With `sentBytes` only that many bytes
   * are sent, which leaves the upload unfinished (`UPLOADING`).
   */
  const uploadAvatar = async (token: string, sentBytes?: number) => {
    const data = fakePng();
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
      .send(data.subarray(0, sentBytes ?? data.length))
      .expect(204);
    return location;
  };

  const uploadIdOf = (location: string) => location.split('/').pop() as string;

  /** Uploads an avatar and attaches it to the profile; returns its upload id and URL. */
  const setAvatar = async (token: string) => {
    const avatarUploadId = uploadIdOf(await uploadAvatar(token));
    const res = await request(server())
      .patch('/users/me')
      .set(auth(token))
      .send({ avatarUploadId })
      .expect(200);
    return { id: avatarUploadId, url: (res.body as { avatar: string }).avatar };
  };

  const getContent = (url: string) => request(server()).get(url).buffer(true).parse(binaryParser);

  const setLastChunkAt = (id: string, lastChunkAt: Date) =>
    prisma.userAvatar.update({ where: { id }, data: { lastChunkAt } });

  const cleanUp = () => app.get(CommandBus).execute(new CleanupAvatarUploadsCommand(cutoff));
  const sweep = () => app.get(CommandBus).execute(new SweepOrphanFilesCommand(new Date()));

  const uploadsDir = () => path.join(filesDir, 'uploads');

  /** Names in the storage directory that belong to an upload (its data and its tus metadata). */
  const storedEntries = async (uploadId: string): Promise<string[]> =>
    (await readdir(uploadsDir())).filter((name) => name.startsWith(uploadId));

  /** Makes entries of the storage directory look older than the orphan sweep's grace period. */
  const age = async (names: string[]) => {
    const old = new Date(Date.now() - 2 * 60 * 60 * 1000);
    for (const name of names) {
      await utimes(path.join(uploadsDir(), name), old, old);
    }
  };

  let token: string;

  beforeAll(async () => {
    filesDir = await mkdtemp(path.join(tmpdir(), 'avatar-cleanup-e2e-'));
    process.env.FILES_DIR = filesDir;

    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true }));
    await app.init();
    prisma = app.get(PrismaService);

    token = await signUp('avatar-cleanup');
  });

  afterAll(async () => {
    // Avatars are removed together with their users (cascade).
    await prisma.user.deleteMany({ where: { email: { endsWith: `-${runId}@example.com` } } });
    await app.close();
    await rm(filesDir, { recursive: true, force: true, maxRetries: 5 });
  });

  describe('abandoned and unattached avatar uploads', () => {
    it('removes an avatar upload with no chunk since the cutoff, with its partial data', async () => {
      const location = await uploadAvatar(token, 10);
      const id = uploadIdOf(location);
      await setLastChunkAt(id, abandonedAt);

      expect(await cleanUp()).toBeGreaterThanOrEqual(1);

      expect(await prisma.userAvatar.findUnique({ where: { id } })).toBeNull();
      expect(await storedEntries(id)).toEqual([]);
      await request(server()).head(location).set(tus(token)).expect(404);
    });

    it('removes a completed avatar never attached to the profile after the grace period', async () => {
      const id = uploadIdOf(await uploadAvatar(token));
      expect(await prisma.userAvatar.findUnique({ where: { id } })).toMatchObject({
        status: 'READY',
      });
      await setLastChunkAt(id, abandonedAt);

      expect(await cleanUp()).toBeGreaterThanOrEqual(1);

      expect(await prisma.userAvatar.findUnique({ where: { id } })).toBeNull();
      expect(await storedEntries(id)).toEqual([]);
      await request(server())
        .patch('/users/me')
        .set(auth(token))
        .send({ avatarUploadId: id })
        .expect(404);
    });

    it('keeps the attached avatar, however old', async () => {
      const { id, url } = await setAvatar(token);
      await setLastChunkAt(id, abandonedAt);

      await cleanUp();

      expect(await prisma.userAvatar.findUnique({ where: { id } })).toMatchObject({
        status: 'READY',
      });
      expect(await storedEntries(id)).toContain(id);
      const content = await getContent(url).expect(200);
      expect(content.body).toEqual(fakePng());
    });

    it('keeps avatar uploads with a chunk since the cutoff, unfinished or not yet attached', async () => {
      const activeId = uploadIdOf(await uploadAvatar(token, 10));
      const readyId = uploadIdOf(await uploadAvatar(token));
      await setLastChunkAt(activeId, new Date('2000-01-03T00:00:00.000Z'));
      await setLastChunkAt(readyId, new Date('2000-01-03T00:00:00.000Z'));

      await cleanUp();

      expect(await prisma.userAvatar.findUnique({ where: { id: activeId } })).toMatchObject({
        status: 'UPLOADING',
      });
      expect(await prisma.userAvatar.findUnique({ where: { id: readyId } })).toMatchObject({
        status: 'READY',
      });
      expect(await storedEntries(activeId)).toContain(activeId);
      expect(await storedEntries(readyId)).toContain(readyId);
    });
  });

  describe('orphan file sweep', () => {
    it('removes old avatar data without a row', async () => {
      const id = uploadIdOf(await uploadAvatar(token));
      // A removal that failed after the row was deleted leaves the data behind.
      await prisma.userAvatar.delete({ where: { id } });
      await age(await storedEntries(id));

      expect(await sweep()).toBeGreaterThanOrEqual(1);

      expect(await storedEntries(id)).toEqual([]);
    });

    it('never removes the data of a live avatar, however old', async () => {
      const attached = await setAvatar(token);
      const readyId = uploadIdOf(await uploadAvatar(token));
      const activeId = uploadIdOf(await uploadAvatar(token, 10));
      await age(await readdir(uploadsDir()));

      await sweep();

      expect(await storedEntries(attached.id)).toContain(attached.id);
      expect(await storedEntries(readyId)).toContain(readyId);
      expect(await storedEntries(activeId)).toContain(activeId);
      await getContent(attached.url).expect(200);
    });
  });

  describe('after cleanup and sweep', () => {
    it('leaves only the data of the remaining avatars in the storage directory', async () => {
      await setAvatar(token);
      const abandonedId = uploadIdOf(await uploadAvatar(token, 10));
      const unattachedId = uploadIdOf(await uploadAvatar(token));
      const orphanId = uploadIdOf(await uploadAvatar(token));
      await setLastChunkAt(abandonedId, abandonedAt);
      await setLastChunkAt(unattachedId, abandonedAt);
      await prisma.userAvatar.delete({ where: { id: orphanId } });
      await age(await readdir(uploadsDir()));

      await cleanUp();
      await sweep();

      const remaining = await prisma.userAvatar.findMany({
        where: { user: { email: email('avatar-cleanup') } },
        select: { id: true },
      });
      const ids = remaining.map(({ id }) => id);
      expect(ids).not.toContain(abandonedId);
      expect(ids).not.toContain(unattachedId);
      const expected = ids.flatMap((id) => [id, `${id}.json`]).sort();
      expect((await readdir(uploadsDir())).sort()).toEqual(expected);
    });
  });
});

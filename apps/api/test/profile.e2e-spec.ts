import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import type { Server } from 'node:http';
import request from 'supertest';
import { AppModule } from './../src/app.module.js';
import { PrismaService } from './../src/prisma/prisma.service.js';

interface ProfileBody {
  email: string;
  name: string | null;
  avatar: unknown;
}

describe('Profile (e2e)', () => {
  let app: INestApplication;

  const password = 'Str0ngPassw0rd!';
  const runId = Date.now();
  const email = (name: string) => `${name}-${runId}@example.com`;

  const server = () => app.getHttpServer() as Server;

  const signUp = async (name: string): Promise<string> => {
    const res = await request(server())
      .post('/auth/register')
      .send({ email: email(name), password })
      .expect(201);
    return (res.body as { accessToken: string }).accessToken;
  };

  const auth = (token: string) => ({ Authorization: `Bearer ${token}` });

  const getProfile = (token: string) => request(server()).get('/users/me').set(auth(token));
  const updateProfile = (token: string, body: object) =>
    request(server()).patch('/users/me').set(auth(token)).send(body);

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true }));
    await app.init();
  });

  afterAll(async () => {
    await app.get(PrismaService).user.deleteMany({
      where: { email: { endsWith: `-${runId}@example.com` } },
    });
    await app.close();
  });

  describe('GET /users/me', () => {
    it('returns the profile of a new user without a name or avatar (200)', async () => {
      const token = await signUp('profile-new');

      const res = await getProfile(token).expect(200);

      expect(res.body).toEqual({ email: email('profile-new'), name: null, avatar: null });
    });

    it('never returns the password hash', async () => {
      const token = await signUp('profile-hash');

      const res = await getProfile(token).expect(200);

      expect(res.body).not.toHaveProperty('passwordHash');
      expect(JSON.stringify(res.body)).not.toMatch(/\$2[aby]\$/);
    });

    it('rejects a request without a token (401)', async () => {
      await request(server()).get('/users/me').expect(401);
    });
  });

  describe('PATCH /users/me', () => {
    let token: string;

    beforeAll(async () => {
      token = await signUp('profile-edit');
    });

    it('trims and saves the name (200)', async () => {
      const res = await updateProfile(token, { name: '  Ada Lovelace  ' }).expect(200);

      expect(res.body).toEqual({
        email: email('profile-edit'),
        name: 'Ada Lovelace',
        avatar: null,
      });
      const stored = await getProfile(token).expect(200);
      expect((stored.body as ProfileBody).name).toBe('Ada Lovelace');
    });

    it('accepts a 1-character name', async () => {
      const res = await updateProfile(token, { name: 'A' }).expect(200);

      expect((res.body as ProfileBody).name).toBe('A');
    });

    it('accepts a 50-character name, also with surrounding spaces', async () => {
      const name = 'a'.repeat(50);

      const res = await updateProfile(token, { name: `  ${name}  ` }).expect(200);

      expect((res.body as ProfileBody).name).toBe(name);
    });

    it('stores null for an empty name', async () => {
      await updateProfile(token, { name: 'Temporary' }).expect(200);

      const res = await updateProfile(token, { name: '' }).expect(200);

      expect((res.body as ProfileBody).name).toBeNull();
      const stored = await getProfile(token).expect(200);
      expect((stored.body as ProfileBody).name).toBeNull();
    });

    it('stores null for a name of spaces only', async () => {
      await updateProfile(token, { name: 'Temporary' }).expect(200);

      const res = await updateProfile(token, { name: '   ' }).expect(200);

      expect((res.body as ProfileBody).name).toBeNull();
    });

    it('rejects a name of 51+ characters after trimming (400) and keeps the old one', async () => {
      await updateProfile(token, { name: 'Kept' }).expect(200);

      await updateProfile(token, { name: 'a'.repeat(51) }).expect(400);
      await updateProfile(token, { name: ` ${'a'.repeat(60)} ` }).expect(400);

      const stored = await getProfile(token).expect(200);
      expect((stored.body as ProfileBody).name).toBe('Kept');
    });

    it('never returns the password hash', async () => {
      const res = await updateProfile(token, { name: 'No hash' }).expect(200);

      expect(res.body).not.toHaveProperty('passwordHash');
      expect(JSON.stringify(res.body)).not.toMatch(/\$2[aby]\$/);
    });

    it('rejects a request without a token (401)', async () => {
      await request(server()).patch('/users/me').send({ name: 'Anonymous' }).expect(401);
    });
  });
});

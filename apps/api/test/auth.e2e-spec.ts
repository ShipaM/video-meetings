import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import type { Server } from 'node:http';
import request from 'supertest';
import { AppModule } from './../src/app.module.js';
import { PrismaService } from './../src/prisma/prisma.service.js';

describe('Auth (e2e)', () => {
  let app: INestApplication;

  const password = 'Str0ngPassw0rd!';
  const runId = Date.now();
  const email = (name: string) => `${name}-${runId}@example.com`;

  const server = () => app.getHttpServer() as Server;
  const register = (body: object) => request(server()).post('/auth/register').send(body);
  const login = (body: object) => request(server()).post('/auth/login').send(body);

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

  describe('POST /auth/register', () => {
    it('creates a user and returns a JWT token', async () => {
      const res = await register({ email: email('register'), password }).expect(201);

      const { accessToken } = res.body as { accessToken: unknown };
      expect(typeof accessToken).toBe('string');
      expect((accessToken as string).length).toBeGreaterThan(0);
    });

    it('rejects a repeated registration with the same e-mail (409)', async () => {
      await register({ email: email('duplicate'), password }).expect(201);
      await register({ email: email('duplicate'), password }).expect(409);
    });

    it('rejects a missing e-mail (400)', async () => {
      await register({ password }).expect(400);
    });

    it('rejects a missing password (400)', async () => {
      await register({ email: email('no-password') }).expect(400);
    });

    it('rejects an invalid e-mail format (400)', async () => {
      await register({ email: 'not-an-email', password }).expect(400);
    });
  });

  describe('POST /auth/login', () => {
    it('returns a JWT token for valid credentials without creating a user', async () => {
      await register({ email: email('login'), password }).expect(201);

      const res = await login({ email: email('login'), password }).expect(201);

      const { accessToken } = res.body as { accessToken: unknown };
      expect(typeof accessToken).toBe('string');
      expect((accessToken as string).length).toBeGreaterThan(0);
    });

    it('does not create a new user for an unknown e-mail (401)', async () => {
      await login({ email: email('unknown'), password }).expect(401);
      // A second attempt still fails: login must never register anybody.
      await login({ email: email('unknown'), password }).expect(401);
    });

    it('rejects a wrong password (401)', async () => {
      await register({ email: email('wrong-password'), password }).expect(201);

      await login({ email: email('wrong-password'), password: 'wrong-password' }).expect(401);
    });

    it('rejects a missing e-mail (400)', async () => {
      await login({ password }).expect(400);
    });

    it('rejects a missing password (400)', async () => {
      await login({ email: email('login') }).expect(400);
    });

    it('rejects an invalid e-mail format (400)', async () => {
      await login({ email: 'not-an-email', password }).expect(400);
    });
  });

  describe('POST /auth/password', () => {
    const newPassword = 'N3wStr0ngPassw0rd!';

    const signUp = async (name: string): Promise<string> => {
      const res = await register({ email: email(name), password }).expect(201);
      return (res.body as { accessToken: string }).accessToken;
    };
    const changePassword = (token: string, body: object) =>
      request(server()).post('/auth/password').set('Authorization', `Bearer ${token}`).send(body);

    it('changes the password: login works only with the new one and the token stays valid', async () => {
      const token = await signUp('change-password');

      await changePassword(token, { oldPassword: password, newPassword }).expect(204);

      await login({ email: email('change-password'), password: newPassword }).expect(201);
      await login({ email: email('change-password'), password }).expect(401);
      await request(server()).get('/users/me').set('Authorization', `Bearer ${token}`).expect(200);
    });

    it('rejects a wrong old password (403) and keeps the old password', async () => {
      const token = await signUp('wrong-old-password');

      // 403, not 401: the token is valid, and a 401 would sign the user out in the web app.
      await changePassword(token, { oldPassword: 'wrong-password', newPassword }).expect(403);

      await login({ email: email('wrong-old-password'), password }).expect(201);
      await login({ email: email('wrong-old-password'), password: newPassword }).expect(401);
    });

    it('rejects a new password under 8 characters (400) and keeps the old password', async () => {
      const token = await signUp('short-new-password');

      await changePassword(token, { oldPassword: password, newPassword: 'Short1!' }).expect(400);

      await login({ email: email('short-new-password'), password }).expect(201);
    });

    it('rejects a missing old password (400)', async () => {
      const token = await signUp('no-old-password');

      await changePassword(token, { newPassword }).expect(400);
    });

    it('rejects a request without a token (401)', async () => {
      await request(server())
        .post('/auth/password')
        .send({ oldPassword: password, newPassword })
        .expect(401);
    });
  });
});

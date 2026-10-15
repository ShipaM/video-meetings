import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import type { Server } from 'node:http';
import request from 'supertest';
import { AppModule } from './../src/app.module.js';
import { PrismaService } from './../src/prisma/prisma.service.js';

interface MeetingBody {
  id: string;
  title: string;
  startsAt: string;
}

describe('Meetings (e2e)', () => {
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

  const createMeeting = (token: string, body: object) =>
    request(server()).post('/meetings').set(auth(token)).send(body);

  const validMeeting = (title: string) => ({ title, startsAt: '2030-01-01T10:00:00.000Z' });

  let ownerToken: string;
  let otherToken: string;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true }));
    await app.init();

    ownerToken = await signUp('meetings-owner');
    otherToken = await signUp('meetings-other');
  });

  afterAll(async () => {
    // Meetings are removed together with their owners (the Meeting model must cascade on delete).
    await app.get(PrismaService).user.deleteMany({
      where: { email: { endsWith: `-${runId}@example.com` } },
    });
    await app.close();
  });

  describe('POST /meetings', () => {
    it('creates a meeting for the authenticated user (201)', async () => {
      const res = await createMeeting(ownerToken, validMeeting('Planning')).expect(201);

      const body = res.body as MeetingBody;
      expect(typeof body.id).toBe('string');
      expect(body.title).toBe('Planning');
      expect(new Date(body.startsAt).toISOString()).toBe('2030-01-01T10:00:00.000Z');
    });

    it('rejects a missing title (400)', async () => {
      await createMeeting(ownerToken, { startsAt: '2030-01-01T10:00:00.000Z' }).expect(400);
    });

    it('rejects a missing date (400)', async () => {
      await createMeeting(ownerToken, { title: 'No date' }).expect(400);
    });

    it('rejects a request without a token (401)', async () => {
      await request(server()).post('/meetings').send(validMeeting('Anonymous')).expect(401);
    });
  });

  describe('GET /meetings', () => {
    it('returns the meetings of the authenticated user (200)', async () => {
      const created = await createMeeting(ownerToken, validMeeting('Listed')).expect(201);
      const { id } = created.body as MeetingBody;

      const res = await request(server()).get('/meetings').set(auth(ownerToken)).expect(200);

      const list = res.body as MeetingBody[];
      expect(Array.isArray(list)).toBe(true);
      expect(list.map((meeting) => meeting.id)).toContain(id);
    });

    it("does not return other users' meetings", async () => {
      const foreign = await createMeeting(otherToken, validMeeting('Foreign')).expect(201);
      const { id } = foreign.body as MeetingBody;

      const res = await request(server()).get('/meetings').set(auth(ownerToken)).expect(200);

      const list = res.body as MeetingBody[];
      expect(list.map((meeting) => meeting.id)).not.toContain(id);
    });

    it('rejects a request without a token (401)', async () => {
      await request(server()).get('/meetings').expect(401);
    });
  });

  describe('GET /meetings/:id', () => {
    it('returns a meeting by id (200)', async () => {
      const created = await createMeeting(ownerToken, validMeeting('By id')).expect(201);
      const { id } = created.body as MeetingBody;

      const res = await request(server()).get(`/meetings/${id}`).set(auth(ownerToken)).expect(200);

      expect((res.body as MeetingBody).id).toBe(id);
      expect((res.body as MeetingBody).title).toBe('By id');
    });

    it('rejects a request without a token (401)', async () => {
      await request(server()).get('/meetings/00000000-0000-4000-8000-000000000000').expect(401);
    });

    it("hides another user's meeting (404)", async () => {
      const foreign = await createMeeting(otherToken, validMeeting('Private')).expect(201);
      const { id } = foreign.body as MeetingBody;

      await request(server()).get(`/meetings/${id}`).set(auth(ownerToken)).expect(404);
    });
  });
});

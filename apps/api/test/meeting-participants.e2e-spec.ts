import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { Server } from 'node:http';
import request from 'supertest';
import { AppModule } from './../src/app.module.js';
import { PrismaService } from './../src/prisma/prisma.service.js';
import { TUS_VERSION, binaryParser, fakeMp4, sha256, tusMetadata } from './tus.helpers.js';

interface MeetingBody {
  id: string;
  title: string;
  ownerId: string;
  role: string;
}

interface ParticipantBody {
  userId: string;
  email: string;
  addedAt: string;
}

interface FileBody {
  id: string;
  status: string;
}

const MiB = 1024 ** 2;

describe('Meeting participants (e2e)', () => {
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

  const createMeeting = async (token: string, title: string): Promise<string> => {
    const res = await request(server())
      .post('/meetings')
      .set(auth(token))
      .send({ title, startsAt: '2030-01-01T10:00:00.000Z' })
      .expect(201);
    return (res.body as { id: string }).id;
  };

  const addParticipant = (token: string, meetingId: string, participantEmail: string) =>
    request(server())
      .post(`/meetings/${meetingId}/participants`)
      .set(auth(token))
      .send({ email: participantEmail });

  const listParticipants = (token: string, meetingId: string) =>
    request(server()).get(`/meetings/${meetingId}/participants`).set(auth(token));

  const removeParticipant = (token: string, meetingId: string, userId: string) =>
    request(server()).delete(`/meetings/${meetingId}/participants/${userId}`).set(auth(token));

  const createUpload = (token: string, meetingId: string, size: number) =>
    request(server())
      .post('/uploads')
      .set(tus(token))
      .set('Upload-Length', String(size))
      .set(
        'Upload-Metadata',
        tusMetadata({ meetingId, filename: 'recording.mp4', filetype: 'video/mp4' }),
      );

  const patchChunk = (token: string, location: string, offset: number, chunk: Buffer) =>
    request(server())
      .patch(location)
      .set(tus(token))
      .set('Upload-Offset', String(offset))
      .set('Content-Type', 'application/offset+octet-stream')
      .send(chunk);

  /** Uploads `data` in one chunk; returns the file id. */
  const upload = async (token: string, meetingId: string, data: Buffer): Promise<string> => {
    const created = await createUpload(token, meetingId, data.length).expect(201);
    const location = created.headers.location;
    await patchChunk(token, location, 0, data).expect(204);
    return location.split('/').pop() as string;
  };

  const listFiles = (token: string, meetingId: string) =>
    request(server()).get(`/meetings/${meetingId}/files`).set(auth(token));

  const requestLink = (token: string, meetingId: string, fileId: string) =>
    request(server()).post(`/meetings/${meetingId}/files/${fileId}/link`).set(auth(token));

  const download = (url: string) => request(server()).get(url).buffer(true).parse(binaryParser);

  const listMeetings = async (token: string): Promise<MeetingBody[]> => {
    const res = await request(server()).get('/meetings').set(auth(token)).expect(200);
    return res.body as MeetingBody[];
  };

  const userIdOf = async (name: string): Promise<string> => {
    const user = await app
      .get(PrismaService)
      .user.findUniqueOrThrow({ where: { email: email(name) }, select: { id: true } });
    return user.id;
  };

  let ownerToken: string;
  let participantToken: string;
  let strangerToken: string;
  let candidateToken: string;
  let participantId: string;
  let meetingId: string;
  let fileData: Buffer;
  let fileId: string;
  /** An upload of the owner that is still in progress (half of its bytes). */
  let uploadingLocation: string;

  beforeAll(async () => {
    filesDir = await mkdtemp(path.join(tmpdir(), 'meeting-participants-e2e-'));
    process.env.FILES_DIR = filesDir;

    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true }));
    await app.init();

    ownerToken = await signUp('share-owner');
    participantToken = await signUp('share-participant');
    strangerToken = await signUp('share-stranger');
    candidateToken = await signUp('share-candidate');
    participantId = await userIdOf('share-participant');

    meetingId = await createMeeting(ownerToken, 'Shared');
    fileData = fakeMp4(MiB);
    fileId = await upload(ownerToken, meetingId, fileData);

    const pending = fakeMp4(MiB);
    const created = await createUpload(ownerToken, meetingId, pending.length).expect(201);
    uploadingLocation = created.headers.location;
    await patchChunk(ownerToken, uploadingLocation, 0, pending.subarray(0, MiB / 2)).expect(204);

    await addParticipant(ownerToken, meetingId, email('share-participant')).expect(201);
  });

  afterAll(async () => {
    // Meetings, participants and files are removed together with their users (cascade).
    await app.get(PrismaService).user.deleteMany({
      where: { email: { endsWith: `-${runId}@example.com` } },
    });
    await app.close();
    await rm(filesDir, { recursive: true, force: true, maxRetries: 5 });
  });

  describe('POST /meetings/:id/participants', () => {
    it('adds a registered user by e-mail (201) and lists them', async () => {
      const meeting = await createMeeting(ownerToken, 'Add');

      const res = await addParticipant(ownerToken, meeting, email('share-candidate')).expect(201);
      const added = res.body as ParticipantBody;
      expect(added).toMatchObject({
        userId: await userIdOf('share-candidate'),
        email: email('share-candidate'),
      });
      expect(Number.isNaN(Date.parse(added.addedAt))).toBe(false);

      const list = await listParticipants(ownerToken, meeting).expect(200);
      expect((list.body as ParticipantBody[]).map((item) => item.email)).toEqual([
        email('share-candidate'),
      ]);
    });

    it('finds the user regardless of the e-mail case', async () => {
      const meeting = await createMeeting(ownerToken, 'Case');

      await addParticipant(ownerToken, meeting, email('share-candidate').toUpperCase()).expect(201);
    });

    it('rejects an unregistered e-mail (404) and adds nobody', async () => {
      const meeting = await createMeeting(ownerToken, 'Unknown');

      await addParticipant(ownerToken, meeting, email('nobody')).expect(404);

      const list = await listParticipants(ownerToken, meeting).expect(200);
      expect(list.body).toEqual([]);
    });

    it("rejects the owner's own e-mail (400) and adds nobody", async () => {
      const meeting = await createMeeting(ownerToken, 'Self');

      await addParticipant(ownerToken, meeting, email('share-owner')).expect(400);

      const list = await listParticipants(ownerToken, meeting).expect(200);
      expect(list.body).toEqual([]);
    });

    it('rejects an existing participant (409) and keeps a single entry', async () => {
      await addParticipant(ownerToken, meetingId, email('share-participant')).expect(409);

      const list = await listParticipants(ownerToken, meetingId).expect(200);
      expect((list.body as ParticipantBody[]).map((item) => item.userId)).toEqual([participantId]);
    });

    it('rejects an invalid e-mail (400)', async () => {
      await addParticipant(ownerToken, meetingId, 'not-an-email').expect(400);
    });

    it('is forbidden to a participant (403)', async () => {
      await addParticipant(participantToken, meetingId, email('share-candidate')).expect(403);
    });

    it("hides another user's meeting from a stranger (404)", async () => {
      await addParticipant(strangerToken, meetingId, email('share-candidate')).expect(404);
    });

    it('rejects a request without a token (401)', async () => {
      await request(server())
        .post(`/meetings/${meetingId}/participants`)
        .send({ email: email('share-candidate') })
        .expect(401);
    });
  });

  describe('GET /meetings/:id/participants', () => {
    it('is forbidden to a participant (403)', async () => {
      await listParticipants(participantToken, meetingId).expect(403);
    });

    it('hides the meeting from a stranger (404)', async () => {
      await listParticipants(strangerToken, meetingId).expect(404);
    });

    it('rejects a request without a token (401)', async () => {
      await request(server()).get(`/meetings/${meetingId}/participants`).expect(401);
    });
  });

  describe('DELETE /meetings/:id/participants/:userId', () => {
    it('is forbidden to a participant (403)', async () => {
      await removeParticipant(participantToken, meetingId, participantId).expect(403);
    });

    it('hides the meeting from a stranger (404)', async () => {
      await removeParticipant(strangerToken, meetingId, participantId).expect(404);
    });

    it('answers 404 for a user who is not a participant', async () => {
      await removeParticipant(ownerToken, meetingId, await userIdOf('share-stranger')).expect(404);
    });

    it('rejects a non-UUID user id (400)', async () => {
      await removeParticipant(ownerToken, meetingId, 'not-a-uuid').expect(400);
    });

    it('rejects a request without a token (401)', async () => {
      await request(server())
        .delete(`/meetings/${meetingId}/participants/${participantId}`)
        .expect(401);
    });
  });

  describe('read access of a participant', () => {
    it('lists the shared meeting marked as shared next to their own', async () => {
      const own = await createMeeting(participantToken, 'Own');

      const meetings = await listMeetings(participantToken);
      expect(meetings.find((item) => item.id === meetingId)).toMatchObject({
        title: 'Shared',
        role: 'participant',
      });
      expect(meetings.find((item) => item.id === own)).toMatchObject({ role: 'owner' });
    });

    it('marks the meeting as owned for the owner', async () => {
      const meetings = await listMeetings(ownerToken);
      expect(meetings.find((item) => item.id === meetingId)).toMatchObject({ role: 'owner' });

      const res = await request(server())
        .get(`/meetings/${meetingId}`)
        .set(auth(ownerToken))
        .expect(200);
      expect((res.body as MeetingBody).role).toBe('owner');
    });

    it('opens the shared meeting', async () => {
      const res = await request(server())
        .get(`/meetings/${meetingId}`)
        .set(auth(participantToken))
        .expect(200);
      expect(res.body as MeetingBody).toMatchObject({ id: meetingId, role: 'participant' });
    });

    it('lists completed files but not an upload in progress', async () => {
      const res = await listFiles(participantToken, meetingId).expect(200);
      const ids = (res.body as FileBody[]).map((file) => file.id);
      expect(ids).toContain(fileId);
      expect(ids).not.toContain(uploadingLocation.split('/').pop());
    });

    it('downloads a file through a signed link', async () => {
      const link = await requestLink(participantToken, meetingId, fileId).expect(201);

      const res = await download((link.body as { url: string }).url).expect(200);
      expect(sha256(res.body as Buffer)).toBe(sha256(fileData));
    });
  });

  describe('write access of a participant (403)', () => {
    it('cannot upload', async () => {
      await createUpload(participantToken, meetingId, MiB).expect(403);
    });

    it("cannot continue or cancel the owner's upload, which keeps its data", async () => {
      await request(server()).head(uploadingLocation).set(tus(participantToken)).expect(403);
      // A small body: tus answers before reading it and closes the connection.
      await patchChunk(participantToken, uploadingLocation, MiB / 2, Buffer.alloc(10)).expect(403);
      await request(server()).delete(uploadingLocation).set(tus(participantToken)).expect(403);

      const head = await request(server()).head(uploadingLocation).set(tus(ownerToken)).expect(200);
      expect(Number(head.headers['upload-offset'])).toBe(MiB / 2);
    });

    it('cannot delete a file, which stays', async () => {
      await request(server())
        .delete(`/meetings/${meetingId}/files/${fileId}`)
        .set(auth(participantToken))
        .expect(403);

      const res = await listFiles(ownerToken, meetingId).expect(200);
      expect((res.body as FileBody[]).map((file) => file.id)).toContain(fileId);
      const stored = await readdir(path.join(filesDir, 'uploads'));
      expect(stored).toContain(fileId);
    });
  });

  describe('a stranger (404)', () => {
    it('does not see the meeting in the list or by id', async () => {
      const meetings = await listMeetings(strangerToken);
      expect(meetings.map((item) => item.id)).not.toContain(meetingId);

      await request(server()).get(`/meetings/${meetingId}`).set(auth(strangerToken)).expect(404);
    });

    it('gets 404 for the files, a download link and the uploads', async () => {
      await listFiles(strangerToken, meetingId).expect(404);
      await requestLink(strangerToken, meetingId, fileId).expect(404);
      await createUpload(strangerToken, meetingId, MiB).expect(404);
      await request(server()).head(uploadingLocation).set(tus(strangerToken)).expect(404);
      await request(server()).delete(uploadingLocation).set(tus(strangerToken)).expect(404);
      await request(server())
        .delete(`/meetings/${meetingId}/files/${fileId}`)
        .set(auth(strangerToken))
        .expect(404);
    });
  });

  describe('a removed participant', () => {
    it('loses access to the meeting, its files and links issued before the removal', async () => {
      const meeting = await createMeeting(ownerToken, 'Revoked');
      const file = await upload(ownerToken, meeting, fakeMp4(MiB));
      await addParticipant(ownerToken, meeting, email('share-candidate')).expect(201);
      const link = await requestLink(candidateToken, meeting, file).expect(201);
      const { url } = link.body as { url: string };

      await removeParticipant(ownerToken, meeting, await userIdOf('share-candidate')).expect(204);

      const meetings = await listMeetings(candidateToken);
      expect(meetings.map((item) => item.id)).not.toContain(meeting);
      await request(server()).get(`/meetings/${meeting}`).set(auth(candidateToken)).expect(404);
      await listFiles(candidateToken, meeting).expect(404);
      await requestLink(candidateToken, meeting, file).expect(404);
      await download(url).expect(404);

      const list = await listParticipants(ownerToken, meeting).expect(200);
      expect(list.body).toEqual([]);
    });
  });
});

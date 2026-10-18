import { NotFoundException, UnauthorizedException } from '@nestjs/common';
import type { QueryBus } from '@nestjs/cqrs';
import { JwtService } from '@nestjs/jwt';
import { GetMeetingQuery } from '../../../meetings/index.js';
import type { PrismaService } from '../../../prisma/prisma.service.js';
import type { FilesStorageService } from '../../files-storage.service.js';
import { FILE_LINK_AUDIENCE } from '../../meeting-files.config.js';
import { GetFileContentQuery } from '../get-file-content.query.js';
import { GetFileContentHandler } from './get-file-content.handler.js';

describe('GetFileContentHandler', () => {
  const findFirst = vi.fn();
  const execute = vi.fn();
  const jwt = new JwtService();
  const handler = new GetFileContentHandler(
    { meetingFile: { findFirst } } as unknown as PrismaService,
    { execute } as unknown as QueryBus,
    jwt,
    { pathOf: (key: string) => `/files/${key}` } as unknown as FilesStorageService,
  );

  const sign = (payload: object, secret = 'link-secret', audience = FILE_LINK_AUDIENCE) =>
    jwt.signAsync(payload, { secret, audience, expiresIn: 60 });

  beforeAll(() => {
    vi.stubEnv('FILE_LINK_SECRET', 'link-secret');
  });

  afterAll(() => {
    vi.unstubAllEnvs();
  });

  beforeEach(() => {
    findFirst.mockReset();
    execute.mockReset();
  });

  it('re-checks meeting access and returns the stored file', async () => {
    findFirst.mockResolvedValue({
      id: 'f1',
      meetingId: 'm1',
      storageKey: 'k1',
      originalName: 'a.mp4',
      mimeType: 'video/mp4',
    });
    const token = await sign({ sub: 'u1', fileId: 'f1' });

    await expect(handler.execute(new GetFileContentQuery('f1', token))).resolves.toEqual({
      path: '/files/k1',
      originalName: 'a.mp4',
      mimeType: 'video/mp4',
    });
    const query = execute.mock.calls[0][0] as GetMeetingQuery;
    expect(query).toBeInstanceOf(GetMeetingQuery);
    expect(query).toMatchObject({ ownerId: 'u1', id: 'm1' });
  });

  it.each([
    ['no token', () => Promise.resolve(undefined)],
    ['a token for another file', () => sign({ sub: 'u1', fileId: 'f2' })],
    ['a token signed with another secret', () => sign({ sub: 'u1', fileId: 'f1' }, 'jwt-secret')],
    ['a token with another audience', () => sign({ sub: 'u1', fileId: 'f1' }, 'link-secret', 'x')],
  ])('rejects %s (401)', async (_name, token) => {
    await expect(handler.execute(new GetFileContentQuery('f1', await token()))).rejects.toThrow(
      UnauthorizedException,
    );
    expect(findFirst).not.toHaveBeenCalled();
  });

  it('answers 404 when the file is gone or no longer accessible', async () => {
    const token = await sign({ sub: 'u1', fileId: 'f1' });
    findFirst.mockResolvedValue(null);

    await expect(handler.execute(new GetFileContentQuery('f1', token))).rejects.toThrow(
      NotFoundException,
    );

    findFirst.mockResolvedValue({ id: 'f1', meetingId: 'm1', storageKey: 'k1' });
    execute.mockRejectedValue(new NotFoundException());
    await expect(handler.execute(new GetFileContentQuery('f1', token))).rejects.toThrow(
      NotFoundException,
    );
  });
});

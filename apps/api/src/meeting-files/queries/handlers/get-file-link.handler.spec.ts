import { NotFoundException } from '@nestjs/common';
import type { QueryBus } from '@nestjs/cqrs';
import { JwtService } from '@nestjs/jwt';
import type { PrismaService } from '../../../prisma/prisma.service.js';
import { FILE_LINK_AUDIENCE } from '../../meeting-files.config.js';
import { GetFileLinkQuery } from '../get-file-link.query.js';
import { GetFileLinkHandler } from './get-file-link.handler.js';

describe('GetFileLinkHandler', () => {
  const findFirst = vi.fn();
  const execute = vi.fn();
  const jwt = new JwtService();
  const handler = new GetFileLinkHandler(
    { meetingFile: { findFirst } } as unknown as PrismaService,
    { execute } as unknown as QueryBus,
    jwt,
  );

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

  it('signs a short-lived link for a completed file of the meeting', async () => {
    findFirst.mockResolvedValue({ id: 'f1' });

    const link = await handler.execute(new GetFileLinkQuery('u1', 'm1', 'f1'));

    expect(findFirst).toHaveBeenCalledWith({
      where: { id: 'f1', meetingId: 'm1', status: { not: 'UPLOADING' } },
    });
    const token = new URL(link.url, 'http://api').searchParams.get('token') ?? '';
    expect(link.url.startsWith('/files/f1/content?token=')).toBe(true);
    await expect(
      jwt.verifyAsync(token, { secret: 'link-secret', audience: FILE_LINK_AUDIENCE }),
    ).resolves.toMatchObject({ sub: 'u1', fileId: 'f1' });
    expect(link.expiresAt.getTime() - Date.now()).toBeLessThanOrEqual(5 * 60 * 1000);
  });

  it('answers 404 for a file that is not in the meeting or not complete', async () => {
    findFirst.mockResolvedValue(null);

    await expect(handler.execute(new GetFileLinkQuery('u1', 'm1', 'f1'))).rejects.toThrow(
      NotFoundException,
    );
  });
});

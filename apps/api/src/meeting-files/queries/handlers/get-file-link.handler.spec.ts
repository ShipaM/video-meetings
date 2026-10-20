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
    findFirst.mockResolvedValue({ id: 'f1', kind: 'DOCUMENT', durationMs: null });

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

  it('lets a recording link live for the recording plus 30 minutes, for a player that seeks', async () => {
    findFirst.mockResolvedValue({ id: 'f1', kind: 'VIDEO', durationMs: 90 * 60 * 1000 });

    const link = await handler.execute(new GetFileLinkQuery('u1', 'm1', 'f1'));

    const lifetimeMs = link.expiresAt.getTime() - Date.now();
    expect(lifetimeMs).toBeGreaterThan(119 * 60 * 1000);
    expect(lifetimeMs).toBeLessThanOrEqual(120 * 60 * 1000);
    const token = new URL(link.url, 'http://api').searchParams.get('token') ?? '';
    const { exp } = await jwt.verifyAsync<{ exp: number }>(token, {
      secret: 'link-secret',
      audience: FILE_LINK_AUDIENCE,
    });
    expect(Math.abs(exp * 1000 - link.expiresAt.getTime())).toBeLessThan(2000);
  });

  it('caps a recording link at 6 hours, and gives an hour of play when the duration is unknown', async () => {
    findFirst.mockResolvedValue({ id: 'f1', kind: 'AUDIO', durationMs: 10 * 60 * 60 * 1000 });
    const long = await handler.execute(new GetFileLinkQuery('u1', 'm1', 'f1'));
    expect(long.expiresAt.getTime() - Date.now()).toBeLessThanOrEqual(6 * 60 * 60 * 1000);
    expect(long.expiresAt.getTime() - Date.now()).toBeGreaterThan(359 * 60 * 1000);

    findFirst.mockResolvedValue({ id: 'f1', kind: 'AUDIO', durationMs: null });
    const unknown = await handler.execute(new GetFileLinkQuery('u1', 'm1', 'f1'));
    expect(unknown.expiresAt.getTime() - Date.now()).toBeGreaterThan(59 * 60 * 1000);
    expect(unknown.expiresAt.getTime() - Date.now()).toBeLessThanOrEqual(60 * 60 * 1000);
  });

  it('answers 404 for a file that is not in the meeting or not complete', async () => {
    findFirst.mockResolvedValue(null);

    await expect(handler.execute(new GetFileLinkQuery('u1', 'm1', 'f1'))).rejects.toThrow(
      NotFoundException,
    );
  });
});

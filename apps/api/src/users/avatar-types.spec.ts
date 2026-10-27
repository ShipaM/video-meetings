import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { avatarContentMatches, resolveAvatarType } from './avatar-types.js';

describe('resolveAvatarType', () => {
  it.each([
    ['me.png', 'image/png', 'image/png'],
    ['me.jpg', 'image/jpeg', 'image/jpeg'],
    ['me.JPEG', 'image/jpg', 'image/jpeg'],
    ['me.webp', 'image/webp', 'image/webp'],
    ['me.png', '', 'image/png'],
    ['me.webp', 'application/octet-stream', 'image/webp'],
  ])('accepts %s declared as "%s"', (name, declared, mimeType) => {
    expect(resolveAvatarType(name, declared)).toBe(mimeType);
  });

  it.each([
    ['me.gif', 'image/gif'],
    ['notes.pdf', 'application/pdf'],
    ['me.png', 'image/jpeg'],
    ['no-extension', 'image/png'],
  ])('rejects %s declared as %s', (name, declared) => {
    expect(resolveAvatarType(name, declared)).toBeNull();
  });
});

describe('avatarContentMatches', () => {
  let dir: string;
  const png = Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13]),
    Buffer.from('IHDR'),
    Buffer.alloc(32, 1),
  ]);

  beforeAll(async () => {
    dir = await mkdtemp(path.join(tmpdir(), 'avatar-types-'));
    await writeFile(path.join(dir, 'png'), png);
  });

  afterAll(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('accepts content of the stored type', async () => {
    await expect(avatarContentMatches(path.join(dir, 'png'), 'image/png')).resolves.toBe(true);
  });

  it('rejects content of another type', async () => {
    await expect(avatarContentMatches(path.join(dir, 'png'), 'image/jpeg')).resolves.toBe(false);
  });

  it('treats a missing file as not matching', async () => {
    await expect(avatarContentMatches(path.join(dir, 'missing'), 'image/png')).resolves.toBe(false);
  });
});

import { resolveFileType } from './file-types.js';

describe('resolveFileType', () => {
  it.each([
    ['talk.mp3', 'audio/mpeg', 'AUDIO', 'audio/mpeg'],
    ['talk.m4a', 'audio/x-m4a', 'AUDIO', 'audio/mp4'],
    ['talk.webm', 'audio/webm', 'AUDIO', 'audio/webm'],
    ['talk.webm', 'video/webm', 'VIDEO', 'video/webm'],
    ['talk.MOV', 'video/quicktime', 'VIDEO', 'video/quicktime'],
    [
      'deck.pptx',
      'application/vnd.openxmlformats-officedocument.presentationml.presentation',
      'DOCUMENT',
      'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    ],
    ['notes.txt', 'text/plain; charset=utf-8', 'DOCUMENT', 'text/plain'],
    ['photo.jpeg', 'image/jpeg', 'IMAGE', 'image/jpeg'],
  ])('accepts %s declared as %s', (name, declared, kind, mimeType) => {
    expect(resolveFileType(name, declared)).toEqual({ kind, mimeType });
  });

  it('falls back to the extension when the browser declares no type', () => {
    expect(resolveFileType('talk.m4a', '')).toEqual({ kind: 'AUDIO', mimeType: 'audio/mp4' });
    expect(resolveFileType('clip.webm', 'application/octet-stream')).toEqual({
      kind: 'VIDEO',
      mimeType: 'video/webm',
    });
  });

  it.each([
    ['setup.exe', 'application/x-msdownload'],
    ['slides.pdf', 'video/mp4'],
    ['archive.zip', ''],
    ['no-extension', 'video/mp4'],
  ])('rejects %s declared as %s', (name, declared) => {
    expect(resolveFileType(name, declared)).toBeNull();
  });
});

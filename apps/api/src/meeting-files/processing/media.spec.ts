import { mkdtemp, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { makeRecording } from '../../../test/media.helpers.js';
import { RecordingError, extractAudio, probeMedia } from './media.js';

/** Runs the ffprobe and ffmpeg binaries installed with the app on small generated recordings. */
describe('media (ffprobe / ffmpeg)', () => {
  let dir: string;
  let video: string;
  let mute: string;
  const signal = new AbortController().signal;

  beforeAll(async () => {
    dir = await mkdtemp(path.join(tmpdir(), 'media-'));
    video = await makeRecording(dir, 'call.mp4', { seconds: 2, audio: 'tone', video: true });
    mute = await makeRecording(dir, 'mute.mp4', { seconds: 2, audio: 'none', video: true });
  });

  afterAll(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('reads the duration and whether there is sound', async () => {
    const info = await probeMedia(video, signal);
    expect(info.hasAudio).toBe(true);
    expect(info.durationMs).toBeGreaterThan(1900);
    expect(info.durationMs).toBeLessThan(2200);

    await expect(probeMedia(mute, signal)).resolves.toMatchObject({ hasAudio: false });
  });

  it('rejects a file that is not media with RecordingError', async () => {
    const junk = path.join(dir, 'junk.mp4');
    await writeFile(junk, 'not a recording');

    await expect(probeMedia(junk, signal)).rejects.toThrow(RecordingError);
    await expect(extractAudio(junk, path.join(dir, 'junk.wav'), 60_000, signal)).rejects.toThrow(
      RecordingError,
    );
  });

  it('extracts 16 kHz mono WAV and reports its duration', async () => {
    const audio = path.join(dir, 'audio.wav');

    const durationMs = await extractAudio(video, audio, 60_000, signal);

    expect(durationMs).toBeGreaterThan(1900);
    expect(durationMs).toBeLessThan(2200);
    expect((await stat(audio)).size).toBe(44 + durationMs * 32);
  });

  it('stops extracting a second past the limit', async () => {
    const audio = path.join(dir, 'cut.wav');

    await expect(extractAudio(video, audio, 500, signal)).resolves.toBe(1500);
  });

  it('rejects with the signal reason once aborted', async () => {
    const controller = new AbortController();
    controller.abort(new Error('timeout'));

    await expect(probeMedia(video, controller.signal)).rejects.toThrow('timeout');
  });
});

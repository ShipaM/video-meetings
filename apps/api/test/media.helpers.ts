import { execFile } from 'node:child_process';
import path from 'node:path';
import { promisify } from 'node:util';
import { ffmpegPath } from './../src/meeting-files/processing/processing.config.js';

const run = promisify(execFile);

/** What a generated recording holds. */
export interface RecordingSpec {
  seconds: number;
  /** A tone (the fake transcriber hears it as speech), silence, or no audio track at all. */
  audio: 'tone' | 'silence' | 'none';
  video: boolean;
}

/**
 * Writes a small genuine recording with the app's ffmpeg into `dir` and returns its path: MP3 for
 * audio only, MP4 (H.264 / AAC) with a video track. Generated per run, so no media is committed.
 */
export async function makeRecording(
  dir: string,
  name: string,
  { seconds, audio, video }: RecordingSpec,
): Promise<string> {
  const out = path.join(dir, name);
  const inputs: string[] = [];
  if (video) {
    inputs.push('-f', 'lavfi', '-i', `color=c=navy:s=64x64:r=5:d=${seconds}`);
  }
  if (audio === 'tone') {
    inputs.push('-f', 'lavfi', '-i', `sine=frequency=440:sample_rate=8000:duration=${seconds}`);
  } else if (audio === 'silence') {
    inputs.push('-f', 'lavfi', '-i', `anullsrc=r=8000:cl=mono:d=${seconds}`);
  }
  const codecs = video
    ? ['-c:v', 'libx264', '-pix_fmt', 'yuv420p', ...(audio === 'none' ? [] : ['-c:a', 'aac'])]
    : ['-ac', '1', '-b:a', '8k'];
  await run(ffmpegPath(), ['-v', 'error', '-y', ...inputs, ...codecs, '-t', `${seconds}`, out]);
  return out;
}

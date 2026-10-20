import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { TranscriptionError } from './transcriber.js';
import { WhisperTranscriber, parseWhisperOutput } from './whisper-transcriber.js';

/** whisper.cpp `-oj` output with the fields the parser reads. */
const output = (pieces: { from: number; to: number; text: string }[]) =>
  JSON.stringify({
    result: { language: 'en' },
    transcription: pieces.map(({ from, to, text }) => ({ offsets: { from, to }, text })),
  });

describe('parseWhisperOutput', () => {
  it('maps segments to trimmed pieces with millisecond timestamps', () => {
    expect(
      parseWhisperOutput(
        output([
          { from: 0, to: 4480, text: ' Good morning everyone.' },
          { from: 4480, to: 7200, text: " Let's start." },
        ]),
      ),
    ).toEqual([
      { startMs: 0, endMs: 4480, text: 'Good morning everyone.' },
      { startMs: 4480, endMs: 7200, text: "Let's start." },
    ]);
  });

  it('drops empty segments and non-speech notes such as [BLANK_AUDIO]', () => {
    expect(
      parseWhisperOutput(
        output([
          { from: 0, to: 1000, text: ' [BLANK_AUDIO]' },
          { from: 1000, to: 2000, text: ' (upbeat music)' },
          { from: 2000, to: 3000, text: '   ' },
          { from: 3000, to: 4000, text: ' Thanks [laughs] everyone.' },
        ]),
      ),
    ).toEqual([{ startMs: 3000, endMs: 4000, text: 'Thanks [laughs] everyone.' }]);
  });

  it('rejects output without a transcription', () => {
    expect(() => parseWhisperOutput('{}')).toThrow(TranscriptionError);
  });
});

// The successful run needs the real whisper-cli and a model: `scripts/processing-check.mjs`.
describe('WhisperTranscriber', () => {
  let dir: string;
  let audio: string;

  beforeAll(async () => {
    dir = await mkdtemp(path.join(tmpdir(), 'whisper-'));
    audio = path.join(dir, 'audio.wav');
    await writeFile(audio, Buffer.alloc(64));
  });

  afterAll(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  const transcriber = (cliPath: string) =>
    new WhisperTranscriber({ cliPath, modelPath: path.join(dir, 'model.bin'), threads: 2 });

  it('turns a CLI that cannot be started into TranscriptionError', async () => {
    await expect(
      transcriber('no-such-whisper-cli').transcribe(audio, new AbortController().signal),
    ).rejects.toThrow(TranscriptionError);
  });

  it('turns a CLI that fails into TranscriptionError', async () => {
    // Node rejects the whisper options and exits with an error, as a crashing CLI would.
    await expect(
      transcriber(process.execPath).transcribe(audio, new AbortController().signal),
    ).rejects.toThrow(TranscriptionError);
  });

  it('rejects with the signal reason once aborted', async () => {
    const controller = new AbortController();
    controller.abort(new Error('timeout'));

    await expect(
      transcriber(process.execPath).transcribe(audio, controller.signal),
    ).rejects.toThrow('timeout');
  });
});

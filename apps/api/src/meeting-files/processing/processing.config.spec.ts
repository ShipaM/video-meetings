import type { FactoryProvider } from '@nestjs/common';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
  recordingJobExpirationSeconds,
  transcriptSummaryTimeoutMs,
  transcriptionTimeoutMs,
  whisperSettings,
} from './processing.config.js';
import { FakeMeetingAnalyzer } from './fake-meeting-analyzer.js';
import type { MeetingAnalyzer } from './meeting-analyzer.js';
import { MeetingAnalyzerProvider } from './meeting-analyzer.provider.js';
import { OllamaMeetingAnalyzer } from './ollama-meeting-analyzer.js';
import type { Transcriber } from './transcriber.js';
import { TranscriberProvider } from './transcriber.provider.js';

describe('recording timeouts', () => {
  const hour = 60 * 60 * 1000;

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('derives the transcription timeout from the duration', () => {
    vi.stubEnv('WHISPER_SPEED_FACTOR', '2');
    vi.stubEnv('TRANSCRIPTION_TIMEOUT_MARGIN_SECONDS', '60');

    expect(transcriptionTimeoutMs(hour)).toBe(2 * hour + 60_000);
  });

  it('gives a transcript summary the document budget for every started hour', () => {
    vi.stubEnv('DOCUMENT_PROCESSING_TIMEOUT_SECONDS', '600');

    expect(transcriptSummaryTimeoutMs(0)).toBe(600_000);
    expect(transcriptSummaryTimeoutMs(hour)).toBe(600_000);
    expect(transcriptSummaryTimeoutMs(2.5 * hour)).toBe(3 * 600_000);
  });

  it('covers every stage of the longest recording in the job expiration', () => {
    // 180 min: 15 min prepare + 4.5 h + 5 min transcription + 3 x 15 min summary + 1 min.
    expect(recordingJobExpirationSeconds()).toBe(15 * 60 + 4.5 * 3600 + 300 + 45 * 60 + 60);
  });

  it('refuses a limit whose jobs cannot fit into the 24 hours pg-boss allows', () => {
    vi.stubEnv('MAX_RECORDING_MINUTES', '900');

    expect(() => recordingJobExpirationSeconds()).toThrow(/MAX_RECORDING_MINUTES=900/);
  });
});

describe('meeting analyzer provider', () => {
  const provider = MeetingAnalyzerProvider as FactoryProvider<MeetingAnalyzer>;

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('refuses to start with AI_PROVIDER=local without OLLAMA_MODEL', () => {
    vi.stubEnv('AI_PROVIDER', 'local');
    vi.stubEnv('OLLAMA_MODEL', '');

    expect(() => provider.useFactory()).toThrow(/OLLAMA_MODEL is not set/);
  });

  it('uses the local model with AI_PROVIDER=local and OLLAMA_MODEL', () => {
    vi.stubEnv('AI_PROVIDER', 'local');
    vi.stubEnv('OLLAMA_MODEL', 'qwen3:4b');

    expect(provider.useFactory()).toBeInstanceOf(OllamaMeetingAnalyzer);
  });

  it('needs no Ollama settings with AI_PROVIDER=fake', () => {
    vi.stubEnv('AI_PROVIDER', 'fake');
    vi.stubEnv('OLLAMA_MODEL', '');
    vi.stubEnv('OLLAMA_URL', '');

    expect(provider.useFactory()).toBeInstanceOf(FakeMeetingAnalyzer);
  });
});

describe('whisper model', () => {
  let modelsDir: string;

  beforeEach(async () => {
    modelsDir = await mkdtemp(path.join(tmpdir(), 'whisper-models-'));
    vi.stubEnv('WHISPER_MODELS_DIR', modelsDir);
  });

  afterEach(async () => {
    vi.unstubAllEnvs();
    await rm(modelsDir, { recursive: true, force: true });
  });

  it('uses base.en without WHISPER_MODEL', async () => {
    vi.stubEnv('WHISPER_MODEL', '');
    await writeFile(path.join(modelsDir, 'ggml-base.en.bin'), '');

    expect(whisperSettings().modelPath).toBe(path.join(modelsDir, 'ggml-base.en.bin'));
  });

  it('uses the model WHISPER_MODEL names', async () => {
    vi.stubEnv('WHISPER_MODEL', 'small.en');
    await writeFile(path.join(modelsDir, 'ggml-small.en.bin'), '');

    expect(whisperSettings().modelPath).toBe(path.join(modelsDir, 'ggml-small.en.bin'));
  });

  it('refuses to start with AI_PROVIDER=local when the model file is missing', () => {
    vi.stubEnv('AI_PROVIDER', 'local');
    vi.stubEnv('WHISPER_MODEL', '');

    const provider = TranscriberProvider as FactoryProvider<Transcriber>;

    expect(() => provider.useFactory()).toThrow(/Whisper model not found.*ggml-base\.en\.bin/);
  });
});

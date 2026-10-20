import {
  recordingJobExpirationSeconds,
  transcriptSummaryTimeoutMs,
  transcriptionTimeoutMs,
} from './processing.config.js';

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

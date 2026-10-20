import type { Provider } from '@nestjs/common';
import { FakeTranscriber } from './fake-transcriber.js';
import { aiProvider, whisperSettings } from './processing.config.js';
import { Transcriber } from './transcriber.js';
import { WhisperTranscriber } from './whisper-transcriber.js';

/** Binds `Transcriber` to the configured implementation; a misconfiguration fails at startup. */
export const TranscriberProvider: Provider = {
  provide: Transcriber,
  useFactory: (): Transcriber =>
    aiProvider() === 'local' ? new WhisperTranscriber(whisperSettings()) : new FakeTranscriber(),
};

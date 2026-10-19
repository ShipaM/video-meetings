import type { Provider } from '@nestjs/common';
import { FakeSummarizer } from './fake-summarizer.js';
import { OllamaSummarizer } from './ollama-summarizer.js';
import { aiProvider, ollamaSettings } from './processing.config.js';
import { Summarizer } from './summarizer.js';

/** Binds `Summarizer` to the configured implementation; a misconfiguration fails at startup. */
export const SummarizerProvider: Provider = {
  provide: Summarizer,
  useFactory: (): Summarizer =>
    aiProvider() === 'local' ? new OllamaSummarizer(ollamaSettings()) : new FakeSummarizer(),
};

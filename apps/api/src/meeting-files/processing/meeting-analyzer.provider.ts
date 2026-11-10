import type { Provider } from '@nestjs/common';
import { FakeMeetingAnalyzer } from './fake-meeting-analyzer.js';
import { MeetingAnalyzer } from './meeting-analyzer.js';
import { OllamaMeetingAnalyzer } from './ollama-meeting-analyzer.js';
import { aiProvider, ollamaSettings } from './processing.config.js';

/** Binds `MeetingAnalyzer` to the configured implementation; a misconfiguration fails at startup. */
export const MeetingAnalyzerProvider: Provider = {
  provide: MeetingAnalyzer,
  useFactory: (): MeetingAnalyzer =>
    aiProvider() === 'local'
      ? new OllamaMeetingAnalyzer(ollamaSettings())
      : new FakeMeetingAnalyzer(),
};

import type { Provider } from '@nestjs/common';
import { FakeMeetingAnalyzer } from './fake-meeting-analyzer.js';
import { MeetingAnalyzer } from './meeting-analyzer.js';
import { aiProvider } from './processing.config.js';

/** Binds `MeetingAnalyzer` to the configured implementation; a misconfiguration fails at startup. */
export const MeetingAnalyzerProvider: Provider = {
  provide: MeetingAnalyzer,
  useFactory: (): MeetingAnalyzer => {
    if (aiProvider() === 'local') {
      // Issue #123 binds OllamaMeetingAnalyzer here.
      throw new Error('AI_PROVIDER=local has no meeting analyzer yet');
    }
    return new FakeMeetingAnalyzer();
  },
};

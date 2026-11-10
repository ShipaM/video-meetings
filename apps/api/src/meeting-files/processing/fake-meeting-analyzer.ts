import { FakeControl } from './fake-control.js';
import { MeetingAnalyzer, type MeetingInsights } from './meeting-analyzer.js';
import { SummaryError } from './summarizer.js';

/** Longest part of the transcript the fake summary quotes. */
const QUOTED_CHARS = 300;
/** Longest part of the transcript an action item or a decision quotes. */
const ITEM_QUOTED_CHARS = 100;

/**
 * Deterministic stand-in for the model (`AI_PROVIDER=fake`): the summary, an action item with an
 * assignee, one without and a decision all quote the start of the transcript. Tests steer it
 * through `control` (fail, hang until aborted, hold calls until released).
 */
export class FakeMeetingAnalyzer extends MeetingAnalyzer {
  readonly control = new FakeControl();

  analyze(transcript: string, signal: AbortSignal): Promise<MeetingInsights> {
    return this.control.run(
      signal,
      () => new SummaryError('Fake meeting analyzer told to fail'),
      () => {
        const words = transcript.split(/\s+/).filter(Boolean);
        const text = words.join(' ');
        const quote = text.slice(0, ITEM_QUOTED_CHARS);
        return Promise.resolve({
          summary: `Summary of ${words.length} words: ${text.slice(0, QUOTED_CHARS)}`,
          actionItems: [
            { description: `Follow up on: ${quote}`, assignee: 'Alex' },
            { description: `Check: ${quote}`, assignee: null },
          ],
          decisions: [{ text: `Agreed on: ${quote}` }],
        });
      },
    );
  }
}

import { FakeControl } from './fake-control.js';
import { Summarizer, SummaryError } from './summarizer.js';

/** Longest part of the text the fake summary quotes. */
const QUOTED_CHARS = 300;

/**
 * Deterministic stand-in for the model (`AI_PROVIDER=fake`): the summary quotes the start of the
 * text. Tests steer it through `control` (fail, hang until aborted, hold calls until released).
 */
export class FakeSummarizer extends Summarizer {
  readonly control = new FakeControl();

  summarize(text: string, signal: AbortSignal): Promise<string> {
    return this.control.run(
      signal,
      () => new SummaryError('Fake summarizer told to fail'),
      () => {
        const words = text.split(/\s+/).filter(Boolean);
        return Promise.resolve(
          `Summary of ${words.length} words: ${words.join(' ').slice(0, QUOTED_CHARS)}`,
        );
      },
    );
  }
}

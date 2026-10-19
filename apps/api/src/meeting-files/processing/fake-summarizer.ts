import { Summarizer, SummaryError } from './summarizer.js';

export type FakeBehaviour = 'ok' | 'fail' | 'hang';

/** Longest part of the text the fake summary quotes. */
const QUOTED_CHARS = 300;

/**
 * Deterministic stand-in for the model (`AI_PROVIDER=fake`): the summary quotes the start of the
 * text. Tests steer it: fail, hang until aborted, or hold calls until released.
 */
export class FakeSummarizer extends Summarizer {
  /** Calls started since the last `reset`. */
  calls = 0;
  private finishedCalls = 0;
  private behaviour: FakeBehaviour = 'ok';
  private gate: Promise<void> | null = null;
  private releaseGate: (() => void) | null = null;
  private readonly waiters: { done: () => boolean; resolve: () => void }[] = [];

  async summarize(text: string, signal: AbortSignal): Promise<string> {
    this.calls += 1;
    this.notify();
    try {
      if (this.gate) {
        await this.untilAborted(signal, this.gate);
      }
      if (this.behaviour === 'hang') {
        await this.untilAborted(signal);
      }
      if (this.behaviour === 'fail') {
        throw new SummaryError('Fake summarizer told to fail');
      }
      const words = text.split(/\s+/).filter(Boolean);
      return `Summary of ${words.length} words: ${words.join(' ').slice(0, QUOTED_CHARS)}`;
    } finally {
      this.finishedCalls += 1;
      this.notify();
    }
  }

  behave(behaviour: FakeBehaviour): void {
    this.behaviour = behaviour;
  }

  /** Holds every call until the returned function is called (or the call is aborted). */
  hold(): () => void {
    this.gate = new Promise((resolve) => {
      this.releaseGate = resolve;
    });
    return () => {
      this.releaseGate?.();
      this.gate = null;
    };
  }

  /** Resolves once a call has started since the last `reset`. */
  started(): Promise<void> {
    return this.when(() => this.calls > 0);
  }

  /** Resolves once a call has finished (in any way) since the last `reset`. */
  finished(): Promise<void> {
    return this.when(() => this.finishedCalls > 0);
  }

  reset(): void {
    this.releaseGate?.();
    this.gate = null;
    this.behaviour = 'ok';
    this.calls = 0;
    this.finishedCalls = 0;
  }

  private when(done: () => boolean): Promise<void> {
    return done()
      ? Promise.resolve()
      : new Promise((resolve) => this.waiters.push({ done, resolve }));
  }

  private notify(): void {
    for (const waiter of [...this.waiters]) {
      if (waiter.done()) {
        this.waiters.splice(this.waiters.indexOf(waiter), 1);
        waiter.resolve();
      }
    }
  }

  /** Waits for `until` (forever without one) or rejects as soon as `signal` is aborted. */
  private untilAborted(signal: AbortSignal, until?: Promise<void>): Promise<void> {
    return new Promise((resolve, reject) => {
      const onAbort = () => reject(signal.reason as Error);
      if (signal.aborted) {
        onAbort();
        return;
      }
      signal.addEventListener('abort', onAbort, { once: true });
      void until?.then(() => {
        signal.removeEventListener('abort', onAbort);
        resolve();
      });
    });
  }
}

export type FakeBehaviour = 'ok' | 'fail' | 'hang';

/**
 * How tests steer a fake model (`FakeSummarizer`, `FakeTranscriber`): make its calls fail, hang
 * until aborted, or hold them until released, and wait for calls to start or finish.
 */
export class FakeControl {
  /** Calls started since the last `reset`. */
  calls = 0;
  private finishedCalls = 0;
  private behaviour: FakeBehaviour = 'ok';
  private gate: Promise<void> | null = null;
  private releaseGate: (() => void) | null = null;
  private readonly waiters: { done: () => boolean; resolve: () => void }[] = [];

  /**
   * Runs one call of the fake: waits while held, then hangs until `signal` is aborted, rejects
   * with `failure()`, or resolves to `produce()`, as told.
   */
  async run<T>(signal: AbortSignal, failure: () => Error, produce: () => Promise<T>): Promise<T> {
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
        throw failure();
      }
      return await produce();
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

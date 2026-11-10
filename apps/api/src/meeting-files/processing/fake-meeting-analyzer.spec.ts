import type { FactoryProvider } from '@nestjs/common';
import { FakeMeetingAnalyzer } from './fake-meeting-analyzer.js';
import { MeetingAnalyzer } from './meeting-analyzer.js';
import { MeetingAnalyzerProvider } from './meeting-analyzer.provider.js';
import { SummaryError } from './summarizer.js';

describe('FakeMeetingAnalyzer', () => {
  const transcript = 'Fake speech 1. Fake speech 2. Fake speech 3.';
  const signal = new AbortController().signal;

  it('quotes the transcript in the summary, an assigned and an unassigned action item and a decision', async () => {
    const analyzer = new FakeMeetingAnalyzer();

    const insights = await analyzer.analyze(transcript, signal);

    expect(insights.summary).toContain(transcript);
    expect(insights.actionItems).toEqual([
      { description: expect.stringContaining('Fake speech 1.') as string, assignee: 'Alex' },
      { description: expect.stringContaining('Fake speech 1.') as string, assignee: null },
    ]);
    expect(insights.decisions).toEqual([
      { text: expect.stringContaining('Fake speech 1.') as string },
    ]);
    expect(analyzer.control.calls).toBe(1);
  });

  it('rejects with SummaryError when told to fail', async () => {
    const analyzer = new FakeMeetingAnalyzer();
    analyzer.control.behave('fail');

    await expect(analyzer.analyze(transcript, signal)).rejects.toBeInstanceOf(SummaryError);
  });

  it('hangs until the signal is aborted and rejects with its reason', async () => {
    const analyzer = new FakeMeetingAnalyzer();
    analyzer.control.behave('hang');
    const controller = new AbortController();
    const reason = new Error('timed out');

    const analysis = analyzer.analyze(transcript, controller.signal);
    controller.abort(reason);

    await expect(analysis).rejects.toBe(reason);
  });
});

describe('MeetingAnalyzerProvider', () => {
  const provider = MeetingAnalyzerProvider as FactoryProvider<MeetingAnalyzer>;

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('is the MeetingAnalyzer token', () => {
    expect(provider.provide).toBe(MeetingAnalyzer);
  });

  it('binds the fake with AI_PROVIDER=fake', () => {
    vi.stubEnv('AI_PROVIDER', 'fake');
    expect(provider.useFactory()).toBeInstanceOf(FakeMeetingAnalyzer);
  });

  it('refuses AI_PROVIDER=local until the Ollama analyzer exists', () => {
    vi.stubEnv('AI_PROVIDER', 'local');

    expect(() => provider.useFactory()).toThrow(/no meeting analyzer yet/);
  });
});

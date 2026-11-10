import { OllamaMeetingAnalyzer } from './ollama-meeting-analyzer.js';
import { SummaryError } from './summarizer.js';

describe('OllamaMeetingAnalyzer', () => {
  const fetchMock = vi.fn();
  // numCtx 100 allows 200 characters per request.
  const settings = { url: 'http://ollama.test', model: 'test-model', numCtx: 100 };
  const signal = new AbortController().signal;
  const paragraph = 'word '.repeat(30).trim();
  const longTranscript = [paragraph, paragraph, paragraph].join('\n\n');

  const answer = (content: string, status = 200) =>
    new Response(JSON.stringify({ message: { content } }), { status });
  const json = (value: unknown) => answer(JSON.stringify(value));
  const insights = (
    summary: string,
    actionItems: unknown[] = [],
    decisions: unknown[] = [],
  ): Response => json({ summary, actionItems, decisions });
  /** The body of the `call`-th request. */
  const sentBody = (call: number) => {
    const [, init] = fetchMock.mock.calls[call] as [string, RequestInit];
    return JSON.parse(init.body as string) as {
      format: { required: string[] };
      messages: { content: string }[];
    };
  };

  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('asks the model for the insights of a short transcript in one request', async () => {
    fetchMock.mockResolvedValue(
      insights(
        '  - One point  ',
        [
          { description: ' Send the report ', assignee: ' Alex ' },
          { description: 'Book a room', assignee: null },
          { description: 'Check the budget', assignee: '  ' },
          { description: 'Order lunch', assignee: 'null' },
          { description: '  ', assignee: 'Sam' },
        ],
        [{ text: ' Ship on Friday ' }, { text: '' }],
      ),
    );

    await expect(
      new OllamaMeetingAnalyzer(settings).analyze('Short meeting', signal),
    ).resolves.toEqual({
      summary: '- One point',
      actionItems: [
        { description: 'Send the report', assignee: 'Alex' },
        { description: 'Book a room', assignee: null },
        { description: 'Check the budget', assignee: null },
        { description: 'Order lunch', assignee: null },
      ],
      decisions: [{ text: 'Ship on Friday' }],
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('http://ollama.test/api/chat');
    expect(init.signal).toBe(signal);
    const body = sentBody(0);
    expect(body).toMatchObject({
      model: 'test-model',
      stream: false,
      think: false,
      format: { required: ['summary', 'actionItems', 'decisions'] },
      options: { num_ctx: 100 },
    });
    expect(body).not.toHaveProperty('tools');
    expect(body.messages[1].content).toBe('Short meeting');
  });

  it('accepts empty lists', async () => {
    fetchMock.mockResolvedValue(insights('- Small talk'));

    await expect(new OllamaMeetingAnalyzer(settings).analyze('Hello', signal)).resolves.toEqual({
      summary: '- Small talk',
      actionItems: [],
      decisions: [],
    });
  });

  it('analyzes a long transcript in parts, combines the summaries and joins the lists without exact duplicates', async () => {
    fetchMock
      .mockResolvedValueOnce(
        insights(
          '- part 1',
          [
            { description: 'Send the report', assignee: 'Alex' },
            { description: 'Book a room', assignee: null },
          ],
          [{ text: 'Ship on Friday' }],
        ),
      )
      .mockResolvedValueOnce(
        insights(
          '- part 2',
          [
            { description: 'Send the report', assignee: 'Alex' },
            { description: 'Send the report', assignee: 'Sam' },
          ],
          [{ text: 'Ship on Friday' }, { text: 'Hire a designer' }],
        ),
      )
      .mockResolvedValueOnce(insights('- part 3', [{ description: 'Book a room', assignee: null }]))
      .mockResolvedValueOnce(json({ summary: '- combined' }));

    await expect(
      new OllamaMeetingAnalyzer(settings).analyze(longTranscript, signal),
    ).resolves.toEqual({
      summary: '- combined',
      actionItems: [
        { description: 'Send the report', assignee: 'Alex' },
        { description: 'Book a room', assignee: null },
        { description: 'Send the report', assignee: 'Sam' },
      ],
      decisions: [{ text: 'Ship on Friday' }, { text: 'Hire a designer' }],
    });

    expect(fetchMock).toHaveBeenCalledTimes(4);
    expect(sentBody(0).messages[1].content).toBe(paragraph);
    expect(sentBody(2).messages[1].content).toBe(paragraph);
    // The part summaries are combined into one summary only, the lists stay in code.
    expect(sentBody(3).format.required).toEqual(['summary']);
    expect(sentBody(3).messages[1].content).toBe('- part 1\n\n- part 2\n\n- part 3');
  });

  it.each([
    ['an error status', () => answer('{}', 500)],
    ['an answer that is not JSON', () => answer('Sure! Here are the insights')],
    ['an empty summary', () => insights('   ')],
    [
      'lists that are not arrays',
      () => json({ summary: '- ok', actionItems: 'none', decisions: [] }),
    ],
    ['missing lists', () => json({ summary: '- ok' })],
    ['an action item without a description', () => insights('- ok', [{ assignee: 'Alex' }])],
    [
      'an assignee that is not a string',
      () => insights('- ok', [{ description: 'x', assignee: 1 }]),
    ],
    ['a decision without text', () => insights('- ok', [], [{ title: 'x' }])],
  ])('rejects with SummaryError for %s', async (_, response) => {
    fetchMock.mockResolvedValue(response());

    await expect(new OllamaMeetingAnalyzer(settings).analyze('meeting', signal)).rejects.toThrow(
      SummaryError,
    );
  });

  it('rejects with SummaryError when only one part fails', async () => {
    fetchMock
      .mockResolvedValueOnce(insights('- part 1'))
      .mockResolvedValueOnce(json({ summary: '- part 2', actionItems: [{}], decisions: [] }));

    await expect(
      new OllamaMeetingAnalyzer(settings).analyze(longTranscript, signal),
    ).rejects.toThrow(SummaryError);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('rejects with SummaryError when Ollama is unreachable', async () => {
    fetchMock.mockRejectedValue(new TypeError('fetch failed'));

    await expect(new OllamaMeetingAnalyzer(settings).analyze('meeting', signal)).rejects.toThrow(
      SummaryError,
    );
  });

  it('passes an abort through as it is', async () => {
    const controller = new AbortController();
    const reason = new Error('timed out');
    fetchMock.mockImplementation(() => {
      controller.abort(reason);
      return Promise.reject(reason);
    });

    await expect(
      new OllamaMeetingAnalyzer(settings).analyze('meeting', controller.signal),
    ).rejects.toBe(reason);
  });
});

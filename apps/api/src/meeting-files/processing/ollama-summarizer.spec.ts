import { OllamaSummarizer, splitText } from './ollama-summarizer.js';
import { SummaryError } from './summarizer.js';

describe('splitText', () => {
  it('keeps short text whole', () => {
    expect(splitText('  short text  ', 100)).toEqual(['short text']);
  });

  it('cuts at paragraph, then line, then word boundaries, never above the limit', () => {
    const paragraph = 'word '.repeat(30).trim(); // 149 characters
    const text = [paragraph, paragraph, paragraph].join('\n\n');

    const parts = splitText(text, 200);

    expect(parts).toEqual([paragraph, paragraph, paragraph]);
    expect(splitText('a'.repeat(250), 100)).toEqual([
      'a'.repeat(100),
      'a'.repeat(100),
      'a'.repeat(50),
    ]);
  });
});

describe('OllamaSummarizer', () => {
  const fetchMock = vi.fn();
  const settings = { url: 'http://ollama.test', model: 'test-model', numCtx: 100 };
  const signal = new AbortController().signal;

  const answer = (content: string, status = 200) =>
    new Response(JSON.stringify({ message: { content } }), { status });
  const summary = (text: string) => answer(JSON.stringify({ summary: text }));
  /** The document text sent in the `call`-th request. */
  const sentText = (call: number): string => {
    const [, init] = fetchMock.mock.calls[call] as [string, RequestInit];
    return (JSON.parse(init.body as string) as { messages: { content: string }[] }).messages[1]
      .content;
  };

  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('asks the model for a JSON summary of short text in one request', async () => {
    fetchMock.mockResolvedValue(summary('  - One point  '));

    await expect(new OllamaSummarizer(settings).summarize('Short notes', signal)).resolves.toBe(
      '- One point',
    );

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('http://ollama.test/api/chat');
    expect(init.signal).toBe(signal);
    expect(JSON.parse(init.body as string)).toMatchObject({
      model: 'test-model',
      stream: false,
      format: { required: ['summary'] },
      options: { num_ctx: 100 },
    });
  });

  it('summarizes long text in parts and then combines the part summaries', async () => {
    // numCtx 100 allows 200 characters per request.
    const paragraph = 'word '.repeat(30).trim();
    const text = [paragraph, paragraph, paragraph].join('\n\n');
    fetchMock
      .mockResolvedValueOnce(summary('- part 1'))
      .mockResolvedValueOnce(summary('- part 2'))
      .mockResolvedValueOnce(summary('- part 3'))
      .mockResolvedValueOnce(summary('- combined'));

    await expect(new OllamaSummarizer(settings).summarize(text, signal)).resolves.toBe(
      '- combined',
    );

    expect(fetchMock).toHaveBeenCalledTimes(4);
    expect(sentText(0)).toBe(paragraph);
    expect(sentText(3)).toBe('- part 1\n\n- part 2\n\n- part 3');
  });

  it.each([
    ['an error status', () => answer('{}', 500)],
    ['an answer that is not JSON', () => answer('Sure! Here is a summary')],
    ['an empty summary', () => summary('   ')],
  ])('rejects with SummaryError for %s', async (_, response) => {
    fetchMock.mockResolvedValue(response());

    await expect(new OllamaSummarizer(settings).summarize('notes', signal)).rejects.toThrow(
      SummaryError,
    );
  });

  it('rejects with SummaryError when Ollama is unreachable', async () => {
    fetchMock.mockRejectedValue(new TypeError('fetch failed'));

    await expect(new OllamaSummarizer(settings).summarize('notes', signal)).rejects.toThrow(
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

    await expect(new OllamaSummarizer(settings).summarize('notes', controller.signal)).rejects.toBe(
      reason,
    );
  });
});

import { Logger } from '@nestjs/common';
import type { OllamaSettings } from './processing.config.js';
import { SummaryError } from './summarizer.js';

/** The answer shape requested through Ollama's `format` for a summary (a JSON schema). */
const SUMMARY_SCHEMA = {
  type: 'object',
  properties: { summary: { type: 'string' } },
  required: ['summary'],
};

/** Instructions for summarizing one part of a text and for combining part summaries. */
export interface CombinePrompts {
  part: string;
  combine: string;
}

/** Rounds of combining part summaries before giving up (each round must shorten the text). */
const MAX_COMBINE_ROUNDS = 3;

/**
 * Characters of input per request: about 3 characters per token, with a third of the context left
 * for the instructions and the answer.
 */
export const chunkCharsFor = (numCtx: number): number => Math.floor(numCtx * 2);

/** Splits text into parts of at most `maxChars`, at paragraph, then line, then word boundaries. */
export function splitText(text: string, maxChars: number): string[] {
  const parts: string[] = [];
  let rest = text.trim();
  while (rest.length > maxChars) {
    const window = rest.slice(0, maxChars);
    const cut = ['\n\n', '\n', ' ']
      .map((separator) => window.lastIndexOf(separator))
      .find((index) => index > maxChars / 2);
    const end = cut ?? maxChars;
    parts.push(rest.slice(0, end).trim());
    rest = rest.slice(end).trim();
  }
  if (rest) {
    parts.push(rest);
  }
  return parts;
}

/**
 * The request code shared by the Ollama adapters: one chat request with a JSON schema through
 * `format` (no tools), and the map-reduce combining of part summaries. Every failure except an
 * abort is a `SummaryError`, logged under the owner's name; an abort rejects with the signal's reason.
 */
export class OllamaChat {
  /** Characters of input that fit into one request. */
  readonly maxChars: number;
  private readonly logger: Logger;

  constructor(
    private readonly settings: OllamaSettings,
    owner: string,
  ) {
    this.maxChars = chunkCharsFor(settings.numCtx);
    this.logger = new Logger(owner);
  }

  /** Asks for an answer of the `format` schema and resolves to the parsed, not yet validated JSON. */
  async ask(
    format: object,
    instructions: string,
    text: string,
    signal: AbortSignal,
  ): Promise<unknown> {
    let response: Response;
    try {
      response = await fetch(`${this.settings.url}/api/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: this.settings.model,
          stream: false,
          // Thinking models (e.g. Qwen3) would reason at length first: slow on a CPU, not needed.
          think: false,
          format,
          options: { num_ctx: this.settings.numCtx, temperature: 0.2 },
          messages: [
            { role: 'system', content: instructions },
            { role: 'user', content: text },
          ],
        }),
        signal,
      });
    } catch (error) {
      if (signal.aborted) {
        throw signal.reason as Error;
      }
      throw this.failure(`Ollama is unreachable at ${this.settings.url}: ${String(error)}`);
    }
    if (!response.ok) {
      const detail = await response.text().catch(() => '');
      throw this.failure(`Ollama answered ${response.status}: ${detail.slice(0, 200)}`);
    }

    try {
      const body = (await response.json()) as { message?: { content?: string } };
      return JSON.parse(body.message?.content ?? '') as unknown;
    } catch {
      if (signal.aborted) {
        throw signal.reason as Error;
      }
      throw this.failure('Ollama returned an answer that is not the requested JSON');
    }
  }

  /** Asks for a `{ summary }` answer and resolves to the trimmed, non-empty summary. */
  async askSummary(instructions: string, text: string, signal: AbortSignal): Promise<string> {
    const answer = await this.ask(SUMMARY_SCHEMA, instructions, text, signal);
    const summary = (answer as { summary?: unknown } | null)?.summary;
    if (typeof summary !== 'string' || !summary.trim()) {
      throw this.failure('Ollama returned an empty summary');
    }
    return summary.trim();
  }

  /**
   * Combines the summaries of consecutive parts of a text that was `sourceLength` characters long
   * into one summary. When they do not fit into one request, they are summarized in parts again,
   * for at most `MAX_COMBINE_ROUNDS` rounds and only while that makes them shorter.
   */
  async combine(
    summaries: string[],
    sourceLength: number,
    prompts: CombinePrompts,
    signal: AbortSignal,
    round = 0,
  ): Promise<string> {
    const combined = summaries.join('\n\n');
    if (combined.length <= this.maxChars) {
      return this.askSummary(prompts.combine, combined, signal);
    }
    if (round + 1 >= MAX_COMBINE_ROUNDS || combined.length >= sourceLength) {
      throw this.failure('The part summaries do not get shorter; giving up');
    }
    const partSummaries: string[] = [];
    for (const part of splitText(combined, this.maxChars)) {
      partSummaries.push(await this.askSummary(prompts.part, part, signal));
    }
    return this.combine(partSummaries, combined.length, prompts, signal, round + 1);
  }

  failure(message: string): SummaryError {
    this.logger.warn(message);
    return new SummaryError(message);
  }
}

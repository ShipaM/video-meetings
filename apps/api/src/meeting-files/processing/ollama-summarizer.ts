import { Logger } from '@nestjs/common';
import type { OllamaSettings } from './processing.config.js';
import { Summarizer, SummaryError, type SummarySource } from './summarizer.js';

/** The answer shape requested through Ollama's `format` (a JSON schema). */
const SUMMARY_SCHEMA = {
  type: 'object',
  properties: { summary: { type: 'string' } },
  required: ['summary'],
};

/** Instructions for the whole text, for one part of it, and for combining part summaries. */
interface Prompts {
  whole: string;
  part: string;
  combine: string;
}

/** The instructions for each step, worded for a document or a transcript. */
const prompts = (source: SummarySource): Prompts => {
  const what = source === 'transcript' ? 'meeting transcript' : 'meeting document';
  return {
    whole:
      `You summarize a ${what}. Write a concise summary in English: the topic, the key points ` +
      'and decisions, and any action items with their owners. Use short "- " bullet points, at ' +
      'most 10. Do not invent anything that is not in the text. Answer as JSON: {"summary": "..."}.',
    part:
      `You summarize one part of a longer ${what}. List its key points, decisions and action ` +
      'items as short "- " bullet points. Do not invent anything that is not in the text. Answer ' +
      'as JSON: {"summary": "..."}.',
    combine:
      `These are summaries of consecutive parts of one ${what}. Merge them into one concise ` +
      'summary in English: the topic, the key points and decisions, and the action items with ' +
      'their owners, as short "- " bullet points, at most 10, without repeating anything. Answer ' +
      'as JSON: {"summary": "..."}.',
  };
};

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
 * Summaries by a local model in Ollama (`AI_PROVIDER=local`) over its HTTP API, so no meeting
 * content leaves the server. Text longer than one context window is summarized in parts, and the
 * part summaries are then combined (map-reduce).
 */
export class OllamaSummarizer extends Summarizer {
  private readonly logger = new Logger(OllamaSummarizer.name);
  private readonly maxChars: number;

  constructor(private readonly settings: OllamaSettings) {
    super();
    this.maxChars = chunkCharsFor(settings.numCtx);
  }

  summarize(
    text: string,
    signal: AbortSignal,
    source: SummarySource = 'document',
  ): Promise<string> {
    return this.summarizeRound(text, signal, prompts(source), 0);
  }

  private async summarizeRound(
    text: string,
    signal: AbortSignal,
    prompt: Prompts,
    round: number,
  ): Promise<string> {
    const parts = splitText(text, this.maxChars);
    if (parts.length === 1) {
      return this.ask(round === 0 ? prompt.whole : prompt.combine, parts[0], signal);
    }
    const summaries: string[] = [];
    for (const part of parts) {
      summaries.push(await this.ask(prompt.part, part, signal));
    }
    const combined = summaries.join('\n\n');
    if (combined.length <= this.maxChars) {
      return this.ask(prompt.combine, combined, signal);
    }
    // Still too long for one request: summarize the part summaries the same way, as long as that
    // converges.
    if (round + 1 >= MAX_COMBINE_ROUNDS || combined.length >= text.length) {
      throw this.failure('The part summaries do not get shorter; giving up');
    }
    return this.summarizeRound(combined, signal, prompt, round + 1);
  }

  private async ask(instructions: string, text: string, signal: AbortSignal): Promise<string> {
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
          format: SUMMARY_SCHEMA,
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
        throw error;
      }
      throw this.failure(`Ollama is unreachable at ${this.settings.url}: ${String(error)}`);
    }
    if (!response.ok) {
      const detail = await response.text().catch(() => '');
      throw this.failure(`Ollama answered ${response.status}: ${detail.slice(0, 200)}`);
    }

    let summary: unknown;
    try {
      const body = (await response.json()) as { message?: { content?: string } };
      summary = (JSON.parse(body.message?.content ?? '') as { summary?: unknown }).summary;
    } catch (error) {
      if (signal.aborted) {
        throw error;
      }
      throw this.failure('Ollama returned an answer that is not the requested JSON');
    }
    if (typeof summary !== 'string' || !summary.trim()) {
      throw this.failure('Ollama returned an empty summary');
    }
    return summary.trim();
  }

  private failure(message: string): SummaryError {
    this.logger.warn(message);
    return new SummaryError(message);
  }
}

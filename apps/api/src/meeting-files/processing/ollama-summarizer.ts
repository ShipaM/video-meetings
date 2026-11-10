import { OllamaChat, splitText } from './ollama-chat.js';
import type { OllamaSettings } from './processing.config.js';
import { Summarizer, type SummarySource } from './summarizer.js';

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

/**
 * Summaries by a local model in Ollama (`AI_PROVIDER=local`) over its HTTP API, so no meeting
 * content leaves the server. Text longer than one context window is summarized in parts, and the
 * part summaries are then combined (map-reduce).
 */
export class OllamaSummarizer extends Summarizer {
  private readonly chat: OllamaChat;

  constructor(settings: OllamaSettings) {
    super();
    this.chat = new OllamaChat(settings, OllamaSummarizer.name);
  }

  async summarize(
    text: string,
    signal: AbortSignal,
    source: SummarySource = 'document',
  ): Promise<string> {
    const prompt = prompts(source);
    const parts = splitText(text, this.chat.maxChars);
    if (parts.length === 1) {
      return this.chat.askSummary(prompt.whole, parts[0], signal);
    }
    const summaries: string[] = [];
    for (const part of parts) {
      summaries.push(await this.chat.askSummary(prompt.part, part, signal));
    }
    return this.chat.combine(summaries, text.length, prompt, signal);
  }
}

import { OllamaChat, splitText } from './ollama-chat.js';
import type { OllamaSettings } from './processing.config.js';
import { Summarizer } from './summarizer.js';

/** Instructions for the whole text, for one part of it, and for combining part summaries. */
const PROMPTS = {
  whole:
    'You summarize a meeting document. Write a concise summary in English: the topic, the key ' +
    'points and decisions, and any action items with their owners. Use short "- " bullet points, ' +
    'at most 10. Do not invent anything that is not in the text. Answer as JSON: {"summary": "..."}.',
  part:
    'You summarize one part of a longer meeting document. List its key points, decisions and ' +
    'action items as short "- " bullet points. Do not invent anything that is not in the text. ' +
    'Answer as JSON: {"summary": "..."}.',
  combine:
    'These are summaries of consecutive parts of one meeting document. Merge them into one ' +
    'concise summary in English: the topic, the key points and decisions, and the action items ' +
    'with their owners, as short "- " bullet points, at most 10, without repeating anything. ' +
    'Answer as JSON: {"summary": "..."}.',
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

  async summarize(text: string, signal: AbortSignal): Promise<string> {
    const parts = splitText(text, this.chat.maxChars);
    if (parts.length === 1) {
      return this.chat.askSummary(PROMPTS.whole, parts[0], signal);
    }
    const summaries: string[] = [];
    for (const part of parts) {
      summaries.push(await this.chat.askSummary(PROMPTS.part, part, signal));
    }
    return this.chat.combine(summaries, text.length, PROMPTS, signal);
  }
}

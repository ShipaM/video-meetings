import {
  MeetingAnalyzer,
  type ActionItemInsight,
  type DecisionInsight,
  type MeetingInsights,
} from './meeting-analyzer.js';
import { OllamaChat, splitText, type CombinePrompts } from './ollama-chat.js';
import type { OllamaSettings } from './processing.config.js';

/** The answer shape requested through Ollama's `format` (a JSON schema); checked again in code. */
const INSIGHTS_SCHEMA = {
  type: 'object',
  properties: {
    summary: { type: 'string' },
    actionItems: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          description: { type: 'string' },
          assignee: { type: ['string', 'null'] },
        },
        required: ['description', 'assignee'],
      },
    },
    decisions: {
      type: 'array',
      items: {
        type: 'object',
        properties: { text: { type: 'string' } },
        required: ['text'],
      },
    },
  },
  required: ['summary', 'actionItems', 'decisions'],
};

const ANSWER_SHAPE =
  'Answer as JSON: {"summary": "...", "actionItems": [{"description": "...", "assignee": "Name"}], ' +
  '"decisions": [{"text": "..."}]}. An action item is a task someone agreed to do; its assignee ' +
  'is the person named for it, or JSON null when nobody was named. A decision is something ' +
  'the participants agreed on. Use empty lists when there are none. Do not invent anything that ' +
  'is not in the transcript.';

/** Instructions for the whole transcript and for one part of it. */
const WHOLE_PROMPT =
  'You analyze a meeting transcript. Write a concise summary in English: the topic and the key ' +
  'points, as short "- " bullet points, at most 10. List the action items and the decisions. ' +
  ANSWER_SHAPE;
const PART_PROMPT =
  'You analyze one part of a longer meeting transcript. Summarize its key points as short "- " ' +
  'bullet points, and list the action items and the decisions of this part. ' +
  ANSWER_SHAPE;

/** Instructions for combining the part summaries (the lists are joined in code). */
const COMBINE_PROMPTS: CombinePrompts = {
  part:
    'These are summaries of consecutive parts of a long meeting transcript. Shorten them into ' +
    'one list of the key points as short "- " bullet points, without repeating anything. Do not ' +
    'invent anything that is not in the text. Answer as JSON: {"summary": "..."}.',
  combine:
    'These are summaries of consecutive parts of one meeting transcript. Merge them into one ' +
    'concise summary in English: the topic and the key points, as short "- " bullet points, at ' +
    'most 10, without repeating anything. Answer as JSON: {"summary": "..."}.',
};

/** A non-empty trimmed string, or `undefined` for anything else. */
const text = (value: unknown): string | undefined =>
  typeof value === 'string' && value.trim() ? value.trim() : undefined;

/** Assignees a model writes when nobody was named. */
const NO_ASSIGNEE = /^(null|none|n\/a|unassigned|nobody)$/i;

/** Keeps the first of every group of equal items, in order. */
const withoutDuplicates = <T>(items: T[], key: (item: T) => string): T[] => {
  const seen = new Set<string>();
  return items.filter((item) => {
    const itemKey = key(item);
    if (seen.has(itemKey)) {
      return false;
    }
    seen.add(itemKey);
    return true;
  });
};

/**
 * Insights by a local model in Ollama (`AI_PROVIDER=local`), so no meeting content leaves the
 * server. A transcript longer than one context window is analyzed in parts: the part summaries are
 * combined by the model like `OllamaSummarizer` does, and the lists are joined in order without
 * exact duplicates, in code.
 */
export class OllamaMeetingAnalyzer extends MeetingAnalyzer {
  private readonly chat: OllamaChat;

  constructor(settings: OllamaSettings) {
    super();
    this.chat = new OllamaChat(settings, OllamaMeetingAnalyzer.name);
  }

  async analyze(transcript: string, signal: AbortSignal): Promise<MeetingInsights> {
    const parts = splitText(transcript, this.chat.maxChars);
    if (parts.length === 1) {
      return this.askInsights(WHOLE_PROMPT, parts[0], signal);
    }
    const partInsights: MeetingInsights[] = [];
    for (const part of parts) {
      partInsights.push(await this.askInsights(PART_PROMPT, part, signal));
    }
    const summary = await this.chat.combine(
      partInsights.map((insights) => insights.summary),
      transcript.length,
      COMBINE_PROMPTS,
      signal,
    );
    return {
      summary,
      actionItems: withoutDuplicates(
        partInsights.flatMap((insights) => insights.actionItems),
        (item) => JSON.stringify([item.description, item.assignee]),
      ),
      decisions: withoutDuplicates(
        partInsights.flatMap((insights) => insights.decisions),
        (decision) => decision.text,
      ),
    };
  }

  private async askInsights(
    instructions: string,
    part: string,
    signal: AbortSignal,
  ): Promise<MeetingInsights> {
    const answer = await this.chat.ask(INSIGHTS_SCHEMA, instructions, part, signal);
    const insights = this.validate(answer);
    if (!insights) {
      throw this.chat.failure('Ollama returned insights of the wrong structure');
    }
    return insights;
  }

  /**
   * The answer as `MeetingInsights`, or `undefined` for a wrong structure or an empty summary.
   * Strings are trimmed, blank items are left out, and a blank or "null" assignee is null.
   */
  private validate(answer: unknown): MeetingInsights | undefined {
    const { summary, actionItems, decisions } = (answer ?? {}) as Record<string, unknown>;
    const summaryText = text(summary);
    if (!summaryText || !Array.isArray(actionItems) || !Array.isArray(decisions)) {
      return undefined;
    }
    const items: ActionItemInsight[] = [];
    for (const item of actionItems as unknown[]) {
      const { description, assignee } = (item ?? {}) as Record<string, unknown>;
      if (typeof description !== 'string' || (assignee != null && typeof assignee !== 'string')) {
        return undefined;
      }
      const descriptionText = text(description);
      const assigneeText = text(assignee);
      if (descriptionText) {
        items.push({
          description: descriptionText,
          assignee: assigneeText && !NO_ASSIGNEE.test(assigneeText) ? assigneeText : null,
        });
      }
    }
    const decisionList: DecisionInsight[] = [];
    for (const decision of decisions as unknown[]) {
      const decisionValue = ((decision ?? {}) as Record<string, unknown>).text;
      if (typeof decisionValue !== 'string') {
        return undefined;
      }
      const decisionText = text(decisionValue);
      if (decisionText) {
        decisionList.push({ text: decisionText });
      }
    }
    return { summary: summaryText, actionItems: items, decisions: decisionList };
  }
}

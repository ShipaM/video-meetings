/** A task named in the meeting; `assignee` is null when nobody was named. */
export interface ActionItemInsight {
  description: string;
  assignee: string | null;
}

/** A decision taken in the meeting. */
export interface DecisionInsight {
  text: string;
}

/** What the analysis of a recording's transcript gives: a summary, action items and decisions. */
export interface MeetingInsights {
  summary: string;
  actionItems: ActionItemInsight[];
  decisions: DecisionInsight[];
}

/**
 * Turns a recording's transcript into a summary, action items and decisions. Bound to the local
 * Ollama model or to a fake through `AI_PROVIDER`; the class is the injection token.
 */
export abstract class MeetingAnalyzer {
  /**
   * Resolves to the insights (the lists may be empty). Rejects with `SummaryError` when no usable
   * answer came back, and with the signal's reason once `signal` is aborted (job timeout or shutdown).
   */
  abstract analyze(transcript: string, signal: AbortSignal): Promise<MeetingInsights>;
}

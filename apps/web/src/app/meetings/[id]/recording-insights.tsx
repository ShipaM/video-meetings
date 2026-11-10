'use client';

import { type ReactNode, useId } from 'react';
import type { RecordingInsights as Insights } from '../../meetings';
import { FileSummary } from './file-preview';

function InsightsSection({ title, children }: { title: string; children: ReactNode }) {
  const headingId = useId();

  return (
    <section
      aria-labelledby={headingId}
      className="bg-surface-secondary/60 flex flex-col gap-1 rounded-xl px-3 py-2"
    >
      <h3 id={headingId} className="text-muted text-xs font-medium tracking-wide uppercase">
        {title}
      </h3>
      {children}
    </section>
  );
}

/** The summary, action items and decisions of a `READY` recording. */
export function RecordingInsights({
  summary,
  insights,
}: {
  summary: string | null;
  insights: Insights;
}) {
  return (
    <div className="flex flex-col gap-2">
      {summary !== null && <FileSummary summary={summary} />}
      <InsightsSection title="Action items">
        {insights.actionItems.length === 0 ? (
          <p className="text-muted text-sm">No action items.</p>
        ) : (
          <ul className="flex list-disc flex-col gap-1 pl-5 text-sm leading-relaxed">
            {insights.actionItems.map((item, index) => (
              <li key={index} className="wrap-break-word">
                {item.description}{' '}
                <span className="text-muted">— {item.assignee ?? 'Unassigned'}</span>
              </li>
            ))}
          </ul>
        )}
      </InsightsSection>
      <InsightsSection title="Decisions">
        {insights.decisions.length === 0 ? (
          <p className="text-muted text-sm">No decisions.</p>
        ) : (
          <ul className="flex list-disc flex-col gap-1 pl-5 text-sm leading-relaxed">
            {insights.decisions.map((decision, index) => (
              <li key={index} className="wrap-break-word">
                {decision.text}
              </li>
            ))}
          </ul>
        )}
      </InsightsSection>
    </div>
  );
}

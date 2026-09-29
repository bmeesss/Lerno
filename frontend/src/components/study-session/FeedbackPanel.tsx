import { forwardRef, type ReactNode } from 'react';
import { VerdictPill } from '../study-pack/PackBits';
import type { SessionItem } from '../../types';

/** Where an answer comes from, in the student's words ("Biology.md · section 2"). */
export function sourceLine(source: { title: string | null; ref: string | null } | null): string | null {
  if (!source || (!source.title && !source.ref)) return null;
  return [source.title, source.ref].filter(Boolean).join(' · ');
}

/**
 * Instant feedback after an answer: the verdict, the solution, the explanation,
 * the concept with how its mastery moved, and where the material comes from.
 * It is a polite live region, so screen readers announce it without stealing focus.
 */
export const FeedbackPanel = forwardRef<HTMLDivElement, { item: SessionItem; actions?: ReactNode }>(
  function FeedbackPanel({ item, actions }, ref) {
    const feedback = item.feedback;
    if (!feedback) return null;
    const source = sourceLine(feedback.source);
    const moved =
      feedback.masteryBeforePercent !== null && feedback.masteryAfterPercent !== null
        ? { before: feedback.masteryBeforePercent, after: feedback.masteryAfterPercent }
        : null;
    return (
      <div
        ref={ref}
        className={`session-feedback session-feedback-${feedback.verdict}`}
        role="status"
        aria-live="polite"
      >
        <div className="session-feedback-head">
          <VerdictPill verdict={feedback.verdict} />
          <strong>
            {feedback.verdict === 'correct'
              ? 'Well done'
              : feedback.verdict === 'partial'
                ? 'Almost there'
                : 'Not quite'}
          </strong>
        </div>
        {feedback.verdict !== 'correct' ? (
          <p>
            <span className="session-feedback-label">Correct answer</span>
            {feedback.correctAnswer}
          </p>
        ) : null}
        {feedback.explanation ? (
          <p>
            <span className="session-feedback-label">Why</span>
            {feedback.explanation}
          </p>
        ) : null}
        {item.conceptName ? (
          <p className="session-feedback-concept">
            <span className="session-feedback-label">Concept</span>
            {item.conceptName}
            {moved ? (
              <span className="session-mastery-change" aria-label={`Mastery ${moved.before}% to ${moved.after}%`}>
                {moved.before}% → {moved.after}%
              </span>
            ) : null}
          </p>
        ) : null}
        {source ? (
          <p className="muted session-feedback-source">
            <span className="session-feedback-label">Source</span>
            {source}
          </p>
        ) : null}
        {actions}
      </div>
    );
  },
);

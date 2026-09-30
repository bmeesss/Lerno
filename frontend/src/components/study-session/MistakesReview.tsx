import { Link } from 'react-router-dom';
import { ButtonLink } from '../ui/Button';
import { EmptyState, LoadingRow } from '../ui/Primitives';
import { IconCheck } from '../ui/Icons';
import { useAsync } from '../../hooks/useAsync';
import { studySessionService } from '../../services/studySessionService';
import type { SessionMistakes } from '../../types';
import { ContextActions } from './ContextActions';
import { SessionError } from './SessionCtaBar';

/**
 * "Review mistakes": only the questions that were not answered correctly, each
 * with your answer, the correct answer, the explanation, the concept, the source
 * and a way to practise that concept.
 */
export function MistakesReview({
  sessionId,
  packId,
  tutorAvailable,
  backTo,
}: {
  sessionId: string;
  packId: string;
  tutorAvailable: boolean;
  backTo: string;
}) {
  const { data, loading, error, reload } = useAsync<SessionMistakes>(
    () => studySessionService.mistakes(sessionId),
    [sessionId],
  );

  if (loading) return <LoadingRow />;
  if (error || !data) {
    return <SessionError message={error ?? 'Could not load your mistakes.'} onRetry={reload} />;
  }

  if (data.total === 0) {
    return (
      <EmptyState
        icon={<IconCheck />}
        title="No mistakes to review"
        description="Every question in this session was answered correctly."
        action={<ButtonLink to={backTo}>Back to results</ButtonLink>}
      />
    );
  }

  return (
    <section className="session-screen" aria-labelledby="mistakes-heading">
      <div className="section-title">
        <div>
          <h2 id="mistakes-heading" tabIndex={-1}>
            Review mistakes
          </h2>
          <p className="muted">
            {data.total} question{data.total === 1 ? '' : 's'} to learn from — only what you did not
            get right.
          </p>
        </div>
        <Link to={backTo} className="btn btn-ghost btn-sm">
          Back to results
        </Link>
      </div>
      <ol className="mistake-list">
        {data.mistakes.map((mistake, index) => (
          <li key={mistake.itemId} className="card mistake-card">
            <p className="mistake-number">Question {index + 1}</p>
            <h3 className="mistake-prompt">{mistake.question.prompt}</h3>
            <dl className="mistake-facts">
              <div>
                <dt>Your answer</dt>
                <dd className="mistake-wrong">{mistake.yourAnswer || 'No answer given'}</dd>
              </div>
              <div>
                <dt>Correct answer</dt>
                <dd className="mistake-right">{mistake.correctAnswer}</dd>
              </div>
              {mistake.explanation ? (
                <div>
                  <dt>Explanation</dt>
                  <dd>{mistake.explanation}</dd>
                </div>
              ) : null}
              {mistake.concept ? (
                <div>
                  <dt>Concept</dt>
                  <dd>{mistake.concept.name}</dd>
                </div>
              ) : null}
              {mistake.source && (mistake.source.title || mistake.source.ref) ? (
                <div>
                  <dt>Source</dt>
                  <dd>{[mistake.source.title, mistake.source.ref].filter(Boolean).join(' · ')}</dd>
                </div>
              ) : null}
            </dl>
            <div className="mistake-actions">
              {mistake.concept ? (
                <ButtonLink
                  to={`/study-packs/${packId}?tab=practice&concept=${mistake.concept.id}`}
                  variant="secondary"
                  size="sm"
                >
                  Practice this concept
                </ButtonLink>
              ) : null}
            </div>
            <ContextActions
              packId={packId}
              sessionId={sessionId}
              itemId={mistake.itemId}
              conceptId={mistake.concept?.id ?? null}
              conceptName={mistake.concept?.name ?? null}
              tutorAvailable={tutorAvailable}
              showPractice={false}
            />
          </li>
        ))}
      </ol>
    </section>
  );
}

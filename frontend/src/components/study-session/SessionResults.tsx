import { Link } from 'react-router-dom';
import { ButtonLink } from '../ui/Button';
import { IconArrowRight } from '../ui/Icons';
import { formatMinutes, nextStepHref } from '../../lib/studyPackRoutes';
import type { LearningSession, SessionResult } from '../../types';

function duration(seconds: number): string {
  if (seconds < 60) return '< 1 min';
  return formatMinutes(Math.round(seconds / 60));
}

function Stat({ value, label }: { value: string | number; label: string }) {
  return (
    <div>
      <span className="pack-stat-value">{value}</span>
      <span className="pack-stat-label">{label}</span>
    </div>
  );
}

/** "Next: Practice Diffusion" — the engine's recommendation, one clear primary action. */
function NextStep({
  session,
  result,
  label,
}: {
  session: LearningSession;
  result: SessionResult;
  label: string;
}) {
  return (
    <ButtonLink to={nextStepHref(session.packId, result.next)}>
      {label} <IconArrowRight size={17} />
    </ButtonLink>
  );
}

function ResultLinks({ session, result }: { session: LearningSession; result: SessionResult }) {
  return (
    <>
      {result.mistakeCount > 0 ? (
        <ButtonLink to="?view=mistakes" variant="secondary">
          Review mistakes ({result.mistakeCount})
        </ButtonLink>
      ) : null}
      <ButtonLink to="/study" variant="ghost">
        Back to My Study
      </ButtonLink>
      <span className="visually-hidden">{session.packTitle}</span>
    </>
  );
}

/** The end of a Learn, Practice or Review session. */
export function PracticeResults({
  session,
  result,
}: {
  session: LearningSession;
  result: SessionResult;
}) {
  const improved = result.concepts
    .filter((concept) => concept.afterPercent > concept.beforePercent)
    .sort(
      (a, b) =>
        b.afterPercent - b.beforePercent - (a.afterPercent - a.beforePercent) ||
        a.name.localeCompare(b.name),
    );
  const top = improved[0];
  const isLearn = session.type === 'learn';
  const attention = result.stillWeak.length;

  return (
    <section className="session-screen" aria-labelledby="session-result-heading">
      <article className="card session-card session-result">
        <span className="eyebrow-label">{session.label} · complete</span>
        <h2 id="session-result-heading" tabIndex={-1} className="session-result-title">
          {top
            ? `Great work — ${top.name} improved from ${top.beforePercent}% → ${top.afterPercent}%`
            : 'Session complete — every answer teaches Lerno what to ask next'}
        </h2>

        <div className="pack-session-stats" role="group" aria-label="Session summary">
          <Stat value={duration(result.durationSeconds)} label="time" />
          {isLearn ? (
            <Stat
              value={result.answered}
              label={result.answered === 1 ? 'concept rated' : 'concepts rated'}
            />
          ) : (
            <>
              <Stat
                value={result.answered}
                label={result.answered === 1 ? 'question' : 'questions'}
              />
              <Stat value={result.correct} label="correct" />
              <Stat value={result.incorrect} label="incorrect" />
            </>
          )}
        </div>

        {result.concepts.length > 0 ? (
          <section aria-labelledby="result-concepts">
            <h3 id="result-concepts">Concept improvement</h3>
            <ul className="result-list">
              {result.concepts.map((concept) => (
                <li key={concept.conceptId}>
                  <span>{concept.name}</span>
                  <span
                    className={`session-mastery-change${
                      concept.afterPercent > concept.beforePercent
                        ? ' is-up'
                        : concept.afterPercent < concept.beforePercent
                          ? ' is-down'
                          : ''
                    }`}
                  >
                    {concept.beforePercent}% → {concept.afterPercent}%
                  </span>
                </li>
              ))}
            </ul>
          </section>
        ) : null}

        <section aria-labelledby="result-attention">
          <h3 id="result-attention">
            {attention === 0
              ? 'Nothing weak left in this session'
              : `${attention} concept${attention === 1 ? '' : 's'} still need${attention === 1 ? 's' : ''} attention`}
          </h3>
          {attention > 0 ? (
            <ul className="result-list">
              {result.stillWeak.map((concept) => (
                <li key={concept.conceptId}>
                  <span>{concept.name}</span>
                  <span className="muted">{concept.masteryPercent}% mastery</span>
                </li>
              ))}
            </ul>
          ) : null}
        </section>

        <p className="muted">
          {session.packTitle} · {result.packMasteryPercent}% mastered · {result.packWeakCount} weak
          concept
          {result.packWeakCount === 1 ? '' : 's'} overall
        </p>
      </article>

      <div className="session-cta-bar session-cta-static">
        <div className="session-cta-inner">
          <NextStep session={session} result={result} label={`Next: ${result.next.label}`} />
          <ResultLinks session={session} result={result} />
        </div>
      </div>
      {result.next.description ? (
        <p className="muted session-next-reason">{result.next.description}</p>
      ) : null}
    </section>
  );
}

/** The end of a test: score, what to be proud of, what to practise, what to do next. */
export function TestResults({
  session,
  result,
}: {
  session: LearningSession;
  result: SessionResult;
}) {
  return (
    <section className="session-screen" aria-labelledby="session-result-heading">
      <article className="card session-card session-result">
        <span className="eyebrow-label">{session.label} · results</span>
        <h2 id="session-result-heading" tabIndex={-1} className="session-result-title">
          <span className="test-percent">{result.percent}%</span>
          <span className="test-fraction">
            {result.correct} / {result.total} correct
          </span>
        </h2>

        <div className="pack-session-stats" role="group" aria-label="Test summary">
          <Stat value={result.correct} label="correct" />
          <Stat value={result.incorrect} label="incorrect" />
          {result.partial > 0 ? <Stat value={result.partial} label="almost" /> : null}
          <Stat value={duration(result.durationSeconds)} label="time" />
        </div>

        <div className="test-analysis">
          <section aria-labelledby="result-known">
            <h3 id="result-known">You know well</h3>
            {result.knownWell.length > 0 ? (
              <ul className="result-list">
                {result.knownWell.map((concept) => (
                  <li key={concept.conceptId}>
                    <span>{concept.name}</span>
                    <span className="muted">
                      {concept.correct} / {concept.total} · {concept.percent}%
                    </span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="muted">No concept reached 75% in this test yet.</p>
            )}
          </section>
          <section aria-labelledby="result-practice">
            <h3 id="result-practice">Needs practice</h3>
            {result.needsPractice.length > 0 ? (
              <ul className="result-list">
                {result.needsPractice.map((concept) => (
                  <li key={concept.conceptId}>
                    <span>{concept.name}</span>
                    <span className="muted">
                      {concept.correct} / {concept.total} · {concept.percent}%
                    </span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="muted">Nothing needs extra practice. Well done.</p>
            )}
          </section>
        </div>

        <p>
          <strong>{result.mistakeCount}</strong> question{result.mistakeCount === 1 ? '' : 's'} to
          review
        </p>

        <section className="test-recommended" aria-labelledby="result-recommended">
          <h3 id="result-recommended">Recommended</h3>
          <p>
            <strong>{result.next.label}</strong>
            {result.next.description ? ` — ${result.next.description}` : ''}
          </p>
        </section>
      </article>

      <div className="session-cta-bar session-cta-static">
        <div className="session-cta-inner">
          <NextStep
            session={session}
            result={result}
            label={
              result.next.type === 'practice'
                ? 'Start practice'
                : result.next.type === 'learn'
                  ? 'Start learning'
                  : result.next.type === 'review'
                    ? 'Start review'
                    : 'Take another test'
            }
          />
          <ResultLinks session={session} result={result} />
        </div>
      </div>
    </section>
  );
}

export function BackToPack({ session }: { session: LearningSession }) {
  return (
    <Link to={`/study-packs/${session.packId}`} className="btn btn-ghost btn-sm">
      Back to {session.packTitle}
    </Link>
  );
}

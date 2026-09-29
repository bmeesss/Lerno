import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button } from '../ui/Button';
import { Badge, LoadingRow } from '../ui/Primitives';
import { IconArrowRight, IconClock } from '../ui/Icons';
import { useAsync } from '../../hooks/useAsync';
import { ApiError } from '../../lib/api';
import {
  conceptReasonLabel,
  countLabel,
  difficultyLabel,
  examInLabel,
  startLabel,
} from '../../lib/sessionCopy';
import { formatMinutes, sessionHref } from '../../lib/studyPackRoutes';
import { studySessionService } from '../../services/studySessionService';
import { SessionError } from './SessionCtaBar';
import type { SessionType, StudyPackDetail, TestMode } from '../../types';

const EYEBROW: Record<SessionType, string> = {
  learn: 'Learn',
  practice: 'Practice',
  review: 'Review',
  test: 'Test',
};

/**
 * The screen before a session: what it will be (Practice Biology, 10 questions,
 * focus, time, concepts, difficulty) and one clear way to begin. Everything comes
 * from the same plan the server will build, so the promise matches the session.
 * An open session is offered first: continue, or start over.
 */
export function SessionStart({
  pack,
  type,
  mode: initialMode,
  conceptId: initialConceptId,
}: {
  pack: Pick<StudyPackDetail, 'id' | 'progress'>;
  type: SessionType;
  mode?: TestMode;
  conceptId?: string;
}) {
  const navigate = useNavigate();
  const [mode, setMode] = useState<TestMode>(initialMode ?? 'quick10');
  const [conceptId, setConceptId] = useState<string | undefined>(initialConceptId);
  const [starting, setStarting] = useState(false);
  const [startError, setStartError] = useState<string | null>(null);

  useEffect(() => setConceptId(initialConceptId), [initialConceptId]);
  useEffect(() => {
    if (initialMode) setMode(initialMode);
  }, [initialMode]);

  const {
    data: preview,
    loading,
    error,
    reload,
  } = useAsync(
    () =>
      studySessionService.preview({
        packId: pack.id,
        type,
        mode: type === 'test' ? mode : undefined,
        conceptId,
      }),
    [pack.id, type, type === 'test' ? mode : null, conceptId],
  );

  async function begin(restart = false) {
    if (starting) return;
    setStarting(true);
    setStartError(null);
    try {
      const created = await studySessionService.start({
        packId: pack.id,
        type,
        mode: type === 'test' ? mode : undefined,
        conceptId,
        restart,
      });
      navigate(sessionHref(created.session.id));
    } catch (caught) {
      setStartError(
        caught instanceof ApiError
          ? caught.message
          : 'Could not start the session. Nothing was lost — try again.',
      );
      setStarting(false);
    }
  }

  if (!preview && loading) return <LoadingRow />;

  if (!preview) {
    return (
      <SessionError
        message={error ?? 'Could not prepare this session.'}
        onRetry={reload}
        retryLabel="Try again"
      />
    );
  }

  const isTest = type === 'test';
  const heading = isTest ? 'Practice Test' : preview.title;
  const headingId = `session-start-${type}`;
  const selectedMode = preview.modes?.find((entry) => entry.mode === mode) ?? null;
  const count = selectedMode?.count ?? preview.count;
  const minutes = selectedMode?.minutes ?? preview.minutes;
  const modeAvailable = selectedMode ? selectedMode.available : true;
  const canStart = preview.canStart && modeAvailable;
  const exam = examInLabel(preview.examDaysLeft);
  const weak = type === 'practice' || type === 'learn' ? pack.progress.weakConcepts.slice(0, 5) : [];
  const resume = preview.resume;

  return (
    <section className="card session-start" aria-labelledby={headingId} aria-busy={loading}>
      <span className="eyebrow-label">{EYEBROW[type]}</span>
      <h2 id={headingId}>{heading}</h2>
      {isTest ? <p className="session-start-pack">{preview.packTitle}</p> : null}

      {resume ? (
        <div className="session-resume" role="group" aria-label="Continue where you left off">
          <span className="session-resume-kicker">Continue where you left off</span>
          <strong>{resume.label}</strong>
          <span className="muted">{resume.positionLabel}</span>
        </div>
      ) : null}

      <p className="session-start-lede">
        <strong>{countLabel(type, count)}</strong>
        <span aria-hidden="true"> · </span>
        <span>{preview.focus.label}</span>
      </p>

      {isTest && preview.modes ? (
        <fieldset className="test-modes">
          <legend className="visually-hidden">Test length</legend>
          {preview.modes.map((option) => (
            <label
              key={option.mode}
              className={`test-mode${mode === option.mode ? ' is-selected' : ''}${option.available ? '' : ' is-disabled'}`}
            >
              <input
                type="radio"
                name="test-mode"
                value={option.mode}
                checked={mode === option.mode}
                disabled={!option.available || starting}
                onChange={() => setMode(option.mode)}
              />
              <span className="test-mode-body">
                <strong>{option.label}</strong>
                <span className="muted">{option.description}</span>
                <span className="test-mode-meta">
                  {countLabel('test', option.count)} · {formatMinutes(option.minutes)}
                </span>
              </span>
            </label>
          ))}
        </fieldset>
      ) : null}

      <dl className="session-facts">
        <div>
          <dt>Estimated time</dt>
          <dd>
            <IconClock size={16} /> {formatMinutes(minutes)}
          </dd>
        </div>
        <div>
          <dt>Concepts</dt>
          <dd>{preview.concepts.length}</dd>
        </div>
        <div>
          <dt>Difficulty</dt>
          <dd>{difficultyLabel(preview.difficulty)}</dd>
        </div>
      </dl>

      {preview.concepts.length > 0 ? (
        <div className="session-concepts">
          <h3 className="session-subheading">What you will work on</h3>
          <ul className="session-concept-chips">
            {preview.concepts.map((concept) => {
              const reason = conceptReasonLabel(concept.reason);
              return (
                <li key={concept.id} className="session-concept-chip">
                  <span>{concept.name}</span>
                  <span className="session-concept-mastery">{concept.masteryPercent}%</span>
                  {reason ? <Badge variant={concept.reason === 'weak' ? 'warning' : 'default'}>{reason}</Badge> : null}
                </li>
              );
            })}
          </ul>
        </div>
      ) : null}

      {exam ? (
        <p className="session-exam-note">
          <strong>{exam}.</strong> Questions are chosen with your exam in mind.
        </p>
      ) : null}

      {weak.length > 0 ? (
        <div className="session-focus-picker" role="group" aria-label="Focus on one concept">
          <span className="session-subheading">Focus on one concept</span>
          <div className="session-concept-picks">
            {weak.map((concept) => (
              <button
                key={concept.id}
                type="button"
                className={`chip${conceptId === concept.id ? ' chip-active' : ''}`}
                aria-pressed={conceptId === concept.id}
                disabled={starting}
                onClick={() => setConceptId(conceptId === concept.id ? undefined : concept.id)}
              >
                {concept.name}
              </button>
            ))}
          </div>
        </div>
      ) : null}

      {preview.blockedReason ? (
        <p className="session-blocked" role="status">
          {preview.blockedReason}
        </p>
      ) : null}

      {startError ? <SessionError message={startError} onRetry={() => void begin(false)} /> : null}
      {error && preview ? <SessionError message={error} onRetry={reload} /> : null}

      <div className="session-start-actions">
        {resume ? (
          <>
            <Button size="lg" onClick={() => navigate(sessionHref(resume.sessionId))} disabled={starting}>
              Continue <IconArrowRight size={18} />
            </Button>
            <Button size="lg" variant="secondary" onClick={() => void begin(true)} disabled={starting || !canStart}>
              {starting ? 'Starting…' : 'Start over'}
            </Button>
          </>
        ) : (
          <Button size="lg" onClick={() => void begin(false)} disabled={starting || !canStart}>
            {starting ? 'Preparing…' : startLabel(type)} {!starting ? <IconArrowRight size={18} /> : null}
          </Button>
        )}
      </div>
    </section>
  );
}

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Button } from '../ui/Button';
import { Modal } from '../ui/Modal';
import { Badge, InlineSpinner } from '../ui/Primitives';
import { IconArrowRight, IconCheck } from '../ui/Icons';
import { ApiError } from '../../lib/api';
import { studySessionService } from '../../services/studySessionService';
import type { LearningSession } from '../../types';
import { QuestionInput } from './QuestionInput';
import { SessionCtaBar, SessionError } from './SessionCtaBar';

const AUTOSAVE_MS = 6_000;

/**
 * A test: one question per screen, no explanations and no mastery hints. Answers
 * are kept in the page and saved to the server in batches (when moving on, after
 * a pause, when the tab is hidden). A failed save never drops an answer: it stays
 * on screen and is sent again with the next save or with "Finish test".
 */
export function TestRunner({
  session,
  finishing,
  finishError,
  onFinish,
  onPositionChange,
}: {
  session: LearningSession;
  finishing: boolean;
  finishError: string | null;
  onFinish: (answers: { itemId: string; answer: string }[]) => void;
  onPositionChange: (position: number) => void;
}) {
  const items = session.items;
  const [answers, setAnswers] = useState<Record<string, string>>(() =>
    Object.fromEntries(items.map((item) => [item.id, item.answer ?? ''])),
  );
  const [index, setIndex] = useState(() =>
    Math.min(Math.max(0, session.currentPosition), Math.max(0, items.length - 1)),
  );
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const dirty = useRef(new Set<string>());
  const answersRef = useRef(answers);
  answersRef.current = answers;
  const savingRef = useRef(false);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const timer = useRef<number | null>(null);

  const item = items[index];
  const answeredCount = useMemo(
    () => items.filter((entry) => (answers[entry.id] ?? '').trim() !== '').length,
    [items, answers],
  );

  /** Sends what changed since the last successful save, in one request. */
  const flush = useCallback(
    async (position: number) => {
      if (savingRef.current) return;
      const ids = [...dirty.current];
      if (ids.length === 0) return;
      savingRef.current = true;
      setSaving(true);
      const sent = new Map(ids.map((id) => [id, answersRef.current[id] ?? '']));
      try {
        await studySessionService.saveAnswers(
          session.id,
          ids.map((id) => ({ itemId: id, answer: sent.get(id) ?? '' })),
          position,
        );
        for (const [id, value] of sent) {
          // Only forget the ones that were not edited again while saving.
          if ((answersRef.current[id] ?? '') === value) dirty.current.delete(id);
        }
        setSaveError(null);
      } catch (error) {
        setSaveError(
          error instanceof ApiError
            ? `${error.message} Your answers are still here and will be saved again.`
            : 'Could not save your answers. They are still here and will be saved again.',
        );
      } finally {
        savingRef.current = false;
        setSaving(false);
      }
    },
    [session.id],
  );

  function change(itemId: string, value: string) {
    setAnswers((current) => ({ ...current, [itemId]: value }));
    dirty.current.add(itemId);
    if (timer.current) window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => void flush(index), AUTOSAVE_MS);
  }

  function go(nextIndex: number) {
    const clamped = Math.min(Math.max(0, nextIndex), items.length - 1);
    if (timer.current) window.clearTimeout(timer.current);
    setIndex(clamped);
    onPositionChange(clamped);
    void flush(clamped);
  }

  useEffect(() => {
    headingRef.current?.focus();
  }, [index]);

  // Saving when the student leaves the tab: nothing typed is left only in memory.
  useEffect(() => {
    const onHide = () => {
      if (document.visibilityState === 'hidden') void flush(index);
    };
    document.addEventListener('visibilitychange', onHide);
    return () => {
      document.removeEventListener('visibilitychange', onHide);
      if (timer.current) window.clearTimeout(timer.current);
    };
  }, [flush, index]);

  function finish() {
    const all = items
      .filter((entry) => (answers[entry.id] ?? '').trim() !== '')
      .map((entry) => ({ itemId: entry.id, answer: answers[entry.id]! }));
    setConfirming(false);
    onFinish(all);
  }

  if (!item?.question) return null;
  const unanswered = items.length - answeredCount;
  const isLast = index >= items.length - 1;

  return (
    <section className="session-screen" aria-labelledby="session-question">
      <article className="card session-card">
        <div className="session-card-meta">
          <Badge>{session.mode === 'exam' ? 'Exam simulation' : 'Test'}</Badge>
          <span className="muted">
            {answeredCount} of {items.length} answered
          </span>
          {saving ? (
            <span className="muted" role="status">
              <InlineSpinner /> Saving…
            </span>
          ) : null}
        </div>
        <h2 id="session-question" ref={headingRef} tabIndex={-1} className="session-question">
          {item.question.prompt}
        </h2>
        <QuestionInput
          question={item.question}
          value={answers[item.id] ?? ''}
          onChange={(value) => change(item.id, value)}
          disabled={finishing}
        />
        <p className="muted test-note">No hints or explanations until you finish the test.</p>
      </article>

      <details className="card test-overview">
        <summary>Review your answers</summary>
        <ol className="test-grid" aria-label="Questions">
          {items.map((entry, position) => {
            const filled = (answers[entry.id] ?? '').trim() !== '';
            return (
              <li key={entry.id}>
                <button
                  type="button"
                  className={`test-grid-button${filled ? ' is-answered' : ''}${position === index ? ' is-current' : ''}`}
                  aria-current={position === index ? 'step' : undefined}
                  aria-label={`Question ${position + 1}, ${filled ? 'answered' : 'not answered yet'}`}
                  onClick={() => go(position)}
                >
                  {position + 1}
                </button>
              </li>
            );
          })}
        </ol>
        <Button
          variant="secondary"
          size="sm"
          onClick={() => setConfirming(true)}
          disabled={finishing}
        >
          Finish test
        </Button>
      </details>

      {saveError ? (
        <SessionError message={saveError} onRetry={() => void flush(index)} retryLabel="Save now" />
      ) : null}
      {finishError ? <SessionError message={finishError} onRetry={finish} /> : null}

      <SessionCtaBar>
        <Button variant="ghost" onClick={() => go(index - 1)} disabled={index === 0 || finishing}>
          Previous
        </Button>
        {isLast ? (
          <Button
            block
            onClick={() => (unanswered > 0 ? setConfirming(true) : finish())}
            disabled={finishing}
          >
            {finishing ? <InlineSpinner /> : <IconCheck size={17} />}{' '}
            {finishing ? 'Checking your test…' : 'Finish test'}
          </Button>
        ) : (
          <Button block onClick={() => go(index + 1)} disabled={finishing}>
            Next question <IconArrowRight size={17} />
          </Button>
        )}
      </SessionCtaBar>

      <Modal
        open={confirming}
        title="Finish the test?"
        onClose={() => setConfirming(false)}
        footer={
          <>
            <Button variant="secondary" onClick={() => setConfirming(false)}>
              Keep working
            </Button>
            <Button onClick={finish}>Finish test</Button>
          </>
        }
      >
        <p>
          {unanswered > 0
            ? `You have ${unanswered} unanswered question${unanswered === 1 ? '' : 's'}. They count as incorrect.`
            : 'You answered every question.'}
        </p>
      </Modal>
    </section>
  );
}

import { useEffect, useRef, useState } from 'react';
import { Button } from '../ui/Button';
import { Badge, InlineSpinner } from '../ui/Primitives';
import { IconArrowRight, IconCheck } from '../ui/Icons';
import type { SessionItem, LearningSession } from '../../types';
import { ContextActions } from './ContextActions';
import { FeedbackPanel } from './FeedbackPanel';
import { QuestionInput } from './QuestionInput';
import { SessionCtaBar, SessionError } from './SessionCtaBar';

const TYPE_LABEL = {
  multiple_choice: 'Multiple choice',
  true_false: 'True / false',
  short_answer: 'Open answer',
} as const;

/**
 * One question on one screen with instant feedback (Practice and Review).
 * The answer stays in the box if saving fails, so nothing typed is ever lost.
 */
export function PracticeItem({
  session,
  item,
  busy,
  error,
  isLast,
  onCheck,
  onSkip,
  onNext,
}: {
  session: LearningSession;
  item: SessionItem;
  busy: boolean;
  error: string | null;
  /** True when no other question is left after this one. */
  isLast: boolean;
  onCheck: (answer: string, responseTimeMs: number) => void;
  onSkip: () => void;
  onNext: () => void;
}) {
  const question = item.question;
  const [answer, setAnswer] = useState('');
  const shownAt = useRef(Date.now());
  const headingRef = useRef<HTMLHeadingElement>(null);
  const nextRef = useRef<HTMLButtonElement>(null);
  const answered = item.feedback !== null;

  // A new question: empty answer, fresh timer, and focus on the question itself.
  useEffect(() => {
    setAnswer('');
    shownAt.current = Date.now();
    headingRef.current?.focus();
  }, [item.id]);

  // After the answer is checked, the next step is one keypress away.
  useEffect(() => {
    if (answered) nextRef.current?.focus();
  }, [answered]);

  if (!question) return null;

  return (
    <section className="session-screen" aria-labelledby="session-question">
      <article className="card session-card">
        <div className="session-card-meta">
          <Badge>{TYPE_LABEL[question.questionType]}</Badge>
          {question.conceptName ? <span className="muted">{question.conceptName}</span> : null}
          {question.sourceTitle ? <span className="muted">From {question.sourceTitle}</span> : null}
        </div>
        <h2 id="session-question" ref={headingRef} tabIndex={-1} className="session-question">
          {question.prompt}
        </h2>

        <QuestionInput
          question={question}
          value={answered ? (item.answer ?? answer) : answer}
          onChange={setAnswer}
          disabled={answered || busy}
          correctAnswer={answered ? item.feedback?.correctAnswer : undefined}
        />

        {answered ? (
          <FeedbackPanel
            item={item}
            actions={
              <ContextActions
                packId={session.packId}
                sessionId={session.id}
                itemId={item.id}
                conceptId={item.conceptId}
                conceptName={item.conceptName}
                tutorAvailable={session.isOwner}
              />
            }
          />
        ) : null}
      </article>

      {error ? (
        <SessionError
          message={error}
          onRetry={
            !answered && answer.trim()
              ? () => onCheck(answer, Date.now() - shownAt.current)
              : undefined
          }
        />
      ) : null}

      <SessionCtaBar>
        {answered ? (
          <Button ref={nextRef} block onClick={onNext} disabled={busy}>
            {isLast ? 'See results' : 'Next question'} <IconArrowRight size={17} />
          </Button>
        ) : (
          <>
            <Button
              block
              onClick={() => onCheck(answer, Math.max(0, Date.now() - shownAt.current))}
              disabled={busy || answer.trim().length === 0}
            >
              {busy ? <InlineSpinner /> : <IconCheck size={17} />}{' '}
              {busy ? 'Checking…' : 'Check answer'}
            </Button>
            <Button variant="ghost" onClick={onSkip} disabled={busy}>
              Skip
            </Button>
          </>
        )}
      </SessionCtaBar>
    </section>
  );
}

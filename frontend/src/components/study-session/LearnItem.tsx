import { useEffect, useRef, useState } from 'react';
import { Button } from '../ui/Button';
import { Badge, InlineSpinner } from '../ui/Primitives';
import { IconArrowRight, IconCheck } from '../ui/Icons';
import { MasteryMeter } from '../study-pack/PackBits';
import type { LearnReason, LearningSession, SelfRating, SessionItem } from '../../types';
import { ContextActions } from './ContextActions';
import { FeedbackPanel } from './FeedbackPanel';
import { QuestionInput } from './QuestionInput';
import { SessionCtaBar, SessionError } from './SessionCtaBar';

const RATINGS: { id: SelfRating; label: string; hint: string }[] = [
  { id: 'again', label: 'Again', hint: 'Show this concept again soon' },
  { id: 'hard', label: 'Hard', hint: 'I knew parts of it' },
  { id: 'good', label: 'Good', hint: 'I could explain this' },
  { id: 'easy', label: 'Easy', hint: 'I could teach this' },
];

const REASON_LABEL: Record<LearnReason, string> = {
  weak: 'Needs another pass',
  new: 'New concept',
  learning: 'Still learning',
  due: 'Due for review',
  confirmation: 'Confirming what you know',
};

type Step = 'read' | 'check' | 'rate';

/**
 * One concept, one activity per screen:
 *   1. "What is it?" + "Example"   2. "Check yourself"   3. "How well do you know this?"
 * The example comes from the student's own material; when there is none the
 * screen says so instead of inventing one.
 */
export function LearnItem({
  session,
  item,
  busy,
  error,
  onCheck,
  onRate,
}: {
  session: LearningSession;
  item: SessionItem;
  busy: boolean;
  error: string | null;
  onCheck: (answer: string, responseTimeMs: number) => void;
  onRate: (rating: SelfRating, responseTimeMs: number) => void;
}) {
  const learn = item.learn;
  const question = item.question;
  // A reload after the check continues at the rating; before it, at the reading.
  const initial: Step = item.feedback ? 'rate' : 'read';
  const [step, setStep] = useState<Step>(initial);
  const [answer, setAnswer] = useState('');
  const shownAt = useRef(Date.now());
  const headingRef = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    setStep(item.feedback ? 'rate' : 'read');
    setAnswer('');
    shownAt.current = Date.now();
  }, [item.id]);

  useEffect(() => {
    headingRef.current?.focus();
  }, [item.id, step]);

  if (!learn) return null;
  const checked = item.feedback !== null;

  return (
    <section className="session-screen" aria-labelledby="learn-heading">
      <article className="card session-card">
        <div className="session-card-meta">
          <Badge>{REASON_LABEL[learn.reason]}</Badge>
          <span className="muted">Step {step === 'read' ? 1 : step === 'check' ? 2 : 3} of 3</span>
        </div>
        <h2 id="learn-heading" ref={headingRef} tabIndex={-1} className="session-question">
          {item.conceptName}
        </h2>
        <MasteryMeter percent={learn.masteryPercent} label="Mastery" compact />

        {step === 'read' ? (
          <div className="learn-blocks">
            <section aria-labelledby="learn-what">
              <h3 id="learn-what">What is it?</h3>
              <p className="learn-explanation">
                {learn.explanation || 'No explanation has been added yet.'}
              </p>
            </section>
            <section aria-labelledby="learn-example">
              <h3 id="learn-example">Example</h3>
              {learn.example ? (
                <>
                  <blockquote className="learn-example">{learn.example.text}</blockquote>
                  <p className="muted">
                    {learn.example.kind === 'source'
                      ? `From ${learn.example.sourceTitle ?? 'your material'}`
                      : 'From your flashcards'}
                  </p>
                </>
              ) : (
                <p className="muted">There is no example for this concept in your material yet.</p>
              )}
            </section>
            <ContextActions
              packId={session.packId}
              sessionId={session.id}
              itemId={item.id}
              conceptId={item.conceptId}
              conceptName={item.conceptName}
              tutorAvailable={session.isOwner}
              showPractice={false}
            />
          </div>
        ) : null}

        {step === 'check' && question ? (
          <section aria-labelledby="learn-check" className="learn-blocks">
            <h3 id="learn-check">Check yourself</h3>
            <p className="session-question-text">{question.prompt}</p>
            <QuestionInput
              question={question}
              value={checked ? (item.answer ?? answer) : answer}
              onChange={setAnswer}
              disabled={checked || busy}
              correctAnswer={checked ? item.feedback?.correctAnswer : undefined}
            />
            {checked ? <FeedbackPanel item={item} /> : null}
          </section>
        ) : null}

        {step === 'rate' ? (
          <fieldset className="learn-rating" disabled={busy}>
            <legend>
              <h3 id="learn-rate">How well do you know this?</h3>
            </legend>
            <div className="learn-rating-grid">
              {RATINGS.map((rating) => (
                <button
                  key={rating.id}
                  type="button"
                  className={`learn-rating-button learn-rating-${rating.id}`}
                  onClick={() => onRate(rating.id, Math.max(0, Date.now() - shownAt.current))}
                >
                  <strong>{rating.label}</strong>
                  <small>{rating.hint}</small>
                </button>
              ))}
            </div>
            {busy ? (
              <p className="muted" role="status">
                <InlineSpinner /> Saving your rating…
              </p>
            ) : null}
          </fieldset>
        ) : null}
      </article>

      {error ? <SessionError message={error} /> : null}

      {step === 'read' ? (
        <SessionCtaBar>
          <Button block onClick={() => setStep(question ? 'check' : 'rate')}>
            {question ? 'Check yourself' : 'How well do you know this?'}{' '}
            <IconArrowRight size={17} />
          </Button>
        </SessionCtaBar>
      ) : null}

      {step === 'check' ? (
        <SessionCtaBar>
          {checked ? (
            <Button block onClick={() => setStep('rate')}>
              Continue <IconArrowRight size={17} />
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
              <Button variant="ghost" onClick={() => setStep('rate')} disabled={busy}>
                Skip the check
              </Button>
            </>
          )}
        </SessionCtaBar>
      ) : null}
    </section>
  );
}

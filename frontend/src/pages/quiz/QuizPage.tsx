import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { Button, ButtonLink } from '../../components/ui/Button';
import { Badge, EmptyState, LoadingRow, ProgressBar } from '../../components/ui/Primitives';
import { useAuth } from '../../hooks/useAuth';
import { ApiError } from '../../lib/api';
import { quizService } from '../../services/quizService';
import type { Quiz, QuizAttemptResult, QuizQuestion } from '../../types';

const OPTION_KEYS = ['A', 'B', 'C', 'D'];

type Phase = 'ready' | 'answering' | 'submitting' | 'done' | 'error';

export function QuizPage() {
  const { setId } = useParams<{ setId: string }>();
  const { user } = useAuth();
  const [quiz, setQuiz] = useState<Quiz | null>(null);
  const [phase, setPhase] = useState<Phase>('ready');
  const [error, setError] = useState<string | null>(null);
  const [emptySet, setEmptySet] = useState(false);
  const [index, setIndex] = useState(0);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [result, setResult] = useState<QuizAttemptResult | null>(null);
  const [startedAt, setStartedAt] = useState<number | null>(null);
  const [elapsedMs, setElapsedMs] = useState<number | null>(null);

  useEffect(() => {
    if (!setId) return;
    let cancelled = false;
    quizService
      .load(setId)
      .then((loaded) => {
        if (!cancelled) setQuiz(loaded);
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setError(err instanceof ApiError ? err.message : 'Could not load quiz');
          setEmptySet(
            err instanceof ApiError && err.status === 400 && err.code === 'VALIDATION_ERROR',
          );
          setPhase('error');
        }
      });
    return () => {
      cancelled = true;
    };
  }, [setId]);

  const questions = quiz?.questions ?? [];
  const current: QuizQuestion | undefined = questions[index];

  const answeredCount = useMemo(
    () => questions.filter((question) => (answers[question.id] ?? '').length > 0).length,
    [questions, answers],
  );

  const start = useCallback(() => {
    setStartedAt(Date.now());
    setPhase('answering');
  }, []);

  const submit = useCallback(async () => {
    if (!setId || !quiz) return;
    setPhase('submitting');
    try {
      const payload = quiz.questions.map((question) => ({
        questionId: question.id,
        answer: answers[question.id] ?? '',
      }));
      const attempt = await quizService.submit(setId, payload);
      setResult(attempt);
      setElapsedMs(startedAt === null ? null : Date.now() - startedAt);
      setPhase('done');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not submit quiz');
      setPhase('answering');
    }
  }, [setId, quiz, answers, startedAt]);

  function restart() {
    setAnswers({});
    setIndex(0);
    setResult(null);
    setStartedAt(Date.now());
    setElapsedMs(null);
    setPhase('answering');
  }

  if (phase === 'error' || (!quiz && error)) {
    if (emptySet) {
      return (
        <EmptyState
          title="No quiz yet"
          description={
            user
              ? 'This set has no cards yet. Add at least one card and the quiz will be ready.'
              : 'This set has no cards yet, so there is nothing to quiz on.'
          }
          action={
            <ButtonLink to={setId ? `/sets/${setId}` : '/discover'}>
              {user ? 'Add cards to this set' : 'Back to set'}
            </ButtonLink>
          }
        />
      );
    }
    return (
      <EmptyState
        title="Could not load quiz"
        description={error ?? 'Unknown error'}
        action={<ButtonLink to={setId ? `/sets/${setId}` : '/discover'}>Back to set</ButtonLink>}
      />
    );
  }

  if (!quiz) return <LoadingRow large />;

  if (phase === 'done' && result) {
    return (
      <QuizResults
        result={result}
        title={quiz.title}
        setId={setId ?? ''}
        isGuest={!user}
        elapsedMs={elapsedMs}
        onRestart={restart}
      />
    );
  }

  if (phase === 'ready') {
    return <QuizStartScreen quiz={quiz} setId={setId ?? ''} onStart={start} />;
  }

  return (
    <div className="study-stage">
      <h2 style={{ textAlign: 'center', fontSize: '1.15rem' }}>{quiz.title}</h2>

      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12 }}>
        <span className="muted" style={{ fontSize: '0.875rem' }}>
          Question {index + 1} of {questions.length}
        </span>
        <span className="muted" style={{ fontSize: '0.875rem' }}>
          {answeredCount} answered
        </span>
      </div>
      <ProgressBar value={index} max={questions.length} />

      {current ? (
        <>
          <div className="card" style={{ padding: 'clamp(20px, 4vw, 32px)' }}>
            <Badge>{typeLabel(current.questionType)}</Badge>
            <p
              style={{
                fontSize: '1.15rem',
                fontWeight: 600,
                color: 'var(--text)',
                margin: '14px 0 18px',
                lineHeight: 1.5,
              }}
            >
              {current.prompt}
            </p>

            {current.questionType === 'multiple_choice' ? (
              <div className="stack" style={{ gap: 10 }}>
                {(current.options ?? []).map((option, optionIndex) => (
                  <button
                    key={option}
                    type="button"
                    className={`quiz-option${answers[current.id] === option ? ' selected' : ''}`}
                    onClick={() => setAnswers((prev) => ({ ...prev, [current.id]: option }))}
                  >
                    <span className="option-key">{OPTION_KEYS[optionIndex] ?? '?'}</span>
                    {option}
                  </button>
                ))}
              </div>
            ) : current.questionType === 'true_false' ? (
              <div className="stack" style={{ gap: 10 }}>
                {['True', 'False'].map((option) => (
                  <button
                    key={option}
                    type="button"
                    className={`quiz-option${answers[current.id] === option ? ' selected' : ''}`}
                    onClick={() => setAnswers((prev) => ({ ...prev, [current.id]: option }))}
                  >
                    <span className="option-key">{option === 'True' ? 'T' : 'F'}</span>
                    {option}
                  </button>
                ))}
              </div>
            ) : (
              <div className="field">
                <label htmlFor="short-answer" className="visually-hidden">
                  Your answer
                </label>
                <input
                  id="short-answer"
                  className="input"
                  placeholder="Type your answer…"
                  value={answers[current.id] ?? ''}
                  onChange={(e) =>
                    setAnswers((prev) => ({ ...prev, [current.id]: e.target.value }))
                  }
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && index < questions.length - 1) {
                      e.preventDefault();
                      setIndex((value) => value + 1);
                    }
                  }}
                />
              </div>
            )}
          </div>

          <div className="study-controls">
            <Button
              variant="secondary"
              disabled={index === 0}
              onClick={() => setIndex((value) => Math.max(0, value - 1))}
            >
              Previous
            </Button>
            {index < questions.length - 1 ? (
              <Button onClick={() => setIndex((value) => value + 1)}>Next</Button>
            ) : (
              <Button disabled={phase === 'submitting'} onClick={() => void submit()}>
                {phase === 'submitting' ? 'Scoring…' : 'Finish quiz'}
              </Button>
            )}
          </div>
          {index === questions.length - 1 && answeredCount < questions.length ? (
            <p className="kbd-hint">
              {questions.length - answeredCount} question
              {questions.length - answeredCount === 1 ? '' : 's'} unanswered — they count as
              incorrect.
            </p>
          ) : null}
        </>
      ) : null}
    </div>
  );
}

function QuizStartScreen({
  quiz,
  setId,
  onStart,
}: {
  quiz: Quiz;
  setId: string;
  onStart: () => void;
}) {
  const counts = quiz.questions.reduce(
    (acc, question) => {
      acc[question.questionType] += 1;
      return acc;
    },
    { multiple_choice: 0, true_false: 0, short_answer: 0 } as Record<
      QuizQuestion['questionType'],
      number
    >,
  );
  const mix = (
    [
      ['multiple choice', counts.multiple_choice],
      ['true / false', counts.true_false],
      ['short answer', counts.short_answer],
    ] as const
  )
    .filter(([, count]) => count > 0)
    .map(([label, count]) => `${count} ${label}`)
    .join(' · ');

  return (
    <div className="study-stage">
      <h2 style={{ textAlign: 'center', fontSize: '1.35rem' }}>{quiz.title}</h2>
      <div className="card" style={{ textAlign: 'center', padding: 'clamp(20px, 4vw, 32px)' }}>
        <div className="stat-value" style={{ fontSize: '2rem' }}>
          {quiz.questions.length}
        </div>
        <div className="stat-label">
          question{quiz.questions.length === 1 ? '' : 's'}
          {mix ? ` — ${mix}` : ''}
        </div>
        <p className="muted" style={{ marginTop: 12 }}>
          No timer, no pressure — answer at your own pace. Unanswered questions simply count as
          incorrect, and you can retry as often as you like.
        </p>
      </div>
      <div className="study-controls">
        <ButtonLink to={`/sets/${setId}`} variant="secondary">
          Back to set
        </ButtonLink>
        <Button onClick={onStart}>Start quiz</Button>
      </div>
    </div>
  );
}

function QuizResults({
  result,
  title,
  setId,
  isGuest,
  elapsedMs,
  onRestart,
}: {
  result: QuizAttemptResult;
  title: string;
  setId: string;
  isGuest: boolean;
  elapsedMs: number | null;
  onRestart: () => void;
}) {
  const pct = Math.round(result.accuracy * 100);
  return (
    <div className="study-stage">
      <h2 style={{ textAlign: 'center', fontSize: '1.35rem' }}>{title} — results</h2>

      <div className="score-ring">
        <span className="score-value">{pct}%</span>
        <span className="score-label">score</span>
      </div>
      {elapsedMs !== null ? (
        <p className="muted" style={{ textAlign: 'center', marginTop: 0 }}>
          Finished in {formatDuration(elapsedMs)}
        </p>
      ) : null}

      <div className="quiz-result-grid">
        <div className="card stat-card">
          <div className="stat-label">Correct</div>
          <div className="stat-value" style={{ color: 'var(--accent-text)' }}>
            {result.correct}
          </div>
        </div>
        <div className="card stat-card">
          <div className="stat-label">Incorrect</div>
          <div className="stat-value" style={{ color: 'var(--danger)' }}>
            {result.incorrect}
          </div>
        </div>
        <div className="card stat-card">
          <div className="stat-label">Total</div>
          <div className="stat-value">{result.total}</div>
        </div>
      </div>

      {isGuest && !result.persisted ? (
        <div className="guest-banner" style={{ textAlign: 'left' }}>
          <p>
            Quiz taken as a guest — this result is not saved. Create an account to track quiz
            attempts and accuracy.
          </p>
          <ButtonLink to="/signup" size="sm">
            Create free account
          </ButtonLink>
        </div>
      ) : (
        <p className="muted" style={{ textAlign: 'center' }}>
          Attempt saved to your progress.
        </p>
      )}

      {result.topicsNeedingPractice.length > 0 ? (
        <div className="card">
          <div className="stat-label">Topics needing more practice</div>
          <ul className="stack" style={{ gap: 8, marginTop: 10 }}>
            {result.topicsNeedingPractice.map((topic) => (
              <li key={topic} style={{ color: 'var(--text-secondary)', fontSize: '0.925rem' }}>
                • {topic}
              </li>
            ))}
          </ul>
        </div>
      ) : (
        <div className="form-success" style={{ textAlign: 'center' }}>
          Perfect score — nothing to review this time. 🎉
        </div>
      )}

      <div className="section-title">
        <h2>Question review</h2>
      </div>
      <div className="stack" style={{ gap: 10 }}>
        {result.questions.map((question) => (
          <div key={question.questionId} className="card">
            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                gap: 10,
                flexWrap: 'wrap',
              }}
            >
              <strong style={{ fontSize: '0.95rem' }}>{question.prompt}</strong>
              {question.correct ? (
                <Badge variant="accent">Correct</Badge>
              ) : (
                <Badge variant="danger">Incorrect</Badge>
              )}
            </div>
            <div className="muted" style={{ fontSize: '0.875rem', marginTop: 8 }}>
              Your answer: <strong>{question.yourAnswer || '—'}</strong>
            </div>
            {!question.correct ? (
              <div style={{ fontSize: '0.875rem', marginTop: 4, color: 'var(--accent-text)' }}>
                Correct answer: <strong>{question.correctAnswer}</strong>
              </div>
            ) : null}
          </div>
        ))}
      </div>

      <div className="study-controls" style={{ marginTop: 20 }}>
        <Button variant="secondary" onClick={onRestart}>
          Restart quiz
        </Button>
        <ButtonLink to={`/sets/${setId}/practice`} variant="secondary">
          Continue practice
        </ButtonLink>
        <ButtonLink to={`/sets/${setId}`}>Back to set</ButtonLink>
      </div>
      <p className="kbd-hint">
        Tip: <Link to="/review">review the cards you missed</Link> before your next attempt.
      </p>
    </div>
  );
}

function formatDuration(ms: number): string {
  const totalSeconds = Math.max(1, Math.round(ms / 1000));
  if (totalSeconds < 60) return `${totalSeconds} sec`;
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return seconds === 0 ? `${minutes} min` : `${minutes} min ${seconds} sec`;
}

function typeLabel(type: QuizQuestion['questionType']): string {
  switch (type) {
    case 'multiple_choice':
      return 'Multiple choice';
    case 'true_false':
      return 'True / false';
    case 'short_answer':
      return 'Short answer';
  }
}

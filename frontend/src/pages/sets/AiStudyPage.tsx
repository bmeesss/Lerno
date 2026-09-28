/**
 * AI Study Mode — "Overhoor mij" (#14).
 *
 * Flow: choose → question → answer → AI verdict + feedback → next → result.
 * The questions are generated from the set by the backend (validated), the
 * verdict comes from the model (never plain string matching), and the result is
 * stored through the normal Lerno study progress.
 *
 * This is an extra study mode: the regular flashcard flow is untouched.
 */
import { useCallback, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { Button, ButtonLink } from '../../components/ui/Button';
import { Badge, EmptyState, LoadingRow, ProgressBar } from '../../components/ui/Primitives';
import { IconArrowRight, IconCheck, IconRefresh, IconSparkles } from '../../components/ui/Icons';
import { useAsync } from '../../hooks/useAsync';
import { aiLearningService } from '../../services/aiLearningService';
import { studySetService } from '../../services/studySetService';
import { friendlyAiError } from '../../components/ai/AiResultModal';
import type {
  AiDifficulty,
  AiGeneratedQuestion,
  AiStudyResultInput,
  AiStudySummary,
  AiVerdict,
} from '../../types';

type Phase = 'setup' | 'question' | 'judging' | 'feedback' | 'result';

/** Phases in which the current question card is on screen. */
const ACTIVE_PHASES: Phase[] = ['question', 'judging', 'feedback'];

const COUNTS: (5 | 10 | 15)[] = [5, 10, 15];
const DIFFICULTIES: { value: AiDifficulty; label: string }[] = [
  { value: 'easy', label: 'Makkelijk' },
  { value: 'normal', label: 'Normaal' },
  { value: 'hard', label: 'Moeilijk' },
];

const VERDICT_LABEL: Record<AiVerdict, string> = {
  correct: 'Goed',
  partial: 'Gedeeltelijk goed',
  incorrect: 'Nog niet goed',
};

interface Round {
  question: AiGeneratedQuestion;
  answer: string;
  verdict: AiVerdict;
  feedback: string;
  missing: string;
}

export function AiStudyPage() {
  const { setId } = useParams<{ setId: string }>();
  const navigate = useNavigate();
  const { data: set, loading, error } = useAsync(() => studySetService.get(setId ?? ''), [setId]);

  const [phase, setPhase] = useState<Phase>('setup');
  const [count, setCount] = useState<5 | 10 | 15>(10);
  const [difficulty, setDifficulty] = useState<AiDifficulty>('normal');
  const [questions, setQuestions] = useState<AiGeneratedQuestion[] | null>(null);
  const [index, setIndex] = useState(0);
  const [answer, setAnswer] = useState('');
  const [round, setRound] = useState<Round | null>(null);
  const [hints, setHints] = useState<Record<number, string>>({});
  const [hintLoading, setHintLoading] = useState(false);
  const [rounds, setRounds] = useState<Round[]>([]);
  const [summary, setSummary] = useState<AiStudySummary | null>(null);
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);

  const current = questions ? questions[index] : null;
  const progress = useMemo(
    () => (questions ? Math.round((rounds.length / questions.length) * 100) : 0),
    [questions, rounds.length],
  );

  const start = useCallback(async () => {
    if (!setId) return;
    setBusy(true);
    setFailure(null);
    try {
      const result = await aiLearningService.generateQuestions(setId, count, difficulty);
      setQuestions(result.questions);
      setIndex(0);
      setRounds([]);
      setRound(null);
      setSummary(null);
      setAnswer('');
      setHints({});
      setPhase('question');
    } catch (err) {
      setFailure(friendlyAiError(err));
    } finally {
      setBusy(false);
    }
  }, [setId, count, difficulty]);

  const judge = useCallback(async () => {
    if (!setId || !current) return;
    setBusy(true);
    setFailure(null);
    try {
      const evaluation = await aiLearningService.evaluateAnswer({
        setId,
        cardId: current.cardId ?? undefined,
        question: current.question,
        expectedAnswer: current.answer,
        answer,
      });
      setRound({
        question: current,
        answer,
        verdict: evaluation.verdict,
        feedback: evaluation.feedback,
        missing: evaluation.missing,
      });
      setPhase('feedback');
    } catch (err) {
      setFailure(friendlyAiError(err));
    } finally {
      setBusy(false);
    }
  }, [setId, current, answer]);

  const next = useCallback(async () => {
    if (!questions || !round) return;
    const done = [...rounds, round];
    setRounds(done);

    if (index + 1 < questions.length) {
      setIndex(index + 1);
      setAnswer('');
      setRound(null);
      setPhase('question');
      return;
    }

    // Last question: finish the session and store the result.
    setPhase('judging');
    try {
      const results: AiStudyResultInput[] = done.map((entry) => ({
        cardId: entry.question.cardId ?? undefined,
        question: entry.question.question,
        answer: entry.answer,
        verdict: entry.verdict,
      }));
      const result = await aiLearningService.finishStudy({ setId: setId ?? '', results });
      setSummary(result);
      setPhase('result');
    } catch (err) {
      setFailure(friendlyAiError(err));
      setPhase('feedback');
    }
  }, [questions, round, rounds, index, setId]);

  async function askHint(): Promise<void> {
    if (!setId || !current) return;
    setHintLoading(true);
    try {
      const result = await aiLearningService.hint({
        setId,
        cardId: current.cardId ?? undefined,
        question: current.question,
        expectedAnswer: current.answer,
        hintsGiven: hints[index] ? 1 : 0,
      });
      setHints((prev) => ({ ...prev, [index]: result.hint }));
    } catch (err) {
      setHints((prev) => ({ ...prev, [index]: friendlyAiError(err) }));
    } finally {
      setHintLoading(false);
    }
  }

  if (loading) return <LoadingRow large />;
  if (error || !set) {
    return (
      <EmptyState
        title="Study set not found"
        description={error ?? 'This set does not exist or is private.'}
        action={<ButtonLink to="/discover">Browse public sets</ButtonLink>}
      />
    );
  }

  return (
    <div className="ai-study">
      <div className="ai-study-header">
        <div>
          <p className="ai-study-eyebrow">
            <IconSparkles size={13} /> Overhoor mij · {set.title}
          </p>
          <h1>{phase === 'result' ? 'Klaar!' : 'Overhoor mij'}</h1>
          {phase !== 'setup' && phase !== 'result' ? (
            <p className="muted" style={{ marginTop: 4 }}>
              {set.title}
            </p>
          ) : null}
        </div>
        {phase !== 'setup' && phase !== 'result' ? (
          <div className="ai-study-progress">
            <span className="muted">
              Vraag {Math.min(index + 1, questions?.length ?? 1)} van {questions?.length ?? 0}
            </span>
            <ProgressBar value={progress} />
          </div>
        ) : null}
      </div>

      {failure ? (
        <div className="form-error" role="alert">
          {failure}
        </div>
      ) : null}

      {phase === 'setup' ? (
        <div className="card ai-study-setup">
          <p className="muted">
            Lerno AI stelt vragen over <strong>{set.title}</strong> en kijkt mee met je antwoord. Je
            krijgt per vraag korte feedback.
          </p>

          <div className="ai-control-group" role="group" aria-label="Aantal vragen">
            {COUNTS.map((value) => (
              <button
                key={value}
                type="button"
                className={value === count ? 'ai-chip ai-chip-active' : 'ai-chip'}
                aria-pressed={value === count}
                onClick={() => setCount(value)}
              >
                {value} vragen
              </button>
            ))}
          </div>
          <div className="ai-control-group" role="group" aria-label="Niveau">
            {DIFFICULTIES.map((option) => (
              <button
                key={option.value}
                type="button"
                className={option.value === difficulty ? 'ai-chip ai-chip-active' : 'ai-chip'}
                aria-pressed={option.value === difficulty}
                onClick={() => setDifficulty(option.value)}
              >
                {option.label}
              </button>
            ))}
          </div>

          <Button size="lg" onClick={() => void start()} disabled={busy}>
            {busy ? 'Lerno AI maakt vragen…' : 'Start overhoring'}
          </Button>
          <p className="muted" style={{ fontSize: '0.8rem' }}>
            Liever de gewone flashcards?{' '}
            <Link to={`/sets/${set.id}/study`} style={{ color: 'var(--accent-text)' }}>
              Start de normale studiemodus
            </Link>
            .
          </p>
        </div>
      ) : null}

      {ACTIVE_PHASES.includes(phase) && current ? (
        <div className="card ai-study-card">
          <p className="ai-study-question">{current.question}</p>

          {hints[index] ? (
            <p className="ai-question-hint">
              <IconSparkles size={13} /> Hint: {hints[index]}
            </p>
          ) : null}

          {phase === 'question' || phase === 'judging' ? (
            <>
              <label className="sr-only" htmlFor="ai-study-answer">
                Je antwoord
              </label>
              <textarea
                id="ai-study-answer"
                className="textarea"
                rows={3}
                value={answer}
                maxLength={2000}
                placeholder="Typ je antwoord…"
                onChange={(event) => setAnswer(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' && (event.metaKey || event.ctrlKey) && answer.trim()) {
                    event.preventDefault();
                    void judge();
                  }
                }}
              />
              <div className="ai-study-actions">
                <Button
                  variant="secondary"
                  onClick={() => void askHint()}
                  disabled={hintLoading || busy}
                >
                  Hint
                </Button>
                <Button onClick={() => void judge()} disabled={busy || answer.trim() === ''}>
                  {busy ? 'Lerno AI kijkt mee…' : 'Controleer'}
                </Button>
              </div>
            </>
          ) : null}

          {phase === 'feedback' && round ? (
            <div className="ai-study-feedback">
              <Badge
                variant={
                  round.verdict === 'correct'
                    ? 'accent'
                    : round.verdict === 'partial'
                      ? 'warning'
                      : 'danger'
                }
              >
                {VERDICT_LABEL[round.verdict]}
              </Badge>
              <p>{round.feedback}</p>
              {round.missing ? <p className="muted">Nog niet genoemd: {round.missing}</p> : null}
              <p className="ai-study-expected">
                <strong>Modelantwoord:</strong> {round.question.answer}
              </p>
              <Button onClick={() => void next()}>
                {index + 1 < (questions?.length ?? 0) ? 'Volgende vraag' : 'Bekijk resultaat'}
                <IconArrowRight size={16} />
              </Button>
            </div>
          ) : null}
        </div>
      ) : null}

      {phase === 'result' && summary ? (
        <div className="card ai-study-result">
          <div className="ai-study-score">
            <div>
              <span className="ai-study-score-value">{summary.correct}</span>
              <span className="muted"> / {summary.total} goed</span>
            </div>
            <ProgressBar value={Math.round(summary.accuracy * 100)} />
          </div>

          <div className="ai-study-tally">
            <Badge variant="accent">
              <IconCheck size={13} /> {summary.correct} correct
            </Badge>
            <Badge variant="warning">{summary.partial} gedeeltelijk</Badge>
            <Badge variant="danger">{summary.incorrect} fout</Badge>
          </div>

          {summary.topicsToReview.length > 0 ? (
            <div className="ai-study-topics">
              <h2>Onderwerpen om opnieuw te oefenen</h2>
              <ul>
                {summary.topicsToReview.map((topic) => (
                  <li key={topic}>{topic}</li>
                ))}
              </ul>
            </div>
          ) : (
            <p>Alles goed beantwoord — mooi werk.</p>
          )}

          {summary.persisted ? (
            <p className="muted" style={{ fontSize: '0.82rem' }}>
              Dit resultaat is verwerkt in je normale studievoortgang voor deze set.
            </p>
          ) : null}

          <div className="ai-study-actions">
            <Button variant="secondary" onClick={() => void start()}>
              <IconRefresh size={15} /> Nog een keer
            </Button>
            <ButtonLink to={`/sets/${set.id}`} variant="ghost">
              Terug naar de set
            </ButtonLink>
            <ButtonLink to={`/sets/${set.id}/study`} variant="ghost">
              Normale studiemodus
            </ButtonLink>
          </div>
        </div>
      ) : null}

      {phase === 'setup' ? (
        <p className="muted" style={{ marginTop: 16 }}>
          <Button variant="ghost" size="sm" onClick={() => navigate(`/sets/${set.id}`)}>
            Terug naar de set
          </Button>
        </p>
      ) : null}
    </div>
  );
}

import { useState } from 'react';
import { Button, ButtonLink } from '../ui/Button';
import { Badge, EmptyState, ProgressBar, Spinner } from '../ui/Primitives';
import { IconArrowRight, IconLightbulb, IconQuiz, IconSparkles, IconZap } from '../ui/Icons';
import { useToast } from '../ui/Toast';
import { ApiError } from '../../lib/api';
import { studyPackService } from '../../services/studyPackService';
import { recommendedHref } from '../../lib/studyPackRoutes';
import { VerdictPill } from './PackBits';
import { PreviewEditor } from './PreviewEditor';
import type { PackPreview, PackTestRun, PackTestSubmission, StudyPackDetail } from '../../types';

const MODES = [
  { id: 'quick10', label: '10 questions', description: 'A quick check of where you stand.' },
  { id: 'quick20', label: '20 questions', description: 'Wider coverage across the material.' },
  { id: 'exam', label: 'Exam simulation', description: 'Everything Lerno has, in one run.' },
] as const;

type Mode = (typeof MODES)[number]['id'];

/**
 * Test mode: a real practice test. Question selection, scoring and weak-concept
 * detection happen server-side; the student sees score, mistakes and what to do
 * next.
 */
export function PackTest({ pack, onChanged }: { pack: StudyPackDetail; onChanged: () => void }) {
  const toast = useToast();
  const [mode, setMode] = useState<Mode>('quick10');
  const [run, setRun] = useState<PackTestRun | null>(null);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [result, setResult] = useState<PackTestSubmission | null>(null);
  const [busy, setBusy] = useState(false);
  const [preview, setPreview] = useState<PackPreview | null>(null);
  const [generating, setGenerating] = useState(false);

  const answeredCount = Object.values(answers).filter((value) => value.trim().length > 0).length;

  async function generateQuestions() {
    if (generating) return;
    setGenerating(true);
    try {
      const generated = await studyPackService.generate(pack.id, 'practice', { count: 10 });
      if (generated.target === 'practice') setPreview(generated);
    } catch (error) {
      toast.show(error instanceof ApiError ? error.message : 'Could not generate questions', 'error');
    } finally {
      setGenerating(false);
    }
  }

  async function start() {
    setBusy(true);
    try {
      const started = await studyPackService.createTest(pack.id, mode);
      setRun(started);
      setAnswers({});
      setResult(null);
    } catch (error) {
      toast.show(error instanceof ApiError ? error.message : 'Could not start this test', 'error');
    } finally {
      setBusy(false);
    }
  }

  async function submit() {
    if (!run || busy) return;
    setBusy(true);
    try {
      const submitted = await studyPackService.submitTest(
        pack.id,
        run.test.id,
        run.questions.map((question) => ({
          questionId: question.id,
          answer: answers[question.id] ?? '',
        })),
      );
      setResult(submitted);
      onChanged();
    } catch (error) {
      toast.show(error instanceof ApiError ? error.message : 'Could not submit this test', 'error');
    } finally {
      setBusy(false);
    }
  }

  if (pack.counts.practiceQuestions === 0) {
    if (preview && preview.target === 'practice') {
      return (
        <PreviewEditor
          packId={pack.id}
          preview={preview}
          onDiscard={() => setPreview(null)}
          onApplied={(message) => {
            setPreview(null);
            toast.show(message, 'success');
            onChanged();
          }}
        />
      );
    }
    return (
      <EmptyState
        icon={<IconQuiz />}
        title="Practice questions first"
        description="A test is built from the practice questions in this pack, so Lerno can score it and detect weak concepts."
        action={
          pack.isOwner ? (
            <Button onClick={() => void generateQuestions()} disabled={generating || pack.counts.readySources === 0}>
              <IconSparkles size={17} /> {generating ? 'Generating…' : 'Generate practice questions'}
            </Button>
          ) : undefined
        }
      />
    );
  }

  if (result) {
    const accuracy = result.accuracy;
    const masteryByConcept = new Map<
      string,
      { name: string; before: number; after: number }
    >();
    for (const row of result.results) {
      if (
        !row.conceptId ||
        row.conceptMasteryPercent === null ||
        row.previousMasteryPercent === null
      ) continue;
      const existing = masteryByConcept.get(row.conceptId);
      masteryByConcept.set(row.conceptId, {
        name: row.conceptName ?? existing?.name ?? 'Concept',
        before: existing?.before ?? row.previousMasteryPercent,
        after: row.conceptMasteryPercent,
      });
    }
    const improvedConcepts = [...masteryByConcept.values()].filter(
      (concept) => concept.after > concept.before,
    );
    return (
      <section className="stack" style={{ gap: 20 }} aria-labelledby="pack-test-result">
        <div className="card pack-result-hero">
          <span className="eyebrow-label">Your score</span>
          <h2 id="pack-test-result">
            {result.attempt.score} / {result.attempt.total} · {accuracy}%
          </h2>
          <div className="pack-session-stats">
            <div>
              <span className="pack-stat-value">{result.attempt.correctCount}</span>
              <span className="pack-stat-label">correct</span>
            </div>
            <div>
              <span className="pack-stat-value">{result.attempt.partialCount}</span>
              <span className="pack-stat-label">almost</span>
            </div>
            <div>
              <span className="pack-stat-value">{result.attempt.incorrectCount}</span>
              <span className="pack-stat-label">incorrect</span>
            </div>
          </div>
          {improvedConcepts.length > 0 ? (
            <p className="muted">
              Mastery improved on {improvedConcepts.length} concept{improvedConcepts.length === 1 ? '' : 's'}.
              {improvedConcepts[0]
                ? ` ${improvedConcepts[0].name}: ${improvedConcepts[0].before}% → ${improvedConcepts[0].after}%.`
                : ''}
            </p>
          ) : null}
          <p className="muted">
            <strong>Recommended next:</strong> {result.recommended.label}. {result.recommended.description}
          </p>
          <div className="pack-session-intro-actions">
            <ButtonLink to={recommendedHref(pack, result.recommended)}>
              Start recommended action <IconArrowRight size={17} />
            </ButtonLink>
            <Button
              variant="secondary"
              onClick={() => {
                setResult(null);
                setRun(null);
                setAnswers({});
              }}
            >
              Take another test
            </Button>
            <ButtonLink to="?tab=review" variant="ghost">
              Back to pack
            </ButtonLink>
          </div>
        </div>

        <div className="pack-result-grid">
          <section className="card">
            <h3>Strong concepts</h3>
            {result.strongConcepts.length > 0 ? (
              <div className="pack-chip-row">
                {result.strongConcepts.map((concept) => (
                  <Badge key={concept.id} variant="accent">
                    {concept.name}
                  </Badge>
                ))}
              </div>
            ) : (
              <p className="muted">Nothing crossed the mastery threshold yet — keep practising.</p>
            )}
          </section>
          <section className="card">
            <h3>Weak concepts</h3>
            {result.weakConcepts.length > 0 ? (
              <div className="pack-chip-row">
                {result.weakConcepts.map((concept) => (
                  <Badge key={concept.id} variant="warning">
                    {concept.name}
                  </Badge>
                ))}
              </div>
            ) : (
              <p className="muted">No weak concepts in this test. Try the exam simulation.</p>
            )}
          </section>
        </div>

        <section className="card" aria-labelledby="pack-test-mistakes">
          <div className="section-title">
            <div>
              <h2 id="pack-test-mistakes">Review mistakes</h2>
              <p className="muted">Every answer, with the explanation and the concept behind it.</p>
            </div>
          </div>
          <ul className="pack-mistake-list">
            {result.results.map((row) => (
              <li key={row.questionId} className={`pack-mistake pack-mistake-${row.verdict}`}>
                <div className="pack-mistake-head">
                  <VerdictPill verdict={row.verdict} />
                  {row.conceptName ? <span className="muted">{row.conceptName}</span> : null}
                </div>
                <p className="pack-mistake-prompt">{row.prompt}</p>
                <p className="muted">
                  Your answer: {row.yourAnswer || '—'}
                  {row.verdict !== 'correct' ? ` · Correct: ${row.correctAnswer}` : ''}
                </p>
                {row.explanation ? <p>{row.explanation}</p> : null}
                {row.conceptId ? (
                  <ButtonLink to={`?tab=practice&concept=${row.conceptId}`} size="sm" variant="secondary">
                    Practise this concept
                  </ButtonLink>
                ) : null}
              </li>
            ))}
          </ul>
        </section>
      </section>
    );
  }

  if (run) {
    return (
      <section className="pack-session" aria-labelledby="pack-test-running">
        <div className="pack-session-progress">
          <ProgressBar value={answeredCount} max={run.questions.length} />
          <span className="muted">
            Answered {answeredCount} of {run.questions.length}
          </span>
        </div>
        <h2 id="pack-test-running">{run.test.title}</h2>
        <ul className="pack-test-list">
          {run.questions.map((question, index) => (
            <li key={question.id} className="card pack-test-question">
              <div className="pack-question-head">
                <Badge>Question {index + 1}</Badge>
                {question.conceptName ? <span className="muted">{question.conceptName}</span> : null}
              </div>
              <p className="pack-test-prompt">{question.prompt}</p>
              {question.questionType === 'multiple_choice' && question.options ? (
                <fieldset className="pack-option-list">
                  <legend className="visually-hidden">Choose an answer</legend>
                  {question.options.map((option) => (
                    <label key={option} className={`pack-option${answers[question.id] === option ? ' selected' : ''}`}>
                      <input
                        type="radio"
                        name={`test-${question.id}`}
                        value={option}
                        checked={answers[question.id] === option}
                        onChange={() => setAnswers((current) => ({ ...current, [question.id]: option }))}
                      />
                      <span>{option}</span>
                    </label>
                  ))}
                </fieldset>
              ) : question.questionType === 'true_false' ? (
                <div className="pack-truefalse" role="group" aria-label="True or false">
                  {['True', 'False'].map((option) => (
                    <button
                      key={option}
                      type="button"
                      className={`btn ${answers[question.id] === option ? 'btn-primary' : 'btn-secondary'}`}
                      aria-pressed={answers[question.id] === option}
                      onClick={() => setAnswers((current) => ({ ...current, [question.id]: option }))}
                    >
                      {option}
                    </button>
                  ))}
                </div>
              ) : (
                <input
                  className="input"
                  aria-label={`Answer for question ${index + 1}`}
                  value={answers[question.id] ?? ''}
                  onChange={(event) =>
                    setAnswers((current) => ({ ...current, [question.id]: event.target.value }))
                  }
                  placeholder="Your answer"
                />
              )}
            </li>
          ))}
        </ul>
        <div className="pack-question-actions">
          <Button onClick={() => void submit()} disabled={busy}>
            {busy ? <Spinner /> : <IconZap size={17} />} {busy ? 'Checking…' : 'Submit test'}
          </Button>
          <Button variant="ghost" onClick={() => setRun(null)} disabled={busy}>
            Cancel
          </Button>
        </div>
      </section>
    );
  }

  return (
    <section className="stack" style={{ gap: 20 }} aria-labelledby="pack-test-heading">
      <div className="section-title">
        <div>
          <h2 id="pack-test-heading">Practice test</h2>
          <p className="muted">
            Randomly selected from your practice questions, weighted towards weak concepts. Graded
            server-side, with weak concepts saved for review.
          </p>
        </div>
      </div>

      {preview && preview.target === 'practice' ? (
        <PreviewEditor
          packId={pack.id}
          preview={preview}
          onDiscard={() => setPreview(null)}
          onApplied={(message) => {
            setPreview(null);
            toast.show(message, 'success');
            onChanged();
          }}
        />
      ) : null}

      <div className="pack-mode-grid" role="radiogroup" aria-label="Test length">
        {MODES.map((option) => (
          <button
            key={option.id}
            type="button"
            role="radio"
            aria-checked={mode === option.id}
            className={`card card-interactive pack-mode-choice${mode === option.id ? ' selected' : ''}`}
            onClick={() => setMode(option.id)}
          >
            <strong>{option.label}</strong>
            <span className="muted">{option.description}</span>
          </button>
        ))}
      </div>

      <div className="pack-question-actions">
        <Button onClick={() => void start()} disabled={busy}>
          <IconQuiz size={17} /> {busy ? 'Building test…' : 'Start test'}
        </Button>
        {pack.isOwner ? (
          <Button variant="secondary" onClick={() => void generateQuestions()} disabled={generating}>
            <IconSparkles size={17} /> {generating ? 'Generating…' : 'Generate more questions'}
          </Button>
        ) : null}
      </div>

      {pack.recentAttempts.length > 0 ? (
        <section className="card">
          <h3>Previous attempts</h3>
          <ul className="pack-attempt-list">
            {pack.recentAttempts.map((attempt) => {
              const percent = attempt.total > 0 ? Math.round((attempt.score / attempt.total) * 100) : 0;
              return (
                <li key={attempt.id}>
                  <span className="pack-attempt-score">{percent}%</span>
                  <span className="muted">
                    {attempt.score}/{attempt.total} · {new Date(attempt.createdAt).toLocaleDateString()}
                  </span>
                  <Badge>{attempt.packTitle ?? 'This pack'}</Badge>
                </li>
              );
            })}
          </ul>
        </section>
      ) : (
        <p className="muted">
          <IconLightbulb size={15} /> Tip: an exam simulation uses every question in the pack.
        </p>
      )}
    </section>
  );
}

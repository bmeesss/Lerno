import { useEffect, useState } from 'react';
import { Button, ButtonLink } from '../ui/Button';
import { Badge, EmptyState, ProgressBar, Spinner } from '../ui/Primitives';
import { IconArrowRight, IconCheck, IconLightbulb, IconSparkles, IconZap } from '../ui/Icons';
import { useToast } from '../ui/Toast';
import { ApiError } from '../../lib/api';
import { studyPackService } from '../../services/studyPackService';
import { MasteryMeter, VerdictPill } from './PackBits';
import { PreviewEditor } from './PreviewEditor';
import type {
  PackPracticeGrade,
  PackPracticeQueue,
  PackPracticeQuestion,
  PackPreview,
  StudyPackDetail,
} from '../../types';

interface Answered {
  question: PackPracticeQuestion;
  grade: PackPracticeGrade;
  answer: string;
}

/**
 * Practice: more than flashcards. Multiple choice, true/false and open answers
 * with immediate feedback, the explanation and the concept behind the question.
 * Every answer feeds concept mastery, so weak topics surface automatically.
 */
export function PackPractice({
  pack,
  focusConceptId,
  onChanged,
}: {
  pack: StudyPackDetail;
  focusConceptId?: string;
  onChanged: () => void;
}) {
  const toast = useToast();
  const [queue, setQueue] = useState<PackPracticeQueue | null>(null);
  const [loading, setLoading] = useState(false);
  const [index, setIndex] = useState(0);
  const [answer, setAnswer] = useState('');
  const [feedback, setFeedback] = useState<PackPracticeGrade | null>(null);
  const [busy, setBusy] = useState(false);
  const [answers, setAnswers] = useState<Answered[]>([]);
  const [questionShownAt, setQuestionShownAt] = useState(Date.now());
  const [conceptFilter, setConceptFilter] = useState<string | undefined>(focusConceptId);
  const [preview, setPreview] = useState<PackPreview | null>(null);
  const [generating, setGenerating] = useState(false);

  useEffect(() => {
    setConceptFilter(focusConceptId);
  }, [focusConceptId]);

  async function start(conceptId?: string) {
    setLoading(true);
    try {
      const started = await studyPackService.practiceQueue(pack.id, {
        conceptId,
        limit: 12,
      });
      setQueue(started);
      setIndex(0);
      setAnswer('');
      setFeedback(null);
      setAnswers([]);
      setQuestionShownAt(Date.now());
    } catch (error) {
      toast.show(error instanceof ApiError ? error.message : 'Could not start practice', 'error');
    } finally {
      setLoading(false);
    }
  }

  async function check() {
    const question = queue?.questions[index];
    if (!question || busy) return;
    setBusy(true);
    try {
      const grade = await studyPackService.gradePractice(
        pack.id,
        question.id,
        answer,
        Math.max(0, Date.now() - questionShownAt),
      );
      setFeedback(grade);
      setAnswers((rows) => [...rows, { question, grade, answer }]);
      onChanged();
    } catch (error) {
      toast.show(error instanceof ApiError ? error.message : 'Could not check this answer', 'error');
    } finally {
      setBusy(false);
    }
  }

  function next() {
    setFeedback(null);
    setAnswer('');
    setQuestionShownAt(Date.now());
    setIndex((value) => value + 1);
  }

  async function generate() {
    if (generating) return;
    setGenerating(true);
    try {
      const result = await studyPackService.generate(pack.id, 'practice', { count: 8 });
      if (result.target === 'practice') setPreview(result);
    } catch (error) {
      toast.show(error instanceof ApiError ? error.message : 'Could not generate practice questions', 'error');
    } finally {
      setGenerating(false);
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
        icon={<IconLightbulb />}
        title="No practice questions yet"
        description="Practice questions check whether you really understand the material. Generate them from your sources."
        action={
          pack.isOwner ? (
            <Button onClick={() => void generate()} disabled={generating || pack.counts.readySources === 0}>
              <IconSparkles size={17} /> {generating ? 'Generating…' : 'Generate practice questions'}
            </Button>
          ) : undefined
        }
      />
    );
  }

  if (!queue) {
    const weak = pack.progress.weakConcepts;
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
      <section className="card pack-session-intro" aria-labelledby="pack-practice-heading">
        <span className="eyebrow-label">Practice</span>
        <h2 id="pack-practice-heading">Practise until it sticks</h2>
        <p>
          {pack.counts.practiceQuestions} question{pack.counts.practiceQuestions === 1 ? '' : 's'} in this
          pack. Lerno starts with your weak concepts and mixes multiple choice, true/false and open
          questions — with an explanation after every answer.
        </p>
        {weak.length > 0 ? (
          <div className="pack-chip-row" role="group" aria-label="Practice a weak concept">
            {weak.slice(0, 5).map((concept) => (
              <button
                key={concept.id}
                type="button"
                className={`chip${conceptFilter === concept.id ? ' chip-active' : ''}`}
                aria-pressed={conceptFilter === concept.id}
                onClick={() => setConceptFilter(conceptFilter === concept.id ? undefined : concept.id)}
              >
                {concept.name}
              </button>
            ))}
          </div>
        ) : null}
        <div className="pack-session-intro-actions">
          <Button onClick={() => void start(conceptFilter)} disabled={loading}>
            <IconZap size={17} /> {loading ? 'Preparing…' : conceptFilter ? 'Practise this concept' : 'Start practice'}
          </Button>
          <ButtonLink to="?tab=test" variant="secondary">
            Take a test instead
          </ButtonLink>
          {pack.isOwner ? (
            <Button variant="ghost" onClick={() => void generate()} disabled={generating}>
              <IconSparkles size={17} /> {generating ? 'Generating…' : 'Generate more questions'}
            </Button>
          ) : null}
        </div>
      </section>
    );
  }

  const total = queue.questions.length;
  const question = queue.questions[index];
  const done = !question;

  if (done) {
    const correct = answers.filter((row) => row.grade.verdict === 'correct').length;
    const partial = answers.filter((row) => row.grade.verdict === 'partial').length;
    const masteryByConcept = new Map<
      string,
      { id: string; name: string; before: number; after: number }
    >();
    for (const row of answers) {
      const concept = row.grade.concept;
      if (!concept || row.grade.conceptMasteryPercent === null) continue;
      const existing = masteryByConcept.get(concept.id);
      masteryByConcept.set(concept.id, {
        id: concept.id,
        name: concept.name,
        before: existing?.before ?? row.grade.previousMasteryPercent ?? row.grade.conceptMasteryPercent,
        after: row.grade.conceptMasteryPercent,
      });
    }
    const conceptOutcomes = [...masteryByConcept.values()];
    const improved = conceptOutcomes.filter((concept) => concept.after > concept.before);
    const weakConcepts = conceptOutcomes.filter((concept) => concept.after < 30);
    const weakConceptNames = weakConcepts.map((concept) => concept.name);
    const firstWeakId = weakConcepts[0]?.id;

    return (
      <section className="card pack-session-summary" aria-labelledby="pack-practice-done">
        <span className="eyebrow-label">Practice complete</span>
        <h2 id="pack-practice-done">
          {correct} of {answers.length} correct
          {partial > 0 ? ` · ${partial} almost` : ''}
        </h2>
        <div className="pack-session-stats">
          <div>
            <span className="pack-stat-value">{correct}</span>
            <span className="pack-stat-label">correct</span>
          </div>
          <div>
            <span className="pack-stat-value">{partial}</span>
            <span className="pack-stat-label">almost</span>
          </div>
          <div>
            <span className="pack-stat-value">{answers.length - correct - partial}</span>
            <span className="pack-stat-label">incorrect</span>
          </div>
        </div>

        {improved.length > 0 ? (
          <p className="muted">
            Mastery improved for {improved.length} concept{improved.length === 1 ? '' : 's'}.
            {improved[0] ? ` ${improved[0].name}: ${improved[0].before}% → ${improved[0].after}%.` : ''}
          </p>
        ) : null}
        {weakConceptNames.length > 0 ? (
          <div className="pack-session-focus">
            <span className="pack-label">Still needs practice</span>
            <ul className="pack-list">
              {weakConcepts.slice(0, 5).map((concept) => (
                <li key={concept.id}>
                  {concept.name} — {concept.after}% mastery
                </li>
              ))}
            </ul>
            <p className="muted">
              {answers.filter((row) => row.grade.verdict !== 'correct').length} answers need another pass;
              these concepts are therefore back at the top of your practice queue.
            </p>
          </div>
        ) : (
          <p className="muted">No concept remains below 30% mastery. A practice test can confirm what stuck.</p>
        )}

        <div className="pack-session-intro-actions">
          {firstWeakId ? (
            <ButtonLink to={`?tab=practice&concept=${firstWeakId}`}>
              Practice {weakConcepts[0]!.name} again <IconArrowRight size={17} />
            </ButtonLink>
          ) : (
            <ButtonLink to="?tab=test">Take a practice test</ButtonLink>
          )}
          <Button
            variant="secondary"
            onClick={() => {
              void start(undefined);
            }}
          >
            Practise again
          </Button>
          <Button variant="ghost" onClick={() => setQueue(null)}>
            Back to practice
          </Button>
        </div>
      </section>
    );
  }

  const answered = feedback !== null;

  return (
    <section className="pack-session" aria-labelledby="pack-practice-question">
      <div className="pack-session-progress">
        <ProgressBar value={index} max={total} />
        <span className="muted">
          Question {index + 1} of {total}
          {question.conceptName ? ` · ${question.conceptName}` : ''}
        </span>
      </div>

      <article className="card pack-question-card">
        <div className="pack-question-head">
          <Badge>
            {question.questionType === 'multiple_choice'
              ? 'Multiple choice'
              : question.questionType === 'true_false'
                ? 'True / false'
                : 'Open answer'}
          </Badge>
          {question.sourceTitle ? <span className="muted">From {question.sourceTitle}</span> : null}
        </div>
        <h2 id="pack-practice-question">{question.prompt}</h2>

        {question.questionType === 'multiple_choice' && question.options ? (
          <fieldset className="pack-option-list">
            <legend className="visually-hidden">Choose an answer</legend>
            {question.options.map((option) => (
              <label key={option} className={`pack-option${answer === option ? ' selected' : ''}`}>
                <input
                  type="radio"
                  name={`question-${question.id}`}
                  value={option}
                  checked={answer === option}
                  onChange={() => setAnswer(option)}
                  disabled={answered}
                />
                <span>{option}</span>
                {answered && feedback.correctAnswer === option ? (
                  <Badge variant="accent">Correct</Badge>
                ) : null}
              </label>
            ))}
          </fieldset>
        ) : null}

        {question.questionType === 'true_false' ? (
          <div className="pack-truefalse" role="group" aria-label="True or false">
            {(question.options ?? ['True', 'False']).map((option) => (
              <button
                key={option}
                type="button"
                className={`btn ${answer === option ? 'btn-primary' : 'btn-secondary'}`}
                onClick={() => setAnswer(option)}
                disabled={answered}
                aria-pressed={answer === option}
              >
                {option}
              </button>
            ))}
          </div>
        ) : null}

        {question.questionType === 'short_answer' ? (
          <label className="field">
            <span>Your answer</span>
            <textarea
              className="textarea"
              rows={3}
              value={answer}
              onChange={(event) => setAnswer(event.target.value)}
              disabled={answered}
              placeholder="Write it in your own words…"
            />
          </label>
        ) : null}

        {!answered ? (
          <div className="pack-question-actions">
            <Button onClick={() => void check()} disabled={busy || answer.trim().length === 0}>
              {busy ? <Spinner /> : <IconCheck size={17} />} {busy ? 'Checking…' : 'Check answer'}
            </Button>
            <Button variant="ghost" onClick={next} disabled={busy}>
              Skip
            </Button>
          </div>
        ) : (
          <div className={`pack-feedback pack-feedback-${feedback.verdict}`} role="status">
            <div className="pack-feedback-head">
              <VerdictPill verdict={feedback.verdict} />
              {feedback.concept ? (
                <span className="muted">
                  {feedback.concept.name}
                  {feedback.conceptMasteryPercent !== null
                    ? ` · ${feedback.conceptMasteryPercent}% mastery`
                    : ''}
                </span>
              ) : null}
            </div>
            {feedback.verdict !== 'correct' ? (
              <p>
                <strong>Correct answer:</strong> {feedback.correctAnswer}
              </p>
            ) : null}
            {feedback.explanation ? <p>{feedback.explanation}</p> : null}
            {feedback.sourceTitle ? (
              <p className="muted">Source: {feedback.sourceTitle}</p>
            ) : null}
            <Button onClick={next}>
              {index + 1 >= total ? 'See results' : 'Next question'} <IconArrowRight size={17} />
            </Button>
          </div>
        )}
      </article>

      {question.conceptName ? (
        <MasteryMeter
          percent={
            pack.concepts.find((concept) => concept.name === question.conceptName)?.masteryPercent ?? 0
          }
          label={`Mastery · ${question.conceptName}`}
          compact
        />
      ) : null}
    </section>
  );
}

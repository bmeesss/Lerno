/**
 * AI generated quiz (#7): rendered as a real quiz, not as markdown.
 *
 * - multiple choice / true-false: scored directly against `correctIndex`
 * - open: judged by Lerno AI through the evaluate endpoint
 *
 * The data is validated by the backend, so this component can trust the shape
 * and focus on the interaction.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { Button } from '../ui/Button';
import { Modal } from '../ui/Modal';
import { Spinner } from '../ui/Primitives';
import { IconRefresh, IconSparkles } from '../ui/Icons';
import { aiLearningService } from '../../services/aiLearningService';
import { friendlyAiError } from './AiResultModal';
import type { AiDifficulty, AiGeneratedQuizQuestion, AiQuizType } from '../../types';

const COUNTS: (5 | 10 | 15)[] = [5, 10, 15];
const TYPES: { value: AiQuizType; label: string }[] = [
  { value: 'multiple_choice', label: 'Multiple choice' },
  { value: 'open', label: 'Open vragen' },
  { value: 'true_false', label: 'Waar / onwaar' },
];
const DIFFICULTIES: { value: AiDifficulty; label: string }[] = [
  { value: 'easy', label: 'Makkelijk' },
  { value: 'normal', label: 'Normaal' },
  { value: 'hard', label: 'Moeilijk' },
];

interface AiQuizModalProps {
  open: boolean;
  setId: string;
  onClose: () => void;
}

interface AnswerState {
  /** Selected option index, or the typed answer for open questions. */
  value: string;
  checked: boolean;
  correct: boolean | null;
  feedback?: string;
}

export function AiQuizModal({ open, setId, onClose }: AiQuizModalProps) {
  const [count, setCount] = useState<5 | 10 | 15>(10);
  const [difficulty, setDifficulty] = useState<AiDifficulty>('normal');
  const [types, setTypes] = useState<AiQuizType[]>(['multiple_choice']);
  const [questions, setQuestions] = useState<AiGeneratedQuizQuestion[] | null>(null);
  const [answers, setAnswers] = useState<Record<number, AnswerState>>({});
  const [loading, setLoading] = useState(false);
  const [judging, setJudging] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const generatedFor = useRef<string | null>(null);

  const generate = useCallback(async () => {
    setLoading(true);
    setError(null);
    setQuestions(null);
    setAnswers({});
    try {
      const result = await aiLearningService.generateQuiz(setId, count, types, difficulty);
      setQuestions(result.questions);
    } catch (err) {
      setError(friendlyAiError(err));
    } finally {
      setLoading(false);
    }
  }, [setId, count, types, difficulty]);

  useEffect(() => {
    if (!open) {
      generatedFor.current = null;
      return;
    }
    const key = `${count}:${difficulty}:${types.join('+')}`;
    if (generatedFor.current === key) return;
    generatedFor.current = key;
    void generate();
  }, [open, count, difficulty, types, generate]);

  function toggleType(value: AiQuizType): void {
    setTypes((current) =>
      current.includes(value) ? current.filter((type) => type !== value) : [...current, value],
    );
  }

  async function answerMultipleChoice(index: number, optionIndex: number): Promise<void> {
    const question = questions![index]!;
    const correct = question.correctIndex === optionIndex;
    setAnswers((prev) => ({
      ...prev,
      [index]: {
        value: String(optionIndex),
        checked: true,
        correct,
        feedback: question.explanation,
      },
    }));
  }

  async function answerOpen(index: number, value: string): Promise<void> {
    const question = questions![index]!;
    setJudging(index);
    try {
      const evaluation = await aiLearningService.evaluateAnswer({
        setId,
        question: question.question,
        expectedAnswer: question.answer,
        answer: value,
      });
      setAnswers((prev) => ({
        ...prev,
        [index]: {
          value,
          checked: true,
          correct: evaluation.verdict === 'correct',
          feedback: evaluation.feedback,
        },
      }));
    } catch (err) {
      setError(friendlyAiError(err));
    } finally {
      setJudging(null);
    }
  }

  const answered = Object.keys(answers).length;
  const score = Object.values(answers).filter((answer) => answer.correct).length;
  const finished = questions !== null && answered === questions.length;

  return (
    <Modal
      open={open}
      title="Maak quiz"
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" onClick={() => void generate()} disabled={loading}>
            <IconRefresh size={15} /> Nieuwe quiz
          </Button>
          <Button variant="ghost" onClick={onClose}>
            Sluiten
          </Button>
        </>
      }
    >
      <div className="ai-quiz">
        <div className="ai-question-controls">
          <div className="ai-control-group" role="group" aria-label="Aantal vragen">
            {COUNTS.map((value) => (
              <button
                key={value}
                type="button"
                className={value === count ? 'ai-chip ai-chip-active' : 'ai-chip'}
                aria-pressed={value === count}
                onClick={() => setCount(value)}
              >
                {value}
              </button>
            ))}
          </div>
          <div className="ai-control-group" role="group" aria-label="Soort vragen">
            {TYPES.map((option) => (
              <button
                key={option.value}
                type="button"
                className={types.includes(option.value) ? 'ai-chip ai-chip-active' : 'ai-chip'}
                aria-pressed={types.includes(option.value)}
                onClick={() => toggleType(option.value)}
              >
                {option.label}
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
        </div>

        {loading ? (
          <div className="ai-result-loading">
            <Spinner />
            <p className="muted">Lerno AI maakt een quiz van deze set…</p>
          </div>
        ) : null}

        {error ? (
          <div className="form-error" role="alert">
            {error}
          </div>
        ) : null}

        {finished ? (
          <p className="ai-quiz-score" role="status">
            <IconSparkles size={14} /> {score} van {questions.length} goed
          </p>
        ) : null}

        {questions ? (
          <ol className="ai-quiz-list">
            {questions.map((question, index) => {
              const state = answers[index];
              const isChoice = question.type !== 'open';

              return (
                <li key={index} className="ai-quiz-question">
                  <p className="ai-question-text">
                    <span className="ai-question-index">{index + 1}</span>
                    {question.question}
                  </p>

                  {isChoice ? (
                    <div
                      className="ai-quiz-options"
                      role="group"
                      aria-label={`Antwoorden vraag ${index + 1}`}
                    >
                      {question.options.map((option, optionIndex) => {
                        const chosen = state?.value === String(optionIndex);
                        const isCorrect = question.correctIndex === optionIndex;
                        const className = !state?.checked
                          ? 'ai-quiz-option'
                          : isCorrect
                            ? 'ai-quiz-option ai-quiz-option-correct'
                            : chosen
                              ? 'ai-quiz-option ai-quiz-option-wrong'
                              : 'ai-quiz-option';
                        return (
                          <button
                            key={optionIndex}
                            type="button"
                            className={className}
                            disabled={Boolean(state?.checked)}
                            aria-pressed={chosen}
                            onClick={() => void answerMultipleChoice(index, optionIndex)}
                          >
                            {option}
                          </button>
                        );
                      })}
                    </div>
                  ) : (
                    <div className="ai-quiz-open">
                      <input
                        className="input"
                        value={state?.value ?? ''}
                        maxLength={300}
                        disabled={Boolean(state?.checked) || judging === index}
                        aria-label={`Antwoord vraag ${index + 1}`}
                        placeholder="Je antwoord…"
                        onChange={(event) =>
                          setAnswers((prev) => ({
                            ...prev,
                            [index]: {
                              value: event.target.value,
                              checked: false,
                              correct: null,
                            },
                          }))
                        }
                        onKeyDown={(event) => {
                          if (event.key === 'Enter' && event.currentTarget.value.trim()) {
                            event.preventDefault();
                            void answerOpen(index, event.currentTarget.value);
                          }
                        }}
                      />
                      <Button
                        size="sm"
                        disabled={
                          Boolean(state?.checked) || judging === index || !state?.value?.trim()
                        }
                        onClick={() => void answerOpen(index, state?.value ?? '')}
                      >
                        {judging === index ? 'Lerno AI kijkt mee…' : 'Controleer'}
                      </Button>
                    </div>
                  )}

                  {state?.checked ? (
                    <p className={state.correct ? 'ai-quiz-good' : 'ai-quiz-bad'}>
                      {state.correct ? 'Goed' : 'Nog niet goed'}
                      {state.feedback ? ` — ${state.feedback}` : ''}
                    </p>
                  ) : null}
                </li>
              );
            })}
          </ol>
        ) : null}
      </div>
    </Modal>
  );
}

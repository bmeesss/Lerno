/**
 * "Maak oefenvragen" — generated practice questions for a set.
 *
 * The questions come back validated by the backend (Zod), so this component
 * can render them directly. Per question: reveal the answer, or ask Lerno AI
 * for a hint that does not give it away.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { Button } from '../ui/Button';
import { Modal } from '../ui/Modal';
import { Spinner } from '../ui/Primitives';
import { IconRefresh, IconSparkles } from '../ui/Icons';
import { aiLearningService } from '../../services/aiLearningService';
import { friendlyAiError } from './AiResultModal';
import type { AiDifficulty, AiGeneratedQuestion } from '../../types';

const COUNTS: (5 | 10 | 15)[] = [5, 10, 15];
const DIFFICULTIES: { value: AiDifficulty; label: string }[] = [
  { value: 'easy', label: 'Makkelijk' },
  { value: 'normal', label: 'Normaal' },
  { value: 'hard', label: 'Moeilijk' },
];

interface AiQuestionsModalProps {
  open: boolean;
  setId: string;
  onClose: () => void;
}

export function AiQuestionsModal({ open, setId, onClose }: AiQuestionsModalProps) {
  const [count, setCount] = useState<5 | 10 | 15>(10);
  const [difficulty, setDifficulty] = useState<AiDifficulty>('normal');
  const [questions, setQuestions] = useState<AiGeneratedQuestion[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [revealed, setRevealed] = useState<Record<number, boolean>>({});
  const [hints, setHints] = useState<Record<number, string>>({});
  const [hintLoading, setHintLoading] = useState<number | null>(null);

  const generate = useCallback(async () => {
    setLoading(true);
    setError(null);
    setQuestions(null);
    setRevealed({});
    setHints({});
    try {
      const result = await aiLearningService.generateQuestions(setId, count, difficulty);
      setQuestions(result.questions);
    } catch (err) {
      setError(friendlyAiError(err));
    } finally {
      setLoading(false);
    }
  }, [setId, count, difficulty]);

  // Generates when the modal opens, and again when the options change.
  const generatedFor = useRef<string | null>(null);
  useEffect(() => {
    if (!open) {
      generatedFor.current = null;
      return;
    }
    const key = `${count}:${difficulty}`;
    if (generatedFor.current === key) return;
    generatedFor.current = key;
    void generate();
  }, [open, count, difficulty, generate]);

  async function askHint(index: number, question: AiGeneratedQuestion) {
    setHintLoading(index);
    try {
      const result = await aiLearningService.hint({
        setId,
        cardId: question.cardId ?? undefined,
        question: question.question,
        expectedAnswer: question.answer,
        hintsGiven: hints[index] ? 1 : 0,
      });
      setHints((prev) => ({ ...prev, [index]: result.hint }));
    } catch (err) {
      setHints((prev) => ({ ...prev, [index]: friendlyAiError(err) }));
    } finally {
      setHintLoading(null);
    }
  }

  return (
    <Modal
      open={open}
      title="Maak oefenvragen"
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" onClick={() => void generate()} disabled={loading}>
            <IconRefresh size={15} /> Nieuwe vragen
          </Button>
          <Button variant="ghost" onClick={onClose}>
            Sluiten
          </Button>
        </>
      }
    >
      <div className="ai-questions">
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
        </div>

        {loading ? (
          <div className="ai-result-loading">
            <Spinner />
            <p className="muted">Lerno AI schrijft {count} vragen over deze set…</p>
          </div>
        ) : null}

        {error ? (
          <div className="form-error" role="alert">
            {error}
          </div>
        ) : null}

        {questions && questions.length === 0 ? (
          <p className="muted">Er zijn geen vragen gemaakt. Probeer het opnieuw.</p>
        ) : null}

        {questions ? (
          <ol className="ai-question-list">
            {questions.map((question, index) => (
              <li key={index} className="ai-question">
                <p className="ai-question-text">
                  <span className="ai-question-index">{index + 1}</span>
                  {question.question}
                </p>

                {hints[index] ? (
                  <p className="ai-question-hint">
                    <IconSparkles size={13} /> Hint: {hints[index]}
                  </p>
                ) : null}

                <div className="ai-question-actions">
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setRevealed((prev) => ({ ...prev, [index]: !prev[index] }))}
                    aria-expanded={Boolean(revealed[index])}
                  >
                    {revealed[index] ? 'Verberg antwoord' : 'Toon antwoord'}
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => void askHint(index, question)}
                    disabled={hintLoading === index}
                  >
                    Hint
                  </Button>
                </div>

                {revealed[index] ? <p className="ai-question-answer">{question.answer}</p> : null}
              </li>
            ))}
          </ol>
        ) : null}
      </div>
    </Modal>
  );
}

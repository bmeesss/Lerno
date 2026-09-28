import { useState } from 'react';
import { Button } from '../ui/Button';
import { IconPlus, IconTrash } from '../ui/Icons';
import { useToast } from '../ui/Toast';
import { ApiError } from '../../lib/api';
import { studyPackService } from '../../services/studyPackService';
import type {
  PackCardsPreview,
  PackConceptsPreview,
  PackPreview,
  PackQuestionsPreview,
  PackSummaryPreview,
} from '../../types';

/**
 * Editable AI preview.
 *
 * Every generated preview must pass through here before it reaches the pack:
 * the student edits, removes or adds items, and only then confirms. Confirming
 * appends to the pack — nothing is ever overwritten silently.
 */
export function PreviewEditor({
  packId,
  preview,
  onApplied,
  onDiscard,
}: {
  packId: string;
  preview: PackPreview;
  onApplied: (summary: string) => void;
  onDiscard: () => void;
}) {
  const toast = useToast();
  const [busy, setBusy] = useState(false);

  const [summary, setSummary] = useState<PackSummaryPreview | null>(
    preview.target === 'summary' ? preview : null,
  );
  const [concepts, setConcepts] = useState<PackConceptsPreview['concepts']>(
    preview.target === 'concepts' ? preview.concepts : [],
  );
  const [cards, setCards] = useState<PackCardsPreview['cards']>(
    preview.target === 'flashcards' ? preview.cards : [],
  );
  const [questions, setQuestions] = useState<PackQuestionsPreview['questions']>(
    preview.target === 'practice' ? preview.questions : [],
  );

  /** Preview batches always come from a single source (or none). */
  const sourceId =
    preview.target === 'summary'
      ? preview.sourceId
      : preview.target === 'flashcards'
        ? preview.sourceId
        : preview.target === 'concepts'
          ? (preview.concepts[0]?.sourceId ?? null)
          : (preview.questions[0]?.sourceId ?? null);

  const count =
    preview.target === 'summary'
      ? summary && summary.summary.trim().length >= 20
        ? 1
        : 0
      : preview.target === 'concepts'
        ? concepts.filter((concept) => concept.name.trim().length >= 2).length
        : preview.target === 'flashcards'
          ? cards.filter((card) => card.front.trim() && card.back.trim()).length
          : questions.filter((question) => question.prompt.trim() && question.correctAnswer.trim())
              .length;

  async function apply() {
    if (busy || count === 0) return;
    setBusy(true);
    try {
      if (preview.target === 'summary' && summary) {
        await studyPackService.applyContent(packId, {
          target: 'summary',
          summary: summary.summary.trim(),
          sourceId,
        });
        onApplied('Summary saved to this study pack');
      } else if (preview.target === 'concepts') {
        await studyPackService.applyContent(packId, {
          target: 'concepts',
          concepts: concepts
            .filter((concept) => concept.name.trim().length >= 2)
            .map((concept) => ({
              name: concept.name.trim(),
              explanation: concept.explanation.trim(),
            })),
          sourceId,
        });
        onApplied(`${count} concept${count === 1 ? '' : 's'} added`);
      } else if (preview.target === 'flashcards') {
        await studyPackService.applyContent(packId, {
          target: 'flashcards',
          cards: cards
            .filter((card) => card.front.trim() && card.back.trim())
            .map((card) => ({ front: card.front.trim(), back: card.back.trim() })),
          sourceId,
        });
        onApplied(`${count} flashcard${count === 1 ? '' : 's'} added`);
      } else {
        await studyPackService.applyContent(packId, {
          target: 'practice',
          questions: questions
            .filter((question) => question.prompt.trim() && question.correctAnswer.trim())
            .map((question) => ({
              questionType: question.questionType,
              prompt: question.prompt.trim(),
              correctAnswer: question.correctAnswer.trim(),
              options: question.options?.map((option) => option.trim()).filter(Boolean) ?? null,
              explanation: question.explanation.trim(),
            })),
          sourceId,
        });
        onApplied(`${count} practice question${count === 1 ? '' : 's'} added`);
      }
    } catch (error) {
      toast.show(
        error instanceof ApiError ? error.message : 'Could not save this content',
        'error',
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="card pack-preview" aria-live="polite">
      <div className="pack-preview-head">
        <div>
          <span className="eyebrow-label">AI preview · editable</span>
          <h3>
            {preview.target === 'summary'
              ? 'Summary'
              : preview.target === 'concepts'
                ? 'Key concepts'
                : preview.target === 'flashcards'
                  ? 'Flashcards'
                  : 'Practice questions'}
          </h3>
          <p className="muted">
            Edit anything you like. Nothing is saved until you add it to the pack.
          </p>
        </div>
        <div className="pack-preview-actions">
          <Button variant="ghost" size="sm" onClick={onDiscard} disabled={busy}>
            Discard
          </Button>
          <Button size="sm" onClick={() => void apply()} disabled={busy || count === 0}>
            {busy ? 'Saving…' : `Add ${count > 0 ? count : ''} to pack`}
          </Button>
        </div>
      </div>

      {preview.target === 'summary' && summary ? (
        <div className="stack" style={{ gap: 12 }}>
          <label className="field">
            <span>Summary</span>
            <textarea
              className="textarea"
              rows={6}
              value={summary.summary}
              onChange={(event) =>
                setSummary((current) => (current ? { ...current, summary: event.target.value } : current))
              }
            />
          </label>
          {summary.keyPoints.length > 0 ? (
            <div>
              <span className="pack-label">Key points (not saved as text)</span>
              <ul className="pack-list">
                {summary.keyPoints.map((point) => (
                  <li key={point}>{point}</li>
                ))}
              </ul>
            </div>
          ) : null}
        </div>
      ) : null}

      {preview.target === 'concepts' ? (
        <ul className="pack-edit-list">
          {concepts.map((concept, index) => (
            <li key={`concept-${index}`} className="pack-edit-row">
              <input
                className="input"
                aria-label={`Concept ${index + 1} name`}
                value={concept.name}
                onChange={(event) =>
                  setConcepts((current) =>
                    current.map((entry, position) =>
                      position === index ? { ...entry, name: event.target.value } : entry,
                    ),
                  )
                }
              />
              <textarea
                className="textarea"
                rows={2}
                aria-label={`Concept ${index + 1} explanation`}
                value={concept.explanation}
                onChange={(event) =>
                  setConcepts((current) =>
                    current.map((entry, position) =>
                      position === index ? { ...entry, explanation: event.target.value } : entry,
                    ),
                  )
                }
              />
              <button
                type="button"
                className="icon-btn icon-btn-danger"
                aria-label={`Remove concept ${index + 1}`}
                onClick={() => setConcepts((current) => current.filter((_, position) => position !== index))}
              >
                <IconTrash size={16} />
              </button>
            </li>
          ))}
        </ul>
      ) : null}

      {preview.target === 'flashcards' ? (
        <ul className="pack-edit-list">
          {cards.map((card, index) => (
            <li key={`card-${index}`} className="pack-edit-row">
              <input
                className="input"
                aria-label={`Flashcard ${index + 1} front`}
                value={card.front}
                onChange={(event) =>
                  setCards((current) =>
                    current.map((entry, position) =>
                      position === index ? { ...entry, front: event.target.value } : entry,
                    ),
                  )
                }
              />
              <input
                className="input"
                aria-label={`Flashcard ${index + 1} back`}
                value={card.back}
                onChange={(event) =>
                  setCards((current) =>
                    current.map((entry, position) =>
                      position === index ? { ...entry, back: event.target.value } : entry,
                    ),
                  )
                }
              />
              <button
                type="button"
                className="icon-btn icon-btn-danger"
                aria-label={`Remove flashcard ${index + 1}`}
                onClick={() => setCards((current) => current.filter((_, position) => position !== index))}
              >
                <IconTrash size={16} />
              </button>
            </li>
          ))}
        </ul>
      ) : null}

      {preview.target === 'practice' ? (
        <ul className="pack-edit-list">
          {questions.map((question, index) => (
            <li key={`question-${index}`} className="pack-edit-row">
              <select
                className="select"
                aria-label={`Question ${index + 1} type`}
                value={question.questionType}
                onChange={(event) =>
                  setQuestions((current) =>
                    current.map((entry, position) =>
                      position === index
                        ? {
                            ...entry,
                            questionType: event.target.value as QuestionType,
                            options:
                              event.target.value === 'short_answer'
                                ? null
                                : (entry.options ?? ['', '']),
                          }
                        : entry,
                    ),
                  )
                }
              >
                <option value="multiple_choice">Multiple choice</option>
                <option value="true_false">True / false</option>
                <option value="short_answer">Open answer</option>
              </select>
              <input
                className="input"
                aria-label={`Question ${index + 1} prompt`}
                value={question.prompt}
                onChange={(event) =>
                  setQuestions((current) =>
                    current.map((entry, position) =>
                      position === index ? { ...entry, prompt: event.target.value } : entry,
                    ),
                  )
                }
              />
              <input
                className="input"
                aria-label={`Question ${index + 1} correct answer`}
                value={question.correctAnswer}
                onChange={(event) =>
                  setQuestions((current) =>
                    current.map((entry, position) =>
                      position === index ? { ...entry, correctAnswer: event.target.value } : entry,
                    ),
                  )
                }
              />
              {question.options ? (
                <input
                  className="input"
                  aria-label={`Question ${index + 1} options, separated by |`}
                  value={question.options.join(' | ')}
                  onChange={(event) =>
                    setQuestions((current) =>
                      current.map((entry, position) =>
                        position === index
                          ? {
                              ...entry,
                              options: event.target.value
                                .split('|')
                                .map((option) => option.trim())
                                .filter(Boolean),
                            }
                          : entry,
                      ),
                    )
                  }
                />
              ) : null}
              <button
                type="button"
                className="icon-btn icon-btn-danger"
                aria-label={`Remove question ${index + 1}`}
                onClick={() => setQuestions((current) => current.filter((_, position) => position !== index))}
              >
                <IconTrash size={16} />
              </button>
            </li>
          ))}
        </ul>
      ) : null}

      <button
        type="button"
        className="btn btn-ghost btn-sm pack-add-row"
        onClick={() => {
          if (preview.target === 'concepts') {
            setConcepts((current) => [...current, { name: '', explanation: '', sourceId }]);
          } else if (preview.target === 'flashcards') {
            setCards((current) => [...current, { front: '', back: '' }]);
          } else if (preview.target === 'practice') {
            setQuestions((current) => [
              ...current,
              {
                questionType: 'short_answer',
                prompt: '',
                correctAnswer: '',
                options: null,
                explanation: '',
                sourceId,
              },
            ]);
          }
        }}
        disabled={preview.target === 'summary'}
      >
        <IconPlus size={15} /> Add row
      </button>
    </div>
  );
}

type QuestionType = 'multiple_choice' | 'true_false' | 'short_answer';

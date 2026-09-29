import { useMemo, useState } from 'react';
import { Button } from '../ui/Button';
import { Badge } from '../ui/Primitives';
import { IconCheck, IconRefresh, IconSparkles, IconTrash } from '../ui/Icons';
import { useToast } from '../ui/Toast';
import { ApiError } from '../../lib/api';
import { studyPackService } from '../../services/studyPackService';
import { formatClock } from './PackBits';
import type {
  GenerationSettings,
  StudyContentPreview,
  StudyPackSource,
} from '../../types';

type Tab = 'summary' | 'concepts' | 'flashcards' | 'practice';

const TAB_LABELS: Record<Tab, string> = {
  summary: 'Summary',
  concepts: 'Concepts',
  flashcards: 'Flashcards',
  practice: 'Practice',
};

type PreviewConcept = StudyContentPreview['concepts'][number];
type PreviewFlashcard = StudyContentPreview['flashcards'][number];
type PreviewQuestion = StudyContentPreview['questions'][number];

/** "Source: Biologie H3.pdf · page 6" — only when the provenance is real. */
function provenanceLabel(
  item: { sourceId?: string | null; refLabel?: string | null },
  sourceTitles: Record<string, string>,
): string | null {
  const title = item.sourceId ? sourceTitles[item.sourceId] : null;
  if (title && item.refLabel) return `${title} · ${item.refLabel}`;
  if (title) return title;
  if (item.refLabel) return item.refLabel;
  return null;
}

/**
 * The review screen of the content engine.
 *
 * Everything generated for a Study Pack arrives here at once: summary, concepts,
 * flashcards and practice, all from the same analysis. Nothing is stored until
 * the student confirms, individual items can be dropped, edited or regenerated,
 * and conflicts between sources are shown instead of silently merged.
 */
export function ContentReview({
  packId,
  preview,
  sources,
  settings,
  onApplied,
  onDiscard,
}: {
  packId: string;
  preview: StudyContentPreview;
  sources: StudyPackSource[];
  settings: GenerationSettings;
  onApplied: (message: string) => void;
  onDiscard: () => void;
}) {
  const toast = useToast();
  const [tab, setTab] = useState<Tab>(preview.summary ? 'summary' : 'concepts');
  const [busy, setBusy] = useState<string | null>(null);
  const [summary, setSummary] = useState(preview.summary);
  const [concepts, setConcepts] = useState<PreviewConcept[]>(preview.concepts);
  const [flashcards, setFlashcards] = useState<PreviewFlashcard[]>(preview.flashcards);
  const [questions, setQuestions] = useState<PreviewQuestion[]>(preview.questions);
  const [dropped, setDropped] = useState<Set<string>>(new Set());

  const sourceTitles = useMemo(() => {
    const map: Record<string, string> = {};
    for (const source of sources) map[source.id] = source.title;
    return map;
  }, [sources]);

  const keyOf = (kind: Tab, index: number) => `${kind}:${index}`;
  const isDropped = (kind: Tab, index: number) => dropped.has(keyOf(kind, index));

  function toggleDrop(kind: Tab, index: number) {
    setDropped((current) => {
      const next = new Set(current);
      const key = keyOf(kind, index);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  const keptSummary = summary && !isDropped('summary', 0) ? summary : null;
  const keptConcepts = concepts.filter((_, index) => !isDropped('concepts', index));
  const keptFlashcards = flashcards.filter((_, index) => !isDropped('flashcards', index));
  const keptQuestions = questions.filter((_, index) => !isDropped('practice', index));
  const total =
    (keptSummary ? 1 : 0) +
    keptConcepts.length +
    keptFlashcards.length +
    keptQuestions.length;

  const tabCount: Record<Tab, number> = {
    summary: keptSummary ? 1 : 0,
    concepts: keptConcepts.length,
    flashcards: keptFlashcards.length,
    practice: keptQuestions.length,
  };

  /** Regenerates exactly one item; the rejection never touches approved content. */
  async function regenerate(
    kind: 'concept' | 'flashcard' | 'question',
    current: Record<string, unknown>,
  ) {
    const key = `${kind}:${String(current.front ?? current.prompt ?? current.name ?? '')}`;
    setBusy(key);
    try {
      const result = await studyPackService.regenerateItem(packId, {
        kind,
        current,
        sourceId: typeof current.sourceId === 'string' ? current.sourceId : null,
        settings,
      });
      if (result.kind === 'concept') {
        const item = result.item as PreviewConcept;
        setConcepts((list) =>
          list.map((entry) => (entry.name === current.name ? item : entry)),
        );
      } else if (result.kind === 'flashcard') {
        const item = result.item as PreviewFlashcard;
        setFlashcards((list) =>
          list.map((entry) => (entry.front === current.front ? item : entry)),
        );
      } else {
        const item = result.item as PreviewQuestion;
        setQuestions((list) =>
          list.map((entry) => (entry.prompt === current.prompt ? item : entry)),
        );
      }
      toast.show('Regenerated — review the new version', 'success');
    } catch (error) {
      toast.show(
        error instanceof ApiError
          ? error.message
          : 'We could not generate a replacement for this item.',
        'error',
      );
    } finally {
      setBusy(null);
    }
  }

  /** Saves the kept items. Additive only: nothing that exists is replaced. */
  async function accept() {
    if (busy || total === 0) return;
    setBusy('accept');
    let saved = 0;
    try {
      if (keptSummary && keptSummary.summary.trim().length >= 20) {
        await studyPackService.applyContent(packId, {
          target: 'summary',
          summary: keptSummary.summary.trim(),
          sourceId: keptSummary.sourceId,
        });
        saved += 1;
      }
      if (keptConcepts.length > 0) {
        await studyPackService.applyContent(packId, {
          target: 'concepts',
          concepts: keptConcepts.map((concept) => ({
            name: concept.name.trim(),
            explanation: concept.explanation.trim(),
            sourceId: concept.sourceId,
            refLabel: concept.refLabel,
            importance: concept.importance,
            difficulty: concept.difficulty,
          })),
          sourceId: keptConcepts[0]?.sourceId ?? null,
        });
        saved += keptConcepts.length;
      }
      if (keptFlashcards.length > 0) {
        await studyPackService.applyContent(packId, {
          target: 'flashcards',
          cards: keptFlashcards.map((card) => ({
            front: card.front.trim(),
            back: card.back.trim(),
            sourceId: card.sourceId,
            conceptId: card.conceptId,
          })),
          sourceId: keptFlashcards[0]?.sourceId ?? null,
        });
        saved += keptFlashcards.length;
      }
      if (keptQuestions.length > 0) {
        await studyPackService.applyContent(packId, {
          target: 'practice',
          questions: keptQuestions.map((question) => ({
            questionType: question.questionType,
            prompt: question.prompt.trim(),
            correctAnswer: question.correctAnswer.trim(),
            options: question.options,
            explanation: question.explanation.trim(),
            sourceId: question.sourceId,
            conceptId: question.conceptId,
          })),
          sourceId: keptQuestions[0]?.sourceId ?? null,
        });
        saved += keptQuestions.length;
      }
      onApplied(`${saved} item${saved === 1 ? '' : 's'} saved to your study pack`);
    } catch (error) {
      toast.show(
        error instanceof ApiError ? error.message : 'We could not save this content.',
        'error',
      );
    } finally {
      setBusy(null);
    }
  }

  return (
    <section className="card pack-preview" aria-live="polite">
      <div className="pack-preview-head">
        <div>
          <span className="eyebrow-label">AI preview · nothing saved yet</span>
          <h3>Review everything Lerno generated</h3>
          <p className="muted">
            Edit, regenerate or drop anything. Only what you accept is added — existing content is
            never overwritten.
          </p>
        </div>
        <div className="pack-preview-actions">
          <Button variant="ghost" type="button" onClick={onDiscard} disabled={busy !== null}>
            Discard
          </Button>
          <Button type="button" onClick={() => void accept()} disabled={busy !== null || total === 0}>
            {busy === 'accept' ? 'Saving…' : `Accept ${total} item${total === 1 ? '' : 's'}`}
          </Button>
        </div>
      </div>

      {preview.conflicts.length > 0 ? (
        <div className="import-notice" role="status">
          <IconSparkles size={17} />
          <div>
            <strong>Conflicting information found</strong>
            <p>
              Your sources do not say the same thing everywhere. Lerno kept both versions — you
              decide which one is right.
            </p>
            <ul className="pack-list">
              {preview.conflicts.map((conflict) => (
                <li key={conflict.topic}>
                  <strong>{conflict.topic}</strong>
                  {conflict.claims.map((claim) => (
                    <div key={`${claim.sourceId}-${claim.marker}`} className="muted">
                      <span>
                        {sourceTitles[claim.sourceId] ?? 'Source'} · {claim.referenceLabel}:
                      </span>{' '}
                      {claim.statement} “{claim.quote}”
                    </div>
                  ))}
                </li>
              ))}
            </ul>
          </div>
        </div>
      ) : null}

      {preview.rejected.length > 0 ? (
        <p className="muted">
          {preview.rejected.length} item{preview.rejected.length === 1 ? '' : 's'} did not pass the
          quality check and {preview.rejected.length === 1 ? 'was' : 'were'} left out.
        </p>
      ) : null}

      <div className="pack-review-tabs" role="tablist" aria-label="Generated content">
        {(Object.keys(TAB_LABELS) as Tab[]).map((id) => (
          <button
            key={id}
            type="button"
            role="tab"
            aria-selected={tab === id}
            className={`pack-review-tab${tab === id ? ' pack-review-tab-active' : ''}`}
            onClick={() => setTab(id)}
          >
            {TAB_LABELS[id]} <span className="muted">{tabCount[id]}</span>
          </button>
        ))}
      </div>

      {tab === 'summary' ? (
        summary ? (
          <div className="stack" style={{ gap: 12 }}>
            <label className="field">
              <span>Summary</span>
              <textarea
                className="textarea"
                rows={6}
                value={summary.summary}
                onChange={(event) =>
                  setSummary((current) =>
                    current ? { ...current, summary: event.target.value } : current,
                  )
                }
              />
            </label>
            {summary.keyPoints.length > 0 ? (
              <ul className="pack-list">
                {summary.keyPoints.map((point) => (
                  <li key={point}>{point}</li>
                ))}
              </ul>
            ) : null}
            {summary.sourceId ? (
              <p className="muted">
                Source: {provenanceLabel(summary, sourceTitles) ?? sourceTitles[summary.sourceId]}
              </p>
            ) : null}
            <div className="pack-edit-actions">
              <Button
                size="sm"
                variant="secondary"
                type="button"
                onClick={() => toggleDrop('summary', 0)}
              >
                {isDropped('summary', 0) ? 'Keep summary' : 'Drop summary'}
              </Button>
            </div>
          </div>
        ) : (
          <p className="muted">No summary was generated for this material.</p>
        )
      ) : null}

      {tab === 'concepts' ? (
        <ul className="pack-edit-list">
          {concepts.map((concept, index) => (
            <li
              key={`concept-${index}`}
              className={`pack-edit-row${isDropped('concepts', index) ? ' pack-edit-row-dropped' : ''}`}
            >
              <input
                className="input"
                aria-label={`Concept ${index + 1} name`}
                value={concept.name}
                onChange={(event) =>
                  setConcepts((list) =>
                    list.map((entry, position) =>
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
                  setConcepts((list) =>
                    list.map((entry, position) =>
                      position === index ? { ...entry, explanation: event.target.value } : entry,
                    ),
                  )
                }
              />
              <div className="pack-edit-meta">
                {provenanceLabel(concept, sourceTitles) ? (
                  <span className="muted">
                    Source: {provenanceLabel(concept, sourceTitles)}
                  </span>
                ) : null}
                {concept.difficulty ? <Badge>{concept.difficulty}</Badge> : null}
              </div>
              <div className="pack-edit-actions">
                <Button
                  size="sm"
                  variant="ghost"
                  type="button"
                  aria-label={`Regenerate concept ${index + 1}`}
                  onClick={() => void regenerate('concept', concept as unknown as Record<string, unknown>)}
                  disabled={busy !== null}
                >
                  <IconRefresh size={14} /> Regenerate
                </Button>
                <button
                  type="button"
                  className="icon-btn icon-btn-danger"
                  aria-label={`Remove concept ${index + 1}`}
                  onClick={() => toggleDrop('concepts', index)}
                >
                  <IconTrash size={16} />
                </button>
              </div>
            </li>
          ))}
        </ul>
      ) : null}

      {tab === 'flashcards' ? (
        <ul className="pack-edit-list">
          {flashcards.map((card, index) => (
            <li
              key={`card-${index}`}
              className={`pack-edit-row${isDropped('flashcards', index) ? ' pack-edit-row-dropped' : ''}`}
            >
              <input
                className="input"
                aria-label={`Flashcard ${index + 1} front`}
                value={card.front}
                onChange={(event) =>
                  setFlashcards((list) =>
                    list.map((entry, position) =>
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
                  setFlashcards((list) =>
                    list.map((entry, position) =>
                      position === index ? { ...entry, back: event.target.value } : entry,
                    ),
                  )
                }
              />
              {provenanceLabel(card, sourceTitles) ? (
                <span className="muted">
                  Generated from: {provenanceLabel(card, sourceTitles)}
                </span>
              ) : null}
              <div className="pack-edit-actions">
                <Button
                  size="sm"
                  variant="ghost"
                  type="button"
                  aria-label={`Regenerate flashcard ${index + 1}`}
                  onClick={() => void regenerate('flashcard', card as unknown as Record<string, unknown>)}
                  disabled={busy !== null}
                >
                  <IconRefresh size={14} /> Regenerate
                </Button>
                <button
                  type="button"
                  className="icon-btn icon-btn-danger"
                  aria-label={`Remove flashcard ${index + 1}`}
                  onClick={() => toggleDrop('flashcards', index)}
                >
                  <IconTrash size={16} />
                </button>
              </div>
            </li>
          ))}
        </ul>
      ) : null}

      {tab === 'practice' ? (
        <ul className="pack-edit-list">
          {questions.map((question, index) => (
            <li
              key={`question-${index}`}
              className={`pack-edit-row${isDropped('practice', index) ? ' pack-edit-row-dropped' : ''}`}
            >
              <input
                className="input"
                aria-label={`Question ${index + 1} prompt`}
                value={question.prompt}
                onChange={(event) =>
                  setQuestions((list) =>
                    list.map((entry, position) =>
                      position === index ? { ...entry, prompt: event.target.value } : entry,
                    ),
                  )
                }
              />
              <input
                className="input"
                aria-label={`Question ${index + 1} answer`}
                value={question.correctAnswer}
                onChange={(event) =>
                  setQuestions((list) =>
                    list.map((entry, position) =>
                      position === index ? { ...entry, correctAnswer: event.target.value } : entry,
                    ),
                  )
                }
              />
              <div className="pack-edit-meta">
                <Badge>{question.questionType.replace('_', ' ')}</Badge>
                {question.refLabel ? <span className="muted">Based on: {question.refLabel}</span> : null}
              </div>
              <div className="pack-edit-actions">
                <Button
                  size="sm"
                  variant="ghost"
                  type="button"
                  aria-label={`Regenerate question ${index + 1}`}
                  onClick={() => void regenerate('question', question as unknown as Record<string, unknown>)}
                  disabled={busy !== null}
                >
                  <IconRefresh size={14} /> Regenerate
                </Button>
                <button
                  type="button"
                  className="icon-btn icon-btn-danger"
                  aria-label={`Remove question ${index + 1}`}
                  onClick={() => toggleDrop('practice', index)}
                >
                  <IconTrash size={16} />
                </button>
              </div>
            </li>
          ))}
        </ul>
      ) : null}

      <p className="muted pack-review-footnote">
        <IconCheck size={14} /> Every item was checked before it reached this screen: no empty
        question or answer, no duplicates, no missing source reference, no invalid options.
        {preview.settings.flashcards > 0 ? (
          <>
            {' '}
            Generated for {formatClock(preview.settings.practice * 60)} of practice at{' '}
            {preview.settings.difficulty} level.
          </>
        ) : null}
      </p>
    </section>
  );
}

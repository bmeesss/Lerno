import { useMemo, useState } from 'react';
import { Button, ButtonLink } from '../ui/Button';
import { Badge, EmptyState, ProgressBar } from '../ui/Primitives';
import { IconArrowRight, IconBook, IconCheck } from '../ui/Icons';
import { useToast } from '../ui/Toast';
import { ApiError } from '../../lib/api';
import { studyPackService } from '../../services/studyPackService';
import { MasteryMeter } from './PackBits';
import type { StudyPackConcept, StudyPackDetail } from '../../types';

const RATINGS = [
  { id: 'again', label: 'Still learning', hint: 'Show this concept again soon' },
  { id: 'hard', label: 'Hard', hint: 'Knew parts of it' },
  { id: 'good', label: 'Got it', hint: 'Could explain this' },
  { id: 'easy', label: 'Easy', hint: 'Could teach this' },
] as const;

type RatingId = (typeof RATINGS)[number]['id'];

interface SessionResult {
  concept: StudyPackConcept;
  rating: RatingId;
  masteryPercent: number;
  before: number;
}

/**
 * Learn mode: one concept at a time with a self-rating.
 *
 * The rating is stored as concept mastery, which is what later adaptive
 * learning builds on — the session itself stays simple and honest.
 */
export function PackLearn({
  pack,
  focusConceptId,
  onChanged,
}: {
  pack: StudyPackDetail;
  focusConceptId?: string;
  onChanged: () => void;
}) {
  const toast = useToast();
  const [started, setStarted] = useState(false);
  const [index, setIndex] = useState(0);
  const [results, setResults] = useState<SessionResult[]>([]);
  const [busy, setBusy] = useState(false);

  const queue = useMemo(() => {
    const order = [...pack.concepts].sort((a, b) => {
      const aRank = a.attempts > 0 && a.masteryPercent < 60 ? 0 : a.attempts === 0 ? 1 : 2;
      const bRank = b.attempts > 0 && b.masteryPercent < 60 ? 0 : b.attempts === 0 ? 1 : 2;
      return aRank - bRank || a.masteryPercent - b.masteryPercent || a.position - b.position;
    });
    if (!focusConceptId) return order;
    const focus = order.find((concept) => concept.id === focusConceptId);
    return focus ? [focus, ...order.filter((concept) => concept.id !== focusConceptId)] : order;
  }, [pack.concepts, focusConceptId]);

  if (pack.concepts.length === 0) {
    return (
      <EmptyState
        icon={<IconBook />}
        title="Nothing to learn yet"
        description="Learn mode walks through the concepts in this pack. Extract concepts from your material first."
        action={<ButtonLink to="?tab=concepts">Open concepts</ButtonLink>}
      />
    );
  }

  const current = queue[index];
  const finished = started && (!current || index >= queue.length);

  async function rate(rating: RatingId) {
    if (!current || busy) return;
    setBusy(true);
    const before = current.masteryPercent;
    try {
      const updated = await studyPackService.rateConcept(pack.id, current.id, rating);
      setResults((rows) => [...rows, { concept: current, rating, masteryPercent: updated.masteryPercent, before }]);
      if (index + 1 >= queue.length) {
        setIndex(queue.length);
      } else {
        setIndex((value) => value + 1);
      }
    } catch (error) {
      toast.show(error instanceof ApiError ? error.message : 'Could not save your rating', 'error');
    } finally {
      setBusy(false);
    }
  }

  if (!started) {
    const weak = queue.filter((concept) => concept.attempts > 0 && concept.masteryPercent < 60).length;
    const fresh = queue.filter((concept) => concept.attempts === 0).length;
    return (
      <section className="card pack-session-intro" aria-labelledby="pack-learn-heading">
        <span className="eyebrow-label">Learn</span>
        <h2 id="pack-learn-heading">Understand the concepts, one at a time</h2>
        <p>
          {queue.length} concept{queue.length === 1 ? '' : 's'} in this pack
          {weak > 0 ? ` · ${weak} weaker ones first` : ''}
          {fresh > 0 ? ` · ${fresh} not started yet` : ''}. Rate how well you know each one and Lerno
          keeps your mastery up to date.
        </p>
        <div className="pack-session-intro-actions">
          <Button onClick={() => setStarted(true)}>
            <IconBook size={17} /> Start learning
          </Button>
          <ButtonLink to="?tab=flashcards" variant="secondary">
            Study flashcards instead
          </ButtonLink>
        </div>
      </section>
    );
  }

  if (finished) {
    const known = results.filter((row) => row.rating === 'good' || row.rating === 'easy').length;
    const needsWork = results.filter((row) => row.rating === 'again' || row.rating === 'hard');
    return (
      <section className="card pack-session-summary" aria-labelledby="pack-learn-done">
        <span className="eyebrow-label">Session complete</span>
        <h2 id="pack-learn-done">
          {known} of {results.length} concepts feel solid
        </h2>
        <div className="pack-session-stats">
          <div>
            <span className="pack-stat-value">{results.length}</span>
            <span className="pack-stat-label">concepts reviewed</span>
          </div>
          <div>
            <span className="pack-stat-value">{known}</span>
            <span className="pack-stat-label">known well</span>
          </div>
          <div>
            <span className="pack-stat-value">{needsWork.length}</span>
            <span className="pack-stat-label">need another pass</span>
          </div>
        </div>

        {needsWork.length > 0 ? (
          <div className="pack-session-focus">
            <span className="pack-label">Do this next</span>
            <ul className="pack-list">
              {needsWork.slice(0, 4).map((row) => (
                <li key={row.concept.id}>
                  <strong>{row.concept.name}</strong> — practice the questions behind this concept
                </li>
              ))}
            </ul>
          </div>
        ) : (
          <p className="muted">
            Nice work. Practice and a practice test will confirm what actually stuck.
          </p>
        )}

        <div className="pack-session-intro-actions">
          {needsWork[0] ? (
            <ButtonLink to={`?tab=practice&concept=${needsWork[0].concept.id}`}>
              Practice weak concepts <IconArrowRight size={17} />
            </ButtonLink>
          ) : (
            <ButtonLink to="?tab=test">Take a practice test</ButtonLink>
          )}
          <Button
            variant="secondary"
            onClick={() => {
              setResults([]);
              setIndex(0);
              setStarted(false);
              onChanged();
            }}
          >
            Another round
          </Button>
        </div>
      </section>
    );
  }

  return (
    <section className="pack-session" aria-labelledby="pack-learn-concept">
      <div className="pack-session-progress">
        <ProgressBar value={index + 1} max={queue.length} />
        <span className="muted">
          Concept {index + 1} of {queue.length}
        </span>
      </div>

      <article className="card pack-learn-card">
        <div className="pack-learn-head">
          <h2 id="pack-learn-concept">{current.name}</h2>
          <MasteryMeter percent={current.masteryPercent} label="Mastery" />
        </div>
        <p className="pack-learn-explanation">{current.explanation || 'No explanation yet.'}</p>
        <div className="pack-learn-facts">
          <Badge>{current.cardCount} flashcards</Badge>
          <Badge>{current.questionCount} practice questions</Badge>
          {current.sourceTitle ? <Badge>{current.sourceTitle}</Badge> : null}
        </div>
      </article>

      <fieldset className="pack-rating-row">
        <legend>How well do you know this?</legend>
        {RATINGS.map((rating) => (
          <button
            key={rating.id}
            type="button"
            className={`pack-rating pack-rating-${rating.id}`}
            onClick={() => void rate(rating.id)}
            disabled={busy}
          >
            <strong>{rating.label}</strong>
            <small>{rating.hint}</small>
          </button>
        ))}
      </fieldset>

      {results.length > 0 ? (
        <p className="muted pack-last-rating">
          <IconCheck size={15} /> {results.at(-1)!.concept.name} → {results.at(-1)!.masteryPercent}% mastery
        </p>
      ) : null}
    </section>
  );
}

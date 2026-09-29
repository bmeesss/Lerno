import { useState } from 'react';
import { Button, ButtonLink } from '../ui/Button';
import { Badge, EmptyState, ProgressBar } from '../ui/Primitives';
import { IconArrowRight, IconBook, IconCheck } from '../ui/Icons';
import { useToast } from '../ui/Toast';
import { ApiError } from '../../lib/api';
import { studyPackService } from '../../services/studyPackService';
import { MasteryMeter } from './PackBits';
import type { AdaptiveLearnConcept, StudyPackDetail } from '../../types';

const RATINGS = [
  { id: 'again', label: 'Still learning', hint: 'Show this concept again soon' },
  { id: 'hard', label: 'Hard', hint: 'Knew parts of it' },
  { id: 'good', label: 'Got it', hint: 'Could explain this' },
  { id: 'easy', label: 'Easy', hint: 'Could teach this' },
] as const;

type RatingId = (typeof RATINGS)[number]['id'];
interface SessionResult {
  concept: AdaptiveLearnConcept;
  rating: RatingId;
  masteryPercent: number;
  before: number;
}

/** A Learn session asks the server for the next concept after every rating. */
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
  const [current, setCurrent] = useState<AdaptiveLearnConcept | null>(null);
  const [seen, setSeen] = useState<string[]>([]);
  const [results, setResults] = useState<SessionResult[]>([]);
  const [busy, setBusy] = useState(false);
  const [loadingNext, setLoadingNext] = useState(false);
  const [shownAt, setShownAt] = useState(Date.now());

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

  async function fetchNext(excluded: string[], focus?: string) {
    setLoadingNext(true);
    try {
      const next = await studyPackService.nextLearnConcept(pack.id, excluded, focus);
      setCurrent(next.concept);
      setShownAt(Date.now());
    } catch (error) {
      toast.show(error instanceof ApiError ? error.message : 'Could not load the next concept', 'error');
      if (excluded.length === 0) setStarted(false);
    } finally {
      setLoadingNext(false);
    }
  }

  async function start() {
    setStarted(true);
    setSeen([]);
    setResults([]);
    await fetchNext([], focusConceptId);
  }

  async function rate(rating: RatingId) {
    if (!current || busy) return;
    setBusy(true);
    const answeredConcept = current;
    const before = current.masteryPercent;
    const responseTimeMs = Math.max(0, Date.now() - shownAt);
    try {
      const updated = await studyPackService.rateConcept(
        pack.id,
        answeredConcept.id,
        rating,
        responseTimeMs,
      );
      const nextSeen = [...seen, answeredConcept.id];
      setSeen(nextSeen);
      setResults((rows) => [
        ...rows,
        { concept: answeredConcept, rating, masteryPercent: updated.masteryPercent, before },
      ]);
      setCurrent(null);
      await fetchNext(nextSeen);
      onChanged();
    } catch (error) {
      toast.show(error instanceof ApiError ? error.message : 'Could not save your rating', 'error');
    } finally {
      setBusy(false);
    }
  }

  const finished = started && !loadingNext && current === null;

  if (!started) {
    const weak = pack.concepts.filter((concept) => concept.attempts > 0 && concept.masteryPercent < 30).length;
    const fresh = pack.concepts.filter((concept) => concept.attempts === 0).length;
    return (
      <section className="card pack-session-intro" aria-labelledby="pack-learn-heading">
        <span className="eyebrow-label">Learn</span>
        <h2 id="pack-learn-heading">Understand the concepts, one at a time</h2>
        <p>
          {pack.concepts.length} concept{pack.concepts.length === 1 ? '' : 's'} in this pack
          {weak > 0 ? ` · ${weak} weak concepts first` : ''}
          {fresh > 0 ? ` · ${fresh} new concepts` : ''}. Lerno updates mastery after each rating and
          chooses the next concept from your latest progress.
        </p>
        <div className="pack-session-intro-actions">
          <Button onClick={() => void start()}>
            <IconBook size={17} /> Start learning
          </Button>
          <ButtonLink to="?tab=flashcards" variant="secondary">
            Study flashcards instead
          </ButtonLink>
        </div>
      </section>
    );
  }

  if (loadingNext && !current) {
    return (
      <section className="card pack-session-intro" aria-live="polite">
        <span className="eyebrow-label">Learn</span>
        <h2>Choosing your next concept…</h2>
        <p className="muted">Using your current mastery, due reviews and recent answers.</p>
      </section>
    );
  }

  if (finished) {
    const improved = results.filter((row) => row.masteryPercent > row.before).length;
    const needsWork = results.filter((row) => row.masteryPercent < 30 || row.rating === 'again');
    const firstPractice = needsWork.find((row) => row.concept.questionCount > 0);
    return (
      <section className="card pack-session-summary" aria-labelledby="pack-learn-done">
        <span className="eyebrow-label">Session complete</span>
        <h2 id="pack-learn-done">You reviewed {results.length} concept{results.length === 1 ? '' : 's'}</h2>
        <div className="pack-session-stats">
          <div>
            <span className="pack-stat-value">{results.length}</span>
            <span className="pack-stat-label">concepts reviewed</span>
          </div>
          <div>
            <span className="pack-stat-value">{improved}</span>
            <span className="pack-stat-label">mastery improved</span>
          </div>
          <div>
            <span className="pack-stat-value">{needsWork.length}</span>
            <span className="pack-stat-label">still need practice</span>
          </div>
        </div>
        {results.length > 0 ? (
          <p className="muted">
            {results.at(-1)!.concept.name}: {results.at(-1)!.before}% → {results.at(-1)!.masteryPercent}% mastery.
          </p>
        ) : null}
        {needsWork.length > 0 ? (
          <div className="pack-session-focus">
            <span className="pack-label">Why this is next</span>
            <ul className="pack-list">
              {needsWork.slice(0, 4).map((row) => (
                <li key={row.concept.id}>
                  <strong>{row.concept.name}</strong> — your rating shows this concept needs another pass.
                </li>
              ))}
            </ul>
          </div>
        ) : (
          <p className="muted">Nice work. A short practice session can confirm what stuck.</p>
        )}
        <div className="pack-session-intro-actions">
          {firstPractice ? (
            <ButtonLink to={`?tab=practice&concept=${firstPractice.concept.id}`}>
              Practice {firstPractice.concept.name} <IconArrowRight size={17} />
            </ButtonLink>
          ) : (
            <ButtonLink to="?tab=test">Take a practice test</ButtonLink>
          )}
          <Button variant="secondary" onClick={() => void start()}>
            Another round
          </Button>
        </div>
      </section>
    );
  }

  if (!current) return null;

  return (
    <section className="pack-session" aria-labelledby="pack-learn-concept">
      <div className="pack-session-progress">
        <ProgressBar value={seen.length + 1} max={pack.concepts.length} />
        <span className="muted">
          Concept {seen.length + 1} of {pack.concepts.length} · selected for you
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
          <Badge>{current.attempts === 0 ? 'New' : `${current.confidencePercent}% confidence`}</Badge>
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
            disabled={busy || loadingNext}
          >
            <strong>{rating.label}</strong>
            <small>{rating.hint}</small>
          </button>
        ))}
      </fieldset>
      {results.length > 0 ? (
        <p className="muted pack-last-rating" aria-live="polite">
          <IconCheck size={15} /> {results.at(-1)!.concept.name} → {results.at(-1)!.masteryPercent}% mastery
        </p>
      ) : null}
    </section>
  );
}

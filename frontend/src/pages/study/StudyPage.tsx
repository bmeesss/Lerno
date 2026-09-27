import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { Button, ButtonLink } from '../../components/ui/Button';
import { EmptyState, LoadingRow, ProgressBar } from '../../components/ui/Primitives';
import {
  FlashcardSession,
  type SessionCard,
  type SessionSummary,
} from '../../components/study/FlashcardSession';
import { useAsync } from '../../hooks/useAsync';
import { useAuth } from '../../hooks/useAuth';
import { nextActionLink } from '../../lib/nextAction';
import { guestProgress } from '../../services/guestProgress';
import { progressService } from '../../services/progressService';
import { studyService } from '../../services/studyService';
import { studySetService } from '../../services/studySetService';
import type { StudySetDetail, TodaySummary } from '../../types';

type Phase = 'loading' | 'session' | 'done' | 'error';

export function StudyPage() {
  const { setId } = useParams<{ setId: string }>();
  const { user } = useAuth();
  const {
    data: set,
    loading,
    error,
  } = useAsync<StudySetDetail>(() => studySetService.get(setId ?? ''), [setId]);

  const [phase, setPhase] = useState<Phase>(loading ? 'loading' : 'session');
  const [summary, setSummary] = useState<SessionSummary | null>(null);
  const [queuedCards, setQueuedCards] = useState<SessionCard[] | null>(null);
  const [mistakeIds, setMistakeIds] = useState<string[]>([]);
  const [retryIds, setRetryIds] = useState<string[] | null>(null);
  const [round, setRound] = useState(0);
  const sessionIdRef = useRef<string | null>(null);
  const wrongIdsRef = useRef<string[]>([]);

  useEffect(() => {
    if (!loading) setPhase(error ? 'error' : 'session');
  }, [loading, error]);

  // Prioritized study queue (due → incorrect → difficult → new → reviewed). Falls back
  // to plain set order when the queue cannot be loaded.
  useEffect(() => {
    if (!setId) return;
    let cancelled = false;
    void studyService
      .studyQueue(setId)
      .then((queue) => {
        if (cancelled) return;
        setQueuedCards(
          queue.cards.map((entry) => ({
            id: entry.card.id,
            question: entry.card.question,
            answer: entry.card.answer,
            reason: entry.reason,
          })),
        );
      })
      .catch(() => {
        if (!cancelled) setQueuedCards(null);
      });
    return () => {
      cancelled = true;
    };
  }, [setId]);

  // Server-timed session for signed-in users (study-time stats).
  useEffect(() => {
    if (!user || !setId || phase !== 'session') return;
    let cancelled = false;
    void studyService
      .startSession(setId)
      .then((session) => {
        if (!cancelled) sessionIdRef.current = session.id;
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [user, setId, phase]);

  function retryMistakes() {
    setRetryIds(mistakeIds);
    wrongIdsRef.current = [];
    setMistakeIds([]);
    setSummary(null);
    setPhase('session');
    setRound((value) => value + 1);
  }

  const endSession = useCallback(
    async (result: SessionSummary) => {
      setMistakeIds([...wrongIdsRef.current]);
      setSummary(result);
      setPhase('done');
      const sessionId = sessionIdRef.current;
      if (user && sessionId) {
        sessionIdRef.current = null;
        await studyService
          .endSession(sessionId, result.correct + result.incorrect)
          .catch(() => undefined);
      }
    },
    [user],
  );

  const onReview = useCallback(
    async (cardId: string, result: 'correct' | 'incorrect') => {
      if (result === 'incorrect' && !wrongIdsRef.current.includes(cardId)) {
        wrongIdsRef.current.push(cardId);
      }
      if (user && setId) {
        await studyService.review(setId, cardId, result);
      } else if (setId) {
        guestProgress.record(setId, cardId, result);
      }
    },
    [user, setId],
  );

  if (loading || phase === 'loading') return <LoadingRow large />;
  if (phase === 'error' || !set) {
    return (
      <EmptyState
        title="Study set not found"
        description={error ?? 'This set does not exist or is private.'}
        action={<ButtonLink to="/discover">Browse public sets</ButtonLink>}
      />
    );
  }

  if (phase === 'done' && summary) {
    return (
      <StudyDone
        set={set}
        summary={summary}
        isGuest={!user}
        mistakeCount={mistakeIds.length}
        onRetry={retryMistakes}
      />
    );
  }

  const allCards: SessionCard[] =
    queuedCards ??
    set.cards.map((card) => ({ id: card.id, question: card.question, answer: card.answer }));
  const cards = retryIds ? allCards.filter((card) => retryIds.includes(card.id)) : allCards;

  if (cards.length === 0) {
    return (
      <EmptyState
        title="No cards to study"
        description={
          set.isOwner
            ? 'Add cards to this set before starting a study session.'
            : 'The author has not added cards to this set yet.'
        }
        action={<ButtonLink to={`/sets/${set.id}`}>Back to set</ButtonLink>}
      />
    );
  }

  return (
    <>
      {!user ? (
        <div className="guest-banner">
          <p>Guest session — progress is saved on this device only.</p>
          <ButtonLink to="/signup" size="sm">
            Create an account to save progress
          </ButtonLink>
        </div>
      ) : null}

      {retryIds ? (
        <p className="muted" style={{ textAlign: 'center', fontSize: '0.875rem' }}>
          Retry round — practicing your {retryIds.length} mistake{retryIds.length === 1 ? '' : 's'}.
        </p>
      ) : null}

      <FlashcardSession
        key={`${set.id}:${round}`}
        title={set.title}
        cards={cards}
        onReview={onReview}
        onDone={endSession}
        onQuit={endSession}
      />
    </>
  );
}

function StudyDone({
  set,
  summary,
  isGuest,
  mistakeCount,
  onRetry,
}: {
  set: StudySetDetail;
  summary: SessionSummary;
  isGuest: boolean;
  mistakeCount: number;
  onRetry: () => void;
}) {
  const total = summary.correct + summary.incorrect;
  const accuracy = total > 0 ? Math.round((summary.correct / total) * 100) : 0;
  const { data: today } = useAsync<TodaySummary | null>(
    () => (isGuest ? Promise.resolve(null) : progressService.today()),
    [isGuest],
  );
  return (
    <div className="study-stage" style={{ textAlign: 'center' }}>
      <h1 style={{ fontSize: '1.75rem' }}>Session complete 🎉</h1>
      <p>
        You went through {total} answer{total === 1 ? '' : 's'} — {summary.correct} correct and{' '}
        {summary.incorrect} incorrect on <strong>{set.title}</strong>.
      </p>
      <p style={{ fontSize: '1.5rem', fontWeight: 700, margin: '4px 0 0' }}>
        {accuracy}% flashcard accuracy
      </p>

      {!isGuest && today ? <SessionHabit today={today} /> : null}

      {isGuest ? (
        <div className="guest-banner" style={{ textAlign: 'left' }}>
          <p>
            Nice work! Create a free account to keep this progress, sync it across devices and get
            spaced-repetition reviews.
          </p>
          <ButtonLink to="/signup" size="sm">
            Create free account
          </ButtonLink>
        </div>
      ) : (
        <p className="muted">Your progress is saved and your next reviews are scheduled.</p>
      )}

      <div className="study-controls">
        {mistakeCount > 0 ? (
          <Button onClick={onRetry}>Practice mistakes again ({mistakeCount})</Button>
        ) : null}
        <ButtonLink to={`/sets/${set.id}/quiz`} variant="secondary">
          Take a quiz
        </ButtonLink>
        <ButtonLink to={`/sets/${set.id}`} variant="secondary">
          Back to set
        </ButtonLink>
        <ButtonLink to="/review">Go to review</ButtonLink>
      </div>
      <p className="kbd-hint">
        Tip: <Link to="/discover">discover more public sets</Link>
      </p>
    </div>
  );
}

/** Daily-goal progress, streak and the recommended next step after a session. */
function SessionHabit({ today }: { today: TodaySummary }) {
  const next = nextActionLink(today.continueAction);
  return (
    <div className="card" style={{ textAlign: 'left', margin: '16px 0' }}>
      <div className="subject-row-top" style={{ marginBottom: 6 }}>
        <span style={{ fontWeight: 600 }}>
          {today.completedCards} / {today.target} cards today
        </span>
        <span className="muted" style={{ fontSize: '0.825rem' }}>
          🔥 {today.streak.current} day streak
        </span>
      </div>
      <ProgressBar value={today.completedCards} max={today.target} />
      <div style={{ marginTop: 12 }}>
        <ButtonLink to={next.to} size="sm">
          {next.label}
        </ButtonLink>
      </div>
    </div>
  );
}

import { useCallback, useEffect, useRef, useState } from 'react';
import { useParams } from 'react-router-dom';
import { Button, ButtonLink } from '../../components/ui/Button';
import { EmptyState, LoadingRow } from '../../components/ui/Primitives';
import {
  FlashcardSession,
  type SessionCard,
  type SessionSummary,
} from '../../components/study/FlashcardSession';
import { useAuth } from '../../hooks/useAuth';
import { ApiError } from '../../lib/api';
import { guestProgress } from '../../services/guestProgress';
import { studyService, type PracticeQueue } from '../../services/studyService';

export function PracticePage() {
  const { setId } = useParams<{ setId: string }>();
  const { user } = useAuth();
  const [queue, setQueue] = useState<PracticeQueue | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [summary, setSummary] = useState<SessionSummary | null>(null);
  const [mistakeIds, setMistakeIds] = useState<string[]>([]);
  const [retryIds, setRetryIds] = useState<string[] | null>(null);
  const [round, setRound] = useState(0);
  const sessionIdRef = useRef<string | null>(null);
  const wrongIdsRef = useRef<string[]>([]);

  useEffect(() => {
    if (!setId) return;
    let cancelled = false;
    setLoading(true);
    studyService
      .practiceQueue(setId)
      .then((result) => {
        if (!cancelled) {
          setQueue(result);
          setLoading(false);
        }
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setError(err instanceof ApiError ? err.message : 'Could not load practice cards');
          setLoading(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [setId]);

  useEffect(() => {
    if (!user || !setId) return;
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
  }, [user, setId]);

  const onReview = useCallback(
    async (cardId: string, result: 'correct' | 'incorrect') => {
      if (result === 'incorrect' && !wrongIdsRef.current.includes(cardId)) {
        wrongIdsRef.current.push(cardId);
      }
      if (user && setId) await studyService.review(setId, cardId, result);
      else if (setId) guestProgress.record(setId, cardId, result);
    },
    [user, setId],
  );

  const onDone = useCallback(
    async (result: SessionSummary) => {
      setMistakeIds([...wrongIdsRef.current]);
      setSummary(result);
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

  // Restart the session with only the cards answered incorrectly. Works for
  // signed-in users and guests; each retry round tracks its own mistakes.
  function retryMistakes() {
    setRetryIds(mistakeIds);
    wrongIdsRef.current = [];
    setMistakeIds([]);
    setSummary(null);
    setRound((value) => value + 1);
  }

  if (loading) return <LoadingRow large />;
  if (error || !queue) {
    return (
      <EmptyState
        title="Could not start practice"
        description={error ?? 'This set does not exist or is private.'}
        action={<ButtonLink to="/discover">Browse public sets</ButtonLink>}
      />
    );
  }

  const entries = retryIds
    ? queue.cards.filter((entry) => retryIds.includes(entry.card.id))
    : queue.cards;
  const cards: SessionCard[] = entries.map((entry) => ({
    id: entry.card.id,
    question: entry.card.question,
    answer: entry.card.answer,
    reason: entry.reason,
  }));

  if (summary) {
    const total = summary.correct + summary.incorrect;
    const accuracy = total > 0 ? Math.round((summary.correct / total) * 100) : 0;
    return (
      <div className="study-stage" style={{ textAlign: 'center' }}>
        <h1 style={{ fontSize: '1.75rem' }}>Practice complete ⚡</h1>
        <p>
          {total} answers — {summary.correct} correct, {summary.incorrect} incorrect.
        </p>
        <p style={{ fontSize: '1.5rem', fontWeight: 700, margin: '4px 0 0' }}>
          {accuracy}% flashcard accuracy
        </p>
        {!user ? (
          <div className="guest-banner" style={{ textAlign: 'left' }}>
            <p>Create an account to keep this progress and get scheduled reviews.</p>
            <ButtonLink to="/signup" size="sm">
              Create free account
            </ButtonLink>
          </div>
        ) : null}
        <div className="study-controls">
          {mistakeIds.length > 0 ? (
            <Button onClick={retryMistakes}>
              Practice mistakes again ({mistakeIds.length})
            </Button>
          ) : null}
          <ButtonLink to={`/sets/${queue.setId}/quiz`} variant="secondary">
            Take a quiz
          </ButtonLink>
          <ButtonLink to={`/sets/${queue.setId}`} variant="secondary">
            Back to set
          </ButtonLink>
          <ButtonLink to="/dashboard">Dashboard</ButtonLink>
        </div>
      </div>
    );
  }

  if (cards.length === 0) {
    return (
      <EmptyState
        title="Nothing to practice"
        description="This set has no cards yet."
        action={<ButtonLink to={`/sets/${queue.setId}`}>Back to set</ButtonLink>}
      />
    );
  }

  return (
    <>
      {!user ? (
        <div className="guest-banner">
          <p>Guest practice — progress is saved on this device only.</p>
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
        key={`${queue.setId}:${round}`}
        title={`Practice · ${queue.title}`}
        cards={cards}
        onReview={onReview}
        onDone={onDone}
        onQuit={onDone}
      />
    </>
  );
}

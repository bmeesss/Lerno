import { useCallback, useEffect, useRef, useState } from 'react';
import { useParams } from 'react-router-dom';
import { ButtonLink } from '../../components/ui/Button';
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
  const sessionIdRef = useRef<string | null>(null);

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
      if (user && setId) await studyService.review(setId, cardId, result);
      else if (setId) guestProgress.record(setId, cardId, result);
    },
    [user, setId],
  );

  const onDone = useCallback(
    async (result: SessionSummary) => {
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

  const cards: SessionCard[] = queue.cards.map((entry) => ({
    id: entry.card.id,
    question: entry.card.question,
    answer: entry.card.answer,
    reason: entry.reason,
  }));

  if (summary) {
    return (
      <div className="study-stage" style={{ textAlign: 'center' }}>
        <h1 style={{ fontSize: '1.75rem' }}>Practice complete ⚡</h1>
        <p>
          {summary.correct + summary.incorrect} answers — {summary.correct} correct,{' '}
          {summary.incorrect} incorrect.
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
      <FlashcardSession
        key={queue.setId}
        title={`Practice · ${queue.title}`}
        cards={cards}
        onReview={onReview}
        onDone={onDone}
        onQuit={onDone}
      />
    </>
  );
}

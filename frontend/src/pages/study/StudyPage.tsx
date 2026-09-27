import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { ButtonLink } from '../../components/ui/Button';
import { EmptyState, LoadingRow } from '../../components/ui/Primitives';
import { FlashcardSession, type SessionSummary } from '../../components/study/FlashcardSession';
import { useAsync } from '../../hooks/useAsync';
import { useAuth } from '../../hooks/useAuth';
import { guestProgress } from '../../services/guestProgress';
import { studyService } from '../../services/studyService';
import { studySetService } from '../../services/studySetService';
import type { StudySetDetail } from '../../types';

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
  const sessionIdRef = useRef<string | null>(null);

  useEffect(() => {
    if (!loading) setPhase(error ? 'error' : 'session');
  }, [loading, error]);

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

  const endSession = useCallback(
    async (result: SessionSummary) => {
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
    return <StudyDone set={set} summary={summary} isGuest={!user} />;
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

      <FlashcardSession
        key={set.id}
        title={set.title}
        cards={set.cards.map((card) => ({
          id: card.id,
          question: card.question,
          answer: card.answer,
        }))}
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
}: {
  set: StudySetDetail;
  summary: SessionSummary;
  isGuest: boolean;
}) {
  return (
    <div className="study-stage" style={{ textAlign: 'center' }}>
      <h1 style={{ fontSize: '1.75rem' }}>Session complete 🎉</h1>
      <p>
        You went through {summary.correct + summary.incorrect} answers — {summary.correct} correct
        and {summary.incorrect} incorrect on <strong>{set.title}</strong>.
      </p>

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

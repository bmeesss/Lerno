import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { Button, ButtonLink } from '../../components/ui/Button';
import { Modal } from '../../components/ui/Modal';
import { EmptyState, LoadingRow, ProgressBar } from '../../components/ui/Primitives';
import { LearnItem } from '../../components/study-session/LearnItem';
import { MistakesReview } from '../../components/study-session/MistakesReview';
import { PracticeItem } from '../../components/study-session/PracticeItem';
import { PracticeResults, TestResults } from '../../components/study-session/SessionResults';
import { SessionError } from '../../components/study-session/SessionCtaBar';
import { TestRunner } from '../../components/study-session/TestRunner';
import { ApiError } from '../../lib/api';
import { studySessionService } from '../../services/studySessionService';
import type { LearningSession, SelfRating, SessionItemResponse } from '../../types';

function errorText(error: unknown, fallback: string): string {
  return error instanceof ApiError ? error.message : fallback;
}

/** The first item after `from` that still needs an answer (then from the start). */
function nextOpenIndex(items: LearningSession['items'], from: number): number {
  const after = items.findIndex((item, index) => index > from && item.status === 'pending');
  if (after >= 0) return after;
  return items.findIndex((item) => item.status === 'pending');
}

function positionText(session: LearningSession, index: number): string {
  const noun = session.type === 'learn' ? 'Concept' : 'Question';
  return `${noun} ${Math.min(index + 1, session.itemCount)} of ${session.itemCount}`;
}

/**
 * The session runner: Learn, Practice, Review and Test on one page. Everything
 * that matters lives on the server (items, answers, progress, result), so a
 * reload, a second tab or another device continues exactly where the student was.
 */
export function StudySessionPage() {
  const { sessionId = '' } = useParams<{ sessionId: string }>();
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const [session, setSession] = useState<LearningSession | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [viewIndex, setViewIndex] = useState(0);
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [finishing, setFinishing] = useState(false);
  const [leaveOpen, setLeaveOpen] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const loaded = await studySessionService.get(sessionId);
      setSession(loaded);
      const open = nextOpenIndex(loaded.items, -1);
      const running = loaded.status === 'active' || loaded.status === 'not_started';
      const last = Math.max(0, loaded.items.length - 1);
      setViewIndex(
        !running
          ? 0
          : loaded.type === 'test'
            ? // A test is answered in any order: continue where the student stopped, not at the first blank.
              Math.min(Math.max(0, loaded.currentPosition), last)
            : open >= 0
              ? open
              : last,
      );
    } catch (error) {
      setLoadError(errorText(error, 'Could not load this session.'));
    } finally {
      setLoading(false);
    }
  }, [sessionId]);

  useEffect(() => {
    void load();
  }, [load]);

  /** Merges the server's answer for one item into the session and returns the new state. */
  function applyResponse(current: LearningSession, response: SessionItemResponse): LearningSession {
    const updated: LearningSession = {
      ...current,
      status: response.session.status,
      answeredCount: response.session.answeredCount,
      currentPosition: response.session.currentPosition,
      durationSeconds: response.session.durationSeconds,
      progress: response.progress,
      items: current.items.map((item) => (item.id === response.item.id ? response.item : item)),
    };
    setSession(updated);
    return updated;
  }

  async function finish(current: LearningSession | null = session) {
    if (!current) return;
    setFinishing(true);
    setActionError(null);
    try {
      if (current.answeredCount === 0) {
        // Everything was skipped: there is no result to show, so the session simply ends.
        await studySessionService.abandon(current.id);
        navigate(`/study-packs/${current.packId}`);
        return;
      }
      setSession(await studySessionService.complete(current.id));
    } catch (error) {
      setActionError(errorText(error, 'Could not finish the session. Your progress is saved — try again.'));
    } finally {
      setFinishing(false);
    }
  }

  function advance(current: LearningSession, from: number) {
    const next = nextOpenIndex(current.items, from);
    if (next < 0) {
      void finish(current);
      return;
    }
    setViewIndex(next);
  }

  async function check(answer: string, responseTimeMs: number) {
    const item = session?.items[viewIndex];
    if (!session || !item || busy) return;
    setBusy(true);
    setActionError(null);
    try {
      applyResponse(session, await studySessionService.answer(session.id, item.id, answer, responseTimeMs));
    } catch (error) {
      setActionError(errorText(error, 'Could not check this answer. Nothing is lost — try again.'));
    } finally {
      setBusy(false);
    }
  }

  async function skip() {
    const item = session?.items[viewIndex];
    if (!session || !item || busy) return;
    setBusy(true);
    setActionError(null);
    try {
      const response = await studySessionService.skip(session.id, item.id);
      advance(applyResponse(session, response), viewIndex);
    } catch (error) {
      setActionError(errorText(error, 'Could not skip this question. Try again.'));
    } finally {
      setBusy(false);
    }
  }

  async function rate(rating: SelfRating, responseTimeMs: number) {
    const item = session?.items[viewIndex];
    if (!session || !item || busy) return;
    setBusy(true);
    setActionError(null);
    try {
      const response = await studySessionService.rate(session.id, item.id, rating, responseTimeMs);
      advance(applyResponse(session, response), viewIndex);
    } catch (error) {
      setActionError(errorText(error, 'Could not save your rating. Try again.'));
    } finally {
      setBusy(false);
    }
  }

  async function finishTest(answers: { itemId: string; answer: string }[]) {
    if (!session) return;
    setFinishing(true);
    setActionError(null);
    try {
      setSession(await studySessionService.complete(session.id, answers));
    } catch (error) {
      setActionError(errorText(error, 'Could not hand in your test. Your answers are still here — try again.'));
    } finally {
      setFinishing(false);
    }
  }

  async function endSession() {
    if (!session) return;
    setLeaveOpen(false);
    if (session.type !== 'test' && session.answeredCount > 0) {
      await finish(session);
      return;
    }
    try {
      await studySessionService.abandon(session.id);
      navigate(`/study-packs/${session.packId}`);
    } catch (error) {
      setActionError(errorText(error, 'Could not end the session. Try again.'));
    }
  }

  if (loading && !session) return <LoadingRow large />;

  if (loadError || !session) {
    return (
      <EmptyState
        title="Could not open this session"
        description={loadError ?? 'It may not exist any more.'}
        action={
          <div className="session-empty-actions">
            <Button onClick={() => void load()}>Try again</Button>
            <ButtonLink to="/study" variant="secondary">
              Back to My Study
            </ButtonLink>
          </div>
        }
      />
    );
  }

  if (session.status === 'abandoned') {
    return (
      <EmptyState
        title="This session was ended"
        description="What you answered before leaving is kept. Start a new session whenever you like."
        action={
          <div className="session-empty-actions">
            <ButtonLink to={`/study-packs/${session.packId}?tab=${session.type === 'review' ? 'practice' : session.type}`}>
              Start again
            </ButtonLink>
            <ButtonLink to="/study" variant="secondary">
              Back to My Study
            </ButtonLink>
          </div>
        }
      />
    );
  }

  if (session.status === 'completed' && session.result) {
    if (searchParams.get('view') === 'mistakes') {
      return (
        <div className="session-page">
          <MistakesReview
            sessionId={session.id}
            packId={session.packId}
            tutorAvailable={session.isOwner}
            backTo={`/study/sessions/${session.id}`}
          />
        </div>
      );
    }
    return (
      <div className="session-page">
        {session.type === 'test' ? (
          <TestResults session={session} result={session.result} />
        ) : (
          <PracticeResults session={session} result={session.result} />
        )}
      </div>
    );
  }

  const item = session.items[viewIndex];
  const isLastQuestion = nextOpenIndex(session.items, viewIndex) < 0;

  return (
    <div className="session-page">
      <header className="session-header">
        <div>
          <span className="eyebrow-label">{session.label}</span>
          <p className="session-position" aria-live="polite">
            {positionText(session, viewIndex)}
          </p>
        </div>
        <Button variant="ghost" size="sm" onClick={() => setLeaveOpen(true)}>
          Leave
        </Button>
      </header>
      <ProgressBar value={session.progress.answered + session.progress.skipped} max={Math.max(1, session.itemCount)} />

      {session.type === 'test' ? (
        <TestRunner
          session={session}
          finishing={finishing}
          finishError={actionError}
          onFinish={(answers) => void finishTest(answers)}
          onPositionChange={(position) => setViewIndex(position)}
        />
      ) : item && session.type === 'learn' ? (
        <LearnItem
          key={item.id}
          session={session}
          item={item}
          busy={busy || finishing}
          error={actionError}
          onCheck={(answer, ms) => void check(answer, ms)}
          onRate={(rating, ms) => void rate(rating, ms)}
        />
      ) : item ? (
        <PracticeItem
          key={item.id}
          session={session}
          item={item}
          busy={busy || finishing}
          error={actionError}
          isLast={isLastQuestion}
          onCheck={(answer, ms) => void check(answer, ms)}
          onSkip={() => void skip()}
          onNext={() => advance(session, viewIndex)}
        />
      ) : (
        <SessionError message="This session has nothing left to do." onRetry={() => void finish(session)} retryLabel="See results" />
      )}

      {session.type !== 'test' && finishing ? (
        <p className="muted" role="status">
          Wrapping up your session…
        </p>
      ) : null}

      <Modal
        open={leaveOpen}
        title="Leave this session?"
        onClose={() => setLeaveOpen(false)}
        footer={
          <>
            <Button variant="secondary" onClick={() => setLeaveOpen(false)}>
              Keep going
            </Button>
            {session.type !== 'test' && session.answeredCount > 0 ? (
              <Button variant="secondary" onClick={() => void endSession()}>
                End and see results
              </Button>
            ) : null}
            <Button onClick={() => navigate('/study')}>Leave for now</Button>
          </>
        }
      >
        <p>
          Your progress is saved on your account. You can continue this session from My Study{' '}
          {session.type === 'test' ? '— your test answers stay until you hand it in.' : 'at any time.'}
        </p>
      </Modal>

      <p className="muted session-footer">
        <Link to={`/study-packs/${session.packId}`}>Back to {session.packTitle}</Link>
      </p>
    </div>
  );
}

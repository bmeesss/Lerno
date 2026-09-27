/**
 * Flashcard session UI — question → reveal → correct/incorrect → next card
 * (spec §6). Business outcomes are reported via onReview; scheduling happens
 * in backend services (or guest storage for guests).
 */
import { useCallback, useEffect, useState } from 'react';
import { Button } from '../ui/Button';
import { Badge } from '../ui/Primitives';
import { useToast } from '../ui/Toast';

export interface SessionCard {
  id: string;
  question: string;
  answer: string;
  reason?: 'due' | 'incorrect' | 'difficult' | 'new' | 'reviewed';
}

export interface SessionSummary {
  total: number;
  correct: number;
  incorrect: number;
}

interface Props {
  cards: SessionCard[];
  onReview: (cardId: string, result: 'correct' | 'incorrect') => Promise<void> | void;
  onDone: (summary: SessionSummary) => void;
  title?: string;
  /** Optional early exit (session summary is shown by the parent). */
  onQuit?: (summary: SessionSummary) => void;
}

const REASON_LABEL: Record<NonNullable<SessionCard['reason']>, string> = {
  due: 'Due for review',
  incorrect: 'Previously incorrect',
  difficult: 'Difficult card',
  new: 'New card',
  reviewed: 'Studied before',
};

export function FlashcardSession({ cards, onReview, onDone, title, onQuit }: Props) {
  const toast = useToast();
  const [queue, setQueue] = useState<SessionCard[]>(cards);
  const [revealed, setRevealed] = useState(false);
  const [correct, setCorrect] = useState(0);
  const [incorrect, setIncorrect] = useState(0);
  const [busy, setBusy] = useState(false);

  const current = queue[0] ?? null;
  const seen = correct + incorrect;

  const mark = useCallback(
    async (result: 'correct' | 'incorrect') => {
      if (!current || busy) return;
      setBusy(true);
      try {
        await onReview(current.id, result);
        if (result === 'correct') setCorrect((value) => value + 1);
        else setIncorrect((value) => value + 1);

        setQueue((existing) => {
          const rest = existing.slice(1);
          // Incorrect answers rejoin the session queue (spec §7).
          return result === 'incorrect' ? [...rest, current] : rest;
        });
        setRevealed(false);
      } catch {
        toast.show('Could not save this answer. Check your connection.', 'error');
      } finally {
        setBusy(false);
      }
    },
    [current, busy, onReview, toast],
  );

  // Finish when the queue empties.
  useEffect(() => {
    if (queue.length === 0 && seen > 0) {
      onDone({ total: seen, correct, incorrect });
    }
  }, [queue.length, seen, correct, incorrect, onDone]);

  // Keyboard controls (desktop): Space = flip, ←/1 = incorrect, →/2 = correct.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target && ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName)) return;
      if (event.key === ' ' || event.key === 'ArrowUp' || event.key === 'ArrowDown') {
        event.preventDefault();
        setRevealed((value) => !value);
      } else if (event.key === '1' || event.key === 'ArrowLeft') {
        if (revealed) void mark('incorrect');
      } else if (event.key === '2' || event.key === 'Enter' || event.key === 'ArrowRight') {
        if (revealed) void mark('correct');
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [mark, revealed]);

  if (!current) return null;

  const total = queue.length + seen;

  return (
    <div className="study-stage">
      {title ? <h2 style={{ textAlign: 'center', fontSize: '1.1rem' }}>{title}</h2> : null}

      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          gap: 12,
        }}
      >
        <span className="muted" style={{ fontSize: '0.875rem' }}>
          Card {Math.min(seen + 1, total)} of {total}
        </span>
        {current.reason ? <Badge variant="accent">{REASON_LABEL[current.reason]}</Badge> : null}
        <span className="muted" style={{ fontSize: '0.875rem' }}>
          ✓ {correct} · ✗ {incorrect}
        </span>
      </div>

      <div
        className="flashcard"
        role="button"
        tabIndex={0}
        onClick={() => setRevealed((value) => !value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') setRevealed((value) => !value);
        }}
        aria-label={revealed ? 'Flashcard answer' : 'Flashcard question'}
      >
        <span className="fc-side">{revealed ? 'Answer' : 'Question'}</span>
        <p className="fc-text">{revealed ? current.answer : current.question}</p>
        {!revealed ? <span className="fc-hint">Tap the card or press Space to reveal</span> : null}
      </div>

      {revealed ? (
        <div className="study-controls">
          <Button variant="danger" size="lg" disabled={busy} onClick={() => void mark('incorrect')}>
            Incorrect
          </Button>
          <Button size="lg" disabled={busy} onClick={() => void mark('correct')}>
            Correct
          </Button>
        </div>
      ) : (
        <div className="study-controls">
          <Button variant="secondary" size="lg" onClick={() => setRevealed(true)}>
            Show answer
          </Button>
        </div>
      )}

      <p className="kbd-hint">
        <kbd>Space</kbd> flip · <kbd>←</kbd>/<kbd>1</kbd> incorrect · <kbd>→</kbd>/<kbd>2</kbd>{' '}
        correct
      </p>

      {onQuit ? (
        <div style={{ textAlign: 'center' }}>
          <Button variant="ghost" onClick={() => onQuit({ total: seen, correct, incorrect })}>
            End session
          </Button>
        </div>
      ) : null}
    </div>
  );
}

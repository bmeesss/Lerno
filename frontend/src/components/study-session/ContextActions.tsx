import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Button } from '../ui/Button';
import { ApiError } from '../../lib/api';
import { studySessionService } from '../../services/studySessionService';
import type { ConceptSourceView } from '../../types';
import { TutorDrawer } from './TutorDrawer';

/**
 * Small, contextual help next to what the student is looking at:
 * Ask AI Tutor · Explain this · Show source · Practice this.
 * The tutor actions are hidden when the tutor is not available (a shared pack
 * the student does not own, a running test).
 */
export function ContextActions({
  packId,
  sessionId,
  itemId,
  conceptId,
  conceptName,
  tutorAvailable,
  showPractice = true,
}: {
  packId: string;
  sessionId?: string;
  itemId?: string;
  conceptId: string | null;
  conceptName: string | null;
  tutorAvailable: boolean;
  showPractice?: boolean;
}) {
  const [tutor, setTutor] = useState<{ message?: string } | null>(null);
  const [sourceOpen, setSourceOpen] = useState(false);
  const [source, setSource] = useState<ConceptSourceView | null>(null);
  const [sourceError, setSourceError] = useState<string | null>(null);
  const [sourceLoading, setSourceLoading] = useState(false);

  if (!conceptId) return null;

  async function loadSource() {
    if (sourceLoading || !conceptId) return;
    setSourceLoading(true);
    setSourceError(null);
    try {
      setSource(await studySessionService.conceptSource(packId, conceptId));
    } catch (error) {
      setSourceError(error instanceof ApiError ? error.message : 'Could not load the source');
    } finally {
      setSourceLoading(false);
    }
  }

  function toggleSource() {
    const next = !sourceOpen;
    setSourceOpen(next);
    if (next && !source) void loadSource();
  }

  return (
    <div className="context-actions">
      <div className="context-actions-row" role="group" aria-label="Help with this concept">
        {tutorAvailable ? (
          <>
            <Button variant="ghost" size="sm" onClick={() => setTutor({})}>
              Ask AI Tutor
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setTutor({ message: `Explain ${conceptName ?? 'this'} in simple words.` })}
            >
              Explain this
            </Button>
          </>
        ) : null}
        <Button variant="ghost" size="sm" aria-expanded={sourceOpen} onClick={toggleSource}>
          Show source
        </Button>
        {showPractice ? (
          <Link className="btn btn-ghost btn-sm" to={`/study-packs/${packId}?tab=practice&concept=${conceptId}`}>
            Practice this
          </Link>
        ) : null}
      </div>

      {sourceOpen ? (
        <div className="context-source" role="region" aria-label="Source" aria-live="polite">
          {sourceLoading ? <p className="muted">Looking up the source…</p> : null}
          {sourceError ? (
            <p role="alert">
              {sourceError}{' '}
              <button type="button" className="link-button" onClick={() => void loadSource()}>
                Try again
              </button>
            </p>
          ) : null}
          {source && !source.excerpt ? <p className="muted">No source is linked to this concept yet.</p> : null}
          {source?.excerpt && source.source ? (
            <>
              <p className="context-source-title">
                {source.source.title}
                {source.excerpt.ref ? ` · ${source.excerpt.ref}` : ''}
              </p>
              <blockquote>{source.excerpt.text}</blockquote>
            </>
          ) : null}
        </div>
      ) : null}

      {tutor ? (
        <TutorDrawer
          open
          onClose={() => setTutor(null)}
          packId={packId}
          context={{ conceptId: conceptId, sessionId, itemId }}
          conceptName={conceptName}
          initialMessage={tutor.message}
        />
      ) : null}
    </div>
  );
}

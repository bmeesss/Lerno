import { Link } from 'react-router-dom';
import { ButtonLink } from '../ui/Button';
import { IconArrowRight, IconCheck, IconSparkles } from '../ui/Icons';
import type { ImportProcessingStatus } from '../../types';

/**
 * "Your Study Pack is ready" — the honest end of an import.
 *
 * Every number comes from the pack itself (the same counts the backend reports),
 * and the study time is the transparent, rule-based estimate the server
 * computed. The primary action hands the student straight to the adaptive
 * engine; reviewing the material stays one click away.
 */
export function PackReadySummary({
  packId,
  status,
  onReviewMaterial,
}: {
  packId: string;
  status: ImportProcessingStatus;
  onReviewMaterial?: () => void;
}) {
  const counts = status.counts;
  const studyTime = status.estimatedStudyTimeLabel ?? estimateLabel(status);
  const partial = status.status === 'partial' || status.aiSkipped;

  return (
    <section className="card pack-ready" aria-live="polite">
      <span className="eyebrow-label">
        <IconCheck size={14} /> Study Pack
      </span>
      <h2>Your Study Pack is ready</h2>
      <p className="muted">
        {partial
          ? 'Your material is saved and organized. AI generation can run again whenever you want it — nothing you already had was touched.'
          : 'Everything below was generated from your own material, and you can still edit or regenerate any of it.'}
      </p>

      <div className="pack-ready-stats">
        <div className="pack-ready-stat">
          <strong>{counts.sources}</strong>
          <span>source{counts.sources === 1 ? '' : 's'}</span>
        </div>
        <div className="pack-ready-stat">
          <strong>{counts.concepts}</strong>
          <span>concept{counts.concepts === 1 ? '' : 's'}</span>
        </div>
        <div className="pack-ready-stat">
          <strong>{counts.flashcards}</strong>
          <span>flashcard{counts.flashcards === 1 ? '' : 's'}</span>
        </div>
        <div className="pack-ready-stat">
          <strong>{counts.practiceQuestions}</strong>
          <span>question{counts.practiceQuestions === 1 ? '' : 's'}</span>
        </div>
      </div>

      {studyTime ? (
        <p className="pack-ready-time">
          <IconSparkles size={15} /> Estimated study time: <strong>{studyTime}</strong>
          <span className="muted">
            {' '}
            — based on the number of concepts, cards and questions, and the length of your material.
          </span>
        </p>
      ) : null}

      {counts.hasAnalysis ? (
        <p className="muted">
          Lerno analyzed your material and keeps using that same analysis for every question and
          card you generate later.
        </p>
      ) : null}

      <div className="pack-ready-actions">
        <ButtonLink to={`/study-packs/${packId}?tab=learn`}>
          Start Learning <IconArrowRight size={15} />
        </ButtonLink>
        {onReviewMaterial ? (
          <button type="button" className="import-link" onClick={onReviewMaterial}>
            Review material
          </button>
        ) : (
          <Link className="import-link" to={`/study-packs/${packId}?tab=overview`}>
            Review material
          </Link>
        )}
      </div>
    </section>
  );
}

/** Fallback only when the server did not send a label (should not happen). */
function estimateLabel(status: ImportProcessingStatus): string | null {
  if (status.estimatedMinutes === null) return null;
  const minutes = status.estimatedMinutes;
  if (minutes < 60) return `~${minutes} min`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest === 0 ? `~${hours} u` : `~${hours} u ${rest} min`;
}

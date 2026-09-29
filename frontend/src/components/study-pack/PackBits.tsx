import type { ReactNode } from 'react';
import { Badge } from '../ui/Primitives';
import type { PackSourceKind, PackSourceStatus } from '../../types';

/** Small, calm building blocks shared by the Study Pack views. */

export function masteryLabel(percent: number, attempts = 1): string {
  if (attempts === 0) return 'New';
  if (percent < 30) return 'Weak';
  if (percent < 60) return 'Learning';
  if (percent < 85) return 'Familiar';
  return 'Mastered';
}

export function MasteryMeter({
  percent,
  label,
  compact,
}: {
  percent: number;
  label?: string;
  compact?: boolean;
}) {
  return (
    <div className={`mastery-meter${compact ? ' mastery-meter-compact' : ''}`}>
      {label ? <span className="mastery-meter-label">{label}</span> : null}
      <div
        className="progress-track"
        role="progressbar"
        aria-label={label ? `${label} mastery` : 'Concept mastery'}
        aria-valuenow={Math.round(percent)}
        aria-valuemin={0}
        aria-valuemax={100}
      >
        <div className="progress-fill" style={{ width: `${Math.min(100, Math.max(0, percent))}%` }} />
      </div>
      <span className="mastery-meter-value">{Math.round(percent)}%</span>
    </div>
  );
}

const SOURCE_KIND_LABEL: Record<PackSourceKind, string> = {
  text: 'Notes',
  pdf: 'PDF',
  set: 'Lerno set',
  powerpoint: 'PowerPoint',
  youtube: 'YouTube',
  image: 'Image',
  audio: 'Audio',
};

export function sourceKindLabel(kind: PackSourceKind): string {
  return SOURCE_KIND_LABEL[kind] ?? kind;
}

const SOURCE_STATUS_LABEL: Record<PackSourceStatus, string> = {
  uploading: 'Uploading',
  processing: 'Processing',
  ready: 'Ready',
  failed: 'Failed',
};

export function SourceStatusBadge({ status }: { status: PackSourceStatus }) {
  if (status === 'ready') return <Badge variant="accent">{SOURCE_STATUS_LABEL.ready}</Badge>;
  if (status === 'failed') return <Badge variant="danger">{SOURCE_STATUS_LABEL.failed}</Badge>;
  if (status === 'processing') return <Badge variant="warning">{SOURCE_STATUS_LABEL.processing}</Badge>;
  return <Badge>{SOURCE_STATUS_LABEL.uploading}</Badge>;
}

/** Human-readable size of an imported source. */
export function sourceSizeLabel(source: {
  kind: PackSourceKind;
  characterCount: number;
  pageCount: number | null;
  legacySetId: string | null;
}): string {
  if (source.kind === 'set') return 'Cards imported';
  if (source.kind === 'pdf' && source.pageCount) {
    return `${source.pageCount} page${source.pageCount === 1 ? '' : 's'}`;
  }
  if (source.characterCount >= 1000) {
    return `${(source.characterCount / 1000).toFixed(1)}k characters`;
  }
  return `${source.characterCount} characters`;
}

export function VerdictPill({ verdict }: { verdict: 'correct' | 'partial' | 'incorrect' }) {
  if (verdict === 'correct') return <Badge variant="accent">Correct</Badge>;
  if (verdict === 'partial') return <Badge variant="warning">Almost</Badge>;
  return <Badge variant="danger">Incorrect</Badge>;
}

export function PackStat({ label, value, sub }: { label: string; value: ReactNode; sub?: string }) {
  return (
    <div className="pack-stat">
      <span className="pack-stat-value">{value}</span>
      <span className="pack-stat-label">{label}</span>
      {sub ? <span className="pack-stat-sub">{sub}</span> : null}
    </div>
  );
}

export function formatActivity(iso: string | null): string {
  if (!iso) return 'No activity yet';
  const parsed = Date.parse(iso);
  if (Number.isNaN(parsed)) return 'No activity yet';
  const days = Math.floor((Date.now() - parsed) / 86_400_000);
  if (days <= 0) return 'Active today';
  if (days === 1) return 'Active yesterday';
  if (days < 7) return `Active ${days} days ago`;
  return `Last activity ${new Date(parsed).toLocaleDateString()}`;
}

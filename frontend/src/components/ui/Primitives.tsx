import type { ReactNode } from 'react';
import { IconBook } from './Icons';

export function Spinner({ large }: { large?: boolean }) {
  return (
    <div className={large ? 'spinner spinner-lg' : 'spinner'} role="status" aria-label="Loading" />
  );
}

/**
 * A spinner for inside buttons and sentences: a `<span>` (valid inside `<p>`,
 * `<span>` and `<button>`) that is hidden from assistive technology, because the
 * surrounding text ("Saving…", "Checking…") already says what is happening.
 */
export function InlineSpinner() {
  return <span className="spinner spinner-inline" aria-hidden="true" />;
}

/** Layout-shaped placeholders, announced once rather than as six loading cards. */
export function LoadingRow({ large }: { large?: boolean }) {
  return (
    <div
      className={`skeleton-layout${large ? ' skeleton-layout-large' : ''}`}
      role="status"
      aria-label="Loading"
    >
      <span className="visually-hidden">Loading content</span>
      <div className="skeleton-heading" aria-hidden="true">
        <span className="skeleton skeleton-title" />
        <span className="skeleton skeleton-copy" />
      </div>
      <div className="skeleton-grid" aria-hidden="true">
        {Array.from({ length: large ? 6 : 3 }, (_, index) => (
          <div className="card skeleton-card" key={index}>
            <span className="skeleton skeleton-icon" />
            <span className="skeleton skeleton-title" />
            <span className="skeleton skeleton-copy" />
            <span className="skeleton skeleton-copy" />
          </div>
        ))}
      </div>
    </div>
  );
}

export function EmptyState({
  title,
  description,
  action,
  icon,
}: {
  title: string;
  description: string;
  action?: ReactNode;
  /** Optional icon shown in a soft accent circle (from the Icons set). */
  icon?: ReactNode;
}) {
  return (
    <div className="empty-state">
      <span className="empty-state-icon">{icon ?? <IconBook size={24} />}</span>
      <h3>{title}</h3>
      <p>{description}</p>
      {action}
    </div>
  );
}

export function ProgressBar({ value, max = 100 }: { value: number; max?: number }) {
  const pct = max > 0 ? Math.min(100, Math.round((value / max) * 100)) : 0;
  return (
    <div
      className="progress-track"
      role="progressbar"
      aria-label="Learning progress"
      aria-valuenow={pct}
      aria-valuemin={0}
      aria-valuemax={100}
    >
      <div className="progress-fill" style={{ width: `${pct}%` }} />
    </div>
  );
}

export function Badge({
  children,
  variant = 'default',
}: {
  children: ReactNode;
  variant?: 'default' | 'accent' | 'danger' | 'warning';
}) {
  return (
    <span className={variant === 'default' ? 'badge' : `badge badge-${variant}`}>{children}</span>
  );
}

export function Avatar({ name, large }: { name: string; large?: boolean }) {
  const initials = name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]!.toUpperCase())
    .join('');
  return (
    <span className={large ? 'avatar avatar-lg' : 'avatar'} aria-hidden="true">
      {initials || '?'}
    </span>
  );
}

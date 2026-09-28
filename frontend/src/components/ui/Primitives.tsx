import type { ReactNode } from 'react';

export function Spinner({ large }: { large?: boolean }) {
  return (
    <div className={large ? 'spinner spinner-lg' : 'spinner'} role="status" aria-label="Loading" />
  );
}

export function LoadingRow({ large }: { large?: boolean }) {
  return (
    <div className="loading-row">
      <Spinner large={large} />
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
      {icon ? <span className="empty-state-icon">{icon}</span> : null}
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

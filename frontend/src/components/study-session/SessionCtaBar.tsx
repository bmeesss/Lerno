import type { ReactNode } from 'react';

/**
 * The action area of a session screen. On phones it is fixed to the bottom of
 * the screen (thumb reach, safe-area aware); on larger screens it sits under
 * the card. There is always exactly one primary action inside.
 */
export function SessionCtaBar({ children }: { children: ReactNode }) {
  return (
    <div className="session-cta-bar">
      <div className="session-cta-inner">{children}</div>
    </div>
  );
}

/** An error the student can act on: what happened, and a way to try again. */
export function SessionError({
  message,
  onRetry,
  retryLabel = 'Try again',
}: {
  message: string;
  onRetry?: () => void;
  retryLabel?: string;
}) {
  return (
    <div className="session-error" role="alert">
      <p>{message}</p>
      {onRetry ? (
        <button type="button" className="btn btn-secondary btn-sm" onClick={onRetry}>
          {retryLabel}
        </button>
      ) : null}
    </div>
  );
}

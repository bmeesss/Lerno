/**
 * Modal that shows one AI answer: loading, error (with retry) and the rendered
 * result. Reused by the set actions, card actions and generation previews.
 */
import { Button } from '../ui/Button';
import { Modal } from '../ui/Modal';
import { Spinner } from '../ui/Primitives';
import { IconRefresh, IconSparkles } from '../ui/Icons';
import { MarkdownLite } from './MarkdownLite';
import { ApiError } from '../../lib/api';

export type AiResultState =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'ready'; text: string }
  | { status: 'error'; message: string };

interface AiResultModalProps {
  open: boolean;
  title: string;
  state: AiResultState;
  onClose: () => void;
  onRetry?: () => void;
  /** Optional footer (e.g. "Practice these questions"). */
  footer?: React.ReactNode;
  /** Shown under the heading while loading. */
  hint?: string;
}

export function AiResultModal({
  open,
  title,
  state,
  onClose,
  onRetry,
  footer,
  hint,
}: AiResultModalProps) {
  return (
    <Modal
      open={open}
      title={title}
      onClose={onClose}
      footer={
        <>
          {onRetry && state.status !== 'loading' ? (
            <Button variant="secondary" onClick={onRetry}>
              <IconRefresh size={15} /> Try again
            </Button>
          ) : null}
          <Button variant="ghost" onClick={onClose}>
            Close
          </Button>
          {footer}
        </>
      }
    >
      <div className="ai-result">
        {state.status === 'loading' ? (
          <div className="ai-result-loading">
            <Spinner />
            <p className="muted">{hint ?? 'Lerno AI is reading your set…'}</p>
          </div>
        ) : null}

        {state.status === 'error' ? (
          <div className="form-error" role="alert">
            {state.message}
          </div>
        ) : null}

        {state.status === 'ready' ? (
          <>
            <span className="ai-result-badge">
              <IconSparkles size={13} /> Lerno AI
            </span>
            <MarkdownLite text={state.text} />
          </>
        ) : null}
      </div>
    </Modal>
  );
}

/** Maps any AI failure to a sentence a student can act on. */
export function friendlyAiError(error: unknown): string {
  if (error instanceof ApiError) {
    switch (error.code) {
      case 'RATE_LIMITED':
        return 'You are asking Lerno AI a lot right now. Wait a moment and try again.';
      case 'AI_TIMEOUT':
        return 'Lerno AI took too long to answer. Please try again.';
      case 'AI_UNAVAILABLE':
        return 'The AI is temporarily unavailable. Please try again in a moment.';
      case 'AI_INVALID_CONTENT':
        return 'Lerno AI could not produce a usable answer for this set. Please try again.';
      case 'NOT_FOUND':
        return 'We could not find that set. It may have been removed or made private.';
      case 'UNAUTHORIZED':
        return 'Please log in again to use Lerno AI.';
      case 'VALIDATION_ERROR':
        return error.message;
      case 'NETWORK':
        return 'Could not reach Lerno. Check your connection and try again.';
      default:
        break;
    }
  }
  return 'The AI is temporarily unavailable. Please try again in a moment.';
}

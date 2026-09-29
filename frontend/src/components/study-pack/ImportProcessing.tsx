import { useCallback, useEffect, useRef, useState } from 'react';
import { Button, ButtonLink } from '../ui/Button';
import { IconAlert, IconCheck, IconSparkles } from '../ui/Icons';
import { ApiError } from '../../lib/api';
import { studyPackImportService } from '../../services/studyPackImportService';
import { sourceKindLabel } from './PackBits';
import type { ImportProcessingStatus, ImportSourceStatus, ImportStepState } from '../../types';

const POLL_INTERVAL_MS = 1_200;
/** After this long the student gets a clear message instead of a spinner. */
const MAX_WAIT_MS = 6 * 60 * 1000;

const STEP_STATE_LABEL: Record<ImportStepState, string> = {
  pending: 'Waiting',
  active: 'Working',
  done: 'Done',
  skipped: 'Skipped',
  failed: 'Failed',
};

/** "Retry extraction" / "Retry generation" — the stage the source stopped in. */
function retryLabel(stage: string | null): string {
  if (stage === 'extract' || stage === null) return 'Retry extraction';
  if (stage === 'normalize') return 'Retry reading';
  if (stage === 'analyze' || stage === 'generate' || stage === 'review') return 'Retry generation';
  return 'Try again';
}

const SOURCE_ERROR_HINT: Record<string, string> = {
  image:
    "We couldn't detect enough text in this image. Try a sharper photo, crop out the background, or paste the text instead.",
  audio:
    'We could not transcribe this recording. Lerno never pretends a transcription worked — paste the text instead.',
  youtube: "This video doesn't have usable captions. Paste the transcript instead.",
};

/**
 * The processing screen of an import.
 *
 * It polls the backend and renders exactly what the backend reports: the stage
 * that is running, what already finished and what was skipped. Each source keeps
 * its own lifecycle state so a retry can target the failed stage — a later stage
 * never needs the file again. There is no animation that pretends to be progress,
 * and a failure keeps the Study Pack.
 */
export function ImportProcessing({
  packId,
  initialStatus,
  onFinished,
  onOpenPack,
  inline = false,
}: {
  packId: string;
  initialStatus?: ImportProcessingStatus | null;
  /** Called once processing stopped (ready, partial or failed). */
  onFinished?: (status: ImportProcessingStatus) => void;
  onOpenPack?: () => void;
  /** Inline variant for the pack's own Sources tab (no page-level actions). */
  inline?: boolean;
}) {
  const [status, setStatus] = useState<ImportProcessingStatus | null>(initialStatus ?? null);
  const [error, setError] = useState<string | null>(null);
  const [retrying, setRetrying] = useState<string | null>(null);
  const [transcriptFor, setTranscriptFor] = useState<ImportSourceStatus | null>(null);
  const [transcript, setTranscript] = useState('');
  const [attempt, setAttempt] = useState(0);
  const notifiedRef = useRef(false);
  // The callback lives in a ref so re-renders never restart the polling loop.
  const finishedRef = useRef(onFinished);
  finishedRef.current = onFinished;

  useEffect(() => {
    let cancelled = false;
    let timer: number | undefined;
    const startedAt = Date.now();
    let failures = 0;

    async function poll(): Promise<void> {
      try {
        const next = await studyPackImportService.status(packId);
        if (cancelled) return;
        failures = 0;
        setStatus(next);
        setError(null);
        if (next.processing) {
          if (Date.now() - startedAt > MAX_WAIT_MS) {
            setError(
              'This is taking longer than expected. Your material is saved — open the study pack or try again.',
            );
            return;
          }
          timer = window.setTimeout(() => void poll(), POLL_INTERVAL_MS);
          return;
        }
        if (!notifiedRef.current) {
          notifiedRef.current = true;
          finishedRef.current?.(next);
        }
      } catch (requestError) {
        if (cancelled) return;
        failures += 1;
        // A short network hiccup must not throw the student out of the flow.
        if (failures <= 3) {
          timer = window.setTimeout(() => void poll(), POLL_INTERVAL_MS * failures);
          return;
        }
        setError(
          requestError instanceof ApiError && requestError.status === 0
            ? 'We lost the connection while building your study pack. Your material is saved.'
            : 'We could not check the progress of your study pack.',
        );
      }
    }

    void poll();
    return () => {
      cancelled = true;
      if (timer) window.clearTimeout(timer);
    };
  }, [packId, attempt]);

  const restart = useCallback((sourceId?: string | null, stage?: string | null) => {
    setAttempt((value) => value + 1);
    notifiedRef.current = false;
    return { sourceId, stage };
  }, []);

  const retry = useCallback(
    async (sourceId?: string | null, stage?: string | null) => {
      if (retrying) return;
      setRetrying(sourceId ?? 'all');
      setError(null);
      try {
        // Nothing to target → the generic pipeline retry (keeps its one-argument
        // signature); a failed source retries from its own stage.
        const next =
          sourceId || stage
            ? await studyPackImportService.process(packId, {
                sourceId: sourceId ?? null,
                stage: (stage as 'extract' | null) ?? null,
              })
            : await studyPackImportService.process(packId);
        setStatus(next);
        restart(sourceId, stage);
      } catch (requestError) {
        setError(
          requestError instanceof ApiError
            ? requestError.message
            : 'We could not start again. Your material is saved — try again in a moment.',
        );
      } finally {
        setRetrying(null);
      }
    },
    [packId, restart, retrying],
  );

  /** A failed YouTube source is retried with the transcript the student pastes. */
  const retryYouTube = useCallback(async () => {
    if (!transcriptFor || retrying) return;
    const text = transcript.trim();
    if (text.length < 40) {
      setError('Paste at least a few sentences of the transcript so Lerno can work with it.');
      return;
    }
    setRetrying(transcriptFor.id);
    setError(null);
    try {
      const next = await studyPackImportService.addYouTubeSource(packId, {
        url: transcriptFor.url ?? '',
        transcript: text,
        title: transcriptFor.title,
      });
      setStatus(next);
      setTranscriptFor(null);
      setTranscript('');
      restart(transcriptFor.id, 'extract');
    } catch (requestError) {
      setError(
        requestError instanceof ApiError
          ? requestError.message
          : 'We could not use this transcript. Your study pack is saved.',
      );
    } finally {
      setRetrying(null);
    }
  }, [packId, restart, retrying, transcript, transcriptFor]);

  const steps = status?.steps ?? [];
  const activeStep = steps.find((step) => step.state === 'active');
  const done = Boolean(status && !status.processing);
  const failure = done ? status?.failure ?? null : null;
  const aiUnavailable = done && !status?.aiAvailable;
  const failedSources = (status?.sources ?? []).filter((source) => source.status === 'failed');
  const readyTitle = inline
    ? done
      ? 'Lerno finished working on your material'
      : 'Lerno is working on your material'
    : done
      ? 'Your study pack is ready'
      : 'Processing your material';

  return (
    <section className="card import-processing" aria-live="polite">
      <span className="eyebrow-label">
        {inline ? 'Processing your material' : 'Creating your study pack'}
      </span>
      <h2>{readyTitle}</h2>
      <p className="muted">
        {error ??
          (activeStep
            ? `${activeStep.label}…`
            : status?.processing
              ? 'Getting started…'
              : 'Everything Lerno could find is now part of your pack.')}
      </p>

      {steps.length > 0 ? (
        <ol className="import-steps">
          {steps.map((step) => (
            <li key={step.id} className={`import-step import-step-${step.state}`}>
              <span className="import-step-marker" aria-hidden="true">
                {step.state === 'done' ? (
                  <IconCheck size={15} />
                ) : step.state === 'failed' ? (
                  <IconAlert size={15} />
                ) : (
                  <span className={step.state === 'active' ? 'import-step-dot active' : 'import-step-dot'} />
                )}
              </span>
              <span className="import-step-label">{step.label}</span>
              <span className="import-step-state">{STEP_STATE_LABEL[step.state]}</span>
            </li>
          ))}
        </ol>
      ) : null}

      {(status?.sources ?? []).length > 0 ? (
        <ul className="import-source-list">
          {status!.sources.map((source) => (
            <li key={source.id} className={`import-source import-source-${source.status}`}>
              <div className="import-source-head">
                <strong>{source.title}</strong>
                <span className="muted">
                  {sourceKindLabel(source.kind)}
                  {source.referenceLabel ? ` · ${source.referenceLabel}` : ''}
                </span>
              </div>
              {source.status === 'failed' ? (
                <div className="import-source-failure">
                  <p>
                    {source.failureReason ??
                      SOURCE_ERROR_HINT[source.kind] ??
                      "We couldn't process this source."}
                  </p>
                  {source.kind === 'youtube' ? (
                    <Button
                      size="sm"
                      variant="secondary"
                      type="button"
                      onClick={() => {
                        setTranscript('');
                        setTranscriptFor(source);
                      }}
                    >
                      Paste the transcript
                    </Button>
                  ) : (
                    <Button
                      size="sm"
                      variant="secondary"
                      type="button"
                      onClick={() => void retry(source.id, source.stage)}
                      disabled={retrying !== null}
                    >
                      {retrying === source.id ? 'Starting…' : retryLabel(source.stage)}
                    </Button>
                  )}
                </div>
              ) : source.status === 'processing' || source.status === 'pending' ? (
                <span className="muted">Lerno is working on this source…</span>
              ) : (
                <span className="muted">Ready to study from</span>
              )}
            </li>
          ))}
        </ul>
      ) : null}

      {transcriptFor ? (
        <div className="import-transcript">
          <label className="field">
            <span>
              Paste the transcript of “{transcriptFor.title}” — you can copy it from YouTube's own
              transcript panel.
            </span>
            <textarea
              className="textarea"
              rows={6}
              value={transcript}
              maxLength={50_000}
              placeholder="Paste the transcript here…"
              onChange={(event) => setTranscript(event.target.value)}
            />
          </label>
          <div className="import-processing-actions">
            <Button type="button" onClick={() => void retryYouTube()} disabled={retrying !== null}>
              {retrying === transcriptFor.id ? 'Reading…' : 'Use this transcript'}
            </Button>
            <Button variant="ghost" type="button" onClick={() => setTranscriptFor(null)}>
              Cancel
            </Button>
          </div>
        </div>
      ) : null}

      {error ? (
        <div className="import-processing-actions">
          <Button type="button" onClick={() => void retry()} disabled={retrying !== null}>
            {retrying === 'all' ? 'Starting…' : 'Try again'}
          </Button>
          {!inline ? (
            <Button variant="secondary" type="button" onClick={onOpenPack}>
              Open study pack
            </Button>
          ) : null}
        </div>
      ) : null}

      {failure && failedSources.length === 0 ? (
        <div className="import-failure" role="alert">
          <strong>We couldn&apos;t process this file</strong>
          <p>{failure.message}</p>
          <div className="import-processing-actions">
            <Button type="button" onClick={() => void retry()} disabled={retrying !== null}>
              {retrying === 'all' ? 'Starting…' : 'Try again'}
            </Button>
            {!inline ? (
              <Button variant="secondary" type="button" onClick={onOpenPack}>
                Open study pack
              </Button>
            ) : null}
          </div>
          {failure.details ? (
            <details className="import-details">
              <summary>Details</summary>
              <code>{failure.details}</code>
            </details>
          ) : null}
        </div>
      ) : null}

      {!failure && aiUnavailable && status ? (
        <div className="import-notice">
          <IconSparkles size={17} />
          <div>
            <strong>AI generation unavailable</strong>
            <p>
              Your material and your study pack are saved. Lerno can generate a summary, concepts,
              flashcards and practice questions as soon as AI is available again.
            </p>
          </div>
          <div className="import-processing-actions">
            <Button variant="secondary" type="button" onClick={() => void retry()} disabled={retrying !== null}>
              Try AI generation
            </Button>
            {!inline ? (
              <ButtonLink to={`/study-packs/${packId}`} variant="ghost">
                Open study pack
              </ButtonLink>
            ) : null}
          </div>
        </div>
      ) : null}

      {done && !failure && !aiUnavailable && !inline && failedSources.length === 0 ? (
        <div className="import-processing-actions">
          <ButtonLink to={`/study-packs/${packId}`}>Open study pack</ButtonLink>
        </div>
      ) : null}
    </section>
  );
}

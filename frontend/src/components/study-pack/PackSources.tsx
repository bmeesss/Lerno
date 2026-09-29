import { useState } from 'react';
import { Button } from '../ui/Button';
import { ImportProcessing } from './ImportProcessing';
import { ContentReview } from './ContentReview';
import { Badge, EmptyState, ProgressBar } from '../ui/Primitives';
import { IconLayers, IconPlus, IconSparkles, IconTrash } from '../ui/Icons';
import { useToast } from '../ui/Toast';
import { ApiError } from '../../lib/api';
import { studyPackImportService } from '../../services/studyPackImportService';
import { studyPackService } from '../../services/studyPackService';
import { studySetService } from '../../services/studySetService';
import { useAsync } from '../../hooks/useAsync';
import {
  SourceStatusBadge,
  sourceKindLabel,
  sourceOriginLabel,
  sourceSizeLabel,
} from './PackBits';
import type { StudyContentPreview, StudyPackDetail, StudyPackSource } from '../../types';

type AddMode = 'text' | 'pdf' | 'set' | 'youtube';

const UPLOAD_KINDS = [
  ['powerpoint', 'Upload PowerPoint', '.pptx,application/vnd.openxmlformats-officedocument.presentationml.presentation'],
  ['image', 'Upload photo', 'image/png,image/jpeg,image/webp,.png,.jpg,.jpeg,.webp'],
  ['audio', 'Upload recording', 'audio/mpeg,audio/wav,audio/mp4,audio/webm,.mp3,.wav,.m4a,.webm'],
] as const;

/** "Retry extraction" / "Retry generation" — retries exactly the failed stage. */
function retryLabel(source: StudyPackSource): string {
  if (!source.stage || source.stage === 'extract') return 'Retry extraction';
  if (source.stage === 'normalize') return 'Retry reading';
  return 'Retry generation';
}

/**
 * Sources: every piece of material behind this pack, with the lifecycle state the
 * pipeline really reports (pending/processing/ready/failed) and per-stage retries.
 * The content engine generates from all of them at once through the review screen.
 */
export function PackSources({ pack, onChanged }: { pack: StudyPackDetail; onChanged: () => void }) {
  const toast = useToast();
  const [mode, setMode] = useState<AddMode>('text');
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [title, setTitle] = useState('');
  const [text, setText] = useState('');
  const [setId, setSetId] = useState('');
  const [youTubeUrl, setYouTubeUrl] = useState('');
  const [youTubeTranscript, setYouTubeTranscript] = useState('');
  const [retryingId, setRetryingId] = useState<string | null>(null);
  const [progress, setProgress] = useState(0);
  const [review, setReview] = useState<StudyContentPreview | null>(null);
  const [generating, setGenerating] = useState(false);
  const processing = pack.sources.find((source) => source.status === 'processing') ?? null;
  const readable = pack.sources.some(
    (source) => source.status !== 'failed' && source.characterCount > 0,
  );
  const { data: sets } = useAsync(
    () => (pack.isOwner ? studySetService.listMine() : Promise.resolve([])),
    [pack.isOwner],
  );

  function resetForm() {
    setTitle('');
    setText('');
    setSetId('');
    setYouTubeUrl('');
    setYouTubeTranscript('');
    setOpen(false);
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    try {
      if (mode === 'set') {
        const chosen = (sets ?? []).find((set) => set.id === setId);
        await studyPackService.addSource(pack.id, {
          type: 'set',
          setId,
          title: chosen?.title ?? 'Existing study set',
        });
      } else if (mode === 'youtube') {
        await studyPackImportService.addYouTubeSource(pack.id, {
          url: youTubeUrl.trim(),
          ...(youTubeTranscript.trim() ? { transcript: youTubeTranscript.trim() } : {}),
          ...(title.trim() ? { title: title.trim() } : {}),
        });
      } else {
        await studyPackService.addSource(pack.id, {
          type: mode,
          title: title.trim() || (mode === 'pdf' ? 'PDF document' : 'Notes'),
          text,
        });
      }
      toast.show('Source added', 'success');
      resetForm();
      onChanged();
    } catch (error) {
      toast.show(error instanceof ApiError ? error.message : 'Could not add this source', 'error');
    } finally {
      setBusy(false);
    }
  }

  /**
   * One upload path for every file source, exactly like /study-packs/new: the
   * backend validates the file, extracts the text, normalizes it and starts the
   * pipeline. The browser never reads the file itself, and there is no second
   * PDF route here.
   */
  async function uploadFile(
    file: File,
    kind: 'pdf' | 'powerpoint' | 'image' | 'audio',
  ) {
    if (busy) return;
    setBusy(true);
    setProgress(0);
    try {
      await studyPackImportService.uploadSource(
        pack.id,
        { kind, file, title: file.name },
        { onProgress: (percent) => setProgress(percent) },
      );
      toast.show('Source uploaded — Lerno is reading it', 'success');
      resetForm();
      onChanged();
    } catch (error) {
      toast.show(
        error instanceof ApiError
          ? error.message
          : 'This file could not be read. Try another file or paste the text instead.',
        'error',
      );
    } finally {
      setBusy(false);
      setProgress(0);
    }
  }

  /** Real retry: asks the backend to re-run from the stage that failed. */
  async function retry(source: StudyPackSource) {
    if (retryingId) return;
    setRetryingId(source.id);
    try {
      await studyPackImportService.process(pack.id, { sourceId: source.id });
      toast.show('Lerno is working on your material again', 'success');
      onChanged();
    } catch (error) {
      toast.show(
        error instanceof ApiError
          ? error.message
          : 'We could not start again. Your material is saved — try again in a moment.',
        'error',
      );
    } finally {
      setRetryingId(null);
    }
  }

  async function remove(source: StudyPackSource) {
    if (!window.confirm(`Remove "${source.title}" from this study pack?`)) return;
    try {
      await studyPackService.removeSource(pack.id, source.id);
      toast.show('Source removed');
      onChanged();
    } catch (error) {
      toast.show(error instanceof ApiError ? error.message : 'Could not remove this source', 'error');
    }
  }

  /** Generates everything from the same analysis and opens the review screen. */
  async function generateAll() {
    if (generating) return;
    setGenerating(true);
    try {
      const preview = await studyPackService.generateBundle(pack.id);
      setReview(preview);
    } catch (error) {
      toast.show(
        error instanceof ApiError ? error.message : 'We could not generate study material right now.',
        'error',
      );
    } finally {
      setGenerating(false);
    }
  }

  return (
    <section className="stack" style={{ gap: 20 }} aria-labelledby="pack-sources-heading">
      <div className="section-title">
        <div>
          <h2 id="pack-sources-heading">Sources</h2>
          <p className="muted">
            Everything Lerno uses to build this pack. Generated content stays traceable to its source.
          </p>
        </div>
        {pack.isOwner ? (
          <div className="pack-preview-actions">
            <Button
              variant="secondary"
              onClick={() => void generateAll()}
              disabled={!readable || generating}
            >
              <IconSparkles size={16} /> {generating ? 'Generating…' : 'Generate everything'}
            </Button>
            <Button onClick={() => setOpen((value) => !value)} aria-expanded={open}>
              <IconPlus size={17} /> Add material
            </Button>
          </div>
        ) : null}
      </div>

      {review ? (
        <ContentReview
          packId={pack.id}
          preview={review}
          sources={pack.sources}
          settings={review.settings}
          onApplied={(message) => {
            toast.show(message, 'success');
            setReview(null);
            onChanged();
          }}
          onDiscard={() => setReview(null)}
        />
      ) : null}

      {pack.isOwner && open ? (
        <form className="card pack-source-form" onSubmit={(event) => void submit(event)}>
          <div className="pack-source-tabs" role="tablist" aria-label="Source type">
            {(
              [
                ['text', 'Pasted text'],
                ['pdf', 'PDF'],
                ['set', 'Existing Lerno set'],
                ['youtube', 'YouTube'],
              ] as const
            ).map(([value, label]) => (
              <button
                key={value}
                type="button"
                role="tab"
                aria-selected={mode === value}
                className={`chip${mode === value ? ' chip-active' : ''}`}
                onClick={() => setMode(value)}
              >
                {label}
              </button>
            ))}
          </div>

          {mode === 'set' ? (
            <label className="field">
              <span>Study set</span>
              <select className="select" value={setId} onChange={(event) => setSetId(event.target.value)} required>
                <option value="">Choose one of your sets…</option>
                {(sets ?? []).map((set) => (
                  <option key={set.id} value={set.id}>
                    {set.title} ({set.cardCount} cards)
                  </option>
                ))}
              </select>
            </label>
          ) : mode === 'youtube' ? (
            <>
              <label className="field">
                <span>Video link</span>
                <input
                  className="input"
                  value={youTubeUrl}
                  maxLength={500}
                  placeholder="https://www.youtube.com/watch?v=…"
                  onChange={(event) => setYouTubeUrl(event.target.value)}
                />
              </label>
              <label className="field">
                <span>Transcript (the student's own copy)</span>
                <textarea
                  className="textarea"
                  rows={4}
                  value={youTubeTranscript}
                  maxLength={50_000}
                  placeholder="Paste the transcript here…"
                  onChange={(event) => setYouTubeTranscript(event.target.value)}
                />
              </label>
            </>
          ) : (
            <>
              <label className="field">
                <span>Title</span>
                <input
                  className="input"
                  value={title}
                  maxLength={120}
                  onChange={(event) => setTitle(event.target.value)}
                  placeholder={mode === 'pdf' ? 'Biologie H3.pdf' : 'Notes.txt'}
                />
              </label>
              <label className="field">
                <span>Text</span>
                <textarea
                  className="textarea"
                  rows={6}
                  value={text}
                  onChange={(event) => setText(event.target.value)}
                  placeholder="Paste your notes here…"
                />
              </label>
            </>
          )}

          <div className="pack-source-form-actions">
            <Button
              type="submit"
              disabled={
                busy ||
                (mode === 'set'
                  ? !setId
                  : mode === 'youtube'
                    ? youTubeUrl.trim().length < 5
                    : text.trim().length < 20)
              }
            >
              {busy ? 'Adding…' : 'Add source'}
            </Button>
            {mode === 'text' ? (
              <label className="btn btn-secondary btn-sm pack-file-button">
                Upload PDF
                <input
                  type="file"
                  accept="application/pdf,.pdf"
                  onChange={(event) => {
                    const file = event.target.files?.[0];
                    if (file) void uploadFile(file, 'pdf');
                    event.target.value = '';
                  }}
                />
              </label>
            ) : null}
            {UPLOAD_KINDS.map(([kind, label, accept]) => (
              <label key={kind} className="btn btn-secondary btn-sm pack-file-button">
                {label}
                <input
                  type="file"
                  accept={accept}
                  onChange={(event) => {
                    const file = event.target.files?.[0];
                    if (file) void uploadFile(file, kind);
                    event.target.value = '';
                  }}
                />
              </label>
            ))}
          </div>

          {busy && progress > 0 && progress < 100 ? (
            <div className="import-upload-progress" role="status">
              <span className="muted">Uploading your file… {Math.round(progress)}%</span>
              <ProgressBar value={progress} />
            </div>
          ) : null}
        </form>
      ) : null}

      {processing ? <ImportProcessing inline packId={pack.id} onFinished={() => onChanged()} /> : null}

      {pack.sources.length > 0 ? (
        <ul className="pack-source-list">
          {pack.sources.map((source) => (
            <li key={source.id} className="list-row pack-source-row">
              <span className="list-row-icon">
                <IconLayers size={18} />
              </span>
              <div className="pack-source-copy">
                <div className="list-row-title">{source.title}</div>
                <div className="muted pack-source-meta">
                  {sourceKindLabel(source.kind)} · {sourceSizeLabel(source)} · added{' '}
                  {new Date(source.createdAt).toLocaleDateString()}
                  {source.origin === 'imported' ? ' · imported' : ''}
                  {sourceOriginLabel(source) ? ` · ${sourceOriginLabel(source)}` : ''}
                </div>
                {(source.warnings ?? []).length > 0 ? (
                  <p className="muted">{(source.warnings ?? []).join(' ')}</p>
                ) : null}
                {source.failureReason ? <p className="form-error">{source.failureReason}</p> : null}
              </div>
              <SourceStatusBadge status={source.status} />
              {pack.isOwner && source.status === 'failed' ? (
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => void retry(source)}
                  disabled={retryingId === source.id}
                >
                  {retryingId === source.id ? 'Starting…' : retryLabel(source)}
                </Button>
              ) : null}
              {pack.isOwner ? (
                <button
                  type="button"
                  className="icon-btn icon-btn-danger"
                  aria-label={`Remove ${source.title}`}
                  onClick={() => void remove(source)}
                >
                  <IconTrash size={16} />
                </button>
              ) : null}
            </li>
          ))}
        </ul>
      ) : (
        <EmptyState
          icon={<IconLayers />}
          title="No sources yet"
          description="Add notes, a PDF, slides, a photo, a recording or a video to build this study pack."
          action={
            pack.isOwner ? (
              <Button onClick={() => setOpen(true)}>
                <IconPlus size={17} /> Add material
              </Button>
            ) : (
              <Badge>The owner has not added material yet</Badge>
            )
          }
        />
      )}
    </section>
  );
}

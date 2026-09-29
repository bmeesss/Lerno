import { useState } from 'react';
import { Button } from '../ui/Button';
import { ImportProcessing } from './ImportProcessing';
import { Badge, EmptyState } from '../ui/Primitives';
import { IconLayers, IconPlus, IconTrash } from '../ui/Icons';
import { useToast } from '../ui/Toast';
import { ApiError } from '../../lib/api';
import { aiStudioService } from '../../services/aiStudioService';
import { studyPackImportService } from '../../services/studyPackImportService';
import { studyPackService } from '../../services/studyPackService';
import { studySetService } from '../../services/studySetService';
import { useAsync } from '../../hooks/useAsync';
import { SourceStatusBadge, sourceKindLabel, sourceSizeLabel } from './PackBits';
import type { StudyPackDetail, StudyPackSource } from '../../types';

type AddMode = 'text' | 'pdf' | 'set';

/**
 * Sources: every piece of material behind this pack, with the processing state
 * the UI will keep using when more source types land (PowerPoint, YouTube,
 * images/OCR, audio).
 */
export function PackSources({ pack, onChanged }: { pack: StudyPackDetail; onChanged: () => void }) {
  const toast = useToast();
  const [mode, setMode] = useState<AddMode>('text');
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [title, setTitle] = useState('');
  const [text, setText] = useState('');
  const [setId, setSetId] = useState('');
  const [retryingId, setRetryingId] = useState<string | null>(null);
  const processing = pack.sources.find((source) => source.status === 'processing') ?? null;
  const { data: sets } = useAsync(() => (pack.isOwner ? studySetService.listMine() : Promise.resolve([])), [
    pack.isOwner,
  ]);

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
      } else {
        await studyPackService.addSource(pack.id, {
          type: mode,
          title: title.trim() || (mode === 'pdf' ? 'PDF document' : 'Notes'),
          text,
        });
      }
      toast.show('Source added', 'success');
      setTitle('');
      setText('');
      setSetId('');
      setOpen(false);
      onChanged();
    } catch (error) {
      toast.show(error instanceof ApiError ? error.message : 'Could not add this source', 'error');
    } finally {
      setBusy(false);
    }
  }

  async function uploadPdf(file: File) {
    if (busy) return;
    setBusy(true);
    try {
      const extracted = await aiStudioService.extractPdf(file, file.name.replace(/\.pdf$/i, ''));
      const created = await studyPackService.addSource(pack.id, {
        type: 'pdf',
        title: extracted.title || file.name,
        text: extracted.text,
        pageCount: extracted.pageCount,
      });
      toast.show(`Added ${created.title}`, 'success');
      onChanged();
    } catch (error) {
      toast.show(
        error instanceof ApiError ? error.message : 'This PDF could not be read. Paste the text instead.',
        'error',
      );
    } finally {
      setBusy(false);
    }
  }

  /** Real retry: asks the backend to process the stored material again. */
  async function retry(source: StudyPackSource) {
    if (retryingId) return;
    setRetryingId(source.id);
    try {
      await studyPackImportService.process(pack.id, source.id);
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
          <Button onClick={() => setOpen((value) => !value)} aria-expanded={open}>
            <IconPlus size={17} /> Add material
          </Button>
        ) : null}
      </div>

      {pack.isOwner && open ? (
        <form className="card pack-source-form" onSubmit={(event) => void submit(event)}>
          <div className="pack-source-tabs" role="tablist" aria-label="Source type">
            {(
              [
                ['text', 'Pasted text'],
                ['pdf', 'PDF'],
                ['set', 'Existing Lerno set'],
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
            <Button type="submit" disabled={busy || (mode === 'set' ? !setId : text.trim().length < 20)}>
              {busy ? 'Adding…' : 'Add source'}
            </Button>
            <label className="btn btn-secondary btn-sm pack-file-button">
              Upload PDF
              <input
                type="file"
                accept="application/pdf,.pdf"
                onChange={(event) => {
                  const file = event.target.files?.[0];
                  if (file) void uploadPdf(file);
                  event.target.value = '';
                }}
              />
            </label>
          </div>
          <p className="muted pack-source-note">
            PowerPoint, YouTube, images and audio are on the roadmap; the source model already supports them.
          </p>
        </form>
      ) : null}

      {processing ? (
        <ImportProcessing
          inline
          packId={pack.id}
          onFinished={() => onChanged()}
        />
      ) : null}

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
                </div>
                {source.failureReason ? (
                  <p className="form-error">{source.failureReason}</p>
                ) : null}
              </div>
              <SourceStatusBadge status={source.status} />
              {pack.isOwner && (source.status === 'failed' || source.status === 'processing') ? (
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => void retry(source)}
                  disabled={retryingId === source.id}
                >
                  {retryingId === source.id ? 'Starting…' : 'Try again'}
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
          description="Add notes, a PDF or an existing set to build this study pack."
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

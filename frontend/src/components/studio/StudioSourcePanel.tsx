import { useEffect, useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { Button } from '../ui/Button';
import { IconBook, IconCheck, IconLayers } from '../ui/Icons';
import { studySetService } from '../../services/studySetService';
import { aiStudioService, type StudioSource } from '../../services/aiStudioService';
import type { StudySetSummary } from '../../types';

const PDF_MAX_BYTES = 15 * 1024 * 1024;

type SourceMode = 'text' | 'pdf' | 'set';

interface Props {
  source: StudioSource | null;
  onSource: (source: StudioSource | null) => void;
  onBusyChange: (busy: boolean) => void;
  onError: (message: string | null) => void;
}

export function StudioSourcePanel({ source, onSource, onBusyChange, onError }: Props) {
  const [mode, setMode] = useState<SourceMode>('text');
  const [title, setTitle] = useState('');
  const [text, setText] = useState('');
  const [selectedSetId, setSelectedSetId] = useState('');
  const [sets, setSets] = useState<StudySetSummary[]>([]);
  const [setsLoading, setSetsLoading] = useState(false);
  const [setsLoaded, setSetsLoaded] = useState(false);
  const [setsError, setSetsError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (mode !== 'set' || setsLoaded || setsLoading) return;
    setSetsLoading(true);
    setSetsError(null);
    void studySetService
      .listMine()
      .then((mine) => setSets(mine.filter((set) => set.cardCount > 0)))
      .catch((error: unknown) => {
        setSetsError(error instanceof Error ? error.message : 'Could not load your sets.');
      })
      .finally(() => {
        setSetsLoading(false);
        setSetsLoaded(true);
      });
  }, [mode, setsLoaded, setsLoading]);

  function startBusy() {
    setBusy(true);
    onBusyChange(true);
    onError(null);
    onSource(null);
  }

  function addText(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (text.trim().length < 20) {
      onError('Paste at least 20 characters of study material.');
      return;
    }
    startBusy();
    const cleanText = text.trim();
    const created: StudioSource = {
      id: `text-${Date.now()}`,
      type: 'text',
      title: title.trim() || 'Pasted study material',
      text: cleanText,
      preview: cleanText.slice(0, 1_200),
      characterCount: cleanText.length,
      truncated: text.length > cleanText.length,
    };
    onSource(created);
    setText('');
    setTitle('');
    setBusy(false);
    onBusyChange(false);
  }

  async function addPdf(file?: File) {
    if (!file) return;
    if (!file.name.toLowerCase().endsWith('.pdf') || (file.type && file.type !== 'application/pdf')) {
      onError('Choose a PDF file. Other file types are not supported.');
      return;
    }
    if (file.size === 0 || file.size > PDF_MAX_BYTES) {
      onError('Choose a PDF that is smaller than 15 MB.');
      return;
    }
    startBusy();
    try {
      const extracted = await aiStudioService.extractPdf(file, title.trim() || file.name.replace(/\.pdf$/i, ''));
      onSource({
        id: `pdf-${Date.now()}`,
        type: 'pdf',
        ...extracted,
        preview: extracted.text.slice(0, 1_200),
      });
      setTitle('');
    } catch (error) {
      onError(error instanceof Error ? error.message : 'Could not read this PDF. Try another file.');
    } finally {
      setBusy(false);
      onBusyChange(false);
    }
  }

  async function addSet(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selectedSetId) {
      onError('Choose one of your sets first.');
      return;
    }
    startBusy();
    try {
      const set = await studySetService.get(selectedSetId);
      const preview = set.cards.slice(0, 4).map((card, index) => `${index + 1}. ${card.question} — ${card.answer}`).join('\\n');
      const characterCount = set.cards.reduce((sum, card) => sum + card.question.length + card.answer.length, 0);
      onSource({
        id: set.id,
        type: 'set',
        setId: set.id,
        title: set.title,
        preview: preview || 'This set has no card preview.',
        characterCount,
        cardCount: set.cardCount,
      });
    } catch (error) {
      onError(error instanceof Error ? error.message : 'Could not add this set. Please try again.');
    } finally {
      setBusy(false);
      onBusyChange(false);
    }
  }

  const cardCountLabel = source?.type === 'set' ? `${source.cardCount} cards` : null;

  function changeMode(next: SourceMode) {
    if (source && source.type !== next) onSource(null);
    setMode(next);
    onError(null);
  }

  return (
    <section className="studio-source-panel" aria-labelledby="studio-source-heading">
      <div className="studio-section-heading">
        <div>
          <span className="studio-step">01 · Your material</span>
          <h2 id="studio-source-heading">Start with a source</h2>
          <p>Choose what you want Lerno AI to work from. Your material stays yours.</p>
        </div>
        {source ? <span className="studio-source-ready"><IconCheck size={15} /> Source ready</span> : null}
      </div>

      <div className="studio-source-tabs" role="group" aria-label="Choose a source type">
        <button type="button" aria-pressed={mode === 'text'} onClick={() => changeMode('text')} disabled={busy}>
          Paste text
        </button>
        <button type="button" aria-pressed={mode === 'pdf'} onClick={() => changeMode('pdf')} disabled={busy}>
          Upload a PDF
        </button>
        <button type="button" aria-pressed={mode === 'set'} onClick={() => changeMode('set')} disabled={busy}>
          Use a Lerno set
        </button>
      </div>

      {mode === 'text' ? (
        <form className="studio-source-form" onSubmit={(event) => void addText(event)}>
          <label className="studio-field-label" htmlFor="studio-text-title">Source name <span>optional</span></label>
          <input
            className="input"
            id="studio-text-title"
            value={title}
            maxLength={120}
            onChange={(event) => setTitle(event.target.value)}
            placeholder="e.g. Biology · cell division"
            disabled={busy}
          />
          <label className="studio-field-label" htmlFor="studio-source-text">Paste your notes, chapter text, or study material</label>
          <textarea
            className="textarea studio-source-text"
            id="studio-source-text"
            value={text}
            onChange={(event) => setText(event.target.value)}
            maxLength={50_000}
            rows={7}
            placeholder="Paste material you want to study. Lerno AI will use this source rather than guessing your course content."
            disabled={busy}
          />
          <div className="studio-source-form-footer">
            <small>{text.length.toLocaleString()} / 50,000 characters · at least 20 to continue</small>
            <Button type="submit" disabled={busy || text.trim().length < 20}>
              {busy ? 'Adding source…' : 'Preview this text'}
            </Button>
          </div>
        </form>
      ) : null}

      {mode === 'pdf' ? (
        <div className="studio-source-form">
          <label className="studio-field-label" htmlFor="studio-pdf-title">Source name <span>optional</span></label>
          <input
            className="input"
            id="studio-pdf-title"
            value={title}
            maxLength={120}
            onChange={(event) => setTitle(event.target.value)}
            placeholder="Use the file name"
            disabled={busy}
          />
          <label className="studio-pdf-drop" htmlFor="studio-pdf-file">
            <span className="studio-pdf-icon"><IconBook size={20} /></span>
            <strong>{busy ? 'Reading your PDF…' : 'Choose a PDF to preview'}</strong>
            <small>PDF only · up to 15 MB and 100 pages · selectable text, no OCR</small>
            <input
              id="studio-pdf-file"
              type="file"
              accept=".pdf,application/pdf"
              disabled={busy}
              onChange={(event) => {
                const file = event.currentTarget.files?.[0];
                void addPdf(file);
                event.currentTarget.value = '';
              }}
            />
          </label>
          <p className="studio-privacy-note">PDFs are read in memory for this session; they are not stored as public files.</p>
        </div>
      ) : null}

      {mode === 'set' ? (
        <form className="studio-source-form studio-set-source-form" onSubmit={(event) => void addSet(event)}>
          <label className="studio-field-label" htmlFor="studio-set-select">Choose one of your study sets</label>
          {setsLoading ? <p className="studio-muted" role="status">Loading your sets…</p> : null}
          {setsError ? (
            <p className="studio-inline-error" role="alert">
              {setsError}{' '}
              <button type="button" className="studio-text-button" onClick={() => { setSetsLoaded(false); setSetsError(null); }}>Try again</button>
            </p>
          ) : null}
          {!setsLoading && !setsError && sets.length === 0 ? (
            <div className="studio-no-sets">
              <IconLayers size={21} />
              <span><strong>No sets with cards yet</strong><small>Create a set first, or paste text above.</small></span>
              <Link to="/sets/new">Create a set</Link>
            </div>
          ) : null}
          {sets.length > 0 ? (
            <>
              <select
                id="studio-set-select"
                className="select"
                value={selectedSetId}
                onChange={(event) => setSelectedSetId(event.target.value)}
                disabled={busy || setsLoading}
              >
                <option value="">Select a set…</option>
                {sets.map((set) => (
                  <option key={set.id} value={set.id}>{set.title} · {set.cardCount} cards</option>
                ))}
              </select>
              <p className="studio-muted">Only sets you can access appear here. Access is checked again before each AI action.</p>
              <div className="studio-source-form-footer">
                <span />
                <Button type="submit" disabled={busy || !selectedSetId}>{busy ? 'Adding set…' : 'Preview this set'}</Button>
              </div>
            </>
          ) : null}
        </form>
      ) : null}

      {source ? (
        <div className="studio-source-preview" aria-label="Source preview">
          <div className="studio-source-preview-heading">
            <div className="studio-source-type-icon"><IconBook size={18} /></div>
            <div className="studio-source-meta">
              <strong>{source.title}</strong>
              <span>{source.type === 'pdf' ? 'PDF document' : source.type === 'set' ? 'Your Lerno set' : 'Pasted text'}
                {' · '}{source.characterCount.toLocaleString()} characters
                {source.type === 'pdf' && source.pageCount ? ` · ${source.pageCount} pages` : ''}
                {cardCountLabel ? ` · ${cardCountLabel}` : ''}
              </span>
            </div>
            <button type="button" className="studio-text-button" onClick={() => { onSource(null); onError(null); }} disabled={busy}>
              Change source
            </button>
          </div>
          {source.type !== 'set' && source.truncated ? <p className="studio-truncation-note">This source is long. Lerno AI will use bounded excerpts for each task.</p> : null}
          <pre className="studio-source-excerpt">{source.preview}{source.characterCount > source.preview.length ? '\n…' : ''}</pre>
          <p className="studio-privacy-note">Source context is temporary and scoped to your account. No AI request is made until you choose an action.</p>
        </div>
      ) : null}
    </section>
  );
}

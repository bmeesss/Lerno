import { useEffect, useMemo, useState, type ChangeEvent, type FormEvent } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { Button } from '../../components/ui/Button';
import { EmptyState, LoadingRow } from '../../components/ui/Primitives';
import { Modal } from '../../components/ui/Modal';
import { IconPlus, IconTrash } from '../../components/ui/Icons';
import { useToast } from '../../components/ui/Toast';
import { ApiError } from '../../lib/api';
import {
  parseCardCsvDetailed,
  parseCardLinesDetailed,
  type ParsedCard,
  type ParsedImport,
} from '../../lib/parseCards';
import { studySetService } from '../../services/studySetService';
import { subjectService } from '../../services/subjectService';
import type { Card, Subject, Visibility } from '../../types';

interface CardRow {
  /** Existing card id when editing. */
  id?: string;
  question: string;
  answer: string;
  /** Marks rows removed in edit mode (deleted on save). */
  removed?: boolean;
}

export function SetEditorPage() {
  const { setId } = useParams<{ setId: string }>();
  const isEdit = Boolean(setId);
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const toast = useToast();

  const [loading, setLoading] = useState(isEdit);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [subjects, setSubjects] = useState<Subject[]>([]);
  const [saving, setSaving] = useState(false);

  const [title, setTitle] = useState('');
  const [subjectId, setSubjectId] = useState<string>(searchParams.get('subjectId') ?? '');
  const [level, setLevel] = useState('');
  const [description, setDescription] = useState('');
  const [visibility, setVisibility] = useState<Visibility>('private');
  const [tagsInput, setTagsInput] = useState('');
  const [rows, setRows] = useState<CardRow[]>([{ question: '', answer: '' }]);
  const [initialRows, setInitialRows] = useState<CardRow[]>([]);
  const [importOpen, setImportOpen] = useState(false);
  const [importText, setImportText] = useState('');
  const [importError, setImportError] = useState<string | null>(null);
  const [csvPreview, setCsvPreview] = useState<{ name: string; parsed: ParsedImport } | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [discardOpen, setDiscardOpen] = useState(false);
  const [savedSnapshot, setSavedSnapshot] = useState<string | null>(null);

  /** Live preview of the pasted list: valid cards plus skipped lines. */
  const pastePreview = useMemo(() => parseCardLinesDetailed(importText), [importText]);

  useEffect(() => {
    let cancelled = false;
    void subjectService
      .list()
      .then((list) => {
        if (!cancelled) setSubjects(list);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!setId) return;
    let cancelled = false;
    setLoading(true);
    studySetService
      .get(setId)
      .then((detail) => {
        if (cancelled) return;
        setTitle(detail.title);
        setSubjectId(detail.subjectId ?? '');
        setLevel(detail.level);
        setDescription(detail.description);
        setVisibility(detail.visibility);
        setTagsInput(detail.tags.join(', '));
        const loaded: CardRow[] = detail.cards.map((card: Card) => ({
          id: card.id,
          question: card.question,
          answer: card.answer,
        }));
        setRows(loaded.length > 0 ? loaded : [{ question: '', answer: '' }]);
        setInitialRows(loaded);
        setSavedSnapshot(
          JSON.stringify({
            title: detail.title,
            subjectId: detail.subjectId ?? '',
            level: detail.level,
            description: detail.description,
            visibility: detail.visibility,
            tagsInput: detail.tags.join(', '),
            rows: loaded,
          }),
        );
        setLoading(false);
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setLoadError(err instanceof ApiError ? err.message : 'Could not load study set');
          setLoading(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [setId]);

  // Pristine snapshot for create mode (edit mode snapshots on load above).
  useEffect(() => {
    if (!isEdit && savedSnapshot === null) {
      setSavedSnapshot(
        JSON.stringify({
          title: '',
          subjectId: searchParams.get('subjectId') ?? '',
          level: '',
          description: '',
          visibility: 'private',
          tagsInput: '',
          rows: [{ question: '', answer: '' }],
        }),
      );
    }
  }, [isEdit, savedSnapshot, searchParams]);

  const snapshot = JSON.stringify({
    title,
    subjectId,
    level,
    description,
    visibility,
    tagsInput,
    rows,
  });
  const dirty = savedSnapshot !== null && savedSnapshot !== snapshot && !saving;

  // Warn on reload/tab close with unsaved changes (in-app Cancel is guarded
  // by the discard dialog below).
  useEffect(() => {
    if (!dirty) return;
    const guard = (event: BeforeUnloadEvent) => {
      event.preventDefault();
    };
    window.addEventListener('beforeunload', guard);
    return () => window.removeEventListener('beforeunload', guard);
  }, [dirty]);

  function onCancel() {
    if (dirty) {
      setDiscardOpen(true);
      return;
    }
    navigate(isEdit ? `/sets/${setId}` : '/sets');
  }

  function addRow() {
    setRows((current) => [...current, { question: '', answer: '' }]);
  }

  function updateRow(index: number, patch: Partial<CardRow>) {
    setRows((current) => current.map((row, i) => (i === index ? { ...row, ...patch } : row)));
  }

  function removeRow(index: number) {
    setRows((current) => {
      const row = current[index];
      if (!row) return current;
      // Unsaved rows are dropped; saved rows are marked removed (deleted on save).
      if (!row.id) return current.filter((_, i) => i !== index);
      return current.map((r, i) => (i === index ? { ...r, removed: true } : r));
    });
  }

  function applyImported(cards: ParsedCard[]) {
    if (cards.length === 0) return;
    setRows((current) => {
      // Drop only pristine placeholder rows; pending removals must survive
      // an import or the deletion is silently lost.
      const kept = current.filter(
        (row) => row.removed || row.id || row.question.trim() || row.answer.trim(),
      );
      return [...kept, ...cards.map((card) => ({ ...card }))];
    });
    closeImport();
    setFormError(null);
    toast.show(`Imported ${cards.length} cards`, 'success');
  }

  function onImportSubmit(e: FormEvent) {
    e.preventDefault();
    if (pastePreview.cards.length === 0) {
      setImportError('No valid rows found. Use “question | answer” lines (tab or :: also work).');
      return;
    }
    applyImported(pastePreview.cards);
    setImportText('');
  }

  function onCsvFile(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      setCsvPreview({ name: file.name, parsed: parseCardCsvDetailed(String(reader.result ?? '')) });
      setImportError(null);
    };
    reader.readAsText(file);
    e.target.value = '';
  }

  function onCsvConfirm() {
    if (csvPreview && csvPreview.parsed.cards.length > 0) {
      applyImported(csvPreview.parsed.cards);
    }
    setCsvPreview(null);
  }

  function closeImport() {
    setImportOpen(false);
    setImportText('');
    setCsvPreview(null);
    setImportError(null);
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setFormError(null);

    const tags = tagsInput
      .split(',')
      .map((tag) => tag.trim().replace(/^#/, ''))
      .filter(Boolean)
      .slice(0, 10);
    const validRows = rows.filter(
      (row) => !row.removed && row.question.trim() && row.answer.trim(),
    );

    if (validRows.length === 0) {
      setFormError('Add at least one card with a question and answer.');
      return;
    }

    // Client-side 500-cap precheck (the backend stays authoritative).
    const removedCount = rows.filter((row) => row.removed && row.id).length;
    const keptExisting = isEdit ? initialRows.length - removedCount : 0;
    const brandNew = validRows.filter((row) => !row.id).length;
    if (keptExisting + brandNew > 500) {
      setFormError(
        `A set can hold at most 500 cards — this would make ${keptExisting + brandNew}. ` +
          'Remove some cards or split the set.',
      );
      return;
    }

    setSaving(true);
    try {
      if (!isEdit) {
        const created = await studySetService.create({
          title: title.trim(),
          subjectId: subjectId || null,
          level: level.trim(),
          description: description.trim(),
          visibility,
          tags,
          cards: validRows.map((row) => ({
            question: row.question.trim(),
            answer: row.answer.trim(),
          })),
        });
        toast.show('Study set created', 'success');
        navigate(`/sets/${created.id}`);
        return;
      }

      // Edit mode: meta update + card diff (preserve card ids + progress)
      await studySetService.update(setId!, {
        title: title.trim(),
        subjectId: subjectId || null,
        level: level.trim(),
        description: description.trim(),
        visibility,
        tags,
      });

      const initialById = new Map(initialRows.map((row) => [row.id!, row]));
      for (const row of rows.filter((r) => r.removed && r.id)) {
        await studySetService.removeCard(setId!, row.id!);
      }
      // New cards go in one bulk call, no matter how many were pasted.
      const newCards = validRows
        .filter((row) => !row.id)
        .map((row) => ({ question: row.question.trim(), answer: row.answer.trim() }));
      if (newCards.length > 0) {
        await studySetService.addCards(setId!, newCards);
      }
      for (const row of validRows.filter((r) => r.id)) {
        const original = initialById.get(row.id!);
        if (
          original &&
          (original.question !== row.question || original.answer !== row.answer)
        ) {
          await studySetService.updateCard(setId!, row.id!, {
            question: row.question.trim(),
            answer: row.answer.trim(),
          });
        }
      }

      toast.show('Study set saved', 'success');
      navigate(`/sets/${setId}`);
    } catch (err) {
      setFormError(err instanceof ApiError ? err.message : 'Could not save study set');
    } finally {
      setSaving(false);
    }
  }

  if (loading) return <LoadingRow large />;
  if (loadError) return <EmptyState title="Study set not found" description={loadError} />;

  const visibleRows = rows.filter((row) => !row.removed);

  return (
    <>
      <div className="page-header">
        <div>
          <h1>{isEdit ? 'Edit study set' : 'Create study set'}</h1>
          <p>
            {isEdit
              ? 'Update the details and cards of this set.'
              : 'Add cards manually, paste a list, or import a CSV.'}
          </p>
        </div>
      </div>

      <form onSubmit={(e) => void onSubmit(e)} className="editor-layout">
        {formError ? <div className="form-error">{formError}</div> : null}

        <div className="card">
          <div className="field" style={{ marginBottom: 14 }}>
            <label htmlFor="set-title">Title</label>
            <input
              id="set-title"
              className="input"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              required
              maxLength={160}
              placeholder="e.g. Biology chapter 3 — cell structure"
            />
          </div>
          <div className="editor-meta-grid">
            <div className="field">
              <label htmlFor="set-subject">Subject</label>
              <select
                id="set-subject"
                className="select input"
                value={subjectId}
                onChange={(e) => setSubjectId(e.target.value)}
              >
                <option value="">No subject</option>
                {subjects.map((subject) => (
                  <option key={subject.id} value={subject.id}>
                    {subject.name}
                  </option>
                ))}
              </select>
            </div>
            <div className="field">
              <label htmlFor="set-level">Level</label>
              <input
                id="set-level"
                className="input"
                value={level}
                onChange={(e) => setLevel(e.target.value)}
                maxLength={60}
                placeholder="e.g. havo 4, mbo niveau 2"
              />
            </div>
          </div>
          <div className="field" style={{ marginTop: 14 }}>
            <label htmlFor="set-description">Description</label>
            <textarea
              id="set-description"
              className="textarea"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              maxLength={2000}
              placeholder="What does this set cover?"
            />
          </div>
          <div className="editor-meta-grid" style={{ marginTop: 14 }}>
            <div className="field">
              <label htmlFor="set-visibility">Visibility</label>
              <select
                id="set-visibility"
                className="select input"
                value={visibility}
                onChange={(e) => setVisibility(e.target.value as Visibility)}
              >
                <option value="private">Private — only you</option>
                <option value="public">Public — anyone can study it</option>
              </select>
            </div>
            <div className="field">
              <label htmlFor="set-tags">Tags</label>
              <input
                id="set-tags"
                className="input"
                value={tagsInput}
                onChange={(e) => setTagsInput(e.target.value)}
                placeholder="comma, separated, tags"
              />
            </div>
          </div>
        </div>

        <div>
          <div className="section-title" style={{ marginTop: 0 }}>
            <h2>Cards ({visibleRows.length})</h2>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              <Button
                type="button"
                variant="secondary"
                size="sm"
                onClick={() => setImportOpen(true)}
              >
                Paste / import
              </Button>
              <Button type="button" variant="secondary" size="sm" onClick={addRow}>
                <IconPlus size={15} /> Add card
              </Button>
            </div>
          </div>

          <div className="stack" style={{ gap: 10 }}>
            {rows.map((row, index) =>
              row.removed ? null : (
                <div key={row.id ?? `new-${index}`} className="card-editor-row">
                  <div className="field">
                    <label className="visually-hidden" htmlFor={`q-${index}`}>
                      Question
                    </label>
                    <textarea
                      id={`q-${index}`}
                      className="textarea"
                      style={{ minHeight: 64 }}
                      placeholder="Question"
                      value={row.question}
                      onChange={(e) => updateRow(index, { question: e.target.value })}
                    />
                  </div>
                  <div className="field">
                    <label className="visually-hidden" htmlFor={`a-${index}`}>
                      Answer
                    </label>
                    <textarea
                      id={`a-${index}`}
                      className="textarea"
                      style={{ minHeight: 64 }}
                      placeholder="Answer"
                      value={row.answer}
                      onChange={(e) => updateRow(index, { answer: e.target.value })}
                    />
                  </div>
                  <Button
                    type="button"
                    variant="ghost"
                    aria-label="Remove card"
                    onClick={() => removeRow(index)}
                  >
                    <IconTrash size={17} />
                  </Button>
                </div>
              ),
            )}
          </div>
        </div>

        <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
          <Button type="button" variant="ghost" onClick={onCancel}>
            Cancel
          </Button>
          <Button type="submit" disabled={saving}>
            {saving ? 'Saving…' : isEdit ? 'Save changes' : 'Create set'}
          </Button>
        </div>
      </form>

      <Modal
        open={discardOpen}
        title="Discard unsaved changes?"
        onClose={() => setDiscardOpen(false)}
      >
        <p style={{ marginBottom: 16 }}>
          You have unsaved changes in this editor. Leaving now will lose them.
        </p>
        <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
          <Button variant="secondary" onClick={() => setDiscardOpen(false)}>
            Keep editing
          </Button>
          <Button variant="danger" onClick={() => navigate(isEdit ? `/sets/${setId}` : '/sets')}>
            Discard changes
          </Button>
        </div>
      </Modal>

      <Modal open={importOpen} title="Paste cards or import CSV" onClose={closeImport}>
        <p style={{ marginBottom: 12 }}>
          Paste lines as <strong>question | answer</strong> (tab and :: also work), or choose a CSV
          file with question and answer columns.
        </p>
        {importError ? <div className="form-error">{importError}</div> : null}
        <form onSubmit={onImportSubmit}>
          <div className="field">
            <label htmlFor="import-text">Paste list</label>
            <textarea
              id="import-text"
              className="textarea"
              value={importText}
              onChange={(e) => {
                setImportText(e.target.value);
                setImportError(null);
              }}
              placeholder={'What is ATP? | The cell energy currency\nCapital of France? | Paris'}
            />
          </div>
          {importText.trim() ? <ImportPreview parsed={pastePreview} /> : null}
          <div
            style={{
              display: 'flex',
              gap: 10,
              marginTop: 14,
              alignItems: 'center',
              flexWrap: 'wrap',
            }}
          >
            <Button type="submit" disabled={pastePreview.cards.length === 0}>
              Add {pastePreview.cards.length} card{pastePreview.cards.length === 1 ? '' : 's'}
            </Button>
            <label className="btn btn-secondary" style={{ cursor: 'pointer' }}>
              Choose CSV file
              <input
                type="file"
                accept=".csv,text/csv"
                className="visually-hidden"
                onChange={onCsvFile}
              />
            </label>
          </div>
        </form>
        {csvPreview ? (
          <div style={{ marginTop: 16 }}>
            <p style={{ fontWeight: 600, marginBottom: 8 }}>
              {csvPreview.name}: {csvPreview.parsed.cards.length} card
              {csvPreview.parsed.cards.length === 1 ? '' : 's'} found
            </p>
            <ImportPreview parsed={csvPreview.parsed} />
            <div style={{ display: 'flex', gap: 10, marginTop: 10 }}>
              <Button
                size="sm"
                disabled={csvPreview.parsed.cards.length === 0}
                onClick={onCsvConfirm}
              >
                Add these cards
              </Button>
              <Button variant="ghost" size="sm" onClick={() => setCsvPreview(null)}>
                Discard
              </Button>
            </div>
          </div>
        ) : null}
      </Modal>
    </>
  );
}

function ImportPreview({ parsed }: { parsed: ParsedImport }) {
  return (
    <div className="muted" style={{ fontSize: '0.875rem', marginTop: 10 }}>
      <p style={{ margin: '0 0 6px' }}>
        {parsed.cards.length} card{parsed.cards.length === 1 ? '' : 's'} ready
        {parsed.skipped.length > 0
          ? ` · ${parsed.skipped.length} line${parsed.skipped.length === 1 ? '' : 's'} skipped`
          : ''}
      </p>
      {parsed.cards.length > 0 ? (
        <ul style={{ margin: '0 0 6px', paddingLeft: 18 }}>
          {parsed.cards.slice(0, 3).map((card, index) => (
            <li key={index}>
              {card.question} → {card.answer}
            </li>
          ))}
          {parsed.cards.length > 3 ? <li>…and {parsed.cards.length - 3} more</li> : null}
        </ul>
      ) : null}
      {parsed.skipped.length > 0 ? (
        <ul style={{ margin: 0, paddingLeft: 18 }}>
          {parsed.skipped.slice(0, 5).map((line) => (
            <li key={line.line}>
              line {line.line}: “{line.text}”
            </li>
          ))}
          {parsed.skipped.length > 5 ? <li>…and {parsed.skipped.length - 5} more</li> : null}
        </ul>
      ) : null}
    </div>
  );
}

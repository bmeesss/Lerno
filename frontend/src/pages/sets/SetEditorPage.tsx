import { useEffect, useState, type ChangeEvent, type FormEvent } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { Button, ButtonLink } from '../../components/ui/Button';
import { EmptyState, LoadingRow } from '../../components/ui/Primitives';
import { Modal } from '../../components/ui/Modal';
import { IconPlus, IconTrash } from '../../components/ui/Icons';
import { useToast } from '../../components/ui/Toast';
import { ApiError } from '../../lib/api';
import { parseCardCsv, parseCardLines, type ParsedCard } from '../../lib/parseCards';
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
  const [formError, setFormError] = useState<string | null>(null);

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
    if (cards.length === 0) {
      setFormError('No valid rows found. Use "question | answer" lines or CSV.');
      return;
    }
    setRows((current) => {
      const kept = current.filter(
        (row) => !row.removed && (row.id || row.question.trim() || row.answer.trim()),
      );
      return [...kept, ...cards.map((card) => ({ ...card }))];
    });
    setImportOpen(false);
    setImportText('');
    setFormError(null);
    toast.show(`Imported ${cards.length} cards`, 'success');
  }

  function onImportSubmit(e: FormEvent) {
    e.preventDefault();
    applyImported(parseCardLines(importText));
  }

  function onCsvFile(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      applyImported(parseCardCsv(String(reader.result ?? '')));
    };
    reader.readAsText(file);
    e.target.value = '';
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
      for (const row of validRows) {
        const original = row.id ? initialById.get(row.id) : undefined;
        if (!row.id) {
          await studySetService.addCards(setId!, [
            { question: row.question.trim(), answer: row.answer.trim() },
          ]);
        } else if (
          original &&
          (original.question !== row.question || original.answer !== row.answer)
        ) {
          await studySetService.updateCard(setId!, row.id, {
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
          <div style={{ display: 'grid', gap: 14, gridTemplateColumns: '1fr 1fr' }}>
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
          <div style={{ display: 'grid', gap: 14, gridTemplateColumns: '1fr 1fr', marginTop: 14 }}>
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
          <ButtonLink to={isEdit ? `/sets/${setId}` : '/sets'} variant="ghost">
            Cancel
          </ButtonLink>
          <Button type="submit" disabled={saving}>
            {saving ? 'Saving…' : isEdit ? 'Save changes' : 'Create set'}
          </Button>
        </div>
      </form>

      <Modal
        open={importOpen}
        title="Paste cards or import CSV"
        onClose={() => setImportOpen(false)}
      >
        <p style={{ marginBottom: 12 }}>
          Paste lines as <strong>question | answer</strong> (tab and :: also work), or choose a CSV
          file with question and answer columns.
        </p>
        <form onSubmit={onImportSubmit}>
          <div className="field">
            <label htmlFor="import-text">Paste list</label>
            <textarea
              id="import-text"
              className="textarea"
              value={importText}
              onChange={(e) => setImportText(e.target.value)}
              placeholder={'What is ATP? | The cell energy currency\nCapital of France? | Paris'}
            />
          </div>
          <div style={{ display: 'flex', gap: 10, marginTop: 14, alignItems: 'center' }}>
            <Button type="submit">Add pasted cards</Button>
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
      </Modal>
    </>
  );
}

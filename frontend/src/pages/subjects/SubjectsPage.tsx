import { useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { Button } from '../../components/ui/Button';
import { EmptyState, LoadingRow } from '../../components/ui/Primitives';
import { Modal } from '../../components/ui/Modal';
import { IconBook, IconEdit, IconPlus, IconTrash } from '../../components/ui/Icons';
import { useAsync } from '../../hooks/useAsync';
import { ApiError } from '../../lib/api';
import { subjectService } from '../../services/subjectService';
import type { Subject } from '../../types';

export function SubjectsPage() {
  const { data, loading, error, reload } = useAsync<Subject[]>(() => subjectService.list(), []);
  const [modalOpen, setModalOpen] = useState(false);
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const [editing, setEditing] = useState<Subject | null>(null);
  const [editName, setEditName] = useState('');
  const [editBusy, setEditBusy] = useState(false);
  const [editError, setEditError] = useState<string | null>(null);

  async function onCreate(e: FormEvent) {
    e.preventDefault();
    setFormError(null);
    setBusy(true);
    try {
      await subjectService.create(name.trim());
      setName('');
      setModalOpen(false);
      reload();
    } catch (err) {
      setFormError(err instanceof ApiError ? err.message : 'Could not create subject');
    } finally {
      setBusy(false);
    }
  }

  function openRename(subject: Subject) {
    setEditing(subject);
    setEditName(subject.name);
    setEditError(null);
  }

  async function onRename(e: FormEvent) {
    e.preventDefault();
    if (!editing) return;
    const next = editName.trim();
    if (!next) {
      setEditError('Subject name is required');
      return;
    }
    if (next === editing.name) {
      setEditing(null);
      return;
    }
    setEditError(null);
    setEditBusy(true);
    try {
      await subjectService.rename(editing.id, next);
      setEditing(null);
      reload();
    } catch (err) {
      setEditError(err instanceof ApiError ? err.message : 'Could not rename subject');
    } finally {
      setEditBusy(false);
    }
  }

  async function onDelete(subject: Subject) {
    if (!window.confirm(`Delete "${subject.name}"? Its sets will remain, without a subject.`)) {
      return;
    }
    try {
      await subjectService.remove(subject.id);
      reload();
    } catch (err) {
      window.alert(err instanceof ApiError ? err.message : 'Could not delete subject');
    }
  }

  return (
    <>
      <div className="page-header">
        <div>
          <h1>My subjects</h1>
          <p>Group your study sets by subject to see progress per subject.</p>
        </div>
        <Button onClick={() => setModalOpen(true)}>
          <IconPlus size={17} /> New subject
        </Button>
      </div>

      {loading ? (
        <LoadingRow large />
      ) : error ? (
        <EmptyState title="Could not load subjects" description={error} />
      ) : data && data.length > 0 ? (
        <div className="stack" style={{ gap: 10 }}>
          {data.map((subject) => (
            <div key={subject.id} className="list-row">
              <IconBook size={20} />
              <Link to={`/subjects/${subject.id}`} style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontWeight: 600 }}>{subject.name}</div>
                <div className="muted" style={{ fontSize: '0.825rem' }}>
                  {subject.setCount} set{subject.setCount === 1 ? '' : 's'}
                </div>
              </Link>
              <Button
                variant="ghost"
                size="sm"
                aria-label={`Rename ${subject.name}`}
                onClick={() => openRename(subject)}
              >
                <IconEdit size={16} />
              </Button>
              <Button
                variant="ghost"
                size="sm"
                aria-label={`Delete ${subject.name}`}
                onClick={() => void onDelete(subject)}
              >
                <IconTrash size={16} />
              </Button>
            </div>
          ))}
        </div>
      ) : (
        <EmptyState
          title="No subjects yet"
          description="Create your first subject to organize your study sets."
          action={<Button onClick={() => setModalOpen(true)}>Create subject</Button>}
        />
      )}

      <Modal
        open={modalOpen}
        title="New subject"
        onClose={() => setModalOpen(false)}
        footer={
          <>
            <Button variant="ghost" onClick={() => setModalOpen(false)}>
              Cancel
            </Button>
            <Button onClick={(e) => void onCreate(e as unknown as FormEvent)} disabled={busy}>
              {busy ? 'Creating…' : 'Create subject'}
            </Button>
          </>
        }
      >
        <form onSubmit={(e) => void onCreate(e)}>
          {formError ? <div className="form-error">{formError}</div> : null}
          <div className="field">
            <label htmlFor="subject-name">Subject name</label>
            <input
              id="subject-name"
              className="input"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Biology"
              maxLength={80}
              required
            />
          </div>
          <button type="submit" className="visually-hidden">
            Create
          </button>
        </form>
      </Modal>

      <Modal
        open={editing !== null}
        title="Rename subject"
        onClose={() => setEditing(null)}
        footer={
          <>
            <Button variant="ghost" onClick={() => setEditing(null)}>
              Cancel
            </Button>
            <Button onClick={(e) => void onRename(e as unknown as FormEvent)} disabled={editBusy}>
              {editBusy ? 'Saving…' : 'Save'}
            </Button>
          </>
        }
      >
        <form onSubmit={(e) => void onRename(e)}>
          {editError ? <div className="form-error">{editError}</div> : null}
          <div className="field">
            <label htmlFor="subject-rename">Subject name</label>
            <input
              id="subject-rename"
              className="input"
              value={editName}
              onChange={(e) => setEditName(e.target.value)}
              placeholder="e.g. Biology"
              maxLength={80}
              required
            />
          </div>
          <button type="submit" className="visually-hidden">
            Save
          </button>
        </form>
      </Modal>
    </>
  );
}

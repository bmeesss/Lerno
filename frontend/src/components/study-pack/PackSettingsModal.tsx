import { useState } from 'react';
import { Button } from '../ui/Button';
import { Modal } from '../ui/Modal';
import { useToast } from '../ui/Toast';
import { ApiError } from '../../lib/api';
import { studyPackService } from '../../services/studyPackService';
import { useAsync } from '../../hooks/useAsync';
import { subjectService } from '../../services/subjectService';
import type { StudyPackDetail, Visibility } from '../../types';

/**
 * Pack settings: title, subject, level, visibility and the optional exam date.
 * The exam date is what turns a pack into a study plan.
 */
export function PackSettingsModal({
  pack,
  open,
  onClose,
  onSaved,
}: {
  pack: StudyPackDetail;
  open: boolean;
  onClose: () => void;
  onSaved: () => void;
}) {
  const toast = useToast();
  const { data: subjects } = useAsync(() => subjectService.list(), [open]);
  const [form, setForm] = useState({
    title: pack.title,
    subjectId: pack.subjectId ?? '',
    level: pack.level,
    description: pack.description,
    visibility: pack.visibility as Visibility,
    examDate: pack.examDate ?? '',
  });
  const [busy, setBusy] = useState(false);

  async function save(event: React.FormEvent) {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    try {
      await studyPackService.update(pack.id, {
        title: form.title.trim(),
        subjectId: form.subjectId || null,
        level: form.level.trim(),
        description: form.description.trim(),
        visibility: form.visibility,
        examDate: form.examDate || null,
      });
      toast.show('Study pack updated', 'success');
      onSaved();
      onClose();
    } catch (error) {
      toast.show(error instanceof ApiError ? error.message : 'Could not save this pack', 'error');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal open={open} title="Study pack settings" onClose={onClose}>
      <form className="stack" style={{ gap: 14 }} onSubmit={(event) => void save(event)}>
        <label className="field">
          <span>Title</span>
          <input
            className="input"
            value={form.title}
            required
            maxLength={160}
            onChange={(event) => setForm((current) => ({ ...current, title: event.target.value }))}
          />
        </label>
        <label className="field">
          <span>Subject</span>
          <select
            className="select"
            value={form.subjectId}
            onChange={(event) => setForm((current) => ({ ...current, subjectId: event.target.value }))}
          >
            <option value="">No subject</option>
            {(subjects ?? []).map((subject) => (
              <option key={subject.id} value={subject.id}>
                {subject.name}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          <span>Level</span>
          <input
            className="input"
            value={form.level}
            maxLength={60}
            placeholder="VMBO-T, HAVO, VWO…"
            onChange={(event) => setForm((current) => ({ ...current, level: event.target.value }))}
          />
        </label>
        <label className="field">
          <span>Description</span>
          <textarea
            className="textarea"
            rows={2}
            value={form.description}
            maxLength={2000}
            onChange={(event) => setForm((current) => ({ ...current, description: event.target.value }))}
          />
        </label>
        <label className="field">
          <span>Exam date (optional)</span>
          <input
            className="input"
            type="date"
            value={form.examDate}
            onChange={(event) => setForm((current) => ({ ...current, examDate: event.target.value }))}
          />
        </label>
        <label className="field">
          <span>Visibility</span>
          <select
            className="select"
            value={form.visibility}
            onChange={(event) =>
              setForm((current) => ({ ...current, visibility: event.target.value as Visibility }))
            }
          >
            <option value="private">Private — only you</option>
            <option value="public">Public — discoverable</option>
          </select>
        </label>
        <div className="modal-actions">
          <Button type="button" variant="ghost" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button type="submit" disabled={busy || form.title.trim().length === 0}>
            {busy ? 'Saving…' : 'Save changes'}
          </Button>
        </div>
      </form>
    </Modal>
  );
}

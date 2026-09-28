import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Button, ButtonLink } from '../../components/ui/Button';
import { Badge, EmptyState, LoadingRow } from '../../components/ui/Primitives';
import { Modal } from '../../components/ui/Modal';
import { IconBook, IconLayers, IconPlus, IconSparkles, IconZap } from '../../components/ui/Icons';
import { useToast } from '../../components/ui/Toast';
import { useAsync } from '../../hooks/useAsync';
import { ApiError } from '../../lib/api';
import { examCountdownLabel, formatExamDate } from '../../lib/studyPackRoutes';
import { studyPackService } from '../../services/studyPackService';
import { subjectService } from '../../services/subjectService';
import { MasteryMeter } from '../../components/study-pack/PackBits';
import type { StudyPackSummary } from '../../types';

/**
 * Study Packs: everything the student is learning, with mastery, due work and
 * exam dates. The primary action stays "Add study material" (AI Studio).
 */
export function StudyPacksPage() {
  const toast = useToast();
  const { data: packs, loading, error, reload } = useAsync<StudyPackSummary[]>(
    () => studyPackService.list(),
    [],
  );
  const [creating, setCreating] = useState(false);

  return (
    <div className="stack" style={{ gap: 24 }}>
      <div className="page-header">
        <div>
          <span className="eyebrow-label">Study packs</span>
          <h1>Your learning, organised</h1>
          <p>Each pack holds your material, concepts, flashcards, practice and progress.</p>
        </div>
        <div className="pack-actions-row">
          <ButtonLink to="/ai/studio">
            <IconSparkles size={17} /> Add study material
          </ButtonLink>
          <Button variant="secondary" onClick={() => setCreating(true)}>
            <IconPlus size={17} /> New pack
          </Button>
        </div>
      </div>

      {loading ? (
        <LoadingRow large />
      ) : error ? (
        <EmptyState title="Could not load your study packs" description={error} />
      ) : (packs ?? []).length > 0 ? (
        <div className="set-grid">
          {(packs ?? []).map((pack) => (
            <article key={pack.id} className="card card-interactive pack-list-card">
              <div className="pack-list-head">
                <span className="set-card-subject">{pack.subjectName ?? 'No subject'}</span>
                {pack.examDate ? (
                  <Badge variant={pack.examDaysLeft !== null && pack.examDaysLeft <= 7 ? 'warning' : 'default'}>
                    {examCountdownLabel(pack.examDaysLeft)}
                  </Badge>
                ) : null}
              </div>
              <h2 className="pack-list-title">
                <Link to={`/study-packs/${pack.id}`}>{pack.title}</Link>
              </h2>
              <p className="pack-list-meta muted">
                {pack.sources} source{pack.sources === 1 ? '' : 's'} · {pack.flashcards} cards ·{' '}
                {pack.concepts} concepts · {pack.practiceQuestions} questions
              </p>
              <MasteryMeter percent={pack.masteryPercent} label="Mastery" compact />
              <div className="pack-list-badges">
                {pack.dueCards > 0 ? <Badge variant="accent">{pack.dueCards} due</Badge> : null}
                {pack.weakConcepts > 0 ? (
                  <Badge variant="warning">
                    {pack.weakConcepts} weak concept{pack.weakConcepts === 1 ? '' : 's'}
                  </Badge>
                ) : null}
                {pack.examDate ? <Badge>Exam {formatExamDate(pack.examDate)}</Badge> : null}
              </div>
              <div className="pack-list-actions">
                <ButtonLink to={`/study-packs/${pack.id}`} size="sm">
                  <IconZap size={16} /> Continue studying
                </ButtonLink>
                <Link to={`/study-packs/${pack.id}`} className="pack-list-open">
                  Open pack
                </Link>
              </div>
            </article>
          ))}

          <Link to="/ai/studio" className="card card-interactive pack-list-card pack-list-new">
            <span className="quick-icon quick-icon-blue">
              <IconPlus />
            </span>
            <strong>Add study material</strong>
            <span className="muted">
              Upload notes, a PDF or a set and Lerno builds the complete pack.
            </span>
          </Link>
        </div>
      ) : (
        <EmptyState
          icon={<IconLayers />}
          title="Your first study pack starts with your material"
          description="Add notes or a PDF. Lerno finds the concepts, builds flashcards and practice questions, and keeps track of what you have mastered."
          action={
            <div className="pack-actions-row">
              <ButtonLink to="/ai/studio">
                <IconSparkles size={17} /> Add study material
              </ButtonLink>
              <Button variant="secondary" onClick={() => setCreating(true)}>
                <IconBook size={17} /> Create an empty pack
              </Button>
            </div>
          }
        />
      )}

      <NewPackModal
        open={creating}
        onClose={() => setCreating(false)}
        onCreated={() => {
          setCreating(false);
          reload();
        }}
        onError={(message) => toast.show(message, 'error')}
      />
    </div>
  );
}

/** Minimal pack creation: title + optional subject/level/exam date. */
function NewPackModal({
  open,
  onClose,
  onCreated,
  onError,
}: {
  open: boolean;
  onClose: () => void;
  onCreated: () => void;
  onError: (message: string) => void;
}) {
  const { data: subjects } = useAsync(() => subjectService.list(), [open]);
  const [title, setTitle] = useState('');
  const [subjectId, setSubjectId] = useState('');
  const [level, setLevel] = useState('');
  const [examDate, setExamDate] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    try {
      await studyPackService.create({
        title: title.trim(),
        subjectId: subjectId || null,
        level: level.trim(),
        examDate: examDate || null,
      });
      setTitle('');
      setSubjectId('');
      setLevel('');
      setExamDate('');
      onCreated();
    } catch (error) {
      onError(error instanceof ApiError ? error.message : 'Could not create this study pack');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal open={open} title="New study pack" onClose={onClose}>
      <form className="stack" style={{ gap: 14 }} onSubmit={(event) => void submit(event)}>
        <label className="field">
          <span>Title</span>
          <input
            className="input"
            value={title}
            required
            maxLength={160}
            placeholder="Biologie H3"
            onChange={(event) => setTitle(event.target.value)}
          />
        </label>
        <label className="field">
          <span>Subject</span>
          <select className="select" value={subjectId} onChange={(event) => setSubjectId(event.target.value)}>
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
            value={level}
            maxLength={60}
            placeholder="VMBO-T, HAVO, VWO…"
            onChange={(event) => setLevel(event.target.value)}
          />
        </label>
        <label className="field">
          <span>Exam date (optional)</span>
          <input
            className="input"
            type="date"
            value={examDate}
            onChange={(event) => setExamDate(event.target.value)}
          />
        </label>
        <div className="modal-actions">
          <Button type="button" variant="ghost" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button type="submit" disabled={busy || title.trim().length === 0}>
            {busy ? 'Creating…' : 'Create pack'}
          </Button>
        </div>
      </form>
    </Modal>
  );
}

import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Button, ButtonLink } from '../ui/Button';
import { Badge, EmptyState } from '../ui/Primitives';
import { Modal } from '../ui/Modal';
import { IconEdit, IconPlus, IconSparkles, IconTrash } from '../ui/Icons';
import { useToast } from '../ui/Toast';
import { ApiError } from '../../lib/api';
import { studyPackService } from '../../services/studyPackService';
import { MasteryMeter, masteryLabel } from './PackBits';
import { PreviewEditor } from './PreviewEditor';
import type { PackPreview, StudyPackConcept, StudyPackDetail } from '../../types';

/**
 * Concepts: the units Lerno tracks mastery for. Each concept knows which cards
 * and questions belong to it and which source it came from.
 */
export function PackConcepts({ pack, onChanged }: { pack: StudyPackDetail; onChanged: () => void }) {
  const toast = useToast();
  const [preview, setPreview] = useState<PackPreview | null>(null);
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState<StudyPackConcept | null>(null);
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState({ name: '', explanation: '' });
  const [conceptFilter, setConceptFilter] = useState<'all' | 'weak' | 'strong' | 'new'>('all');

  const weakCount = pack.concepts.filter((concept) => concept.attempts > 0 && concept.masteryPercent < 60).length;
  const strongCount = pack.concepts.filter((concept) => concept.masteryPercent >= 80).length;
  const newCount = pack.concepts.filter((concept) => concept.attempts === 0).length;

  const concepts = [...pack.concepts]
    .filter((concept) => {
      if (conceptFilter === 'weak') return concept.attempts > 0 && concept.masteryPercent < 60;
      if (conceptFilter === 'strong') return concept.masteryPercent >= 80;
      if (conceptFilter === 'new') return concept.attempts === 0;
      return true;
    })
    .sort((a, b) => a.masteryPercent - b.masteryPercent || a.position - b.position);

  async function generate() {
    if (busy) return;
    setBusy(true);
    try {
      const result = await studyPackService.generate(pack.id, 'concepts', { count: 8 });
      if (result.target === 'concepts') setPreview(result);
    } catch (error) {
      toast.show(error instanceof ApiError ? error.message : 'Could not extract concepts', 'error');
    } finally {
      setBusy(false);
    }
  }

  async function saveConcept(event: React.FormEvent) {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    try {
      if (editing) {
        await studyPackService.updateConcept(pack.id, editing.id, form);
        toast.show('Concept updated', 'success');
      } else {
        await studyPackService.createConcept(pack.id, form);
        toast.show('Concept added', 'success');
      }
      setEditing(null);
      setCreating(false);
      setForm({ name: '', explanation: '' });
      onChanged();
    } catch (error) {
      toast.show(error instanceof ApiError ? error.message : 'Could not save this concept', 'error');
    } finally {
      setBusy(false);
    }
  }

  async function remove(concept: StudyPackConcept) {
    if (!window.confirm(`Delete "${concept.name}"? Cards and questions stay in the pack.`)) return;
    try {
      await studyPackService.removeConcept(pack.id, concept.id);
      toast.show('Concept deleted');
      onChanged();
    } catch (error) {
      toast.show(error instanceof ApiError ? error.message : 'Could not delete this concept', 'error');
    }
  }

  return (
    <section className="stack" style={{ gap: 20 }} aria-labelledby="pack-concepts-page-heading">
      <div className="section-title">
        <div>
          <h2 id="pack-concepts-page-heading">Concepts</h2>
          <p className="muted">
            The ideas behind your material. Mastery per concept drives practice, tests and review.
          </p>
        </div>
        {pack.isOwner ? (
          <div className="pack-actions-row">
            <Button variant="secondary" onClick={() => void generate()} disabled={busy}>
              <IconSparkles size={17} /> {busy ? 'Working…' : 'Generate concepts'}
            </Button>
            <Button
              onClick={() => {
                setCreating(true);
                setForm({ name: '', explanation: '' });
              }}
            >
              <IconPlus size={17} /> Add concept
            </Button>
          </div>
        ) : null}
      </div>

      {preview && preview.target === 'concepts' ? (
        <PreviewEditor
          packId={pack.id}
          preview={preview}
          onDiscard={() => setPreview(null)}
          onApplied={(message) => {
            setPreview(null);
            toast.show(message, 'success');
            onChanged();
          }}
        />
      ) : null}

      {pack.concepts.length > 0 ? (
        <>
          <div className="pack-filter-row" role="group" aria-label="Filter concepts">
            {(
              [
                ['all', `All ${pack.concepts.length}`],
                ['weak', `Weak ${weakCount}`],
                ['strong', `Strong ${strongCount}`],
                ['new', `Not started ${newCount}`],
              ] as const
            ).map(([value, label]) => (
              <button
                key={value}
                type="button"
                className={`chip${conceptFilter === value ? ' chip-active' : ''}`}
                aria-pressed={conceptFilter === value}
                onClick={() => setConceptFilter(value)}
              >
                {label}
              </button>
            ))}
          </div>

          <ul className="pack-concept-grid">
            {concepts.map((concept) => (
              <li key={concept.id} className="card pack-concept-card">
                <div className="pack-concept-head">
                  <h3>{concept.name}</h3>
                  {concept.origin === 'ai' ? <Badge>AI</Badge> : null}
                </div>
                {concept.explanation ? <p>{concept.explanation}</p> : null}
                <dl className="pack-concept-facts">
                  <div>
                    <dt>Cards</dt>
                    <dd>{concept.cardCount}</dd>
                  </div>
                  <div>
                    <dt>Questions</dt>
                    <dd>{concept.questionCount}</dd>
                  </div>
                  <div>
                    <dt>Attempts</dt>
                    <dd>{concept.attempts}</dd>
                  </div>
                </dl>
                <MasteryMeter percent={concept.masteryPercent} label="Mastery" compact />
                <p className="muted pack-concept-status">{masteryLabel(concept.masteryPercent)}</p>
                {concept.sourceTitle ? (
                  <p className="muted pack-concept-source">From: {concept.sourceTitle}</p>
                ) : null}
                <div className="pack-concept-actions">
                  <ButtonLink to={`?tab=practice&concept=${concept.id}`} size="sm" variant="secondary">
                    Practice
                  </ButtonLink>
                  {pack.isOwner ? (
                    <>
                      <button
                        type="button"
                        className="icon-btn"
                        aria-label={`Edit ${concept.name}`}
                        onClick={() => {
                          setEditing(concept);
                          setForm({ name: concept.name, explanation: concept.explanation });
                        }}
                      >
                        <IconEdit size={16} />
                      </button>
                      <button
                        type="button"
                        className="icon-btn icon-btn-danger"
                        aria-label={`Delete ${concept.name}`}
                        onClick={() => void remove(concept)}
                      >
                        <IconTrash size={16} />
                      </button>
                    </>
                  ) : null}
                </div>
              </li>
            ))}
          </ul>
        </>
      ) : (
        <EmptyState
          icon={<IconSparkles />}
          title="No concepts yet"
          description={
            pack.counts.readySources > 0
              ? 'Let Lerno find the key concepts in your material, or add one yourself.'
              : 'Add study material first, then Lerno can extract the key concepts.'
          }
          action={
            pack.isOwner ? (
              <div className="pack-actions-row">
                <Button onClick={() => void generate()} disabled={busy || pack.counts.readySources === 0}>
                  <IconSparkles size={17} /> Generate concepts
                </Button>
                <Link to="?tab=sources" className="btn btn-secondary">
                  Add material
                </Link>
              </div>
            ) : undefined
          }
        />
      )}

      <Modal
        open={creating || editing !== null}
        title={editing ? 'Edit concept' : 'Add concept'}
        onClose={() => {
          setCreating(false);
          setEditing(null);
        }}
      >
        <form className="stack" style={{ gap: 14 }} onSubmit={(event) => void saveConcept(event)}>
          <label className="field">
            <span>Name</span>
            <input
              className="input"
              value={form.name}
              maxLength={200}
              required
              onChange={(event) => setForm((current) => ({ ...current, name: event.target.value }))}
              placeholder="Newton's second law"
            />
          </label>
          <label className="field">
            <span>Explanation</span>
            <textarea
              className="textarea"
              rows={4}
              value={form.explanation}
              maxLength={1200}
              onChange={(event) => setForm((current) => ({ ...current, explanation: event.target.value }))}
              placeholder="Force equals mass times acceleration."
            />
          </label>
          <div className="modal-actions">
            <Button type="submit" disabled={busy || form.name.trim().length < 2}>
              {busy ? 'Saving…' : editing ? 'Save concept' : 'Add concept'}
            </Button>
          </div>
        </form>
      </Modal>
    </section>
  );
}

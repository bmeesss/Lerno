/**
 * "Genereer met AI" (#6).
 *
 * Flow: prompt → AI preview → the student reviews every card → "Set opslaan".
 * Nothing is created until the student presses save, and saving goes through
 * the normal `POST /api/sets` endpoint, so all existing validation applies.
 */
import { useCallback, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button } from '../ui/Button';
import { Modal } from '../ui/Modal';
import { Spinner } from '../ui/Primitives';
import { IconPlus, IconSparkles, IconTrash } from '../ui/Icons';
import { aiLearningService } from '../../services/aiLearningService';
import { studySetService } from '../../services/studySetService';
import { friendlyAiError } from './AiResultModal';
import type { AiGeneratedSetCard } from '../../types';

const CARD_COUNTS = [8, 12, 20, 30];

interface AiGenerateSetModalProps {
  open: boolean;
  onClose: () => void;
  /** Called after a successful save with the new set id. */
  onSaved?: (setId: string) => void;
}

export function AiGenerateSetModal({ open, onClose, onSaved }: AiGenerateSetModalProps) {
  const navigate = useNavigate();
  const [prompt, setPrompt] = useState('');
  const [cardCount, setCardCount] = useState(12);
  const [level, setLevel] = useState('');
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [preview, setPreview] = useState<{
    title: string;
    description: string;
    cards: AiGeneratedSetCard[];
  } | null>(null);

  const reset = useCallback(() => {
    setPrompt('');
    setLevel('');
    setCardCount(12);
    setPreview(null);
    setError(null);
  }, []);

  const generate = useCallback(async () => {
    if (prompt.trim().length < 8) {
      setError('Beschrijf in een paar woorden wat je wilt leren.');
      return;
    }
    setLoading(true);
    setError(null);
    setPreview(null);
    try {
      const result = await aiLearningService.generateSet(prompt.trim(), cardCount, level.trim());
      setPreview(result);
    } catch (err) {
      setError(friendlyAiError(err));
    } finally {
      setLoading(false);
    }
  }, [prompt, cardCount, level]);

  async function save(): Promise<void> {
    if (!preview || preview.cards.length === 0) return;
    setSaving(true);
    setError(null);
    try {
      const created = await studySetService.create({
        title: preview.title,
        subjectId: null,
        level: level.trim(),
        description: preview.description,
        visibility: 'private',
        tags: [],
        cards: preview.cards.map((card) => ({ question: card.front, answer: card.back })),
      });
      const setId = created.id;
      reset();
      onClose();
      if (onSaved) onSaved(setId);
      else navigate(`/sets/${setId}`);
    } catch (err) {
      setError(friendlyAiError(err));
    } finally {
      setSaving(false);
    }
  }

  function removeCard(index: number): void {
    setPreview((current) =>
      current ? { ...current, cards: current.cards.filter((_, i) => i !== index) } : current,
    );
  }

  function updateCard(index: number, patch: Partial<AiGeneratedSetCard>): void {
    setPreview((current) =>
      current
        ? {
            ...current,
            cards: current.cards.map((card, i) => (i === index ? { ...card, ...patch } : card)),
          }
        : current,
    );
  }

  return (
    <Modal
      open={open}
      title="Genereer met AI"
      onClose={() => {
        reset();
        onClose();
      }}
      footer={
        <>
          {preview ? (
            <Button onClick={() => void save()} disabled={saving || preview.cards.length === 0}>
              {saving ? 'Opslaan…' : `Set opslaan (${preview.cards.length})`}
            </Button>
          ) : (
            <Button onClick={() => void generate()} disabled={loading}>
              <IconSparkles size={15} /> Genereer
            </Button>
          )}
          <Button
            variant="ghost"
            onClick={() => {
              reset();
              onClose();
            }}
          >
            Annuleren
          </Button>
        </>
      }
    >
      <div className="ai-generate">
        {!preview ? (
          <>
            <label className="field">
              <span>Waar wil je een set over?</span>
              <textarea
                className="textarea"
                rows={3}
                value={prompt}
                maxLength={600}
                placeholder="Maak een flashcardset over de Franse Revolutie voor 3 mavo"
                onChange={(event) => setPrompt(event.target.value)}
              />
            </label>
            <label className="field">
              <span>Niveau (optioneel)</span>
              <input
                className="input"
                value={level}
                maxLength={60}
                placeholder="3 mavo"
                onChange={(event) => setLevel(event.target.value)}
              />
            </label>
            <div className="ai-control-group" role="group" aria-label="Aantal kaarten">
              {CARD_COUNTS.map((value) => (
                <button
                  key={value}
                  type="button"
                  className={value === cardCount ? 'ai-chip ai-chip-active' : 'ai-chip'}
                  aria-pressed={value === cardCount}
                  onClick={() => setCardCount(value)}
                >
                  {value} kaarten
                </button>
              ))}
            </div>
            <p className="muted" style={{ fontSize: '0.82rem' }}>
              Je krijgt eerst een preview. Er wordt niets opgeslagen tot je op “Set opslaan” klikt.
            </p>
          </>
        ) : null}

        {loading ? (
          <div className="ai-result-loading">
            <Spinner />
            <p className="muted">Lerno AI schrijft {cardCount} kaarten…</p>
          </div>
        ) : null}

        {error ? (
          <div className="form-error" role="alert">
            {error}
          </div>
        ) : null}

        {preview ? (
          <>
            <label className="field">
              <span>Titel</span>
              <input
                className="input"
                value={preview.title}
                maxLength={160}
                onChange={(event) =>
                  setPreview((current) =>
                    current ? { ...current, title: event.target.value } : current,
                  )
                }
              />
            </label>
            <p className="muted" style={{ fontSize: '0.85rem' }}>
              Controleer de kaarten — je kunt ze aanpassen of weghalen voor je opslaat.
            </p>
            <ul className="ai-generate-list">
              {preview.cards.map((card, index) => (
                <li key={index} className="ai-generate-card">
                  <div className="ai-generate-fields">
                    <input
                      className="input"
                      value={card.front}
                      maxLength={160}
                      aria-label={`Vraag ${index + 1}`}
                      onChange={(event) => updateCard(index, { front: event.target.value })}
                    />
                    <input
                      className="input"
                      value={card.back}
                      maxLength={300}
                      aria-label={`Antwoord ${index + 1}`}
                      onChange={(event) => updateCard(index, { back: event.target.value })}
                    />
                  </div>
                  <Button
                    variant="ghost"
                    size="sm"
                    aria-label={`Verwijder kaart ${index + 1}`}
                    onClick={() => removeCard(index)}
                  >
                    <IconTrash size={14} />
                  </Button>
                </li>
              ))}
            </ul>
            {preview.cards.length === 0 ? (
              <p className="muted">Je hebt alle kaarten weggehaald. Genereer opnieuw of sluit.</p>
            ) : null}
            <Button variant="secondary" size="sm" onClick={() => setPreview(null)}>
              <IconPlus size={14} /> Nieuwe prompt
            </Button>
          </>
        ) : null}
      </div>
    </Modal>
  );
}

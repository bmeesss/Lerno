import { useState } from 'react';
import { Button, ButtonLink } from '../ui/Button';
import { Badge, EmptyState } from '../ui/Primitives';
import { IconCards, IconClock, IconEdit, IconRefresh, IconSparkles } from '../ui/Icons';
import { useToast } from '../ui/Toast';
import { ApiError } from '../../lib/api';
import { studyPackService } from '../../services/studyPackService';
import { useAsync } from '../../hooks/useAsync';
import { studySetService } from '../../services/studySetService';
import { PreviewEditor } from './PreviewEditor';
import type { Card, PackPreview, StudyPackDetail } from '../../types';

/**
 * Flashcards: the pack's cards live in a classic study set, so the existing
 * study queue, spaced repetition and quiz flows keep working unchanged.
 */
export function PackFlashcards({ pack, onChanged }: { pack: StudyPackDetail; onChanged: () => void }) {
  const toast = useToast();
  const [preview, setPreview] = useState<PackPreview | null>(null);
  const [busy, setBusy] = useState(false);
  const { data: cards } = useAsync<Card[]>(
    () => (pack.legacySetId ? studySetService.get(pack.legacySetId).then((set) => set.cards) : Promise.resolve([])),
    [pack.legacySetId, pack.counts.flashcards],
  );

  /** Source title behind a generated card, for provenance ("Source: …"). */
  function sourceTitleFor(card: Card): string | null {
    if (!card.sourceId) return null;
    return pack.sources.find((source) => source.id === card.sourceId)?.title ?? null;
  }

  async function generate() {
    if (busy) return;
    setBusy(true);
    try {
      const result = await studyPackService.generate(pack.id, 'flashcards', { count: 10 });
      if (result.target === 'flashcards') setPreview(result);
    } catch (error) {
      toast.show(error instanceof ApiError ? error.message : 'Could not generate flashcards', 'error');
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="stack" style={{ gap: 20 }} aria-labelledby="pack-flashcards-heading">
      <div className="section-title">
        <div>
          <h2 id="pack-flashcards-heading">Flashcards</h2>
          <p className="muted">
            {pack.counts.flashcards} card{pack.counts.flashcards === 1 ? '' : 's'} ·{' '}
            {pack.progress.dueCards} due now · {pack.progress.studiedCards} studied
          </p>
        </div>
        {pack.isOwner ? (
          <div className="pack-actions-row">
            <Button variant="secondary" onClick={() => void generate()} disabled={busy}>
              <IconSparkles size={17} /> {busy ? 'Working…' : 'Generate flashcards'}
            </Button>
            {pack.legacySetId ? (
              <ButtonLink to={`/sets/${pack.legacySetId}/edit`} variant="secondary">
                <IconEdit size={17} /> Edit cards
              </ButtonLink>
            ) : null}
          </div>
        ) : null}
      </div>

      {preview && preview.target === 'flashcards' ? (
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

      <div className="card pack-study-cta">
        <div>
          <span className="eyebrow-label">{pack.progress.dueCards > 0 ? 'Due now' : 'Learn mode'}</span>
          <h3>
            {pack.progress.dueCards > 0
              ? `${pack.progress.dueCards} card${pack.progress.dueCards === 1 ? '' : 's'} ready for review`
              : 'Study the cards in this pack'}
          </h3>
          <p className="muted">
            Flashcards use spaced repetition: Lerno brings each card back right before you would forget it.
          </p>
        </div>
        <div className="pack-study-cta-actions">
          {pack.legacySetId ? (
            <ButtonLink to={`/sets/${pack.legacySetId}/study`}>
              <IconCards size={17} /> {pack.progress.dueCards > 0 ? 'Review cards' : 'Study flashcards'}
            </ButtonLink>
          ) : null}
          {pack.legacySetId ? (
            <ButtonLink to={`/sets/${pack.legacySetId}/practice`} variant="secondary">
              <IconRefresh size={17} /> Card practice
            </ButtonLink>
          ) : null}
          <ButtonLink to="?tab=practice" variant="ghost">
            <IconClock size={17} /> Question practice
          </ButtonLink>
        </div>
      </div>

      {(cards ?? []).length > 0 ? (
        <ul className="pack-card-list">
          {(cards ?? []).slice(0, 50).map((card, index) => (
            <li key={card.id} className="card-row">
              <div className="card-q">{card.question}</div>
              <div className="card-a">{card.answer}</div>
              <div className="card-row-meta">
                <span className="muted" style={{ fontSize: '0.8rem' }}>
                  #{index + 1}
                </span>
                {sourceTitleFor(card) ? (
                  <span className="muted pack-provenance" style={{ fontSize: '0.8rem' }}>
                    Generated from: {sourceTitleFor(card)}
                  </span>
                ) : null}
              </div>
            </li>
          ))}
        </ul>
      ) : (
        <EmptyState
          icon={<IconCards />}
          title="No flashcards yet"
          description="Generate cards from your sources, or add them by hand in the set editor."
          action={
            pack.isOwner ? (
              <Button onClick={() => void generate()} disabled={busy || pack.counts.readySources === 0}>
                <IconSparkles size={17} /> Generate flashcards
              </Button>
            ) : (
              <Badge>The owner has not added cards yet</Badge>
            )
          }
        />
      )}
    </section>
  );
}

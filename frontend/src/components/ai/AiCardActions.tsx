/**
 * "Vraag AI" on a single flashcard (#8): a compact menu with explain, example,
 * hint and a practice question. Only that card is sent to the AI.
 */
import { useCallback, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { IconBook, IconLightbulb, IconQuiz, IconSparkles } from '../ui/Icons';
import { aiLearningService } from '../../services/aiLearningService';
import { AiMenu, type AiMenuItem } from './AiMenu';
import { AiResultModal, friendlyAiError, type AiResultState } from './AiResultModal';
import type { AiCardAction } from '../../types';

interface AiCardActionsProps {
  cardId: string;
  setId: string;
  signedIn: boolean;
  /** Short label used in the modal title (the card question). */
  label: string;
}

const ACTIONS: { id: AiCardAction; label: string; title: string }[] = [
  { id: 'explain', label: 'Leg uit', title: 'Leg deze kaart uit' },
  { id: 'example', label: 'Geef voorbeeld', title: 'Voorbeeld bij deze kaart' },
  { id: 'hint', label: 'Geef hint', title: 'Hint bij deze kaart' },
  { id: 'practice', label: 'Maak oefenvraag', title: 'Oefenvraag bij deze kaart' },
];

export function AiCardActions({ cardId, setId, signedIn, label }: AiCardActionsProps) {
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState('Lerno AI');
  const [state, setState] = useState<AiResultState>({ status: 'idle' });
  const [action, setAction] = useState<AiCardAction | null>(null);

  const run = useCallback(
    async (next: AiCardAction) => {
      setAction(next);
      setTitle(ACTIONS.find((entry) => entry.id === next)?.title ?? 'Lerno AI');
      setOpen(true);
      setState({ status: 'loading' });
      try {
        const result = await aiLearningService.cardAction(cardId, setId, next);
        setState({ status: 'ready', text: result.text });
      } catch (err) {
        setState({ status: 'error', message: friendlyAiError(err) });
      }
    },
    [cardId, setId],
  );

  const icons: Record<AiCardAction, JSX.Element> = {
    explain: <IconBook size={14} />,
    example: <IconSparkles size={14} />,
    hint: <IconLightbulb size={14} />,
    practice: <IconQuiz size={14} />,
  };

  const items: AiMenuItem[] = ACTIONS.map((entry) => ({
    id: entry.id,
    label: entry.label,
    icon: icons[entry.id],
    onSelect: () => {
      if (!signedIn) {
        navigate('/login?next=' + encodeURIComponent(`/sets/${setId}`));
        return;
      }
      void run(entry.id);
    },
  }));

  return (
    <>
      <AiMenu
        compact
        label={`Vraag AI over: ${label}`}
        title="Vraag Lerno AI over deze kaart"
        items={items}
      />
      <AiResultModal
        open={open}
        title={title}
        hint="Lerno AI kijkt naar deze kaart…"
        state={state}
        onClose={() => setOpen(false)}
        onRetry={action ? () => void run(action) : undefined}
      />
    </>
  );
}

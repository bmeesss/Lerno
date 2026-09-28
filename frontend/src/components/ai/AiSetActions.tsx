/**
 * "Vraag Lerno AI" on a study set: a compact menu with the AI actions for that
 * set. Visible, but not in the way — it sits next to Study / Practice / Quiz.
 */
import { useCallback, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { IconBook, IconCheck, IconSparkles } from '../ui/Icons';
import { aiLearningService } from '../../services/aiLearningService';
import { AiMenu, type AiMenuItem } from './AiMenu';
import { AiQuestionsModal } from './AiQuestionsModal';
import { AiResultModal, friendlyAiError, type AiResultState } from './AiResultModal';

type SetAction = 'explain' | 'summarize';

interface AiSetActionsProps {
  setId: string;
  /** Guests cannot use AI (it needs an account + rate limiting). */
  signedIn: boolean;
  /** Extra actions added by later phases (questions, overhoor, quiz). */
  extraItems?: AiMenuItem[];
}

export function AiSetActions({ setId, signedIn, extraItems }: AiSetActionsProps) {
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState('Lerno AI');
  const [hint, setHint] = useState<string | undefined>(undefined);
  const [state, setState] = useState<AiResultState>({ status: 'idle' });
  const [action, setAction] = useState<SetAction | null>(null);
  const [questionsOpen, setQuestionsOpen] = useState(false);

  const run = useCallback(
    async (next: SetAction) => {
      setAction(next);
      setTitle(next === 'explain' ? 'Leg deze set uit' : 'Vat deze set samen');
      setHint(next === 'explain' ? 'Lerno AI leest je set…' : 'Lerno AI vat je set samen…');
      setOpen(true);
      setState({ status: 'loading' });
      try {
        const result =
          next === 'explain'
            ? await aiLearningService.explainSet(setId)
            : await aiLearningService.summarizeSet(setId);
        setState({ status: 'ready', text: result.explanation });
      } catch (err) {
        setState({ status: 'error', message: friendlyAiError(err) });
      }
    },
    [setId],
  );

  const items: AiMenuItem[] = [
    {
      id: 'explain',
      label: 'Leg deze set uit',
      icon: <IconBook size={15} />,
      onSelect: () => {
        if (!signedIn) {
          navigate('/login?next=' + encodeURIComponent(`/sets/${setId}`));
          return;
        }
        void run('explain');
      },
    },
    {
      id: 'summarize',
      label: 'Vat deze set samen',
      icon: <IconSparkles size={15} />,
      onSelect: () => {
        if (!signedIn) {
          navigate('/login?next=' + encodeURIComponent(`/sets/${setId}`));
          return;
        }
        void run('summarize');
      },
    },
    {
      id: 'questions',
      label: 'Maak oefenvragen',
      icon: <IconCheck size={15} />,
      onSelect: () => {
        if (!signedIn) {
          navigate('/login?next=' + encodeURIComponent(`/sets/${setId}`));
          return;
        }
        setQuestionsOpen(true);
      },
    },
    {
      id: 'overhoor',
      label: 'Overhoor mij',
      icon: <IconSparkles size={15} />,
      onSelect: () => {
        if (!signedIn) {
          navigate('/login?next=' + encodeURIComponent(`/sets/${setId}`));
          return;
        }
        navigate(`/sets/${setId}/ai-study`);
      },
    },
    ...(extraItems ?? []),
  ];

  return (
    <>
      <AiMenu label="Vraag Lerno AI" items={items} />
      <AiQuestionsModal
        open={questionsOpen}
        setId={setId}
        onClose={() => setQuestionsOpen(false)}
      />
      <AiResultModal
        open={open}
        title={title}
        hint={hint}
        state={state}
        onClose={() => setOpen(false)}
        onRetry={action ? () => void run(action) : undefined}
      />
    </>
  );
}

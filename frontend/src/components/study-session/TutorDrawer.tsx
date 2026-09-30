import { useEffect, useRef } from 'react';
import { Modal } from '../ui/Modal';
import { TutorChatView } from './TutorChatView';
import { useTutorChat } from './useTutorChat';
import type { TutorContext } from '../../types';

/**
 * The AI Tutor, opened from a concept or a study session. The server adds the
 * concept, the student's material and recent mistakes; every answer says
 * honestly whether it is "Based on your material" or a general explanation.
 */
export function TutorDrawer({
  open,
  onClose,
  packId,
  context,
  conceptName,
  initialMessage,
}: {
  open: boolean;
  onClose: () => void;
  packId: string;
  context: TutorContext;
  conceptName: string | null;
  /** Sent automatically when the drawer opens ("Explain this"). */
  initialMessage?: string;
}) {
  const chat = useTutorChat(packId, context);
  const { send, reset } = chat;
  const sentInitial = useRef<string | null>(null);
  const lastKey = useRef(`${context.conceptId ?? ''}|${context.itemId ?? ''}`);

  // A new concept is a new conversation: never carry an answer over to another question.
  useEffect(() => {
    const key = `${context.conceptId ?? ''}|${context.itemId ?? ''}`;
    if (key === lastKey.current) return;
    lastKey.current = key;
    sentInitial.current = null;
    reset();
  }, [context.conceptId, context.itemId, reset]);

  useEffect(() => {
    if (!open || !initialMessage || sentInitial.current === initialMessage) return;
    sentInitial.current = initialMessage;
    // Only the opening message is automatic; later questions are typed.
    void send(initialMessage, { history: [] });
  }, [open, initialMessage]);

  useEffect(() => {
    if (!open) sentInitial.current = null;
  }, [open]);

  return (
    <Modal
      open={open}
      title={conceptName ? `AI Tutor · ${conceptName}` : 'AI Tutor'}
      onClose={onClose}
    >
      <div className="tutor-drawer">
        <p className="muted tutor-drawer-note">
          {conceptName
            ? `Explains ${conceptName} from your own material, and tells you when it adds general knowledge.`
            : 'Answers come from your own material first.'}
        </p>
        <TutorChatView
          chat={chat}
          inputId="tutor-drawer-input"
          placeholder={conceptName ? `Ask about ${conceptName}…` : 'Ask a question…'}
        />
      </div>
    </Modal>
  );
}

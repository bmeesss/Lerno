import { useCallback, useState } from 'react';
import { ApiError } from '../../lib/api';
import { studyPackService } from '../../services/studyPackService';
import type { PackTutorReply, TutorContext } from '../../types';

export interface TutorMessage {
  role: 'user' | 'assistant';
  content: string;
  /** Present on tutor replies: whether it is based on the student's own material. */
  reply?: PackTutorReply;
}

/**
 * The state of one tutor conversation. It lives outside the dialog so closing
 * and reopening the drawer keeps the conversation; it only resets when the
 * student moves to another concept.
 */
export function useTutorChat(packId: string, context?: TutorContext) {
  const [messages, setMessages] = useState<TutorMessage[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastQuestion, setLastQuestion] = useState<string | null>(null);

  /** Sends one question. `retry` re-asks the last one without repeating it in the chat. */
  const send = useCallback(
    async (text: string, options: { retry?: boolean; history?: TutorMessage[] } = {}) => {
      const message = text.trim();
      if (!message || busy) return;
      const history = options.history ?? messages;
      setBusy(true);
      setError(null);
      setLastQuestion(message);
      if (!options.retry) setMessages([...history, { role: 'user', content: message }]);
      try {
        const reply = await studyPackService.tutor(
          packId,
          message,
          history.slice(-8).map(({ role, content }) => ({ role, content })),
          context,
        );
        setMessages((current) => [...current, { role: 'assistant', content: reply.reply, reply }]);
        setLastQuestion(null);
      } catch (caught) {
        setError(
          caught instanceof ApiError ? caught.message : 'The AI Tutor could not answer right now.',
        );
      } finally {
        setBusy(false);
      }
    },
    [busy, context, messages, packId],
  );

  const retry = useCallback(() => {
    if (lastQuestion) void send(lastQuestion, { retry: true });
  }, [lastQuestion, send]);

  const reset = useCallback(() => {
    setMessages([]);
    setError(null);
    setLastQuestion(null);
  }, []);

  return { messages, busy, error, lastQuestion, send, retry, reset };
}

export type TutorChat = ReturnType<typeof useTutorChat>;

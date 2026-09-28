/**
 * Lerno AI — built-in study assistant chat.
 *
 * Sends questions to the Lerno backend (POST /api/ai/chat) with the signed-in
 * user's session; the backend is the only side that talks to Groq. Keeps a
 * bounded in-page conversation so follow-up questions keep their context.
 */
import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { MarkdownLite } from '../../components/ai/MarkdownLite';
import { Button } from '../../components/ui/Button';
import { IconSend, IconSparkles } from '../../components/ui/Icons';
import { EmptyState } from '../../components/ui/Primitives';
import { AI_HISTORY_LIMIT, aiService } from '../../services/aiService';

interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

const SUGGESTIONS = [
  'Leg fotosynthese uit op mavo 3 niveau',
  'Maak 5 oefenvragen over de Franse Revolutie',
  'Wat is het verschil tussen aders en slagaders?',
  'Leg stap voor stap uit hoe ik 3x + 5 = 20 oplos',
];

export function LernoAiPage() {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    // Optional call: jsdom (tests) does not implement scrollIntoView.
    bottomRef.current?.scrollIntoView?.({ behavior: 'smooth', block: 'nearest' });
  }, [messages, sending]);

  async function send(text: string): Promise<void> {
    const message = text.trim();
    if (!message || sending) return;

    setError(null);
    // Newest last; bounded so requests stay small (backend bounds it too).
    const history = messages.slice(-AI_HISTORY_LIMIT).map(({ role, content }) => ({
      role,
      content,
    }));

    setMessages((prev) => [...prev, { role: 'user', content: message }]);
    setInput('');
    setSending(true);
    try {
      const { reply } = await aiService.chat(message, history);
      setMessages((prev) => [...prev, { role: 'assistant', content: reply }]);
    } catch (err) {
      // Failed send: undo the optimistic user message and put it back in the
      // input so nothing the student typed is lost.
      setMessages((prev) => prev.slice(0, -1));
      setInput(message);
      setError(
        err instanceof Error && err.message
          ? err.message
          : 'Lerno AI could not answer right now. Please try again.',
      );
    } finally {
      setSending(false);
      inputRef.current?.focus();
    }
  }

  function onKeyDown(event: KeyboardEvent<HTMLTextAreaElement>): void {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      void send(input);
    }
  }

  return (
    <div className="ai-chat">
      <div className="page-header">
        <div>
          <h1 className="ai-title">
            <IconSparkles /> Lerno AI
          </h1>
          <p>
            Ask anything about your school work — you get a clear explanation at your own level.
          </p>
        </div>
      </div>

      <div
        className="ai-messages"
        role="log"
        aria-live="polite"
        aria-label="Conversation with Lerno AI"
      >
        {messages.length === 0 && !sending ? (
          <EmptyState
            title="What do you want to learn?"
            description="Ask a question about any subject. Mention your level (for example mavo 3) and Lerno AI adapts its explanation to you."
            action={
              <div className="ai-suggestions">
                {SUGGESTIONS.map((suggestion) => (
                  <button
                    key={suggestion}
                    type="button"
                    className="chip ai-suggestion"
                    onClick={() => {
                      setInput(suggestion);
                      inputRef.current?.focus();
                    }}
                  >
                    {suggestion}
                  </button>
                ))}
              </div>
            }
          />
        ) : (
          <>
            {messages.map((message, index) => (
              <div
                key={index}
                className={`ai-msg ${message.role === 'user' ? 'ai-msg-user' : 'ai-msg-assistant'}`}
              >
                <span className="ai-msg-author">
                  {message.role === 'user' ? 'You' : 'Lerno AI'}
                </span>
                {message.role === 'assistant' ? (
                  <MarkdownLite text={message.content} />
                ) : (
                  <p className="ai-md-paragraph">{message.content}</p>
                )}
              </div>
            ))}
            {sending ? (
              <div className="ai-msg ai-msg-assistant" aria-label="Lerno AI is typing">
                <span className="ai-msg-author">Lerno AI</span>
                <div className="ai-typing" role="status" aria-label="Loading">
                  <span />
                  <span />
                  <span />
                </div>
              </div>
            ) : null}
          </>
        )}
        <div ref={bottomRef} />
      </div>

      {error ? (
        <div className="form-error" role="alert" style={{ marginBottom: 12 }}>
          {error}
        </div>
      ) : null}

      <div className="ai-composer">
        <textarea
          ref={inputRef}
          className="textarea ai-input"
          rows={2}
          value={input}
          placeholder="Ask your question…"
          maxLength={2000}
          autoFocus
          onChange={(event) => setInput(event.target.value)}
          onKeyDown={onKeyDown}
          aria-label="Your question for Lerno AI"
        />
        <Button
          variant="primary"
          onClick={() => void send(input)}
          disabled={sending || input.trim() === ''}
          aria-label="Send message"
        >
          <IconSend size={18} />
          Send
        </Button>
      </div>
      <p className="ai-hint">
        Enter to send · Shift + Enter for a new line · answers can be wrong, check what you learn.
      </p>
    </div>
  );
}

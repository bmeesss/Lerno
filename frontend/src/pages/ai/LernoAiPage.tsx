/**
 * Lerno AI — built-in study assistant chat.
 *
 * Sends questions to the Lerno backend (POST /api/ai/chat) with the signed-in
 * user's session; the backend is the only side that talks to Groq. Keeps a
 * bounded in-page conversation so follow-up questions keep their context.
 */
import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { MarkdownLite } from '../../components/ai/MarkdownLite';
import { IconSend, IconSparkles } from '../../components/ui/Icons';
import { AI_HISTORY_LIMIT, aiService } from '../../services/aiService';

interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

const MAX_INPUT_LENGTH = 2000;

/** Quick prompts students can build on — they fill the input, not send it. */
const SUGGESTIONS = [
  'Leg dit simpel uit: …',
  'Maak oefenvragen over …',
  'Help mij deze som oplossen: …',
  'Overhoor mij op …',
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

  // Composer grows with the question, capped by CSS max-height.
  useEffect(() => {
    const el = inputRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 180)}px`;
  }, [input]);

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

  const charactersLeft = MAX_INPUT_LENGTH - input.length;

  return (
    <div className="ai-page">
      <header className="ai-header">
        <span className="ai-header-icon" aria-hidden="true">
          <IconSparkles size={22} />
        </span>
        <div style={{ minWidth: 0 }}>
          <h1>Lerno AI</h1>
          <p>Your study assistant — ask anything, explained at your level.</p>
        </div>
      </header>

      <div
        className="ai-conversation"
        role="log"
        aria-live="polite"
        aria-label="Conversation with Lerno AI"
      >
        {messages.length === 0 && !sending ? (
          <div className="ai-welcome">
            <span className="ai-welcome-icon" aria-hidden="true">
              <IconSparkles size={26} />
            </span>
            <h2>What do you want to learn?</h2>
            <p>
              Ask a question about any subject. Mention your level — like mavo 3 or havo 4 — and the
              explanation adapts to you.
            </p>
            <div className="ai-suggestions">
              {SUGGESTIONS.map((suggestion) => (
                <button
                  key={suggestion}
                  type="button"
                  className="ai-suggestion"
                  onClick={() => {
                    setInput(suggestion);
                    inputRef.current?.focus();
                  }}
                >
                  {suggestion}
                </button>
              ))}
            </div>
          </div>
        ) : (
          <>
            {messages.map((message, index) => (
              <div
                key={index}
                className={`ai-msg ${message.role === 'user' ? 'ai-msg-user' : 'ai-msg-assistant'}`}
              >
                {message.role === 'assistant' ? (
                  <span className="ai-avatar" aria-hidden="true">
                    <IconSparkles size={15} />
                  </span>
                ) : null}
                <div className="ai-bubble">
                  {message.role === 'assistant' ? (
                    <MarkdownLite text={message.content} />
                  ) : (
                    <p className="ai-md-paragraph">{message.content}</p>
                  )}
                </div>
              </div>
            ))}
            {sending ? (
              <div className="ai-msg ai-msg-assistant" aria-label="Lerno AI is typing">
                <span className="ai-avatar" aria-hidden="true">
                  <IconSparkles size={15} />
                </span>
                <div className="ai-bubble">
                  <div className="ai-typing" role="status" aria-label="Loading">
                    <span />
                    <span />
                    <span />
                  </div>
                </div>
              </div>
            ) : null}
          </>
        )}
        <div ref={bottomRef} />
      </div>

      {error ? (
        <div className="form-error ai-error" role="alert">
          {error}
        </div>
      ) : null}

      <div className="ai-composer">
        <textarea
          ref={inputRef}
          className="textarea ai-input"
          rows={1}
          value={input}
          placeholder="Ask your question…"
          maxLength={MAX_INPUT_LENGTH}
          autoFocus
          onChange={(event) => setInput(event.target.value)}
          onKeyDown={onKeyDown}
          aria-label="Your question for Lerno AI"
        />
        <button
          type="button"
          className="ai-send"
          onClick={() => void send(input)}
          disabled={sending || input.trim() === ''}
          aria-label="Send message"
        >
          <IconSend size={18} />
        </button>
      </div>
      <div className="ai-hint">
        <span>
          Enter to send · Shift + Enter for a new line · answers can be wrong, check what you learn.
        </span>
        {charactersLeft <= 200 ? (
          <span aria-live="polite">{charactersLeft} characters left</span>
        ) : null}
      </div>
    </div>
  );
}

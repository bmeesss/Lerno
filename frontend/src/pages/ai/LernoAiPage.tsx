/**
 * Lerno AI — built-in study assistant chat.
 *
 * Sends questions to the Lerno backend (POST /api/ai/chat) with the signed-in
 * user's session; the backend is the only side that talks to Groq. Keeps a
 * bounded in-page conversation so follow-up questions keep their context.
 *
 * UX rules:
 * - never lose what the student typed (failed sends restore the question)
 * - one request at a time (double Enter / double click cannot duplicate it)
 * - no fake streaming: the backend answers once, so we show one clear loading
 *   state and then the full answer
 */
import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { Link } from 'react-router-dom';
import { MarkdownLite } from '../../components/ai/MarkdownLite';
import {
  IconArrowRight,
  IconBook,
  IconCopy,
  IconLightbulb,
  IconQuiz,
  IconRefresh,
  IconSend,
  IconSparkles,
} from '../../components/ui/Icons';
import { ApiError } from '../../lib/api';
import { AI_REQUEST_TIMEOUT_MS, aiService } from '../../services/aiService';
import { studyPackService } from '../../services/studyPackService';
import type { StudyPackSummary } from '../../types';

interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
}

/** Packs the student can ground the tutor in (answers from their own material). */
function usePackChoices(): StudyPackSummary[] {
  const [packs, setPacks] = useState<StudyPackSummary[]>([]);
  useEffect(() => {
    let active = true;
    studyPackService
      .list()
      .then((loaded) => {
        if (active) setPacks(loaded.slice(0, 3));
      })
      .catch(() => {
        // The tutor works without packs; a failing pack list must stay invisible.
      });
    return () => {
      active = false;
    };
  }, []);
  return packs;
}

const MAX_INPUT_LENGTH = 2000;

/** Quick prompts students can build on — they fill the input, not send it. */
const SUGGESTIONS = [
  {
    label: 'Leg dit simpel uit',
    description: 'Find the idea behind the words',
    Icon: IconBook,
    prompt: 'Leg dit simpel uit: ',
  },
  {
    label: 'Maak oefenvragen',
    description: 'Put what you know into practice',
    Icon: IconQuiz,
    prompt: 'Maak 5 oefenvragen over ',
  },
  {
    label: 'Overhoor mij',
    description: 'One question at a time',
    Icon: IconSparkles,
    prompt: 'Overhoor mij over ',
  },
  {
    label: 'Help met deze som',
    description: 'Work it out, step by step',
    Icon: IconLightbulb,
    prompt: 'Help mij deze som oplossen, stap voor stap: ',
  },
];

/** Turns an API error into a sentence a student can act on — no internals. */
function friendlyError(error: unknown): string {
  if (error instanceof ApiError) {
    switch (error.code) {
      case 'RATE_LIMITED':
        return 'You are sending questions a bit fast. Wait a moment and try again.';
      case 'AI_TIMEOUT':
        return 'The AI took too long to answer. Please try again.';
      case 'AI_UNAVAILABLE':
        return 'The AI is temporarily unavailable. Please try again in a moment.';
      case 'UNAUTHORIZED':
        return 'Your session has expired. Please log in again to continue.';
      case 'VALIDATION_ERROR':
        return 'That question could not be sent. Try a shorter message.';
      case 'NETWORK':
        return 'Could not reach Lerno. Check your connection and try again.';
      default:
        break;
    }
  }
  if (error instanceof Error && error.name === 'AbortError') {
    return 'The AI took too long to answer. Please try again.';
  }
  return 'The AI is temporarily unavailable. Please try again in a moment.';
}

/** Copies text, with a fallback for browsers (and tests) without the async API. */
async function copyToClipboard(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // Fall through to the legacy path.
  }
  try {
    const area = document.createElement('textarea');
    area.value = text;
    area.setAttribute('readonly', 'true');
    area.style.position = 'fixed';
    area.style.top = '-1000px';
    area.style.opacity = '0';
    document.body.appendChild(area);
    area.select();
    const ok = document.execCommand?.('copy') ?? false;
    document.body.removeChild(area);
    return ok;
  } catch {
    return false;
  }
}

export function LernoAiPage() {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);

  const bottomRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const packChoices = usePackChoices();
  const conversationRef = useRef<HTMLDivElement>(null);

  // Refs keep the newest state available inside async handlers without
  // re-creating the send callback on every keystroke.
  const messagesRef = useRef<ChatMessage[]>([]);
  const sendingRef = useRef(false);
  const stickToBottom = useRef(true);
  const inFlight = useRef<AbortController | null>(null);
  const nextId = useRef(0);

  const sendMessage = useCallback(async (raw: string, history?: ChatMessage[]): Promise<void> => {
    const message = raw.trim();
    if (!message || sendingRef.current) return;

    const base = history ?? messagesRef.current;
    const priorTurns = base.map(({ role, content }) => ({ role, content }));
    const userMessage: ChatMessage = {
      id: `m${(nextId.current += 1)}`,
      role: 'user',
      content: message,
    };

    sendingRef.current = true;
    setSending(true);
    setError(null);
    setCopiedId(null);
    setMessages((prev) => [...prev, userMessage]);
    setInput('');
    stickToBottom.current = true;

    const controller = new AbortController();
    inFlight.current = controller;
    const timeout = setTimeout(() => controller.abort(), AI_REQUEST_TIMEOUT_MS);

    try {
      const { reply } = await aiService.chat(message, priorTurns, controller.signal);
      setMessages((prev) => [
        ...prev,
        { id: `m${(nextId.current += 1)}`, role: 'assistant', content: reply },
      ]);
    } catch (err) {
      // Failed send: undo the optimistic user message and put the question back
      // in the input so nothing the student typed is lost.
      setMessages((prev) => prev.filter((entry) => entry.id !== userMessage.id));
      // Restore the question, but never overwrite something typed meanwhile.
      setInput((current) => (current.trim() === '' ? message : current));
      setError(friendlyError(err));
    } finally {
      clearTimeout(timeout);
      inFlight.current = null;
      sendingRef.current = false;
      setSending(false);
      inputRef.current?.focus();
    }
  }, []);

  const send = useCallback(
    (raw: string) => {
      void sendMessage(raw);
    },
    [sendMessage],
  );

  const { lastUserIndex, lastAssistantId } = useMemo(() => {
    let userIndex = -1;
    let assistantId: string | null = null;
    for (let index = messages.length - 1; index >= 0; index -= 1) {
      const entry = messages[index]!;
      if (entry.role === 'user' && userIndex === -1) userIndex = index;
      if (entry.role === 'assistant' && assistantId === null) assistantId = entry.id;
    }
    return { lastUserIndex: userIndex, lastAssistantId: assistantId };
  }, [messages]);

  /** Re-asks the last question, dropping the answer it produced. */
  const regenerate = useCallback(() => {
    if (sendingRef.current || lastUserIndex === -1) return;
    const question = messages[lastUserIndex]!.content;
    const history = messages.slice(0, lastUserIndex);
    setMessages(history);
    void sendMessage(question, history);
  }, [lastUserIndex, messages, sendMessage]);

  // Keep the newest conversation available to async handlers.
  useEffect(() => {
    messagesRef.current = messages;
  }, [messages]);

  // Composer grows with the question, capped by CSS max-height.
  useEffect(() => {
    const el = inputRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 180)}px`;
  }, [input]);

  // Follow new messages, but never yank the view while the student reads back.
  useEffect(() => {
    if (!stickToBottom.current) return;
    bottomRef.current?.scrollIntoView?.({
      behavior: window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth',
      block: 'nearest',
    });
  }, [messages, sending]);

  // Never leave a request running after the student navigates away.
  useEffect(() => {
    return () => {
      sendingRef.current = false;
      inFlight.current?.abort();
    };
  }, []);

  function onScroll(): void {
    const el = conversationRef.current;
    if (!el) return;
    const distance = el.scrollHeight - el.scrollTop - el.clientHeight;
    stickToBottom.current = distance < 120;
  }

  function onKeyDown(event: KeyboardEvent<HTMLTextAreaElement>): void {
    if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
      event.preventDefault();
      send(input);
    }
  }

  async function onCopy(message: ChatMessage): Promise<void> {
    const ok = await copyToClipboard(message.content);
    if (!ok) {
      setError('Copying did not work. You can select the text and copy it manually.');
      return;
    }
    setCopiedId(message.id);
    window.setTimeout(
      () => setCopiedId((current) => (current === message.id ? null : current)),
      2000,
    );
  }

  const charactersLeft = MAX_INPUT_LENGTH - input.length;
  const hasConversation = messages.length > 0;

  return (
    <div className="ai-page">
      <header className="ai-header">
        <span className="ai-header-icon" aria-hidden="true">
          <IconSparkles size={22} />
        </span>
        <div className="ai-header-text">
          <h1>Lerno AI</h1>
          <p>Your personal study assistant</p>
        </div>
        <Link to="/ai/studio" className="btn btn-secondary btn-sm ai-studio-link">
          Open Study Studio
        </Link>
        {hasConversation ? (
          <button
            type="button"
            className="ai-new-chat"
            onClick={() => {
              setMessages([]);
              setError(null);
              setCopiedId(null);
              inputRef.current?.focus();
            }}
            disabled={sending}
          >
            New chat
          </button>
        ) : null}
      </header>

      <div
        className="ai-conversation"
        ref={conversationRef}
        onScroll={onScroll}
        role="log"
        aria-live="polite"
        aria-busy={sending}
        aria-label="Conversation with Lerno AI"
      >
        {!hasConversation && !sending ? (
          <div className="ai-welcome">
            <span className="ai-welcome-icon" aria-hidden="true">
              <IconSparkles size={26} />
            </span>
            <h2>What do you want to learn?</h2>
            <p>
              Big question or small stumbling block? Start here. Tell me your school level, and
              we’ll take it one step at a time.
            </p>
            <div className="ai-suggestions">
              {SUGGESTIONS.map((suggestion) => (
                <button
                  key={suggestion.label}
                  type="button"
                  className="ai-suggestion"
                  aria-label={suggestion.label}
                  onClick={() => {
                    setInput(suggestion.prompt);
                    inputRef.current?.focus();
                  }}
                >
                  <suggestion.Icon size={20} />
                  <span>
                    <strong>{suggestion.label}</strong>
                    <small>{suggestion.description}</small>
                  </span>
                  <IconArrowRight size={16} />
                </button>
              ))}
            </div>
            {packChoices.length > 0 ? (
              <div className="ai-pack-strip">
                <span className="pack-label">Or ask about a study pack</span>
                <div className="pack-chip-row">
                  {packChoices.map((pack) => (
                    <Link key={pack.id} to={`/study-packs/${pack.id}?tab=tutor`} className="chip">
                      {pack.title}
                    </Link>
                  ))}
                </div>
              </div>
            ) : null}
          </div>
        ) : (
          <>
            {messages.map((message) => (
              <div
                key={message.id}
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
                  {message.role === 'assistant' && !sending ? (
                    <div className="ai-msg-actions">
                      <button
                        type="button"
                        className="ai-msg-action"
                        onClick={() => void onCopy(message)}
                        aria-label="Copy answer"
                      >
                        <IconCopy size={14} />
                        <span>{copiedId === message.id ? 'Copied' : 'Copy'}</span>
                      </button>
                      {message.id === lastAssistantId ? (
                        <button
                          type="button"
                          className="ai-msg-action"
                          onClick={regenerate}
                          aria-label="Regenerate answer"
                        >
                          <IconRefresh size={14} />
                          <span>Regenerate</span>
                        </button>
                      ) : null}
                    </div>
                  ) : null}
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
          <span>{error}</span>
          <button
            type="button"
            className="ai-retry"
            onClick={() => (input.trim() ? send(input) : regenerate())}
            disabled={sending}
          >
            Try again
          </button>
        </div>
      ) : null}

      <div className="ai-composer">
        <textarea
          id="ai-input"
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
          aria-describedby="ai-hint"
        />
        <button
          type="button"
          className="ai-send"
          onClick={() => send(input)}
          disabled={sending || input.trim() === ''}
          aria-label="Send message"
        >
          <IconSend size={18} />
        </button>
      </div>
      <div className="ai-hint" id="ai-hint">
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

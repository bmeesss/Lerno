import { useState, type ReactNode } from 'react';
import { Button } from '../ui/Button';
import { Badge } from '../ui/Primitives';
import { IconSend } from '../ui/Icons';
import { MarkdownLite } from '../ai/MarkdownLite';
import type { TutorChat, TutorMessage } from './useTutorChat';

/**
 * Says where a tutor reply comes from. "Based on your material" is only shown
 * when the server found a real source for the answer; anything else is labelled
 * as a general explanation, so the student never mistakes one for the other.
 */
export function TutorProvenance({ message }: { message: TutorMessage }) {
  const reply = message.reply;
  return (
    <p className="tutor-provenance">
      {reply?.basedOnMaterial ? (
        <>
          <Badge variant="accent">Based on your material</Badge>
          {reply.citations?.map((citation) => (
            <span key={`${citation.sourceId}-${citation.ref ?? ''}`} className="muted">
              {' '}
              {citation.title}
              {citation.ref ? ` · ${citation.ref}` : ''}
            </span>
          ))}
        </>
      ) : (
        <Badge>General explanation — not from your material</Badge>
      )}
    </p>
  );
}

/** The conversation log, the retry on errors and the question form. */
export function TutorChatView({
  chat,
  inputId,
  placeholder,
  disabled = false,
  empty,
}: {
  chat: TutorChat;
  inputId: string;
  placeholder: string;
  disabled?: boolean;
  /** Shown while the conversation is empty (suggestions, hints). */
  empty?: ReactNode;
}) {
  const [input, setInput] = useState('');

  return (
    <div className="tutor-chat">
      <div
        className="tutor-drawer-log"
        role="log"
        aria-live="polite"
        aria-label="AI Tutor conversation"
      >
        {chat.messages.length === 0 && !chat.busy ? empty : null}
        {chat.messages.map((message, index) => (
          <div
            key={`${message.role}-${index}`}
            className={`tutor-message tutor-message-${message.role}`}
          >
            {message.role === 'assistant' ? (
              <>
                <MarkdownLite text={message.content} />
                <TutorProvenance message={message} />
              </>
            ) : (
              <p>{message.content}</p>
            )}
          </div>
        ))}
        {chat.busy ? (
          <p className="muted" role="status">
            Lerno AI is reading your material…
          </p>
        ) : null}
      </div>

      {chat.error ? (
        <div className="session-error" role="alert">
          <p>{chat.error}</p>
          {chat.lastQuestion ? (
            <Button variant="secondary" size="sm" onClick={chat.retry}>
              Try again
            </Button>
          ) : null}
        </div>
      ) : null}

      <form
        className="tutor-drawer-form"
        onSubmit={(event) => {
          event.preventDefault();
          const text = input;
          setInput('');
          void chat.send(text);
        }}
      >
        <label className="visually-hidden" htmlFor={inputId}>
          Ask the AI Tutor
        </label>
        <input
          id={inputId}
          className="input"
          value={input}
          maxLength={2000}
          disabled={disabled}
          onChange={(event) => setInput(event.target.value)}
          placeholder={placeholder}
        />
        <Button type="submit" disabled={disabled || chat.busy || input.trim().length === 0}>
          <IconSend size={17} /> Send
        </Button>
      </form>
    </div>
  );
}

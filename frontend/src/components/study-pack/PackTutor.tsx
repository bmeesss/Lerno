import { useState } from 'react';
import { Button } from '../ui/Button';
import { IconSend, IconSparkles } from '../ui/Icons';
import { useToast } from '../ui/Toast';
import { ApiError } from '../../lib/api';
import { MarkdownLite } from '../ai/MarkdownLite';
import { studyPackService } from '../../services/studyPackService';
import type { StudyPackDetail } from '../../types';

interface Message {
  role: 'user' | 'assistant';
  content: string;
}

/** The pack's tutor answers from this pack's material, not from thin air. */
export function PackTutor({ pack }: { pack: StudyPackDetail }) {
  const toast = useToast();
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);

  const suggestions = [
    pack.concepts[0] ? `Explain ${pack.concepts[0].name} in simple words` : 'Explain the main idea',
    pack.progress.weakConcepts[0]
      ? `Why do I keep getting ${pack.progress.weakConcepts[0].name} wrong?`
      : 'What are the most important concepts here?',
    'Give me a short overview of this material',
  ];

  async function send(message: string) {
    const text = message.trim();
    if (!text || busy) return;
    const history = messages.slice(-8);
    setMessages((current) => [...current, { role: 'user', content: text }]);
    setInput('');
    setBusy(true);
    try {
      const reply = await studyPackService.tutor(pack.id, text, history);
      setMessages((current) => [...current, { role: 'assistant', content: reply.reply }]);
    } catch (error) {
      toast.show(
        error instanceof ApiError ? error.message : 'The AI tutor could not answer right now',
        'error',
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="stack" style={{ gap: 18 }} aria-labelledby="pack-tutor-heading">
      <div className="section-title">
        <div>
          <h2 id="pack-tutor-heading">AI Tutor · {pack.title}</h2>
          <p className="muted">
            Answers come from the {pack.counts.readySources} source
            {pack.counts.readySources === 1 ? '' : 's'} in this pack
            {pack.subjectName ? ` — think “${pack.subjectName}”` : ''}. If the material does not cover
            something, Lerno says so instead of guessing.
          </p>
        </div>
      </div>

      {pack.counts.readySources === 0 ? (
        <p className="muted">
          Add a source with readable text first, then the tutor can answer from your material.
        </p>
      ) : null}

      <div className="pack-chat" role="log" aria-live="polite">
        {messages.length === 0 ? (
          <div className="pack-chat-empty">
            <IconSparkles size={22} />
            <p>Ask anything about this material. Nothing outside this pack is presented as course content.</p>
            <div className="pack-chip-row">
              {suggestions.map((suggestion) => (
                <button
                  key={suggestion}
                  type="button"
                  className="chip"
                  onClick={() => void send(suggestion)}
                  disabled={busy || pack.counts.readySources === 0}
                >
                  {suggestion}
                </button>
              ))}
            </div>
          </div>
        ) : (
          messages.map((message, index) => (
            <div key={`${message.role}-${index}`} className={`pack-chat-msg pack-chat-${message.role}`}>
              {message.role === 'assistant' ? <MarkdownLite text={message.content} /> : <p>{message.content}</p>}
            </div>
          ))
        )}
        {busy ? (
          <div className="pack-chat-msg pack-chat-assistant" role="status">
            <p className="muted">Lerno AI is reading your material…</p>
          </div>
        ) : null}
      </div>

      <form
        className="pack-chat-form"
        onSubmit={(event) => {
          event.preventDefault();
          void send(input);
        }}
      >
        <label className="visually-hidden" htmlFor="pack-tutor-input">
          Ask about this study pack
        </label>
        <input
          id="pack-tutor-input"
          className="input"
          value={input}
          maxLength={2000}
          onChange={(event) => setInput(event.target.value)}
          placeholder={`Ask about ${pack.title}…`}
          disabled={pack.counts.readySources === 0}
        />
        <Button type="submit" disabled={busy || input.trim().length === 0 || pack.counts.readySources === 0}>
          <IconSend size={17} /> Send
        </Button>
      </form>
    </section>
  );
}

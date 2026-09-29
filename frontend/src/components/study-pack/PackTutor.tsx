import { useMemo } from 'react';
import { IconSparkles } from '../ui/Icons';
import { TutorChatView } from '../study-session/TutorChatView';
import { useTutorChat } from '../study-session/useTutorChat';
import type { StudyPackDetail } from '../../types';

/**
 * The pack's tutor answers from this pack's material, not from thin air. Opened
 * from a concept (`?tab=tutor&concept=…`) it also knows which concept the
 * student is on and which questions they missed, and every reply says whether
 * it is "Based on your material" or a general explanation.
 */
export function PackTutor({ pack, focusConceptId }: { pack: StudyPackDetail; focusConceptId?: string }) {
  const focus = pack.concepts.find((concept) => concept.id === focusConceptId) ?? null;
  const context = useMemo(() => (focus ? { conceptId: focus.id } : undefined), [focus]);
  const chat = useTutorChat(pack.id, context);
  const noSource = pack.counts.readySources === 0;

  const suggestions = focus
    ? [
        `Explain ${focus.name} in simple words`,
        `Give me an example of ${focus.name}`,
        `Why do I keep getting ${focus.name} wrong?`,
      ]
    : [
        pack.concepts[0] ? `Explain ${pack.concepts[0].name} in simple words` : 'Explain the main idea',
        pack.progress.weakConcepts[0]
          ? `Why do I keep getting ${pack.progress.weakConcepts[0].name} wrong?`
          : 'What are the most important concepts here?',
        'Give me a short overview of this material',
      ];

  return (
    <section className="stack" style={{ gap: 18 }} aria-labelledby="pack-tutor-heading">
      <div className="section-title">
        <div>
          <h2 id="pack-tutor-heading">
            AI Tutor · {focus ? focus.name : pack.title}
          </h2>
          <p className="muted">
            Answers come from the {pack.counts.readySources} source
            {pack.counts.readySources === 1 ? '' : 's'} in this pack
            {pack.subjectName ? ` — think “${pack.subjectName}”` : ''}. If the material does not cover
            something, Lerno says so instead of guessing — and tells you when an answer is a general
            explanation.
          </p>
        </div>
      </div>

      {noSource ? (
        <p className="muted">
          Add a source with readable text first, then the tutor can answer from your material.
        </p>
      ) : null}

      <TutorChatView
        chat={chat}
        inputId="pack-tutor-input"
        placeholder={`Ask about ${focus ? focus.name : pack.title}…`}
        disabled={noSource}
        empty={
          <div className="pack-chat-empty">
            <IconSparkles size={22} />
            <p>Ask anything about this material. Nothing outside this pack is presented as course content.</p>
            <div className="pack-chip-row">
              {suggestions.map((suggestion) => (
                <button
                  key={suggestion}
                  type="button"
                  className="chip"
                  onClick={() => void chat.send(suggestion)}
                  disabled={chat.busy || noSource}
                >
                  {suggestion}
                </button>
              ))}
            </div>
          </div>
        }
      />
    </section>
  );
}

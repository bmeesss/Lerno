import { useEffect, useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { MarkdownLite } from '../ai/MarkdownLite';
import { Button, ButtonLink } from '../ui/Button';
import { IconArrowRight, IconCheck, IconPlus, IconTrash } from '../ui/Icons';
import { aiStudioService, type StudioActionSource, type StudioCardsResult, type StudioChatMessage, type StudioFlashcard, type StudioPracticeQuestion, type StudioQuizQuestion, type StudioStudyPlan, type StudioSummary } from '../../services/aiStudioService';
import { studySetService } from '../../services/studySetService';
import { studyPackService } from '../../services/studyPackService';

export function StudioSummaryView({ summary }: { summary: StudioSummary }) {
  return (
    <article className="studio-result-card">
      <span className="studio-result-kicker">Summary · {summary.sourceTitle}</span>
      <h3>{summary.title}</h3>
      <div className="studio-summary-copy"><MarkdownLite text={summary.summary} /></div>
      <div className="studio-summary-grid">
        <section>
          <h4>Key points</h4>
          <ul className="studio-key-points">
            {summary.keyPoints.map((point, index) => <li key={`${index}-${point}`}>{point}</li>)}
          </ul>
        </section>
        {summary.terms.length ? (
          <section>
            <h4>Useful terms</h4>
            <dl className="studio-terms">
              {summary.terms.map((item) => <div key={item.term}><dt>{item.term}</dt><dd>{item.definition}</dd></div>)}
            </dl>
          </section>
        ) : null}
      </div>
      <p className="studio-result-note">Generated from your selected source. Review it before using it to study.</p>
    </article>
  );
}

export function StudioPlanView({ plan }: { plan: StudioStudyPlan }) {
  return (
    <article className="studio-result-card studio-plan-preview">
      <span className="studio-result-kicker">Study plan · preview</span>
      <h3>{plan.title}</h3>
      <p className="studio-result-intro">{plan.overview}</p>
      <ol className="studio-plan-days">
        {plan.sessions.map((session) => (
          <li key={session.day}>
            <div className="studio-plan-day-heading">
              <h4>Day {session.day}: {session.focus}</h4>
              <span>{session.minutes} min</span>
            </div>
            <ul>{session.activities.map((activity, index) => <li key={`${index}-${activity}`}>{activity}</li>)}</ul>
          </li>
        ))}
      </ol>
      <p className="studio-result-note">Plan generated from your selected source. Adjust it to fit your schedule; nothing has been saved.</p>
    </article>
  );
}

interface CardsEditorProps {
  result: StudioCardsResult;
  onSaved: (setId: string) => void;
  /** When present, the cards can become the first content of a Study Pack. */
  source?: StudioActionSource | null;
}

export function StudioCardsEditor({ result, onSaved, source = null }: CardsEditorProps) {
  const [title, setTitle] = useState(result.title);
  const [description, setDescription] = useState(result.description);
  const [cards, setCards] = useState(result.cards);
  const [saving, setSaving] = useState(false);
  const [savedSetId, setSavedSetId] = useState<string | null>(null);
  const [createdPackId, setCreatedPackId] = useState<string | null>(null);
  const [packSaving, setPackSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setTitle(result.title);
    setDescription(result.description);
    setCards(result.cards);
    setSavedSetId(null);
    setCreatedPackId(null);
    setError(null);
  }, [result]);

  function changeCard(index: number, key: keyof StudioFlashcard, value: string) {
    setCards((current) => current.map((card, cardIndex) => cardIndex === index ? { ...card, [key]: value } : card));
  }

  function removeCard(index: number) {
    setCards((current) => current.filter((_, cardIndex) => cardIndex !== index));
  }

  function addCard() {
    if (cards.length >= 30) return;
    setCards((current) => [...current, { front: '', back: '' }]);
  }

  function validCardsOrError() {
    const validCards = cards.filter((card) => card.front.trim() && card.back.trim());
    if (!title.trim() || validCards.length === 0 || validCards.length !== cards.length) {
      setError('Add a title and complete or remove every card before saving.');
      return null;
    }
    const normalizedFronts = validCards.map((card) => card.front.trim().toLowerCase().replace(/\\s+/g, ' '));
    if (new Set(normalizedFronts).size !== normalizedFronts.length) {
      setError('Each flashcard needs a distinct front. Edit or remove the duplicate card.');
      return null;
    }
    return validCards;
  }

  /**
   * Turns this preview into a Study Pack: the source becomes the pack's first
   * material, the cards its first flashcards. Nothing already in the pack is
   * touched, and the classic set/card model keeps working underneath.
   */
  async function createStudyPack() {
    const validCards = validCardsOrError();
    if (!validCards) return;
    setPackSaving(true);
    setError(null);
    try {
      const pack = await studyPackService.create({
        title: title.trim(),
        description: description.trim(),
        level: '',
        visibility: 'private',
        source:
          source?.type === 'set'
            ? { type: 'set', setId: source.setId, title: title.trim() }
            : source
              ? { type: source.type, title: source.title || title.trim(), text: source.text, pageCount: source.pageCount }
              : undefined,
        cards: validCards.map((card) => ({ question: card.front.trim(), answer: card.back.trim() })),
      });
      setCreatedPackId(pack.id);
    } catch (packError) {
      setError(packError instanceof Error ? packError.message : 'Could not create the study pack. Please try again.');
    } finally {
      setPackSaving(false);
    }
  }

  async function saveSet() {
    const validCards = validCardsOrError();
    if (!validCards) return;
    setSaving(true);
    setError(null);
    try {
      const created = await studySetService.create({
        title: title.trim(),
        subjectId: null,
        level: '',
        description: description.trim(),
        visibility: 'private',
        tags: [],
        cards: validCards.map((card) => ({ question: card.front.trim(), answer: card.back.trim() })),
      });
      setSavedSetId(created.id);
      onSaved(created.id);
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : 'Could not save this set. Please try again.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <article className="studio-result-card">
      <span className="studio-result-kicker">Flashcards · preview and edit</span>
      <h3>Make these cards yours</h3>
      <p className="studio-result-intro">Nothing is saved yet. Edit the wording, remove cards, then save them as a private set.</p>
      <label className="studio-field-label" htmlFor="studio-cards-title">Set title</label>
      <input id="studio-cards-title" className="input" value={title} maxLength={80} disabled={saving || Boolean(savedSetId)} onChange={(event) => setTitle(event.target.value)} />
      <label className="studio-field-label" htmlFor="studio-cards-description">Description <span>optional</span></label>
      <textarea id="studio-cards-description" className="textarea" rows={2} maxLength={400} value={description} disabled={saving || Boolean(savedSetId)} onChange={(event) => setDescription(event.target.value)} />
      <div className="studio-editable-cards">
        {cards.map((card, index) => (
          <fieldset className="studio-editable-card" key={`card-${index}`}>
            <legend>Card {index + 1}</legend>
            <label className="studio-field-label" htmlFor={`studio-card-front-${index}`}>Front</label>
            <input id={`studio-card-front-${index}`} className="input" value={card.front} maxLength={160} disabled={saving || Boolean(savedSetId)} onChange={(event) => changeCard(index, 'front', event.target.value)} />
            <label className="studio-field-label" htmlFor={`studio-card-back-${index}`}>Back</label>
            <textarea id={`studio-card-back-${index}`} className="textarea" rows={2} value={card.back} maxLength={300} disabled={saving || Boolean(savedSetId)} onChange={(event) => changeCard(index, 'back', event.target.value)} />
            <button type="button" className="studio-text-button studio-remove-card" onClick={() => removeCard(index)} disabled={saving || Boolean(savedSetId)} aria-label={`Remove card ${index + 1}`}>
              <IconTrash size={15} /> Remove
            </button>
          </fieldset>
        ))}
      </div>
      <div className="studio-result-actions">
        <Button type="button" variant="secondary" onClick={addCard} disabled={cards.length >= 30 || saving || Boolean(savedSetId)}>
          <IconPlus size={16} /> Add card
        </Button>
        <Button
          type="button"
          variant="secondary"
          onClick={() => void saveSet()}
          disabled={saving || packSaving || Boolean(savedSetId) || Boolean(createdPackId) || !cards.length}
        >
          {saving ? 'Saving set…' : savedSetId ? 'Saved as a private set' : 'Save as a set'}
        </Button>
        <Button
          type="button"
          onClick={() => void createStudyPack()}
          disabled={saving || packSaving || Boolean(createdPackId) || !cards.length}
        >
          {packSaving ? 'Creating pack…' : createdPackId ? 'Study pack created' : 'Create study pack'}
        </Button>
      </div>
      {createdPackId ? (
        <div className="studio-pack-created" role="status">
          <p>
            <strong>Study pack created.</strong> Your source is in it, these cards are its first
            flashcards, and the learning loop is ready.
          </p>
          <div className="studio-result-actions">
            <Link to={`/study-packs/${createdPackId}`} className="btn btn-primary">
              Open study pack
            </Link>
            <Link to={`/study-packs/${createdPackId}?tab=learn`} className="btn btn-secondary">
              Start learning
            </Link>
          </div>
        </div>
      ) : null}
      {error ? <p className="studio-inline-error" role="alert">{error}</p> : null}
    </article>
  );
}

function AnswerControls({
  question,
  selected,
  onSelect,
  revealed,
}: {
  question: StudioQuizQuestion | StudioPracticeQuestion;
  selected: string;
  onSelect: (value: string) => void;
  revealed: boolean;
}) {
  if (question.options.length) {
    return (
      <div className="studio-answer-options" role="group" aria-label="Answer choices">
        {question.options.map((option, index) => (
          <button
            key={`${index}-${option}`}
            type="button"
            className={`studio-answer-option${selected === String(index) ? ' selected' : ''}`}
            aria-pressed={selected === String(index)}
            disabled={revealed}
            onClick={() => onSelect(String(index))}
          >
            <span>{String.fromCharCode(65 + index)}</span>{option}
          </button>
        ))}
      </div>
    );
  }
  return (
    <label className="studio-field-label" htmlFor="studio-answer-input">
      Your answer
      <textarea
        id="studio-answer-input"
        className="textarea"
        rows={3}
        value={selected}
        disabled={revealed}
        onChange={(event) => onSelect(event.target.value)}
        placeholder="Write what you remember…"
      />
    </label>
  );
}

export function StudioQuizSession({ questions }: { questions: StudioQuizQuestion[] }) {
  const [index, setIndex] = useState(0);
  const [selected, setSelected] = useState('');
  const [revealed, setRevealed] = useState(false);
  const question = questions[index] ?? questions[questions.length - 1];
  if (!question) return null;
  const answer = question.type === 'multiple_choice' && question.correctIndex !== null
    ? question.options[question.correctIndex] ?? question.answer
    : question.answer || (question.correctIndex === null ? '' : question.options[question.correctIndex]);
  const isCorrect = question.type !== 'open' && selected === String(question.correctIndex);

  function next() {
    setIndex((current) => current + 1);
    setSelected('');
    setRevealed(false);
  }

  return (
    <article className="studio-result-card studio-quiz-session">
      <span className="studio-result-kicker">Quiz preview · question {index + 1} of {questions.length}</span>
      <div className="studio-quiz-progress" aria-hidden="true"><span style={{ width: `${((index + 1) / questions.length) * 100}%` }} /></div>
      {index < questions.length ? (
        <>
          <h3 id="studio-quiz-question">{question.question}</h3>
          <AnswerControls question={question} selected={selected} onSelect={setSelected} revealed={revealed} />
          {revealed ? (
            <div className={`studio-answer-feedback${question.type === 'open' ? '' : isCorrect ? ' correct' : ' compare'}`} role="status">
              {question.type === 'open' ? <strong>Compare your answer with this one:</strong> : <strong>{isCorrect ? 'That’s right.' : 'Compare with the correct answer.'}</strong>}
              <p>{answer}</p>
              {question.explanation ? <small>{question.explanation}</small> : null}
            </div>
          ) : (
            <p className="studio-result-note">Take a moment to answer, then reveal the answer and explanation.</p>
          )}
          <div className="studio-result-actions">
            {!revealed ? (
              <Button type="button" onClick={() => setRevealed(true)} disabled={!selected.trim()}>Check answer</Button>
            ) : (
              <Button type="button" onClick={next}>{index + 1 === questions.length ? 'Finish quiz' : 'Next question'} <IconArrowRight size={16} /></Button>
            )}
          </div>
        </>
      ) : (
        <div className="studio-quiz-finished" role="status">
          <IconCheck size={24} /><h3>Quiz complete</h3><p>You’ve reached the end of this preview.</p>
          <Button type="button" variant="secondary" onClick={() => { setIndex(0); setSelected(''); setRevealed(false); }}>Try again</Button>
        </div>
      )}
    </article>
  );
}

export function StudioPracticeSession({ questions }: { questions: StudioPracticeQuestion[] }) {
  const [index, setIndex] = useState(0);
  const [selected, setSelected] = useState('');
  const [hintVisible, setHintVisible] = useState(false);
  const [revealed, setRevealed] = useState(false);
  const question = questions[index] ?? questions[questions.length - 1];
  if (!question) return null;

  return (
    <article className="studio-result-card studio-quiz-session">
      <span className="studio-result-kicker">Practice · question {index + 1} of {questions.length}</span>
      <div className="studio-quiz-progress" aria-hidden="true"><span style={{ width: `${((index + 1) / questions.length) * 100}%` }} /></div>
      {index < questions.length ? (
        <>
          <h3>{question.question}</h3>
          <AnswerControls question={question} selected={selected} onSelect={setSelected} revealed={revealed} />
          {hintVisible && question.hint ? <p className="studio-hint" role="status"><strong>Hint</strong> {question.hint}</p> : null}
          {revealed ? <div className="studio-answer-feedback" role="status"><strong>Suggested answer</strong><p>{question.answer}</p></div> : null}
          <div className="studio-result-actions">
            {!revealed && question.hint ? <Button type="button" variant="secondary" onClick={() => setHintVisible(true)} disabled={hintVisible}>Show hint</Button> : null}
            {!revealed ? <Button type="button" onClick={() => setRevealed(true)} disabled={!selected.trim()}>Show answer</Button> : <Button type="button" onClick={() => { setIndex((current) => current + 1); setSelected(''); setHintVisible(false); setRevealed(false); }}>{index + 1 === questions.length ? 'Finish practice' : 'Next question'} <IconArrowRight size={16} /></Button>}
          </div>
        </>
      ) : (
        <div className="studio-quiz-finished" role="status"><IconCheck size={24} /><h3>Practice complete</h3><p>Nice work. Return to the source or make another set of questions.</p><Button type="button" variant="secondary" onClick={() => { setIndex(0); setSelected(''); setHintVisible(false); setRevealed(false); }}>Start again</Button></div>
      )}
      <p className="studio-result-note">Use the suggested answer to self-check; your response is not sent for grading.</p>
    </article>
  );
}

export function StudioChat({ source }: { source: StudioActionSource }) {
  const [messages, setMessages] = useState<StudioChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function send(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const message = input.trim();
    if (!message || busy) return;
    setBusy(true);
    setError(null);
    setInput('');
    const previous = messages.slice(-8);
    setMessages((current) => [...current, { role: 'user', content: message }]);
    try {
      const response = await aiStudioService.chat(source, message, previous);
      setMessages((current) => [...current, { role: 'assistant', content: response.reply }]);
    } catch (chatError) {
      setMessages((current) => current.slice(0, -1));
      setError(chatError instanceof Error ? chatError.message : 'Lerno AI could not answer. Try again.');
      setInput(message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="studio-result-card studio-chat-panel" aria-label="Chat about this source">
      <span className="studio-result-kicker">Source-aware chat</span>
      <h3>Ask about your material</h3>
      <p className="studio-result-intro">Lerno AI will use your source, and say when it does not contain the answer.</p>
      <div className="studio-chat-log" role="log" aria-live="polite" aria-busy={busy} aria-label="Chat about your source">
        {messages.length === 0 ? <p className="studio-chat-empty">Your source is ready. Ask one question to begin.</p> : null}
        {messages.map((message, index) => (
          <div className={`studio-chat-message ${message.role}`} key={`${index}-${message.role}`}>
            <strong>{message.role === 'user' ? 'You' : 'Lerno AI'}</strong>
            {message.role === 'assistant' ? <MarkdownLite text={message.content} /> : <p>{message.content}</p>}
          </div>
        ))}
        {busy ? <p className="studio-chat-loading" role="status">Lerno AI is reading your source…</p> : null}
      </div>
      {error ? <p className="studio-inline-error" role="alert">{error}</p> : null}
      <form className="studio-chat-form" onSubmit={(event) => void send(event)}>
        <label className="visually-hidden" htmlFor="studio-chat-input">Ask Lerno AI about this source</label>
        <textarea id="studio-chat-input" className="textarea" rows={2} maxLength={2_000} value={input} onChange={(event) => setInput(event.target.value)} placeholder="Ask about a concept, definition, or example…" disabled={busy} />
        <Button type="submit" disabled={busy || !input.trim()}>{busy ? 'Thinking…' : 'Ask Lerno AI'}</Button>
      </form>
      <p className="studio-result-note">Chat is temporary and source-specific; it is not added to your general Lerno AI history.</p>
    </section>
  );
}

export function StudioSavedSet({ setId }: { setId: string }) {
  return (
    <div className="studio-save-success" role="status">
      <IconCheck size={20} />
      <span><strong>Your set is saved.</strong><small>The AI preview was not saved until you chose to save it.</small></span>
      <ButtonLink to={`/sets/${setId}`} variant="secondary">Open set <IconArrowRight size={15} /></ButtonLink>
    </div>
  );
}

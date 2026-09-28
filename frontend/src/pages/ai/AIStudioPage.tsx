import { useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { Button } from '../../components/ui/Button';
import { IconBook, IconCards, IconQuiz, IconSparkles } from '../../components/ui/Icons';
import { StudioSourcePanel } from '../../components/studio/StudioSourcePanel';
import {
  StudioCardsEditor,
  StudioChat,
  StudioPracticeSession,
  StudioPlanView,
  StudioQuizSession,
  StudioSavedSet,
  StudioSummaryView,
} from '../../components/studio/StudioResultViews';
import { aiStudioService, toStudioActionSource, type StudioCardsResult, type StudioPracticeQuestion, type StudioQuizQuestion, type StudioSource, type StudioStudyPlan, type StudioSummary } from '../../services/aiStudioService';
import type { ApiError } from '../../lib/api';

const ACTIONS = [
  { id: 'summary', title: 'Make a summary', description: 'Get the main ideas and useful terms.', Icon: IconBook },
  { id: 'cards', title: 'Create flashcards', description: 'Build an editable set from this source.', Icon: IconCards },
  { id: 'quiz', title: 'Take a quiz', description: 'Check what you understand so far.', Icon: IconQuiz },
  { id: 'questions', title: 'Practice questions', description: 'Recall, apply, and self-check.', Icon: IconBook },
  { id: 'plan', title: 'Build a study plan', description: 'Space out review with a simple plan.', Icon: IconBook },
  { id: 'chat', title: 'Ask about this source', description: 'Get a source-aware explanation.', Icon: IconSparkles },
] as const;

type ActionId = (typeof ACTIONS)[number]['id'];

export function AIStudioPage() {
  const [source, setSource] = useState<StudioSource | null>(null);
  const [sourceBusy, setSourceBusy] = useState(false);
  const [activeAction, setActiveAction] = useState<ActionId | null>(null);
  const [actionBusy, setActionBusy] = useState(false);
  const actionBusyRef = useRef(false);
  const [error, setError] = useState<string | null>(null);
  const [summary, setSummary] = useState<StudioSummary | null>(null);
  const [cards, setCards] = useState<StudioCardsResult | null>(null);
  const [quiz, setQuiz] = useState<StudioQuizQuestion[] | null>(null);
  const [questions, setQuestions] = useState<StudioPracticeQuestion[] | null>(null);
  const [plan, setPlan] = useState<StudioStudyPlan | null>(null);
  const [savedSetId, setSavedSetId] = useState<string | null>(null);
  const [cardCount, setCardCount] = useState(10);
  const [quizCount, setQuizCount] = useState(10);
  const [practiceCount, setPracticeCount] = useState(10);
  const [planDays, setPlanDays] = useState(7);
  const [planMinutes, setPlanMinutes] = useState(30);
  const [difficulty, setDifficulty] = useState<'easy' | 'normal' | 'hard'>('normal');
  const [quizTypes, setQuizTypes] = useState<StudioQuizQuestion['type'][]>(['multiple_choice', 'true_false', 'open']);

  function clearResults() {
    setActiveAction(null);
    setSummary(null);
    setCards(null);
    setQuiz(null);
    setQuestions(null);
    setPlan(null);
    setSavedSetId(null);
  }

  function handleSource(nextSource: StudioSource | null) {
    setSource(nextSource);
    clearResults();
    setError(null);
  }

  async function runAction(action: ActionId) {
    if (!source || actionBusyRef.current || sourceBusy) return;
    const actionSource = toStudioActionSource(source);
    actionBusyRef.current = true;
    setActionBusy(true);
    setActiveAction(action);
    setError(null);
    setSummary(null);
    setCards(null);
    setQuiz(null);
    setQuestions(null);
    setPlan(null);
    setSavedSetId(null);
    try {
      if (action === 'summary') {
        setSummary(await aiStudioService.summary(actionSource));
      } else if (action === 'cards') {
        setCards(await aiStudioService.cards(actionSource, cardCount));
      } else if (action === 'quiz') {
        const result = await aiStudioService.quiz(actionSource, quizCount, quizTypes);
        setQuiz(result.questions);
      } else if (action === 'questions') {
        const result = await aiStudioService.questions(actionSource, practiceCount, difficulty);
        setQuestions(result.questions);
      } else if (action === 'plan') {
        setPlan(await aiStudioService.plan(actionSource, planDays, planMinutes));
      }
    } catch (requestError) {
      if ((requestError as ApiError)?.status === 404) {
        setSource(null);
        clearResults();
      }
      setError(requestError instanceof Error ? requestError.message : 'Lerno AI could not complete this action. Please try again.');
    } finally {
      actionBusyRef.current = false;
      setActionBusy(false);
    }
  }

  function toggleQuizType(type: StudioQuizQuestion['type']) {
    setQuizTypes((current) => current.includes(type)
      ? current.filter((item) => item !== type)
      : [...current, type]);
  }

  return (
    <div className="ai-studio-page">
      <header className="studio-hero">
        <div className="studio-hero-copy">
          <span className="eyebrow-label">Lerno AI · Study Studio</span>
          <h1>Make your material work harder.</h1>
          <p>Bring a source. Choose a study tool. Keep control of what gets saved.</p>
        </div>
        <Link to="/ai" className="studio-general-ai-link"><IconSparkles size={17} /> Open Lerno AI</Link>
      </header>

      <div className="studio-workflow-note">
        <span aria-hidden="true">01</span><span>Add a source</span><i />
        <span aria-hidden="true">02</span><span>Choose a tool</span><i />
        <span aria-hidden="true">03</span><span>Preview before saving</span>
      </div>

      {error ? (
        <div className="studio-global-error" role="alert">
          <span>{error}</span>
          <button type="button" onClick={() => setError(null)} aria-label="Dismiss error">×</button>
        </div>
      ) : null}

      <StudioSourcePanel
        source={source}
        onSource={handleSource}
        onBusyChange={setSourceBusy}
        onError={setError}
      />

      {source ? (
        <section className="studio-action-section" aria-labelledby="studio-actions-heading">
          <div className="studio-section-heading">
            <div>
              <span className="studio-step">02 · Choose a tool</span>
              <h2 id="studio-actions-heading">What would help you learn?</h2>
              <p>Nothing is generated until you choose an action below.</p>
            </div>
          </div>

          <div className="studio-generation-settings">
            <label>
              Flashcards
              <select className="select" value={cardCount} onChange={(event) => setCardCount(Number(event.target.value))}>
                {[5, 10, 20, 30].map((count) => <option key={count} value={count}>{count} cards</option>)}
              </select>
            </label>
            <label>
              Quiz length
              <select className="select" value={quizCount} onChange={(event) => setQuizCount(Number(event.target.value))}>
                {[5, 10, 15].map((count) => <option key={count} value={count}>{count} questions</option>)}
              </select>
            </label>
            <label>
              Practice difficulty
              <select className="select" value={difficulty} onChange={(event) => setDifficulty(event.target.value as typeof difficulty)}>
                <option value="easy">Easy · recall</option><option value="normal">Normal · understand</option><option value="hard">Hard · apply</option>
              </select>
            </label>
            <label>
              Practice length
              <select className="select" value={practiceCount} onChange={(event) => setPracticeCount(Number(event.target.value))}>
                {[5, 10, 15].map((count) => <option key={count} value={count}>{count} questions</option>)}
              </select>
            </label>
            <label>
              Study plan length
              <select className="select" value={planDays} onChange={(event) => setPlanDays(Number(event.target.value))}>
                {[3, 5, 7, 14].map((days) => <option key={days} value={days}>{days} days</option>)}
              </select>
            </label>
            <label>
              Time per study day
              <select className="select" value={planMinutes} onChange={(event) => setPlanMinutes(Number(event.target.value))}>
                {[15, 30, 45, 60].map((minutes) => <option key={minutes} value={minutes}>{minutes} minutes</option>)}
              </select>
            </label>
          </div>
          <fieldset className="studio-quiz-types">
            <legend>Quiz question types</legend>
            {([
              ['multiple_choice', 'Multiple choice'],
              ['true_false', 'True or false'],
              ['open', 'Open answer'],
            ] as const).map(([type, label]) => (
              <label key={type}>
                <input type="checkbox" checked={quizTypes.includes(type)} onChange={() => toggleQuizType(type)} />
                {label}
              </label>
            ))}
          </fieldset>

          <div className="studio-action-grid">
            {ACTIONS.map(({ id, title, description, Icon }) => (
              <button
                key={id}
                type="button"
                className={`studio-action-card${activeAction === id ? ' active' : ''}`}
                onClick={() => {
                  if (id === 'chat') {
                    setActiveAction(id);
                    setSummary(null); setCards(null); setQuiz(null); setQuestions(null); setPlan(null); setSavedSetId(null); setError(null);
                  } else {
                    void runAction(id);
                  }
                }}
                disabled={actionBusy || sourceBusy || (id === 'quiz' && quizTypes.length === 0)}
                aria-pressed={activeAction === id}
              >
                <span className="studio-action-icon"><Icon size={19} /></span>
                <strong>{title}</strong>
                <small>{description}</small>
                {actionBusy && activeAction === id ? <span className="studio-action-status" role="status">Working…</span> : null}
              </button>
            ))}
          </div>
          {quizTypes.length === 0 ? <p className="studio-muted">Choose at least one quiz question type.</p> : null}
        </section>
      ) : null}

      {source && activeAction ? (
        <section className="studio-output-section" aria-labelledby="studio-output-heading">
          <div className="studio-section-heading">
            <div>
              <span className="studio-step">03 · Preview</span>
              <h2 id="studio-output-heading">{actionBusy ? 'Lerno AI is preparing your preview…' : 'Your study workspace'}</h2>
              <p>Review and edit generated material first. It will never be saved automatically.</p>
            </div>
          </div>
          {actionBusy ? (
            <div className="studio-loading" role="status" aria-live="polite"><span className="studio-spinner" /> Lerno AI is working from “{source.title}”…</div>
          ) : null}
          {!actionBusy && activeAction === 'summary' && summary ? <StudioSummaryView summary={summary} /> : null}
          {!actionBusy && activeAction === 'cards' && cards ? (
            <>
              <StudioCardsEditor
                key={`${cards.title}-${cards.cards.length}`}
                result={cards}
                onSaved={setSavedSetId}
                source={toStudioActionSource(source)}
              />
              {savedSetId ? <StudioSavedSet setId={savedSetId} /> : null}
            </>
          ) : null}
          {!actionBusy && activeAction === 'quiz' && quiz ? <StudioQuizSession questions={quiz} /> : null}
          {!actionBusy && activeAction === 'questions' && questions ? <StudioPracticeSession questions={questions} /> : null}
          {!actionBusy && activeAction === 'plan' && plan ? <StudioPlanView plan={plan} /> : null}
          {!actionBusy && activeAction === 'chat' ? <StudioChat key={source.id} source={toStudioActionSource(source)} /> : null}
          {!actionBusy && error ? (
            <div className="studio-result-card studio-error-state" aria-live="polite">
              <strong>We couldn’t make this preview yet.</strong>
              <p>{error}</p>
              {activeAction !== 'chat' ? <Button type="button" variant="secondary" onClick={() => void runAction(activeAction)}>Try again</Button> : null}
            </div>
          ) : null}
        </section>
      ) : null}

      {!source ? (
        <aside className="studio-empty-hint"><IconBook size={18} /><p>After your source is ready, you can make a summary, create flashcards, practise with a quiz or questions, or ask Lerno AI about the material.</p></aside>
      ) : null}
    </div>
  );
}

import { Link } from 'react-router-dom';
import { ButtonLink } from '../ui/Button';
import { Badge } from '../ui/Primitives';
import { IconArrowRight } from '../ui/Icons';
import { sessionHref, taskActionLabel, todayTaskHref, formatMinutes } from '../../lib/studyPackRoutes';
import {
  plannedMinutesSentence,
  stepMeta,
  stepReason,
  stepTitle,
  type NormalizedToday,
  type PlanStep,
} from '../../lib/todayPlan';

export interface FallbackAction {
  title: string;
  description: string;
  to: string;
  cta: string;
}

/** The one primary action of My Study: what to do right now, and why. */
function RecommendedHero({ step }: { step: PlanStep }) {
  const meta = stepMeta(step);
  return (
    <article className="card today-hero" aria-labelledby="today-next-title">
      <span className="eyebrow-label">Recommended next</span>
      <h3 id="today-next-title">{step.label}</h3>
      <p className="today-hero-reason">{stepReason(step)}</p>
      {meta ? <p className="muted today-hero-meta">{meta}</p> : null}
      <ButtonLink to={todayTaskHref(step)} size="lg">
        {taskActionLabel(step)} <IconArrowRight size={18} />
      </ButtonLink>
    </article>
  );
}

function FallbackHero({ action }: { action: FallbackAction }) {
  return (
    <article className="card today-hero" aria-labelledby="today-next-title">
      <span className="eyebrow-label">Next up</span>
      <h3 id="today-next-title">{action.title}</h3>
      <p className="today-hero-reason">{action.description}</p>
      <ButtonLink to={action.to} size="lg">
        {action.cta} <IconArrowRight size={18} />
      </ButtonLink>
    </article>
  );
}

/** "Continue where you left off — Biology Practice — Question 6 of 10." */
function ResumeHero({ today }: { today: NormalizedToday }) {
  const [lead, ...others] = today.resume;
  if (!lead) return null;
  return (
    <article className="card today-hero today-resume" aria-labelledby="today-resume-title">
      <span className="eyebrow-label">Continue where you left off</span>
      <h3 id="today-resume-title">{lead.label}</h3>
      <p className="today-hero-reason">{lead.positionLabel}</p>
      <ButtonLink to={sessionHref(lead.sessionId)} size="lg">
        Continue <IconArrowRight size={18} />
      </ButtonLink>
      {others.length > 0 ? (
        <ul className="today-resume-others" role="list" aria-label="Other unfinished sessions">
          {others.map((card) => (
            <li key={card.sessionId}>
              <span>
                <strong>{card.label}</strong> <span className="muted">· {card.positionLabel}</span>
              </span>
              <Link
                className="btn btn-ghost btn-sm"
                to={sessionHref(card.sessionId)}
                aria-label={`Continue ${card.label}`}
              >
                Continue
              </Link>
            </li>
          ))}
        </ul>
      ) : null}
    </article>
  );
}

/**
 * Today: how long the plan is, the single thing to do now, and the numbered plan
 * behind it. Everything here comes from the planner (mastery, weak concepts,
 * cards due, exam date, recent activity), never from a fixed order.
 */
export function TodaySection({
  today,
  fallback,
}: {
  today: NormalizedToday;
  fallback: FallbackAction | null;
}) {
  const { steps, primary, minutes, resume, streak } = today;
  const packCount = new Set(steps.map((step) => step.packId).filter(Boolean)).size;

  return (
    <section className="today" aria-labelledby="my-study-today">
      <div className="today-head">
        <div>
          <h2 id="my-study-today">Today</h2>
          <p className="today-lede">{plannedMinutesSentence(minutes)}</p>
        </div>
        <div className="today-head-meta">
          {minutes ? <Badge variant="accent">{formatMinutes(minutes)} recommended</Badge> : null}
          {streak && streak.current > 0 ? (
            <span className="today-streak">{streak.current} day study streak</span>
          ) : null}
        </div>
      </div>

      {resume.length > 0 ? (
        <ResumeHero today={today} />
      ) : primary ? (
        <RecommendedHero step={primary} />
      ) : fallback ? (
        <FallbackHero action={fallback} />
      ) : null}

      {steps.length > 0 ? (
        <div className="today-plan">
          <h3 id="today-plan-title">Your plan</h3>
          <ol className="today-steps" role="list" aria-labelledby="today-plan-title">
            {steps.map((step, index) => {
              const title = stepTitle(step);
              const meta = stepMeta(step, { showPack: packCount > 1 });
              return (
                <li key={`${step.order}-${step.type}-${step.packId ?? ''}-${step.conceptId ?? ''}`} className="today-step">
                  <span className="today-step-number" aria-hidden="true">
                    {index + 1}
                  </span>
                  <div className="today-step-body">
                    <strong>{title}</strong>
                    <span className="muted">{stepReason(step)}</span>
                    {meta ? <span className="muted today-step-meta">{meta}</span> : null}
                  </div>
                  <Link
                    className="btn btn-secondary btn-sm"
                    to={todayTaskHref(step)}
                    aria-label={`${taskActionLabel(step)}: ${title}`}
                  >
                    {taskActionLabel(step)}
                  </Link>
                </li>
              );
            })}
          </ol>
        </div>
      ) : (
        <p className="muted today-empty">
          Nothing needs your attention right now. Add study material or pick a pack to keep going.
        </p>
      )}
    </section>
  );
}

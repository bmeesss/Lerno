import { ButtonLink } from '../ui/Button';
import { Badge, ProgressBar } from '../ui/Primitives';
import { IconFlame } from '../ui/Icons';
import { nextActionLink } from '../../lib/nextAction';
import type { TodaySummary } from '../../types';

/** Compact "what should I do now" panel: goal, due, streak, next action. */
export function TodayPanel({
  today,
  showAction = true,
}: {
  today: TodaySummary;
  showAction?: boolean;
}) {
  const next = nextActionLink(today.continueAction);
  const upcomingParts: string[] = [];
  if (today.upcoming.laterToday > 0) {
    upcomingParts.push(`${today.upcoming.laterToday} later today`);
  }
  if (today.upcoming.tomorrow > 0) {
    upcomingParts.push(`${today.upcoming.tomorrow} tomorrow`);
  }
  if (today.upcoming.next7Days > 0) {
    upcomingParts.push(`${today.upcoming.next7Days} this week`);
  }

  return (
    <section className="card today-panel">
      <div className="today-panel-head">
        <h2>Today</h2>
        <Badge variant={today.streak.current > 0 ? 'accent' : 'default'}>
          <IconFlame size={14} /> {today.streak.current} day
          {today.streak.current === 1 ? '' : 's'}
        </Badge>
      </div>

      <div className="today-stats">
        <div className="today-stat">
          <span className="today-stat-label">Due now</span>
          <span className="today-stat-value">{today.cardsDue}</span>
          <span className="today-stat-sub">cards ready for review</span>
        </div>
        <div
          className="today-stat today-stat-goal"
          aria-label={`${today.completedCards} / ${today.target} cards`}
        >
          <span className="today-stat-label">Daily goal</span>
          <span className="today-stat-value">
            {today.completedCards}
            <span className="today-stat-total"> / {today.target}</span>
          </span>
          <ProgressBar value={today.completedCards} max={today.target} />
        </div>
        <div className="today-stat">
          <span className="today-stat-label">Best streak</span>
          <span className="today-stat-value">{today.streak.longest}</span>
          <span className="today-stat-sub">days in a row</span>
        </div>
      </div>

      <p className="today-upcoming">
        {today.goalReached
          ? 'Daily goal reached — nice work.'
          : `${today.completedCards} of ${today.target} cards done`}
        {upcomingParts.length > 0 ? ` · ${upcomingParts.join(' · ')}` : ''}
      </p>

      {showAction && (
        <ButtonLink to={next.to} block>
          {next.label}
        </ButtonLink>
      )}
    </section>
  );
}

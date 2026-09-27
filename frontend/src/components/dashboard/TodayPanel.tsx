import { ButtonLink } from '../ui/Button';
import { ProgressBar } from '../ui/Primitives';
import { IconFlame } from '../ui/Icons';
import { nextActionLink } from '../../lib/nextAction';
import type { TodaySummary } from '../../types';

/** Compact "what should I do now" panel: goal, due, streak, next action. */
export function TodayPanel({ today }: { today: TodaySummary }) {
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
    <div className="card" style={{ marginBottom: 20 }}>
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'baseline',
          gap: 12,
          flexWrap: 'wrap',
          marginBottom: 12,
        }}
      >
        <h2 style={{ fontSize: '1.1rem' }}>Today</h2>
        <span className="muted" style={{ fontSize: '0.875rem' }}>
          <IconFlame size={15} /> {today.streak.current} day streak
          {today.streak.longest > today.streak.current ? ` · best ${today.streak.longest}` : ''}
        </span>
      </div>

      <div className="subject-row-top" style={{ marginBottom: 6 }}>
        <span style={{ fontWeight: 600 }}>
          {today.completedCards} / {today.target} cards
        </span>
        <span className="muted" style={{ fontSize: '0.825rem' }}>
          {today.goalReached ? 'Daily goal reached 🎉' : 'Daily goal'}
        </span>
      </div>
      <ProgressBar value={today.completedCards} max={today.target} />

      <p className="muted" style={{ fontSize: '0.875rem', margin: '12px 0' }}>
        {today.cardsDue} card{today.cardsDue === 1 ? '' : 's'} due now
        {upcomingParts.length > 0 ? ` · ${upcomingParts.join(' · ')}` : ''}
      </p>

      <ButtonLink to={next.to}>{next.label}</ButtonLink>
    </div>
  );
}

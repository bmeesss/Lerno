import type { MasteryTrend } from '../../types';

const WIDTH = 168;
const HEIGHT = 48;
const PAD = 6;

/** "20 Sep" for a YYYY-MM-DD day (calendar day, never shifted by the time zone). */
export function formatDay(day: string): string {
  const parsed = Date.parse(`${day}T00:00:00Z`);
  if (Number.isNaN(parsed)) return day;
  return new Date(parsed).toLocaleDateString(undefined, { day: 'numeric', month: 'short', timeZone: 'UTC' });
}

/**
 * A real mastery trend: one point per day the student actually studied. It is
 * only drawn when the server says there is enough data (at least three real
 * days), on a fixed 0–100% scale so a small change never looks dramatic.
 */
export function TrendSparkline({ trend }: { trend: MasteryTrend }) {
  if (!trend.hasEnoughData || trend.points.length < 2) return null;
  const { points } = trend;
  const first = points[0]!;
  const last = points[points.length - 1]!;
  const x = (index: number) => PAD + (index * (WIDTH - PAD * 2)) / (points.length - 1);
  const y = (percent: number) => HEIGHT - PAD - (Math.min(100, Math.max(0, percent)) / 100) * (HEIGHT - PAD * 2);
  const line = points.map((point, index) => `${x(index).toFixed(1)},${y(point.masteryPercent).toFixed(1)}`).join(' ');

  return (
    <svg
      className="trend-sparkline"
      viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
      role="img"
      aria-label={`Mastery trend: ${first.masteryPercent}% on ${formatDay(first.day)} to ${last.masteryPercent}% on ${formatDay(last.day)}`}
    >
      <line className="trend-baseline" x1={PAD} x2={WIDTH - PAD} y1={HEIGHT - PAD} y2={HEIGHT - PAD} />
      <polyline className="trend-line" points={line} fill="none" />
      <circle className="trend-dot" cx={x(points.length - 1)} cy={y(last.masteryPercent)} r="3.5" />
    </svg>
  );
}

/** The sentence under the trend: what changed, or why there is no trend yet. */
export function trendSummary(trend: MasteryTrend): string {
  if (!trend.hasEnoughData) {
    if (trend.daysRecorded === 0) {
      return `A trend appears after ${trend.minDays} days of study.`;
    }
    return `A trend appears after ${trend.minDays} days of study — ${trend.daysRecorded} so far.`;
  }
  const first = trend.points[0];
  const since = first ? ` since ${formatDay(first.day)}` : '';
  const change = trend.changePercent ?? 0;
  if (trend.direction === 'up') return `Up ${Math.abs(change)} points${since}`;
  if (trend.direction === 'down') return `Down ${Math.abs(change)} points${since}`;
  return `Steady${since}`;
}

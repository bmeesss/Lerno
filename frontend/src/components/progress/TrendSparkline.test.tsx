import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { MasteryTrend } from '../../types';
import { TrendSparkline, formatDay, trendSummary } from './TrendSparkline';

function trend(overrides: Partial<MasteryTrend> = {}): MasteryTrend {
  return {
    hasEnoughData: true,
    daysRecorded: 4,
    minDays: 3,
    points: [
      { day: '2026-09-22', masteryPercent: 48 },
      { day: '2026-09-25', masteryPercent: 55 },
      { day: '2026-09-29', masteryPercent: 62 },
    ],
    changePercent: 14,
    direction: 'up',
    ...overrides,
  };
}

describe('TrendSparkline', () => {
  it('draws a labelled chart from real daily points', () => {
    render(<TrendSparkline trend={trend()} />);
    const chart = screen.getByRole('img');
    expect(chart).toHaveAccessibleName(/Mastery trend: 48% on .* to 62% on /);
    expect(chart.querySelectorAll('polyline')).toHaveLength(1);
    expect(chart.querySelector('polyline')!.getAttribute('points')!.split(' ')).toHaveLength(3);
  });

  it('draws nothing without enough data — no fake chart', () => {
    const { container } = render(
      <TrendSparkline
        trend={trend({
          hasEnoughData: false,
          daysRecorded: 1,
          points: [{ day: '2026-09-29', masteryPercent: 10 }],
        })}
      />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it('keeps a fixed 0–100% scale, so a small change never looks dramatic', () => {
    const { container } = render(
      <TrendSparkline
        trend={trend({
          points: [
            { day: '2026-09-22', masteryPercent: 60 },
            { day: '2026-09-25', masteryPercent: 61 },
            { day: '2026-09-29', masteryPercent: 62 },
          ],
        })}
      />,
    );
    const ys = container
      .querySelector('polyline')!
      .getAttribute('points')!
      .split(' ')
      .map((point) => Number(point.split(',')[1]));
    // 2 percentage points on a 48px chart are a fraction of a pixel, not a cliff.
    expect(Math.max(...ys) - Math.min(...ys)).toBeLessThan(1.5);
  });
});

describe('trendSummary', () => {
  it('reports the change with the day it started from', () => {
    expect(trendSummary(trend())).toBe(`Up 14 points since ${formatDay('2026-09-22')}`);
    expect(trendSummary(trend({ direction: 'down', changePercent: -6 }))).toMatch(
      /^Down 6 points since /,
    );
    expect(trendSummary(trend({ direction: 'steady', changePercent: 0 }))).toMatch(
      /^Steady since /,
    );
  });

  it('explains honestly why there is no trend yet', () => {
    expect(trendSummary(trend({ hasEnoughData: false, daysRecorded: 0, points: [] }))).toBe(
      'A trend appears after 3 days of study.',
    );
    expect(trendSummary(trend({ hasEnoughData: false, daysRecorded: 2, points: [] }))).toBe(
      'A trend appears after 3 days of study — 2 so far.',
    );
  });

  it('formats a calendar day without shifting it across time zones', () => {
    expect(formatDay('2026-01-01')).toMatch(/1/);
    expect(formatDay('garbage')).toBe('garbage');
  });
});

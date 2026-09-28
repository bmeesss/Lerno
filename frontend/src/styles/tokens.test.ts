import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
// Vitest's frontend workspace root is frontend/ (CSS imports are stubbed by jsdom).
const css = readFileSync('src/styles/tokens.css', 'utf8');

function luminance(hex: string): number {
  const channels = [1, 3, 5].map((start) => {
    const value = parseInt(hex.slice(start, start + 2), 16) / 255;
    return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  });
  return channels[0]! * 0.2126 + channels[1]! * 0.7152 + channels[2]! * 0.0722;
}
function contrast(a: string, b: string): number {
  const values = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (values[0]! + 0.05) / (values[1]! + 0.05);
}

describe.each(['light', 'dark'])('%s theme contrast tokens', (theme) => {
  const block = css.split(`[data-theme='${theme}'] {`)[1]!.split('}')[0]!;
  const tokens = Object.fromEntries(
    [...block.matchAll(/--([\w-]+): (#[\da-f]{6});/g)].map((match) => [match[1]!, match[2]!]),
  );
  it('keeps normal text, muted text, status and action labels at WCAG AA', () => {
    const pairs = [
      ['text', 'bg'],
      ['text', 'surface'],
      ['text-secondary', 'surface'],
      ['text-muted', 'bg'],
      ['text-muted', 'surface'],
      ['text-muted', 'surface-raised'],
      ['text-inverse', 'accent'],
      ['text-inverse', 'accent-hover'],
      ['accent-text', 'accent-subtle'],
      ['danger', 'danger-subtle'],
      ['warning', 'warning-subtle'],
      ['info', 'info-subtle'],
      ['feature-text', 'feature-bg'],
      ['warm-text', 'warm-bg'],
      ['blue-text', 'blue-bg'],
    ];
    for (const [fg, bg] of pairs)
      expect(contrast(tokens[fg!]!, tokens[bg!]!), `${fg} on ${bg}`).toBeGreaterThanOrEqual(4.5);
  });
  it('gives input boundaries and focus indicators at least 3:1 contrast', () => {
    for (const border of ['control-border', 'accent'])
      expect(contrast(tokens[border]!, tokens.surface!)).toBeGreaterThanOrEqual(3);
  });
});

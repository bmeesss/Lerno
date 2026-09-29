import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

// CSS imports are stubbed by jsdom, so read the files directly (relative to this file, not the cwd).
const read = (relative: string) => readFileSync(new URL(relative, import.meta.url), 'utf8');
const stripComments = (css: string) => css.replace(/\/\*[\s\S]*?\*\//g, '');
const tokens = read('./tokens.css');
const sheets = {
  'study-session.css': stripComments(read('./study-session.css')),
  'study-planner.css': stripComments(read('./study-planner.css')),
};
const main = read('../main.tsx');

const escapeRegExp = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Every declaration block whose selector list contains exactly `selector`. */
function blocks(css: string, selector: string): string[] {
  const found: string[] = [];
  for (const match of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const selectors = match[1]!.split(',').map((entry) => entry.trim());
    if (selectors.includes(selector)) found.push(match[2]!);
  }
  return found;
}

function px(block: string, property: string): number | null {
  const match = block.match(
    new RegExp(`(?:^|[;\\s])${escapeRegExp(property)}:\\s*(\\d+(?:\\.\\d+)?)px`),
  );
  return match ? Number(match[1]) : null;
}

describe('study experience styles', () => {
  it('are loaded after the base styles, so they can build on them', () => {
    const order = [
      'tokens.css',
      'base.css',
      'components.css',
      'layout.css',
      'study-pack.css',
      'study-session.css',
      'study-planner.css',
    ].map((file) => main.indexOf(`./styles/${file}`));
    for (const index of order) expect(index).toBeGreaterThan(-1);
    expect(order).toEqual([...order].sort((a, b) => a - b));
  });

  describe.each(Object.entries(sheets))('%s', (name, css) => {
    it('only uses design tokens that exist, so light and dark keep their tested contrast', () => {
      const defined = new Set([...tokens.matchAll(/(--[\w-]+):/g)].map((match) => match[1]!));
      const used = [...css.matchAll(/var\((--[\w-]+)/g)].map((match) => match[1]!);
      expect(used.length).toBeGreaterThan(20);
      const unknown = [...new Set(used)].filter((token) => !defined.has(token));
      expect(unknown, `${name} uses tokens that are not defined`).toEqual([]);
    });

    it('never hard-codes a colour (everything comes from the theme)', () => {
      const literals = css.match(/#[0-9a-fA-F]{3,8}\b/g) ?? [];
      expect(literals).toEqual([]);
    });

    it('only removes the focus outline from elements that are focused by code, never by the keyboard', () => {
      const offenders: string[] = [];
      for (const match of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
        if (!/outline:\s*none/.test(match[2]!)) continue;
        const selectors = match[1]!.split(',').map((entry) => entry.trim());
        for (const selector of selectors) {
          // Headings with tabindex="-1" receive focus from the page so screen readers start there.
          if (
            !/^(\.session-question|\.session-result-title|#mistakes-heading)(:focus)?$/.test(
              selector,
            )
          )
            offenders.push(selector);
        }
      }
      expect(offenders).toEqual([]);
    });
  });
});

describe('study session screens on a phone', () => {
  const css = sheets['study-session.css'];

  it('fixes the action bar to the bottom of the screen and respects the safe area', () => {
    const [base] = blocks(css, '.session-cta-bar');
    expect(base).toMatch(/position:\s*fixed/);
    expect(base).toMatch(/env\(safe-area-inset-bottom/);
    // The content is never hidden behind it.
    const [page] = blocks(css, '.session-page');
    expect(page).toMatch(/padding-bottom:\s*calc\(112px/);
  });

  it('keeps result actions in the page instead of fixing them', () => {
    const [staticBar] = blocks(css, '.session-cta-bar.session-cta-static');
    expect(staticBar).toMatch(/position:\s*static/);
  });

  it('puts the bar back in the flow on larger screens', () => {
    const wide = css.slice(css.indexOf('@media (min-width: 768px)'));
    const bar = blocks(wide.slice(0, wide.indexOf('.learn-blocks')), '.session-cta-bar')[0]!;
    expect(bar).toMatch(/position:\s*sticky/);
  });

  it.each([
    ['.session-option', 48],
    ['.learn-rating-button', 48],
    ['.test-grid-button', 48],
    ['.test-mode', 48],
    ['.session-cta-inner .btn', 48],
    ['.session-start-actions .btn', 48],
    ['.tutor-drawer-form .input', 48],
    ['.context-actions-row .btn', 44],
    ['.test-overview summary', 44],
  ])('gives %s a touch target of at least %ipx', (selector, minimum) => {
    const heights = blocks(css, selector)
      .map((block) => px(block, 'min-height'))
      .filter((value): value is number => value !== null);
    expect(heights.length, `${selector} has no min-height`).toBeGreaterThan(0);
    expect(Math.max(...heights)).toBeGreaterThanOrEqual(minimum);
  });

  it('shows keyboard focus on cards that hide their native radio ring', () => {
    for (const selector of [
      '.session-option:focus-within',
      '.test-mode:focus-within',
      '.learn-rating-button:focus-visible',
    ]) {
      const [block] = blocks(css, selector);
      expect(block, selector).toMatch(/outline:\s*2px solid var\(--accent\)/);
    }
    const [current] = blocks(css, '.test-grid-button.is-current');
    expect(current).toMatch(/outline:\s*2px solid var\(--accent\)/);
  });

  it('shows the correct and wrong answer with more than colour (badges are rendered next to them)', () => {
    // The styling differs, and QuestionInput renders a text badge for both (see its test).
    expect(blocks(css, '.session-option.is-correct')[0]).toMatch(/border-color:\s*var\(--accent\)/);
    expect(blocks(css, '.session-option.is-wrong')[0]).toMatch(/border-color:\s*var\(--danger\)/);
  });

  it('respects reduced motion', () => {
    expect(css).toMatch(/@media \(prefers-reduced-motion: reduce\)/);
  });

  it('never lets long user content widen the screen', () => {
    expect(blocks(css, '.session-question')[0]).toMatch(/overflow-wrap:\s*anywhere/);
    expect(blocks(css, '.session-option-text')[0]).toMatch(/min-width:\s*0/);
  });
});

describe('planner screens', () => {
  const css = sheets['study-planner.css'];

  it('gives the plan step buttons a touch target and stacks them under the text on a phone', () => {
    const [button] = blocks(css, '.today-step .btn');
    expect(px(button!, 'min-height')).toBeGreaterThanOrEqual(44);
    expect(button).toMatch(/grid-column:\s*1 \/ -1/);
  });

  it('uses only the vetted colour pairs for the exam banner and the hero', () => {
    const [banner] = blocks(css, '.exam-banner');
    expect(banner).toMatch(/background:\s*var\(--warm-bg\)/);
    expect(banner).toMatch(/color:\s*var\(--warm-text\)/);
    const [hero] = blocks(css, '.today-hero');
    expect(hero).toMatch(/background:\s*var\(--feature-bg\)/);
    expect(hero).toMatch(/color:\s*var\(--feature-text\)/);
  });

  it('draws the trend on the theme colours, with no decorative gradient', () => {
    expect(blocks(css, '.trend-line')[0]).toMatch(/stroke:\s*var\(--accent\)/);
    expect(css).not.toMatch(/gradient/);
  });
});

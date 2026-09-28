# Lerno frontend redesign — 28 September 2026

## Direction

**Field Notes:** warm white, quiet evergreen, restrained blue and warm-paper accents.
A study workspace, not a marketing template. No copied branding, downloaded imagery,
remote fonts, animation library or new production dependency. The existing React,
router, SVG icon set and CSS-variable architecture remain in place.

The previous UI gave navigation, statistics and actions similar visual weight.
This revision changes the hierarchy, not just the colors:

- **Shell:** grouped navigation, a clear active state, create action and account
  footer. A compact desktop library search uses the existing Discover route.
  Mobile has four primary destinations plus a keyboard-accessible More dialog
  containing the complete navigation. A skip link targets the main content.
- **Dashboard:** one recommended study action, a separate Today panel, compact
  quick actions, recent library tiles and a smaller review queue. The CTA and its
  set title come from the existing server-provided continue action. No guessed
  activity, streaks or session durations.
- **Library:** a shared `StudySetCard`, responsive grids, real subject/level/card
  metadata and local search/subject/visibility filtering on My Sets. Filters do
  not trigger new network requests. Discover remains a truthful public library,
  not a fabricated popularity/recommendation ranking.
- **Set detail:** three distinct study modes; AI and management actions are
  secondary. Question/answer rows have a clear reading order.
- **Study / practice / quiz / AI study:** focus shell without the sidebar or
  bottom navigation, a visible return route, generous cards and clearer progress,
  selected answers and feedback. No changes to study queues, grading or scheduling.
- **AI:** a spacious welcome area, suggestion cards, readable chat surfaces and a
  stationary composer around the scrolling conversation. Original prompts,
  requests, history, model settings and response rendering are unchanged.
- **Progress:** three primary metrics, a compact secondary metrics strip, real
  week activity and Today side by side. Learned-card progress stays separate
  from accuracy. No synthetic charts or fake recent sessions.
- **Subjects / Favorites:** quieter library cards and actionable empty states.
- **Settings:** grouped account, appearance, study preferences, privacy, AI
  information and session controls. No nonfunctional preference switches.
- **Auth:** a split desktop composition with a small CSS/SVG paper illustration,
  compact mobile forms and unchanged authentication behavior.

Some requested metadata is not in the existing set-summary API: last studied,
per-set mastery and favorite state. It is intentionally **not invented** or
fetched separately for every tile. Favorite/edit/delete actions remain on the
existing set-detail flow. Recent sessions are likewise not fabricated.

## Design system and accessibility

- Shared spacing tokens: 4, 8, 12, 16, 20, 24, 32, 40, 48 and 64px.
- Shared surfaces, type hierarchy, button heights, borders, radii and status colors.
- Light is the new default; saved dark preferences remain respected. Multiple
  theme toggles now share one UI preference, including settings and focus routes.
- Stronger input-boundary tokens are separate from decorative card borders.
- Color tests assert 4.5:1 for tested normal-text pairs and 3:1 for input/focus
  boundaries in both themes. Automated browser checks additionally inspect the
  rendered pages.
- Visible focus, keyboard-operable links/buttons, selected quiz `aria-pressed`,
  modal focus containment/restoration, menu arrow-key navigation and Escape.
- Reduced-motion preference applies to CSS transitions and AI scrolling.
- LoadingRow uses layout-shaped, screen-reader-labelled skeletons; error states
  use the shared visual language and existing retry/navigation actions.

## Browser audit

Actual Chromium/Playwright rendering against the **unchanged development API in
in-memory mode**, using an isolated development account and sample study sets.
No production data, Supabase access or model calls were used.

| Pages                                                                     | Light widths         | Dark widths |
| ------------------------------------------------------------------------- | -------------------- | ----------- |
| Dashboard, AI, My Sets, Discover, Subjects, Favorites, Progress, Settings | 390, 768, 1024, 1440 | 390, 1440   |
| Set detail, Study, Practice, Quiz, AI study setup                         | 390, 768, 1024, 1440 | 390, 1440   |
| Login, Register (`/signup`)                                               | 390, 768, 1024, 1440 | 390, 1440   |

**90 route/theme/viewport captures:** no document horizontal overflow. Every
capture was checked to ensure it reached the intended route rather than silently
redirecting to another page. Screenshots/contact sheets were inspected for
consistent hierarchy. axe WCAG A/AA checks at 390 and 1440px (and all four auth
widths in light mode) reported **no violations** in these states. This is not a
claim of complete WCAG conformance or physical-device/screen-reader certification.

Ten additional interactive states passed overflow and axe checks:

1. Mobile More menu, initial focus, Escape and focus restoration.
2. Settings theme switch and shared dark preference.
3. Local library filtering and no-results state.
4. Set AI dropdown with arrow-key selection.
5. Card AI dropdown near the desktop right edge.
6. Revealed flashcard in dark focus mode.
7. Selected quiz answer (`aria-pressed`).
8. AI conversation containing headings, lists, formulas and code.
9. A 390×560 viewport with a long composer input: Send remains above mobile nav.
10. Library network-error state with retry.

The AI answer and network failure in the last scenarios were browser-route
fixtures only, not live AI output. AI-study generation/evaluation continue to be
covered by the existing mocked suite; live model behavior was not retested.
Browser emulation does not substitute for an actual iOS/Android keyboard test.

The audit caught and fixed a near-threshold keyboard-hint contrast pair, an
inline link distinguished only by color, dark-theme initialization on focus
routes, and card dropdown positioning.

Sanitized results (no credentials or account IDs):
[viewport audit](ui-redesign/viewport-audit.json) ·
[interactive audit](ui-redesign/interaction-audit.json).

### Selected screenshots

[Dashboard desktop](ui-redesign/dashboard-desktop.png) ·
[AI mobile](ui-redesign/ai-mobile.png) ·
[Study dark](ui-redesign/study-dark.png) ·
[Login desktop](ui-redesign/login-desktop.png).

These screenshots show development data. They are documentation only and are
not imported into the application bundle. The remaining captures and browser
tooling were kept outside tracked source/dependencies.

## Verification and performance

```sh
npm test
npm run lint
npm run typecheck
npm run build
```

- 530 backend + 187 frontend tests (717 total).
- Added tests for navigation/focus shell, modal keyboard behavior, synchronized
  themes, library filtering/retry/empty states and palette contrast.
- Existing dashboard assertions changed only to reflect its new section markup.
- No backend, database, Supabase/auth service, API contract, MCP, AI service,
  study scheduling, package manifest or lockfile changes.
- Production build: main JS **99.07 kB gzip** (previously 95.45 kB); CSS
  **12.25 kB gzip** (previously 8.60 kB). The visual work adds about 7.3 kB gzip
  across those bundles. No runtime image downloads or added framework.

For a manual re-audit, run `npm run dev:backend` in the existing development-data
mode and `npm run dev:frontend`. Use a throwaway local account, create sample sets
through the UI, and inspect the routes above at each width and in both themes.
Include empty/error/loading states, open dropdowns, Tab/Shift+Tab/Escape, reduced
motion, long titles, and a long AI-composer input. Never put audit credentials in
source or point sample-data creation at production.

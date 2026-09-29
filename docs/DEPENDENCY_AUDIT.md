# Dependency audit — Lerno content engine

Date: 2026-09-29 (Europe/Amsterdam)
Command: `npm audit` and `npm audit fix --dry-run` from the repository root, on the lockfile of this branch.

Result of the fresh audit: **7 vulnerabilities — 5 moderate, 1 high, 1 critical.**
Every fix npm offers is a **breaking major upgrade**, so nothing is upgraded in this PR and
`npm audit fix --force` was **not** run. This document records what is affected, why an
upgrade is or is not safe, and what risk remains in the meantime.

## The seven findings

| # | Package | Severity | Vulnerability | Impact on Lerno | Current | Fixed in | Upgrade now? | Residual risk |
|---|---------|----------|---------------|-----------------|---------|----------|--------------|---------------|
| 1 | `vitest` (direct, dev) | critical | [GHSA-5xrq-8626-4rwp](https://github.com/advisories/GHSA-5xrq-8626-4rwp) — arbitrary file read/execute when the Vitest **UI** server is listening | Only the optional Vitest UI server is affected. Lerno runs `vitest run` (headless), never `vitest --ui`, and no Vitest server is exposed in dev, CI or production. | 2.1.9 | 3.2.6 | No — major (`vitest@5` per npm), and the fix spans two majors of tooling that the whole test setup depends on. | Low: not exploitable in how Lerno runs its tests. |
| 2 | `vitest` / `@vitest/mocker` (direct + transitive, dev) | moderate | [GHSA-82fw-gwwq-j7x9](https://github.com/advisories/GHSA-82fw-gwwq-j7x9) — path traversal / arbitrary file read via `@vitest/mocker` redirect mocks | Requires a malicious mock inside the test suite itself; mocks are first-party code in this repository. | 2.1.9 | 4.1.11 | No — same major-upgrade chain as #1. | Low: test-only, no untrusted mocks. |
| 3 | `vite` (direct, dev) | high | [GHSA-fx2h-pf6j-xcff](https://github.com/advisories/GHSA-fx2h-pf6j-xcff) — `server.fs.deny` bypass on Windows alternate paths (+ [GHSA-4w7w-66w2-5vf9](https://github.com/advisories/GHSA-4w7w-66w2-5vf9) optimized-deps `.map` path traversal, [GHSA-v6wh-96g9-6wx3](https://github.com/advisories/GHSA-v6wh-96g9-6wx3) launch-editor NTLMv2 disclosure) | The high finding is Windows-only and needs a running Vite dev server on an untrusted network. Lerno's dev server binds locally; production serves the built bundle, not Vite. | 5.4.21 | 6.4.3+ (`npm` offers 8.3.1) | No — major; also requires `@vitejs/plugin-react` 5.x, `vitest` 3/4, jsdom bump. Out of scope for this PR. | Low in production (no Vite server); medium while someone runs `npm run dev` on Windows on a shared network. |
| 4 | `vite-node` (transitive, dev) | moderate | Depends on the vulnerable `vite` range above | Same story as `vite`: test-time only. | 2.1.9 | via `vitest` 4 | No — follows the vitest upgrade. | Low. |
| 5 | `esbuild` (transitive, dev) | moderate | [GHSA-67mh-4wv8-2f99](https://github.com/advisories/GHSA-67mh-4wv8-2f99) — the dev server lets any website send requests to it and read the response | Dev server only, and only while it is running with a browser open. `tsx`/`vitest` pull esbuild in. | 0.21.5 (under `vite@5`) | 0.25.0+ | No — arrives through `vite`; fixed by the same major upgrade. | Low: dev-only. |
| 6 | `react-router` (transitive, runtime) | moderate | [GHSA-wrjc-x8rr-h8h6](https://github.com/advisories/GHSA-wrjc-x8rr-h8h6) open redirect via backslash in `<Link>`/`useNavigate`; [GHSA-337j-9hxr-rhxg](https://github.com/advisories/GHSA-337j-9hxr-rhxg) constructor injection in SSR hydration | The SSR advisory does not apply: Lerno is a client-side SPA with no SSR hydration. The redirect advisory needs an attacker-controlled link target; all navigation targets in Lerno are internal routes. | 6.30.6 | 7.18.0 | No — major (6 → 7) with a real migration of route APIs and the router test suite. | Low for this app; tracked for a dedicated upgrade. |
| 7 | `react-router-dom` (direct, runtime) | moderate | Depends on the vulnerable `react-router` above | Same as #6. | 6.30.6 | 7.18.4 | No — major. | Low. |

## What was checked before deciding not to upgrade

- **Is there any in-range fix?** No. The declared ranges are `vitest ^2.1.4`, `vite ^5.4.10`,
  `react-router-dom ^6.28.0`; the newest versions inside those ranges (2.1.9 / 5.4.21 / 6.30.6)
  are exactly what is installed, and all three are still inside the vulnerable ranges.
  `npm audit fix` (without `--force`) therefore changes nothing.
- **Why not `--force`?** npm's own output says it would install `vitest@5.0.2`,
  `vite@8.3.1` and `react-router-dom@7.18.4` — three breaking majors that would also require
  `@vitejs/plugin-react`, `jsdom` and router code changes. That is a separate, deliberate
  migration with its own verification, not something to smuggle into a feature PR.
- **Runtime vs. tooling.** Five of the seven (all vitest/vite/vite-node/esbuild findings) are
  `devDependencies`: they never ship to the browser or the API. The two runtime findings are the
  react-router ones, whose realistic impact in Lerno is low (no SSR, no external link targets).

## Follow-up (tracked, not done here)

1. Upgrade the test toolchain in one step: `vitest` 3.x/4.x + `vite` 6.x/7.x +
   `@vitejs/plugin-react` 5.x + `jsdom` 26/27, then re-run backend and frontend suites.
2. Migrate `react-router-dom` to 7.x and update the router usage and tests.
After both steps, `npm audit` should report zero findings. Until then the residual risk is
documented above rather than hidden behind `--force`.

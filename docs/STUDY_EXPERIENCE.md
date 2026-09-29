# The study experience

> PLAN → LEARN → PRACTICE → TEST → ANALYZE → REVIEW → REPEAT

This is the student-facing layer on top of the adaptive engine (migration `0009`,
`rankLearnCandidates`, `rankRecommendations`, `concept_mastery`, `learning_events`).
It adds **study sessions**, a **rule-based planner**, **exam awareness**, **progress**
and **contextual AI Tutor help**. It does **not** add a second mastery or
recommendation system: every answer, rating and test result still ends up in the same
tables and is read back by the same ranking code.

```
Study Pack → Concepts → Learning events → Mastery → Recommendations → Sessions → Plan
  (material)  (what)     (every answer)   (one model) (what next)       (do it)    (when)
```

## Principles

- **No AI for deterministic logic.** Mastery, exam priority, recommendations, question
  selection, plan ordering and session progress are plain, tested rules, so the whole
  experience works without Groq. AI is only used for explanations, the tutor, summaries and
  content generation.
- **The server is the source of truth.** A session lives in the database: reload, a second tab
  or another device continues at the same item. Nothing is lost when a request fails; the UI
  keeps the answer and offers a retry.
- **Real data only.** No points, XP or coins. The streak counts finished sessions only. A trend
  is drawn only when there are at least three real days of data, and an empty account gets an
  honest empty state.
- **Batched.** One request builds a session, one answers an item, one saves a whole test, one
  returns the Progress page. Nothing asks the server per card or per concept.

## Services (backend)

| Service                          | Owns                                                                                     |
| -------------------------------- | ---------------------------------------------------------------------------------------- |
| `mastery-service`                | the only write path into `concept_mastery` + learning events; daily snapshots and trends |
| `recommendation-service`         | ranking of learn / practice / review / test tasks; adaptive question and test selection  |
| `study-plan-service`             | the daily plan (“Today”), exam plans on `study_plans`, exam-aware refresh                |
| `study-session-service`          | session lifecycle, item planning, answering, completing, results, mistakes               |
| `study-progress-service`         | the Progress page, the streak, the subject overview                                      |
| `session-model`                  | pure lifecycle, active-time and resume-card helpers shared by the above                  |
| `learn-content`, `tutor-context` | example finder / source excerpts, and what the tutor is given as context                 |

`study-pack-service` delegates `today`, `createPlan` and `getPlan` to the plan service, and its
older practice, rating and test endpoints go through `mastery-service`, so the classic Study
Pack API keeps working unchanged (and is covered by regression tests).

## Study sessions

A session has a **type** (`learn`, `practice`, `review`, `test`), a **pack**, target concepts, a
list of **items** (a concept to learn or a question to answer), progress and a result. It
moves through `not_started → active → completed | abandoned`.

- `POST /api/study-sessions` is **idempotent**: asking for the session that is already open
  resumes it (`200`, `resumed: true`). `restart: true` ends the open one and starts fresh.
- Items are planned **once**, in one batched pass from the recommendation engine. The pre-start
  screen (`GET /preview`) uses the same planner, so what it promises is what the session gets,
  and it writes nothing.
- Answering an item is **idempotent** per item. The response is deliberately small (the item
  with its feedback, the progress); the learn material is only in the full session.
- **Learn** per concept: explanation → example (from the student's own material, or an honest
  “no example yet”) → a short check question → a self-rating (Again / Hard / Good / Easy).
- **Practice / Review**: one question at a time with instant feedback, the explanation, the
  concept, the source and the mastery change.
- **Test** (10 questions, 20 questions or an exam simulation): **no explanations, no mastery
  hints and no per-question grading** while it runs. Answers are autosaved with one `PUT`, and
  everything is graded when the test is handed in. The AI Tutor answers `409` during a test.
  Tests are for the pack's owner and need at least three questions.
- **Completing** builds the result from the real mastery change: score, per-concept
  `old% → new%`, concepts that are still weak, and the recommended next step. A test also
  produces the “You know well / Needs practice” analysis and stores a `test_attempt`.
- **Review mistakes** lists only what was not answered correctly: the question, your answer,
  the correct answer, the explanation, the concept, the source, and a link to practise it.
- Active study time counts gaps between interactions, capped at 5 minutes each, so leaving a
  tab open does not inflate it.

## How the engine chooses

- **Learn**: weak → new → learning → due → confirmation of what looks mastered. Thresholds are
  the engine's: weak < 30 %, learning < 60 %, strong ≥ 85 %.
- **Practice / Review / Test questions** get a score per question (constants in
  `QUESTION_SCORING`): the concept's state (weak +100, due +60, new +45, learning +40), the
  question's own history (missed in the last 14 days +70, never seen +35, answered correctly in
  the last 3 days −60, shown in the last 24 hours −40), difficulty that fits the mastery,
  concept importance, a focus concept (+200) and the exam. Picks are greedy with a diversity
  penalty so one concept or format cannot fill a session. **The same question never appears
  twice in a session**, and one shown in the last 24 hours is pushed down the list.
- **Mastery updates** (the existing model): rating again −0.10, hard +0.05, good +0.15, easy
  +0.25; answer correct +0.20, partial +0.08, incorrect −0.15.

## The planner and exams

- **Today** ranks the activities of every pack with the same engine and fits them to a daily
  budget: **25 minutes**, 30 at ≤ 14 days before an exam, 35 at ≤ 7, 45 at ≤ 2. The first
  step is the one primary action; the rest is secondary. There is **no hardcoded subject
  order**: subjects appear in the order the engine ranked them.
- **Exam priority** rises as the exam gets near (+8 / +20 / +35 / +50 at ≤ 30 / 14 / 7 / 2 days)
  and lowers the value of concepts that are already strong.
- **Countdown**: the exam date is a calendar day. “Today” is the student's local day
  (`profiles.timezone`), both sides are compared as `YYYY-MM-DD`, so there is no off-by-one
  around midnight, time zones or daylight saving. Impossible dates such as `2026-02-31` are
  rejected.
- **Exam plans** (`study_plans`) are rebuilt every day, after each session and when the exam
  date changes. Each day lists concrete activities (“Learn 3 concepts”, “Practice 10
  questions”, “Take a practice test”) that map onto session types.

## Progress

- `GET /api/progress/study`: overall mastery, active study time, questions answered, cards
  reviewed, tests completed, concepts mastered, recent improvement, the streak and, per pack,
  mastery, trend, weak and strong concepts and activity.
- **Daily mastery snapshots** (`mastery_snapshots`, one row per pack per day) are written when a
  session is completed, or ended after at least one answer. The trend needs **three real
  days**; before that the page says so instead of drawing a flat line.
- **Streak** = consecutive days with a completed session that has at least one answer (plus
  ended flashcard sessions). Opening the app never counts.

## AI Tutor and contextual help

The tutor can be opened from a concept or from inside a session. The **server** builds the
context (the current concept, the pack, normalized sources, approved generated content and the
student's recent mistakes on it) and the client only sends ids (`context: { conceptId,
sessionId, itemId }`). Each reply says whether it is **“Based on your material”** (with its
sources) or a **general explanation**. Small actions sit next to what the student is looking
at: _Ask AI Tutor_, _Explain this_, _Show source_, _Practice this_.
`GET /api/study-packs/:packId/concepts/:conceptId/source` returns the passage a concept comes
from.

## API

All routes need a signed-in student. Someone else's session, item or subject answers `404`,
exactly like a missing one.

| Method and path                                     | Purpose                                                  |
| --------------------------------------------------- | -------------------------------------------------------- |
| `GET /api/study-sessions/preview`                   | What a session would contain (writes nothing)            |
| `POST /api/study-sessions`                          | Create or resume a session                               |
| `GET /api/study-sessions/active`                    | Open sessions (“Continue where you left off”)            |
| `GET /api/study-sessions/:id`                       | The full session                                         |
| `POST /api/study-sessions/:id/items/:itemId/answer` | Check one answer (Practice, Review, Learn check)         |
| `POST /api/study-sessions/:id/items/:itemId/rating` | Self-rating of a Learn concept                           |
| `POST /api/study-sessions/:id/items/:itemId/skip`   | Skip a question                                          |
| `PUT /api/study-sessions/:id/answers`               | Autosave a test (no correctness in the response)         |
| `POST /api/study-sessions/:id/complete`             | Finish: result, mastery, snapshot, next step             |
| `POST /api/study-sessions/:id/abandon`              | End without a result                                     |
| `GET /api/study-sessions/:id/mistakes`              | Only the wrong answers, in full                          |
| `GET /api/progress/study`                           | The Progress page in one request                         |
| `GET /api/subjects/:id/overview`                    | The subject page in one request (owner only)             |
| `GET /api/study-packs/today`                        | Today: plan, exam banner, resume cards, subjects, streak |

## Frontend

| Route                                        | What it is                                                                 |
| -------------------------------------------- | -------------------------------------------------------------------------- |
| `/study`                                     | My Study: Today, the plan, exam banner, resume, one line per subject       |
| `/study-packs/:id?tab=learn\|practice\|test` | The pre-start screen (`&concept=`, `&mode=review\|quick10\|quick20\|exam`) |
| `/study/sessions/:id`                        | The runner (Learn, Practice, Review, Test), results; `?view=mistakes`      |
| `/subjects/:id`                              | Subject overview                                                           |
| `/progress`                                  | Progress                                                                   |

UX rules that are tested: **at most one primary action** on My Study; one activity per screen
during a session; a fixed bottom action bar on phones (safe-area aware); touch targets of at
least 44–48 px; real radios and labels; focus moves to each new question; feedback is an
`aria-live` region; colour is never the only signal (“Correct answer” / “Your answer” badges,
the rating words); only theme tokens are used, so light and dark keep their contrast.

## Migration

`database/migrations/0011_learning_sessions.sql` is **additive** (see `docs/DEPLOYMENT.md`): it
adds `learning_sessions`, `learning_session_items` and `mastery_snapshots`, each with own-row
row-level security. The classic flashcard timer table `study_sessions` is untouched, which is
why the new tables carry the `learning_` prefix. Attempts and history are not duplicated:
answers are still `practice_attempts`, `test_attempts` and `learning_events`.

## Testing

```bash
npm run typecheck && npm run lint && npm run test && npm run build
```

Backend: session create/resume/complete, adaptive selection, weak-first priority, duplicate
avoidance, test analysis, plan generation, exam priority, multi-pack ranking, snapshots and
ownership (`study-sessions.test.ts`, `study-experience.test.ts`, the service tests), plus a
static guard that keeps migration 0011 additive, re-runnable, private to each student and in
step with the Supabase repository (`lib/db/migration-0011.test.ts`). Frontend:
the learn, practice and test runners, results, review mistakes, My Study, resume, subject and
progress pages, empty and error states, the AI Tutor drawer, route helpers and the CSS/a11y
basics.

## Not in this change

Spaced-repetition scheduling of flashcards (unchanged, `scheduling-service`), generating
questions with AI (unchanged, still behind the editable preview), and any social or competitive
feature.

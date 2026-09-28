# Lerno AI (built-in study assistant)

Lerno AI is the built-in chat assistant of the Lerno website. Signed-in students ask
questions at [`/ai`](http://localhost:5173/ai) and get clear explanations at their own
level. It is a normal Lerno feature: it uses the existing Supabase login and the
existing backend — it is **fully independent of the MCP server**.

```
Lerno frontend → Lerno backend (POST /api/ai/chat) → Groq API
```

The **Groq API key never leaves the backend**. It is not part of any response, log
line, or frontend bundle, and it is never committed to Git.

## Configuration

All Lerno AI settings live on the backend only (`backend/src/config.ts`) and are read
from environment variables. Nothing is hardcoded per environment.

| Variable                  | Default                 | What it does                                                                            |
| ------------------------- | ----------------------- | --------------------------------------------------------------------------------------- |
| `GROQ_API_KEY`            | _(empty = AI disabled)_ | Server-side Groq key. Never commit, never ship to the browser.                          |
| `GROQ_MODEL`              | `openai/gpt-oss-120b`   | Chat model; change to switch models without code changes.                               |
| `GROQ_MAX_OUTPUT_TOKENS`  | `2048`                  | Upper bound on tokens per answer (256–8192).                                            |
| `GROQ_TEMPERATURE`        | `0.6`                   | Sampling temperature (0–2).                                                             |
| `GROQ_REASONING_EFFORT`   | `auto`                  | `auto` = per-task effort; `low`/`medium`/`high` forces one level for a measurement run. |
| `GROQ_TIMEOUT_MS`         | `30000`                 | Timeout for one upstream call (1–120 s).                                                |
| `GROQ_MAX_RETRIES`        | `1`                     | Retries inside the Groq SDK (0–3).                                                      |
| `AI_RATE_LIMIT_MAX`       | `20`                    | AI messages per user per window.                                                        |
| `AI_RATE_LIMIT_WINDOW_MS` | `300000` (5 min)        | Window for the per-user AI quota.                                                       |
| `AI_RATE_LIMIT_IP_MAX`    | `60`                    | Wider per-IP quota for the AI endpoint.                                                 |
| `GROQ_JSON_MODE`          | `true`                  | Ask Groq for JSON on structured tasks (always validated).                               |
| `AI_CONTEXT_MAX_CARDS`    | `60`                    | Max cards sent to the model as set context (5–200).                                     |
| `AI_CONTEXT_MAX_CHARS`    | `12000`                 | Hard ceiling for one set context (1 000–40 000).                                        |

Empty values fall back to the defaults; out-of-range values fail fast at boot instead
of silently misbehaving. See [`DEPLOYMENT.md`](DEPLOYMENT.md) for where to set them.

## Running locally

```bash
npm install
cp backend/.env.example backend/.env
cp frontend/.env.example frontend/.env
# optional, enables AI answers:
#   put GROQ_API_KEY=gsk_... into backend/.env

npm run dev:backend     # http://localhost:4000
npm run dev:frontend    # http://localhost:5173
```

Then log in (or sign up — development data mode works without Supabase) and open
`/ai` in the frontend. Without `GROQ_API_KEY` the page still works; every question
returns the friendly "not available" error instead of an answer.

## The AI endpoint

`POST /api/ai/chat` (authentication required — same Supabase bearer token as every
other protected Lerno route):

```json
{
  "message": "Leg de Franse Revolutie uit op mavo 3 niveau",
  "history": [
    { "role": "user", "content": "Leg fotosynthese uit" },
    { "role": "assistant", "content": "Fotosynthese is…" }
  ]
}
```

### Input limits

Limits are separate per field, so a long conversation is **trimmed**, never rejected
(`backend/src/lib/ai-limits.ts`):

| Limit                         | Value  | Behaviour when exceeded      |
| ----------------------------- | ------ | ---------------------------- |
| `message` (the new question)  | 2 000  | `400 VALIDATION_ERROR`       |
| One history item              | 8 000  | `400 VALIDATION_ERROR`       |
| History items per request     | 30     | `400 VALIDATION_ERROR`       |
| Total history characters      | 48 000 | `400 VALIDATION_ERROR`       |
| Serialized request body       | 96 000 | `400 VALIDATION_ERROR`       |
| History messages sent to Groq | 12     | oldest dropped (newest wins) |
| Characters per message sent   | 4 000  | trimmed with a `…` marker    |
| Total context sent to Groq    | 16 000 | oldest dropped until it fits |

An earlier AI answer longer than 2 000 characters therefore never causes a 400 — the
history is normalized before the Groq call.

### History normalization

`normalizeHistory()` (`backend/src/lib/ai-sanitize.ts`) runs before every upstream call:

- drops malformed entries (anything that is not `{ role: 'user' | 'assistant', content: string }`)
- trims over-long messages, keeping the newest text
- keeps the newest 12 messages and drops an orphan leading `assistant` turn
- enforces the total character budget
- strips chat-template tokens (`<|im_start|>`, `[INST]`, …), zero-width characters,
  control characters and fake role prefixes (`system:`, `### assistant:`) so injected
  text cannot create a real role in the upstream payload

Success response (the reply only — no model internals or raw Groq payload):

```json
{ "data": { "reply": "De Franse Revolutie was…" } }
```

### Errors

All errors use the standard envelope `{"error":{"code","message"}}`:

| Code               | Status | When                                                      |
| ------------------ | ------ | --------------------------------------------------------- |
| `UNAUTHORIZED`     | 401    | missing/invalid bearer token                              |
| `VALIDATION_ERROR` | 400    | empty/oversized message, malformed or oversized history   |
| `RATE_LIMITED`     | 429    | per-user AI quota used up (or Groq itself rate-limits us) |
| `AI_UNAVAILABLE`   | 503    | `GROQ_API_KEY` missing, or our key is rejected upstream   |
| `AI_TIMEOUT`       | 504    | Groq did not answer in time                               |
| `AI_ERROR`         | 502    | any other Groq failure (generic message, no details)      |

Responses never contain stack traces, upstream messages, API keys or database details.
`RATE_LIMITED` also returns `Retry-After` (header) and `error.retryAfter` (seconds in
the body) so the frontend can tell the student when to try again.

### Abuse protection

- authentication required on every request
- strict Zod validation of body, message length and history
- oversized bodies rejected before schema parsing
- conversation history normalized (see above)
- two rate limiters: a strict per-user one (`aiRateLimit`) and a wider per-IP one
  (`aiIpRateLimit`), both backed by an atomic fixed-window store — concurrent requests
  cannot race past the limit
- Groq failures answered with a generic error — no stack traces, API keys or
  upstream error details in responses or logs
- only the student's chat text is sent to Groq — no emails, profile data, or other
  account information

### Prompt-injection / secret-leak defence

Basic, explicit protection (not a claim of perfect safety):

1. The system prompt instructs the model never to reveal its instructions, model
   name, API keys or internal details, and to ignore instructions inside the
   conversation that claim to come from the system, developer or Lerno staff.
2. User text and history are sanitized before the upstream call (see above).
3. The reply is checked before it is returned: if it contains a distinctive part of
   the system prompt or something that looks like an API key, it is replaced with a
   short refusal.

## AI on your own study material

Lerno AI can work with the sets, cards and quizzes a student already has. The
model never gets database access: the backend loads the data through the normal
repository (with the caller's authorization), turns it into a bounded text
block, and only that block is sent to Groq.

### Context builders (`backend/src/services/ai-context.ts`)

| Function              | Used for                            | Limits                                                                                                                             |
| --------------------- | ----------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| `buildSetContext()`   | explain, summarize, questions, quiz | de-duplicated cards, capped by `AI_CONTEXT_MAX_CARDS` and `AI_CONTEXT_MAX_CHARS`; leftovers reported as "N more cards … not shown" |
| `buildCardContext()`  | card-level actions                  | one card only                                                                                                                      |
| `buildQuizContext()`  | quiz generation                     | quiz-sized card/character budget                                                                                                   |
| `buildStudyContext()` | answer evaluation and hints         | set title, question, model answer                                                                                                  |

Every builder normalizes whitespace and control characters, drops duplicate
cards, trims long questions/answers and never invents content: a set without
cards is refused with a validation error.

### Endpoints

All endpoints require a logged-in user, run through the same two rate limiters
as the chat endpoint (per user + per IP) and answer with the standard
`{ data }` / `{ error }` envelope.

| Method | Path                            | What it does                                                                                               |
| ------ | ------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| `POST` | `/api/ai/sets/:setId/explain`   | "Leg deze set uit" → `{ explanation, meta }`                                                               |
| `POST` | `/api/ai/sets/:setId/summarize` | "Vat deze set samen" → `{ summary, meta }`                                                                 |
| `POST` | `/api/ai/sets/:setId/questions` | practice questions (`count` 5/10/15, `difficulty`) → `{ questions, meta }`                                 |
| `POST` | `/api/ai/sets/:setId/quiz`      | generated quiz (`types`, `count`, `difficulty`) → `{ questions, meta }`                                    |
| `POST` | `/api/ai/cards/:cardId/action`  | card action (`explain`, `example`, `hint`, `practice`) → `{ text, action }`                                |
| `POST` | `/api/ai/generate-set`          | flashcards from a prompt → preview, **nothing is stored**                                                  |
| `POST` | `/api/ai/study/evaluate`        | judges one answer → `{ verdict, feedback, missing }`                                                       |
| `POST` | `/api/ai/study/hint`            | a hint that never reveals the answer → `{ hint }`                                                          |
| `POST` | `/api/ai/study/finish`          | session summary + progress → `{ total, correct, partial, incorrect, accuracy, topicsToReview, persisted }` |

`meta` always reports what the AI actually saw: `{ setId, totalCards, contextCards, omittedCards }`.

### Data isolation

1. the route requires authentication
2. the service loads the set with `canViewSet` — the exact rule the normal set
   endpoints use: your own sets, or public sets
3. a card id that does not belong to the given set is `404 Card not found`; a
   set you may not see is `404 Study set not found`
4. only the authorized, trimmed data becomes model context

A manipulated or foreign id therefore behaves exactly like the existing set
endpoints: same status codes, same messages, no data in the response.

### Structured output and validation

Structured tasks ask the model for JSON (`GROQ_JSON_MODE`) but never trust it:

1. markdown fences and surrounding prose are stripped
2. the first balanced JSON object is extracted (`lib/ai-json.ts`)
3. `JSON.parse` runs inside a try/catch
4. the result is validated with Zod (`lib/ai-schemas.ts`) — questions, cards,
   quizzes, evaluations and hints each have their own schema

Invalid output is retried once (bounded) and then answered with
`502 AI_INVALID_CONTENT` and a friendly message. No unvalidated AI JSON ever
reaches the browser. The schemas also reject duplicate questions/cards,
multiple choice without exactly four options, a `correctIndex` outside the
options, true/false without `True`/`False`, open questions without an answer,
empty fields and over-long text.

### Error handling

| Code                 | Status | When                                                  |
| -------------------- | ------ | ----------------------------------------------------- |
| `NOT_FOUND`          | 404    | set/card not visible to the caller                    |
| `VALIDATION_ERROR`   | 400    | invalid body, set without cards, oversized payload    |
| `AI_INVALID_CONTENT` | 502    | the AI answer failed schema validation                |
| `AI_TIMEOUT`         | 504    | Groq did not answer in time                           |
| `AI_UNAVAILABLE`     | 503    | `GROQ_API_KEY` missing or rejected upstream           |
| `RATE_LIMITED`       | 429    | per-user/per-IP quota used up (includes `retryAfter`) |
| `AI_ERROR`           | 502    | any other upstream failure                            |

No stack traces, upstream messages, keys or database details leave the backend.

### AI Study Mode ("Overhoor mij")

Route: `/sets/:setId/ai-study` — an extra option, the normal flashcard study
flow is untouched.

1. choose 5/10/15 questions and a level
2. Lerno AI writes the questions from the set (validated JSON)
3. the student answers; the model judges it as `correct`, `partial` or
   `incorrect` with short feedback — never plain string matching
4. "Hint" gives a nudge without the answer and goes one step further per hint
5. at the end: totals, accuracy, "Onderwerpen om opnieuw te oefenen" and a link
   back to the normal practice mode

When a question is based on a specific card (the model reports a `cardRef`,
validated against the set's cards) the result is recorded through the existing
spaced-repetition review flow, so the set's schedule and the student's progress
stay in sync. `partial` counts as "not fully known" and returns to the queue.
Sessions themselves are not stored in a separate table — the durable outcome is
the study progress.

### Generated sets

`/ai/generate-set` returns a preview only. The student reviews (and can edit or
remove) every card, and saving goes through the normal `POST /api/sets`
endpoint, so all existing validation applies. Nothing is written to the
database until "Set opslaan".

### Token economy per task

Task prompts live in `backend/src/services/ai-prompts.ts`, each with its own
budget, temperature and reasoning effort — no giant prompt reused for everything:

| Task        | Output tokens                  | Temperature | Reasoning |
| ----------- | ------------------------------ | ----------- | --------- |
| `explain`   | 650                            | 0.4         | low       |
| `summarize` | 450                            | 0.3         | low       |
| `questions` | 520 + 110/question (max 2 200) | 0.7         | medium    |
| `cards`     | 600 + 110/card (max 4 000)     | 0.7         | medium    |
| `quiz`      | 520 + 110/question (max 2 200) | 0.6         | medium    |
| `evaluate`  | 220                            | 0.2         | medium    |
| `hint`      | 120                            | 0.6         | low       |
| `card`      | 300                            | 0.5         | low       |

Free chat picks its budget per question (greeting 96, arithmetic 200, short
"wat is/waarom" 320, hint 160, single practice question 280, normal explanation
800, explicit detailed request 1 800) and its reasoning effort per question
(see below). `GROQ_MAX_OUTPUT_TOKENS` remains the absolute ceiling for free
chat; set context is bounded by `AI_CONTEXT_MAX_CARDS` / `AI_CONTEXT_MAX_CHARS`.

### Reasoning effort (GPT-OSS)

GPT-OSS on Groq accepts `reasoning_effort` = `low` | `medium` | `high`
(`medium` is the provider default). The reasoning itself is hidden, but it is
billed and **counts against the same `max_completion_tokens` ceiling**, so the
effort level decides latency, cost and how much of the output budget has to be
reserved:

| Effort   | Reserved completion tokens | Used for                                                      |
| -------- | -------------------------: | ------------------------------------------------------------- |
| `low`    |                        256 | explanations, definitions, "why" questions, greetings, hints  |
| `medium` |                        512 | problem solving (math), complex evaluation, generation        |
| `high`   |                      1 024 | **not used by default** — no measured gain for school answers |

Central policy in `backend/src/services/ai-reasoning.ts`:

- per task: `AI_TASKS[task].reasoning` (table above)
- free chat: `chatReasoningEffort(message)` — a question that asks for a
  calculation, a deep explanation or _new_ material gets `medium`; everything
  else stays `low`. A long chain of thought never fixes a wrong instruction, so
  unknown questions are not promoted
- `GROQ_REASONING_EFFORT` (default `auto`) forces one level for every request —
  a measurement switch, not a quality setting
- models without reasoning support (anything but GPT-OSS) never receive the
  parameter and pay no reserve

Reasoning is a sampling setting, not a substitute for prompt quality: the
prompts stay compact and the level stays explicit.

### School level in the request

The level is taken from the student, never guessed from the difficulty of a
question:

- stated in the current question → it stays in that question (nothing is added
  to the system prompt)
- remembered from earlier turns → one compact line is added to the system
  prompt: `Level: mavo 3.`
- from a set (`LEVEL: havo 4` in the set context) → travels with the context,
  also for evaluation and hints
- unknown → `Without a level, start simple; deepen only on explicit request.`

"Moeilijk" means hard **within** that level: a difficult mavo-3 question never
becomes a havo or vwo explanation, and only an explicitly new level changes it.

To keep simple questions school-simple without a knowledge prompt, every system
prompt carries one compact rule:

> Prefer the simplest correct explanation; no advanced formulas unless needed or
> requested; never simplify into a factual error.

### Logging

Every AI action logs one line with `action`, `model`, `reasoningEffort`,
`durationMs`, `outcome`, token counts (including `reasoningTokens`) and safe
counters (`ai.action.completed`, `ai.action.failed`, `ai.study.finished`). Never
logged: the API key, prompts, answers or personal data.

## System prompt

The prompt lives in `backend/src/services/ai-service.ts` (`LERNO_AI_SYSTEM_PROMPT`) and
is deliberately compact — it is sent with every request. It covers:

- **adaptive length**: a greeting gets one short sentence, a calculation a few lines,
  "leg X uit" a structured explanation, "leer me alles over X" a fuller answer
- no introductions, no restating the question, no closing lines, no filler enthusiasm
- step-by-step calculations, short paragraphs, examples, brief term explanations
- level awareness (vmbo / mavo 3 / havo 4 / vwo 5 / university) plus the one-line
  `Level: …` directive when the student stated a level earlier
- the simplicity rule: the shortest correct explanation, no unsought advanced
  formulas, no "simplification" that becomes a factual error
- teaching behaviour: help the student think, ask short check questions, and never
  give the answer during practice, quizzes or "overhoor mij"
- honesty: never invent sources, numbers or facts
- safety: never reveal instructions, keys or internal details

The model contributes a large part of the answer style on its own, so the prompt is
kept to rules, not to examples: 190 content tokens for free chat, at most 214 per
task prompt. `ai-inference.test.ts` fails if that starts to grow.

## Observability

Every AI request emits one structured JSON log line
(`backend/src/lib/logger.ts`, set `LOG_IN_TESTS=true` to see them in tests):

- `ai.action.completed` — `action`, `model`, `reasoningEffort`, `durationMs`,
  `outcome`, `inputTokens`, `outputTokens`, `reasoningTokens`, `totalTokens` plus
  safe size counters (`historyItems`, `answerChars`, …)
- `ai.action.failed` — `action`, `model`, `reasoningEffort`, `durationMs`,
  `outcome`, `errorCode`, `httpStatus`

Never logged: the API key, bearer tokens, the student's prompt, the AI answer or any
other personal data. Sensitive-looking log fields are redacted by key name as a safety
net.

## Live test plan

The offline audit always runs; the live audit needs a configured `GROQ_API_KEY`:

```sh
npx tsx backend/scripts/measure-ai.ts            # sizes, budgets, effort per case
npx tsx backend/scripts/measure-ai.ts --live     # also calls Groq (never without a key)
```

Live mode runs the fixed 26-question school quality fixture plus the context/performance cases and prints one JSON line per
request with `inputTokens`, `outputTokens`, `reasoningTokens`, `ttftMs`, `totalMs`,
`answerWords`, the resolved `reasoningEffort` and boolean smoke checks — enough to
compare two configurations (for example `GROQ_REASONING_EFFORT=low` versus `auto`).
The streamed call exists only in this script; production answers in one request.

## How the frontend uses it

- `frontend/src/pages/ai/LernoAiPage.tsx` — the chat page at `/ai` (behind
  `RequireAuth`, so it uses the normal Lerno session — no separate AI login).
- `frontend/src/services/aiService.ts` — the only place that calls `POST /ai/chat`
  through the shared `lib/api` client (which attaches the bearer token). It trims the
  history client-side as well and aborts a request after 45 s.
- The page keeps the conversation in memory and sends the last 12 messages as
  `history` so follow-up questions ("En wat doet chlorofyl?") keep their context.
- AI answers render through `frontend/src/lib/markdownLite.ts` (blocks) and
  `frontend/src/lib/mathLite.ts` (formulas) — a small parser that renders headings,
  lists (including nested), tables, quotes, code blocks, links, bold/italic and
  LaTeX-ish math as React elements. **No raw HTML is ever injected.**

### Chat UX

- Enter sends, Shift+Enter adds a newline, IME composition is respected
- one request at a time: double Enter or double click cannot fire a second request
- a failed send restores the question to the composer, shows a friendly error and
  offers "Try again"; nothing the student typed is lost
- no fake streaming — the backend answers once, so the page shows one clear loading
  state and then the full answer
- per answer: copy and regenerate; the header offers "New chat" to clear context
- the view only auto-scrolls when the student is already at the bottom

## Frontend, AI on your material

- `frontend/src/services/aiLearningService.ts` — all AI learning calls.
- `frontend/src/components/ai/AiSetActions.tsx` — the “Vraag Lerno AI” menu on a
  set (leg uit, vat samen, maak oefenvragen, overhoor mij, maak quiz).
- `frontend/src/components/ai/AiCardActions.tsx` — the compact “Vraag AI” action
  on an individual flashcard.
- `frontend/src/components/ai/AiQuestionsModal.tsx` — generated practice questions
  with reveal-answer and hint.
- `frontend/src/components/ai/AiQuizModal.tsx` — the generated quiz, rendered as a
  real quiz (multiple choice, true/false, open answers judged by the AI).
- `frontend/src/components/ai/AiGenerateSetModal.tsx` — prompt → preview → save.
- `frontend/src/pages/sets/AiStudyPage.tsx` — AI Study Mode at
  `/sets/:setId/ai-study`.

Everything is optional: without `GROQ_API_KEY` the whole app keeps working and
the AI actions simply answer “temporarily unavailable”.

## Tests

```bash
npm run test:backend   # AI chat, set actions, questions, quiz, cards, generation, study
npm run test:frontend  # chat page, markdown/formulas, AI set actions, quiz, study flow
```

Backend coverage: free chat (validation, context, errors, rate limiting,
logging), set actions (ownership, huge sets, context trimming, secrets),
practice questions (valid/malformed/duplicate/out-of-range JSON), quiz
generation (types, `correctIndex`, true/false options), card actions
(ownership, per-card context), generated sets (preview-only, duplicates, empty
fields, card limits), overhoor mode (correct/partial/incorrect, hints, session
summary + progress), route-level rate limiting, and the deterministic inference
configuration (`ai-inference.test.ts`: reasoning effort per task and per chat
question, reserve and ceiling behaviour, level handling, prompt-size guardrails,
observability).

Frontend coverage: AI set menu, explain/summarize rendering with loading and
retry, practice questions (reveal, hint, options), quiz interaction (multiple
choice, open answers, score), generated-set preview (edit, remove, save only on
confirm), card actions, and the full overhoor flow from setup to result.

Groq is always mocked — tests never use a real API key.

## Prompt/context optimization audit

See [AI-OPTIMIZATION.md](AI-OPTIMIZATION.md) for the measured baseline, context budgets, regression checks and outstanding live verification.

## School quality policy (2026-09-28)

AI answers specific curriculum questions only when the relevant content is available in context. Otherwise Lerno asks the user to provide the material instead of guessing.

The compact prompts prefer the simplest **correct** explanation. The student's
explicit level/year wins; “hard” means harder within that level, never an automatic
mavo → havo → vwo promotion. A remembered level comes only from user history.
Explicit requests for depth may go further. Requested language takes precedence
over the language of the question (important for translation exercises).

Start with the core idea, add an example only when useful. Short questions do not
have a mandatory 100–250-word explanation target. Calculations show formula,
substitution and result with units. Practice follows the requested count (default
one), withholding the solution until an attempt; hints give the next small step.
Check names, numbers, units, formulas and causality, avoid false certainty and
precision. Simplification must not change the facts: glucose is a sugar usable as
an energy source **or** material for other substances, and the Moon has much less
mass than Earth (size alone does not establish mass).

These are instructions, not guarantees. We deliberately do not regex-replace
historical names or scientific statements in arbitrary answers: quotations,
negations and comparisons make that unsafe. Deterministic factual checks run on
fixed development probes, not as a universal production fact checker. Structured
learning flows retain their existing JSON/Zod validation and at most one retry.
There is **no second critic call** for ordinary answers; model, reasoning defaults,
output budgets, context selection and authorization remain unchanged.

### Regression fixture and measurement

`backend/scripts/fixtures/ai-quality.ts` contains 26 school questions spanning
math, physics, biology, history, Dutch, English and German. Probes cover the known
mass/weight, Moon `GM/R²`, difficult-mavo, photosynthesis/oxygen-smell and
Lodewijk XVI (not XIV) failures. Every probe has a reviewed good and bad answer
for testing the detector, not an exact expected model response. Additional probes
cover single-question practice, hints without solutions, units, language, length
and basic HTML/boilerplate signals.

```bash
npm run test --workspace=backend -- src/services/ai-quality.test.ts
npx tsx backend/scripts/measure-ai.ts
npx tsx backend/scripts/measure-ai.ts --live
# Optional: include ONLY static fixture questions, never student data/answers:
npx tsx backend/scripts/measure-ai.ts --live --show-fixtures
```

Live execution requires the existing server-side Groq configuration and consumes
provider quota: 26 streamed quality requests plus 9 requests for the eight context
cases (one seeds the actual follow-up). Each quality record includes task, subject,
case ID, prompt length, selected reasoning effort, token usage, first visible-token
time, latency, answer length and boolean checks. A failed signal sets exit code 1.
No raw answers, system prompts or keys are printed; normal production logs are
unchanged. Fixtures are not imported into production services.

**Signals are heuristic, not grading:** required concepts may miss a correct
paraphrase, question marks are only a proxy for question count, language-specific
phrases are not a language detector, and a response can contain an expected number
while drawing a wrong conclusion. Inspect failures and manually review factual
accuracy, side selection for Pythagoras, causal claims, level and naturalness in a
controlled development session. Mocked tests prove request shaping, one-call
plumbing and detector behavior, not live model quality.

Markdown continues to render safe React elements, never raw HTML or
`dangerouslySetInnerHTML`. Regression tests cover both `-` and `*` bullets, ordered
lists, headings, code and readable formulas. Single-line display math now stops at
its closing delimiter instead of swallowing the following explanation/list.
Conservative prose cleanup also removes standalone stock openings on the same
line; fenced code is untouched.

No live quality result is claimed for this change: the local `--live` attempt
stopped before any provider calls because `GROQ_API_KEY` was not configured.

## AI Study Studio

The authenticated Studio lives at `/ai/studio` and uses the existing `/api/ai`
router, Supabase-backed session, Groq client, and per-user/IP AI rate limits. It
supports pasted text, private selectable-text PDF extraction, and sets the caller
can already view. Actions are explicit: source summary, editable flashcards,
interactive quiz preview, self-check practice questions, source-aware chat, and a
source-grounded study plan with selectable duration and daily study time.
The Studio does not send an AI request on source selection. Generated content is
never written to the database automatically; flashcards use the existing set
creation route only after the student chooses **Save as a private set**.

Sources are session-only and intentionally have no server-side ID or durable
record. Pasted text stays in page memory; a PDF is parsed from the authenticated
request's in-memory upload and its extracted text is returned to that uploader's
page session. Each subsequent task sends bounded source text again. Sets send a
set ID only, and the backend calls the existing `loadSetForAi`/`canViewSet`
authorization path again before every task. This avoids public file URLs,
cross-user source tokens, database access by Groq, and process-local cache
assumptions in multi-instance deployments. No Supabase Storage or database
migration is required.

PDF restrictions: actual PDF signature and parser validation; 15 MB maximum; at
most 100 pages; selectable text only; up to 50,000 extracted characters. Password-
protected, damaged, image-only and scanned PDFs receive a clear validation error.
There is no OCR. Files are held in memory only for parsing, never written to a
filesystem or public bucket, and are not sent to Groq until an action is chosen.

Before each model call, content is cleaned, repeated lines are removed, and the
source is capped per task: summary 14,000 characters, flashcards/quiz 12,000,
practice 11,000, study plan 10,000, chat 9,000. Oversized content uses explicit beginning/end
excerpts. Structured summary/cards/quiz/questions/study plans are parsed and Zod-validated,
including duplicate questions/options and requested counts; malformed output has
at most one bounded retry. The chat prompt distinguishes source-backed claims
from general explanation and asks the model to say when material is insufficient.
Practice answers are self-checked by reveal; they are not represented as an AI
score or persisted result. This version intentionally excludes OCR, video/audio,
YouTube, scraping, RAG/vector stores, and third-party integrations.

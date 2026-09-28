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

| Variable                  | Default                 | What it does                                                   |
| ------------------------- | ----------------------- | -------------------------------------------------------------- |
| `GROQ_API_KEY`            | _(empty = AI disabled)_ | Server-side Groq key. Never commit, never ship to the browser. |
| `GROQ_MODEL`              | `openai/gpt-oss-120b`   | Chat model; change to switch models without code changes.      |
| `GROQ_MAX_OUTPUT_TOKENS`  | `2048`                  | Upper bound on tokens per answer (256–8192).                   |
| `GROQ_TEMPERATURE`        | `0.6`                   | Sampling temperature (0–2).                                    |
| `GROQ_TIMEOUT_MS`         | `30000`                 | Timeout for one upstream call (1–120 s).                       |
| `GROQ_MAX_RETRIES`        | `1`                     | Retries inside the Groq SDK (0–3).                             |
| `AI_RATE_LIMIT_MAX`       | `20`                    | AI messages per user per window.                               |
| `AI_RATE_LIMIT_WINDOW_MS` | `300000` (5 min)        | Window for the per-user AI quota.                              |
| `AI_RATE_LIMIT_IP_MAX`    | `60`                    | Wider per-IP quota for the AI endpoint.                        |

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

## System prompt

The prompt lives in `backend/src/services/ai-service.ts` (`LERNO_AI_SYSTEM_PROMPT`) and
is deliberately compact — it is sent with every request. It covers:

- **adaptive length**: a greeting gets one short sentence, a calculation a few lines,
  "leg X uit" a structured explanation, "leer me alles over X" a fuller answer
- no introductions, no restating the question, no closing lines, no filler enthusiasm
- step-by-step calculations, short paragraphs, examples, brief term explanations
- level awareness (vmbo / mavo 3 / havo 4 / vwo 5 / university)
- teaching behaviour: help the student think, ask short check questions, and never
  give the answer during practice, quizzes or "overhoor mij"
- honesty: never invent sources, numbers or facts
- safety: never reveal instructions, keys or internal details

## Observability

Every AI request emits one structured JSON log line
(`backend/src/lib/logger.ts`, set `LOG_IN_TESTS=true` to see them in tests):

- `ai.chat.completed` — `model`, `durationMs`, `outcome`, `historyItems`,
  `historyChars`, `questionChars`, `answerChars`, `inputTokens`, `outputTokens`,
  `totalTokens`
- `ai.chat.failed` — `model`, `durationMs`, `errorCode`, `httpStatus`, `historyItems`

Never logged: the API key, bearer tokens, the student's prompt, the AI answer or any
other personal data. Sensitive-looking log fields are redacted by key name as a safety
net.

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

## Tests

```bash
npm run test:backend   # AI endpoint, context shaping, errors, rate limiting, config
npm run test:frontend  # chat page, markdown parser, formula rendering, AI service
```

Backend coverage: authentication, validation (per-field limits), history trimming,
follow-up context, prompt-injection resistance, Groq success/timeout/error/rate-limit,
missing key, error envelope, rate limiting per user and per IP (including a concurrent
burst), logging without secrets, and environment configuration.

Frontend coverage: send, Enter/Shift+Enter, loading and duplicate-send protection,
error recovery and retry, history, suggestions, copy, regenerate, new chat, long
answers, markdown (headings, lists, tables, code, quotes, links), formulas, XSS safety
and screen-reader attributes.

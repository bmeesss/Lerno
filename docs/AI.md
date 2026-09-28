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

## `GROQ_API_KEY`

- Server-side only environment variable of the backend (`backend/src/config.ts`).
- Create a free key at [console.groq.com](https://console.groq.com/keys) and set it in
  `backend/.env` (local) or the Render environment (production).
- Without a key the rest of Lerno works normally; `POST /api/ai/chat` then answers
  `503 AI_UNAVAILABLE` ("Lerno AI is not available right now").
- Never put it in `frontend/.env`, frontend code, or Git.

The chat model is also configurable: `GROQ_MODEL` (default `openai/gpt-oss-120b`).
Change the variable to switch models — no code changes needed.

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

- `message` — required, trimmed, 1–2000 characters. Empty or oversized messages get
  `400 VALIDATION_ERROR`.
- `history` — optional prior turns of the current conversation (newest last). At most
  30 entries are accepted; the backend keeps only the **newest 12** for the Groq call
  so requests stay small. Roles are limited to `user` / `assistant`.

Success response (the reply only — no model internals or raw Groq payload):

```json
{ "data": { "reply": "De Franse Revolutie was…" } }
```

Errors use the standard envelope `{"error":{"code","message"}}`:

| Code               | Status | When                                           |
| ------------------ | ------ | ---------------------------------------------- |
| `UNAUTHORIZED`     | 401    | missing/invalid bearer token                   |
| `VALIDATION_ERROR` | 400    | empty/oversized message, malformed history     |
| `RATE_LIMITED`     | 429    | more than 20 messages per 5 minutes per user   |
| `AI_UNAVAILABLE`   | 503    | `GROQ_API_KEY` not configured                  |
| `AI_ERROR`         | 502    | Groq call failed (generic message, no details) |

Implementation: `backend/src/routes/ai.routes.ts` → `controllers/ai.controller.ts` →
`services/ai-service.ts`. The system prompt for the study assistant lives in
`ai-service.ts` (`LERNO_AI_SYSTEM_PROMPT`).

### Abuse protection

- authentication required on every request
- strict Zod validation of body, message length and history
- conversation history bounded (30 accepted / 12 sent)
- per-user rate limit (`aiRateLimit`, keyed by user id with IP fallback)
- Groq failures answered with a generic `AI_ERROR` — no stack traces, API keys or
  upstream error details in responses or logs
- only the student's chat text is sent to Groq — no emails, profile data, or other
  account information

## How the frontend uses it

- `frontend/src/pages/ai/LernoAiPage.tsx` — the chat page at `/ai` (behind
  `RequireAuth`, so it uses the normal Lerno session — no separate AI login).
- `frontend/src/services/aiService.ts` — the only place that calls
  `POST /ai/chat` through the shared `lib/api` client (which attaches the bearer
  token).
- The page keeps the conversation in memory and sends the last 12 messages as
  `history` so follow-up questions ("En wat doet chlorofyl?") keep their context.
- AI answers render through `frontend/src/lib/markdownLite.ts` — a small parser that
  renders headings/lists/bold/code as React elements (no raw HTML is ever injected).
- Enter sends a question, Shift+Enter adds a newline, and the send button is disabled
  while a request is in flight so students cannot fire parallel requests.

# Lerno MCP (Phase 7–8B)

Lerno MCP is the official [Model Context Protocol](https://modelcontextprotocol.io/)
interface to Lerno. It lets compatible AI clients (ChatGPT, Claude and other
MCP clients) answer questions like “what should I learn now?” or “how am I
doing today?” — and create or delete study content on request — using the
same data and rules as the Lerno website.

The server exposes fourteen read tools (nine data tools plus five learning
actions), four write tools and two confirmation-gated delete tools. There
are deliberately no score, streak, history-edit or settings tools.

## Architecture

MCP is an extra interface on top of Lerno — not a second backend:

```
AI client (Streamable HTTP)
  → POST /api/mcp on the existing backend
    → standard bearer-token authentication
      → existing Lerno services (set, study, quiz, progress, retention)
        → repository / database (RLS in production)
```

Concretely:

- `backend/src/mcp/` holds the MCP layer: tool definitions (`tools.ts`),
  strict Zod input schemas (`schemas.ts`), the server factory (`server.ts`)
  and the Express route (`router.ts`).
- The route is mounted at `POST /api/mcp` in the existing Express app, so it
  shares CORS, helmet, rate limiting, the error envelope and the token-bound
  database from the global `attachDatabase` middleware.
- Transport is **Streamable HTTP in stateless mode** from the official
  `@modelcontextprotocol/sdk`: every request carries its own bearer token and
  gets a fresh server bound to the verified user. No sessions, no extra
  infrastructure — MCP deploys as part of the existing backend.
- Business rules are never duplicated: streaks, goals, due cards, queues,
  ownership checks and quiz generation all run in the existing services. MCP
  handlers only shape service output into compact, model-friendly JSON.

## Available tools

| Tool | Arguments | Returns |
| ---- | --------- | ------- |
| `lerno_get_profile` | — | id, display name, avatar, member since |
| `lerno_list_sets` | — | own sets: id, title, subject, visibility, card count, timestamps |
| `lerno_get_set` | `setId` (UUID) | set metadata (no cards) for an owned or public set |
| `lerno_get_cards` | `setId` (UUID) | flashcards (question, answer, position) of an owned or public set |
| `lerno_get_progress` | — | same numbers as `GET /api/progress` |
| `lerno_get_today` | — | same summary as the website Today panel |
| `lerno_get_due_reviews` | — | due cards grouped by set, from the spaced-repetition schedule |
| `lerno_get_next_action` | — | the single recommended next study action (same source as the dashboard) |
| `lerno_get_quiz` | `setId` (UUID) | generated quiz questions for an owned or public set (**without** correct answers, same rule as the website) |
| `lerno_create_set` | title, subject, description, level, visibility, tags, cards[] | `{ created, set: { id, title, visibility, cardCount } }` |
| `lerno_add_cards` | `setId` + cards[] | `{ created, setId, totalCards }` |
| `lerno_update_set` | `setId` + set fields | `{ updated, set: { id, title, description, visibility, cardCount } }` |
| `lerno_update_cards` | `setId` + card patches | `{ updated, setId, totalCards }` |
| `lerno_delete_set` ⚠️ destructive | `setId` + `confirmation: "DELETE"` | `{ deleted, setId, title }` |
| `lerno_delete_card` ⚠️ destructive | `setId` + `cardId` + `confirmation: "DELETE"` | `{ deleted, setId, cardId }` |
| `lerno_start_practice` | `setId` + optional `limit` | website-identical practice queue (questions + answers) |
| `lerno_start_quiz` | `setId` (UUID) | generated quiz (**without** correct answers, same rule as the website) |
| `lerno_get_wrong_cards` | optional `setId`, `limit` | recently failed cards, most recent first |
| `lerno_get_study_recommendation` | — | exact website-dashboard recommendation + context |
| `lerno_create_study_plan` | optional `days` (1–30), `setIds` | day-by-day suggestions: due → wrong → new |

Every tool has a description telling the model what it does, when to use it,
what it returns and what it cannot do. Input schemas are strict Zod objects;
unknown or malformed arguments yield a validation error, never a guess.

## Authentication

Lerno is an OAuth **resource server**; **Supabase Auth is the OAuth 2.1
authorization server** (authorize, token, JWKS, discovery and dynamic client
registration all live there — Lerno implements no custom OAuth endpoints).
The full flow for a real MCP client:

```
1. Client POSTs to /api/mcp without a token
2. Lerno answers 401 + WWW-Authenticate: Bearer resource_metadata="…/.well-known/oauth-protected-resource"
3. Client fetches the protected-resource metadata → learns the Supabase issuer
4. Client fetches the Supabase authorization-server metadata, registers
   (dynamic registration) and opens the authorize URL with PKCE
5. The student logs in on the Lerno consent page (/oauth/consent) and approves
6. Client exchanges the code at the Supabase token endpoint (PKCE verifier)
7. Client retries /api/mcp with Authorization: Bearer <supabase-access-token>
8. Lerno verifies the token (signature + expiry, server-side) and scopes every
   tool to the verified identity; refresh tokens are rotated by Supabase
```

Rules that always hold:

- The user id comes exclusively from the verified token — tools take no
  `userId`/`email` argument, and forged identity fields are ignored.
- Without a valid token the endpoint answers `401 UNAUTHORIZED` before any
  MCP handling runs, so unauthenticated requests never see private data.
- OAuth-issued tokens are standard Supabase JWTs: the existing token
  verification and RLS policies apply unchanged, and expired tokens are
  rejected (the client refreshes them at Supabase, never at Lerno).
- v1 tools authorize on identity only; the advertised `openid`/`profile`/
  `email` scopes are informational until scope enforcement lands.

## Environments

|                    | Local development | Personal test env | Production |
| ------------------ | ----------------- | ----------------- | ---------- |
| Data + auth        | In-memory + dev JWTs | Real Supabase project | Real Supabase project |
| OAuth discovery    | PRM served, empty issuer list | Full (Supabase issuer) | Full (Supabase issuer) |
| Full OAuth dance   | Not possible (no AS) | Yes | Yes |
| Consent page       | “Not configured” state | Works | Works |
| MCP testing        | Direct Bearer (dev token) | OAuth or Bearer | OAuth |

Locally, authenticate MCP requests with a dev access token from
`POST /api/auth/signup` (see below). The complete browser-based OAuth flow
requires a Supabase project with the OAuth server enabled — use a personal
test project, never production credentials in tests.

## Local development

Requirements: Node.js 20+ and npm. No Supabase account needed — local runs use
development data mode (in-memory store).

```bash
npm install
npm run dev:backend   # Express API incl. MCP, default http://localhost:4000
```

Create a user and grab a token:

```bash
curl -X POST localhost:4000/api/auth/signup \
  -H 'Content-Type: application/json' \
  -d '{"email":"you@example.com","password":"password123","displayName":"You"}'
# → data.accessToken
```

List the tools (note: this SDK requires both Accept types and answers SSE-wrapped):

```bash
curl -X POST localhost:4000/api/mcp \
  -H 'Authorization: Bearer <token>' \
  -H 'Content-Type: application/json' \
  -H 'Accept: application/json, text/event-stream' \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list","params":{}}'
```

Run the MCP tests (part of the backend suite, no real credentials):

```bash
npm run test:backend   # includes mcp.test.ts (tools) + mcp-oauth.test.ts (OAuth/transport)
npm run test:frontend  # includes OAuthConsentPage.test.tsx (mocked Supabase client)
```

Check discovery and the 401 challenge directly:

```bash
curl localhost:4000/.well-known/oauth-protected-resource
curl -i -X POST localhost:4000/api/mcp \
  -H 'Content-Type: application/json' \
  -H 'Accept: application/json, text/event-stream' \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list","params":{}}'
# → 401 + WWW-Authenticate: Bearer resource_metadata="…"
```

## Environment variables

MCP needs **no extra variables** — it reuses the backend configuration:

| Variable | Used for |
| -------- | -------- |
| `PORT` | HTTP port the backend (incl. `/api/mcp`) listens on |
| `SUPABASE_URL` / `SUPABASE_ANON_KEY` | production database + token verification |
| `SUPABASE_SERVICE_ROLE_KEY` | server-side only; never exposed via MCP |
| `FRONTEND_URL` | CORS allow-list (MCP clients are server-to-server and send no `Origin`) |
| `NODE_ENV` | `production` refuses to start without Supabase credentials |

Never commit real values; in production attach them via the Render dashboard
(see `docs/DEPLOYMENT.md`).

## Render deployment

Deploy MCP as **part of the existing backend** — no new service needed:

- Same Render Web Service (`lerno-backend`), same build/start commands and
  same environment variables as documented in `render.yaml` and
  `docs/DEPLOYMENT.md`.
- The MCP URL is simply `https://<backend-host>/api/mcp`.
- Health checks (`/api/health`) and monitoring stay unchanged.
- A separate Render service would only add latency, cost and auth complexity
  with no benefit for stateless read tools, so v1 deliberately does not use one.

### Enabling OAuth (Supabase dashboard, once per project)

1. **Authentication → OAuth Server**: enable the OAuth 2.1 server.
2. Set the **Authorization Path** to `/oauth/consent` (the Lerno consent page;
   combined with the Site URL under **Authentication → URL Configuration**).
3. Enable **dynamic client registration** so ChatGPT/Claude register
   themselves (or pre-register clients under **OAuth Apps** instead).
4. Require user approval for clients; review redirect URIs and registered
   clients regularly.
5. Set `PUBLIC_BACKEND_URL` on the backend service to the public backend
   origin (must match the origin clients connect to).
6. Set `VITE_SUPABASE_URL` / `VITE_SUPABASE_ANON_KEY` on the frontend service
   and redeploy (Vite bakes them in at build time).
7. Recommended: migrate the project to asymmetric JWT signing (RS256/ES256)
   so tokens verify via JWKS without shared secrets.

## Supported clients

- **ChatGPT** (custom connector via Developer Mode, paid plans): remote
  HTTPS URL + OAuth 2.1. ChatGPT discovers
  `/.well-known/oauth-protected-resource`, registers dynamically and runs the
  PKCE flow against Supabase. Requires a deployed backend and consent page.
- **Claude** (custom connector, all plans; connects from Anthropic's cloud):
  same OAuth flow; alternatively a static Bearer token via Request headers for
  single-credential setups.
- **MCP Inspector** (local testing): point it at the local `/api/mcp`, send
  `Authorization: Bearer <dev-token>` as a custom header, and add the
  Inspector origin to `FRONTEND_URL` for browser CORS.
- **Any Streamable-HTTP MCP client**: `tools/list` + `tools/call` over
  `POST /api/mcp` with `Accept: application/json, text/event-stream`;
  responses are SSE-wrapped single messages (SDK behavior).

## Example usage from an MCP client

Point any Streamable-HTTP-compatible MCP client at the backend URL above and
configure it to send `Authorization: Bearer <user-access-token>` with each
request. A tool call looks like this over the wire:

```json
// → POST /api/mcp
{
  "jsonrpc": "2.0",
  "id": 2,
  "method": "tools/call",
  "params": { "name": "lerno_get_next_action", "arguments": {} }
}
```

```json
// ← SSE-wrapped result (data: …)
{
  "result": {
    "content": [{ "type": "text", "text": "{\"action\":{…}}" }],
    "structuredContent": {
      "action": { "type": "review", "setId": "…", "setTitle": "Biologie H1", "dueCount": 5 }
    }
  },
  "jsonrpc": "2.0",
  "id": 2
}
```

Typical prompts this enables: “What should I learn now?”, “How am I doing
today?”, “Quiz me on my Biology set”, “Which sets do I have?”.

## Write tools (Phase 8A)

Four tools let the AI create and edit the student's own content — always
through the same validators and services as the REST API and website:

- `lerno_create_set({ title, subjectId?, description?, level?, visibility?, tags?, cards? })`
  → `{ created: true, set: { id, title, visibility, cardCount } }`.
  New sets are **private** unless the student explicitly asks for public.
- `lerno_add_cards({ setId, cards })` → `{ created, setId, totalCards }`.
- `lerno_update_set({ setId, …fields })` → `{ updated: true, set: { … } }`.
- `lerno_update_cards({ setId, cards: [{ cardId, question?, answer? }] })`
  → `{ updated, setId, totalCards }`.

Rules:

- **Ownership**: writes require ownership. Other users' sets — even public
  ones — are read-only for the caller and answer `NOT_FOUND`.
- **Validation**: the canonical REST Zod validators run inside every handler
  (title ≤160, description ≤2000, question ≤2000, answer ≤4000, valid UUIDs,
  non-empty strings). Unknown fields are stripped, exactly like REST.
- **Maximums**: at most 500 cards per set and per batch; batches that would
  exceed the cap are rejected without writing anything.
- **Atomic batches**: every entry is validated (and, for updates, checked
  against the set) before the first write, so a bad batch changes nothing.
  Lerno has no database transactions; this validation-first design plus the
  single-service-call flow (`setService.create`, `addCards`) is the safest
  available pattern, and a half-written state is practically unreachable.
- **Duplicates**: Lerno has no app-wide duplicate-card policy, so MCP does
  not invent one for existing cards — but exact-duplicate cards (or repeated
  card ids) *within one batch* are rejected as invalid input.
- **Tool hints**: write tools advertise `readOnlyHint: false`,
  `destructiveHint: false`, `idempotentHint: false`; reads advertise
  `readOnlyHint: true`. The delete tools (below) are the only ones with
  `destructiveHint: true`.

Example prompts: “Make a private study set about photosynthesis for 3 mavo
with 20 flashcards”, “Add 5 harder cards to my Biology set”, “Rename my set
to «Biologie H1» and make it public”, “Fix the answer of the mitochondria
card”.

## Delete tools (Phase 8B)

Two destructive tools delete the student's **own** content through the same
services as `DELETE /api/sets/:setId` and
`DELETE /api/sets/:setId/cards/:cardId`:

- `lerno_delete_set({ setId, confirmation: "DELETE" })`
  → `{ deleted: true, setId, title }`. **This is a destructive action**: the
  whole set is permanently removed (see cleanup below) and cannot be undone.
- `lerno_delete_card({ setId, cardId, confirmation: "DELETE" })`
  → `{ deleted: true, setId, cardId }`. The card is permanently removed; the
  set's quiz cache is invalidated (questions regenerate, attempts are kept).

Rules:

- **Explicit confirmation**: both tools require the exact literal
  `confirmation: "DELETE"` (case-sensitive). A missing confirmation fails
  with “confirmation is required”, anything else with “Confirmation
  mismatch” — and nothing is deleted. A generic `confirmation: true` is
  never accepted. Each call deletes at most the one named resource.
- **Ownership**: only the owner can delete. Other users' sets — even public
  ones — answer `NOT_FOUND`, and guests get `401`. The check runs before
  the confirmation check, so foreign resources never leak existence.
- **Cleanup** (identical to REST, enforced by the services and — in
  production — by foreign-key cascades): deleting a set removes its cards,
  card progress, quizzes, quiz questions and quiz attempts; study sessions
  are kept but unlinked; subjects, reports and other users' data are
  untouched. Deleting a card removes its progress and invalidates the cached
  quiz questions; remaining cards keep their positions (no renumbering,
  same as REST).
- **No hidden deletes**: update tools never remove records, create tools
  never replace existing records, and each delete tool removes only its
  named target. Repeating a delete answers the same safe `NOT_FOUND` —
  never a silent deletion of something else.
- **Tool hints**: both tools advertise `readOnlyHint: false`,
  `destructiveHint: true`, `idempotentHint: false`.
ls as confirmation-worthy actions: only call
them when the student explicitly asked to delete something, and surface the
permanent nature (title in the response) before confirming. There is no
bulk delete, no “delete all cards”, and no account deletion.

Example prompts: “Delete the mitochondria card from my Biology set”,
“Verwijder mijn testset «MCP Test»” (the client must still pass the
explicit `"DELETE"` confirmation — the words alone never delete anything).

## Learning actions (Master Build)

Five read-only tools let the AI study *with* the student, reusing the exact
website services (no second learning engine):

- `lerno_start_practice({ setId, limit? })` — the website-identical practice
  queue (questions **and** answers, so the AI can check replies). Ask one by
  one; answering here records no progress — the student reviews on the
  website. `limit` only shortens the queue, never extends it.
- `lerno_start_quiz({ setId })` — the generated website quiz **without**
  correct answers. The AI asks the questions conversationally; scoring and
  attempts live on the website.
- `lerno_get_wrong_cards({ setId?, limit? })` — recently failed cards, most
  recent first, with mistake counts (default 20, max 50).
- `lerno_get_study_recommendation()` — the exact dashboard recommendation
  (“what should I learn now?”) with due/streak/goal context.
- `lerno_create_study_plan({ days?, setIds? })` — day-by-day suggestions over
  1–30 days (default 7): due reviews first, then wrong cards, then new cards,
  in daily-goal-sized portions. Suggestions only, never obligations; no
  medical or psychological claims.

All five advertise `readOnlyHint: true`, `destructiveHint: false`. Set-scoped
tools follow `canViewSet` (owned or public); wrong cards, recommendations and
plans are always scoped to the authenticated user. Results stay
server-authoritative: there is no way to forge scores, progress, timestamps
or user ids through these tools.

Example prompts: “What should I learn today?”, “Let me practice my difficult
biology cards”, “Make a quiz from my history set”, “What should I repeat
first?”, “Plan my week: photosynthesis exam on Friday”.

## Security model

- **Authentication first**: no valid token → `401`, no data, no tool listing.
- **Server-side authorization**: reads reuse `canViewSet` (owned or public);
  **writes require ownership** — foreign sets answer `NOT_FOUND` without
  confirming they exist. Identity, ownership and timestamps stay
  server-authoritative: forged `userId`/`ownerId`/`createdAt`/`score`/`role`
  arguments are stripped and ignored (covered by tests). Progress, Today, due
  reviews and next action are always scoped to the authenticated user.
- **Error discipline**: service errors map to `[CODE] message` tool errors
  (`UNAUTHORIZED`, `FORBIDDEN`, `NOT_FOUND`, `VALIDATION_ERROR`,
  `INTERNAL_ERROR`). Stack traces, SQL and file paths never leave the server.
- **No secrets in output**: tool results contain only learning data — no
  password hashes, tokens, emails, credentials or internal ids beyond what the
  website itself shows. Covered by an automated hygiene test.
- **No secrets in logs**: auth failures return before any logging; error logs
  never include tokens or authorization codes.
- **Rate limited**: the endpoint shares the public read limiter (IP-keyed).
- **Destructive tools are fenced**: exactly two tools delete anything
  (`lerno_delete_set`, `lerno_delete_card`), both need ownership plus the
  literal `"DELETE"` confirmation, and both are annotated
  `destructiveHint: true` so clients can gate them. No bulk delete, no
  history/score/streak edits, no account deletion exist.
- **Database layer**: in production the token-bound Supabase client enforces
  row-level security underneath the service checks (defense in depth).

## What Lerno MCP deliberately cannot do (yet)

- Submit quiz answers, record reviews, start sessions or change study data.
- Delete study history, reset progress, or modify scores, streaks or settings.
- Delete more than one set or card per call; delete accounts.
- Touch another user's content, or confirm that a foreign private set exists.
- Reveal correct quiz answers (same rule as the website).
- Change settings or anything admin/moderation related.

The remaining destructive actions are reserved for a later phase with extra
safety checks.
se with extra
safety checks.

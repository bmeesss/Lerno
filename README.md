# Lerno

A free-first study platform for students: learn, practice, quiz, review, and share study sets —
with no daily limits and no premium paywall for core learning features.

> When a student opens Lerno, the answer to "What should I do now?" should be obvious.

## What is Lerno?

- **Study sets & flashcards** — create sets with questions/answers, organized by subject and level.
- **Spaced repetition** — a simple, deterministic review scheduler (dedicated service, replaceable later).
- **Practice mode** — a smart mix of due, incorrect, difficult and new cards.
- **Quiz mode** — multiple choice, true/false and short answer, with scored results.
- **Discovery** — search public sets by subject, level, tags and text.
- **Lerno AI** — built-in study assistant: chat, but also AI that works on your
  own material — explain a set, make practice questions or a quiz, generate a
  full set from a description, get hints per card, and “Overhoor mij” study mode
  (Groq runs server-side only, always with the data you can already see).
- **AI Study Studio** — at `/ai/studio`, start with pasted notes, selectable-text PDF,
  or an existing set; generate a summary, editable flashcards, quiz, practice
  questions, a source-grounded study plan, or source-aware chat. Previews are not saved unless you confirm.
- **Study sessions & planner** — Learn, Practice and Test sessions that adapt to what you know,
  a daily plan that counts down to your exams, mistake review and honest progress
  (see [`docs/STUDY_EXPERIENCE.md`](docs/STUDY_EXPERIENCE.md)).
- **Guest learning** — study public sets without an account; sign up to keep progress.
- **Dark mode** — calm, modern, mobile-first UI with a green accent.

See [`docs/LERNO_SPEC.md`](docs/LERNO_SPEC.md) for the full product and technical specification.

## Architecture

| Layer      | Technology                     | Hosting            |
| ---------- | ------------------------------ | ------------------ |
| Frontend   | React + TypeScript (Vite)      | Render Static      |
| Backend    | Node.js + TypeScript + Express | Render Web Service |
| Database   | PostgreSQL + Auth              | Supabase           |
| Monitoring | `GET /api/health`              | UptimeRobot        |

```
lerno/
├── frontend/     # React app (Vite)
├── backend/      # Express API
├── database/     # SQL migrations (Supabase PostgreSQL)
├── docs/         # LERNO_SPEC.md and docs
└── tests/        # Cross-cutting smoke tests
```

AI clients (ChatGPT, Claude, …) can talk to Lerno over the official MCP
server: `POST /api/mcp` on the backend — fourteen read tools (including five
learning actions), four write tools and two confirmation-gated delete tools,
same auth and services as the REST API. See [`docs/mcp.md`](docs/mcp.md).

Key rules the codebase follows:

- Strict TypeScript, no `any`, validated API input (Zod) and authorization on every protected route.
- Business logic lives in backend services; React components only render and call services.
- Spaced-repetition scheduling lives in `backend/src/services/scheduling-service.ts` and nowhere else.
- Supabase row-level security is part of the security model (see `database/migrations`).
- **No secrets in Git.** The service-role key stays server-side only.

## Getting started

Requirements: Node.js 20+ and npm.

```bash
npm install
cp backend/.env.example backend/.env
cp frontend/.env.example frontend/.env
npm run dev:backend    # http://localhost:4000
npm run dev:frontend   # http://localhost:5173 (proxies /api to the backend)
```

### Development data mode

When `SUPABASE_URL` / `SUPABASE_ANON_KEY` are **not** set, the backend runs in
**development data mode**: authentication and data are served by an in-memory store so the
full product can be used and tested without external infrastructure. This mode is for local
development only — the production code path is Supabase-backed and used automatically once
the environment variables are present. Never run production without Supabase configured.

### With Supabase

1. Create a Supabase project.
2. Run the migrations in [`database/migrations/`](database/migrations/) in order (SQL editor or
   `psql`). They create the tables and enable row-level security. All of them are designed to be
   safely re-runnable against an existing database: applying the whole folder again never drops
   data and ends in the same schema (see
   [`docs/DEPLOYMENT.md`](docs/DEPLOYMENT.md#migrations-are-re-runnable)).
3. Fill `backend/.env` and `frontend/.env` with the project URL, anon key and (server-side only)
   service-role key.
4. Restart both dev servers.

## Scripts

| Command                   | What it does                                                                          |
| ------------------------- | ------------------------------------------------------------------------------------- |
| `npm run dev:frontend`    | Start the Vite dev server                                                             |
| `npm run dev:backend`     | Start the API with hot reload                                                         |
| `npm run build`           | Build backend and frontend                                                            |
| `npm run lint`            | ESLint                                                                                |
| `npm run format`          | Prettier write                                                                        |
| `npm run typecheck`       | TypeScript checks for both workspaces                                                 |
| `npm test`                | Backend + frontend test suites                                                        |
| `npm run test:smoke`      | End-to-end API smoke flow (signup → study → quiz → progress)                          |
| `npm run test:migrations` | Runs the migration chain against a real PostgreSQL server (needs `pg` and a database) |

## Deployment

- **Frontend** — Render Static Site: build `npm run build`, publish `frontend/dist`,
  set `VITE_API_BASE_URL` to the backend URL, add a rewrite of `/*` → `/index.html`.
- **Backend** — Render Web Service: build `npm run build`, start `npm start`
  (or `node backend/dist/index.js` from the repo root with root dir set accordingly).
  Set `NODE_ENV=production`, `SUPABASE_URL`, `SUPABASE_ANON_KEY`,
  `SUPABASE_SERVICE_ROLE_KEY`, `FRONTEND_URL`. Optionally set `GROQ_API_KEY`
  to enable Lerno AI (see [`docs/AI.md`](docs/AI.md)). `GROQ_MODEL`,
  `GROQ_MAX_OUTPUT_TOKENS`, `GROQ_TEMPERATURE`, `GROQ_TIMEOUT_MS` and the
  `AI_RATE_LIMIT_*` variables are optional and documented there.
- **Monitoring** — point UptimeRobot at `GET /api/health` (cheap by default; set
  `HEALTH_CHECK_DB=true` for an optional `SELECT 1` probe).
- See [`docs/DEPLOYMENT.md`](docs/DEPLOYMENT.md) for a full checklist.

Operational note: Render's free tier is intended for hobby projects and can spin down without
traffic. The initial goal is a €0 MVP, not unlimited free hosting forever.

## License

Private — all rights reserved.

# Deploying Lerno

Target stack (spec §17): **Render Static Site** (frontend), **Render Web Service**
(backend), **Supabase** (PostgreSQL + Auth), **UptimeRobot** (monitoring).
Goal: a €0 MVP on free tiers — with the operational caveats from the spec.

## 1. Supabase (database + auth)

1. Create a project at [supabase.com](https://supabase.com).
2. Apply the migrations **in order** (SQL editor or `psql`):
   - `database/migrations/0001_init.sql` — schema, indexes, profile trigger
   - `database/migrations/0002_rls.sql` — row-level security policies
   - `database/migrations/0003_quiz_questions_delete.sql`, `0004_profile_timezone.sql`,
     `0005_rls_guest_quiz_reports.sql` — subsequent application fixes
   - `database/migrations/0006_profiles_role_privileges.sql` — **required before
     enabling MCP OAuth**: prevents bearer holders from changing `profiles.role`
     directly through Supabase. Apply even to existing databases.
   - `database/migrations/0007_study_packs.sql` and `0008_study_packs_rls.sql` — Study Packs,
     concepts, mastery, practice and test storage.
   - `database/migrations/0009_adaptive_learning.sql` — confidence, concept review dates and
     the shared learning-event ledger used by adaptive recommendations.
3. Collect the credentials from _Project Settings → API_:
   - `Project URL` → `SUPABASE_URL`
   - `anon public` key → `SUPABASE_ANON_KEY` (safe for the browser; never used
     for privileged operations)
   - `service_role` key → `SUPABASE_SERVICE_ROLE_KEY` (**server only** — never
     commit it, never ship it to the frontend)
4. Auth settings:
   - Decide whether email confirmation is required (Auth → Providers → Email).
     With confirmation enabled, signup responds with
     `needsEmailConfirmation: true` and the UI asks the student to check email.
   - Set the Site URL to the frontend origin and add it to the redirect
     allow-list (used by password reset links).
5. To make the first admin: sign up through the app, then in the SQL editor:

   ```sql
   update public.profiles set role = 'admin' where id = '<your-auth-user-id>';
   ```

## 2. Backend (Render Web Service)

- **Root directory:** `backend`
- **Build command:** `npm install && npm run build`
- **Start command:** `npm start`
- **Environment variables:**

  | Variable                    | Value                                               |
  | --------------------------- | --------------------------------------------------- |
  | `NODE_ENV`                  | `production`                                        |
  | `PORT`                      | `10000` (Render provides one; the app reads `PORT`) |
  | `SUPABASE_URL`              | from Supabase                                       |
  | `SUPABASE_ANON_KEY`         | from Supabase                                       |
  | `SUPABASE_SERVICE_ROLE_KEY` | from Supabase (server-side only)                    |
  | `FRONTEND_URL`              | the frontend origin(s), comma-separated             |
  | `PUBLIC_BACKEND_URL`        | public backend origin (for MCP OAuth metadata)      |
  | `HEALTH_CHECK_DB`           | `true` (optional cheap `SELECT 1` probe)            |
  | `GROQ_API_KEY`              | Groq API key for Lerno AI (optional, server only)   |
  | `GROQ_MODEL`                | default `openai/gpt-oss-120b`                       |
  | `GROQ_MAX_OUTPUT_TOKENS`    | default `2048` (256–8192)                           |
  | `GROQ_TEMPERATURE`          | default `0.6` (0–2)                                 |
  | `GROQ_TIMEOUT_MS`           | default `30000`                                     |
  | `GROQ_MAX_RETRIES`          | default `1` (0–3)                                   |
  | `AI_RATE_LIMIT_MAX`         | AI messages per user per window, default `20`       |
  | `AI_RATE_LIMIT_WINDOW_MS`   | default `300000` (5 minutes)                        |
  | `AI_RATE_LIMIT_IP_MAX`      | AI messages per IP per window, default `60`         |

| `GROQ_JSON_MODE` | default `true` |
| `AI_CONTEXT_MAX_CARDS` | AI set context card cap, default `60` |
| `AI_CONTEXT_MAX_CHARS` | AI set context character cap, default `12000` |

Lerno AI is optional: without `GROQ_API_KEY` the rest of the app works and the
AI endpoint answers a clean `503` (see [`AI.md`](AI.md)). The AI settings below
are all optional and fall back to the documented defaults; out-of-range values
stop the service at boot instead of failing at runtime.

In production the backend **refuses to start** without Supabase credentials —
development data mode is never used in production. `PUBLIC_BACKEND_URL` is
also mandatory and must be a bare HTTPS origin. See [MCP OAuth setup](mcp.md#authentication)
for Supabase dashboard consent, PKCE client and redirect registration steps.

## 3. Frontend (Render Static Site)

- **Root directory:** `frontend`
- **Build command:** `npm install && npm run build`
- **Publish directory:** `dist`
- **Redirects/rewrites:** add `/* → /index.html` (SPA routing).
- **Environment variables:**

  | Variable                 | Value                                                    |
  | ------------------------ | -------------------------------------------------------- |
  | `VITE_API_BASE_URL`      | `https://<backend-service>.onrender.com/api`             |
  | `VITE_SUPABASE_URL`      | optional, only if the browser talks to Supabase directly |
  | `VITE_SUPABASE_ANON_KEY` | optional, anon key only                                  |

  The frontend calls the backend with relative-ish configured base URLs and
  never holds service credentials.

## 4. Monitoring (UptimeRobot)

1. Create an HTTP(s) monitor for `GET https://<backend-service>.onrender.com/api/health`.
2. Interval: 5 minutes is enough to keep free-tier services warm and detect
   downtime. The endpoint is intentionally cheap (JSON only unless
   `HEALTH_CHECK_DB=true`).
3. Optionally match the response body for `"status": "ok"`.

## 5. CORS checklist

Set `FRONTEND_URL` to exactly the frontend origin (e.g.
`https://lerno.onrender.com`). The backend rejects cross-origin requests from
any other origin. Local development defaults to `http://localhost:5173`.

## 6. Operational notes

- Render free web services spin down after ~15 minutes without traffic; the
  UptimeRobot monitor pings keep the service awake for hobby usage and surface
  outages. Free tiers have usage limits — the €0 goal is an MVP posture, not a
  promise of unlimited free capacity (spec §17).
- Never commit `.env` files. Rotate any credential that accidentally lands in
  Git and treat it as compromised.
- Backups: Supabase free tier includes limited backups; export regularly if the
  data matters.

## 7. Release checklist

- [ ] Migrations through 0006 applied, RLS enabled (`select relrowsecurity from pg_class` shows `t`)
- [ ] With disposable non-admin Supabase user, direct `profiles.role = 'admin'` insert/update is denied, ordinary own display-name updates work, and a service-role admin can still change roles
- [ ] In isolated staging, Supabase OAuth accepts RFC 8707 `resource` for the canonical MCP URL, binds the code/refresh and signs an access JWT whose `aud` is precisely that URL and includes `client_id`; a different-resource token fails `/api/mcp`. If unsupported, do not enable MCP OAuth.
- [ ] With a disposable admin account, Supabase OAuth JWT includes `client_id`; OAuth token cannot use `/api/admin` or direct admin RLS, while the admin's normal website session still can
- [ ] Backend health returns `{"status":"ok"}` with `HEALTH_CHECK_DB=true`
- [ ] Signup/login works against production Supabase
- [ ] Password reset email arrives and links back to the frontend
- [ ] Admin account provisioned; `/admin` loads
- [ ] UptimeRobot monitor created
- [ ] `npm run lint && npm run typecheck && npm test` pass in CI
- [ ] `GROQ_MODEL` / `GROQ_MAX_OUTPUT_TOKENS` set if you deviate from the defaults
- [ ] `AI_RATE_LIMIT_MAX` reviewed for your traffic (every request costs upstream tokens)
- [ ] No secrets in Git: `git grep -nE "gsk_|SUPABASE_SERVICE_ROLE_KEY=|GROQ_API_KEY=.*[A-Za-z0-9]{8,}"`

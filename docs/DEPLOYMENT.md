# Deploying Lerno

Target stack (spec §17): **Render Static Site** (frontend), **Render Web Service**
(backend), **Supabase** (PostgreSQL + Auth), **UptimeRobot** (monitoring).
Goal: a €0 MVP on free tiers — with the operational caveats from the spec.

## 1. Supabase (database + auth)

1. Create a project at [supabase.com](https://supabase.com).
2. Apply the migrations **in order** (SQL editor or `psql`):
   - `database/migrations/0001_init.sql` — schema, indexes, profile trigger
   - `database/migrations/0002_rls.sql` — row-level security policies
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
  | `HEALTH_CHECK_DB`           | `true` (optional cheap `SELECT 1` probe)            |

  In production the backend **refuses to start** without Supabase credentials —
  development data mode is never used in production.

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

- [ ] Migrations applied, RLS enabled (`select relrowsecurity from pg_class` shows `t`)
- [ ] Backend health returns `{"status":"ok"}` with `HEALTH_CHECK_DB=true`
- [ ] Signup/login works against production Supabase
- [ ] Password reset email arrives and links back to the frontend
- [ ] Admin account provisioned; `/admin` loads
- [ ] UptimeRobot monitor created
- [ ] `npm run lint && npm run typecheck && npm test` pass in CI

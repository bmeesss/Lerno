# Lerno Product & Technical Specification

## 1. Product

Lerno is a free-first study platform for students.

Core promise:

- Learn
- Practice
- Quiz
- Review
- Create and share study sets

No daily study limits. No premium paywall for core learning features.

Primary audience:

- Dutch secondary-school students
- MBO students
- Later: broader student audience

Lerno must remain useful without AI. AI is an optional enhancement, never a requirement for the core product.

## 2. V1 goals

V1 must provide:

- Public landing page
- Account registration and login
- Guest learning for public sets
- Dashboard
- Subjects
- Study sets
- Create/edit/delete own study sets
- Flashcards
- Spaced repetition
- Practice mode
- Quiz mode
- Results and progress
- Favorites
- Public/private sharing controls
- Public study-set discovery
- Search
- Profile
- Admin moderation
- Report content
- Responsive mobile UI
- Dark mode
- Health endpoint for monitoring

Not V1:

- Chat
- Follower/social-feed system
- Large video hosting
- Complex achievements
- AI everywhere
- Paid subscriptions
- Advertising system

## 3. UX principles

- Learning is always the primary action.
- The interface must be calm and uncluttered.
- A student should understand the main screen without instructions.
- Core learning actions must require as few clicks as practical.
- Mobile must be a first-class experience, not a reduced desktop layout.
- No dark-pattern premium prompts.
- No artificial daily limits.

## 4. Visual direction

Brand:

- Name: Lerno
- Accent: green
- Background: near-black/dark neutral
- Cards/surfaces: dark gray
- Text: white/light gray
- Rounded but restrained components
- Modern student/productivity aesthetic

Use one consistent design system with CSS variables/tokens.

Avoid:

- Excessive gradients
- Excessive glassmorphism
- Neon overload
- Crowded dashboards
- Generic school-portal styling

## 5. Main navigation

Desktop:

- Dashboard
- My subjects
- My sets
- Discover
- Progress
- Favorites
- Settings

Mobile:

- Home
- Learn
- Sets
- Discover
- Profile

## 6. Main pages

### Landing

Sections:

- Hero
- Core features
- How it works
- Free-first promise
- Call to action

### Dashboard

Show:

- Greeting
- Continue learning
- Cards due for review
- Recent sets
- Subject progress
- Current streak
- Quick-start study action

### Subjects

Users can create and manage their own subjects.

### Subject detail

Show:

- Subject name
- User's sets
- Progress summary
- Create set button

### Study set detail

Show:

- Title
- Subject
- Level
- Description
- Author
- Card count
- Study button
- Practice button
- Quiz button
- Favorite button
- Share/report controls where applicable

### Flashcard study

Flow:

- Show question
- User reveals answer
- User marks answer as incorrect or correct
- Save progress
- Schedule next review
- Show next card

Keyboard controls should be supported on desktop where practical.

### Practice mode

Mix:

- Due cards
- Incorrect cards
- Difficult cards
- New cards

### Quiz mode

Support at minimum:

- Multiple choice
- True/false
- Short answer

Result screen:

- Score
- Accuracy
- Correct/incorrect questions
- Topics needing more practice
- Restart
- Continue practice

### Review page

Show all cards currently due, grouped by subject/set.

### Create/edit set

Fields:

- Title
- Subject
- Level
- Description
- Visibility
- Tags
- Cards

Card fields:

- Question
- Answer

Creation methods:

- Manual entry
- Paste/import text
- CSV import

### Discover

Search and filter public sets by:

- Subject
- Level
- Tags
- Search query

### Favorites

Saved public sets and optionally own sets.

### Progress

Show:

- Cards studied
- Quiz attempts
- Accuracy
- Study time
- Streak
- Subject progress
- Set progress

### Profile

Minimal profile information:

- Display name
- Avatar/initials
- Study statistics
- Public sets

### Settings

- Profile
- Theme
- Account
- Privacy
- Logout

### Admin

Admin-only area:

- Reports
- Users
- Public sets
- Moderation actions
- Basic system metrics

## 7. Study algorithm

V1 should use a simple deterministic spaced-repetition system rather than an opaque ML system.

Suggested review intervals:

- New: immediate learning queue
- Correct first time: 1 day
- Correct again: 3 days
- Correct again: 7 days
- Correct again: 14 days
- Correct again: 30 days
- Incorrect: return to current session and reduce interval

The implementation must keep interval calculation in a dedicated service so it can be replaced later without changing the rest of the application.

Each card's progress should store at minimum:

- repetition_count
- difficulty or ease value
- last_reviewed_at
- next_review_at
- correct_count
- incorrect_count

## 8. Guest mode

Guests may:

- Browse public study sets
- Start public flashcard sessions
- Take public quizzes

Guests may not:

- Persist personal progress across devices
- Create sets
- Publish sets
- Favorite content

After guest learning, explain that creating an account saves progress.

## 9. Authentication

Use Supabase Auth.

Frontend must never expose the Supabase service-role key.

Authentication supports at minimum:

- Email/password signup
- Login
- Logout
- Password reset

Backend must verify authenticated identity before protected operations.

## 10. Backend architecture

Use:

- Node.js
- TypeScript
- Express
- Zod or equivalent request validation
- PostgreSQL through Supabase

Backend responsibilities:

- Authentication/authorization checks
- Input validation
- Study-set CRUD
- Cards CRUD
- Study-session logic
- Spaced-repetition calculation
- Quiz generation/loading/submission
- Progress calculation
- Favorites
- Search/discovery
- Reports/moderation
- Rate limiting

Recommended route groups:

```
/api/health
/api/profile
/api/subjects
/api/sets
/api/sets/:id
/api/sets/:id/cards
/api/sets/:id/quiz
/api/study
/api/reviews
/api/progress
/api/favorites
/api/discover
/api/reports
/api/admin
```

Do not expose database credentials to the frontend.

## 11. Health endpoint

`GET /api/health`

Response example:

```json
{
  "status": "ok"
}
```

The endpoint may optionally perform a lightweight database check. Do not make it expensive.

## 12. Database

Use Supabase PostgreSQL. The database is external to the Git repository and external to Render's local filesystem.

Core tables:

### profiles

- id UUID PK, references auth.users
- display_name
- avatar_url nullable
- created_at
- updated_at

### subjects

- id UUID PK
- owner_id UUID
- name
- created_at
- updated_at

### study_sets

- id UUID PK
- owner_id UUID
- subject_id UUID nullable
- title
- description
- level
- visibility enum/string
- slug or public identifier
- created_at
- updated_at

### cards

- id UUID PK
- set_id UUID
- question
- answer
- position integer
- created_at
- updated_at

### card_progress

- id UUID PK
- user_id UUID
- card_id UUID
- repetition_count integer
- ease numeric nullable
- last_reviewed_at nullable
- next_review_at nullable
- correct_count integer
- incorrect_count integer
- created_at
- updated_at

Unique constraint: (user_id, card_id)

### quizzes

- id UUID PK
- set_id UUID
- title
- created_at
- updated_at

### quiz_questions

- id UUID PK
- quiz_id UUID
- prompt
- question_type
- correct_answer
- options JSON/JSONB nullable
- position integer

### quiz_attempts

- id UUID PK
- user_id UUID
- quiz_id UUID
- score integer
- total integer
- created_at

### study_sessions

- id UUID PK
- user_id UUID nullable for guest analytics only if implemented safely
- set_id UUID nullable
- started_at
- ended_at
- cards_seen integer

### favorites

- user_id UUID
- set_id UUID
- created_at
- primary/unique key on (user_id, set_id)

### reports

- id UUID PK
- reporter_id UUID
- target_type
- target_id
- reason
- details nullable
- status
- created_at
- resolved_at nullable
- resolved_by nullable

## 13. Row-level security

Supabase RLS must be enabled.

Rules:

- Users can read/update their own profile.
- Users can create/update/delete their own subjects.
- Users can create/update/delete their own study sets.
- Cards are writable by the owner of the parent set.
- Public study sets can be read by anyone.
- Private sets can only be read by their owner unless a future explicit share-token model is implemented.
- Users can only modify their own progress/favorites.
- Reports may be created by authenticated users and only managed by admins.

Do not bypass RLS casually. Service-role access belongs only in trusted backend/admin contexts.

## 14. API design

Use JSON.

Success example:

```json
{
  "data": { }
}
```

Error example:

```json
{
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "Invalid request"
  }
}
```

Use appropriate HTTP status codes. Validate request bodies, route parameters and query parameters. Do not return internal stack traces in production.

## 15. Security

Required from V1:

- Passwords handled by Supabase Auth
- No secrets in Git
- Environment variables for server secrets
- Request validation
- Rate limiting on auth-sensitive and write-heavy routes
- CORS restricted to the Lerno frontend origin in production
- Authorization checks on every protected resource
- RLS in Supabase
- Safe error responses
- Basic abuse protection on report/public-content endpoints
- No arbitrary file execution

## 16. Environment variables

Backend:

- NODE_ENV
- PORT
- SUPABASE_URL
- SUPABASE_ANON_KEY
- SUPABASE_SERVICE_ROLE_KEY (server only, only where truly required)
- FRONTEND_URL
- JWT/other secret only if an additional server-side session mechanism is actually used

Frontend:

- Public Supabase URL if needed
- Public Supabase anon key if needed
- API base URL

Never commit real values.

## 17. Hosting plan

- Frontend: Render Static Site
- Backend: Render Web Service
- Database/auth: Supabase
- Monitoring: UptimeRobot
- Git: Private GitHub repository

Render Free web services can spin down after 15 minutes without inbound traffic, so a lightweight health endpoint can be monitored by UptimeRobot. Do not make the health endpoint expensive.

Important operational note: free Render services are intended for testing/hobby projects and have usage limits. The initial goal is a €0 MVP, not a promise that Lerno can serve unlimited traffic at €0 forever.

## 18. Project structure

```
lerno/
├── frontend/
│   ├── src/
│   │   ├── components/
│   │   ├── pages/
│   │   ├── hooks/
│   │   ├── lib/
│   │   ├── services/
│   │   ├── styles/
│   │   └── types/
│   ├── public/
│   └── package.json
├── backend/
│   ├── src/
│   │   ├── routes/
│   │   ├── controllers/
│   │   ├── services/
│   │   ├── middleware/
│   │   ├── validators/
│   │   ├── lib/
│   │   └── types/
│   └── package.json
├── database/
│   └── migrations/
├── docs/
│   └── LERNO_SPEC.md
├── tests/
├── .github/
│   └── workflows/
├── .gitignore
├── README.md
└── package.json
```

## 19. Development phases

- Phase 0: repository and documentation
- Phase 1: frontend foundation
- Phase 2: backend foundation
- Phase 3: Supabase integration
- Phase 4: study sets
- Phase 5: learning
- Phase 6: quizzes
- Phase 7: discovery
- Phase 8: moderation
- Phase 9: quality
- Phase 10: deployment

## 20. Testing requirements

At minimum:

- API unit tests
- Validation tests
- Authorization tests
- Study algorithm tests
- Quiz scoring tests
- Database integration tests where practical
- Frontend component tests for key flows
- End-to-end smoke test for: signup/login → create set → add cards → study → submit result → progress visible

Every feature added by an agent should include or update tests where applicable.

## 21. Coding rules for Arena AI

- Read existing files before modifying them.
- Do not rewrite unrelated code.
- Prefer small, reviewable commits.
- Keep frontend/backend boundaries explicit.
- Keep business logic out of React components.
- Keep database queries out of route handlers where practical; use services/repositories.
- Use strict TypeScript.
- No any unless there is a documented reason.
- Do not add dependencies without a reason.
- Do not introduce paid APIs for core features.
- Do not add telemetry that is unnecessary for the MVP.
- Do not put secrets in source control.
- Run tests, type checking and linting before declaring a phase complete.
- If an existing implementation conflicts with this spec, document the conflict and fix the root cause rather than layering hacks.

## 22. Product north star

When a student opens Lerno, the answer to "What should I do now?" should be obvious.

The ideal flow is:

Open Lerno → see today's review → start a study session → learn difficult cards → take a short quiz → get clear feedback → progress is saved.

Lerno should feel like a study tool first, a content library second, and a social platform only much later.

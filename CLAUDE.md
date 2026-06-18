# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

TARAsense is a sensory-evaluation / consumer-testing platform for DOST Caraga (Philippines). The product domain is hedonic food product testing: MSMEs create studies, consumers/panelists score product samples on sensory attributes, and a statistics engine runs the appropriate hypothesis tests and produces analytics.

## Repository layout (multiple apps)

The repo root is the **primary app** — a Next.js 16 application that is self-contained and the only thing you usually need to run. Other directories are alternate/optional surfaces:

- `./` — **Next.js 16 (App Router) web app + API**. UI _and_ the live HTTP API live here under `src/app/api/*`.
- `api/` — NestJS API gateway (central auth/RBAC, Redis, S3/MinIO). Optional; only used when calls are deliberately routed to an external gateway. Excluded from the root `tsconfig`.
- `backend/` — Laravel (PHP) backend. Separate, not part of the Next.js build.
- `flutter/` — loose Dart API-client stubs for a mobile app that consumes `/api/mobile/v1/*`.

Default deployment is the **single Next.js app**: the FIC calendar and mobile endpoints run in-process. `NEXT_PUBLIC_API_URL` is only set when intentionally pointing the frontend at an external gateway; left empty, `buildApiUrl()` (`src/lib/api-config.ts`) uses same-origin `/api/*`.

## Commands (root Next.js app)

```bash
npm install                 # also runs prisma generate via postinstall
npm run db:sync             # prisma db push --accept-data-loss + generate (syncs schema to DB)
npm run dev                 # Next dev server (webpack) at http://localhost:3000
npm run dev:turbo           # dev with turbopack
npm run build               # prisma generate + next build
npm run lint                # eslint

npm test                    # == test:stats; compiles statistics.ts then runs node --test
```

There is **one** test suite and it covers only the statistics engine: `tests/statistics.test.mjs`. `npm run test:stats` first type-compiles `src/lib/services/statistics.ts` into `tests/dist/`, then runs the node test runner. To run it directly after a build: `node --test tests/statistics.test.mjs`.

### Database / seeding

Postgres + Prisma. Schema is `prisma/schema.prisma` (single source of truth; the project uses `db push`, not migrations).

```bash
npm run db:generate         # prisma generate
npm run db:push             # prisma db push
npm run db:seed:psgc        # seed Philippine Standard Geographic Code location tables
npm run db:build:psgc       # rebuild prisma/seed-data/psgc.json from source
npm run db:rebuild:psgc     # rebuild PSGC tables
npm run db:backfill:schedule-ends   # one-off backfill for Study.scheduleEnd
```

PSGC = the Philippine region→province→city→barangay hierarchy (`PsgcRegion`/`PsgcProvince`/`PsgcCity`/`PsgcBarangay` models, served by `src/app/api/locations/*`). It is large and seeded/rebuilt via the scripts above rather than carried in the main seed path.

## Architecture

### Auth & sessions (custom, not next-auth)

Despite the `next-auth` dependency, auth is a **custom cookie-based session system** in `src/lib/auth/`:

- `session.ts` is the entry point. `getCurrentSession()` verifies a signed token cookie (`session-token.ts`) and loads the user; `requireRole(roles)` redirects to `/login` or the role's dashboard. Use these in Server Components and Server Actions to gate access.
- **Roles**: there are 4 _app_ roles — `MSME | FIC | CONSUMER | ADMIN` (`src/lib/auth/roles.ts`), but the DB `UserRole` enum also contains legacy values. `parseRole()` maps `FIC_MANAGER → FIC` and `RESEARCHER → CONSUMER`. Always go through `parseRole`/`AppRole`, never assume the DB string equals the app role. Each role has a fixed dashboard via `ROLE_DASHBOARD_PATH`.
- **Guest sessions** (`getCurrentGuestSession`) are a separate cookie-based identity for walk-in/QR participants who take a test without an account.
- **Mobile auth is separate**: `/api/mobile/v1/*` routes use their own JWT signed with `MOBILE_TOKEN_SECRET` (not the web session cookie). `src/lib/mobile/` holds that logic.
- Google OAuth sign-in (`src/lib/auth/google-*`, `/api/auth/google/*`) sends an email confirmation magic link for brand-new users.

`src/lib/study-access.ts` (`canAccessStudyByRole`) centralizes per-study authorization (ADMIN all; MSME owns its studies; FIC sees studies tagged to its facility/region). Reuse it rather than re-deriving access rules.

### Data layer

- Prisma client is a singleton in `src/lib/db.ts` — import `{ prisma }` from `@/lib/db`; never `new PrismaClient()`.
- `@/*` path alias maps to `src/*`.

### Mutations: Server Actions

Write/mutation logic lives in **Server Actions** under `src/app/actions/*.ts` (each file starts with `"use server"`), e.g. `study-actions.ts`, `participant-actions.ts`, `response-actions.ts`. Inputs are validated with **Zod** schemas. Actions call `getCurrentSession()` for auth, mutate via `prisma`, and `revalidatePath()`/`redirect()`. New mutations should follow this pattern rather than adding ad-hoc API routes. HTTP routes under `src/app/api/*` exist mainly for the mobile app, cron jobs, OAuth callbacks, uploads, and location/FIC lookups.

### The statistics / analysis engine (domain core)

This is the most important and most carefully-built part of the codebase:

- `src/lib/services/statistics.ts` — pure-TS statistical engine. It auto-selects the test (paired/Student/Welch t, Wilcoxon, Mann-Whitney, one-way/RM ANOVA, Friedman, Kruskal-Wallis) based on study design, sample count, and assumption checks, and returns effect sizes, post-hoc comparisons (Tukey HSD / compact-letter display), and confidence intervals. Where exact reference distributions are intractable in pure TS, documented approximations are used. **This file is what the test suite guards — changes here must keep `npm test` green.**
- `analysis-engine.ts` orchestrates a full `StudyAnalysis`: pulls responses, runs `statistics.ts`, layers in `data-quality.ts`, `advanced-analytics.ts`, JAR (Just-About-Right) penalty analysis, and optional AI-generated recommendation text.
- `sampling-service.ts` — stratified sampling for participant recruitment; `fic-availability-service.ts` — FIC scheduling.

### AI integration (optional, env-gated)

`src/lib/ai/openai-compatible.ts` is a provider-agnostic client (OpenAI or OpenRouter, selected by env). It powers (a) AI recommendation text in study analysis and (b) the chatbot (`src/lib/chatbot/`, `/api/chat`). All AI is **off unless server-side keys are set** (`OPENAI_API_KEY` / `OPENROUTER_API_KEY`, `TARASENSE_AI_PROVIDER`, model overrides). Keys must stay server-side — never `NEXT_PUBLIC_*`.

### Cron / background jobs

`src/app/api/jobs/*` (e.g. `close-expired-studies`, `session-reminders`) are HTTP endpoints protected by the `CRON_SECRET` env var (min 32 chars) and **must be registered with an external scheduler** — they do not self-schedule. `close-expired-studies` flips studies to a closed status at their schedule end; studies can be reposted to re-open. See memory notes on study lifecycle.

### Dates & timezones

Study scheduling and FIC availability are timezone-sensitive (operating timezone is `Asia/Manila`, `REMINDER_TIMEZONE`). Use the helpers in `src/lib/date-time.ts` (`formatDateKeyInTimeZone`, `formatLocalDateKey`, `isValidDateKey`) and `study-schedule.ts` — do **not** do raw UTC date math, which has previously caused FIC availability off-by-one bugs.

## Conventions & gotchas

- React Compiler is enabled **in production builds only** (`next.config.ts`); dev runs without it.
- `db:sync` / `db:push` use `--accept-data-loss`. Be deliberate before running against a populated DB — there are SQL backups in the repo root for a reason.
- Rate limiting (`src/lib/rate-limit.ts`) is **in-memory**, correct only for single-instance deployments; for multi-instance, swap the Map for Redis keeping the `checkRateLimit` interface.
- Many root-level `*.md` files (FIC_CALENDAR_FIX, SOLUTION_STEPS, etc.) are historical fix notes, not current architecture docs.

## Deployment

Single Next.js app via PM2 + Nginx — see `DEPLOY_UBUNTU.md`, `ecosystem.config.cjs`, `start-prod.sh`. Full platform stack (Postgres + Redis + MinIO + NestJS API) via `deploy/docker-compose.platform.yml`.

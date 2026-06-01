# TARAsense Laravel API

This directory is the Laravel backend migration target for TARAsense.

## Runtime Ownership

- Next.js owns pages, dashboards, forms, charts, and frontend UI.
- Laravel owns API routes, auth, validation, roles, business workflows, reports, notifications, OpenAI logic, and queue jobs.
- PostgreSQL is the main application database.
- Redis is used for cache, queues, rate limiting, sessions, and locks.

## Database

The current source of truth is still `../prisma/schema.prisma`.

Laravel models explicitly map to Prisma/PostgreSQL tables, including case-sensitive tables such as `User`, `Study`, `StudyParticipant`, `DeviceToken`, and mapped tables such as `user_profiles` and `psgc_regions`.

Do not run Laravel's default `users`, `cache`, or `jobs` migrations against the TARAsense database. Queue/cache/session state should use Redis.

## Implemented API Surfaces

- `POST /api/v1/auth/login`
- `GET /api/v1/auth/me`
- `POST /api/v1/auth/logout`
- `GET|POST /api/v1/chat`
- `GET /api/v1/locations/*`
- `GET /api/v1/studies/{studyId}/analysis`
- `GET /api/v1/studies/{studyId}/reports/pdf` reserved until a PDF engine is wired
- `/api/mobile/v1/auth/*`
- `/api/mobile/v1/profile*`
- `/api/mobile/v1/locations`
- `/api/mobile/v1/consumer/*`
- `/api/mobile/v1/msme/*`
- `/api/mobile/v1/fic/*`

## Required Environment

Set these before running against a real database:

```env
APP_KEY=
APP_ENV=local
APP_DEBUG=true
APP_URL=https://tarasense.dostcaraga.ph

DB_CONNECTION=pgsql
DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:5432/tarasense

CACHE_STORE=redis
QUEUE_CONNECTION=redis
SESSION_DRIVER=redis
REDIS_HOST=127.0.0.1
REDIS_PORT=6379

SESSION_SECRET=32-plus-character-secret
MOBILE_TOKEN_SECRET=32-plus-character-secret

TARASENSE_CHATBOT_LIVE=0
OPENAI_API_KEY=
OPENAI_BASE_URL=https://api.openai.com/v1
OPENAI_CHAT_MODEL=gpt-4o-mini

FIREBASE_SERVICE_ACCOUNT_JSON=
```

## Verification

```bash
composer dump-autoload
php artisan route:list --path=api
php artisan test
```

## Remaining Parity Work

- Replace the reserved PDF endpoint with a real renderer such as Dompdf, Browsershot, or wkhtmltopdf.
- Wire Firebase HTTP v1 OAuth sending inside `SendPushNotificationJob`.
- Port the full TypeScript statistical analysis engine to Laravel or isolate it behind a service process.
- Replace remaining Next.js server actions with calls to this API.
- Add contract tests comparing Laravel responses with the current Next.js backend before production cutover.

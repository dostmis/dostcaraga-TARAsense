# TARAsense API (NestJS)

This service provides:
- NestJS API gateway/backend
- Central auth (`/api/auth/*`) with JWT access+refresh
- RBAC guard and role decorators
- Redis cache + BullMQ queue (`/api/jobs/*`)
- S3-compatible object storage (`/api/files/*`)
- Audit logs (`/api/audit/logs`)

## 1) Setup

```bash
cd api
cp .env.example .env
npm install
npx prisma generate --schema=./prisma/schema.prisma
npx prisma db push --schema=./prisma/schema.prisma
npm run dev
```

API default URL: `http://localhost:4000/api`

## 2) Key endpoints

### Auth
- `POST /api/auth/register`
- `POST /api/auth/login`
- `POST /api/auth/refresh`
- `POST /api/auth/logout` (Bearer required)
- `GET /api/auth/me` (Bearer required)
- `GET /api/auth/introspect` (Bearer required)
- `POST /api/auth/admin/register` (Admin only)

### Redis queue
- `POST /api/jobs` (ADMIN/MSME/FIC)
- `GET /api/jobs/:jobId` (ADMIN/MSME/FIC)

### S3 storage
- `POST /api/files/upload` multipart (`file`) (ADMIN/MSME/FIC)
- `POST /api/files/signed-upload` (ADMIN/MSME/FIC)
- `GET /api/files` (ADMIN sees all; others see own)
- `GET /api/files/:fileId/signed-download` (ADMIN/MSME/FIC)

### Audit
- `GET /api/audit/logs?limit=100` (ADMIN)

## 3) Docker stack

From project root:

```bash
docker compose -f deploy/docker-compose.platform.yml up -d --build
```

This starts:
- PostgreSQL
- Redis
- MinIO (S3-compatible)
- Nest API

## 4) Central auth integration notes

For your Next.js frontend, call this API for login/refresh and store access token in secure cookie/session middleware.
Use `/api/auth/introspect` to validate tokens server-side and map role-based page access.

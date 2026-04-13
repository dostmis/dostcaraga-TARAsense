# TARAsense Platform

This repository now contains:
- `./` -> Next.js web app (UI)
- `./api` -> NestJS API (central auth + RBAC, Redis cache/queue, S3-compatible files)

## Web App (Next.js)

```bash
npm install
npm run db:sync
npm run dev
```

Web URL: `http://localhost:3000`
FIC calendar endpoints run from the same Next.js app at `/api/fic-availability/*` by default.
You only need `NEXT_PUBLIC_API_URL` when intentionally routing calls to an external API gateway.

## API (NestJS)

```bash
cd api
cp .env.example .env
npm install
npx prisma generate --schema=./prisma/schema.prisma
npx prisma db push --schema=./prisma/schema.prisma
npm run dev
```

API URL: `http://localhost:4000/api`

See [api/README.md](./api/README.md) for endpoint docs.

## Docker Stack (Postgres + Redis + MinIO + API)

```bash
docker compose -f deploy/docker-compose.platform.yml up -d --build
```

## Ubuntu Deployment (Next.js app)

See [DEPLOY_UBUNTU.md](./DEPLOY_UBUNTU.md) for PM2 + Nginx deployment steps.

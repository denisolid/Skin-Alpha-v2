# SkinAlpha v2

SkinAlpha v2 is a pnpm monorepo for a market scanner platform. The backend ingests source data asynchronously, archives raw payloads, normalizes listings into internal market state, and runs opportunity evaluation from stored data only. The frontend is a functional Next.js shell for auth, dashboard, opportunities, watchlists, and account settings.

## Stack

- `pnpm` workspaces
- `apps/backend`: NestJS + TypeScript + Prisma + BullMQ
- `apps/web`: Next.js App Router + TypeScript
- PostgreSQL
- Redis

## Repository Layout

```text
.
|-- apps
|   |-- backend
|   |   |-- prisma
|   |   |-- src
|   |   |   |-- infrastructure
|   |   |   `-- modules
|   |   `-- test
|   `-- web
|       `-- app
|-- docker-compose.yml
|-- package.json
|-- pnpm-workspace.yaml
`-- README.md
```

## Architecture

- `source-adapters` owns external source integration. Adapters are isolated behind adapter descriptors, adapter implementations, queues, and normalization services so they can be replaced without changing scanner logic.
- `catalog` owns canonical item identity and deterministic source-to-canonical resolution.
- `market-state` owns append-only `MarketSnapshot` history, latest `MarketState`, freshness evaluation, source conflict analysis, and explicit historical fallback selection.
- `opportunities` owns scanner universe selection, internal-state opportunity evaluation, and feed shaping. It does not call source APIs directly.
- `watchlists` and `alerts` own user tracking, alert rules, notification persistence, dedupe, and cooldown behavior.
- `subscriptions` owns plan state and access-tier checks.
- `diagnostics` owns operational read APIs for source health, queue lag, rate-limit burn, freshness, reject reasons, and job history.

## Data Flow

1. A source adapter schedules ingestion work through BullMQ.
2. Every source response is archived into `RawPayloadArchive` before normalization.
3. Normalizers map source payloads into normalized listings and normalized market-state records.
4. The latest projection is stored in `MarketState`.
5. Append-only history is stored in `MarketSnapshot`.
6. The opportunity engine reads merged internal market state only. It never blocks on live source calls.
7. Stale fallback uses the last good stored snapshot when policy allows it, with an explicit confidence penalty.

## Local Development

### Prerequisites

- Node.js `20+`
- Corepack
- Docker Desktop or another working Docker engine

### Environment Files

PowerShell:

```powershell
Copy-Item .env.example .env
Copy-Item apps/backend/.env.example apps/backend/.env
Copy-Item apps/web/.env.example apps/web/.env.local
```

Notes:

- The root `.env.example` is only for local Docker infra.
- The backend reads `apps/backend/.env`.
- The frontend reads `apps/web/.env.local`.
- Local all-in-one development keeps `APP_RUNTIME=all`.

### Install Dependencies

```powershell
corepack pnpm install
```

If pnpm warns that build scripts were ignored, approve them once:

```powershell
corepack pnpm approve-builds
```

### Start PostgreSQL and Redis

```powershell
corepack pnpm docker:up
```

PostgreSQL and Redis are TCP services, not browser pages:

- PostgreSQL: `localhost:5432`
- Redis: `localhost:6379`

### Prisma Setup

```powershell
corepack pnpm db:generate
corepack pnpm db:migrate:dev --name init
```

### Start the Apps

```powershell
corepack pnpm dev
```

Or run them separately:

```powershell
corepack pnpm dev:backend
corepack pnpm dev:web
```

### Local URLs

- Web: `http://localhost:3000`
- API: `http://localhost:3001/api`
- Health: `http://localhost:3001/api/health`
- Healthz: `http://localhost:3001/healthz`

## Production Deployment

### Frontend on Vercel

- Root Directory: `apps/web`
- Install Command: `pnpm install --frozen-lockfile`
- Build Command: `pnpm build`
- Framework Preset: `Next.js`
- Required env vars:
  - `NEXT_PUBLIC_APP_NAME`
  - `NEXT_PUBLIC_API_BASE_URL`
  - `SESSION_COOKIE_NAME`

### Backend on Render

- Repo Root Directory: `.`
- Build Command: `corepack enable && pnpm install --frozen-lockfile && pnpm --filter @skinalpha/backend prisma:generate && pnpm --filter @skinalpha/backend build`
- Start Command: `pnpm --filter @skinalpha/backend start`
- Health Check Path: `/healthz`
- Runtime split:
  - API service: `APP_RUNTIME=web`
  - Worker service: `APP_RUNTIME=worker`
  - Local development: `APP_RUNTIME=all`
- Required backend env vars:
  - `DATABASE_URL`
  - `REDIS_URL` or `REDIS_HOST` plus `REDIS_PORT`
  - `FRONTEND_URL`
  - `AUTH_EXTERNAL_REDIRECT_URL`
  - `SESSION_COOKIE_NAME`
  - `SESSION_SECURE_COOKIE=true`
  - `SESSION_COOKIE_SAME_SITE=none`
- Optional for preview or multiple frontend origins:
  - `CORS_ALLOWED_ORIGINS`

The checked-in `render.yaml` defines a web service, a worker service, and a Redis-compatible Key Value instance for BullMQ.

## Common Commands

- `corepack pnpm dev`
- `corepack pnpm build`
- `corepack pnpm lint`
- `corepack pnpm test`
- `corepack pnpm docker:up`
- `corepack pnpm docker:down`
- `corepack pnpm db:generate`
- `corepack pnpm db:migrate:dev --name <migration-name>`

## Development Notes

- `RawPayloadArchive` and `MarketSnapshot` are append-only by design and are now protected against Prisma update/delete operations.
- The scanner and opportunity engine run on persisted normalized market state, not direct source API calls.
- Steam is treated as a conservative snapshot source with explicit stale fallback handling.
- Backup aggregators are reference-only inputs. They affect confidence, not primary market truth.

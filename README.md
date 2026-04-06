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

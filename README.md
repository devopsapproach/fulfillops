# FulfillOps

A fault-tolerant order-processing backend built with Node.js, TypeScript, Express, Prisma, and PostgreSQL 16.

- **API (`api/`)**: validates orders, enforces idempotency, reserves inventory atomically, and exposes health probes and Prometheus metrics.
- **Worker (`worker/`)**: polls a PostgreSQL job queue, retries with exponential backoff, and dead-letters poison jobs.
- **Shared (`prisma/`, `shared/`)**: schema, migrations, seed data, and structured JSON logging.

## Prerequisites

- Git
- Node.js 22.12+
- npm
- Docker and Docker Compose
- Python 3 (only for the public checker)

## Quick start

```bash
git clone https://github.com/devopsapproach/fulfillops.git
cd fulfillops
npm ci
cp .env.example .env        # PowerShell: Copy-Item .env.example .env
docker compose up -d db
npm run db:generate
npm run db:migrate:deploy
npm run db:seed
```

Run the API and the worker in two terminals:

```bash
npm run dev:api      # http://localhost:8080
npm run dev:worker
```

Check that it works:

```bash
curl http://localhost:8080/health/live    # {"status":"ok"}
curl http://localhost:8080/health/ready   # {"status":"ready"}
curl http://localhost:8080/metrics
```

## Configuration

Edit `.env` (never commit it, only `.env.example`).

| Variable | Default | Purpose |
|---|---|---|
| `POSTGRES_USER` / `POSTGRES_PASSWORD` / `POSTGRES_DB` | `fulfillops` / `CHANGE_ME` / `fulfillops_dev` | Dev database credentials |
| `POSTGRES_PORT` | `5432` | Host port for PostgreSQL |
| `DATABASE_URL` | | Connection used by the API, worker, and Prisma CLI |
| `TEST_DATABASE_URL` | | Connection to the isolated `fulfillops_test` database |
| `PORT` | `8080` | API port |
| `LOG_LEVEL` | `info` | Logger verbosity |
| `WORKER_POLL_INTERVAL_MS` | `500` | Queue polling interval |
| `WORKER_LEASE_MS` | `10000` | Job lease duration |
| `WORKER_MAX_ATTEMPTS` | `3` | Attempts before a job is dead-lettered |
| `WORKER_RETRY_BASE_MS` | `1000` | Base delay for exponential backoff |

Notes:
- Postgres reads its credentials only when its data volume is empty. After changing `.env`, run `docker compose down -v` to apply the new values (this deletes local data).
- Host tools connect through `localhost`. Containers connect through `db:5432`.
- If port 5432 is already used by a local Postgres, set `POSTGRES_PORT` to another value (for example `5433`) and use it in both URLs.

## Database workflow

```bash
# change prisma/schema.prisma, then:
npm run db:migrate:dev -- --name describe_your_change
npm run db:generate
```

After pulling changes from `main`:

```bash
npm ci && npm run db:generate && npm run db:migrate:deploy && npm run db:seed
```

Commit the whole `prisma/migrations/<timestamp>_<name>/` folder with your schema change.

## Tests and checks

```bash
npm run check             # typecheck, lint, format check, unit tests, build
npm run test:integration  # runs against fulfillops_test
```

Integration tests need the test database migrated first:

```bash
# Bash
DATABASE_URL="$TEST_DATABASE_URL" npm run db:migrate:deploy

# PowerShell
$env:DATABASE_URL = $env:TEST_DATABASE_URL
npm run db:migrate:deploy
Remove-Item Env:DATABASE_URL
```

The `fulfillops_test` role and database are created by `scripts/init-db.sql` the first time the Postgres volume is created.

Before opening a PR: `npm run format && npm run check && npm run test:integration`.

## Production build

```bash
npm run build
npm run start:api      # terminal 1
npm run start:worker   # terminal 2
```

## Teardown

```bash
docker compose down      # stop, keep data
docker compose down -v   # stop and delete all database data
```

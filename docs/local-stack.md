# Local container stack (T18 handoff)

Owner: Developer A (Jaimie). Consumers: Developer B (CI, Kubernetes, Argo CD).

## Services

| Service   | Image                      | Command                                               | Port | Ready when                      |
| --------- | -------------------------- | ----------------------------------------------------- | ---- | ------------------------------- |
| `db`      | `postgres:16.6-alpine`     | default                                               | 5432 | `pg_isready` succeeds           |
| `migrate` | `fulfillops-migrate:local` | `prisma migrate deploy && prisma db seed`, then exits | —    | exits with code 0               |
| `api`     | `fulfillops:local`         | `node dist/api/server.js`                             | 8080 | `GET /health/ready` returns 200 |
| `worker`  | `fulfillops:local`         | `node dist/worker/main.js`                            | —    | logs `worker_started`           |

Startup order: `db` (healthy) → `migrate` (completed) → `api` and `worker`.
The API and the worker use **one image** with two commands.

## Image

- Build: `docker build --target runtime -t fulfillops:<git-sha> .`
- Migration image: `docker build --target migrate -t fulfillops-migrate:<git-sha> .`
- Base: `node:22.12.0-bookworm-slim`, multi-stage, runs as user `node` (uid 1000).
- Contains only `package.json`, production `node_modules` and `dist/` (including the generated Prisma client in `dist/shared/generated`).
- Tag convention for CI and Kubernetes: the full Git commit SHA, never `latest`.

## Environment variables

| Variable                  | Used by              | Default (Compose)                                           |
| ------------------------- | -------------------- | ----------------------------------------------------------- |
| `DATABASE_URL`            | migrate, api, worker | `postgresql://fulfillops:<password>@db:5432/fulfillops_dev` |
| `PORT`                    | api                  | `8080`                                                      |
| `NODE_ENV`                | api, worker          | `production`                                                |
| `LOG_LEVEL`               | api, worker          | `info`                                                      |
| `WORKER_POLL_INTERVAL_MS` | worker               | `500`                                                       |
| `WORKER_LEASE_MS`         | worker               | `10000`                                                     |
| `WORKER_MAX_ATTEMPTS`     | worker               | `3`                                                         |
| `WORKER_RETRY_BASE_MS`    | worker               | `1000`                                                      |

Inside containers the database host is the service name `db`, not `localhost`.
Passwords come from `.env` (never committed); `.env.example` lists every variable.

## Migrations

Migrations and the catalog seed run **only** in the `migrate` job. The API and
worker never migrate. In Kubernetes this becomes a Job (or init container)
that must finish before the API and worker Deployments start.

## Shutdown

Both processes handle `SIGTERM`. Compose waits `stop_grace_period: 30s` before
`SIGKILL`; Kubernetes should use `terminationGracePeriodSeconds: 30`. The grace
period must stay above `WORKER_LEASE_MS` (10 s).

## Commands

```bash
cp .env.example .env               # then replace every CHANGE_ME
docker compose up -d --build       # build and start everything
docker compose ps                  # migrate: Exited (0); api: healthy; worker: Up
docker compose logs -f api worker  # follow logs
docker compose down                # stop; keeps the database volume
docker compose down -v             # stop and DELETE all data
```

## Troubleshooting

| Symptom                                | Cause and fix                                                                     |
| -------------------------------------- | --------------------------------------------------------------------------------- |
| `port is already allocated` on 8080    | `npm run dev:api` is still running. Stop it or set `PORT=8081` in `.env`.         |
| `migrate` exits non-zero               | `docker compose logs migrate`. Usually a wrong password in `.env`.                |
| Password changed but login still fails | PostgreSQL keeps the first password in the volume. Use the old one or `down -v`.  |
| `api` stays `unhealthy`                | `curl localhost:8080/health/ready`; 503 means the database or tables are missing. |

## Verification results

| Check                                                        | Status       | Evidence                                                            |
| ------------------------------------------------------------ | ------------ | ------------------------------------------------------------------- |
| Image builds; runs as uid 1000; Prisma client present        | Pass         | `uid=1000(node)`; client in `dist/shared/generated/prisma` (01, 02) |
| `migrate` exits 0 and seeds 3 products on a fresh volume     | Pass         | 2 migrations applied; "Created 3 products" (04)                     |
| `api` becomes healthy only after `migrate` completes         | Pass         | migrate `Exited (0)`; api `healthy` (03)                            |
| API and worker run from the same image                       | Pass         | both `fulfillops:local`, image ID `9309c1277952` (03)               |
| Order accepted (202) and reaches `completed`                 | Pass         | queued, then completed; KIT-100 stock 7 to 6 (05)                   |
| Containers recreated; same order still retrievable           | Pass         | same order ID still `completed` (06)                                |
| `docker compose stop` finishes in under 30 s, clean shutdown | Pass         | 1.18 s; SIGTERM handled by API and worker (07)                      |
| Public checker against the Compose stack                     | Pass (11/12) | only the metrics endpoint fails, owned by Developer C (08)          |

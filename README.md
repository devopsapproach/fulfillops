# FulfillOps

FulfillOps is an order-processing backend built with Node.js,
TypeScript, Express, and PostgreSQL.

The completed application will accept orders, reserve inventory atomically,
and process persisted jobs through a separate worker.

## Current foundation

The initial foundation provides:

- TypeScript configuration and build commands.
- An Express API with a liveness endpoint.
- A basic API test using Vitest and Supertest.
- ESLint, Prettier, Husky, and commitlint.
- A shared architecture agreement in `docs/ADR-001.md`.

Database-backed routes, migrations, worker processing, and Docker Compose
are delivered through subsequent feature tickets.

## Prerequisites

- Git.
- Node.js 22.12 or newer within Node.js 22.
- npm.
- WSL2 Ubuntu for Windows container and Kubernetes work.

Use the exact Node.js version recorded in `.nvmrc` when available.

Verify your tools:

```bash
git --version
node --version
npm --version
```

Run project commands from the repository root.

## Installation

Clone the repository and install the locked dependencies:

```bash
git clone https://github.com/devopsapproach/capstone.git
cd capstone
npm ci
```

The install runs the `prepare` script to initialize Husky hooks.

## Environment configuration

Create a local environment file:

```bash
cp .env.example .env
```

Update the placeholders for your local environment.

| Variable                  | Purpose                                    |
| ------------------------- | ------------------------------------------ |
| `NODE_ENV`                | Runtime mode                               |
| `PORT`                    | API port, default `8080`                   |
| `DATABASE_URL`            | Application database connection            |
| `TEST_DATABASE_URL`       | Separate isolated test database connection |
| `LOG_LEVEL`               | Logging verbosity                          |
| `WORKER_POLL_INTERVAL_MS` | Delay between checks for available work    |
| `WORKER_LEASE_MS`         | Duration of a job claim                    |
| `WORKER_MAX_ATTEMPTS`     | Maximum processing attempts                |
| `WORKER_RETRY_BASE_MS`    | Base retry delay                           |

The initial liveness API uses `PORT` and can run without PostgreSQL.
Database and worker settings are consumed when those components are added.

Keep real credentials in your local `.env`.
Commit only placeholder values in `.env.example`.

When running applications on the host, a local database connection may use
`localhost`. Inside Docker Compose, use the database service hostname.

## Start the API during development

```bash
npm run dev:api
```

The default address is `http://localhost:8080`.

In another terminal, verify liveness:

```bash
curl -i http://localhost:8080/health/live
```

Expected status:

```text
HTTP/1.1 200 OK
```

Expected body:

```json
{ "status": "ok" }
```

Stop the development process with `Ctrl+C`.

Liveness confirms that the API process is responding.
Database readiness will be implemented separately.

## Build and run compiled code

```bash
npm run build
npm run start:api
```

Stop an existing development server before starting the compiled API
on the same port.

## Run checks

Run all foundation checks:

```bash
npm run check
```

This executes type checking, linting, formatting verification,
unit tests, and the production build.

Individual commands:

| Command                | Purpose                  |
| ---------------------- | ------------------------ |
| `npm run typecheck`    | Check TypeScript types   |
| `npm run lint`         | Run ESLint               |
| `npm run format:check` | Verify formatting        |
| `npm run format`       | Apply formatting         |
| `npm test`             | Run unit tests           |
| `npm run build`        | Compile application code |

Before opening a pull request:

```bash
npm run format
npm run check
git diff
git status
```

Review formatting changes before committing.

## Branch and review workflow

Start feature work from an updated `main`:

```bash
git switch main
git pull --ff-only
git switch -c feat/your-feature
```

Keep commits focused and use Conventional Commits:

```text
feat(api): implement catalog endpoint
feat(worker): claim pending jobs
test(orders): verify idempotent replay
docs(setup): clarify local configuration
```

Push your branch and open a pull request:

```bash
git push -u origin feat/your-feature
```

Another developer reviews the change before merge.

See `docs/commit/COMMIT_CONVENTION.md` for commit-message conventions.

## Team ownership and handoffs

| Developer | Primary responsibility                      | First handoff                               |
| --------- | ------------------------------------------- | ------------------------------------------- |
| A         | API routes, validation, order acceptance    | API entry point and contract behavior       |
| B         | Schema, migrations, database access, worker | Agreed schema and generated database client |
| C         | Tooling, Compose, CI, integration harness   | Running database and reproducible checks    |

All developers review the architecture agreement before starting
features that depend on shared schema or interfaces.

Schema changes require coordination with the API and worker owners.
Shared command and configuration changes must be reflected in this README.

## Planned commands

The following commands are added by their implementation tickets:

| Command                        | Owner |
| ------------------------------ | ----- |
| `npm run dev:worker`           | B     |
| `npm run start:worker`         | B     |
| `npm run db:generate`          | B     |
| `npm run db:migrate:dev`       | B     |
| `npm run db:migrate:deploy`    | B     |
| `npm run db:seed`              | B     |
| `npm run db:reset:test`        | B     |
| `npm run test:integration`     | C     |
| `npm run test:concurrency`     | C     |
| `docker compose up -d --build` | C     |

Move these commands into the installation and testing instructions
when their implementations are available.

## Assessment tests

The supplied public checker creates orders and consumes inventory.

Once the application and isolated test database are implemented,
run final contract verification with:

```bash
python3 assessment/fulfillops_public_checker.py \
  --base-url http://localhost:8080 \
  --concurrency \
  --stress
```

This command assumes the supplied checker is stored in `assessment/`.

Use a fresh isolated test dataset. The final expected result is:

```text
15 passed / 0 failed / 0 skipped
```

Worker crash recovery, bounded retries, Kubernetes, and GitOps require
additional evidence beyond the public checker.

## Architecture

See `docs/ADR-001.md` for the agreed schema, states, transaction boundaries,
interfaces, configuration, and ownership.

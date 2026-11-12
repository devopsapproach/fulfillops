# FulfillOps

FulfillOps is an order-processing backend built with Node.js,
TypeScript, Express, and PostgreSQL.

The completed application will accept orders, reserve inventory atomically,
and process persisted jobs through a separate worker.

## Current foundation

The repository contains:

- TypeScript configuration, quality checks, and build commands.
- An Express API with a liveness endpoint.
- PostgreSQL 16 through Docker Compose.
- Prisma models and SQL migrations for products, orders, order items,
  jobs, and fulfillment receipts.
- A shared Prisma database client.
- A catalog seed script that preserves existing products.
- A database integration test for the nonnegative-stock constraint.
- A worker startup skeleton.
- GitHub Actions configuration and commit-message checks.

Order processing, worker recovery, and complete contract verification
remain part of subsequent implementation work.

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

Create `.env` if it does not already exist:

```bash
test -f .env || cp .env.example .env
```

Replace the placeholder credentials with your local values.

| Variable                  | Purpose                                                          |
| ------------------------- | ---------------------------------------------------------------- |
| `POSTGRES_USER`           | Development database administrator created during initialization |
| `POSTGRES_PASSWORD`       | Development database password                                    |
| `POSTGRES_DB`             | Development database name                                        |
| `POSTGRES_PORT`           | PostgreSQL port exposed on the host                              |
| `DATABASE_URL`            | Connection used by the application and Prisma migrations         |
| `TEST_DATABASE_URL`       | Connection to the isolated test database                         |
| `PORT`                    | API listening port                                               |
| `NODE_ENV`                | Runtime mode                                                     |
| `LOG_LEVEL`               | Logging verbosity                                                |
| `WORKER_POLL_INTERVAL_MS` | Planned worker polling interval                                  |
| `WORKER_LEASE_MS`         | Planned job lease duration                                       |
| `WORKER_MAX_ATTEMPTS`     | Planned default attempt limit                                    |
| `WORKER_RETRY_BASE_MS`    | Planned retry backoff base                                       |

The username, password, database, and port in `DATABASE_URL` must match
the development database configuration.

Use URL-encoded passwords in connection URLs when they contain special
characters.

Compose initializes database credentials only when its data directory is
empty. Editing `.env` does not change an existing database user's password.

Keep real credentials in `.env` and commit only `.env.example`.

Applications running on the host connect through `localhost`.
Applications inside Compose use the database service hostname `db`.

Values in `.env` are loaded by the application through dotenv.
They do not automatically become Bash variables.

## Database setup

Start PostgreSQL:

```bash
docker compose up -d db
docker compose ps db
```

Generate the Prisma client, apply committed migrations, and seed the catalog:

```bash
npm run db:generate
npm run db:migrate:deploy
npm run db:seed
```

The initial catalog contains:

| SKU      | Unit price in cents | Initial stock |
| -------- | ------------------: | ------------: |
| KIT-100  |                1299 |             7 |
| PART-200 |                 599 |            12 |
| PACK-300 |                 249 |             5 |

Seeding inserts missing products. Existing prices and stock remain unchanged,
including stock already consumed by orders.

Inspect the catalog:

```bash
docker compose exec db psql -U fulfillops -d fulfillops_dev \
  -c "SELECT sku, unit_price_cents, available FROM products ORDER BY sku;"
```

These inspection commands assume the default development username and
database name.

Stop the stack while preserving its database volume:

```bash
docker compose down
```

## Schema changes

Edit `prisma/schema.prisma`, then generate a draft migration:

```bash
npx prisma format
npx prisma validate
npm run db:migrate:dev -- --name describe_your_change --create-only
```

Review the generated SQL and add required custom constraints or indexes
before applying the new migration.

```bash
npm run db:migrate:dev
npm run db:generate
```

Commit the schema and migration files, including `migration_lock.toml`.

Once a migration has been applied and shared, preserve it and create a new
migration for later changes. Generated Prisma client files are recreated
locally and during builds.

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

## Database integration tests

Integration tests use the separate `fulfillops_test` database.

On first initialization, `scripts/init-db.sql` creates the test user and
database. Its current password is a development placeholder. Set your
chosen password before configuring the test connection.

Open PostgreSQL:

```bash
docker compose exec db psql -U fulfillops -d fulfillops_dev
```

Inspect existing users and databases:

```text
\du
\l
```

If the test role exists, set its password:

```text
\password fulfillops_test
```

If the role or database is missing, create only the missing item:

```sql
CREATE ROLE fulfillops_test LOGIN;
CREATE DATABASE fulfillops_test OWNER fulfillops_test;
```

Then set the test password with `\password fulfillops_test` and exit
using `\q`.

Update `TEST_DATABASE_URL` in `.env` with the matching password.

For the migration command, export the same connection in your terminal:

```bash
export TEST_DATABASE_URL='postgresql://fulfillops_test:YOUR_TEST_PASSWORD@localhost:5432/fulfillops_test'
```

Apply migrations and run the integration suite:

```bash
DATABASE_URL="$TEST_DATABASE_URL" npm run db:migrate:deploy
npm run test:integration
```

The inline `DATABASE_URL` override targets the test database for that
migration command.

The integration test uses `TEST_DATABASE_URL` directly. An exported
environment variable takes precedence over its value in `.env`, so keep
them consistent.

The initial test verifies that PostgreSQL rejects negative stock and
rolls back its temporary test data. It requires migrations but does not
require catalog seeding.

`npm run check` runs the foundation checks and unit tests.
Run `npm run test:integration` separately for database verification.

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
| Jaimie    | API routes, validation, order acceptance    | API entry point and contract behavior       |
| Iulian    | Schema, migrations, database access, worker | Agreed schema and generated database client |
| Sultan    | Tooling, Compose, CI, integration harness   | Running database and reproducible checks    |

All developers review the architecture agreement before starting
features that depend on shared schema or interfaces.

Schema changes require coordination with the API and worker owners.
Shared command and configuration changes must be reflected in this README.

## Planned commands

## Database commands and handoff

| Command                     | Purpose                                 |
| --------------------------- | --------------------------------------- |
| `npm run db:generate`       | Generate the Prisma client              |
| `npm run db:migrate:dev`    | Create and apply development migrations |
| `npm run db:migrate:deploy` | Apply committed migrations              |
| `npm run db:seed`           | Insert missing catalog products         |
| `npm run test:integration`  | Run database integration tests          |
| `npm run dev:worker`        | Start the current worker skeleton       |

After pulling database changes, teammates should run:

1. `npm ci`
2. `npm run db:generate`
3. `npm run db:migrate:deploy`
4. `npm run db:seed`

API and worker code import the shared `database` client from
`shared/database.ts`, using the appropriate relative path.

The guarded test-reset command and concurrency test suite remain planned.

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

## Start the worker

Complete database setup before starting the worker.

For development, run these commands in separate terminals:

```bash
# Terminal 1
npm run dev:api
```

```bash
# Terminal 2
npm run dev:worker
```

For compiled execution:

```bash
npm run db:generate
npm run build
```

Then use separate terminals:

```bash
npm run start:api
```

```bash
npm run start:worker
```

The API and worker must connect to the same application database.

Starting the worker does not start the HTTP API.

Stop each process with Ctrl+C. The worker allows a bounded shutdown
period for in-flight work.

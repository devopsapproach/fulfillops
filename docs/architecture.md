# FulfillOps architecture

FulfillOps accepts customer orders through an HTTP API, reserves inventory,
and processes accepted orders through a separate background worker.

This document describes the intended architecture. Implementation and
verification progress are recorded in the project tickets and PRs.

The architectural decision is recorded in [ADR-001](ADR-001.md).
The data model is specified in [database-schema.md](database-schema.md).

## Scope

Deliver a local API, separate worker, and PostgreSQL database.
Demonstrate safe order acceptance and asynchronous completion.

## Stack

Node.js, TypeScript, Express, PostgreSQL, Prisma,
Zod, Vitest, Supertest, Docker Compose.

## Invariants

- Stock is never negative.
- One idempotency key identifies at most one accepted order.
- Order, reservation, and job are committed together.
- An order has at most one fulfillment receipt.
- Accepted orders and idempotency mappings survive restarts.

## Transaction boundaries

Order acceptance commits the order, item records, inventory reservation,
and job together.

Workers claim eligible jobs in short transactions.
Each claim increments attempts and establishes a fresh token and lease.

Completion verifies current ownership, inserts the unique receipt, and
updates the job and order together.

Retry and final-failure updates also verify ownership and update the order
and job together.

Expired claims are recovered only after their state and lease are
rechecked under a lock.

Failed orders retain their reserved stock for operator reconciliation.

## Idempotency and concurrency

An idempotency key identifies at most one accepted order.

The API compares canonical request payloads when handling a repeated key.
Canonicalization preserves the customer identifier, aggregates duplicate
SKU lines, and sorts items by SKU.

Matching replays return the original order ID and queued acceptance receipt.
Different payloads using the same key produce an idempotency conflict.

Product rows are locked in deterministic SKU order to reduce deadlock risk.
Transient transaction retries must be bounded.

## Shared database interface

shared/database.ts exports one Prisma client per application process,
named database.

Both API and worker code use this shared configuration.
Each process disconnects its client during shutdown.

The seed script uses the same client and closes it when execution ends.

## Configuration

DATABASE_URL selects the application or migration database.

TEST_DATABASE_URL selects the isolated integration-test database.

POSTGRES_USER, POSTGRES_PASSWORD, POSTGRES_DB, and POSTGRES_PORT configure
the local Compose database.

Worker lease, polling, and retry settings are environment-configurable.
Each job stores its own maximum attempt budget.

Real credentials stay outside Git.

## Ownership and handoffs

- Jaimie owns API validation, routes, and order acceptance.
- Iulian owns schema, migrations, database access, and worker processing.
- Sultan owns tooling, Compose, CI, and integration infrastructure.

The database handoff includes migrations, generated-client instructions,
seed commands, integration tests, and documented configuration.

All developers review changes to shared interfaces and transaction rules.

## Deployment

Docker Compose provides the local execution environment.

The final deployment uses Kubernetes with persistent database storage.
Argo CD reconciles deployment configuration from Git.

CI validates changes and release artifacts before promotion.

The single PostgreSQL instance remains a shared availability dependency.

## API Responsability

| API responsibility                          | How it is done                                                                                                                      |
| ------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| Reserve inventory during acceptance         | Conditional `UPDATE products ... WHERE available >= quantity`, one SKU at a time in sorted order, inside the acceptance transaction |
| Save the order with `status = queued`       | `INSERT INTO orders` claims the idempotency key (`ON CONFLICT DO NOTHING`); the status defaults to `queued`                         |
| Save captured item prices and `total_cents` | Prices are read from `products` and copied into `order_items.unit_price_cents`; `total_cents` is their sum                          |
| Insert one `pending` job                    | One `jobs` row per order (`order_id` is unique), created in the same transaction                                                    |
| Set the job's retry budget                  | `max_attempts` is set to `JOB_MAX_ATTEMPTS` (3) when the job is inserted                                                            |

All five steps commit together or roll back together, so an order never exists without its reservation and its job.

## Worker responsibilities

The worker processes persisted jobs independently of the HTTP API.

The API must first commit the queued order, order items, inventory
reservation, and pending job in one transaction.

The worker preserves the accepted order total and inventory reservation.

### Claim

In a short transaction, the worker selects one pending job whose
next_attempt_at has arrived and whose attempts are below max_attempts.

FOR UPDATE SKIP LOCKED prevents competing workers from claiming the
same selected row during the transaction.

The worker assigns a fresh claim token, establishes a lease, increments
attempts, and changes the order from queued to processing.

Processing starts after the claim transaction commits.

### Process and complete

The current fulfillment operation verifies that the persisted order has
items and that their calculated total matches the accepted order total.

Completion uses another short transaction:

1. Lock the persisted job.
2. Obtain current database time after acquiring the lock.
3. Verify claimed state, matching claim token, and an unexpired lease.
4. Insert the unique fulfillment receipt.
5. Mark the processing order and claimed job completed.
6. Clear the claim token and lease.

Receipt creation and both state changes commit together.
The receipt and completion updates use the same completion timestamp.

An invalid claim returns false without completing the order.
Database errors propagate to the worker loop.

### Retry and final failure

A fulfillment failure is recorded only while the worker still owns a
valid claim.

When attempts remain, the job returns to pending with a future
next_attempt_at, and the order returns to queued.

Retry delays grow exponentially from WORKER_RETRY_BASE_MS and are
capped at 30 seconds.

When attempts are exhausted, the job becomes dead_letter and the order
becomes failed. Terminal timestamps are set and ownership fields are
cleared.

Neither retry scheduling nor final failure changes reserved inventory.

### Expired-lease recovery

The worker also searches for expired claimed jobs.

It locks one candidate using FOR UPDATE SKIP LOCKED, rechecks its
expiry, and either schedules another attempt or records final failure.
The recorded error code is LEASE_EXPIRED.

Recovery does not increment attempts. A subsequent successful claim does.

### Ownership and failure boundaries

Row locks protect short database transactions.
Claim tokens identify individual claims.
Leases allow abandoned claims to be recovered.

A worker holding an old token cannot complete or fail a replacement
worker's claim.

Fulfillment failures trigger retry handling. Database completion errors
do not immediately trigger business failure because the commit outcome
may be unknown.

There is no lease renewal in the current implementation.
Normal processing must fit within the configured lease.

### Worker lifecycle

The worker awaits each polling iteration, preventing overlapping polls
within one process.

SIGINT and SIGTERM request shutdown. The worker stops starting new
claims when it observes the shutdown flag, allows in-flight work to
finish, and disconnects the database.

A ten-second shutdown deadline forces an unsuccessful exit if shutdown
cannot finish. An abandoned claim can subsequently expire and recover.

The unique receipt protects database completion. It does not guarantee
exactly-once execution of external shipping or payment operations.

## Architecture

- [Architecture overview](docs/architecture.md)
- [Database schema](docs/database-schema.md)
- [ADR-001 — API-and-worker architecture](docs/ADR-001.md)

## Related documents

- [Database schema](database-schema.md)
- [Architectural decision](ADR-001.md)
- [Worker implementation walkthrough](worker-implementation.md)

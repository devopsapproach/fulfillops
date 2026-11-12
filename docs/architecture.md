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

<!-- Jaimie will define this -->

## Worker Responsability

- Preserve the existing reservation
- Move it through processing to completion or failure
- Preserve the accepted total
- Claim and process that job
- Respect the persisted max_attempts

## Architecture

- [Architecture overview](docs/architecture.md)
- [Database schema](docs/database-schema.md)
- [ADR-001 — API-and-worker architecture](docs/ADR-001.md)

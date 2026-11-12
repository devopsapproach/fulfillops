# FulfillOps database schema

PostgreSQL stores products, orders, order items, durable jobs, and
fulfillment receipts.

Prisma model definitions are maintained in
[prisma/schema.prisma](../prisma/schema.prisma).

Database checks and partial indexes are maintained in
[prisma/migrations](../prisma/migrations/).

See [architecture.md](architecture.md) for the application transaction
boundaries.

## Model and table mapping

Products, orders, order items, jobs, fulfillment receipts.

The Prisma schema defines application-facing model and field names.
SQL table and column names use explicit mappings.

| Prisma model       | SQL table            | Main guarantees                                              |
| ------------------ | -------------------- | ------------------------------------------------------------ |
| Product            | products             | Unique SKU, nonnegative stock and price                      |
| Order              | orders               | Unique idempotency key, nonnegative total                    |
| OrderItem          | order_items          | Unique order/SKU pair, positive quantity                     |
| Job                | jobs                 | One job per order, bounded attempts, consistent claim fields |
| FulfillmentReceipt | fulfillment_receipts | One completion receipt per order                             |

Money is stored as integer cents.
Timestamps use PostgreSQL TIMESTAMPTZ.
Foreign keys use restricted deletion and updates.

Order items capture the unit price at acceptance.
Repeated SKU lines are aggregated before their item records are created.

## Primary keys and uniqueness

- products uses sku as its primary key.
- orders uses id as its primary key and a unique idempotency_key.
- order_items uses the composite primary key (order_id, sku).
- jobs uses id as its primary key and a unique order_id.
- fulfillment_receipts uses order_id as its primary key.

## Relationships

- order_items.order_id references orders.id.
- order_items.sku references products.sku.
- jobs.order_id references orders.id.
- fulfillment_receipts.order_id references orders.id.

All foreign keys use ON DELETE RESTRICT and ON UPDATE RESTRICT.

## Database constraints and indexes

Custom migration SQL enforces:

- Nonnegative inventory and monetary values.
- Positive item quantities.
- Positive maximum attempts and bounded attempt counts.
- Claim token and lease presence exactly while a job is claimed.
- Terminal timestamps consistent with order and job states.

Partial indexes support pending-job scheduling and expired-lease lookup.

Database constraints protect individual records.
Cross-table state consistency is enforced by application transactions.

## Order states

The public order states are:

- queued
- processing
- completed
- failed

## Job states

The internal job states are:

- pending
- claimed
- completed
- dead_letter

| Event                                  | Job transition         | Order transition        |
| -------------------------------------- | ---------------------- | ----------------------- |
| Acceptance                             | New to pending         | New to queued           |
| Claim                                  | pending to claimed     | queued to processing    |
| Success                                | claimed to completed   | processing to completed |
| Retry scheduled                        | claimed to pending     | processing to queued    |
| Lease recovery with attempts remaining | claimed to pending     | processing to queued    |
| Attempts exhausted                     | claimed to dead_letter | processing to failed    |

These transitions define the intended worker behavior.
The worker startup skeleton does not yet implement all transitions.

## Timestamp ownership

created_at is initialized when a record is inserted.

Application updates explicitly refresh updated_at, including raw SQL writes.

Claiming establishes lease_expires_at.
Leaving the claimed state clears claim_token and lease_expires_at.

Terminal timestamps are set in the corresponding completion or failure
transaction.

## Migrations and seeding

Prisma models and SQL migrations are committed to Git.

Custom SQL constraints and partial indexes are added to draft migrations
before their first application.

Applied and shared migrations are preserved.
Subsequent changes receive new migrations.

Seeding inserts missing catalog products and preserves existing stock
and prices. Test-data reset is a separate guarded operation.
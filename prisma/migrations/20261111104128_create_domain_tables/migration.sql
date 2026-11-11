-- CreateEnum
CREATE TYPE "order_status" AS ENUM ('queued', 'processing', 'completed', 'failed');

-- CreateEnum
CREATE TYPE "job_state" AS ENUM ('pending', 'claimed', 'completed', 'dead_letter');

-- CreateTable
CREATE TABLE "products" (
    "sku" TEXT NOT NULL,
    "unit_price_cents" INTEGER NOT NULL,
    "available" INTEGER NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "products_pkey" PRIMARY KEY ("sku")
);

-- CreateTable
CREATE TABLE "orders" (
    "id" UUID NOT NULL,
    "idempotency_key" VARCHAR(128) NOT NULL,
    "canonical_payload" JSONB NOT NULL,
    "customer_id" VARCHAR(64) NOT NULL,
    "status" "order_status" NOT NULL DEFAULT 'queued',
    "total_cents" INTEGER NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completed_at" TIMESTAMPTZ(6),
    "failed_at" TIMESTAMPTZ(6),

    CONSTRAINT "orders_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "order_items" (
    "order_id" UUID NOT NULL,
    "sku" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL,
    "unit_price_cents" INTEGER NOT NULL,

    CONSTRAINT "order_items_pkey" PRIMARY KEY ("order_id","sku")
);

-- CreateTable
CREATE TABLE "jobs" (
    "id" UUID NOT NULL,
    "order_id" UUID NOT NULL,
    "state" "job_state" NOT NULL DEFAULT 'pending',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "max_attempts" INTEGER NOT NULL DEFAULT 3,
    "next_attempt_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "claim_token" UUID,
    "lease_expires_at" TIMESTAMPTZ(6),
    "last_error" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completed_at" TIMESTAMPTZ(6),
    "dead_lettered_at" TIMESTAMPTZ(6),

    CONSTRAINT "jobs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "fulfillment_receipts" (
    "order_id" UUID NOT NULL,
    "completed_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "fulfillment_receipts_pkey" PRIMARY KEY ("order_id")
);

-- CreateIndex
CREATE UNIQUE INDEX "orders_idempotency_key_key" ON "orders"("idempotency_key");

-- CreateIndex
CREATE INDEX "order_items_sku_idx" ON "order_items"("sku");

-- CreateIndex
CREATE UNIQUE INDEX "jobs_order_id_key" ON "jobs"("order_id");

-- AddForeignKey
ALTER TABLE "order_items" ADD CONSTRAINT "order_items_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "order_items" ADD CONSTRAINT "order_items_sku_fkey" FOREIGN KEY ("sku") REFERENCES "products"("sku") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "jobs" ADD CONSTRAINT "jobs_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "fulfillment_receipts" ADD CONSTRAINT "fulfillment_receipts_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- Inventory and monetary values must remain nonnegative.

-- Find pending work in scheduled order.

CREATE INDEX "jobs_pending_due_idx"
ON "jobs" ("next_attempt_at", "id")
WHERE "state" = 'pending';


-- Find claimed jobs whose leases may have expired.

CREATE INDEX "jobs_claimed_expiry_idx"
ON "jobs" ("lease_expires_at", "id")
WHERE "state" = 'claimed';

ALTER TABLE "products"
ADD CONSTRAINT "products_available_nonnegative"
CHECK ("available" >= 0);

ALTER TABLE "products"
ADD CONSTRAINT "products_price_nonnegative"
CHECK ("unit_price_cents" >= 0);

ALTER TABLE "orders"
ADD CONSTRAINT "orders_total_nonnegative"
CHECK ("total_cents" >= 0);

ALTER TABLE "order_items"
ADD CONSTRAINT "order_items_quantity_positive"
CHECK ("quantity" > 0);

ALTER TABLE "order_items"
ADD CONSTRAINT "order_items_price_nonnegative"
CHECK ("unit_price_cents" >= 0);


-- Every job has a positive retry budget and a bounded attempt count.

ALTER TABLE "jobs"
ADD CONSTRAINT "jobs_attempt_limits_valid"
CHECK (
    "max_attempts" > 0
    AND "attempts" >= 0
    AND "attempts" <= "max_attempts"
);


-- Claim ownership exists exactly while a job is claimed.

ALTER TABLE "jobs"
ADD CONSTRAINT "jobs_claim_fields_consistent"
CHECK (
    (
        "state" = 'claimed'
        AND "claim_token" IS NOT NULL
        AND "lease_expires_at" IS NOT NULL
    )
    OR
    (
        "state" <> 'claimed'
        AND "claim_token" IS NULL
        AND "lease_expires_at" IS NULL
    )
);


-- Terminal timestamps agree with the order state.

ALTER TABLE "orders"
ADD CONSTRAINT "orders_terminal_timestamps_consistent"
CHECK (
    ("status" = 'completed') = ("completed_at" IS NOT NULL)
    AND
    ("status" = 'failed') = ("failed_at" IS NOT NULL)
);


-- Terminal timestamps agree with the job state.

ALTER TABLE "jobs"
ADD CONSTRAINT "jobs_terminal_timestamps_consistent"
CHECK (
    ("state" = 'completed') = ("completed_at" IS NOT NULL)
    AND
    ("state" = 'dead_letter') = ("dead_lettered_at" IS NOT NULL)
);
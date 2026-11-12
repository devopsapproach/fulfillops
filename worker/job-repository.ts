import { randomUUID } from "node:crypto";
import type { PrismaClient } from "../shared/generated/prisma/client.js";

export interface ClaimedJob {
  id: string;
  orderId: string;
  claimToken: string;
  attempts: number;
  maxAttempts: number;

  completeJob(database: PrismaClient, job: ClaimedJob): Promise<boolean>;
}

export async function claimNextJob(
  database: PrismaClient,
  leaseMs: number,
): Promise<ClaimedJob | null> {
  return database.$transaction(async (transaction) => {
    const candidates = await transaction.$queryRaw<
      { id: string; order_id: string }[]
    >`
      SELECT id, order_id
      FROM jobs
      WHERE state = 'pending'
        AND next_attempt_at <= clock_timestamp()
        AND attempts < max_attempts
      ORDER BY next_attempt_at, id
      FOR UPDATE SKIP LOCKED
      LIMIT 1
    `;

    const candidate = candidates[0];

    if (!candidate) {
      return null;
    }

    const claimToken = randomUUID();

    const claimed = await transaction.$queryRaw<ClaimedJob[]>`
      UPDATE jobs
      SET state = 'claimed',
          claim_token = ${claimToken}::uuid,
          lease_expires_at =
            clock_timestamp() + ${leaseMs}::double precision
            * INTERVAL '1 millisecond',
          attempts = attempts + 1,
          updated_at = clock_timestamp()
      WHERE id = ${candidate.id}::uuid
      RETURNING
        id,
        order_id AS "orderId",
        claim_token AS "claimToken",
        attempts,
        max_attempts AS "maxAttempts"
    `;

    const updatedOrders = await transaction.order.updateMany({
      where: {
        id: candidate.order_id,
        status: "queued",
      },
      data: {
        status: "processing",
        updatedAt: new Date(),
      },
    });

    if (updatedOrders.count !== 1) {
      throw new Error("Job and order states are inconsistent");
    }

    return claimed[0]!;
  });
}

// fulfillment_receipts -> jobs -> order_items -> orders -> products

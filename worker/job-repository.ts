import { randomUUID } from "node:crypto";
import { logger } from "../shared/logger.js";

import type {
  Prisma,
  PrismaClient,
} from "../shared/generated/prisma/client.js";

interface LockedJob {
  id: string;
  orderId: string;
  attempts: number;
  maxAttempts: number;
}

export interface ClaimedJob {
  id: string;
  orderId: string;
  claimToken: string;
  attempts: number;
  maxAttempts: number;
}

interface ClaimedJobRow extends ClaimedJob {
  updatedAt: Date;
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

    const claimed = await transaction.$queryRaw<ClaimedJobRow[]>`
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
        max_attempts AS "maxAttempts",
        updated_at AS "updatedAt"
    `;

    const claimedRow = claimed[0]!;

    const updatedOrders = await transaction.order.updateMany({
      where: {
        id: candidate.order_id,
        status: "queued",
      },
      data: {
        status: "processing",
        updatedAt: claimedRow.updatedAt,
      },
    });

    if (updatedOrders.count !== 1) {
      throw new Error("Job and order states are inconsistent");
    }

    return {
      id: claimedRow.id,
      orderId: claimedRow.orderId,
      claimToken: claimedRow.claimToken,
      attempts: claimedRow.attempts,
      maxAttempts: claimedRow.maxAttempts,
    };
  });
}

export async function completeJob(
  database: PrismaClient,
  job: ClaimedJob,
): Promise<boolean> {
  return database.$transaction(async (transaction) => {
    // Lock the persisted job before checking ownership.
    const lockedJobs = await transaction.$queryRaw<{ id: string }[]>`
      SELECT id
      FROM jobs
      WHERE id = ${job.id}::uuid
      FOR UPDATE
    `;

    if (lockedJobs.length === 0) {
      return false;
    }

    // Get current database time after acquiring the lock.
    const timestamps = await transaction.$queryRaw<{ completedAt: Date }[]>`
      SELECT clock_timestamp() AS "completedAt"
    `;

    const completedAt = timestamps[0]!.completedAt;

    // Check the claim against the actual database record.
    const ownedJobs = await transaction.$queryRaw<{ orderId: string }[]>`
      SELECT order_id AS "orderId"
      FROM jobs
      WHERE id = ${job.id}::uuid
        AND state = 'claimed'
        AND claim_token = ${job.claimToken}::uuid
        AND lease_expires_at > ${completedAt}
    `;

    const ownedJob = ownedJobs[0];

    if (!ownedJob) {
      return false;
    }

    await transaction.fulfillmentReceipt.create({
      data: {
        orderId: ownedJob.orderId,
        completedAt,
      },
    });

    const updatedOrders = await transaction.order.updateMany({
      where: {
        id: ownedJob.orderId,
        status: "processing",
      },
      data: {
        status: "completed",
        completedAt,
        updatedAt: completedAt,
      },
    });

    if (updatedOrders.count !== 1) {
      throw new Error("Cannot complete an order that is not processing");
    }

    await transaction.job.update({
      where: {
        id: job.id,
      },
      data: {
        state: "completed",
        completedAt,
        claimToken: null,
        leaseExpiresAt: null,
        updatedAt: completedAt,
      },
    });

    return true;
  });
}

async function rescheduleOrFail(
  transaction: Prisma.TransactionClient,
  job: LockedJob,
  timestamp: Date,
  retryBaseMs: number,
  errorCode: "PROCESSING_FAILED" | "LEASE_EXPIRED",
): Promise<void> {
  const exhausted = job.attempts >= job.maxAttempts;

  const retryDelayMs =
    errorCode === "LEASE_EXPIRED"
      ? 0
      : Math.min(
          30000,
          retryBaseMs * 2 ** Math.min(Math.max(job.attempts - 1, 0), 20),
        );

  const updatedOrders = await transaction.order.updateMany({
    where: {
      id: job.orderId,
      status: "processing",
    },
    data: {
      status: exhausted ? "failed" : "queued",
      failedAt: exhausted ? timestamp : null,
      updatedAt: timestamp,
    },
  });

  if (updatedOrders.count !== 1) {
    throw new Error("Job and order states are inconsistent");
  }

  await transaction.job.update({
    where: { id: job.id },
    data: {
      state: exhausted ? "dead_letter" : "pending",
      nextAttemptAt: new Date(timestamp.getTime() + retryDelayMs),
      claimToken: null,
      leaseExpiresAt: null,
      lastError: errorCode,
      deadLetteredAt: exhausted ? timestamp : null,
      updatedAt: timestamp,
    },
  });
}

export async function failJob(
  database: PrismaClient,
  job: ClaimedJob,
  retryBaseMs: number,
): Promise<boolean> {
  const result = await database.$transaction(async (transaction) => {
    const locked = await transaction.$queryRaw<{ id: string }[]>`
      SELECT id
      FROM jobs
      WHERE id = ${job.id}::uuid
      FOR UPDATE
    `;

    if (locked.length === 0) {
      return null;
    }

    const times = await transaction.$queryRaw<{ timestamp: Date }[]>`
      SELECT clock_timestamp() AS timestamp
    `;

    const timestamp = times[0]!.timestamp;

    const owned = await transaction.$queryRaw<LockedJob[]>`
      SELECT
        id,
        order_id AS "orderId",
        attempts,
        max_attempts AS "maxAttempts"
      FROM jobs
      WHERE id = ${job.id}::uuid
        AND state = 'claimed'
        AND claim_token = ${job.claimToken}::uuid
        AND lease_expires_at > ${timestamp}
    `;

    const currentJob = owned[0];

    if (!currentJob) {
      return null;
    }

    await rescheduleOrFail(
      transaction,
      currentJob,
      timestamp,
      retryBaseMs,
      "PROCESSING_FAILED",
    );

    return currentJob;
  });

  if (!result) {
    return false;
  }

  logger.info({
    event:
      result.attempts >= result.maxAttempts
        ? "job_dead_lettered"
        : "job_retry_scheduled",
    jobId: result.id,
    orderId: result.orderId,
    attempts: result.attempts,
  });

  return true;
}

export async function recoverExpiredJob(
  database: PrismaClient,
  retryBaseMs: number,
): Promise<boolean> {
  const result = await database.$transaction(async (transaction) => {
    const candidates = await transaction.$queryRaw<{ id: string }[]>`
      SELECT id
      FROM jobs
      WHERE state = 'claimed'
        AND lease_expires_at <= clock_timestamp()
      ORDER BY lease_expires_at, id
      FOR UPDATE SKIP LOCKED
      LIMIT 1
    `;

    const candidate = candidates[0];

    if (!candidate) {
      return null;
    }

    const times = await transaction.$queryRaw<{ timestamp: Date }[]>`
      SELECT clock_timestamp() AS timestamp
    `;

    const timestamp = times[0]!.timestamp;

    const expired = await transaction.$queryRaw<LockedJob[]>`
      SELECT
        id,
        order_id AS "orderId",
        attempts,
        max_attempts AS "maxAttempts"
      FROM jobs
      WHERE id = ${candidate.id}::uuid
        AND state = 'claimed'
        AND lease_expires_at <= ${timestamp}
    `;

    const currentJob = expired[0];

    if (!currentJob) {
      return null;
    }

    await rescheduleOrFail(
      transaction,
      currentJob,
      timestamp,
      retryBaseMs,
      "LEASE_EXPIRED",
    );

    return currentJob;
  });

  if (!result) {
    return false;
  }

  logger.info({
    event: "lease_recovered",
    jobId: result.id,
    orderId: result.orderId,
    attempts: result.attempts,
    outcome:
      result.attempts >= result.maxAttempts ? "dead_letter" : "pending",
  });

  return true;
}
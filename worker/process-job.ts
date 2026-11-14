import type { PrismaClient } from "../shared/generated/prisma/client.js";
import { logger } from "../shared/logger.js";
import { completeJob, failJob, type ClaimedJob } from "./job-repository.js";

interface FulfillmentOrder {
  id: string;
  totalCents: number;
  items: {
    quantity: number;
    unitPriceCents: number;
  }[];
}

type Fulfill = (order: FulfillmentOrder) => Promise<void>;

async function validateFulfillment(order: FulfillmentOrder): Promise<void> {
  const calculatedTotal = order.items.reduce(
    (total, item) => total + item.quantity * item.unitPriceCents,
    0,
  );

  if (order.items.length === 0 || calculatedTotal !== order.totalCents) {
    throw new Error("INVALID_ORDER_DATA");
  }
}

export async function processJob(
  database: PrismaClient,
  job: ClaimedJob,
  retryBaseMs: number,
  fulfill: Fulfill = validateFulfillment,
): Promise<void> {
  // Database read failures propagate to the main loop.
  const order = await database.order.findUniqueOrThrow({
    where: { id: job.orderId },
    select: {
      id: true,
      totalCents: true,
      items: {
        select: {
          quantity: true,
          unitPriceCents: true,
        },
      },
    },
  });

  try {
    await fulfill(order);
  } catch {
    const recorded = await failJob(database, job, retryBaseMs);

    if (!recorded) {
      logger.info({
        event: "job_result_abandoned",
        jobId: job.id,
        orderId: job.orderId,
      });
    }

    return;
  }

  // Completion failures propagate because the commit outcome may be unknown.
  const completed = await completeJob(database, job);

  logger.info({
    event: completed ? "job_completed" : "job_result_abandoned",
    jobId: job.id,
    orderId: job.orderId,
    attempts: job.attempts,
  });
}
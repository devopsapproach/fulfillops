import { randomUUID } from "node:crypto";
import type { PrismaClient } from "../../shared/generated/prisma/client.js";

export interface OrderJobFixture {
  sku: string;
  orderId: string;
  jobId: string;
}

export async function createOrderJobFixture(
  database: PrismaClient,
  nextAttemptAt = new Date(0),
): Promise<OrderJobFixture> {
  const fixture = {
    sku: `TEST-${randomUUID()}`,
    orderId: randomUUID(),
    jobId: randomUUID(),
  };

  await database.$transaction(async (transaction) => {
    await transaction.product.create({
      data: {
        sku: fixture.sku,
        unitPriceCents: 100,
        available: 4,
      },
    });

    await transaction.order.create({
      data: {
        id: fixture.orderId,
        idempotencyKey: `worker-test-${randomUUID()}`,
        canonicalPayload: {
          customer_id: "WORKER-TEST",
          items: [{ sku: fixture.sku, quantity: 1 }],
        },
        customerId: "WORKER-TEST",
        status: "queued",
        totalCents: 100,
      },
    });

    await transaction.orderItem.create({
      data: {
        orderId: fixture.orderId,
        sku: fixture.sku,
        quantity: 1,
        unitPriceCents: 100,
      },
    });

    await transaction.job.create({
      data: {
        id: fixture.jobId,
        orderId: fixture.orderId,
        state: "pending",
        nextAttemptAt,
      },
    });
  });

  return fixture;
}

export async function deleteOrderJobFixture(
  database: PrismaClient,
  fixture: OrderJobFixture,
): Promise<void> {
  await database.$transaction(async (transaction) => {
    await transaction.fulfillmentReceipt.deleteMany({
      where: { orderId: fixture.orderId },
    });

    await transaction.job.deleteMany({
      where: { orderId: fixture.orderId },
    });

    await transaction.orderItem.deleteMany({
      where: { orderId: fixture.orderId },
    });

    await transaction.order.deleteMany({
      where: { id: fixture.orderId },
    });

    await transaction.product.deleteMany({
      where: { sku: fixture.sku },
    });
  });
}

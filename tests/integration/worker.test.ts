import "dotenv/config";
import { randomUUID } from "node:crypto";
import { PrismaPg } from "@prisma/adapter-pg";
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
} from "vitest";

import { PrismaClient } from "../../shared/generated/prisma/client.js";
import {
  claimNextJob,
  completeJob,
  failJob,
  recoverExpiredJob,
} from "../../worker/job-repository.js";
import {
  createOrderJobFixture,
  deleteOrderJobFixture,
  type OrderJobFixture,
} from "../helpers/order-job-fixture.js";

import { processJob } from "../../worker/process-job.js";

const connectionString = process.env.TEST_DATABASE_URL;

if (!connectionString) {
  throw new Error("TEST_DATABASE_URL is required");
}

if (new URL(connectionString).pathname !== "/fulfillops_test") {
  throw new Error("Worker tests must use fulfillops_test");
}

const database = new PrismaClient({
  adapter: new PrismaPg({ connectionString }),
});

let fixture: OrderJobFixture | undefined;

const TEST_LEASE_MS = 60000;
const RETRY_BASE_MS = 1000;

async function claimFixtureJob() {
  const claimed = await claimNextJob(database, TEST_LEASE_MS);

  if (!claimed || claimed.id !== fixture?.jobId) {
    throw new Error("Expected the current fixture job to be claimed");
  }

  return claimed;
}

async function readFixtureState() {
  if (!fixture) {
    throw new Error("A fixture must exist");
  }

  const [job, order, product, receiptCount] = await Promise.all([
    database.job.findUniqueOrThrow({
      where: { id: fixture.jobId },
    }),
    database.order.findUniqueOrThrow({
      where: { id: fixture.orderId },
    }),
    database.product.findUniqueOrThrow({
      where: { sku: fixture.sku },
    }),
    database.fulfillmentReceipt.count({
      where: { orderId: fixture.orderId },
    }),
  ]);

  return { job, order, product, receiptCount };
}

async function expectFinalFailure(
  expectedError: "PROCESSING_FAILED" | "LEASE_EXPIRED",
) {
  const { job, order, product, receiptCount } = await readFixtureState();

  expect(job.state).toBe("dead_letter");
  expect(job.deadLetteredAt).not.toBeNull();
  expect(job.completedAt).toBeNull();
  expect(job.claimToken).toBeNull();
  expect(job.leaseExpiresAt).toBeNull();
  expect(job.lastError).toBe(expectedError);
  expect(job.attempts).toBe(job.maxAttempts);

  expect(order.status).toBe("failed");
  expect(order.failedAt).not.toBeNull();
  expect(order.completedAt).toBeNull();
  expect(order.totalCents).toBe(100);

  expect(receiptCount).toBe(0);
  expect(product.available).toBe(4);

  expect(await claimNextJob(database, TEST_LEASE_MS)).toBeNull();
}

beforeAll(async () => {
  const rows = await database.$queryRaw<{ database_name: string }[]>`
    SELECT current_database() AS database_name
  `;

  expect(rows[0]?.database_name).toBe("fulfillops_test");
});

beforeEach(async () => {
  const existingJobs = await database.job.findMany({
    where: {
      state: { in: ["pending", "claimed"] },
    },
    select: { id: true },
    take: 5,
  });

  if (existingJobs.length > 0) {
    throw new Error(
      `Worker tests require an idle test queue. Existing job IDs: ${existingJobs
        .map((job) => job.id)
        .join(
          ", ",
        )}. Stop other processes and inspect these jobs before retrying.`,
    );
  }
});

afterEach(async () => {
  if (fixture) {
    await deleteOrderJobFixture(database, fixture);
    fixture = undefined;
  }
});

afterAll(async () => {
  await database.$disconnect();
});

describe("worker job claiming", { concurrent: false }, () => {
  it("returns null when no pending jobs exist", async () => {
    const job = await claimNextJob(database, 10000);

    expect(job).toBeNull();
  });

  it("claims a due job and marks its order processing", async () => {
    fixture = await createOrderJobFixture(database);

    const claimed = await claimNextJob(database, 10000);

    expect(claimed).toMatchObject({
      id: fixture.jobId,
      orderId: fixture.orderId,
      attempts: 1,
      maxAttempts: 3,
    });

    expect(claimed?.claimToken).toEqual(expect.any(String));

    const job = await database.job.findUniqueOrThrow({
      where: { id: fixture.jobId },
    });

    const order = await database.order.findUniqueOrThrow({
      where: { id: fixture.orderId },
    });

    const product = await database.product.findUniqueOrThrow({
      where: { sku: fixture.sku },
    });

    expect(job.state).toBe("claimed");
    expect(job.claimToken).toBe(claimed?.claimToken);
    expect(job.leaseExpiresAt).not.toBeNull();
    expect(order.status).toBe("processing");
    expect(product.available).toBe(4);
  });

  it("does not claim a job scheduled for the future", async () => {
    fixture = await createOrderJobFixture(
      database,
      new Date("2100-01-01T00:00:00Z"),
    );

    const claimed = await claimNextJob(database, 10000);

    expect(claimed).toBeNull();

    const job = await database.job.findUniqueOrThrow({
      where: { id: fixture.jobId },
    });

    expect(job.state).toBe("pending");
    expect(job.attempts).toBe(0);
    expect(job.claimToken).toBeNull();
  });

  it("allows only one of two concurrent claimers to claim a job", async () => {
    fixture = await createOrderJobFixture(database);

    const outcomes = await Promise.allSettled([
      claimNextJob(database, 10000),
      claimNextJob(database, 10000),
    ]);

    const results = outcomes.map((outcome) => {
      if (outcome.status === "rejected") {
        throw outcome.reason;
      }

      return outcome.value;
    });

    const claimed = results.filter((job) => job !== null);

    expect(claimed).toHaveLength(1);
    expect(claimed[0]?.id).toBe(fixture.jobId);
    expect(results.filter((job) => job === null)).toHaveLength(1);

    const job = await database.job.findUniqueOrThrow({
      where: { id: fixture.jobId },
    });

    expect(job.attempts).toBe(1);
    expect(job.claimToken).toBe(claimed[0]?.claimToken);
  });

  it("schedules a retry without incrementing attempts", async () => {
    fixture = await createOrderJobFixture(database);
    const claimed = await claimFixtureJob();

    expect(claimed.attempts).toBe(1);

    expect(await failJob(database, claimed, RETRY_BASE_MS)).toBe(true);

    const { job, order, product, receiptCount } = await readFixtureState();

    expect(job.state).toBe("pending");
    expect(job.attempts).toBe(1);
    expect(job.claimToken).toBeNull();
    expect(job.leaseExpiresAt).toBeNull();
    expect(job.lastError).toBe("PROCESSING_FAILED");
    expect(job.deadLetteredAt).toBeNull();

    // Compare persisted timestamps to avoid dependence on the test machine clock.
    expect(job.nextAttemptAt.getTime() - job.updatedAt.getTime()).toBe(
      RETRY_BASE_MS,
    );

    expect(order.status).toBe("queued");
    expect(order.failedAt).toBeNull();
    expect(product.available).toBe(4);
    expect(receiptCount).toBe(0);
  });

  it("completes successfully on the second attempt", async () => {
    fixture = await createOrderJobFixture(database);
    const firstClaim = await claimFixtureJob();

    expect(await failJob(database, firstClaim, RETRY_BASE_MS)).toBe(true);

    expect((await readFixtureState()).job.attempts).toBe(1);

    // Make the retry immediately eligible without waiting.
    await database.job.update({
      where: { id: fixture.jobId },
      data: {
        nextAttemptAt: new Date(0),
        updatedAt: new Date(),
      },
    });

    const secondClaim = await claimFixtureJob();

    expect(secondClaim.attempts).toBe(2);
    expect(secondClaim.claimToken).not.toBe(firstClaim.claimToken);

    await processJob(database, secondClaim, RETRY_BASE_MS);

    const { job, order, product, receiptCount } = await readFixtureState();

    expect(job.state).toBe("completed");
    expect(job.attempts).toBe(2);
    expect(job.claimToken).toBeNull();
    expect(job.leaseExpiresAt).toBeNull();
    expect(job.completedAt).not.toBeNull();
    expect(order.status).toBe("completed");
    expect(order.totalCents).toBe(100);
    expect(receiptCount).toBe(1);
    expect(product.available).toBe(4);
  });

  it("dead-letters a poison job after its allowed attempt", async () => {
    fixture = await createOrderJobFixture(database);

    await database.job.update({
      where: { id: fixture.jobId },
      data: {
        maxAttempts: 1,
        updatedAt: new Date(),
      },
    });

    const claimed = await claimFixtureJob();

    await processJob(database, claimed, RETRY_BASE_MS, async () => {
      throw new Error("DETERMINISTIC_TEST_FAILURE");
    });

    await expectFinalFailure("PROCESSING_FAILED");
  });

  it("recovers an expired claim without incrementing attempts", async () => {
    fixture = await createOrderJobFixture(database);
    await claimFixtureJob();

    await database.job.update({
      where: { id: fixture.jobId },
      data: {
        leaseExpiresAt: new Date(0),
        updatedAt: new Date(),
      },
    });

    expect(await recoverExpiredJob(database, RETRY_BASE_MS)).toBe(true);

    const { job, order, product, receiptCount } = await readFixtureState();

    expect(job.state).toBe("pending");
    expect(job.attempts).toBe(1);
    expect(job.claimToken).toBeNull();
    expect(job.leaseExpiresAt).toBeNull();
    expect(job.lastError).toBe("LEASE_EXPIRED");

    expect(job.nextAttemptAt.getTime() - job.updatedAt.getTime()).toBe(
      RETRY_BASE_MS,
    );

    expect(order.status).toBe("queued");
    expect(product.available).toBe(4);
    expect(receiptCount).toBe(0);
  });

  it("dead-letters an expired final attempt", async () => {
    fixture = await createOrderJobFixture(database);

    await database.job.update({
      where: { id: fixture.jobId },
      data: {
        maxAttempts: 1,
        updatedAt: new Date(),
      },
    });

    await claimFixtureJob();

    await database.job.update({
      where: { id: fixture.jobId },
      data: {
        leaseExpiresAt: new Date(0),
        updatedAt: new Date(),
      },
    });

    expect(await recoverExpiredJob(database, RETRY_BASE_MS)).toBe(true);

    await expectFinalFailure("LEASE_EXPIRED");
  });

  it("preserves the current claim when failure uses the wrong token", async () => {
    fixture = await createOrderJobFixture(database);
    const claimed = await claimFixtureJob();

    const before = await readFixtureState();

    const recorded = await failJob(
      database,
      {
        ...claimed,
        claimToken: randomUUID(),
      },
      RETRY_BASE_MS,
    );

    expect(recorded).toBe(false);

    const after = await readFixtureState();

    expect(after).toEqual(before);
  });

  it("rejects an old worker after a job is reclaimed", async () => {
    fixture = await createOrderJobFixture(database);
    const firstClaim = await claimFixtureJob();

    await database.job.update({
      where: { id: fixture.jobId },
      data: {
        leaseExpiresAt: new Date(0),
        updatedAt: new Date(),
      },
    });

    expect(await recoverExpiredJob(database, RETRY_BASE_MS)).toBe(true);

    expect((await readFixtureState()).job.attempts).toBe(1);

    await database.job.update({
      where: { id: fixture.jobId },
      data: {
        nextAttemptAt: new Date(0),
        updatedAt: new Date(),
      },
    });

    const secondClaim = await claimFixtureJob();

    expect(secondClaim.attempts).toBe(2);
    expect(secondClaim.claimToken).not.toBe(firstClaim.claimToken);

    expect(await completeJob(database, firstClaim)).toBe(false);

    const beforeCompletion = await readFixtureState();

    expect(beforeCompletion.job.state).toBe("claimed");
    expect(beforeCompletion.job.claimToken).toBe(secondClaim.claimToken);
    expect(beforeCompletion.order.status).toBe("processing");
    expect(beforeCompletion.receiptCount).toBe(0);

    expect(await completeJob(database, secondClaim)).toBe(true);

    const afterCompletion = await readFixtureState();

    expect(afterCompletion.job.state).toBe("completed");
    expect(afterCompletion.job.attempts).toBe(2);
    expect(afterCompletion.order.status).toBe("completed");
    expect(afterCompletion.receiptCount).toBe(1);
    expect(afterCompletion.product.available).toBe(4);
  });

  it("returns false when there are no expired claims", async () => {
    expect(await recoverExpiredJob(database, RETRY_BASE_MS)).toBe(false);
  });
});

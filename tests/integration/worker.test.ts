import "dotenv/config";
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
import { claimNextJob } from "../../worker/job-repository.js";
import {
  createOrderJobFixture,
  deleteOrderJobFixture,
  type OrderJobFixture,
} from "../helpers/order-job-fixture.js";

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
});

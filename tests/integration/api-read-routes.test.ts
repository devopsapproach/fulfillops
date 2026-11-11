import "dotenv/config";
import { PrismaPg } from "@prisma/adapter-pg";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../../api/app.js";
import { PrismaClient } from "../../shared/generated/prisma/client.js";

const connectionString = process.env.TEST_DATABASE_URL;

if (!connectionString) {
  throw new Error("TEST_DATABASE_URL is required for integration tests");
}

if (new URL(connectionString).pathname !== "/fulfillops_test") {
  throw new Error("Integration tests must use the fulfillops_test database");
}

const database = new PrismaClient({
  adapter: new PrismaPg({ connectionString }),
});
const app = createApp({ database });

beforeAll(async () => {
  await database.product.createMany({
    data: [
      { sku: "KIT-100", unitPriceCents: 1299, available: 7 },
      { sku: "PART-200", unitPriceCents: 599, available: 12 },
      { sku: "PACK-300", unitPriceCents: 249, available: 5 },
    ],
    skipDuplicates: true,
  });
});

afterAll(async () => {
  await database.$disconnect();
});

describe("read routes against PostgreSQL", () => {
  it("reports ready when the migrated database is reachable", async () => {
    const response = await request(app).get("/health/ready");

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ status: "ready" });
  });

  it("returns the fixed catalog prices", async () => {
    const response = await request(app).get("/api/v1/catalog");

    expect(response.status).toBe(200);
    expect(response.body.products).toEqual(
      expect.arrayContaining([
        { sku: "KIT-100", unit_price_cents: 1299 },
        { sku: "PART-200", unit_price_cents: 599 },
        { sku: "PACK-300", unit_price_cents: 249 },
      ]),
    );
  });

  it("returns a nonnegative integer for available stock", async () => {
    const response = await request(app).get("/api/v1/inventory/PART-200");

    expect(response.status).toBe(200);
    expect(response.body.sku).toBe("PART-200");
    expect(Number.isInteger(response.body.available)).toBe(true);
    expect(response.body.available).toBeGreaterThanOrEqual(0);
  });

  it("returns 404 SKU_NOT_FOUND for an unknown SKU", async () => {
    const response = await request(app).get("/api/v1/inventory/NOPE-999");

    expect(response.status).toBe(404);
    expect(response.body.error.code).toBe("SKU_NOT_FOUND");
  });
});

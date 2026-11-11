import "dotenv/config";
import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const connectionString = process.env.TEST_DATABASE_URL;

if (!connectionString) {
  throw new Error("TEST_DATABASE_URL is required for integration tests");
}

const connectionUrl = new URL(connectionString);

if (connectionUrl.pathname !== "/fulfillops_test") {
  throw new Error("Integration tests must use the fulfillops_test database");
}

const pool = new Pool({
  connectionString,
  max: 1,
  connectionTimeoutMillis: 5000,
});

beforeAll(async () => {
  const result = await pool.query<{ database_name: string }>(
    "SELECT current_database() AS database_name",
  );

  expect(result.rows[0]?.database_name).toBe("fulfillops_test");
});

afterAll(async () => {
  await pool.end();
});

describe("Product database constraints", () => {
  it("rejects negative available stock", async () => {
    const client = await pool.connect();
    const sku = `TEST-${randomUUID()}`;

    try {
      await client.query("BEGIN");

      await client.query(
        `
          INSERT INTO products (sku, unit_price_cents, available)
          VALUES ($1, $2, $3)
        `,
        [sku, 100, 1],
      );

      await expect(
        client.query("UPDATE products SET available = -1 WHERE sku = $1", [
          sku,
        ]),
      ).rejects.toMatchObject({
        code: "23514",
        constraint: "products_available_nonnegative",
      });
    } finally {
      try {
        await client.query("ROLLBACK");
      } finally {
        client.release();
      }
    }
  });
});

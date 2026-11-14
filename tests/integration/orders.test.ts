import "dotenv/config";
import { randomUUID } from "node:crypto";
import { PrismaPg } from "@prisma/adapter-pg";
import request from "supertest";
import { afterAll, describe, expect, it } from "vitest";
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

// touch the real catalog stock and can run in any order.
const createdSkus: string[] = [];

async function product(available: number, unitPriceCents = 100) {
  const sku = `TEST-${randomUUID()}`;
  await database.product.create({ data: { sku, unitPriceCents, available } });
  createdSkus.push(sku);
  return sku;
}

async function stock(sku: string) {
  const row = await database.product.findUniqueOrThrow({ where: { sku } });
  return row.available;
}

function key() {
  return `test-${randomUUID()}`;
}

function postOrder(idempotencyKey: string, body: unknown) {
  return request(app)
    .post("/api/v1/orders")
    .set("Idempotency-Key", idempotencyKey)
    .send(body as object);
}

afterAll(async () => {
  const orders = await database.orderItem.findMany({
    where: { sku: { in: createdSkus } },
    select: { orderId: true },
  });
  const orderIds = [...new Set(orders.map((o) => o.orderId))];

  await database.job.deleteMany({ where: { orderId: { in: orderIds } } });
  await database.orderItem.deleteMany({ where: { orderId: { in: orderIds } } });
  await database.order.deleteMany({ where: { id: { in: orderIds } } });
  await database.product.deleteMany({ where: { sku: { in: createdSkus } } });
  await database.$disconnect();
});

async function ordersCreatedCounter(): Promise<number> {
  const response = await request(app).get("/metrics");

  expect(response.status).toBe(200);

  const match = response.text.match(
    /^fulfillops_orders_created_total ([0-9]+)$/m,
  );

  if (!match) {
    throw new Error("Missing orders-created counter sample");
  }

  return Number(match[1]);
}

describe("POST /api/v1/orders", () => {
  it("accepts an order, reserves stock and creates one pending job", async () => {
    const a = await product(5, 1299);
    const b = await product(5, 599);

    const response = await postOrder(key(), {
      customer_id: "CUST-1",
      items: [
        { sku: a, quantity: 1 },
        { sku: b, quantity: 2 },
      ],
    });

    expect(response.status).toBe(202);
    expect(response.body).toEqual({
      order_id: expect.any(String),
      status: "queued",
    });
    expect(await stock(a)).toBe(4);
    expect(await stock(b)).toBe(3);

    const orderId = response.body.order_id as string;
    const order = await database.order.findUniqueOrThrow({
      where: { id: orderId },
      include: { items: true, job: true },
    });
    expect(order.totalCents).toBe(1299 + 2 * 599);
    expect(order.items).toHaveLength(2);
    expect(order.job?.state).toBe("pending");
  });

  it("replays the same key and payload without reserving again", async () => {
    const sku = await product(5);
    const idempotencyKey = key();
    const body = { customer_id: "CUST-1", items: [{ sku, quantity: 2 }] };

    const first = await postOrder(idempotencyKey, body);
    const second = await postOrder(idempotencyKey, body);

    expect(first.status).toBe(202);
    expect(second.status).toBe(202);
    expect(second.body).toEqual({
      order_id: first.body.order_id,
      status: "queued",
    });
    expect(await stock(sku)).toBe(3);
  });

  it("treats reordered keys and split duplicate lines as the same payload", async () => {
    const sku = await product(5);
    const idempotencyKey = key();

    const first = await postOrder(idempotencyKey, {
      customer_id: "CUST-1",
      items: [{ sku, quantity: 2 }],
    });
    const second = await postOrder(idempotencyKey, {
      items: [
        { quantity: 1, sku },
        { quantity: 1, sku },
      ],
      customer_id: "CUST-1",
    });

    expect(second.status).toBe(202);
    expect(second.body.order_id).toBe(first.body.order_id);
    expect(await stock(sku)).toBe(3);
  });

  it("rejects a reused key with a different payload", async () => {
    const sku = await product(5);
    const idempotencyKey = key();

    await postOrder(idempotencyKey, {
      customer_id: "CUST-1",
      items: [{ sku, quantity: 1 }],
    });
    const conflict = await postOrder(idempotencyKey, {
      customer_id: "CUST-1",
      items: [{ sku, quantity: 2 }],
    });

    expect(conflict.status).toBe(409);
    expect(conflict.body.error.code).toBe("IDEMPOTENCY_CONFLICT");
    expect(await stock(sku)).toBe(4);
  });

  it("rolls back every line when one line is out of stock", async () => {
    const plenty = await product(5);
    const scarce = await product(1);
    const idempotencyKey = key();

    const response = await postOrder(idempotencyKey, {
      customer_id: "CUST-1",
      items: [
        { sku: plenty, quantity: 2 },
        { sku: scarce, quantity: 2 },
      ],
    });

    expect(response.status).toBe(409);
    expect(response.body.error.code).toBe("OUT_OF_STOCK");
    expect(await stock(plenty)).toBe(5);
    expect(await stock(scarce)).toBe(1);
    expect(await database.order.count({ where: { idempotencyKey } })).toBe(0);
  });

  it("adds duplicate SKU lines together before checking stock", async () => {
    const sku = await product(3);

    const response = await postOrder(key(), {
      customer_id: "CUST-1",
      items: [
        { sku, quantity: 2 },
        { sku, quantity: 2 },
      ],
    });

    expect(response.status).toBe(409);
    expect(response.body.error.code).toBe("OUT_OF_STOCK");
    expect(await stock(sku)).toBe(3);
  });

  it("rejects an unknown SKU without creating an order", async () => {
    const idempotencyKey = key();

    const response = await postOrder(idempotencyKey, {
      customer_id: "CUST-1",
      items: [{ sku: "NOPE-999", quantity: 1 }],
    });

    expect(response.status).toBe(422);
    expect(response.body.error.code).toBe("INVALID_SKU");
    expect(await database.order.count({ where: { idempotencyKey } })).toBe(0);
  });
});

describe("concurrent orders", () => {
  it("accepts eight simultaneous same-key requests as one order", async () => {
    const sku = await product(5);
    const idempotencyKey = key();
    const body = { customer_id: "CUST-1", items: [{ sku, quantity: 1 }] };

    const responses = await Promise.all(
      Array.from({ length: 8 }, () => postOrder(idempotencyKey, body)),
    );

    expect(responses.map((r) => r.status)).toEqual(Array(8).fill(202));
    const ids = new Set(responses.map((r) => r.body.order_id));
    expect(ids.size).toBe(1);
    expect(await stock(sku)).toBe(4);
  });

  it("never oversells when twelve different keys compete for five units", async () => {
    const sku = await product(5);

    const responses = await Promise.all(
      Array.from({ length: 12 }, () =>
        postOrder(key(), {
          customer_id: "CUST-1",
          items: [{ sku, quantity: 1 }],
        }),
      ),
    );

    const statuses = responses.map((r) => r.status);
    expect(statuses.filter((s) => s === 202)).toHaveLength(5);
    expect(statuses.filter((s) => s === 409)).toHaveLength(7);
    expect(await stock(sku)).toBe(0);
  });
});

describe("GET /api/v1/orders/:orderId", () => {
  it("returns the order status and total", async () => {
    const sku = await product(5, 249);
    const created = await postOrder(key(), {
      customer_id: "CUST-1",
      items: [{ sku, quantity: 2 }],
    });

    const response = await request(app).get(
      `/api/v1/orders/${created.body.order_id}`,
    );

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      order_id: created.body.order_id,
      status: "queued",
      total_cents: 498,
    });
  });

  it("returns 404 ORDER_NOT_FOUND for unknown or malformed ids", async () => {
    for (const id of [randomUUID(), "not-real-order"]) {
      const response = await request(app).get(`/api/v1/orders/${id}`);
      expect(response.status).toBe(404);
      expect(response.body.error.code).toBe("ORDER_NOT_FOUND");
    }
  });
});

describe("order creation metrics", () => {
  it("increments after creating a persisted order", async () => {
    const sku = await product(5);
    const before = await ordersCreatedCounter();

    const response = await postOrder(key(), {
      customer_id: "CUST-METRICS",
      items: [{ sku, quantity: 1 }],
    });

    expect(response.status).toBe(202);

    const persisted = await database.order.findUnique({
      where: { id: response.body.order_id },
    });

    expect(persisted).not.toBeNull();
    expect(await ordersCreatedCounter()).toBe(before + 1);
  });

  it("does not increment for an idempotent replay", async () => {
    const sku = await product(5);
    const idempotencyKey = key();
    const body = {
      customer_id: "CUST-METRICS",
      items: [{ sku, quantity: 1 }],
    };

    const first = await postOrder(idempotencyKey, body);
    expect(first.status).toBe(202);

    const beforeReplay = await ordersCreatedCounter();

    const replay = await postOrder(idempotencyKey, body);

    expect(replay.status).toBe(202);
    expect(replay.body.order_id).toBe(first.body.order_id);
    expect(await ordersCreatedCounter()).toBe(beforeReplay);
  });

  it("does not increment when the transaction rolls back", async () => {
    const sku = await product(0);
    const idempotencyKey = key();
    const before = await ordersCreatedCounter();

    const response = await postOrder(idempotencyKey, {
      customer_id: "CUST-METRICS",
      items: [{ sku, quantity: 1 }],
    });

    expect(response.status).toBe(409);
    expect(response.body.error.code).toBe("OUT_OF_STOCK");

    expect(await database.order.count({ where: { idempotencyKey } })).toBe(0);

    expect(await ordersCreatedCounter()).toBe(before);
  });
});

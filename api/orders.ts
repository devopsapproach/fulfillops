import { randomUUID } from "node:crypto";
import type { Database } from "./app.js";
import { ApiError } from "./errors.js";
import { canonicalString, type CanonicalOrder } from "./validation.js";

export interface AcceptedOrder {
  orderId: string;
  replayed: boolean;
}

export interface OrderView {
  order_id: string;
  status: string;
  total_cents: number;
}

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function storedOrder(payload: unknown): CanonicalOrder {
  return (
    typeof payload === "string" ? JSON.parse(payload) : payload
  ) as CanonicalOrder;
}

export async function acceptOrder(
  database: Database,
  idempotencyKey: string,
  order: CanonicalOrder,
): Promise<AcceptedOrder> {
  const payload = canonicalString(order);

  return database.$transaction(
    async (tx) => {
      const skus = order.items.map((line) => line.sku);
      const products = await tx.$queryRaw<
        { sku: string; unit_price_cents: number }[]
      >`
        SELECT sku, unit_price_cents FROM products WHERE sku = ANY(${skus}::text[])
      `;
      const prices = new Map(products.map((p) => [p.sku, p.unit_price_cents]));

      const totalCents = order.items.reduce(
        (sum, line) => sum + (prices.get(line.sku) ?? 0) * line.quantity,
        0,
      );

      const orderId = randomUUID();
      const inserted = await tx.$queryRaw<{ id: string }[]>`
        INSERT INTO orders (id, idempotency_key, canonical_payload, customer_id, total_cents)
        VALUES (${orderId}::uuid, ${idempotencyKey}, ${payload}::jsonb,
                ${order.customer_id}, ${totalCents})
        ON CONFLICT (idempotency_key) DO NOTHING
        RETURNING id
      `;

      if (inserted.length === 0) {
        const existing = await tx.$queryRaw<
          { id: string; canonical_payload: unknown }[]
        >`
          SELECT id, canonical_payload FROM orders
          WHERE idempotency_key = ${idempotencyKey}
        `;
        const row = existing[0];

        if (!row) {
          throw new Error("Idempotency key row disappeared");
        }

        if (canonicalString(storedOrder(row.canonical_payload)) !== payload) {
          throw new ApiError(
            409,
            "IDEMPOTENCY_CONFLICT",
            "The Idempotency-Key was already used with a different payload",
          );
        }

        return { orderId: row.id, replayed: true };
      }

      if (products.length !== skus.length) {
        throw new ApiError(
          422,
          "INVALID_SKU",
          "The order contains an unknown SKU",
        );
      }

      for (const line of order.items) {
        const reserved = await tx.$executeRaw`
          UPDATE products
          SET available = available - ${line.quantity}, updated_at = now()
          WHERE sku = ${line.sku} AND available >= ${line.quantity}
        `;

        if (reserved === 0) {
          throw new ApiError(409, "OUT_OF_STOCK", "Not enough items available");
        }
      }

      for (const line of order.items) {
        await tx.$executeRaw`
          INSERT INTO order_items (order_id, sku, quantity, unit_price_cents)
          VALUES (${orderId}::uuid, ${line.sku}, ${line.quantity},
                  ${prices.get(line.sku) ?? 0})
        `;
      }

      await tx.$executeRaw`
        INSERT INTO jobs (id, order_id) VALUES (${randomUUID()}::uuid, ${orderId}::uuid)
      `;

      return { orderId, replayed: false };
    },
    { maxWait: 5000, timeout: 10000 },
  );
}

export async function findOrder(
  database: Database,
  orderId: string,
): Promise<OrderView> {
  if (!UUID_PATTERN.test(orderId)) {
    throw new ApiError(404, "ORDER_NOT_FOUND", "The order does not exist");
  }

  const order = await database.order.findUnique({
    where: { id: orderId },
    select: { id: true, status: true, totalCents: true },
  });

  if (!order) {
    throw new ApiError(404, "ORDER_NOT_FOUND", "The order does not exist");
  }

  return {
    order_id: order.id,
    status: order.status,
    total_cents: order.totalCents,
  };
}

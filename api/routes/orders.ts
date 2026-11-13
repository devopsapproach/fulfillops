import { Router } from "express";
import type { Database } from "../app.js";
import { acceptOrder, findOrder } from "../orders.js";
import { parseIdempotencyKey, parseOrderRequest } from "../validation.js";

export function ordersRouter(database: Database) {
  const router = Router();

  router.post("/api/v1/orders", async (request, response) => {
    const idempotencyKey = parseIdempotencyKey(request.get("Idempotency-Key"));
    const order = parseOrderRequest(request.body);

    const accepted = await acceptOrder(database, idempotencyKey, order);

    response.status(202).json({ order_id: accepted.orderId, status: "queued" });
  });

  router.get("/api/v1/orders/:orderId", async (request, response) => {
    const order = await findOrder(database, request.params.orderId);
    response.status(200).json(order);
  });

  return router;
}

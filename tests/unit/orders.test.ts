import request from "supertest";
import { describe, expect, it } from "vitest";
import { createApp } from "../../api/app.js";
import { fakeDatabase } from "../helpers/fake-database.js";

const app = createApp({ database: fakeDatabase() });

const validBody = {
  customer_id: "CUST-042",
  items: [{ sku: "KIT-100", quantity: 1 }],
};

describe("POST /api/v1/orders validation", () => {
  it("returns 400 IDEMPOTENCY_REQUIRED without the header", async () => {
    const response = await request(app).post("/api/v1/orders").send(validBody);

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe("IDEMPOTENCY_REQUIRED");
  });

  it("returns 422 INVALID_QUANTITY for quantity 0", async () => {
    const response = await request(app)
      .post("/api/v1/orders")
      .set("Idempotency-Key", "unit-test-key-1")
      .send({ ...validBody, items: [{ sku: "KIT-100", quantity: 0 }] });

    expect(response.status).toBe(422);
    expect(response.body.error.code).toBe("INVALID_QUANTITY");
  });

  it("returns 400 INVALID_REQUEST for a missing customer_id", async () => {
    const response = await request(app)
      .post("/api/v1/orders")
      .set("Idempotency-Key", "unit-test-key-2")
      .send({ items: validBody.items });

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe("INVALID_REQUEST");
  });
});

describe("GET /api/v1/orders/:orderId", () => {
  it("returns 404 ORDER_NOT_FOUND for a malformed id", async () => {
    const response = await request(app).get("/api/v1/orders/not-real-order");

    expect(response.status).toBe(404);
    expect(response.body.error.code).toBe("ORDER_NOT_FOUND");
  });
});

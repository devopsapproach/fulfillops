import request from "supertest";
import { describe, expect, it } from "vitest";
import { createApp } from "../../api/app.js";
import { fakeDatabase, seededProducts } from "../helpers/fake-database.js";

const app = createApp({
  database: fakeDatabase({ products: seededProducts }),
});

describe("GET /api/v1/catalog", () => {
  it("lists every SKU with its fixed price", async () => {
    const response = await request(app).get("/api/v1/catalog");

    expect(response.status).toBe(200);
    expect(response.body.products).toEqual(
      expect.arrayContaining([
        { sku: "KIT-100", unit_price_cents: 1299 },
        { sku: "PART-200", unit_price_cents: 599 },
        { sku: "PACK-300", unit_price_cents: 249 },
      ]),
    );
    expect(response.body.products).toHaveLength(3);
  });
});

describe("GET /api/v1/inventory/:sku", () => {
  it("returns the available stock for a known SKU", async () => {
    const response = await request(app).get("/api/v1/inventory/KIT-100");

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ sku: "KIT-100", available: 7 });
  });

  it("returns 404 SKU_NOT_FOUND for an unknown SKU", async () => {
    const response = await request(app).get("/api/v1/inventory/NOPE-999");

    expect(response.status).toBe(404);
    expect(response.body.error.code).toBe("SKU_NOT_FOUND");
    expect(typeof response.body.error.message).toBe("string");
  });
});

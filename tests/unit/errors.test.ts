import request from "supertest";
import { describe, expect, it } from "vitest";
import { createApp, type Database } from "../../api/app.js";
import { fakeDatabase } from "../helpers/fake-database.js";

const app = createApp({ database: fakeDatabase() });

describe("error envelope", () => {
  it("returns 404 NOT_FOUND for an unknown route", async () => {
    const response = await request(app).get("/does-not-exist");

    expect(response.status).toBe(404);
    expect(response.body).toEqual({
      error: { code: "NOT_FOUND", message: expect.any(String) },
    });
  });

  it("returns 400 INVALID_JSON for a malformed JSON body", async () => {
    const response = await request(app)
      .post("/api/v1/orders")
      .set("Content-Type", "application/json")
      .send('{"customer_id": ');

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe("INVALID_JSON");
  });

  it("returns 413 PAYLOAD_TOO_LARGE for a body over 16 KiB", async () => {
    const response = await request(app)
      .post("/api/v1/orders")
      .set("Content-Type", "application/json")
      .send(JSON.stringify({ padding: "x".repeat(17 * 1024) }));

    expect(response.status).toBe(413);
    expect(response.body.error.code).toBe("PAYLOAD_TOO_LARGE");
  });

  it("hides internal error details behind a generic 500", async () => {
    const brokenDatabase = {
      ...fakeDatabase(),
      product: {
        findMany: () =>
          Promise.reject(new Error("password=secret SELECT * FROM products")),
      },
    } as unknown as Database;

    const response = await request(createApp({ database: brokenDatabase })).get(
      "/api/v1/catalog",
    );

    expect(response.status).toBe(500);
    expect(response.body.error.code).toBe("INTERNAL_ERROR");
    expect(JSON.stringify(response.body)).not.toContain("secret");
  });
});

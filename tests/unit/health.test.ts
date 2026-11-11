import request from "supertest";
import { describe, expect, it } from "vitest";
import { createApp } from "../../api/app.js";
import { fakeDatabase } from "../helpers/fake-database.js";

describe("GET /health/live", () => {
  it("reports that the process is alive without requiring a database", async () => {
    const app = createApp({ database: fakeDatabase({ ready: "error" }) });
    const response = await request(app).get("/health/live");

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ status: "ok" });
  });
});

describe("GET /health/ready", () => {
  it("returns 200 when the database and migrated tables are available", async () => {
    const app = createApp({ database: fakeDatabase({ ready: true }) });
    const response = await request(app).get("/health/ready");

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ status: "ready" });
  });

  it("returns 503 when migrations have not been applied", async () => {
    const app = createApp({ database: fakeDatabase({ ready: false }) });
    const response = await request(app).get("/health/ready");

    expect(response.status).toBe(503);
    expect(response.body).toEqual({ status: "not_ready" });
  });

  it("returns 503 when the database is unreachable", async () => {
    const app = createApp({ database: fakeDatabase({ ready: "error" }) });
    const response = await request(app).get("/health/ready");

    expect(response.status).toBe(503);
    expect(response.body).toEqual({ status: "not_ready" });
  });
});

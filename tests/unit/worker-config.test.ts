import { describe, expect, it } from "vitest";
import { parseWorkerConfig } from "../../worker/config.js";

describe("worker configuration", () => {
  it("uses the agreed defaults", () => {
    expect(parseWorkerConfig({})).toEqual({
      pollIntervalMs: 500,
      leaseMs: 10000,
      maxAttempts: 3,
      retryBaseMs: 1000,
    });
  });

  it.each(["0", "-1", "abc", "1.5"])(
    "rejects an invalid lease duration: %s",
    (value) => {
      expect(() => parseWorkerConfig({ WORKER_LEASE_MS: value })).toThrow(
        "WORKER_LEASE_MS",
      );
    },
  );
});

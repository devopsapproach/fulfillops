import { describe, expect, it } from "vitest";
import { MetricsRegistry } from "../../api/metrics.js";

describe("orders-created counter", () => {
  it("exposes zero before any orders are recorded", () => {
    const registry = new MetricsRegistry();
    const output = registry.getMetricsAsText();

    expect(output).toContain("# TYPE fulfillops_orders_created_total counter");
    expect(output).toMatch(/^fulfillops_orders_created_total 0$/m);
  });

  it("increments when an order is recorded", () => {
    const registry = new MetricsRegistry();

    registry.recordOrderCreated();

    expect(registry.getMetricsAsText()).toMatch(
      /^fulfillops_orders_created_total 1$/m,
    );
  });
});

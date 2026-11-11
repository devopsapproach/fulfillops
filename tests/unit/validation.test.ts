import { describe, expect, it } from "vitest";
import { ApiError } from "../../api/errors.js";
import {
  canonicalString,
  parseIdempotencyKey,
  parseOrderRequest,
} from "../../api/validation.js";

function errorCode(action: () => unknown): string | undefined {
  try {
    action();
  } catch (error) {
    if (error instanceof ApiError) return error.code;
    throw error;
  }
  return undefined;
}

const valid = {
  customer_id: "CUST-042",
  items: [{ sku: "KIT-100", quantity: 1 }],
};

describe("parseIdempotencyKey", () => {
  it("accepts 8-128 printable ASCII characters", () => {
    expect(parseIdempotencyKey("abc-1234")).toBe("abc-1234");
    expect(parseIdempotencyKey("k".repeat(128))).toBe("k".repeat(128));
  });

  it("requires the header", () => {
    expect(errorCode(() => parseIdempotencyKey(undefined))).toBe(
      "IDEMPOTENCY_REQUIRED",
    );
    expect(errorCode(() => parseIdempotencyKey(""))).toBe(
      "IDEMPOTENCY_REQUIRED",
    );
  });

  it("rejects keys that are too short, too long or not printable ASCII", () => {
    expect(errorCode(() => parseIdempotencyKey("short"))).toBe(
      "INVALID_REQUEST",
    );
    expect(errorCode(() => parseIdempotencyKey("k".repeat(129)))).toBe(
      "INVALID_REQUEST",
    );
    expect(errorCode(() => parseIdempotencyKey("tab\there-key"))).toBe(
      "INVALID_REQUEST",
    );
    expect(errorCode(() => parseIdempotencyKey("clé-unique-1"))).toBe(
      "INVALID_REQUEST",
    );
  });
});

describe("parseOrderRequest structure", () => {
  it.each([
    ["a non-object body", []],
    ["a null body", null],
    ["a missing customer_id", { items: valid.items }],
    ["a blank customer_id", { ...valid, customer_id: "   " }],
    ["a 65-character customer_id", { ...valid, customer_id: "c".repeat(65) }],
    ["a numeric customer_id", { ...valid, customer_id: 42 }],
    ["missing items", { customer_id: "CUST-042" }],
    ["empty items", { ...valid, items: [] }],
    [
      "eleven items",
      { ...valid, items: Array(11).fill({ sku: "KIT-100", quantity: 1 }) },
    ],
    ["a non-object item", { ...valid, items: ["KIT-100"] }],
  ])("rejects %s with INVALID_REQUEST", (_label, body) => {
    expect(errorCode(() => parseOrderRequest(body))).toBe("INVALID_REQUEST");
  });
});

describe("parseOrderRequest quantities", () => {
  it.each([0, -1, 21, 1.5, "2", true, null, undefined])(
    "rejects quantity %s with INVALID_QUANTITY",
    (quantity) => {
      const body = { ...valid, items: [{ sku: "KIT-100", quantity }] };
      expect(errorCode(() => parseOrderRequest(body))).toBe("INVALID_QUANTITY");
    },
  );

  it("accepts the boundaries 1 and 20", () => {
    for (const quantity of [1, 20]) {
      const body = { ...valid, items: [{ sku: "KIT-100", quantity }] };
      expect(parseOrderRequest(body).items[0]?.quantity).toBe(quantity);
    }
  });
});

describe("parseOrderRequest SKUs", () => {
  it.each([123, "", null, undefined])(
    "rejects sku %s with INVALID_SKU",
    (sku) => {
      const body = { ...valid, items: [{ sku, quantity: 1 }] };
      expect(errorCode(() => parseOrderRequest(body))).toBe("INVALID_SKU");
    },
  );
});

describe("canonical order", () => {
  it("aggregates duplicate SKU lines and sorts by SKU", () => {
    const order = parseOrderRequest({
      customer_id: "CUST-042",
      items: [
        { sku: "PART-200", quantity: 2 },
        { sku: "KIT-100", quantity: 1 },
        { sku: "PART-200", quantity: 3 },
      ],
    });

    expect(order).toEqual({
      customer_id: "CUST-042",
      items: [
        { sku: "KIT-100", quantity: 1 },
        { sku: "PART-200", quantity: 5 },
      ],
    });
  });

  it("gives the same string regardless of JSON key order", () => {
    const a = parseOrderRequest({
      customer_id: "CUST-042",
      items: [{ sku: "KIT-100", quantity: 1 }],
    });
    const b = parseOrderRequest({
      items: [{ quantity: 1, sku: "KIT-100" }],
      customer_id: "CUST-042",
    });

    expect(canonicalString(a)).toBe(canonicalString(b));
  });

  it("gives different strings for different payloads", () => {
    const a = parseOrderRequest(valid);
    const b = parseOrderRequest({
      ...valid,
      items: [{ sku: "KIT-100", quantity: 2 }],
    });

    expect(canonicalString(a)).not.toBe(canonicalString(b));
  });
});

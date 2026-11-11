import { ApiError } from "./errors.js";

export interface OrderLine {
  sku: string;
  quantity: number;
}

export interface CanonicalOrder {
  customer_id: string;
  items: OrderLine[];
}

const IDEMPOTENCY_KEY_PATTERN = /^[\x20-\x7E]{8,128}$/;
const MAX_CUSTOMER_ID_LENGTH = 64;
const MIN_ITEMS = 1;
const MAX_ITEMS = 10;
const MIN_QUANTITY = 1;
const MAX_QUANTITY = 20;

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function invalidRequest(message: string): never {
  throw new ApiError(400, "INVALID_REQUEST", message);
}

export function parseIdempotencyKey(header: string | undefined): string {
  if (header === undefined || header === "") {
    throw new ApiError(
      400,
      "IDEMPOTENCY_REQUIRED",
      "The Idempotency-Key header is required",
    );
  }

  if (!IDEMPOTENCY_KEY_PATTERN.test(header)) {
    invalidRequest(
      "The Idempotency-Key header must be 8-128 printable ASCII characters",
    );
  }

  return header;
}

function isValidQuantity(value: unknown): value is number {
  return (
    typeof value === "number" &&
    Number.isInteger(value) &&
    value >= MIN_QUANTITY &&
    value <= MAX_QUANTITY
  );
}

export function parseOrderRequest(body: unknown): CanonicalOrder {
  if (!isPlainObject(body)) {
    invalidRequest("The request body must be a JSON object");
  }

  const customerId = body.customer_id;
  if (
    typeof customerId !== "string" ||
    customerId.trim().length === 0 ||
    customerId.length > MAX_CUSTOMER_ID_LENGTH
  ) {
    invalidRequest("customer_id must be a nonempty string of 1-64 characters");
  }

  const items = body.items;
  if (
    !Array.isArray(items) ||
    items.length < MIN_ITEMS ||
    items.length > MAX_ITEMS
  ) {
    invalidRequest("items must be an array of 1-10 objects");
  }

  if (!items.every(isPlainObject)) {
    invalidRequest("Each item must be a JSON object");
  }

  if (!items.every((item) => isValidQuantity(item.quantity))) {
    throw new ApiError(
      422,
      "INVALID_QUANTITY",
      "Each quantity must be an integer from 1 to 20",
    );
  }

  if (
    !items.every((item) => typeof item.sku === "string" && item.sku.length > 0)
  ) {
    throw new ApiError(422, "INVALID_SKU", "Each item needs a valid SKU");
  }

  const totals = new Map<string, number>();
  for (const item of items) {
    const sku = item.sku as string;
    totals.set(sku, (totals.get(sku) ?? 0) + (item.quantity as number));
  }

  const lines = [...totals.entries()]
    .map(([sku, quantity]) => ({ sku, quantity }))
    .sort((a, b) => (a.sku < b.sku ? -1 : a.sku > b.sku ? 1 : 0));

  return { customer_id: customerId, items: lines };
}

export function canonicalString(order: CanonicalOrder): string {
  return JSON.stringify({
    customer_id: order.customer_id,
    items: order.items.map((line) => ({
      sku: line.sku,
      quantity: line.quantity,
    })),
  });
}

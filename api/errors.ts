// Every error the API returns uses the contract's envelope:
// { "error": { "code": "...", "message": "..." } }
// Messages are fixed, safe strings: never stack traces, SQL or credentials.

export type ErrorCode =
  | "INVALID_JSON"
  | "INVALID_REQUEST"
  | "INVALID_QUANTITY"
  | "INVALID_SKU"
  | "IDEMPOTENCY_REQUIRED"
  | "IDEMPOTENCY_CONFLICT"
  | "OUT_OF_STOCK"
  | "SKU_NOT_FOUND"
  | "ORDER_NOT_FOUND"
  | "NOT_FOUND"
  | "PAYLOAD_TOO_LARGE"
  | "INTERNAL_ERROR";

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: ErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

export function errorBody(code: ErrorCode, message: string) {
  return { error: { code, message } };
}

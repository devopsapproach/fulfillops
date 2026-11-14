// WP5 note: Establish an accurate, parsable audit trail to satisfy WP7 incident timeline and observability grading requirements.

export const logger = {
  info: (payload: Record<string, unknown>) => {
    console.info(
      JSON.stringify({
        timestamp: new Date().toISOString(),
        level: "INFO",
        ...payload,
      })
    );
  },
  error: (payload: Record<string, unknown>, error?: unknown) => {
    const errorMeta =
      error instanceof Error
        ? { error: error.message, stack: error.stack }
        : error !== undefined
          ? { error: String(error) }
          : {};

    console.error(
      JSON.stringify({
        timestamp: new Date().toISOString(),
        level: "ERROR",
        ...payload,
        ...errorMeta,
      })
    );
  },
};
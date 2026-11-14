import express, { type ErrorRequestHandler } from "express";
import type { PrismaClient } from "../shared/generated/prisma/client.js";
import { logger } from "../shared/logger.js";
import { ApiError, errorBody } from "./errors.js";
import { observeMetrics } from "./metrics.js";
import { catalogRouter } from "./routes/catalog.js";
import { healthRouter } from "./routes/health.js";
import { metricsRouter } from "./routes/metrics.js";
import { ordersRouter } from "./routes/orders.js";

export type Database = Pick<
  PrismaClient,
  "product" | "order" | "$queryRaw" | "$transaction"
>;
export interface AppDependencies {
  database: Database;
}

const BODY_LIMIT = "16kb";

interface BodyParserError {
  type: string;
}

function isBodyParserError(error: unknown): error is BodyParserError {
  return (
    typeof error === "object" &&
    error !== null &&
    "type" in error &&
    typeof (error as { type: unknown }).type === "string"
  );
}

const errorHandler: ErrorRequestHandler = (error, _request, response, next) => {
  if (response.headersSent) {
    next(error);
    return;
  }

  if (error instanceof ApiError) {
    response.status(error.status).json(errorBody(error.code, error.message));
    return;
  }

  if (isBodyParserError(error)) {
    if (error.type === "entity.parse.failed") {
      response
        .status(400)
        .json(errorBody("INVALID_JSON", "The request body is not valid JSON"));
      return;
    }

    if (error.type === "entity.too.large") {
      response
        .status(413)
        .json(
          errorBody("PAYLOAD_TOO_LARGE", "The request body exceeds 16 KiB"),
        );
      return;
    }

    response
      .status(400)
      .json(errorBody("INVALID_REQUEST", "The request body is invalid"));
    return;
  }

  const name = error instanceof Error ? error.name : "UnknownError";
  logger.error({ event: "unhandled_error", name }, error);

  response
    .status(500)
    .json(errorBody("INTERNAL_ERROR", "An unexpected error occurred"));
};

export function createApp({ database }: AppDependencies) {
  const app = express();

  app.disable("x-powered-by");
  app.use(express.json({ limit: BODY_LIMIT }));

  // Expose metrics BEFORE the observer to avoid recursive scraping pollution
  app.use("/metrics", metricsRouter);
  
  // Start the observation timer for all subsequent business routes
  app.use(observeMetrics);

  app.use(healthRouter(database));
  app.use(catalogRouter(database));
  app.use(ordersRouter(database));

  app.use((_request, response) => {
    response
      .status(404)
      .json(errorBody("NOT_FOUND", "The requested route does not exist"));
  });

  app.use(errorHandler);

  return app;
}
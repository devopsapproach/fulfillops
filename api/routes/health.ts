import { Router } from "express";
import type { Database } from "../app.js";

const READINESS_TIMEOUT_MS = 2000;

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("timeout")), ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error: unknown) => {
        clearTimeout(timer);
        reject(error instanceof Error ? error : new Error("query failed"));
      },
    );
  });
}

export function healthRouter(database: Database) {
  const router = Router();

  router.get("/health/live", (_request, response) => {
    response.status(200).json({ status: "ok" });
  });

  router.get("/health/ready", async (_request, response) => {
    try {
      const rows = await withTimeout(
        database.$queryRaw<{ ready: boolean }[]>`
          SELECT to_regclass('public.products') IS NOT NULL
             AND to_regclass('public.orders') IS NOT NULL
             AND to_regclass('public.jobs') IS NOT NULL AS ready
        `,
        READINESS_TIMEOUT_MS,
      );

      if (rows[0]?.ready === true) {
        response.status(200).json({ status: "ready" });
        return;
      }

      response.status(503).json({ status: "not_ready" });
    } catch {
      response.status(503).json({ status: "not_ready" });
    }
  });

  return router;
}

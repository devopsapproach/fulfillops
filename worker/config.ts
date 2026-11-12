import { z } from "zod";

const workerConfigSchema = z.object({
  WORKER_POLL_INTERVAL_MS: z.coerce.number().int().positive().default(500),
  WORKER_LEASE_MS: z.coerce.number().int().positive().default(10000),
  WORKER_MAX_ATTEMPTS: z.coerce.number().int().positive().default(3),
  WORKER_RETRY_BASE_MS: z.coerce.number().int().positive().default(1000),
});

export function parseWorkerConfig(environment: NodeJS.ProcessEnv) {
  const result = workerConfigSchema.safeParse(environment);

  if (!result.success) {
    const fields = result.error.issues
      .map((issue) => issue.path.join("."))
      .join(", ");

    throw new Error(`Invalid worker configuration fields: ${fields}`);
  }

  return {
    pollIntervalMs: result.data.WORKER_POLL_INTERVAL_MS,
    leaseMs: result.data.WORKER_LEASE_MS,
    maxAttempts: result.data.WORKER_MAX_ATTEMPTS,
    retryBaseMs: result.data.WORKER_RETRY_BASE_MS,
  };
}

export type WorkerConfig = ReturnType<typeof parseWorkerConfig>;

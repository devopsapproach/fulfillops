import "dotenv/config";
import { setTimeout as sleep } from "node:timers/promises";
import { database } from "../shared/database.js";
import { parseWorkerConfig } from "./config.js";
import { claimNextJob, recoverExpiredJob } from "./job-repository.js";
import { processJob } from "./process-job.js";

const config = parseWorkerConfig(process.env);

let stopping = false;
let shutdownTimer: ReturnType<typeof setTimeout> | undefined;

function requestShutdown(signal: string) {
  if (stopping) {
    return;
  }

  stopping = true;

  console.info(
    JSON.stringify({
      event: "worker_shutdown_requested",
      signal,
    }),
  );

  shutdownTimer = setTimeout(() => {
    console.error(
      JSON.stringify({
        event: "worker_shutdown_timeout",
      }),
    );

    process.exit(1);
  }, 10000);
}

process.on("SIGINT", requestShutdown);
process.on("SIGTERM", requestShutdown);

async function runWorker() {
  console.info(
    JSON.stringify({
      event: "worker_started",
      pollIntervalMs: config.pollIntervalMs,
      leaseMs: config.leaseMs,
    }),
  );

  try {
    while (!stopping) {
      try {
        await recoverExpiredJob(database, config.retryBaseMs);

        if (stopping) {
          break;
        }

        const job = await claimNextJob(database, config.leaseMs);

        if (!job) {
          if (!stopping) {
            await sleep(config.pollIntervalMs);
          }

          continue;
        }

        console.info(
          JSON.stringify({
            event: "job_claimed",
            jobId: job.id,
            orderId: job.orderId,
            attempts: job.attempts,
          }),
        );

        await processJob(database, job, config.retryBaseMs);
      } catch {
        console.error(
          JSON.stringify({
            event: "worker_operation_failed",
          }),
        );

        if (!stopping) {
          await sleep(Math.max(config.pollIntervalMs, 1000));
        }
      }
    }
  } finally {
    await database.$disconnect();
  }
}

runWorker()
  .catch(() => {
    console.error(
      JSON.stringify({
        event: "worker_stopped_with_error",
      }),
    );

    process.exitCode = 1;
  })
  .finally(() => {
    if (shutdownTimer) {
      clearTimeout(shutdownTimer);
    }

    process.removeListener("SIGINT", requestShutdown);
    process.removeListener("SIGTERM", requestShutdown);
  });

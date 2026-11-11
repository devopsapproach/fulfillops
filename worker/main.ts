import { apiConfig } from "../shared/config.js";

const pollIntervalMs = Number(process.env.WORKER_POLL_INTERVAL_MS ?? 500);

console.info(
  `Worker process started (pollIntervalMs=${pollIntervalMs}, envPort=${apiConfig.PORT})`,
);

const timer = setInterval(() => {
  // Placeholder heartbeat until chimaera attaches job claiming in Checkpoint 2
}, pollIntervalMs);

function shutdown(signal: string) {
  console.info(`Worker received ${signal}, shutting down gracefully`);
  clearInterval(timer);
  process.exit(0);
}

process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));

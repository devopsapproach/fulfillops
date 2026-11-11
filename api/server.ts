import { createApp } from "./app.js";
import { apiConfig } from "../shared/config.js";
import { database } from "../shared/database.js";

const app = createApp({ database });

const server = app.listen(apiConfig.PORT, () => {
  console.info(`API listening on port ${apiConfig.PORT}`);
});

function shutdown(signal: string) {
  console.info(`API received ${signal}, shutting down gracefully`);
  server.close(() => {
    void database.$disconnect().finally(() => process.exit(0));
  });
}

process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));

import { Router } from "express";
import { metricsRegistry } from "../metrics.js";

const router = Router();

router.get("/", (_req, res) => {
  res.set("Content-Type", "text/plain; version=0.0.4; charset=utf-8");
  res.send(metricsRegistry.getMetricsAsText());
});

export { router as metricsRouter };

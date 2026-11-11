import { Router } from "express";
import type { Database } from "../app.js";
import { ApiError } from "../errors.js";

export function catalogRouter(database: Database) {
  const router = Router();

  router.get("/api/v1/catalog", async (_request, response) => {
    const products = await database.product.findMany({
      select: { sku: true, unitPriceCents: true },
      orderBy: { sku: "asc" },
    });

    response.status(200).json({
      products: products.map((product) => ({
        sku: product.sku,
        unit_price_cents: product.unitPriceCents,
      })),
    });
  });

  router.get("/api/v1/inventory/:sku", async (request, response) => {
    const product = await database.product.findUnique({
      where: { sku: request.params.sku },
      select: { sku: true, available: true },
    });

    if (!product) {
      throw new ApiError(404, "SKU_NOT_FOUND", "The SKU does not exist");
    }

    response
      .status(200)
      .json({ sku: product.sku, available: product.available });
  });

  return router;
}

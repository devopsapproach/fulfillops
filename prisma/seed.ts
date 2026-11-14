import "dotenv/config";
import { database } from "../shared/database.js";

async function seed() {
  const dbUrl = process.env.DATABASE_URL || "";

  if (process.env.NODE_ENV === "production") {
    throw new Error(
      "ABORTED: Seeding is strictly prohibited when NODE_ENV=production.",
    );
  }

  if (!dbUrl.includes("localhost") && !dbUrl.includes("127.0.0.1")) {
    throw new Error(
      "ABORTED: Target DATABASE_URL does not point to a local host.",
    );
  }

  try {
    const products = [
      { sku: "KIT-100", unitPriceCents: 1299, available: 7 },
      { sku: "PART-200", unitPriceCents: 599, available: 12 },
      { sku: "PACK-300", unitPriceCents: 249, available: 5 },
    ];

    await database.$transaction(
      products.map((p) =>
        database.product.upsert({
          where: { sku: p.sku },
          update: { unitPriceCents: p.unitPriceCents, available: p.available },
          create: p,
        }),
      ),
    );

    console.info("Catalog seed complete. Deterministic values enforced.");
  } finally {
    await database.$disconnect();
  }
}

seed().catch((error) => {
  console.error(
    error instanceof Error ? error.message : "Catalog seeding failed.",
  );
  process.exitCode = 1;
});

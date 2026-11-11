import { database } from "../shared/database.js";

async function seed() {
  try {
    const result = await database.product.createMany({
      data: [
        {
          sku: "KIT-100",
          unitPriceCents: 1299,
          available: 7,
        },
        {
          sku: "PART-200",
          unitPriceCents: 599,
          available: 12,
        },
        {
          sku: "PACK-300",
          unitPriceCents: 249,
          available: 5,
        },
      ],
      skipDuplicates: true,
    });

    console.info(`Catalog seed complete. Created ${result.count} products.`);
  } finally {
    await database.$disconnect();
  }
}

seed().catch(() => {
  console.error(
    "Catalog seeding failed. Check database connectivity, credentials, and migrations.",
  );
  process.exitCode = 1;
});

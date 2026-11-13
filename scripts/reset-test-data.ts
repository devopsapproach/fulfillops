import "dotenv/config";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../shared/generated/prisma/client.js";

async function resetTestData() {
  const connectionString = process.env.TEST_DATABASE_URL || "";

  if (process.env.NODE_ENV === "production") {
    throw new Error(
      "ABORTED: Resetting data is strictly prohibited in production.",
    );
  }

  try {
    const url = new URL(connectionString);
    if (url.pathname !== "/fulfillops_test") {
      throw new Error(
        "ABORTED: TEST_DATABASE_URL must target the /fulfillops_test database.",
      );
    }
  } catch {
    throw new Error("ABORTED: Invalid TEST_DATABASE_URL format.");
  }

  const database = new PrismaClient({
    adapter: new PrismaPg({ connectionString }),
  });

  try {
    await database.$transaction([
      database.job.deleteMany(),
      database.fulfillmentReceipt.deleteMany(),
      database.orderItem.deleteMany(),
      database.order.deleteMany(),
      database.product.deleteMany(),
    ]);

    await database.product.createMany({
      data: [
        { sku: "KIT-100", unitPriceCents: 1299, available: 7 },
        { sku: "PART-200", unitPriceCents: 599, available: 12 },
        { sku: "PACK-300", unitPriceCents: 249, available: 5 },
      ],
    });

    console.info(
      "Test database reset complete. All transactional data purged.",
    );
  } finally {
    await database.$disconnect();
  }
}

resetTestData().catch((error) => {
  console.error(
    error instanceof Error ? error.message : "Test data reset failed.",
  );
  process.exitCode = 1;
});

import type { Database } from "../../api/app.js";

interface FakeProduct {
  sku: string;
  unitPriceCents: number;
  available: number;
}

interface FakeOptions {
  products?: FakeProduct[];
  ready?: boolean | "error";
}

export function fakeDatabase({
  products = [],
  ready = true,
}: FakeOptions = {}): Database {
  const fake = {
    $queryRaw: () =>
      ready === "error"
        ? Promise.reject(new Error("connection refused"))
        : Promise.resolve([{ ready }]),
    product: {
      findMany: () =>
        Promise.resolve(
          [...products].sort((a, b) => a.sku.localeCompare(b.sku)),
        ),
      findUnique: ({ where }: { where: { sku: string } }) =>
        Promise.resolve(products.find((p) => p.sku === where.sku) ?? null),
    },
  };

  return fake as unknown as Database;
}

export const seededProducts: FakeProduct[] = [
  { sku: "KIT-100", unitPriceCents: 1299, available: 7 },
  { sku: "PART-200", unitPriceCents: 599, available: 12 },
  { sku: "PACK-300", unitPriceCents: 249, available: 5 },
];

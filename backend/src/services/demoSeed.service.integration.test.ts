import assert from "node:assert/strict";
import { test } from "node:test";
import { PrismaClient } from "@prisma/client";
import { INVENTORY_STANDARDS } from "../config/inventoryStandards";
import { seedDemoData } from "./demoSeed.service";

const testDatabaseUrl = process.env.DEMO_SEED_COPY_TEST_DATABASE_URL;
const testDirectUrl = process.env.DEMO_SEED_COPY_TEST_DIRECT_URL;
const testConfigured = Boolean(testDatabaseUrl || testDirectUrl);

function assertIsolatedDatabaseUrl(value: string) {
  const url = new URL(value);
  assert.equal(url.protocol, "postgresql:");
  assert.equal(url.hostname, "127.0.0.1");
  assert.equal(url.port, "55432");
  assert.equal(decodeURIComponent(url.pathname.replace(/^\/+/, "")), "katana_sushi_dev");
}

test("demo seed writes integer base-unit inventory and recipes to the isolated restored copy", {
  skip: !testConfigured
}, async () => {
  assert.ok(testDatabaseUrl, "DEMO_SEED_COPY_TEST_DATABASE_URL is required.");
  assert.ok(testDirectUrl, "DEMO_SEED_COPY_TEST_DIRECT_URL is required.");
  assertIsolatedDatabaseUrl(testDatabaseUrl);
  assertIsolatedDatabaseUrl(testDirectUrl);

  process.env.DATABASE_URL = testDatabaseUrl;
  process.env.DIRECT_URL = testDirectUrl;

  const prisma = new PrismaClient({ datasources: { db: { url: testDatabaseUrl } } });
  try {
    const [connectedDatabase] = await prisma.$queryRaw<Array<{ host: string; port: number; database: string }>>`
      SELECT host(inet_server_addr()) AS host, inet_server_port() AS port, current_database() AS database
    `;
    console.log(
      `Connected seed-test database: host=${connectedDatabase.host}, port=${connectedDatabase.port}, database=${connectedDatabase.database}`
    );
    assert.deepEqual(connectedDatabase, {
      host: "127.0.0.1",
      port: 55432,
      database: "katana_sushi_dev"
    });

    const conversionRuleIdsBefore = (await prisma.conversionRule.findMany({
      orderBy: { id: "asc" },
      select: { id: true }
    })).map(({ id }) => id);
    assert.equal(conversionRuleIdsBefore.length, 3);

    await seedDemoData(prisma);

    const materials = await prisma.rawMaterial.findMany({
      select: {
        name: true,
        unit: true,
        current_stock: true,
        reorder_level: true,
        cost_per_unit: true
      }
    });
    const materialByName = new Map(materials.map((material) => [material.name, material]));
    const expectedMaterials = [
      ["Rice", "g", 25000n, 5000n, 0.085],
      ["Salmon", "g", 8000n, 2000n, 0.95],
      ["Tuna", "g", 7000n, 2000n, 0.82],
      ["Cucumber", "g", 6000n, 2000n, 0.09],
      ["Mango", "g", 8000n, 2000n, 0.12],
      ["Ebiko", "g", 4000n, 1000n, 0.72],
      ["Cream cheese", "g", 4000n, 1000n, 0.43],
      ["Tempura flakes", "g", 6000n, 2000n, 0.18],
      ["Unagi", "g", 3000n, 1000n, 1.1],
      ["Shrimp", "g", 7000n, 2000n, 0.52],
      ["Avocado", "g", 6000n, 1500n, 0.36666667],
      ["Spring onion", "g", 2000n, 500n, 0.16],
      ["Sesame seeds", "g", 2000n, 500n, 0.28],
      ["Spicy mayo", "ml", 5000n, 1000n, 0.24],
      ["Teriyaki sauce", "ml", 5000n, 1000n, 0.22],
      ["Sriracha", "ml", 4000n, 1000n, 0.26],
      ["Bonito flakes", "g", 2000n, 500n, 0.85],
      ["Lettuce", "g", 4000n, 1000n, 0.13],
      ["Pineapple tidbits", "g", 4000n, 1000n, 0.14],
      ["Nachos", "g", 3000n, 1000n, 0.19],
      ["Chili", "g", 2000n, 500n, 0.18],
      ["Tuna sashimi block", "g", 6000n, 2000n, 0.9],
      ["Salmon sashimi block", "g", 6000n, 2000n, 1.05],
      ["Chicken", "g", 6000n, 2000n, 0.24],
      ["Aonori", "g", 1000n, 250n, 0.68]
    ] as const;

    for (const [name, unit, stock, reorderLevel, costPerUnit] of expectedMaterials) {
      const material = materialByName.get(name);
      assert.ok(material, `Missing seeded material ${name}.`);
      assert.equal(material.unit, unit, `${name} unit`);
      assert.equal(material.current_stock, stock, `${name} stock`);
      assert.equal(material.reorder_level, reorderLevel, `${name} reorder level`);
      assert.equal(Number(material.cost_per_unit), costPerUnit, `${name} unit cost`);
    }
    assert.ok(materials.every(({ unit }) => unit !== "kg" && unit !== "L"));

    const recipeIngredients = await prisma.recipeIngredient.findMany({
      include: {
        raw_material: { select: { name: true } },
        recipe: { select: { selling_product: { select: { name: true } } } }
      }
    });
    const ingredientByProductAndMaterial = new Map(recipeIngredients.map((ingredient) => [
      `${ingredient.recipe.selling_product.name}::${ingredient.raw_material.name}`,
      ingredient
    ]));
    const expectedIngredients = [
      ["California Maki", "Cucumber", 30n, "g"],
      ["Tuna Mayo Roll", "Spicy mayo", 10n, "ml"],
      ["Crunchy Roll", "Tempura flakes", 20n, "g"],
      ["Tori Teriyaki Roll", "Teriyaki sauce", 10n, "ml"],
      ["Spicy Tuna Roll", "Aonori", BigInt(INVENTORY_STANDARDS.ownerConfirmedAonoriGramsPerServing), "g"],
      ["Mango Hoso", "Crabstick", 3n, "piece"],
      ["Baked Sushi California Medium", "Rice", 300n, "g"],
      ["Baked Sushi California Medium", "Nori", 2n, "sheet"],
      ["Baked Sushi California Medium", "Crabstick", 3n, "piece"],
      ["Baked Sushi California Medium", "Ebiko", 30n, "g"],
      ["Large Classic Platter (71pcs)", "Crabstick", 0n, "piece"],
      ["Medium Classic Platter (40pcs)", "Crabstick", 0n, "piece"]
    ] as const;

    for (const [productName, materialName, quantity, unit] of expectedIngredients) {
      const ingredient = ingredientByProductAndMaterial.get(`${productName}::${materialName}`);
      assert.ok(ingredient, `Missing ${materialName} recipe line for ${productName}.`);
      assert.equal(ingredient.quantity_per_yield, quantity, `${productName} ${materialName} quantity`);
      assert.equal(ingredient.unit, unit, `${productName} ${materialName} unit`);
    }
    assert.ok(recipeIngredients.every(({ unit }) => !["kg", "L", "pieces", "sheets"].includes(unit)));

    for (const name of ["Large Classic Platter (71pcs)", "Medium Classic Platter (40pcs)"]) {
      const product = await prisma.sellingProduct.findFirst({
        where: { name },
        select: { is_available: true }
      });
      assert.equal(product?.is_available, false, `${name} remains unavailable`);
    }

    const conversionRuleIdsAfter = (await prisma.conversionRule.findMany({
      orderBy: { id: "asc" },
      select: { id: true }
    })).map(({ id }) => id);
    assert.deepEqual(conversionRuleIdsAfter, conversionRuleIdsBefore);
  } finally {
    await prisma.$disconnect();
  }
});

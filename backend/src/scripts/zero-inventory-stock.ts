import fs from "node:fs";
import path from "node:path";
import dotenv from "dotenv";
import { PrismaClient } from "@prisma/client";

dotenv.config({ path: path.resolve(__dirname, "..", "..", ".env") });

const prisma = new PrismaClient();

async function main() {
  const execute = process.argv.includes("--execute");
  const [materials, batches] = await Promise.all([
    prisma.rawMaterial.findMany({
      orderBy: { name: "asc" },
      select: {
        id: true,
        name: true,
        unit: true,
        current_stock: true,
        reorder_level: true,
        cost_per_unit: true
      }
    }),
    prisma.materialBatch.findMany({
      orderBy: [{ raw_material_id: "asc" }, { received_at: "asc" }],
      select: {
        id: true,
        raw_material_id: true,
        batch_number: true,
        quantity: true,
        remaining_quantity: true,
        is_disposed: true
      }
    })
  ]);

  const nonZeroMaterials = materials.filter((material) => Number(material.current_stock) !== 0);
  const nonZeroBatches = batches.filter((batch) => Number(batch.quantity) !== 0 || Number(batch.remaining_quantity) !== 0 || !batch.is_disposed);

  if (!execute) {
    console.log(JSON.stringify({
      mode: "DRY_RUN",
      materials_to_zero: nonZeroMaterials.length,
      batches_to_zero_or_close: nonZeroBatches.length,
      preserved: {
        material_definitions: materials.length,
        material_costs_and_reorder_levels: true,
        users_products_recipes: true
      },
      note: "Run with --execute to back up inventory quantities and make on-hand stock zero."
    }, null, 2));
    return;
  }

  const backupDir = path.resolve(__dirname, "..", "..", "backups");
  fs.mkdirSync(backupDir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const backupPath = path.join(backupDir, `zero-inventory-stock-${stamp}.json`);

  fs.writeFileSync(backupPath, JSON.stringify({
    created_at: new Date().toISOString(),
    materials,
    batches
  }, null, 2));

  const result = await prisma.$transaction(async (tx) => {
    const updatedMaterials = await tx.rawMaterial.updateMany({
      where: { current_stock: { not: 0 } },
      data: { current_stock: 0 }
    });
    const updatedBatches = await tx.materialBatch.updateMany({
      data: {
        quantity: 0,
        remaining_quantity: 0,
        is_disposed: true
      }
    });

    return {
      materials_zeroed: updatedMaterials.count,
      batches_zeroed_or_closed: updatedBatches.count
    };
  }, { maxWait: 15000, timeout: 120000 });

  const remainingNonZeroMaterials = await prisma.rawMaterial.count({ where: { current_stock: { not: 0 } } });
  const remainingOpenStockBatches = await prisma.materialBatch.count({
    where: {
      OR: [
        { quantity: { not: 0 } },
        { remaining_quantity: { not: 0 } },
        { is_disposed: false }
      ]
    }
  });

  console.log(JSON.stringify({
    mode: "ZERO_STOCK_COMPLETE",
    backup_path: backupPath,
    ...result,
    verification: {
      remaining_nonzero_materials: remainingNonZeroMaterials,
      remaining_open_stock_batches: remainingOpenStockBatches
    }
  }, null, 2));
}

main()
  .catch((error: unknown) => {
    console.error("Zero-stock reset failed:", error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });

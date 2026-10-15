import path from "path";
import dotenv from "dotenv";
import { PrismaClient } from "@prisma/client";
import { canConvertInventoryUnits, isTerminalReservationStatus } from "../services/inventory.service";

if (process.env.NODE_ENV !== "production") {
  dotenv.config({ path: path.resolve(__dirname, "..", "..", ".env") });
}

const prisma = new PrismaClient();

async function main() {
  const [materials, products, conversionRules] = await Promise.all([
    prisma.rawMaterial.findMany({
      where: { is_deleted: false },
      orderBy: { name: "asc" },
      include: {
        batches: { select: { id: true, batch_number: true, remaining_quantity: true } },
        catering_ingredient_locks: {
          where: { is_released: false },
          include: {
            catering_reservation: {
              select: { id: true, reservation_id: true, status: true, event_date: true }
            }
          }
        }
      }
    }),
    prisma.sellingProduct.findMany({
      where: { is_deleted: false },
      orderBy: { name: "asc" },
      include: {
        recipes: {
          include: {
            recipe_ingredients: {
              include: { raw_material: { select: { id: true, name: true, unit: true } } }
            }
          }
        }
      }
    }),
    prisma.conversionRule.findMany({
      orderBy: { name: "asc" },
      select: {
        id: true,
        name: true,
        from_quantity: true,
        from_unit: true,
        to_quantity: true,
        to_unit: true
      }
    })
  ]);

  const materialMismatches = materials.flatMap((material) => {
    const onHand = Number(material.current_stock);
    const batchQuantity = material.batches.reduce(
      (total, batch) => total + Number(batch.remaining_quantity),
      0
    );
    const activeLocks = material.catering_ingredient_locks.filter(
      (lock) => !isTerminalReservationStatus(lock.catering_reservation.status)
    );
    const reserved = activeLocks.reduce((total, lock) => total + Number(lock.reserved_quantity), 0);
    const available = onHand - reserved;
    const reasons: string[] = [];

    if (Math.abs(onHand - batchQuantity) > 0.0005) reasons.push("on_hand_differs_from_batch_total");
    if (available < -0.0005) reasons.push("negative_available");
    if (["piece", "pieces", "pc", "pcs", "sheet", "sheets"].includes(material.unit.trim().toLowerCase())
      && !Number.isInteger(onHand)) {
      reasons.push("fractional_countable_stock");
    }

    if (reasons.length === 0) return [];

    return [{
      material_id: material.id,
      material: material.name,
      unit: material.unit,
      on_hand: onHand,
      batch_total: Number(batchQuantity.toFixed(3)),
      batch_difference: Number((onHand - batchQuantity).toFixed(3)),
      active_reserved: Number(reserved.toFixed(3)),
      available: Number(available.toFixed(3)),
      reasons,
      active_booking_holds: activeLocks.map((lock) => ({
        booking_reference: lock.catering_reservation.reservation_id ?? lock.catering_reservation.id,
        status: lock.catering_reservation.status,
        quantity: Number(lock.reserved_quantity),
        unit: lock.unit
      }))
    }];
  });

  const recipeUnitMismatches = products.flatMap((product) =>
    product.recipes.flatMap((recipe) =>
      recipe.recipe_ingredients.flatMap((ingredient) =>
        canConvertInventoryUnits(ingredient.unit, ingredient.raw_material.unit)
          ? []
          : [{
              product: product.name,
              material: ingredient.raw_material.name,
              recipe_unit: ingredient.unit,
              material_base_unit: ingredient.raw_material.unit
            }]
      )
    )
  );
  const productsWithoutRecipes = products
    .filter((product) => product.recipes.length === 0)
    .map((product) => ({ id: product.id, name: product.name }));

  console.log(JSON.stringify({
    report_type: "read_only_inventory_reconciliation",
    generated_at: new Date().toISOString(),
    applied_changes: false,
    materials_checked: materials.length,
    products_checked: products.length,
    material_mismatches: materialMismatches,
    conversion_rules: conversionRules,
    recipe_unit_mismatches: recipeUnitMismatches,
    products_without_recipes: productsWithoutRecipes
  }, null, 2));
}

main()
  .catch((error: unknown) => {
    console.error("Inventory reconciliation report failed:", error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });

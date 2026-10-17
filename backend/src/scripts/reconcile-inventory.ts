import path from "path";
import dotenv from "dotenv";
import { PrismaClient } from "@prisma/client";
import { inventoryUnitsMatch, isTerminalReservationStatus } from "../services/inventory.service";

if (process.env.NODE_ENV !== "production") {
  dotenv.config({ path: path.resolve(__dirname, "..", "..", ".env") });
}

const prisma = new PrismaClient();

async function main() {
  const [materials, products] = await Promise.all([
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

    if (onHand !== batchQuantity) reasons.push("on_hand_differs_from_batch_total");
    if (available < 0) reasons.push("negative_available");
    if (!Number.isSafeInteger(onHand)) reasons.push("fractional_stock");

    if (reasons.length === 0) return [];

    return [{
      material_id: material.id,
      material: material.name,
      unit: material.unit,
      on_hand: onHand,
      batch_total: batchQuantity,
      batch_difference: onHand - batchQuantity,
      active_reserved: reserved,
      available,
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
        inventoryUnitsMatch(ingredient.unit, ingredient.raw_material.unit)
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

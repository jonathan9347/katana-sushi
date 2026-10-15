import { Prisma } from "@prisma/client";

export type InventoryMovementAction =
  | "Received"
  | "Reserved"
  | "Released"
  | "Released back"
  | "Used"
  | "Wasted"
  | "Adjusted";

export type InventorySourceType = "dine-in" | "catering" | "takeout" | "POS" | "unlimited" | "inventory";

type InventoryTx = Prisma.TransactionClient;

const terminalCateringStatuses = new Set([
  "cancelled",
  "canceled",
  "completed",
  "declined",
  "expired",
  "no-show",
  "no_show",
  "rejected"
]);

const inventoryHoldingStatuses = new Set([
  "approved",
  "confirmed",
  "seated",
  "preparing",
  "in_progress",
  "pending_final_payment"
]);

const countableUnits = new Set(["piece", "pieces", "pc", "pcs", "sheet", "sheets"]);

export function normalizeInventoryUnit(unit: string) {
  const normalized = unit.trim().toLowerCase();

  if (["gram", "grams"].includes(normalized)) return "g";
  if (["kilogram", "kilograms"].includes(normalized)) return "kg";
  if (["milliliter", "milliliters", "millilitre", "millilitres"].includes(normalized)) return "ml";
  if (["l", "liter", "liters", "litre", "litres"].includes(normalized)) return "liters";
  if (["piece", "pieces", "pc", "pcs"].includes(normalized)) return "pieces";
  if (["sheet", "sheets"].includes(normalized)) return "sheets";
  return normalized;
}

export function canConvertInventoryUnits(fromUnit: string, toUnit: string) {
  const from = normalizeInventoryUnit(fromUnit);
  const to = normalizeInventoryUnit(toUnit);

  return from === to || (from === "g" && to === "kg") || (from === "kg" && to === "g")
    || (from === "ml" && to === "liters") || (from === "liters" && to === "ml");
}

export function convertInventoryQuantity(quantity: number, fromUnit: string, toUnit: string) {
  const from = normalizeInventoryUnit(fromUnit);
  const to = normalizeInventoryUnit(toUnit);

  if (from === to) return quantity;
  if (from === "g" && to === "kg") return quantity / 1000;
  if (from === "kg" && to === "g") return quantity * 1000;
  if (from === "ml" && to === "liters") return quantity / 1000;
  if (from === "liters" && to === "ml") return quantity * 1000;

  throw new InventoryError(
    `Cannot convert recipe quantity from ${fromUnit} to the material's base unit ${toUnit}.`,
    "UNIT_MISMATCH",
    400
  );
}

export function isTerminalReservationStatus(status?: string | null) {
  return terminalCateringStatuses.has(status?.trim().toLowerCase() ?? "");
}

export class InventoryError extends Error {
  readonly statusCode: number;
  readonly code: string;

  constructor(message: string, code: string, statusCode = 400) {
    super(message);
    this.name = "InventoryError";
    this.code = code;
    this.statusCode = statusCode;
  }
}

export function calculateAvailableQuantity(onHand: number, reserved: number) {
  if (!Number.isFinite(onHand) || !Number.isFinite(reserved) || onHand < 0 || reserved < 0) {
    throw new InventoryError("Stock quantities must be finite and non-negative.", "INVALID_STOCK");
  }

  return onHand - reserved;
}

export function validateInventoryQuantity(quantity: number, unit: string) {
  if (!Number.isFinite(quantity) || quantity <= 0) {
    throw new InventoryError("Quantity must be greater than zero.", "INVALID_QUANTITY");
  }

  if (countableUnits.has(unit.trim().toLowerCase()) && !Number.isInteger(quantity)) {
    throw new InventoryError(`${unit} quantities must be whole numbers.`, "FRACTIONAL_COUNTABLE_QUANTITY");
  }
}

export function validateInventoryCount(quantity: number, unit: string) {
  if (!Number.isFinite(quantity) || quantity < 0) {
    throw new InventoryError("Physical count must be zero or greater.", "INVALID_STOCK_COUNT");
  }

  if (countableUnits.has(unit.trim().toLowerCase()) && !Number.isInteger(quantity)) {
    throw new InventoryError(`${unit} counts must be whole numbers.`, "FRACTIONAL_COUNTABLE_QUANTITY");
  }
}

export function assertEnoughAvailable(
  materialName: string,
  unit: string,
  requested: number,
  available: number
) {
  const shortage = requested - available;

  if (shortage > 0) {
    const roundedShortage = Number(shortage.toFixed(3));
    throw new InventoryError(
      `Not enough ${materialName}. ${roundedShortage} ${unit} short. Some stock is reserved for other bookings.`,
      "INSUFFICIENT_AVAILABLE_STOCK",
      409
    );
  }
}

export async function lockMaterialForUpdate(tx: InventoryTx, materialId: string) {
  await tx.$queryRaw`SELECT "id" FROM "raw_materials" WHERE "id" = ${materialId} FOR UPDATE`;
}

export async function getActiveCateringReservationQuantity(tx: InventoryTx, materialId: string) {
  const quantities = await getActiveCateringReservationQuantities(tx, [materialId]);
  return quantities.get(materialId) ?? 0;
}

export async function getActiveCateringReservationQuantities(
  tx: InventoryTx,
  materialIds: string[]
) {
  const [cateringLocks, dineInLocks, takeoutLocks, posDiningLocks] = await Promise.all([
    tx.cateringIngredientLock.findMany({
      where: { raw_material_id: { in: materialIds }, is_released: false },
      select: {
        raw_material_id: true,
        reserved_quantity: true,
        catering_reservation: { select: { status: true, event_date: true } }
      }
    }),
    tx.reservationIngredientLock.findMany({
      where: { raw_material_id: { in: materialIds }, is_released: false },
      select: {
        raw_material_id: true,
        reserved_quantity: true,
        reservation: { select: { status: true, date: true } }
      }
    }),
    tx.takeoutIngredientLock.findMany({
      where: {
        raw_material_id: { in: materialIds },
        is_released: false,
        order: {
          status: { in: ["pending_payment", "payment_failed", "pending_approval", "confirmed", "preparing", "ready"] },
          OR: [
            { payment_plan: "pay_at_pickup" },
            { payment_status: "paid" },
            { payment_expires_at: { gt: new Date() } }
          ]
        }
      },
      select: {
        raw_material_id: true,
        reserved_quantity: true
      }
    }),
    tx.dineInIngredientLock.findMany({
      where: {
        raw_material_id: { in: materialIds },
        is_released: false,
        order: { status: { in: ["reserved", "prepared", "ready"] } }
      },
      select: {
        raw_material_id: true,
        reserved_quantity: true
      }
    })
  ]);
  const quantities = new Map<string, number>();

  for (const lock of cateringLocks) {
    const reservation = lock.catering_reservation;
    if (!isReservationInventoryHoldActive(reservation.status, reservation.event_date)) {
      continue;
    }

    quantities.set(
      lock.raw_material_id,
      (quantities.get(lock.raw_material_id) ?? 0) + Number(lock.reserved_quantity)
    );
  }

  for (const lock of dineInLocks) {
    const reservation = lock.reservation;
    if (!isReservationInventoryHoldActive(reservation.status, reservation.date)) {
      continue;
    }

    quantities.set(
      lock.raw_material_id,
      (quantities.get(lock.raw_material_id) ?? 0) + Number(lock.reserved_quantity)
    );
  }

  for (const lock of takeoutLocks) {
    quantities.set(
      lock.raw_material_id,
      (quantities.get(lock.raw_material_id) ?? 0) + Number(lock.reserved_quantity)
    );
  }

  for (const lock of posDiningLocks) {
    quantities.set(
      lock.raw_material_id,
      (quantities.get(lock.raw_material_id) ?? 0) + Number(lock.reserved_quantity)
    );
  }

  return quantities;
}

function dateKeyInManila(date: Date) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Manila",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).format(date);
}

export function isReservationInventoryHoldActive(status?: string | null, date?: Date | null) {
  const normalizedStatus = status?.trim().toLowerCase() ?? "";
  const todayKey = dateKeyInManila(new Date());

  return !terminalCateringStatuses.has(normalizedStatus)
    && inventoryHoldingStatuses.has(normalizedStatus)
    && (!date || dateKeyInManila(date) >= todayKey);
}

export async function createInventoryMovement(
  tx: InventoryTx,
  input: {
    raw_material_id: string;
    batch_id?: string | null;
    source_type?: InventorySourceType | null;
    source_reference?: string | null;
    action: InventoryMovementAction;
    quantity: number;
    unit: string;
    quantity_before: number;
    quantity_after: number;
    reserved_before?: number;
    reserved_after?: number;
    actor_id?: string | null;
    note?: string | null;
  }
) {
  if (!Number.isFinite(input.quantity) || input.quantity <= 0) {
    throw new InventoryError("Movement quantity must be greater than zero.", "INVALID_QUANTITY");
  }

  return tx.inventoryMovement.create({
    data: {
      raw_material_id: input.raw_material_id,
      batch_id: input.batch_id ?? null,
      source_type: input.source_type ?? null,
      source_reference: input.source_reference ?? null,
      action: input.action,
      quantity: input.quantity,
      unit: input.unit,
      quantity_before: input.quantity_before,
      quantity_after: input.quantity_after,
      reserved_before: input.reserved_before ?? 0,
      reserved_after: input.reserved_after ?? 0,
      actor_id: input.actor_id ?? null,
      note: input.note ?? null
    }
  });
}

export async function assertBatchQuantitiesMatchOnHand(
  tx: InventoryTx,
  materialId: string,
  materialName: string,
  onHand: number
) {
  const batches = await tx.materialBatch.findMany({
    where: { raw_material_id: materialId },
    select: { remaining_quantity: true }
  });
  const batchTotal = batches.reduce((total, batch) => total + Number(batch.remaining_quantity), 0);

  if (Math.abs(batchTotal - onHand) > 0.0005) {
    throw new InventoryError(
      `${materialName} has ${onHand} on hand but ${Number(batchTotal.toFixed(3))} assigned to batches. Reconcile batches before changing stock.`,
      "BATCH_RECONCILIATION_REQUIRED",
      409
    );
  }
}

export async function recordReservationMovement(
  tx: InventoryTx,
  input: {
    raw_material_id: string;
    quantity: number;
    unit: string;
    source_type: "dine-in" | "catering" | "takeout";
    source_reference: string;
    actor_id?: string | null;
    action: "Reserved" | "Released" | "Released back";
    reserved_before: number;
    reserved_after: number;
    note?: string | null;
  }
) {
  const material = await tx.rawMaterial.findUnique({
    where: { id: input.raw_material_id },
    select: { current_stock: true, unit: true }
  });

  if (!material) {
    throw new InventoryError("Material not found.", "MATERIAL_NOT_FOUND", 404);
  }

  return createInventoryMovement(tx, {
    raw_material_id: input.raw_material_id,
    source_type: input.source_type,
    source_reference: input.source_reference,
    action: input.action,
    quantity: input.quantity,
    unit: material.unit || input.unit,
    quantity_before: Number(material.current_stock),
    quantity_after: Number(material.current_stock),
    reserved_before: input.reserved_before,
    reserved_after: input.reserved_after,
    actor_id: input.actor_id,
    note: input.note
  });
}

export async function getReservationIngredientNeeds(
  tx: InventoryTx,
  requestedItems: Array<{ product_id?: string; name: string; quantity: number }>
) {
  const products = await tx.sellingProduct.findMany({
    where: {
      is_deleted: false,
      OR: [
        { id: { in: requestedItems.map((item) => item.product_id).filter((id): id is string => Boolean(id)) } },
        { name: { in: requestedItems.map((item) => item.name) } }
      ]
    },
    include: {
      recipes: {
        include: {
          recipe_ingredients: {
            include: { raw_material: true }
          }
        }
      }
    }
  });
  const needs = new Map<string, { raw_material_id: string; material_name: string; quantity: number; unit: string }>();

  for (const item of requestedItems) {
    const product = products.find((entry) => entry.id === item.product_id) ??
      products.find((entry) => entry.name.trim().toLowerCase() === item.name.trim().toLowerCase());
    if (!product) {
      throw new InventoryError(`${item.name} is not available in the menu catalog.`, "PRODUCT_NOT_FOUND", 409);
    }
    const ingredients = product.recipes[0]?.recipe_ingredients ?? [];
    if (ingredients.length === 0) {
      throw new InventoryError(
        `${product.name} has no inventory recipe and cannot be reserved until its ingredients are linked.`,
        "RECIPE_MISSING",
        409
      );
    }

    for (const ingredient of ingredients) {
      const material = ingredient.raw_material;
      const quantity = convertInventoryQuantity(
        Number(ingredient.quantity_per_yield) * item.quantity,
        ingredient.unit,
        material.unit
      );
      const current = needs.get(material.id);
      needs.set(material.id, {
        raw_material_id: material.id,
        material_name: material.name,
        quantity: Number(((current?.quantity ?? 0) + quantity).toFixed(3)),
        unit: material.unit
      });
    }
  }

  return [...needs.values()].sort((left, right) => left.raw_material_id.localeCompare(right.raw_material_id));
}

export async function assertReservationIngredientAvailability(
  tx: InventoryTx,
  requestedItems: Array<{ product_id?: string; name: string; quantity: number }>
) {
  const needs = await getReservationIngredientNeeds(tx, requestedItems);

  for (const need of needs) {
    await lockMaterialForUpdate(tx, need.raw_material_id);
    const material = await tx.rawMaterial.findUnique({
      where: { id: need.raw_material_id },
      select: { id: true, name: true, unit: true, current_stock: true }
    });
    if (!material) {
      throw new InventoryError("A recipe refers to a material that no longer exists.", "MATERIAL_NOT_FOUND", 409);
    }

    validateInventoryQuantity(need.quantity, material.unit);
    const batches = await tx.materialBatch.findMany({
      where: { raw_material_id: material.id, is_disposed: false },
      select: { remaining_quantity: true, expiration_date: true }
    });
    const stockAvailable = batches.length > 0
      ? batches
          .filter((batch) => !batch.expiration_date || batch.expiration_date >= new Date())
          .reduce((total, batch) => total + Number(batch.remaining_quantity), 0)
      : Number(material.current_stock);
    const reserved = await getActiveCateringReservationQuantity(tx, material.id);
    const available = calculateAvailableQuantity(stockAvailable, reserved);
    assertEnoughAvailable(material.name, material.unit, need.quantity, available);
  }
}

export async function consumeMaterialStock(
  tx: InventoryTx,
  input: {
    raw_material_id: string;
    quantity: number;
    source_type: InventorySourceType;
    source_reference: string;
    actor_id?: string | null;
    note?: string | null;
    action?: "Released" | "Used" | "Wasted" | "Adjusted";
    checkReservations?: boolean;
    releaseReservedQuantity?: number;
    batch_id?: string;
  }
) {
  await lockMaterialForUpdate(tx, input.raw_material_id);

  const material = await tx.rawMaterial.findFirst({
    where: { id: input.raw_material_id, is_deleted: false }
  });

  if (!material) {
    throw new InventoryError("Material not found.", "MATERIAL_NOT_FOUND", 404);
  }

  validateInventoryQuantity(input.quantity, material.unit);

  const quantityBefore = Number(material.current_stock);
  const reservedBefore = input.checkReservations === false
    ? 0
    : await getActiveCateringReservationQuantity(tx, material.id);
  const reservationRelease = input.releaseReservedQuantity ?? 0;
  if (!Number.isFinite(reservationRelease) || reservationRelease < 0 || reservationRelease > reservedBefore) {
    throw new InventoryError("Invalid reservation quantity release.", "INVALID_RESERVATION_RELEASE", 409);
  }
  const reservedAfter = reservedBefore - reservationRelease;
  const available = calculateAvailableQuantity(quantityBefore, reservedAfter);

  if (available < 0) {
    throw new InventoryError(
      `${material.name} already has a stock shortage of ${Number((-available).toFixed(3))} ${material.unit}. Reconcile stock before using more.`,
      "NEGATIVE_AVAILABLE_STOCK",
      409
    );
  }

  assertEnoughAvailable(material.name, material.unit, input.quantity, available);

  const allBatches = await tx.materialBatch.findMany({
    where: {
      raw_material_id: material.id,
      is_disposed: false,
      remaining_quantity: { gt: 0 }
    },
    orderBy: [{ expiration_date: "asc" }, { received_at: "asc" }]
  });
  const batchTotal = allBatches.reduce((total, batch) => total + Number(batch.remaining_quantity), 0);

  if (Math.abs(batchTotal - quantityBefore) > 0.0005) {
    throw new InventoryError(
      `${material.name} has ${quantityBefore} ${material.unit} on hand but ${Number(batchTotal.toFixed(3))} ${material.unit} assigned to batches. Reconcile batches before using stock.`,
      "BATCH_RECONCILIATION_REQUIRED",
      409
    );
  }

  const batches = input.batch_id
    ? allBatches.filter((batch) => batch.id === input.batch_id)
    : allBatches;
  const selectedBatchTotal = batches.reduce((total, batch) => total + Number(batch.remaining_quantity), 0);

  if (selectedBatchTotal + 0.0005 < input.quantity) {
    throw new InventoryError(
      `The selected batch has only ${Number(selectedBatchTotal.toFixed(3))} ${material.unit} available.`,
      "INSUFFICIENT_BATCH_STOCK",
      409
    );
  }

  let remaining = input.quantity;
  let currentOnHand = quantityBefore;
  const movementAction = input.action ?? "Used";
  const allocations: Array<{ batchId: string; quantity: number }> = [];

  for (const batch of batches) {
    if (remaining <= 0) {
      break;
    }

    const batchBefore = Number(batch.remaining_quantity);
    const used = Math.min(batchBefore, remaining);
    const batchAfter = Number((batchBefore - used).toFixed(3));

    await tx.materialBatch.update({
      where: { id: batch.id },
      data: { remaining_quantity: batchAfter, is_disposed: batchAfter <= 0 }
    });

    await createInventoryMovement(tx, {
      raw_material_id: material.id,
      batch_id: batch.id,
      source_type: input.source_type,
      source_reference: input.source_reference,
      action: movementAction,
      quantity: used,
      unit: material.unit,
      quantity_before: currentOnHand,
      quantity_after: Number((currentOnHand - used).toFixed(3)),
      reserved_before: reservedBefore,
      reserved_after: reservedAfter,
      actor_id: input.actor_id,
      note: input.note
    });

    allocations.push({ batchId: batch.id, quantity: used });
    currentOnHand = Number((currentOnHand - used).toFixed(3));
    remaining = Number((remaining - used).toFixed(3));
  }

  if (remaining > 0.0005) {
    throw new InventoryError(
      `${material.name} batch quantities changed during the stock operation. Retry after reconciling.`,
      "BATCH_STOCK_CHANGED",
      409
    );
  }

  const updated = await tx.rawMaterial.update({
    where: { id: material.id },
    data: { current_stock: currentOnHand }
  });

  return { material: updated, quantityBefore, quantityAfter: currentOnHand, reserved: reservedBefore, allocations };
}

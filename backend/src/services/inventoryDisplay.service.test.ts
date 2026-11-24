import assert from "node:assert/strict";
import { test } from "node:test";
import { calculateDisplayedReservedQuantity } from "./inventory.service";
import { getInventoryMovementFilters, INVENTORY_MOVEMENT_CATEGORIES } from "./inventoryMovementCategories.service";

test("displayed Reserved quantity sums only catering and pickup holds", () => {
  assert.equal(
    calculateDisplayedReservedQuantity(
      [{ reserved_quantity: 12 }, { reserved_quantity: "3" }],
      [{ reserved_quantity: 4 }]
    ),
    19
  );
});

test("movement categories expose only the approved five groups", () => {
  assert.deepEqual(INVENTORY_MOVEMENT_CATEGORIES, [
    "Received",
    "Deducted",
    "Returned",
    "Wasted",
    "Adjusted"
  ]);
  assert.deepEqual(getInventoryMovementFilters("Deducted"), {
    actions: ["Deducted", "Used"],
    legacyTypes: ["deduct", "used"]
  });
  assert.deepEqual(getInventoryMovementFilters("Returned"), {
    actions: ["Returned", "Released", "Released back"],
    legacyTypes: ["release", "released", "return", "returned"]
  });
  assert.deepEqual(getInventoryMovementFilters(), {
    actions: ["Received", "Deducted", "Used", "Returned", "Released", "Released back", "Wasted", "Adjusted"],
    legacyTypes: ["receive", "received", "deduct", "used", "release", "released", "return", "returned", "waste", "wasted", "adjust", "adjustment", "adjusted"]
  });
});

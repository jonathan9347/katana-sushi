import assert from "node:assert/strict";
import { test } from "node:test";
import { INVENTORY_STANDARDS } from "./inventoryStandards";

test("uses the owner-confirmed Aonori serving standard", () => {
  assert.equal(INVENTORY_STANDARDS.ownerConfirmedAonoriGramsPerServing, 1);
});

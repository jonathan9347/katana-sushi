import assert from "node:assert/strict";
import { test } from "node:test";
import {
  getCateringPackagePrice,
  getCateringInventoryRequirements,
  getCateringInitialPayment,
  getCateringQuantityRules,
  getCateringSelectionError,
  isCateringQuantityValid
} from "./cateringBooking.service";

test("prices approved per-kilogram tuna and salmon quantities", () => {
  assert.equal(getCateringPackagePrice({ pricingModel: "per_unit", pricePerKg: 1200 }, 20), 24000);
  assert.equal(getCateringPackagePrice({ pricingModel: "per_unit", pricePerKg: 2400 }, 2), 4800);
});

test("enforces whole tuna and add-on quantity limits", () => {
  const rules = getCateringQuantityRules({
    minimum: 20,
    maximum: 40,
    step: 1,
    unit: "kg"
  });

  assert.equal(isCateringQuantityValid(20, rules), true);
  assert.equal(isCateringQuantityValid(40, rules), true);
  assert.equal(isCateringQuantityValid(19, rules), false);
  assert.equal(isCateringQuantityValid(41, rules), false);
  assert.equal(isCateringQuantityValid(20.5, rules), false);
});

test("prices tempura as a fixed 50-pax package", () => {
  assert.equal(getCateringPackagePrice({
    pricingModel: "fixed",
    fixedPrice: 6000,
    fixedPax: 50
  }), 6000);
});

test("calculates the 50% and 100% initial payment plans", () => {
  assert.equal(getCateringInitialPayment(6000, "downpayment"), 3000);
  assert.equal(getCateringInitialPayment(6001, "downpayment"), 3000.5);
  assert.equal(getCateringInitialPayment(6000, "full_payment"), 6000);
});

test("validates standalone tuna and add-on combinations", () => {
  assert.equal(getCateringSelectionError(["whole_tuna"]), null);
  assert.equal(getCateringSelectionError(["whole_tuna", "sushi_station"]), "Whole Tuna can only be booked by itself.");
  assert.equal(getCateringSelectionError(["tuna_add_on"]), "Tuna and Salmon add-ons must be added to a station package.");
  assert.equal(getCateringSelectionError(["sushi_station", "tuna_add_on", "salmon_add_on"]), null);
  assert.equal(getCateringSelectionError(["sushi_station", "sushi_station"]), "Select only one option for each catering station.");
});

test("resolves whole tuna, add-on, and tempura stock requirements", () => {
  assert.deepEqual(getCateringInventoryRequirements("whole_tuna", 20), [
    { materialName: "Tuna sashimi block", quantity: 20000, unit: "g" }
  ]);
  assert.deepEqual(getCateringInventoryRequirements("salmon_add_on", 3), [
    { materialName: "Salmon sashimi block", quantity: 3000, unit: "g" }
  ]);
  assert.deepEqual(getCateringInventoryRequirements("tempura_live"), [
    { materialName: "Shrimp", quantity: 5000, unit: "g" },
    { materialName: "Tempura flour", quantity: 2000, unit: "g" },
    { materialName: "Cooking oil", quantity: 3000, unit: "ml" },
    { materialName: "Dipping sauce", quantity: 1500, unit: "ml" }
  ]);
});

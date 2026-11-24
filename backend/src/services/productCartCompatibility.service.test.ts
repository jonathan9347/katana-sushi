import test from "node:test";
import assert from "node:assert/strict";

import {
  canOfferUnlimitedConversion,
  classifyProductForCart,
  getProductCartCompatibility,
  type ProductCartFacts
} from "./productCartCompatibility.service";

const includedProduct: ProductCartFacts = {
  name: "California Maki",
  category: "Classic Roll",
  is_included: true,
  is_sold_a_la_carte: true
};

const regularProduct: ProductCartFacts = {
  name: "Baked Sushi",
  category: "Baked Sushi",
  is_included: false,
  is_sold_a_la_carte: true
};

const beverageAddOn: ProductCartFacts = {
  name: "Bottled Water",
  category: " Beverage ",
  is_included: false,
  is_sold_a_la_carte: true
};

const unlimitedOnlyProduct: ProductCartFacts = {
  name: "Unlimited-only roll",
  category: "Classic Roll",
  is_included: true,
  is_sold_a_la_carte: false
};

test("included and a-la-carte products are allowed in either cart", () => {
  assert.equal(classifyProductForCart(includedProduct), "included_in_unlimited");
  assert.equal(getProductCartCompatibility(includedProduct, "a_la_carte").allowed, true);
  assert.equal(getProductCartCompatibility(includedProduct, "unlimited").allowed, true);
});

test("non-included products sold a la carte are refused in the Unlimited cart", () => {
  assert.equal(classifyProductForCart(regularProduct), "a_la_carte_only");
  assert.equal(getProductCartCompatibility(regularProduct, "a_la_carte").allowed, true);

  const result = getProductCartCompatibility(regularProduct, "unlimited");
  assert.equal(result.allowed, false);
  assert.match(result.message ?? "", /not included in Unlimited/i);
});

test("non-included beverages are add-ons allowed in either cart", () => {
  assert.equal(classifyProductForCart(beverageAddOn), "beverage_add_on");
  assert.equal(getProductCartCompatibility(beverageAddOn, "a_la_carte").allowed, true);
  assert.equal(getProductCartCompatibility(beverageAddOn, "unlimited").allowed, true);
});

test("Unlimited-only products are refused in the a-la-carte cart with a clear message", () => {
  assert.equal(classifyProductForCart(unlimitedOnlyProduct), "unlimited_only");
  assert.equal(getProductCartCompatibility(unlimitedOnlyProduct, "unlimited").allowed, true);

  const result = getProductCartCompatibility(unlimitedOnlyProduct, "a_la_carte");
  assert.equal(result.allowed, false);
  assert.match(result.message ?? "", /only available in the Unlimited cart/i);
});

test("products with neither sale flag are unavailable in either cart", () => {
  const unavailable: ProductCartFacts = {
    name: "Unavailable item",
    category: "Beverage",
    is_included: false,
    is_sold_a_la_carte: false
  };

  assert.equal(classifyProductForCart(unavailable), "not_sellable");
  assert.equal(getProductCartCompatibility(unavailable, "a_la_carte").allowed, false);
  assert.equal(getProductCartCompatibility(unavailable, "unlimited").allowed, false);
});

test("Unlimited conversion is eligible for included items alone or with beverage add-ons", () => {
  assert.equal(canOfferUnlimitedConversion([includedProduct]), true);
  assert.equal(canOfferUnlimitedConversion([includedProduct, beverageAddOn]), true);
});

test("Unlimited conversion is ineligible for regular items, beverage-only carts, or empty carts", () => {
  assert.equal(canOfferUnlimitedConversion([includedProduct, regularProduct]), false);
  assert.equal(canOfferUnlimitedConversion([beverageAddOn]), false);
  assert.equal(canOfferUnlimitedConversion([]), false);
  assert.equal(canOfferUnlimitedConversion([unlimitedOnlyProduct]), false);
});

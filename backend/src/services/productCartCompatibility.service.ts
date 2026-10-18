export type ProductCartFacts = {
  name: string;
  category: string;
  is_included: boolean;
  is_sold_a_la_carte: boolean;
};

export type ProductCartClassification =
  | "included_in_unlimited"
  | "beverage_add_on"
  | "a_la_carte_only"
  | "unlimited_only"
  | "not_sellable";

export type DiningCartType = "a_la_carte" | "unlimited";

export type CartCompatibilityResult = {
  allowed: boolean;
  classification: ProductCartClassification;
  message?: string;
};

function isBeverage(product: ProductCartFacts) {
  return product.category.trim().toLowerCase() === "beverage";
}

export function classifyProductForCart(product: ProductCartFacts): ProductCartClassification {
  if (product.is_included && product.is_sold_a_la_carte) {
    return "included_in_unlimited";
  }
  if (product.is_included) {
    return "unlimited_only";
  }
  if (!product.is_sold_a_la_carte) {
    return "not_sellable";
  }
  return isBeverage(product) ? "beverage_add_on" : "a_la_carte_only";
}

export function getProductCartCompatibility(
  product: ProductCartFacts,
  cartType: DiningCartType
): CartCompatibilityResult {
  const classification = classifyProductForCart(product);

  if (cartType === "a_la_carte") {
    if (product.is_sold_a_la_carte) {
      return { allowed: true, classification };
    }
    if (product.is_included) {
      return {
        allowed: false,
        classification,
        message: `${product.name} is only available in the Unlimited cart.`
      };
    }
    return {
      allowed: false,
      classification,
      message: `${product.name} is not available for sale.`
    };
  }

  if (product.is_included || (product.is_sold_a_la_carte && isBeverage(product))) {
    return { allowed: true, classification };
  }
  if (!product.is_sold_a_la_carte) {
    return {
      allowed: false,
      classification,
      message: `${product.name} is not available for sale.`
    };
  }
  return {
    allowed: false,
    classification,
    message: `${product.name} is not included in Unlimited. Only included products and beverage add-ons can be added to the Unlimited cart.`
  };
}

export function canOfferUnlimitedConversion(products: ProductCartFacts[]) {
  if (products.length === 0) {
    return false;
  }

  let hasIncludedProduct = false;
  for (const product of products) {
    const classification = classifyProductForCart(product);
    if (classification === "included_in_unlimited") {
      hasIncludedProduct = true;
      continue;
    }
    if (classification !== "beverage_add_on") {
      return false;
    }
  }

  return hasIncludedProduct;
}

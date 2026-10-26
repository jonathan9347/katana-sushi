export type CateringQuantityRules = {
  minimum: number;
  maximum?: number;
  step: number;
  unit: string;
};

export type CateringInventoryRequirement = {
  materialName: string;
  quantity: number;
  unit: string;
};

export type CateringPaymentPlan = "downpayment" | "full_payment";

function asObject(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

export function getCateringQuantityRules(value: unknown): CateringQuantityRules {
  const items = asObject(value);
  const minimum = items.bookingRole === "add_on" ? 1 : items.minimum ?? items.minKg;
  const maximum = items.maximum ?? items.maxKg;
  const unit = typeof items.unit === "string" ? items.unit : "kg";
  const configuredStep = items.step ?? items.stepKg ?? 1;
  if (typeof configuredStep !== "number" || !Number.isFinite(configuredStep) || configuredStep <= 0) {
    throw new Error("Catering package has invalid quantity limits.");
  }
  const step = items.bookingRole === "add_on" && unit.toLowerCase() === "kg"
    ? Math.min(configuredStep, 0.001)
    : configuredStep;

  if (typeof minimum !== "number" || !Number.isFinite(minimum) || minimum <= 0) {
    throw new Error("Catering package has invalid quantity limits.");
  }
  if (maximum !== undefined && typeof maximum !== "number") {
    throw new Error("Catering package has invalid quantity limits.");
  }
  if (typeof maximum === "number" && (!Number.isFinite(maximum) || maximum < minimum)) {
    throw new Error("Catering package has invalid quantity limits.");
  }
  if (typeof step !== "number" || !Number.isFinite(step) || step <= 0 || !unit.trim()) {
    throw new Error("Catering package has invalid quantity limits.");
  }

  return { minimum, maximum, step, unit };
}

export function isCateringQuantityValid(quantity: number, rules: CateringQuantityRules): boolean {
  return Number.isFinite(quantity) &&
    quantity >= rules.minimum &&
    (rules.maximum === undefined || quantity <= rules.maximum) &&
    Math.abs((quantity - rules.minimum) / rules.step - Math.round((quantity - rules.minimum) / rules.step)) <= 1e-9;
}

export function getCateringPackagePrice(value: unknown, quantity?: number): number {
  const items = asObject(value);
  const pricingType = items.pricingType;
  const pricingModel = items.pricingModel;

  if (pricingType === "quote" || pricingModel === "quote") {
    return 0;
  }

  const perUnitPrice = typeof items.pricePerUnit === "number"
    ? items.pricePerUnit
    : typeof items.pricePerKg === "number"
      ? items.pricePerKg
      : null;
  if (pricingType === "range" || pricingType === "per_unit" || pricingModel === "per_unit") {
    if (
      perUnitPrice === null ||
      !Number.isFinite(perUnitPrice) ||
      perUnitPrice < 0 ||
      quantity === undefined ||
      !Number.isFinite(quantity) ||
      quantity <= 0
    ) {
      throw new Error("Catering package has invalid per-unit pricing data.");
    }
    return perUnitPrice * quantity;
  }

  const fixedPrice = typeof items.fixedPrice === "number" ? items.fixedPrice : items.flatPrice;
  if (pricingModel === "fixed" || pricingType === "flat") {
    if (typeof fixedPrice !== "number" || !Number.isFinite(fixedPrice) || fixedPrice < 0) {
      throw new Error("Catering package has invalid fixed pricing data.");
    }
    return fixedPrice;
  }

  if (pricingModel === "tier") {
    const tierPrice = typeof fixedPrice === "number" ? fixedPrice : items.minPrice;
    if (typeof tierPrice !== "number" || !Number.isFinite(tierPrice) || tierPrice < 0) {
      throw new Error("Catering package has invalid fixed pricing data.");
    }
    return tierPrice;
  }

  throw new Error("Catering package has an unsupported pricing configuration.");
}

export function getCateringInitialPayment(total: number, plan: CateringPaymentPlan): number {
  if (!Number.isFinite(total) || total < 0) {
    throw new Error("Catering package total must be a finite non-negative amount.");
  }
  return Number((plan === "full_payment" ? total : total * 0.5).toFixed(2));
}

export function getCateringSelectionError(stationTypes: string[]): string | null {
  if (new Set(stationTypes).size !== stationTypes.length) {
    return "Select only one option for each catering station.";
  }

  if (stationTypes.includes("whole_tuna") && stationTypes.length !== 1) {
    return "Whole Tuna can only be booked by itself.";
  }

  const hasBasePackage = stationTypes.includes("sushi_station") || stationTypes.includes("tempura_live");
  if (
    (stationTypes.includes("tuna_add_on") || stationTypes.includes("salmon_add_on")) &&
    !hasBasePackage
  ) {
    return "Tuna and Salmon add-ons must be added to a station package.";
  }

  return null;
}

export function normalizeCateringStationType(
  stationType: string | null,
  packageName: string,
  value: unknown
): string | null {
  const normalizedType = stationType?.trim().toLowerCase().replace(/[\s-]+/g, "_") ?? null;
  if (normalizedType !== "sashimi_bar" && normalizedType !== "sashimi") {
    return normalizedType;
  }

  const items = asObject(value);
  const identity = packageName.toLowerCase();
  const minimum = items.minimum ?? items.minKg;
  const maximum = items.maximum ?? items.maxKg;
  if (
    identity.includes("whole tuna") ||
    (minimum === 20 && maximum === 40)
  ) {
    return "whole_tuna";
  }

  if (
    items.bookingRole === "add_on" ||
    items.pricingModel === "per_unit" ||
    items.pricingType === "range"
  ) {
    if (/\btuna\b/.test(identity)) return "tuna_add_on";
    if (/\bsalmon\b/.test(identity)) return "salmon_add_on";
  }

  return normalizedType;
}

export function getCateringInventoryRequirements(
  stationType: string | null,
  quantityKg?: number
): CateringInventoryRequirement[] {
  if (stationType === "whole_tuna" || stationType === "tuna_add_on") {
    if (quantityKg === undefined || !Number.isFinite(quantityKg) || quantityKg <= 0) {
      throw new Error("A valid kilogram quantity is required for the tuna package.");
    }
    return [{ materialName: "Tuna sashimi block", quantity: quantityKg * 1000, unit: "g" }];
  }
  if (stationType === "salmon_add_on") {
    if (quantityKg === undefined || !Number.isFinite(quantityKg) || quantityKg <= 0) {
      throw new Error("A valid kilogram quantity is required for the salmon add-on.");
    }
    return [{ materialName: "Salmon sashimi block", quantity: quantityKg * 1000, unit: "g" }];
  }
  return [];
}

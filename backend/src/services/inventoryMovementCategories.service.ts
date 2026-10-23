export const INVENTORY_MOVEMENT_CATEGORIES = [
  "Received",
  "Deducted",
  "Returned",
  "Wasted",
  "Adjusted"
] as const;

export type InventoryMovementCategory = typeof INVENTORY_MOVEMENT_CATEGORIES[number];

const actionsByCategory: Record<InventoryMovementCategory, string[]> = {
  Received: ["Received"],
  Deducted: ["Deducted", "Used"],
  Returned: ["Returned", "Released", "Released back"],
  Wasted: ["Wasted"],
  Adjusted: ["Adjusted"]
};

const legacyTypesByCategory: Record<InventoryMovementCategory, string[]> = {
  Received: ["receive", "received"],
  Deducted: ["deduct", "used"],
  Returned: ["release", "released", "return", "returned"],
  Wasted: ["waste", "wasted"],
  Adjusted: ["adjust", "adjustment", "adjusted"]
};

export function getInventoryMovementFilters(category?: string) {
  const selectedCategories = category
    ? INVENTORY_MOVEMENT_CATEGORIES.filter((candidate) => candidate === category)
    : INVENTORY_MOVEMENT_CATEGORIES;

  return {
    actions: [...new Set(selectedCategories.flatMap((selected) => actionsByCategory[selected]))],
    legacyTypes: [...new Set(selectedCategories.flatMap((selected) => legacyTypesByCategory[selected]))]
  };
}

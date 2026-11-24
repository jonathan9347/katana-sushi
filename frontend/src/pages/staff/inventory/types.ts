export type StaffRole = "admin" | "inventory_manager" | "cashier" | "receptionist" | "event_coordinator" | "chef" | "staff";

export type RawMaterial = {
  id: string;
  name: string;
  category: "Beverage" | "Raw Material";
  unit: string;
  current_stock: string | number;
  reserved_quantity?: string | number;
  available_quantity?: string | number;
  batch_total?: string | number;
  batch_mismatch?: boolean;
  expiring_within_7_days?: boolean;
  reserved_for?: Array<{
    id: string;
    booking_reference?: string;
    reserved_quantity: string | number;
    unit: string;
    event_name: string;
    event_date: string | null;
    customer_name: string;
    status?: string;
  }>;
  reorder_level: string | number;
  cost_per_unit: string | number;
};

export type InventoryMaterialWithAvailability = RawMaterial & {
  reserved_quantity: string | number;
  available_quantity: string | number;
};

export type RecipeIngredient = {
  id: string;
  quantity_per_yield: string | number;
  unit: string;
  raw_material: RawMaterial;
};

export type SellingProductYield = {
  id: string;
  name: string;
  category: string;
  maxPortions: number;
  limitingIngredient: string;
  limitingStock: number;
  limitingUnit?: string;
  requiredPerPortion: number;
  potentialRevenue: number;
  recipeWarnings?: string[];
};

export type InventoryTransaction = {
  id: string;
  created_at: string;
  transaction_type: "add" | "deduct" | "waste";
  quantity: string | number;
  unit: string;
  reference?: string;
  reason?: string;
  raw_material: RawMaterial;
  batch?: {
    id: string;
    batch_number: string;
    expiration_date?: string | null;
  };
  user?: {
    name: string;
    email: string;
  };
};

export type MaterialBatch = {
  id: string;
  batch_number: string;
  quantity: string | number;
  remaining_quantity: string | number;
  expiration_date?: string | null;
  received_at: string;
  cost_per_unit?: string | number | null;
  notes?: string | null;
  is_disposed: boolean;
  daysUntilExpiry?: number | null;
  expiryStatus?: "expired" | "critical" | "warning" | "ok" | "none";
  raw_material: {
    id: string;
    name: string;
    unit: string;
    current_stock?: string | number;
  };
};


export type SellingProduct = {
  id: string;
  name: string;
  category: string;
  price: string | number;
};

export type ProductRecipe = {
  id: string;
  selling_product: SellingProduct;
  recipe_ingredients: RecipeIngredient[];
};

export type RecipeDetailIngredient = {
  id: string;
  rawMaterialId: string;
  rawMaterialName: string;
  rawMaterialUnit: string;
  rawMaterialCostPerUnit: number;
  quantity: number;
  unit: string;
  costPerPortion: number;
};

export type ProductRecipeDetail = {
  productId: string;
  productName: string;
  status?: string;
  sellingPrice: number;
  ingredients: RecipeDetailIngredient[];
  totalIngredientCost: number;
  profitMargin: number;
};

export type MaterialSummary = {
  id: string;
  name: string;
  current_stock: string | number;
  available_quantity: string | number;
  unit: string;
};

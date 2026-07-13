import { FormEvent, useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Plus, Trash2 } from "lucide-react";
import { api, resolveImageUrl } from "../../lib/api";
import { Button } from "../ui/button";
import { Dialog } from "../ui/dialog";
import { Select } from "../ui/select";
import { MenuProduct } from "./ProductCard";

type MaterialOption = {
  id: string;
  name: string;
  unit: string;
  cost_per_unit: string | number;
};

type RecipeFormIngredient = {
  rowId: string;
  rawMaterialId: string;
  quantity: string;
  unit: string;
};

type ProductForm = {
  name: string;
  category: string;
  price: string;
  description: string;
  imageFile?: File | null;
  is_available: boolean;
  ingredients: RecipeFormIngredient[];
};

type ProductModalProps = {
  open: boolean;
  product: MenuProduct | null;
  categories: string[];
  pending: boolean;
  deletePending: boolean;
  canDelete: boolean;
  onClose: () => void;
  onDelete: () => void;
  onSubmit: (form: ProductForm) => void;
};

const emptyForm: ProductForm = {
  name: "",
  category: "Classic Roll",
  price: "0",
  description: "",
  imageFile: null,
  is_available: true,
  ingredients: []
};

function makeRow(material?: MaterialOption): RecipeFormIngredient {
  return {
    rowId: crypto.randomUUID(),
    rawMaterialId: material?.id ?? "",
    quantity: "1",
    unit: material?.unit ?? ""
  };
}

function isBeverage(category: string) {
  return category.toLowerCase() === "beverage";
}

function money(value: number) {
  return `PHP ${value.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function normalizeUnit(unit: string) {
  const normalized = unit.trim().toLowerCase();

  if (normalized === "piece") {
    return "pieces";
  }

  if (normalized === "sheet") {
    return "sheets";
  }

  if (normalized === "liter" || normalized === "litre" || normalized === "litres") {
    return "liters";
  }

  return normalized;
}

function quantityInMaterialUnit(quantity: number, recipeUnit: string, materialUnit: string) {
  const recipe = normalizeUnit(recipeUnit);
  const material = normalizeUnit(materialUnit);

  if (recipe === material) {
    return quantity;
  }

  if (recipe === "g" && material === "kg") {
    return quantity / 1000;
  }

  if (recipe === "kg" && material === "g") {
    return quantity * 1000;
  }

  if (recipe === "ml" && material === "liters") {
    return quantity / 1000;
  }

  if (recipe === "liters" && material === "ml") {
    return quantity * 1000;
  }

  return null;
}

function marginStatus(margin: number) {
  if (margin >= 70) {
    return { label: "Excellent", className: "bg-emerald-50 text-emerald-700", note: "No action needed." };
  }

  if (margin >= 50) {
    return { label: "Good", className: "bg-yellow-50 text-yellow-700", note: "Monitor supplier cost changes." };
  }

  if (margin >= 30) {
    return { label: "Warning", className: "bg-orange-50 text-orange-700", note: "Consider increasing price or adjusting portions." };
  }

  return { label: "Critical", className: "bg-red-50 text-red-700", note: "Immediate price, supplier, or recipe review needed." };
}

function recipeUnitOptions(material?: MaterialOption) {
  const unit = normalizeUnit(material?.unit ?? "");

  if (unit === "kg" || unit === "g") {
    return ["kg", "g"];
  }

  if (unit === "liters" || unit === "ml") {
    return ["liters", "ml"];
  }

  return material?.unit ? [material.unit] : [];
}

export default function ProductModal({
  canDelete,
  categories,
  deletePending,
  open,
  pending,
  product,
  onClose,
  onDelete,
  onSubmit
}: ProductModalProps) {
  const [form, setForm] = useState<ProductForm>(emptyForm);
  const [imagePreview, setImagePreview] = useState("");
  const [localPreviewUrl, setLocalPreviewUrl] = useState<string | null>(null);
  const [dragActive, setDragActive] = useState(false);
  const [validationMessage, setValidationMessage] = useState("");

  const materialsQuery = useQuery({
    queryKey: ["inventory", "materials"],
    queryFn: async () => {
      const response = await api.get<{ materials: MaterialOption[] }>("/api/inventory/materials");
      return response.data.materials;
    },
    enabled: open
  });

  useEffect(() => {
    if (product) {
      setForm({
        name: product.name,
        category: product.category,
        price: String(product.price),
        description: product.description ?? "",
        imageFile: null,
        is_available: product.is_available !== false,
        ingredients:
          product.recipes?.[0]?.recipe_ingredients.map((ingredient) => ({
            rowId: ingredient.id,
            rawMaterialId: ingredient.raw_material_id,
            quantity: String(ingredient.quantity_per_yield),
            unit: ingredient.unit
          })) ?? []
      });
      setImagePreview(resolveImageUrl(product.image_url) ?? "");
    } else {
      setForm(emptyForm);
      setImagePreview("");
    }

    setValidationMessage("");
  }, [product, open]);

  useEffect(() => {
    return () => {
      if (localPreviewUrl) {
        URL.revokeObjectURL(localPreviewUrl);
      }
    };
  }, [localPreviewUrl]);

  const materialById = useMemo(() => {
    return new Map((materialsQuery.data ?? []).map((material) => [material.id, material]));
  }, [materialsQuery.data]);

  const costAnalysis = useMemo(() => {
    const rows = form.ingredients.map((ingredient) => {
      const material = materialById.get(ingredient.rawMaterialId);
      const quantity = Number(ingredient.quantity);

      if (!material || !Number.isFinite(quantity)) {
        return {
          id: ingredient.rowId,
          ingredient,
          material,
          cost: 0,
          convertedQuantity: null,
          issue: "Select a material and enter a valid quantity."
        };
      }

      const convertedQuantity = quantityInMaterialUnit(quantity, ingredient.unit, material.unit);

      if (convertedQuantity === null) {
        return {
          id: ingredient.rowId,
          ingredient,
          material,
          cost: 0,
          convertedQuantity,
          issue: `Cannot convert ${ingredient.unit || "recipe unit"} to ${material.unit}.`
        };
      }

      return {
        id: ingredient.rowId,
        ingredient,
        material,
        cost: convertedQuantity * Number(material.cost_per_unit),
        convertedQuantity,
        issue: ""
      };
    });
    const totalIngredientCost = rows.reduce((total, row) => total + row.cost, 0);
    const price = Number(form.price);
    const grossProfit = price - totalIngredientCost;
    const profitMargin = price > 0 ? (grossProfit / price) * 100 : 0;

    return {
      rows,
      totalIngredientCost,
      grossProfit,
      price,
      profitMargin,
      status: marginStatus(profitMargin)
    };
  }, [form.ingredients, form.price, materialById]);

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setValidationMessage("");

    if (!isBeverage(form.category) && form.ingredients.length === 0) {
      setValidationMessage("Add at least one ingredient for non-beverage products.");
      return;
    }

    const invalidIngredient = form.ingredients.find(
      (ingredient) => !ingredient.rawMaterialId || Number(ingredient.quantity) <= 0 || !ingredient.unit
    );

    if (invalidIngredient) {
      setValidationMessage("Each recipe ingredient needs a material, unit, and quantity greater than 0.");
      return;
    }

    onSubmit(form);
  }

  function addIngredient() {
    const firstMaterial = materialsQuery.data?.[0];
    setForm((current) => ({
      ...current,
      ingredients: [...current.ingredients, makeRow(firstMaterial)]
    }));
  }

  function updateIngredient(rowId: string, patch: Partial<RecipeFormIngredient>) {
    setForm((current) => ({
      ...current,
      ingredients: current.ingredients.map((ingredient) =>
        ingredient.rowId === rowId ? { ...ingredient, ...patch } : ingredient
      )
    }));
  }

  function selectMaterial(rowId: string, rawMaterialId: string) {
    const material = materialById.get(rawMaterialId);
    updateIngredient(rowId, {
      rawMaterialId,
      unit: material?.unit ?? ""
    });
  }

  function removeIngredient(rowId: string) {
    setForm((current) => ({
      ...current,
      ingredients: current.ingredients.filter((ingredient) => ingredient.rowId !== rowId)
    }));
  }

  return (
    <Dialog open={open} title={product ? `Edit ${product.name}` : "Add Menu Product"} panelClassName="max-w-4xl" onClose={onClose}>
      <form className="grid gap-5" onSubmit={submit}>
        <section className="grid gap-4 rounded-md border border-slate-200 p-4">
          <h3 className="text-sm font-semibold uppercase text-slate-500">Basic Info</h3>
          <div className="grid gap-4 md:grid-cols-2">
            <label className="grid gap-1 text-sm font-medium text-slate-700">
              <span>Product Name</span>
              <input
                className="h-10 rounded-md border border-slate-300 px-3 text-sm outline-none focus:border-red-700 focus:ring-2 focus:ring-red-100"
                required
                value={form.name}
                onChange={(event) => setForm((current) => ({ ...current, name: event.target.value }))}
              />
            </label>

            <label className="grid gap-1 text-sm font-medium text-slate-700">
              <span>Category</span>
              <Select value={form.category} onChange={(event) => setForm((current) => ({ ...current, category: event.target.value }))}>
                {categories.map((category) => (
                  <option key={category} value={category}>
                    {category}
                  </option>
                ))}
              </Select>
            </label>

            <label className="grid gap-1 text-sm font-medium text-slate-700">
              <span>Price</span>
              <input
                className="h-10 rounded-md border border-slate-300 px-3 text-sm outline-none focus:border-red-700 focus:ring-2 focus:ring-red-100"
                min="0"
                required
                step="0.01"
                type="number"
                value={form.price}
                onChange={(event) => setForm((current) => ({ ...current, price: event.target.value }))}
              />
            </label>

            <label className="grid gap-1 text-sm font-medium text-slate-700 md:row-span-2">
              <span>Description</span>
              <textarea
                className="min-h-24 rounded-md border border-slate-300 px-3 py-2 text-sm outline-none focus:border-red-700 focus:ring-2 focus:ring-red-100"
                value={form.description}
                onChange={(event) => setForm((current) => ({ ...current, description: event.target.value }))}
              />
            </label>

            <div className="grid gap-2 text-sm font-medium text-slate-700 md:row-span-2">
              <span>Product image</span>
              <div
                className={
                  "group relative rounded-xl border border-dashed bg-slate-50 p-4 text-sm text-slate-500 transition " +
                  (dragActive ? "border-red-500 bg-red-50" : "border-slate-300 hover:border-red-700 hover:bg-white")
                }
                onDragOver={(event) => {
                  event.preventDefault();
                  setDragActive(true);
                }}
                onDragLeave={() => setDragActive(false)}
                onDrop={(event) => {
                  event.preventDefault();
                  setDragActive(false);
                  const file = event.dataTransfer.files?.[0] ?? null;
                  if (file) {
                    if (localPreviewUrl) {
                      URL.revokeObjectURL(localPreviewUrl);
                    }
                    const previewUrl = URL.createObjectURL(file);
                    setImagePreview(previewUrl);
                    setLocalPreviewUrl(previewUrl);
                    setForm((current) => ({ ...current, imageFile: file }));
                  }
                }}
              >
                <input
                  accept="image/*"
                  className="sr-only"
                  id="product-image-file"
                  type="file"
                  onChange={(event) => {
                    const file = event.target.files?.[0] ?? null;
                    if (localPreviewUrl) {
                      URL.revokeObjectURL(localPreviewUrl);
                    }
                    if (file) {
                      const previewUrl = URL.createObjectURL(file);
                      setImagePreview(previewUrl);
                      setLocalPreviewUrl(previewUrl);
                    }
                    setForm((current) => ({ ...current, imageFile: file }));
                  }}
                />
                <label htmlFor="product-image-file" className="block cursor-pointer">
                  <div className="flex flex-col items-center justify-center gap-2 text-center">
                    {imagePreview ? (
                      <img src={imagePreview} alt="Preview" className="mx-auto h-32 w-full max-w-xs rounded-xl object-cover" />
                    ) : (
                      <div className="mx-auto flex h-32 w-full max-w-xs items-center justify-center rounded-xl bg-white text-4xl text-red-700">
                        📷
                      </div>
                    )}
                    <div>
                      <p className="font-semibold text-slate-700">Drag & drop an image or click to browse</p>
                      <p className="text-xs text-slate-500">PNG, JPG, or WEBP. Max 5MB.</p>
                    </div>
                  </div>
                </label>
              </div>
            </div>

            <label className="flex items-center gap-2 text-sm font-medium text-slate-700">
              <input
                checked={form.is_available}
                className="h-4 w-4 accent-red-700"
                type="checkbox"
                onChange={(event) => setForm((current) => ({ ...current, is_available: event.target.checked }))}
              />
              Available
            </label>
          </div>
        </section>

        <section className="grid gap-4 rounded-md border border-slate-200 p-4">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h3 className="text-sm font-semibold uppercase text-slate-500">Recipe Ingredients</h3>
              <p className="mt-1 text-sm text-slate-500">From Materials List</p>
            </div>
            <Button type="button" variant="outline" disabled={materialsQuery.isLoading} onClick={addIngredient}>
              <Plus className="mr-2 h-4 w-4" />
              Add Ingredient
            </Button>
          </div>

          {materialsQuery.isLoading && <p className="text-sm text-slate-500">Loading materials...</p>}
          {materialsQuery.isError && <p className="text-sm text-red-700">Unable to load materials.</p>}

          {form.ingredients.length === 0 ? (
            <div className="rounded-md border border-dashed border-slate-300 p-4 text-sm text-slate-500">
              {isBeverage(form.category) ? "No recipe needed for beverages." : "Add ingredients for this product recipe."}
            </div>
          ) : (
            <div className="grid max-h-72 gap-2 overflow-y-auto pr-1">
              <div className="hidden grid-cols-[1fr_120px_120px_48px] gap-2 text-xs font-semibold uppercase text-slate-500 md:grid">
                <span>Ingredient</span>
                <span>Quantity</span>
                <span>Unit</span>
                <span />
              </div>
              {form.ingredients.map((ingredient) => {
                const material = materialById.get(ingredient.rawMaterialId);

                return (
                  <div key={ingredient.rowId} className="grid gap-2 rounded-md border border-slate-200 p-2 md:grid-cols-[1fr_120px_120px_48px]">
                    <Select value={ingredient.rawMaterialId} onChange={(event) => selectMaterial(ingredient.rowId, event.target.value)}>
                      <option value="">Select material</option>
                      {(materialsQuery.data ?? []).map((materialOption) => (
                        <option key={materialOption.id} value={materialOption.id}>
                          {materialOption.name}
                        </option>
                      ))}
                    </Select>
                    <input
                      className="h-10 rounded-md border border-slate-300 px-3 text-sm outline-none focus:border-red-700 focus:ring-2 focus:ring-red-100"
                      min="0.001"
                      required
                      step="0.001"
                      type="number"
                      value={ingredient.quantity}
                      onChange={(event) => updateIngredient(ingredient.rowId, { quantity: event.target.value })}
                    />
                    <Select value={ingredient.unit} onChange={(event) => updateIngredient(ingredient.rowId, { unit: event.target.value })}>
                      {material ? (
                        recipeUnitOptions(material).map((unit) => (
                          <option key={unit} value={unit}>
                            {unit}
                          </option>
                        ))
                      ) : (
                        <option value="">Select material</option>
                      )}
                    </Select>
                    <Button type="button" variant="ghost" onClick={() => removeIngredient(ingredient.rowId)}>
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                );
              })}
            </div>
          )}

          <div className="grid gap-4 rounded-md border border-slate-200 bg-slate-50 p-4 text-sm">
            <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
              <div>
                <h4 className="text-sm font-semibold uppercase text-slate-600">Cost Analysis</h4>
                <p className="mt-1 text-slate-600">
                  Material cost per unit is the supplier cost for the material unit. Recipe quantity is converted to that unit before costing.
                </p>
              </div>
              <span className={`inline-flex w-fit rounded-full px-3 py-1 text-xs font-bold uppercase ${costAnalysis.status.className}`}>
                {costAnalysis.profitMargin.toFixed(1)}% {costAnalysis.status.label}
              </span>
            </div>

            {costAnalysis.rows.length > 0 && (
              <div className="max-h-48 overflow-y-auto rounded-md border border-slate-200 bg-white">
                {costAnalysis.rows.map((row) => (
                  <div key={row.id} className="grid gap-1 border-b border-slate-100 px-3 py-2 last:border-b-0 md:grid-cols-[1fr_auto] md:items-center">
                    <div>
                      <p className="font-medium text-slate-950">{row.material?.name ?? "Unselected material"}</p>
                      {row.issue ? (
                        <p className="text-xs text-red-700">{row.issue}</p>
                      ) : (
                        <p className="text-xs text-slate-500">
                          {Number(row.ingredient.quantity).toLocaleString()} {row.ingredient.unit} ={" "}
                          {row.convertedQuantity?.toLocaleString(undefined, { maximumFractionDigits: 4 })} {row.material?.unit} x{" "}
                          {money(Number(row.material?.cost_per_unit ?? 0))}/{row.material?.unit}
                        </p>
                      )}
                    </div>
                    <p className="font-semibold text-slate-950">{money(row.cost)}</p>
                  </div>
                ))}
              </div>
            )}

            <div className="grid gap-2 rounded-md bg-white p-3 md:grid-cols-2">
              <p>Total ingredient cost: <span className="font-semibold">{money(costAnalysis.totalIngredientCost)}</span></p>
              <p>Selling price: <span className="font-semibold">{money(costAnalysis.price || 0)}</span></p>
              <p>Gross profit: <span className="font-semibold">{money(costAnalysis.grossProfit)}</span></p>
              <p>Profit margin: <span className="font-semibold">{costAnalysis.profitMargin.toFixed(1)}%</span></p>
            </div>

            <p className="rounded-md border border-slate-200 bg-white p-3 text-slate-600">
              {costAnalysis.status.note} Updating a material's cost per unit automatically changes the margin for every product that uses it.
            </p>
          </div>
        </section>

        {validationMessage && <p className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700">{validationMessage}</p>}

        <div className="sticky bottom-0 -mx-5 flex flex-col-reverse gap-2 border-t border-slate-200 bg-white px-5 py-4 sm:flex-row sm:justify-between">
          {product && canDelete ? (
            <Button type="button" variant="danger" disabled={deletePending || pending} onClick={onDelete}>
              <Trash2 className="mr-2 h-4 w-4" />
              Delete Product
            </Button>
          ) : (
            <span />
          )}
          <Button disabled={pending}>{product ? "Save Product" : "Create Product"}</Button>
        </div>
      </form>
    </Dialog>
  );
}

export type { ProductForm };

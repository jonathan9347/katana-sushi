import { FormEvent, useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Edit } from "lucide-react";
import { api } from "../../lib/api";
import { useToast } from "../../hooks/useToast";
import { ProductRecipeDetail } from "../../pages/staff/inventory/types";
import { Button } from "../ui/button";
import { Dialog } from "../ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "../ui/table";

type RecipeModalProps = {
  productId: string | null;
  isAdmin: boolean;
  onClose: () => void;
};

export default function RecipeModal({ productId, isAdmin, onClose }: RecipeModalProps) {
  const [isEditing, setIsEditing] = useState(false);
  const [drafts, setDrafts] = useState<Record<string, { quantity: string; unit: string }>>({});
  const [costDrafts, setCostDrafts] = useState<Record<string, string>>({});
  const [sellingPrice, setSellingPrice] = useState("0");
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const recipeQuery = useQuery({
    queryKey: ["products", productId, "recipe-detail"],
    queryFn: async () => {
      const response = await api.get<ProductRecipeDetail>(`/api/products/${productId}/recipe`);
      return response.data;
    },
    enabled: Boolean(productId)
  });

  useEffect(() => {
    if (recipeQuery.data) {
      setSellingPrice(String(recipeQuery.data.sellingPrice));
      setDrafts(
        Object.fromEntries(
          recipeQuery.data.ingredients.map((ingredient) => [
            ingredient.id,
            { quantity: String(ingredient.quantity), unit: ingredient.unit }
          ])
        )
      );
      setCostDrafts(
        Object.fromEntries(
          recipeQuery.data.ingredients.map((ingredient) => [
            ingredient.id,
            String(ingredient.rawMaterialCostPerUnit)
          ])
        )
      );
    }
  }, [recipeQuery.data]);

  const updateMutation = useMutation({
    mutationFn: async () => {
      if (!recipeQuery.data) {
        return null;
      }

      const recipePayload = {
        ingredients: recipeQuery.data.ingredients.map((ingredient) => ({
          id: ingredient.id,
          rawMaterialId: ingredient.rawMaterialId,
          quantity: Number(drafts[ingredient.id]?.quantity ?? ingredient.quantity),
          unit: drafts[ingredient.id]?.unit ?? ingredient.unit
        }))
      };
      const requests = [api.put(`/api/products/${recipeQuery.data.productId}/recipe`, recipePayload)];

      if (Number(sellingPrice) !== recipeQuery.data.sellingPrice) {
        requests.push(api.put(`/api/products/${recipeQuery.data.productId}`, { price: Number(sellingPrice) }));
      }

      recipeQuery.data.ingredients.forEach((ingredient) => {
        const nextCost = Number(costDrafts[ingredient.id] ?? ingredient.rawMaterialCostPerUnit);

        if (nextCost !== ingredient.rawMaterialCostPerUnit) {
          requests.push(
            api.put(`/api/inventory/materials/${ingredient.rawMaterialId}/cost`, {
              cost_per_unit: nextCost
            })
          );
        }
      });

      return Promise.all(requests);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["products"] });
      queryClient.invalidateQueries({ queryKey: ["inventory", "yield"] });
      queryClient.invalidateQueries({ queryKey: ["inventory", "materials"] });
      queryClient.invalidateQueries({ queryKey: ["products", productId, "recipe-detail"] });
      setIsEditing(false);
      toast("Recipe, price, and ingredient costs updated.");
    },
    onError: () => toast("Unable to update recipe.")
  });

  function calculateIngredientCost(quantity: number, ingredientUnit: string, materialUnit: string, costPerUnit: number) {
    const normalizedIngredientUnit = ingredientUnit.toLowerCase();
    const normalizedMaterialUnit = materialUnit.toLowerCase();

    if (normalizedIngredientUnit === normalizedMaterialUnit) {
      return quantity * costPerUnit;
    }

    if (
      (normalizedIngredientUnit === "g" || normalizedIngredientUnit === "gram" || normalizedIngredientUnit === "grams") &&
      normalizedMaterialUnit === "kg"
    ) {
      return (quantity / 1000) * costPerUnit;
    }

    if (
      (normalizedIngredientUnit === "ml" || normalizedIngredientUnit === "milliliter" || normalizedIngredientUnit === "milliliters") &&
      (normalizedMaterialUnit === "l" || normalizedMaterialUnit === "liter" || normalizedMaterialUnit === "liters")
    ) {
      return (quantity / 1000) * costPerUnit;
    }

    return quantity * costPerUnit;
  }

  const totals = useMemo(() => {
    const totalIngredientCost =
      recipeQuery.data?.ingredients.reduce((total, ingredient) => {
        const draft = drafts[ingredient.id];
        const quantity = Number(draft?.quantity ?? ingredient.quantity);
        const unit = draft?.unit ?? ingredient.unit;
        const costPerUnit = Number(costDrafts[ingredient.id] ?? ingredient.rawMaterialCostPerUnit);

        return total + calculateIngredientCost(quantity, unit, ingredient.rawMaterialUnit, costPerUnit);
      }, 0) ?? 0;
    const currentSellingPrice = Number(sellingPrice);

    return {
      totalIngredientCost,
      profitMargin:
        currentSellingPrice > 0 ? ((currentSellingPrice - totalIngredientCost) / currentSellingPrice) * 100 : 0
    };
  }, [costDrafts, drafts, recipeQuery.data, sellingPrice]);

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    updateMutation.mutate();
  }

  return (
    <Dialog
      open={Boolean(productId)}
      title={recipeQuery.data ? `${recipeQuery.data.productName} Recipe` : "Recipe"}
      panelClassName="max-w-4xl"
      onClose={onClose}
    >
      {recipeQuery.isLoading && <p className="text-sm text-slate-500">Loading recipe...</p>}
      {recipeQuery.isError && <p className="text-sm text-red-700">Unable to load recipe.</p>}
      {recipeQuery.data && (
        <form className="grid gap-4" onSubmit={submit}>
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <div className="grid gap-1 text-sm font-medium text-slate-700 sm:w-56">
              <span>Selling Price</span>
              {isEditing ? (
                <input
                  className="h-10 rounded-md border border-slate-300 px-3 text-sm outline-none focus:border-red-700 focus:ring-2 focus:ring-red-100"
                  min="0"
                  step="0.01"
                  type="number"
                  value={sellingPrice}
                  onChange={(event) => setSellingPrice(event.target.value)}
                />
              ) : (
                <span className="text-base font-semibold text-slate-950">
                  PHP {Number(sellingPrice).toLocaleString()}
                </span>
              )}
            </div>
            {isAdmin && (
              <Button type="button" size="sm" variant="outline" onClick={() => setIsEditing((current) => !current)}>
                <Edit className="mr-2 h-4 w-4" />
                {isEditing ? "Stop Editing" : "Edit"}
              </Button>
            )}
          </div>

          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Ingredient</TableHead>
                  <TableHead>Quantity per Portion</TableHead>
                  <TableHead>Unit</TableHead>
                  <TableHead>Material Cost</TableHead>
                  <TableHead>Portion Cost</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {recipeQuery.data.ingredients.map((ingredient) => (
                  <TableRow key={ingredient.id}>
                    <TableCell className="font-medium">{ingredient.rawMaterialName}</TableCell>
                    <TableCell>
                      {isEditing ? (
                        <input
                          className="h-9 w-32 rounded-md border border-slate-300 px-2 text-sm"
                          min="0.001"
                          step="0.001"
                          type="number"
                          value={drafts[ingredient.id]?.quantity ?? ingredient.quantity}
                          onChange={(event) =>
                            setDrafts((current) => ({
                              ...current,
                              [ingredient.id]: {
                                quantity: event.target.value,
                                unit: current[ingredient.id]?.unit ?? ingredient.unit
                              }
                            }))
                          }
                        />
                      ) : (
                        Number(ingredient.quantity).toLocaleString()
                      )}
                    </TableCell>
                    <TableCell>
                      {isEditing ? (
                        <input
                          className="h-9 w-28 rounded-md border border-slate-300 px-2 text-sm"
                          value={drafts[ingredient.id]?.unit ?? ingredient.unit}
                          onChange={(event) =>
                            setDrafts((current) => ({
                              ...current,
                              [ingredient.id]: {
                                quantity: current[ingredient.id]?.quantity ?? String(ingredient.quantity),
                                unit: event.target.value
                              }
                            }))
                          }
                        />
                      ) : (
                        ingredient.unit
                      )}
                    </TableCell>
                    <TableCell>
                      {isEditing ? (
                        <div className="flex items-center gap-2">
                          <input
                            className="h-9 w-32 rounded-md border border-slate-300 px-2 text-sm"
                            min="0"
                            step="0.01"
                            type="number"
                            value={costDrafts[ingredient.id] ?? ingredient.rawMaterialCostPerUnit}
                            onChange={(event) =>
                              setCostDrafts((current) => ({
                                ...current,
                                [ingredient.id]: event.target.value
                              }))
                            }
                          />
                          <span className="text-xs text-slate-500">/ {ingredient.rawMaterialUnit}</span>
                        </div>
                      ) : (
                        `PHP ${Number(ingredient.rawMaterialCostPerUnit).toFixed(2)} / ${ingredient.rawMaterialUnit}`
                      )}
                    </TableCell>
                    <TableCell>
                      PHP{" "}
                      {calculateIngredientCost(
                        Number(drafts[ingredient.id]?.quantity ?? ingredient.quantity),
                        drafts[ingredient.id]?.unit ?? ingredient.unit,
                        ingredient.rawMaterialUnit,
                        Number(costDrafts[ingredient.id] ?? ingredient.rawMaterialCostPerUnit)
                      ).toFixed(2)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>

          <div className="rounded-md border border-slate-200 bg-slate-50 p-4 text-sm">
            <p>
              Total Ingredient Cost: <span className="font-semibold">PHP {totals.totalIngredientCost.toFixed(2)}</span>
            </p>
            <p className="mt-1">
              Gross Profit Margin: <span className="font-semibold">{totals.profitMargin.toFixed(1)}%</span>
            </p>
          </div>

          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={onClose}>
              Close
            </Button>
            {isAdmin && isEditing && <Button disabled={updateMutation.isPending}>Save Changes</Button>}
          </div>
        </form>
      )}
    </Dialog>
  );
}

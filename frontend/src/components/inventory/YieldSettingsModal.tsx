import { FormEvent, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../../lib/api";
import { useToast } from "../../hooks/useToast";
import { ProductRecipeDetail, SellingProduct } from "../../pages/staff/inventory/types";
import { Button } from "../ui/button";
import { Dialog } from "../ui/dialog";
import { Select } from "../ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "../ui/table";

type YieldSettingsModalProps = {
  open: boolean;
  onClose: () => void;
};

export default function YieldSettingsModal({ open, onClose }: YieldSettingsModalProps) {
  const [selectedProductId, setSelectedProductId] = useState("");
  const [recipeDrafts, setRecipeDrafts] = useState<Record<string, { quantity: string; unit: string }>>({});
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const productsQuery = useQuery({
    queryKey: ["products"],
    queryFn: async () => {
      const response = await api.get<{ products: SellingProduct[] }>("/api/products");
      return response.data.products;
    },
    enabled: open
  });

  const recipeQuery = useQuery({
    queryKey: ["products", selectedProductId, "recipe-detail"],
    queryFn: async () => {
      const response = await api.get<ProductRecipeDetail>(`/api/products/${selectedProductId}/recipe`);
      setRecipeDrafts(
        Object.fromEntries(
          response.data.ingredients.map((ingredient) => [
            ingredient.id,
            { quantity: String(ingredient.quantity), unit: ingredient.unit }
          ])
        )
      );
      return response.data;
    },
    enabled: open && Boolean(selectedProductId)
  });

  const updateRecipeMutation = useMutation({
    mutationFn: async () => {
      if (!recipeQuery.data) {
        return null;
      }

      return api.put(`/api/products/${recipeQuery.data.productId}/recipe`, {
        ingredients: recipeQuery.data.ingredients.map((ingredient) => ({
          id: ingredient.id,
          rawMaterialId: ingredient.rawMaterialId,
          quantity: Number(recipeDrafts[ingredient.id]?.quantity ?? ingredient.quantity),
          unit: recipeDrafts[ingredient.id]?.unit ?? ingredient.unit
        }))
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["products"] });
      queryClient.invalidateQueries({ queryKey: ["inventory", "yield"] });
      toast("Recipe measurements saved.");
    },
    onError: () => toast("Unable to save recipe measurements.")
  });

  function saveRecipe(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    updateRecipeMutation.mutate();
  }

  return (
    <Dialog open={open} title="Yield Settings" panelClassName="max-w-5xl" onClose={onClose}>
      <div className="grid max-h-[75vh] gap-6 overflow-y-auto pr-1">
        <section className="grid gap-3">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <h3 className="text-sm font-semibold uppercase text-slate-500">Recipe Measurements</h3>
            <Select className="w-full sm:w-80" value={selectedProductId} onChange={(event) => setSelectedProductId(event.target.value)}>
              <option value="">Select product</option>
              {productsQuery.data?.map((product) => (
                <option key={product.id} value={product.id}>
                  {product.name}
                </option>
              ))}
            </Select>
          </div>

          {recipeQuery.isLoading && <p className="text-sm text-slate-500">Loading recipe...</p>}
          {recipeQuery.data && (
            <form className="grid gap-4" onSubmit={saveRecipe}>
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Ingredient</TableHead>
                      <TableHead>Amount per Portion</TableHead>
                      <TableHead>Unit</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {recipeQuery.data.ingredients.map((ingredient) => (
                      <TableRow key={ingredient.id}>
                        <TableCell className="font-medium">{ingredient.rawMaterialName}</TableCell>
                        <TableCell>
                          <input
                            className="h-9 w-36 rounded-md border border-slate-300 px-2 text-sm"
                            min="0.001"
                            step="0.001"
                            type="number"
                            value={recipeDrafts[ingredient.id]?.quantity ?? ingredient.quantity}
                            onChange={(event) =>
                              setRecipeDrafts((current) => ({
                                ...current,
                                [ingredient.id]: {
                                  quantity: event.target.value,
                                  unit: current[ingredient.id]?.unit ?? ingredient.unit
                                }
                              }))
                            }
                          />
                        </TableCell>
                        <TableCell>
                          <input
                            className="h-9 w-32 rounded-md border border-slate-300 px-2 text-sm"
                            value={recipeDrafts[ingredient.id]?.unit ?? ingredient.unit}
                            onChange={(event) =>
                              setRecipeDrafts((current) => ({
                                ...current,
                                [ingredient.id]: {
                                  quantity: current[ingredient.id]?.quantity ?? String(ingredient.quantity),
                                  unit: event.target.value
                                }
                              }))
                            }
                          />
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
              <div className="flex justify-end">
                <Button disabled={updateRecipeMutation.isPending}>Save Recipe</Button>
              </div>
            </form>
          )}
        </section>
      </div>
    </Dialog>
  );
}

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { RefreshCw, Settings } from "lucide-react";
import MaterialsSummary from "../../../components/inventory/MaterialsSummary";
import RecipeModal from "../../../components/inventory/RecipeModal";
import YieldSettingsModal from "../../../components/inventory/YieldSettingsModal";
import { api } from "../../../lib/api";
import { Button } from "../../../components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "../../../components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "../../../components/ui/table";
import { SellingProductYield } from "./types";

type YieldResponse = {
  products: SellingProductYield[];
  globalBottleneck: {
    ingredient: string;
    affectedProducts: string[];
    suggestion: string;
  };
  stockSummary: Array<{
    name: string;
    current: number;
    unit: string;
  }>;
};

function isAdmin() {
  return localStorage.getItem("katana_role")?.toLowerCase() === "admin";
}

export default function YieldEstimator() {
  const [showMaterialsSummary, setShowMaterialsSummary] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [selectedProductId, setSelectedProductId] = useState<string | null>(null);
  const admin = isAdmin();
  const yieldQuery = useQuery({
    queryKey: ["inventory", "yield"],
    queryFn: async () => {
      const response = await api.get<YieldResponse>("/api/inventory/yield");
      return {
        ...response.data,
        products: response.data.products.filter((product) => product.category.toLowerCase() !== "beverage")
      };
    }
  });

  return (
    <div className="grid gap-5">
      <Card>
        <CardHeader className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <CardTitle>Yield Estimator</CardTitle>
          <div className="flex gap-2">
            {admin && (
              <Button size="sm" variant="outline" onClick={() => setSettingsOpen(true)}>
                <Settings className="mr-2 h-4 w-4" />
                Settings
              </Button>
            )}
            <Button size="sm" variant="outline" onClick={() => yieldQuery.refetch()}>
              <RefreshCw className="mr-2 h-4 w-4" />
              Refresh
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          {yieldQuery.isLoading && <p className="text-sm text-slate-500">Calculating production capacity...</p>}
          {yieldQuery.isError && <p className="text-sm text-red-700">Unable to calculate yield.</p>}
          {yieldQuery.data && (
            <div className="grid gap-4">
              <MaterialsSummary
                expanded={showMaterialsSummary}
                onToggle={() => setShowMaterialsSummary((current) => !current)}
              />

              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Product</TableHead>
                      <TableHead>Max Portions</TableHead>
                      <TableHead>Limiting Ingredient</TableHead>
                      <TableHead>Potential Revenue</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {yieldQuery.data.products.map((product) => (
                      <TableRow key={product.id}>
                        <TableCell className="font-medium">
                          <button
                            className="text-left font-semibold text-red-700 underline-offset-2 hover:underline"
                            type="button"
                            onClick={() => setSelectedProductId(product.id)}
                          >
                            {product.name}
                          </button>
                        </TableCell>
                        <TableCell>{product.maxPortions.toLocaleString()}</TableCell>
                        <TableCell>{product.limitingIngredient}</TableCell>
                        <TableCell>PHP {product.potentialRevenue.toLocaleString()}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>

              <div className="rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
                <p>
                  Global Bottleneck: Limited by{" "}
                  <span className="font-semibold">{yieldQuery.data.globalBottleneck.ingredient}</span>.
                </p>
                <p className="mt-1">{yieldQuery.data.globalBottleneck.suggestion}</p>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      <YieldSettingsModal open={settingsOpen} onClose={() => setSettingsOpen(false)} />
      <RecipeModal productId={selectedProductId} isAdmin={admin} onClose={() => setSelectedProductId(null)} />
    </div>
  );
}

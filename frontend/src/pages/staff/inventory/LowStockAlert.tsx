import { useQuery } from "@tanstack/react-query";
import { AlertTriangle } from "lucide-react";
import { api } from "../../../lib/api";
import { Button } from "../../../components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "../../../components/ui/card";
import { RawMaterial } from "./types";

export default function LowStockAlert() {
  const lowStockQuery = useQuery({
    queryKey: ["inventory", "materials"],
    queryFn: async () => {
      const response = await api.get<{ materials: RawMaterial[] }>("/api/inventory/materials");
      return response.data.materials.filter((material) => Number(material.current_stock) <= Number(material.reorder_level));
    }
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle>Low Stock Alerts</CardTitle>
      </CardHeader>
      <CardContent>
        {lowStockQuery.isLoading && <p className="text-sm text-slate-500">Checking stock levels...</p>}
        {lowStockQuery.isError && <p className="text-sm text-red-700">Unable to load low stock alerts.</p>}
        {lowStockQuery.data?.length === 0 && <p className="text-sm text-slate-500">No materials are below reorder level.</p>}
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {lowStockQuery.data?.map((material) => (
            <div key={material.id} className="rounded-lg border border-red-200 bg-red-50 p-4">
              <div className="flex items-start gap-3">
                <AlertTriangle className="mt-0.5 h-5 w-5 text-red-700" />
                <div className="min-w-0 flex-1">
                  <h3 className="font-semibold text-red-950">{material.name}</h3>
                  <p className="mt-1 text-sm text-red-800">
                    {Number(material.current_stock).toLocaleString()} {material.unit} available. Reorder at{" "}
                    {Number(material.reorder_level).toLocaleString()} {material.unit}.
                  </p>
                </div>
              </div>
              <Button className="mt-4" size="sm" variant="outline" onClick={() => window.alert(`${material.name} marked for ordering.`)}>
                Order Now
              </Button>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

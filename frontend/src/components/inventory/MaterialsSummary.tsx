import { useQuery } from "@tanstack/react-query";
import { ChevronDown, ChevronUp, Package } from "lucide-react";
import { api } from "../../lib/api";
import { Button } from "../ui/button";
import { MaterialSummary } from "../../pages/staff/inventory/types";

type MaterialsSummaryProps = {
  expanded: boolean;
  onToggle: () => void;
};

export default function MaterialsSummary({ expanded, onToggle }: MaterialsSummaryProps) {
  const summaryQuery = useQuery({
    queryKey: ["inventory", "materials", "summary"],
    queryFn: async () => {
      const response = await api.get<{ materials?: MaterialSummary[]; summary?: MaterialSummary[] }>(
        "/api/inventory/materials/summary"
      );
      return response.data.materials ?? response.data.summary ?? [];
    }
  });

  return (
    <div className="rounded-lg border border-slate-200 bg-slate-50 p-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-3">
          <Package className="h-5 w-5 text-red-700" />
          <div>
            <h3 className="font-semibold text-slate-950">Raw Materials Stock</h3>
            <p className="text-sm text-slate-500">Click to expand current stock levels</p>
          </div>
          <span className="rounded-full bg-white px-2.5 py-1 text-xs font-semibold text-slate-700 ring-1 ring-slate-200">
            {summaryQuery.data?.length ?? 0} materials
          </span>
        </div>
        <Button size="sm" variant="outline" onClick={onToggle}>
          {expanded ? <ChevronUp className="mr-2 h-4 w-4" /> : <ChevronDown className="mr-2 h-4 w-4" />}
          {expanded ? "See Less" : "See More"}
        </Button>
      </div>

      {summaryQuery.isLoading && <p className="mt-4 text-sm text-slate-500">Loading stock summary...</p>}
      {summaryQuery.isError && <p className="mt-4 text-sm text-red-700">Unable to load stock summary.</p>}
      {expanded && summaryQuery.data && (
        <div className="mt-4 grid gap-3 sm:grid-cols-2 md:grid-cols-4 xl:grid-cols-6">
          {summaryQuery.data.map((material) => (
            <div key={material.id} className="rounded-md border border-slate-200 bg-white p-3">
              <p className="truncate text-sm font-semibold text-slate-950">{material.name}</p>
              <p className="mt-1 text-sm text-slate-600">
                {Number(material.current_stock).toLocaleString()} {material.unit}
              </p>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

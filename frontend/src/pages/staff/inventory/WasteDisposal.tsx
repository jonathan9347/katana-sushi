import { FormEvent, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Trash2 } from "lucide-react";
import { api } from "../../../lib/api";
import { Button } from "../../../components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "../../../components/ui/card";
import { Select } from "../../../components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "../../../components/ui/table";
import { useToast } from "../../../hooks/useToast";
import { InventoryTransaction, MaterialBatch, RawMaterial } from "./types";

type WasteForm = {
  raw_material_id: string;
  batch_id: string;
  quantity: string;
  reason: "spoilage" | "expired" | "prep_waste" | "damaged" | "other";
  notes: string;
};

const emptyWasteForm: WasteForm = {
  raw_material_id: "",
  batch_id: "",
  quantity: "",
  reason: "spoilage",
  notes: ""
};

const reasonLabels: Record<WasteForm["reason"], string> = {
  spoilage: "Spoilage",
  expired: "Expired",
  prep_waste: "Prep waste",
  damaged: "Damaged",
  other: "Other"
};

export default function WasteDisposal() {
  const [wasteForm, setWasteForm] = useState<WasteForm>(emptyWasteForm);
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const materialsQuery = useQuery({
    queryKey: ["inventory", "materials"],
    queryFn: async () => {
      const response = await api.get<{ materials: RawMaterial[] }>("/api/inventory/materials");
      return response.data.materials;
    }
  });

  const batchesQuery = useQuery({
    queryKey: ["inventory", "batches", wasteForm.raw_material_id],
    queryFn: async () => {
      const response = await api.get<{ batches: MaterialBatch[] }>("/api/inventory/batches", {
        params: { materialId: wasteForm.raw_material_id }
      });
      return response.data.batches.filter((batch) => Number(batch.remaining_quantity) > 0);
    },
    enabled: Boolean(wasteForm.raw_material_id)
  });

  const wasteHistoryQuery = useQuery({
    queryKey: ["inventory", "waste-history"],
    queryFn: async () => {
      const response = await api.get<{ transactions: InventoryTransaction[] }>("/api/inventory/transactions", {
        params: { type: "waste", limit: 50 }
      });
      return response.data.transactions;
    }
  });

  const disposeMutation = useMutation({
    mutationFn: async () =>
      api.post("/api/inventory/waste", {
        raw_material_id: wasteForm.raw_material_id,
        quantity: Number(wasteForm.quantity),
        reason: wasteForm.reason,
        notes: wasteForm.notes || undefined,
        batch_id: wasteForm.batch_id || undefined
      }),
    onSuccess: () => {
      setWasteForm(emptyWasteForm);
      queryClient.invalidateQueries({ queryKey: ["inventory"] });
      queryClient.invalidateQueries({ queryKey: ["analytics"] });
      toast("Product disposed and inventory updated.");
    },
    onError: (error: unknown) => {
      const message =
        error && typeof error === "object" && "response" in error
          ? (error as { response?: { data?: { message?: string } } }).response?.data?.message
          : undefined;
      toast(message ?? "Unable to record disposal.");
    }
  });

  const selectedMaterial = materialsQuery.data?.find((material) => material.id === wasteForm.raw_material_id);

  function handleSubmit(event: FormEvent) {
    event.preventDefault();
    disposeMutation.mutate();
  }

  return (
    <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)]">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Trash2 className="h-5 w-5" />
            Dispose / Waste Product
          </CardTitle>
        </CardHeader>
        <CardContent>
          <form className="grid gap-4" onSubmit={handleSubmit}>
            <label className="grid gap-1 text-sm">
              Material
              <Select
                required
                value={wasteForm.raw_material_id}
                onChange={(event) =>
                  setWasteForm((current) => ({
                    ...current,
                    raw_material_id: event.target.value,
                    batch_id: ""
                  }))
                }
              >
                <option value="">Select material</option>
                {materialsQuery.data?.map((material) => (
                  <option key={material.id} value={material.id}>
                    {material.name} — {Number(material.current_stock).toLocaleString()} {material.unit} in stock
                  </option>
                ))}
              </Select>
            </label>

            {wasteForm.raw_material_id && (
              <label className="grid gap-1 text-sm">
                Batch (optional — auto FEFO if not selected)
                <Select value={wasteForm.batch_id} onChange={(event) => setWasteForm((current) => ({ ...current, batch_id: event.target.value }))}>
                  <option value="">Auto (oldest expiring first)</option>
                  {batchesQuery.data?.map((batch) => (
                    <option key={batch.id} value={batch.id}>
                      {batch.batch_number} — {Number(batch.remaining_quantity).toLocaleString()} {batch.raw_material.unit}
                      {batch.expiration_date ? ` (exp: ${new Date(batch.expiration_date).toLocaleDateString()})` : ""}
                    </option>
                  ))}
                </Select>
              </label>
            )}

            <label className="grid gap-1 text-sm">
              Quantity to dispose
              <input
                required
                min="0.001"
                step="0.001"
                type="number"
                className="h-10 rounded-md border border-slate-300 px-3"
                value={wasteForm.quantity}
                onChange={(event) => setWasteForm((current) => ({ ...current, quantity: event.target.value }))}
              />
              {selectedMaterial && (
                <span className="text-xs text-slate-500">
                  Available: {Number(selectedMaterial.current_stock).toLocaleString()} {selectedMaterial.unit}
                </span>
              )}
            </label>

            <label className="grid gap-1 text-sm">
              Reason
              <Select
                required
                value={wasteForm.reason}
                onChange={(event) => setWasteForm((current) => ({ ...current, reason: event.target.value as WasteForm["reason"] }))}
              >
                {Object.entries(reasonLabels).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </Select>
            </label>

            <label className="grid gap-1 text-sm">
              Notes
              <input
                className="h-10 rounded-md border border-slate-300 px-3"
                placeholder="Additional details..."
                value={wasteForm.notes}
                onChange={(event) => setWasteForm((current) => ({ ...current, notes: event.target.value }))}
              />
            </label>

            <Button disabled={disposeMutation.isPending} type="submit" variant="danger">
              {disposeMutation.isPending ? "Processing..." : "Record Disposal"}
            </Button>
          </form>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Recent Waste & Disposal History</CardTitle>
        </CardHeader>
        <CardContent>
          {wasteHistoryQuery.isLoading && <p className="text-sm text-slate-500">Loading waste history...</p>}
          {wasteHistoryQuery.data?.length === 0 && !wasteHistoryQuery.isLoading && (
            <p className="text-sm text-slate-500">No waste or disposal records yet.</p>
          )}
          {!!wasteHistoryQuery.data?.length && (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Date</TableHead>
                    <TableHead>Material</TableHead>
                    <TableHead>Qty</TableHead>
                    <TableHead>Reason</TableHead>
                    <TableHead>Batch</TableHead>
                    <TableHead>By</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {wasteHistoryQuery.data.map((transaction) => (
                    <TableRow key={transaction.id}>
                      <TableCell>{new Date(transaction.created_at).toLocaleString()}</TableCell>
                      <TableCell className="font-medium">{transaction.raw_material.name}</TableCell>
                      <TableCell>
                        {Number(transaction.quantity).toLocaleString()} {transaction.unit}
                      </TableCell>
                      <TableCell>{transaction.reason ? reasonLabels[transaction.reason as WasteForm["reason"]] ?? transaction.reason : "—"}</TableCell>
                      <TableCell>{transaction.batch?.batch_number ?? "Auto FEFO"}</TableCell>
                      <TableCell>{transaction.user?.name ?? "System"}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

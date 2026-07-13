import { FormEvent, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, CalendarClock, PackagePlus } from "lucide-react";
import { api } from "../../../lib/api";
import { Button } from "../../../components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "../../../components/ui/card";
import { Dialog } from "../../../components/ui/dialog";
import { Select } from "../../../components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "../../../components/ui/table";
import { useToast } from "../../../hooks/useToast";
import { MaterialBatch, RawMaterial } from "./types";

type BatchForm = {
  raw_material_id: string;
  batch_number: string;
  quantity: string;
  expiration_date: string;
  cost_per_unit: string;
  notes: string;
};

const emptyBatchForm: BatchForm = {
  raw_material_id: "",
  batch_number: "",
  quantity: "",
  expiration_date: "",
  cost_per_unit: "",
  notes: ""
};

function expiryBadge(status: MaterialBatch["expiryStatus"]) {
  switch (status) {
    case "expired":
      return "bg-red-100 text-red-800";
    case "critical":
      return "bg-orange-100 text-orange-800";
    case "warning":
      return "bg-amber-100 text-amber-800";
    case "ok":
      return "bg-emerald-100 text-emerald-800";
    default:
      return "bg-slate-100 text-slate-600";
  }
}

function expiryLabel(status: MaterialBatch["expiryStatus"]) {
  switch (status) {
    case "expired":
      return "Expired";
    case "critical":
      return "Critical (≤3 days)";
    case "warning":
      return "Warning (≤7 days)";
    case "ok":
      return "OK";
    default:
      return "No expiry";
  }
}

export default function BatchManagement() {
  const [addOpen, setAddOpen] = useState(false);
  const [materialFilter, setMaterialFilter] = useState("");
  const [showExpiringOnly, setShowExpiringOnly] = useState(false);
  const [batchForm, setBatchForm] = useState<BatchForm>(emptyBatchForm);
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
    queryKey: ["inventory", "batches", materialFilter, showExpiringOnly],
    queryFn: async () => {
      const response = await api.get<{ batches: MaterialBatch[] }>("/api/inventory/batches", {
        params: {
          materialId: materialFilter || undefined,
          expiringWithinDays: showExpiringOnly ? 7 : undefined
        }
      });
      return response.data.batches;
    }
  });

  const expiringQuery = useQuery({
    queryKey: ["inventory", "batches", "expiring"],
    queryFn: async () => {
      const response = await api.get<{ batches: MaterialBatch[] }>("/api/inventory/batches/expiring", {
        params: { days: 7 }
      });
      return response.data.batches;
    }
  });

  const createBatchMutation = useMutation({
    mutationFn: async () =>
      api.post("/api/inventory/batches", {
        raw_material_id: batchForm.raw_material_id,
        batch_number: batchForm.batch_number,
        quantity: Number(batchForm.quantity),
        expiration_date: batchForm.expiration_date || undefined,
        cost_per_unit: batchForm.cost_per_unit ? Number(batchForm.cost_per_unit) : undefined,
        notes: batchForm.notes || undefined
      }),
    onSuccess: () => {
      setAddOpen(false);
      setBatchForm(emptyBatchForm);
      queryClient.invalidateQueries({ queryKey: ["inventory"] });
      toast("Batch received and stock updated.");
    },
    onError: (error: unknown) => {
      const message =
        error && typeof error === "object" && "response" in error
          ? (error as { response?: { data?: { message?: string } } }).response?.data?.message
          : undefined;
      toast(message ?? "Unable to receive batch.");
    }
  });

  const expiringCount = expiringQuery.data?.length ?? 0;
  const expiredCount = useMemo(
    () => (expiringQuery.data ?? []).filter((batch) => batch.expiryStatus === "expired").length,
    [expiringQuery.data]
  );

  function handleMaterialChange(materialId: string) {
    const material = materialsQuery.data?.find((entry) => entry.id === materialId);
    setBatchForm((current) => ({
      ...current,
      raw_material_id: materialId,
      cost_per_unit: material ? String(material.cost_per_unit) : ""
    }));
  }

  function handleSubmit(event: FormEvent) {
    event.preventDefault();
    createBatchMutation.mutate();
  }

  return (
    <div className="grid gap-5">
      {(expiringCount > 0 || expiredCount > 0) && (
        <Card className="border-amber-200 bg-amber-50">
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-amber-950">
              <AlertTriangle className="h-5 w-5" />
              Expiration Alerts
            </CardTitle>
          </CardHeader>
          <CardContent className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {expiringQuery.data?.map((batch) => (
              <div
                key={batch.id}
                className={`rounded-lg border p-4 ${batch.expiryStatus === "expired" ? "border-red-200 bg-red-50" : "border-amber-200 bg-white"} text-slate-900`}
              >
                <p className="font-semibold text-slate-950">{batch.raw_material.name}</p>
                <p className="mt-1 text-sm text-slate-600">
                  Batch {batch.batch_number} · {Number(batch.remaining_quantity).toLocaleString()} {batch.raw_material.unit}
                </p>
                <p className="mt-1 text-sm font-medium">
                  {batch.expiration_date && batch.daysUntilExpiry !== null && batch.daysUntilExpiry !== undefined
                    ? batch.daysUntilExpiry < 0
                      ? `Expired ${Math.abs(batch.daysUntilExpiry)} day(s) ago`
                      : `Expires in ${batch.daysUntilExpiry} day(s) — ${new Date(batch.expiration_date).toLocaleDateString()}`
                    : batch.expiration_date
                    ? `Expires ${new Date(batch.expiration_date).toLocaleDateString()}`
                    : "No expiration date"}
                </p>
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader className="flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
          <CardTitle className="flex items-center gap-2">
            <CalendarClock className="h-5 w-5" />
            Batch & Expiration Tracking
          </CardTitle>
          <div className="flex flex-wrap gap-2">
            <Select value={materialFilter} onChange={(event) => setMaterialFilter(event.target.value)}>
              <option value="">All materials</option>
              {materialsQuery.data?.map((material) => (
                <option key={material.id} value={material.id}>
                  {material.name}
                </option>
              ))}
            </Select>
            <Button variant={showExpiringOnly ? "default" : "outline"} onClick={() => setShowExpiringOnly((current) => !current)}>
              Expiring within 7 days
            </Button>
            <Button onClick={() => setAddOpen(true)}>
              <PackagePlus className="mr-2 h-4 w-4" />
              Receive Batch
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          {batchesQuery.isLoading && <p className="text-sm text-slate-500">Loading batches...</p>}
          {batchesQuery.isError && <p className="text-sm text-red-700">Unable to load batches.</p>}
          {batchesQuery.data?.length === 0 && !batchesQuery.isLoading && (
            <p className="text-sm text-slate-500">No batches found. Receive stock with a batch number and expiration date.</p>
          )}
          {!!batchesQuery.data?.length && (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Material</TableHead>
                    <TableHead>Batch #</TableHead>
                    <TableHead>Remaining</TableHead>
                    <TableHead>Received</TableHead>
                    <TableHead>Expiration</TableHead>
                    <TableHead>Status</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {batchesQuery.data.map((batch) => (
                    <TableRow key={batch.id}>
                      <TableCell className="font-medium">{batch.raw_material.name}</TableCell>
                      <TableCell>{batch.batch_number}</TableCell>
                      <TableCell>
                        {Number(batch.remaining_quantity).toLocaleString()} / {Number(batch.quantity).toLocaleString()} {batch.raw_material.unit}
                      </TableCell>
                      <TableCell>{new Date(batch.received_at).toLocaleDateString()}</TableCell>
                      <TableCell>{batch.expiration_date ? new Date(batch.expiration_date).toLocaleDateString() : "—"}</TableCell>
                      <TableCell>
                        <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${expiryBadge(batch.expiryStatus)}`}>
                          {expiryLabel(batch.expiryStatus)}
                        </span>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      <Dialog open={addOpen} title="Receive New Batch" onClose={() => setAddOpen(false)}>
        <form className="grid gap-4" onSubmit={handleSubmit}>
          <label className="grid gap-1 text-sm">
            Material
            <Select required value={batchForm.raw_material_id} onChange={(event) => handleMaterialChange(event.target.value)}>
              <option value="">Select material</option>
              {materialsQuery.data?.map((material) => (
                <option key={material.id} value={material.id}>
                  {material.name} ({material.unit})
                </option>
              ))}
            </Select>
          </label>
          <label className="grid gap-1 text-sm">
            Batch number
            <input
              required
              className="h-10 rounded-md border border-slate-300 px-3"
              placeholder="e.g. BATCH-2026-001"
              value={batchForm.batch_number}
              onChange={(event) => setBatchForm((current) => ({ ...current, batch_number: event.target.value }))}
            />
          </label>
          <label className="grid gap-1 text-sm">
            Quantity
            <input
              required
              min="0.001"
              step="0.001"
              type="number"
              className="h-10 rounded-md border border-slate-300 px-3"
              value={batchForm.quantity}
              onChange={(event) => setBatchForm((current) => ({ ...current, quantity: event.target.value }))}
            />
          </label>
          <label className="grid gap-1 text-sm">
            Expiration date
            <input
              type="date"
              className="h-10 rounded-md border border-slate-300 px-3"
              value={batchForm.expiration_date}
              onChange={(event) => setBatchForm((current) => ({ ...current, expiration_date: event.target.value }))}
            />
          </label>
          <label className="grid gap-1 text-sm">
            Cost per unit (optional)
            <input
              min="0"
              step="0.01"
              type="number"
              className="h-10 rounded-md border border-slate-300 px-3"
              value={batchForm.cost_per_unit}
              onChange={(event) => setBatchForm((current) => ({ ...current, cost_per_unit: event.target.value }))}
            />
          </label>
          <label className="grid gap-1 text-sm">
            Notes
            <input
              className="h-10 rounded-md border border-slate-300 px-3"
              placeholder="Supplier, delivery reference..."
              value={batchForm.notes}
              onChange={(event) => setBatchForm((current) => ({ ...current, notes: event.target.value }))}
            />
          </label>
          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={() => setAddOpen(false)}>
              Cancel
            </Button>
            <Button disabled={createBatchMutation.isPending} type="submit">
              {createBatchMutation.isPending ? "Saving..." : "Receive Batch"}
            </Button>
          </div>
        </form>
      </Dialog>
    </div>
  );
}

import { FormEvent, useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import axios from "axios";
import { AlertCircle, AlertTriangle, CalendarClock, CheckCircle2, LoaderCircle, PackagePlus, TriangleAlert } from "lucide-react";
import { api } from "../../../lib/api";
import { Button } from "../../../components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "../../../components/ui/card";
import { Dialog } from "../../../components/ui/dialog";
import { Select } from "../../../components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "../../../components/ui/table";
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
  cost_per_unit: "0",
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

function costDisplayFactor(unit: string) {
  return ["g", "ml"].includes(unit.trim().toLowerCase()) ? 100 : 1;
}

function costInputValue(costPerBaseUnit: string | number, unit: string) {
  return String(Number((Number(costPerBaseUnit) * costDisplayFactor(unit)).toFixed(8)));
}

function costDisplayUnit(unit: string) {
  const normalized = unit.trim().toLowerCase();
  if (normalized === "g") return "100 g";
  if (normalized === "ml") return "100 ml";
  return unit;
}

function isExpired(batch: MaterialBatch) {
  if (batch.expiryStatus === "expired" || (batch.daysUntilExpiry !== null && batch.daysUntilExpiry !== undefined && batch.daysUntilExpiry < 0)) {
    return true;
  }
  if (!batch.expiration_date) return false;

  const today = new Date();
  const todayStart = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  const expiryDateValue = new Date(batch.expiration_date);
  const expiryStart = new Date(expiryDateValue.getFullYear(), expiryDateValue.getMonth(), expiryDateValue.getDate());
  return expiryStart.getTime() < todayStart.getTime();
}

function isExpiryToday(batch: MaterialBatch) {
  if (batch.daysUntilExpiry === 0) return true;
  if (!batch.expiration_date) return false;

  const today = new Date();
  const todayStart = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  const expiryDateValue = new Date(batch.expiration_date);
  const expiryStart = new Date(expiryDateValue.getFullYear(), expiryDateValue.getMonth(), expiryDateValue.getDate());
  return expiryStart.getTime() === todayStart.getTime();
}

type BatchSortMode = "received" | "expiration";

export default function BatchManagement({
  initialExpiringOnly = false,
  onExpiringOnlyChange,
  onQuickDispose
}: {
  initialExpiringOnly?: boolean;
  onExpiringOnlyChange?: (value: boolean) => void;
  onQuickDispose?: (batch: MaterialBatch) => void;
}) {
  const [addOpen, setAddOpen] = useState(false);
  const [materialFilter, setMaterialFilter] = useState("");
  const [showExpiringOnly, setShowExpiringOnly] = useState(initialExpiringOnly);
  const [batchSortMode, setBatchSortMode] = useState<BatchSortMode>("received");
  const [batchForm, setBatchForm] = useState<BatchForm>(emptyBatchForm);
  const [submissionNotice, setSubmissionNotice] = useState<{
    type: "success" | "warning" | "error";
    message: string;
  } | null>(null);
  const queryClient = useQueryClient();

  useEffect(() => {
    setShowExpiringOnly(initialExpiringOnly);
  }, [initialExpiringOnly]);

  const toggleExpiringOnly = () => {
    const nextValue = !showExpiringOnly;
    setShowExpiringOnly(nextValue);
    onExpiringOnlyChange?.(nextValue);
  };

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

  const sortedBatches = useMemo(() => {
    const batches = [...(batchesQuery.data ?? [])];
    return batches.sort((a, b) => {
      const leftDate = new Date(a.received_at).getTime();
      const rightDate = new Date(b.received_at).getTime();
      if (batchSortMode === "expiration") {
        const leftExpiry = a.expiration_date ? new Date(a.expiration_date).getTime() : Number.POSITIVE_INFINITY;
        const rightExpiry = b.expiration_date ? new Date(b.expiration_date).getTime() : Number.POSITIVE_INFINITY;
        if (leftExpiry !== rightExpiry) {
          return leftExpiry - rightExpiry;
        }
        return leftDate - rightDate;
      }
      return rightDate - leftDate;
    });
  }, [batchesQuery.data, batchSortMode]);

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
      api.post<{ warning?: string }>("/api/inventory/batches", {
        raw_material_id: batchForm.raw_material_id,
        batch_number: batchForm.batch_number,
        quantity: Number(batchForm.quantity),
        expiration_date: batchForm.expiration_date,
        cost_per_unit: Number(batchForm.cost_per_unit) / costDisplayFactor(
          materialsQuery.data?.find((material) => material.id === batchForm.raw_material_id)?.unit ?? ""
        ),
        notes: batchForm.notes || undefined
      }, { timeout: 60000 }),
    onSuccess: (response) => {
      setAddOpen(false);
      setBatchForm(emptyBatchForm);
      queryClient.invalidateQueries({ queryKey: ["inventory"] });
      setSubmissionNotice(response.data.warning
        ? { type: "warning", message: `Batch received and stock updated. ${response.data.warning}` }
        : { type: "success", message: "Batch received and stock updated." });
    },
    onError: async (error: unknown) => {
      const serverMessage = axios.isAxiosError<{ message?: string }>(error)
        ? error.response?.data?.message
        : undefined;
      const timedOut = axios.isAxiosError(error) && (error.code === "ECONNABORTED" || error.code === "ETIMEDOUT");
      await queryClient.invalidateQueries({ queryKey: ["inventory"] });
      setSubmissionNotice({
        type: "error",
        message: serverMessage ?? (timedOut
          ? "The request timed out before receipt was confirmed. Check the batch list before retrying; stock may already have been updated."
          : "Could not confirm receipt. Check the batch list before retrying; stock may already have been updated.")
      });
    }
  });

  const expiringCount = expiringQuery.data?.length ?? 0;
  const expiredCount = useMemo(
    () => (expiringQuery.data ?? []).filter((batch) => batch.expiryStatus === "expired").length,
    [expiringQuery.data]
  );
  const selectedBatchMaterial = materialsQuery.data?.find((material) => material.id === batchForm.raw_material_id);

  function handleMaterialChange(materialId: string) {
    const material = materialsQuery.data?.find((entry) => entry.id === materialId);
    setBatchForm((current) => ({
      ...current,
      raw_material_id: materialId,
      cost_per_unit: material ? costInputValue(material.cost_per_unit, material.unit) : "0"
    }));
  }

  function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setSubmissionNotice(null);
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
            {expiringQuery.data?.map((batch) => {
              const expired = isExpired(batch);
              const expiresToday = isExpiryToday(batch);
              const canDisposeNow = (expired || expiresToday) && Number(batch.remaining_quantity) > 0;
              return (
                <div
                  key={batch.id}
                  className={`rounded-lg border p-4 ${expired || expiresToday ? "border-red-200 bg-red-50" : "border-amber-200 bg-white"} text-slate-900`}
                >
                  <p className="font-semibold text-slate-950">{batch.raw_material.name}</p>
                  <p className="mt-1 text-sm text-slate-600">
                    Batch {batch.batch_number} · {Number(batch.remaining_quantity).toLocaleString()} {batch.raw_material.unit}
                  </p>
                  <p className={`mt-1 text-sm font-medium ${expired || expiresToday ? "text-red-700" : "text-slate-700"}`}>
                    {batch.expiration_date
                      ? expired
                        ? `Expired — ${new Date(batch.expiration_date).toLocaleDateString()}`
                        : expiresToday
                          ? `Expires today — ${new Date(batch.expiration_date).toLocaleDateString()}`
                          : batch.daysUntilExpiry !== null && batch.daysUntilExpiry !== undefined
                           ? `Expires in ${batch.daysUntilExpiry} day(s) — ${new Date(batch.expiration_date).toLocaleDateString()}`
                           : `Expires ${new Date(batch.expiration_date).toLocaleDateString()}`
                      : "No expiration date"}
                  </p>
                  {canDisposeNow && onQuickDispose && (
                    <Button type="button" variant="danger" size="sm" className="mt-3" onClick={() => onQuickDispose(batch)}>
                      Dispose Now
                    </Button>
                  )}
                </div>
              );
            })}
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
            <Button
              variant={batchSortMode === "expiration" ? "default" : "outline"}
              onClick={() => setBatchSortMode((current) => current === "received" ? "expiration" : "received")}
            >
              {batchSortMode === "expiration" ? "Sort by Received Date" : "Sort by Expiration"}
            </Button>
            <Button variant={showExpiringOnly ? "default" : "outline"} onClick={toggleExpiringOnly}>
              Expiring within 7 days
            </Button>
            <Button onClick={() => {
              setSubmissionNotice(null);
              setAddOpen(true);
            }}>
              <PackagePlus className="mr-2 h-4 w-4" />
              Receive Batch
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          {batchesQuery.isLoading && <p className="text-sm text-slate-500">Loading batches...</p>}
          {batchesQuery.isError && <p className="text-sm text-red-700">Unable to load batches.</p>}
          {sortedBatches.length === 0 && !batchesQuery.isLoading && (
            <p className="text-sm text-slate-500">No batches found. Receive stock with a batch number and expiration date.</p>
          )}
          {!!sortedBatches.length && (
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
                    <TableHead>Action</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {sortedBatches.map((batch) => {
                    const expired = isExpired(batch);
                    const expiresToday = isExpiryToday(batch);
                    const expiredOrToday = expired || expiresToday;
                    const canDisposeNow = expiredOrToday && Number(batch.remaining_quantity) > 0;
                    return (
                      <TableRow key={batch.id} className={expiredOrToday ? "bg-red-50/80" : undefined}>
                        <TableCell className="font-medium">{batch.raw_material.name}</TableCell>
                        <TableCell>{batch.batch_number}</TableCell>
                        <TableCell>
                          {Number(batch.remaining_quantity).toLocaleString()} / {Number(batch.quantity).toLocaleString()} {batch.raw_material.unit}
                        </TableCell>
                        <TableCell>{new Date(batch.received_at).toLocaleDateString()}</TableCell>
                        <TableCell className={expiredOrToday ? "font-semibold text-red-700" : undefined}>
                          {batch.expiration_date ? new Date(batch.expiration_date).toLocaleDateString() : "—"}
                        </TableCell>
                        <TableCell>
                          <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${expiryBadge(batch.expiryStatus)}`}>
                            {expiryLabel(batch.expiryStatus)}
                          </span>
                        </TableCell>
                        <TableCell>
                          {canDisposeNow && onQuickDispose ? (
                            <Button type="button" variant="danger" size="sm" onClick={() => onQuickDispose(batch)}>
                              Dispose Now
                            </Button>
                          ) : (
                            <span className="text-xs text-slate-400">—</span>
                          )}
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      {submissionNotice && (
        <div
          className={`batch-submission-feedback is-${submissionNotice.type}`}
          role={submissionNotice.type === "error" ? "alert" : "status"}
          aria-live={submissionNotice.type === "error" ? "assertive" : "polite"}
        >
          {submissionNotice.type === "success" && <CheckCircle2 aria-hidden="true" />}
          {submissionNotice.type === "warning" && <TriangleAlert aria-hidden="true" />}
          {submissionNotice.type === "error" && <AlertCircle aria-hidden="true" />}
          <span>{submissionNotice.message}</span>
        </div>
      )}

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
              min="1"
              step="1"
              type="number"
              className="h-10 rounded-md border border-slate-300 px-3"
              value={batchForm.quantity}
              onChange={(event) => setBatchForm((current) => ({ ...current, quantity: event.target.value }))}
            />
          </label>
          <label className="grid gap-1 text-sm">
            Expiration date
            <input
              required
              type="date"
              className="h-10 rounded-md border border-slate-300 px-3"
              value={batchForm.expiration_date}
              onChange={(event) => setBatchForm((current) => ({ ...current, expiration_date: event.target.value }))}
            />
          </label>
          <label className="grid gap-1 text-sm">
            Cost per {selectedBatchMaterial ? costDisplayUnit(selectedBatchMaterial.unit) : "base unit"}
            <input
              required
              inputMode="decimal"
              pattern="[0-9]+([.][0-9]+)?"
              type="text"
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
            <Button className="batch-submit-button" disabled={createBatchMutation.isPending} type="submit">
              {createBatchMutation.isPending
                ? <><LoaderCircle aria-hidden="true" className="batch-submit-spinner" /> Receiving batch…</>
                : <><PackagePlus aria-hidden="true" /> Receive Batch</>}
            </Button>
          </div>
          {createBatchMutation.isPending && (
            <div className="batch-submission-feedback is-pending" role="status" aria-live="polite">
              <LoaderCircle aria-hidden="true" className="batch-submit-spinner" />
              <span>Saving the batch and updating inventory. This may take a little while.</span>
            </div>
          )}
        </form>
      </Dialog>
    </div>
  );
}

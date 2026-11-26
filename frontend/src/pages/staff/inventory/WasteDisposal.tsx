import { ChangeEvent, FormEvent, useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import axios from "axios";
import { AlertCircle, CheckCircle2, LoaderCircle, Trash2, TriangleAlert } from "lucide-react";
import { api } from "../../../lib/api";
import { Button } from "../../../components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "../../../components/ui/card";
import { Select } from "../../../components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "../../../components/ui/table";
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

export default function WasteDisposal({
  initialForm,
  onPreloadConsumed
}: {
  initialForm?: Partial<WasteForm>;
  onPreloadConsumed?: () => void;
}) {
  const [wasteForm, setWasteForm] = useState<WasteForm>({
    ...emptyWasteForm,
    ...initialForm,
    reason: initialForm?.reason ?? emptyWasteForm.reason,
    notes: initialForm?.notes ?? emptyWasteForm.notes,
    quantity: initialForm?.quantity ? String(initialForm.quantity) : emptyWasteForm.quantity
  });
  const queryClient = useQueryClient();
  const [submissionNotice, setSubmissionNotice] = useState<{
    type: "success" | "warning" | "error";
    message: string;
  } | null>(null);

  useEffect(() => {
    if (!initialForm) {
      return;
    }

    setWasteForm({
      ...emptyWasteForm,
      raw_material_id: initialForm.raw_material_id ?? "",
      batch_id: initialForm.batch_id ?? "",
      quantity: initialForm.quantity ? String(initialForm.quantity) : "",
      reason: initialForm.reason ?? "expired",
      notes: initialForm.notes ?? "",
    });
  }, [initialForm]);

  const materialsQuery = useQuery({
    queryKey: ["inventory", "materials"],
    queryFn: async () => {
      const response = await api.get<{
        materials: Array<RawMaterial & { available_quantity: string | number }>;
      }>("/api/inventory/materials");
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

  const selectedBatch = wasteForm.batch_id
    ? batchesQuery.data?.find((batch) => batch.id === wasteForm.batch_id)
    : undefined;
  const maxDisposalQuantity = selectedBatch ? Number(selectedBatch.remaining_quantity) : undefined;

  const disposeMutation = useMutation({
    mutationFn: async () =>
      api.post<{ warning?: string }>("/api/inventory/waste", {
        raw_material_id: wasteForm.raw_material_id,
        quantity: Number(wasteForm.quantity),
        reason: wasteForm.reason,
        notes: wasteForm.notes,
        batch_id: wasteForm.batch_id || undefined
      }, { timeout: 60000 }),
    onSuccess: (response) => {
      setWasteForm(emptyWasteForm);
      onPreloadConsumed?.();
      queryClient.invalidateQueries({ queryKey: ["inventory"] });
      queryClient.invalidateQueries({ queryKey: ["analytics"] });
      setSubmissionNotice(response.data.warning
        ? { type: "warning", message: `Waste recorded and stock updated. ${response.data.warning}` }
        : { type: "success", message: "Waste recorded and stock updated." });
    },
    onError: (error: unknown) => {
      const serverMessage = axios.isAxiosError<{ message?: string }>(error)
        ? error.response?.data?.message
        : undefined;
      const timedOut = axios.isAxiosError(error) && (error.code === "ECONNABORTED" || error.code === "ETIMEDOUT");
      setSubmissionNotice({
        type: "error",
        message: serverMessage ?? (timedOut
          ? "The request timed out before the result was confirmed. Check Recent Waste & Disposal History before trying again."
          : "We couldn't confirm the result. Check Recent Waste & Disposal History before trying again.")
      });
    }
  });

  const selectedMaterial = materialsQuery.data?.find((material) => material.id === wasteForm.raw_material_id);

  function handleSubmit(event: FormEvent) {
    event.preventDefault();

    if (maxDisposalQuantity !== undefined && Number(wasteForm.quantity) > maxDisposalQuantity) {
      setWasteForm((current) => ({
        ...current,
        quantity: String(maxDisposalQuantity)
      }));
      setSubmissionNotice({
        type: "error",
        message: `The selected batch only has ${maxDisposalQuantity} ${selectedMaterial?.unit ?? "units"} left.`
      });
      return;
    }

    setSubmissionNotice(null);
    disposeMutation.mutate();
  }

  function handleQuantityChange(event: ChangeEvent<HTMLInputElement>) {
    const nextValue = event.target.value;
    if (maxDisposalQuantity !== undefined && nextValue !== "") {
      const numericValue = Number(nextValue);
      if (!Number.isNaN(numericValue)) {
        const clampedValue = Math.min(Math.max(Math.round(numericValue), 1), maxDisposalQuantity);
        setWasteForm((current) => ({ ...current, quantity: String(clampedValue) }));
        return;
      }
    }
    setWasteForm((current) => ({ ...current, quantity: nextValue }));
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
                    {material.name} — {Number(material.available_quantity).toLocaleString()} {material.unit} available
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
                min="1"
                max={maxDisposalQuantity ?? undefined}
                step="1"
                type="number"
                className="h-10 rounded-md border border-slate-300 px-3"
                value={wasteForm.quantity}
                onChange={handleQuantityChange}
              />
              {selectedMaterial && (
                <span className="text-xs text-slate-500">
                  Available: {Number(selectedMaterial.available_quantity).toLocaleString()} {selectedMaterial.unit}
                  {maxDisposalQuantity !== undefined && ` · Selected batch remaining: ${Number(maxDisposalQuantity).toLocaleString()}`}
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
                required
                className="h-10 rounded-md border border-slate-300 px-3"
                placeholder="Additional details..."
                value={wasteForm.notes}
                onChange={(event) => setWasteForm((current) => ({ ...current, notes: event.target.value }))}
              />
            </label>

            <Button className="waste-submit-button" disabled={disposeMutation.isPending} type="submit" variant="danger">
              {disposeMutation.isPending
                ? <><LoaderCircle aria-hidden="true" className="waste-submit-spinner" /> Recording disposal…</>
                : <><Trash2 aria-hidden="true" /> Record disposal</>}
            </Button>
            {disposeMutation.isPending && (
              <div className="waste-submission-feedback is-pending" role="status" aria-live="polite">
                <LoaderCircle aria-hidden="true" className="waste-feedback-spinner" />
                <span>Saving the disposal and updating inventory. This may take a little while.</span>
              </div>
            )}
            {submissionNotice && (
              <div
                className={`waste-submission-feedback is-${submissionNotice.type}`}
                role={submissionNotice.type === "error" ? "alert" : "status"}
                aria-live={submissionNotice.type === "error" ? "assertive" : "polite"}
              >
                {submissionNotice.type === "success" && <CheckCircle2 aria-hidden="true" />}
                {submissionNotice.type === "warning" && <TriangleAlert aria-hidden="true" />}
                {submissionNotice.type === "error" && <AlertCircle aria-hidden="true" />}
                <span>{submissionNotice.message}</span>
              </div>
            )}
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
                    <TableHead>Notes / booking</TableHead>
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
                      <TableCell>{transaction.reference ?? "—"}</TableCell>
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

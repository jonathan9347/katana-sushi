import { FormEvent, useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ClipboardCheck, Edit, PackagePlus, Search, Trash2 } from "lucide-react";
import { api } from "../../../lib/api";
import { formatManilaDate, todayManilaDateKey } from "../../../lib/dateTime";
import { Button } from "../../../components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "../../../components/ui/card";
import { Dialog } from "../../../components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "../../../components/ui/table";
import { useToast } from "../../../hooks/useToast";
import { MaterialBatch, RawMaterial, StaffRole } from "./types";

type MaterialsListProps = {
  role: StaffRole;
  onNavigateStockView?: (view: "batches" | "waste") => void;
  onOpenReservations?: () => void;
  initialStockFilter?: StockFilter;
};

type MaterialForm = {
  name: string;
  category: "Beverage" | "Raw Material";
  unit: string;
  reorder_level: string;
  cost_per_unit: string;
};

type StockCountForm = {
  raw_material_id: string;
  physical_count: string;
  reason: string;
  batch_number: string;
  expiration_date: string;
  cost_per_unit: string;
};

type CategoryFilter = "all" | "Beverage" | "Raw Material";
type StockFilter = "all" | "issues" | "low" | "negative" | "expiring";

const emptyStockCountForm: StockCountForm = {
  raw_material_id: "",
  physical_count: "",
  reason: "",
  batch_number: "",
  expiration_date: "",
  cost_per_unit: ""
};

const emptyMaterialForm: MaterialForm = {
  name: "",
  category: "Raw Material",
  unit: "g",
  reorder_level: "0",
  cost_per_unit: "0"
};

function costDisplayFactor(unit: string) {
  return ["g", "ml"].includes(unit.trim().toLowerCase()) ? 100 : 1;
}

function costDisplayUnit(unit: string) {
  const normalized = unit.trim().toLowerCase();
  if (normalized === "g") return "100 g";
  if (normalized === "ml") return "100 ml";
  return unit;
}

function formatCostPerDisplayUnit(costPerBaseUnit: string | number, unit: string) {
  return `PHP ${(Number(costPerBaseUnit) * costDisplayFactor(unit)).toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: costDisplayFactor(unit) === 100 ? 6 : 8
  })}/${costDisplayUnit(unit)}`;
}

function formFromMaterial(material: RawMaterial): MaterialForm {
  return {
    name: material.name,
    category: material.category ?? "Raw Material",
    unit: material.unit,
    reorder_level: String(material.reorder_level),
    cost_per_unit: String(material.cost_per_unit)
  };
}

export default function MaterialsList({ role, onNavigateStockView, onOpenReservations, initialStockFilter = "all" }: MaterialsListProps) {
  const [search, setSearch] = useState("");
  const [categoryFilter, setCategoryFilter] = useState<CategoryFilter>("all");
  const [stockFilter, setStockFilter] = useState<StockFilter>(initialStockFilter);
  const [addOpen, setAddOpen] = useState(false);
  const [editDialogOpen, setEditDialogOpen] = useState(false);
  const [editMaterial, setEditMaterial] = useState<RawMaterial | null>(null);
  const [detailsMaterial, setDetailsMaterial] = useState<RawMaterial | null>(null);
  const [detailsTab, setDetailsTab] = useState<"batches" | "reservations" | "history" | "edit">("batches");
  const [materialForm, setMaterialForm] = useState<MaterialForm>(emptyMaterialForm);
  const [stockCountOpen, setStockCountOpen] = useState(false);
  const [stockCountForm, setStockCountForm] = useState<StockCountForm>(emptyStockCountForm);
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const isAdmin = role === "admin";
  const canManageStock = role === "admin" || role === "inventory_manager";

  useEffect(() => {
    setStockFilter(initialStockFilter);
  }, [initialStockFilter]);

  const materialsQuery = useQuery({
    queryKey: ["inventory", "materials"],
    queryFn: async () => {
      const response = await api.get<{
        materials: Array<RawMaterial & { available_quantity: string | number; reserved_quantity: string | number }>;
      }>("/api/inventory/materials");
      return response.data.materials;
    }
  });

  const detailsBatchesQuery = useQuery({
    queryKey: ["inventory", "batches", "material-details", detailsMaterial?.id],
    queryFn: async () => (await api.get<{ batches: MaterialBatch[] }>("/api/inventory/batches", {
      params: { materialId: detailsMaterial?.id }
    })).data.batches,
    enabled: Boolean(detailsMaterial && detailsTab === "batches")
  });
  const detailsMovementsQuery = useQuery({
    queryKey: ["inventory", "movements", "material-details", detailsMaterial?.id],
    queryFn: async () => (await api.get<{ movements: Array<{
      id: string;
      created_at: string;
      action: string;
      quantity: string | number;
      unit: string;
      source_reference: string | null;
      note: string | null;
      actor: { name: string } | null;
    }> }>("/api/inventory/movements", {
      params: { materialId: detailsMaterial?.id, from: "2000-01-01", to: todayManilaDateKey(), limit: 50 }
    })).data.movements,
    enabled: Boolean(detailsMaterial && detailsTab === "history")
  });

  function refreshInventoryQueries() {
    queryClient.invalidateQueries({ queryKey: ["inventory"] });
  }

  const createMaterialMutation = useMutation({
    mutationFn: async () =>
      api.post("/api/inventory/materials", {
        name: materialForm.name,
        category: materialForm.category,
        unit: materialForm.unit,
        reorder_level: Number(materialForm.reorder_level),
        cost_per_unit: Number(materialForm.cost_per_unit)
      }),
    onSuccess: () => {
      setAddOpen(false);
      setMaterialForm(emptyMaterialForm);
      refreshInventoryQueries();
      toast("Material added.");
    },
    onError: () => toast("Unable to add material.")
  });

  const updateMaterialMutation = useMutation({
    mutationFn: async () => {
      if (!editMaterial) {
        return null;
      }

      return api.put(`/api/inventory/materials/${editMaterial.id}`, {
        name: materialForm.name,
        category: materialForm.category,
        unit: materialForm.unit,
        reorder_level: Number(materialForm.reorder_level),
        cost_per_unit: Number(materialForm.cost_per_unit)
      });
    },
    onSuccess: () => {
      setEditMaterial(null);
      setEditDialogOpen(false);
      refreshInventoryQueries();
      toast("Material updated.");
    },
    onError: (error: unknown) => {
      const message =
        error && typeof error === "object" && "response" in error
          ? (error as { response?: { data?: { message?: string } } }).response?.data?.message
          : undefined;
      toast(message ?? "Unable to update material.");
    }
  });

  const deleteMaterialMutation = useMutation({
    mutationFn: async () => {
      if (!editMaterial) {
        return null;
      }

      return api.delete(`/api/inventory/materials/${editMaterial.id}`);
    },
    onSuccess: () => {
      setEditMaterial(null);
      refreshInventoryQueries();
      toast("Material deleted.");
    },
    onError: () => toast("Unable to delete material.")
  });

  const stockCountMutation = useMutation({
    mutationFn: async () => {
      const countedMaterial = materialsQuery.data?.find((material) => material.id === stockCountForm.raw_material_id);
      return api.post<{ adjusted: boolean; difference: number }>("/api/inventory/stock-count", {
        raw_material_id: stockCountForm.raw_material_id,
        physical_count: Number(stockCountForm.physical_count),
        reason: stockCountForm.reason,
        batch_number: stockCountForm.batch_number || undefined,
        expiration_date: stockCountForm.expiration_date || undefined,
        cost_per_unit: stockCountForm.cost_per_unit === "" || !countedMaterial
          ? undefined
          : Number(stockCountForm.cost_per_unit) / costDisplayFactor(countedMaterial.unit)
      });
    },
    onSuccess: ({ data }) => {
      setStockCountOpen(false);
      setStockCountForm(emptyStockCountForm);
      refreshInventoryQueries();
      toast(data.adjusted ? "Stock count recorded in inventory movements." : "Count matches the current on-hand quantity; no adjustment was needed.");
    },
    onError: (error: unknown) => {
      const message =
        error && typeof error === "object" && "response" in error
          ? (error as { response?: { data?: { message?: string } } }).response?.data?.message
          : undefined;
      toast(message ?? "Unable to record stock count.");
    }
  });

  const filteredMaterials = useMemo(() => {
    return (materialsQuery.data ?? []).filter((material) => {
      const matchesSearch = material.name.toLowerCase().includes(search.toLowerCase());
      const matchesCategory = categoryFilter === "all" || material.category === categoryFilter;
      const available = Number(material.available_quantity);
      const hasIssue = Boolean(material.batch_mismatch) || available < 0;
      const matchesStock =
        stockFilter === "all" ||
        (stockFilter === "issues" && hasIssue) ||
        (stockFilter === "low" && available <= Number(material.reorder_level)) ||
        (stockFilter === "negative" && available < 0) ||
        (stockFilter === "expiring" && material.expiring_within_7_days);
      return matchesSearch && matchesCategory && matchesStock;
    });
  }, [materialsQuery.data, search, categoryFilter, stockFilter]);

  const materialGroups = [
    { category: "Beverage" as const, materials: filteredMaterials.filter((material) => material.category === "Beverage") },
    { category: "Raw Material" as const, materials: filteredMaterials.filter((material) => material.category !== "Beverage") }
  ];

  function openAddModal() {
    setMaterialForm(emptyMaterialForm);
    setAddOpen(true);
  }

  function openEditModal(material: RawMaterial) {
    setMaterialForm(formFromMaterial(material));
    setEditMaterial(material);
    setEditDialogOpen(true);
  }

  function openDetails(material: RawMaterial) {
    setDetailsMaterial(material);
    setDetailsTab("batches");
    setEditMaterial(material);
    setMaterialForm(formFromMaterial(material));
  }

  function handleCreateMaterial(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    createMaterialMutation.mutate();
  }

  function handleUpdateMaterial(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    updateMaterialMutation.mutate();
  }

  function handleDeleteMaterial() {
    if (window.confirm("Are you sure? This will soft delete the material and hide it from all views.")) {
      deleteMaterialMutation.mutate();
    }
  }

  const stockCountMaterial = materialsQuery.data?.find((material) => material.id === stockCountForm.raw_material_id);
  const stockCountNeedsBatch =
    stockCountMaterial !== undefined &&
    Number(stockCountForm.physical_count) > Number(stockCountMaterial.current_stock);
  return (
    <Card>
      <CardHeader className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <div>
          <CardTitle>Raw Materials</CardTitle>
        </div>
        <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap">
          <label className="relative block">
            <Search className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-slate-400" />
            <input
              className="h-10 w-full rounded-md border border-slate-300 pl-9 pr-3 text-sm outline-none focus:border-red-700 focus:ring-2 focus:ring-red-100 sm:w-72"
              placeholder="Search materials"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
            />
          </label>
          <select
            className="h-10 rounded-md border border-slate-300 px-3 text-sm"
            value={categoryFilter}
            onChange={(event) => setCategoryFilter(event.target.value as CategoryFilter)}
            aria-label="Filter materials by category"
          >
            <option value="all">All categories</option>
            <option value="Raw Material">Raw materials</option>
            <option value="Beverage">Beverages</option>
          </select>
          <select
            className="h-10 rounded-md border border-slate-300 px-3 text-sm"
            value={stockFilter}
            onChange={(event) => setStockFilter(event.target.value as StockFilter)}
            aria-label="Filter materials by stock status"
          >
            <option value="all">All stock status</option>
            <option value="issues">Inconsistent or negative</option>
            <option value="low">At or below PAR level</option>
            <option value="negative">Negative available</option>
            <option value="expiring">Expiring within 7 days</option>
          </select>
          <div className="flex flex-wrap gap-2">
            {canManageStock && (
              <>
                <Button variant="outline" onClick={() => onNavigateStockView?.("batches")}>
                  <PackagePlus className="mr-2 h-4 w-4" />
                  Receive Stock
                </Button>
                <Button variant="outline" onClick={() => onNavigateStockView?.("waste")}>
                  <Trash2 className="mr-2 h-4 w-4" />
                  Record Waste
                </Button>
                <Button
                  variant="outline"
                  onClick={() => {
                    setStockCountForm(emptyStockCountForm);
                    setStockCountOpen(true);
                  }}
                >
                  <ClipboardCheck className="mr-2 h-4 w-4" />
                  Stock Count
                </Button>
              </>
            )}
            {isAdmin && <Button onClick={openAddModal}>Add New Material</Button>}
          </div>
        </div>
      </CardHeader>
      <CardContent>
        {materialsQuery.isLoading && <p className="text-sm text-slate-500">Loading materials...</p>}
        {materialsQuery.isError && <p className="text-sm text-red-700">Unable to load materials.</p>}
        {!materialsQuery.isLoading && !materialsQuery.isError && (
          <div className="grid gap-6">
            {materialGroups.map((group) => (
              <section key={group.category} className="grid gap-3">
                <h3 className="text-sm font-semibold uppercase text-slate-600">{group.category}s ({group.materials.length})</h3>
                {group.materials.length === 0 ? (
                  <p className="rounded-md border border-dashed border-slate-300 p-4 text-sm text-slate-500">
                    No {group.category.toLowerCase()} items found.
                  </p>
                ) : (
                  <div className="overflow-x-auto">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Name</TableHead>
                          <TableHead>Unit</TableHead>
                          <TableHead>On hand</TableHead>
                          <TableHead>Reserved</TableHead>
                          <TableHead>Available</TableHead>
                          <TableHead>PAR Level</TableHead>
                          <TableHead>Cost per 100 g, 100 ml, or item</TableHead>
                          <TableHead>Status</TableHead>
                          <TableHead>Actions</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {group.materials.map((material) => {
                          const reserved = Number(material.reserved_quantity);
                          const available = Number(material.available_quantity);
                          const isLowStock = available <= Number(material.reorder_level);
                          const batchMismatch = material.batch_mismatch ?? false;
                          const expiring = material.expiring_within_7_days ?? false;
                          const rowClass = batchMismatch || available < 0
                            ? "bg-red-50 text-red-950"
                            : isLowStock || expiring
                              ? "bg-amber-50 text-amber-950"
                              : "";
                          const status = batchMismatch
                            ? "Inconsistent"
                            : available < 0
                              ? "Negative"
                              : expiring
                                ? "Expiring"
                                : isLowStock
                                  ? "Low"
                                  : "OK";
                          const statusClass = batchMismatch || available < 0
                            ? "bg-red-100 text-red-800"
                            : expiring || isLowStock
                              ? "bg-amber-100 text-amber-800"
                              : "bg-emerald-100 text-emerald-800";

                          return (
                            <TableRow key={material.id} className={rowClass}>
                              <TableCell className="font-medium">
                                <button type="button" className="text-left underline-offset-2 hover:underline" onClick={() => openDetails(material)}>
                                  {material.name}
                                </button>
                              </TableCell>
                              <TableCell>{material.unit}</TableCell>
                              <TableCell>{Number(material.current_stock).toLocaleString()}</TableCell>
                              <TableCell>
                                {reserved > 0 ? (
                                  <button
                                    type="button"
                                    className="rounded-full bg-amber-50 px-2 py-1 text-xs font-bold text-amber-700 underline"
                                    onClick={() => {
                                      openDetails(material);
                                      setDetailsTab("reservations");
                                    }}
                                    aria-label={`Show bookings reserving ${material.name}`}
                                  >
                                    {reserved.toLocaleString()}
                                  </button>
                                ) : <span className="text-slate-500">0</span>}
                              </TableCell>
                              <TableCell className={available <= Number(material.reorder_level) ? "font-bold text-red-700" : ""}>
                                {available.toLocaleString()}
                                {batchMismatch && <p className="mt-1 text-xs font-semibold">Batch total does not match on hand.</p>}
                                {available < 0 && <p className="mt-1 text-xs font-semibold">Short by {Math.abs(available).toLocaleString()} {material.unit}.</p>}
                                {!batchMismatch && available >= 0 && isLowStock && <p className="mt-1 text-xs font-semibold">Below PAR level.</p>}
                              </TableCell>
                              <TableCell>{Number(material.reorder_level).toLocaleString()}</TableCell>
                              <TableCell>{formatCostPerDisplayUnit(material.cost_per_unit, material.unit)}</TableCell>
                              <TableCell><span className={`rounded-full px-2 py-1 text-xs font-semibold ${statusClass}`}>{status}</span></TableCell>
                              <TableCell>
                                {isAdmin && (
                                  <Button size="sm" variant="ghost" onClick={() => openEditModal(material)}>
                                    <Edit className="h-4 w-4" />
                                  </Button>
                                )}
                              </TableCell>
                            </TableRow>
                          );
                        })}
                      </TableBody>
                    </Table>
                  </div>
                )}
              </section>
            ))}
          </div>
        )}
      </CardContent>

      <Dialog open={addOpen} title="Add New Material" onClose={() => setAddOpen(false)}>
        <MaterialFields
          form={materialForm}
          pending={createMaterialMutation.isPending}
          submitLabel="Save Material"
          onChange={setMaterialForm}
          onSubmit={handleCreateMaterial}
        />
      </Dialog>

      <Dialog
        open={Boolean(detailsMaterial)}
        title={detailsMaterial ? `${detailsMaterial.name} stock details` : "Material details"}
        onClose={() => {
          setDetailsMaterial(null);
          setEditMaterial(null);
        }}
        panelClassName="h-full max-h-none max-w-2xl rounded-none sm:ml-auto"
      >
        {detailsMaterial && (
          <div className="grid gap-4">
            <div className="flex flex-wrap gap-2 border-b border-slate-200 pb-3">
              {(["batches", "reservations", "history", "edit"] as const).map((tab) => (
                <button
                  key={tab}
                  type="button"
                  onClick={() => setDetailsTab(tab)}
                  className={`rounded-md px-3 py-2 text-sm font-semibold capitalize ${detailsTab === tab ? "bg-red-700 text-white" : "border border-slate-300 bg-white text-slate-700"}`}
                >
                  {tab}
                </button>
              ))}
            </div>

            {detailsTab === "batches" && (
              <div className="grid gap-2">
                {detailsBatchesQuery.isLoading && <p className="text-sm text-slate-500">Loading batches…</p>}
                {detailsBatchesQuery.isError && <p className="text-sm text-red-700">Unable to load batches for this material.</p>}
                {detailsBatchesQuery.data?.length === 0 && <p className="rounded-md border border-dashed p-4 text-sm text-slate-600">No batches yet. Receive stock to add one.</p>}
                {detailsBatchesQuery.data?.map((batch) => (
                  <div key={batch.id} className="rounded-md border border-slate-200 p-3 text-sm">
                    <p className="font-semibold">{batch.batch_number}</p>
                    <p>{Number(batch.remaining_quantity).toLocaleString()} {batch.raw_material.unit} remaining</p>
                    <p className="text-slate-500">Expires {batch.expiration_date ? formatManilaDate(batch.expiration_date) : "date not recorded"}</p>
                  </div>
                ))}
              </div>
            )}

            {detailsTab === "reservations" && (
              detailsMaterial.reserved_for?.length ? (
                <ul className="grid gap-2">
                  {detailsMaterial.reserved_for.map((lock) => (
                    <li key={lock.id} className="rounded-md border border-slate-200 p-3">
                      <p className="font-semibold">{lock.booking_reference ?? lock.event_name}</p>
                      <p className="text-sm text-slate-600">{lock.customer_name} · {lock.event_name.replace(/_/g, " ")}</p>
                      <p className="text-sm text-slate-600">
                        {Number(lock.reserved_quantity).toLocaleString()} {lock.unit} · {lock.event_date ? formatManilaDate(lock.event_date, { month: "short", day: "numeric", year: "numeric" }) : "Date not set"}
                      </p>
                      <p className="text-xs text-slate-500">Status: {lock.status ?? "Active"}</p>
                    </li>
                  ))}
                  {onOpenReservations && (
                    <button type="button" className="text-left text-sm font-semibold text-red-700 underline" onClick={onOpenReservations}>
                      Open reservations
                    </button>
                  )}
                </ul>
              ) : <p className="text-sm text-slate-600">No active booking holds were found.</p>
            )}

            {detailsTab === "history" && (
              <div className="grid gap-2">
                {detailsMovementsQuery.isLoading && <p className="text-sm text-slate-500">Loading movement history…</p>}
                {detailsMovementsQuery.isError && <p className="text-sm text-red-700">Unable to load movement history.</p>}
                {detailsMovementsQuery.data?.length === 0 && <p className="text-sm text-slate-600">No movements recorded for this material.</p>}
                {detailsMovementsQuery.data?.map((movement) => (
                  <div key={movement.id} className="rounded-md border border-slate-200 p-3 text-sm">
                    <div className="flex justify-between gap-3">
                      <strong>{movement.action} · {Number(movement.quantity).toLocaleString()} {movement.unit}</strong>
                      <span className="text-slate-500">{formatManilaDate(movement.created_at)}</span>
                    </div>
                    <p className="mt-1 text-slate-600">{movement.source_reference ?? "No booking/reference"} · {movement.actor?.name ?? "System"}</p>
                    {movement.note && <p className="mt-1 text-slate-500">{movement.note}</p>}
                  </div>
                ))}
              </div>
            )}

            {detailsTab === "edit" && (
              editMaterial ? (
                <MaterialFields
                  form={materialForm}
                  pending={updateMaterialMutation.isPending}
                  submitLabel="Save material details"
                  onChange={setMaterialForm}
                  onSubmit={handleUpdateMaterial}
                />
              ) : <p className="text-sm text-slate-600">Material details were saved.</p>
            )}
          </div>
        )}
      </Dialog>

      <Dialog open={editDialogOpen} title={`Edit ${editMaterial?.name ?? "Material"}`} onClose={() => setEditDialogOpen(false)}>
        <MaterialFields
          form={materialForm}
          deletePending={deleteMaterialMutation.isPending}
          onDelete={isAdmin ? handleDeleteMaterial : undefined}
          pending={updateMaterialMutation.isPending}
          submitLabel="Update Material"
          onChange={setMaterialForm}
          onSubmit={handleUpdateMaterial}
        />
      </Dialog>

      <Dialog open={stockCountOpen} title="Record Stock Count" onClose={() => setStockCountOpen(false)}>
        <form
          className="grid gap-4"
          onSubmit={(event) => {
            event.preventDefault();
            stockCountMutation.mutate();
          }}
        >
          <label className="grid gap-1 text-sm">
            Material
            <select
              required
              className="h-10 rounded-md border border-slate-300 px-3"
              value={stockCountForm.raw_material_id}
              onChange={(event) => setStockCountForm({ ...stockCountForm, raw_material_id: event.target.value })}
            >
              <option value="">Select material</option>
              {(materialsQuery.data ?? []).map((material) => (
                <option key={material.id} value={material.id}>
                  {material.name} — {Number(material.current_stock).toLocaleString()} {material.unit} on hand
                </option>
              ))}
            </select>
          </label>
          <label className="grid gap-1 text-sm">
            Physical count
            <input
              required
              min="0"
              step="1"
              type="number"
              className="h-10 rounded-md border border-slate-300 px-3"
              value={stockCountForm.physical_count}
              onChange={(event) => setStockCountForm({ ...stockCountForm, physical_count: event.target.value })}
            />
          </label>
          <label className="grid gap-1 text-sm">
            Reason
            <input
              required
              minLength={1}
              className="h-10 rounded-md border border-slate-300 px-3"
              value={stockCountForm.reason}
              onChange={(event) => setStockCountForm({ ...stockCountForm, reason: event.target.value })}
            />
          </label>
          {stockCountNeedsBatch && (
            <div className="grid gap-3 rounded-md border border-amber-200 bg-amber-50 p-3">
              <p className="text-sm text-amber-900">
                A higher physical count adds stock. Enter its batch details so the batch total stays in sync.
              </p>
              <label className="grid gap-1 text-sm">
                Batch number
                <input
                  required
                  className="h-10 rounded-md border border-slate-300 bg-white px-3"
                  value={stockCountForm.batch_number}
                  onChange={(event) => setStockCountForm({ ...stockCountForm, batch_number: event.target.value })}
                />
              </label>
              <label className="grid gap-1 text-sm">
                Expiry date
                <input
                  required
                  type="date"
                  className="h-10 rounded-md border border-slate-300 bg-white px-3"
                  value={stockCountForm.expiration_date}
                  onChange={(event) => setStockCountForm({ ...stockCountForm, expiration_date: event.target.value })}
                />
              </label>
              <label className="grid gap-1 text-sm">
                Cost per {stockCountMaterial ? costDisplayUnit(stockCountMaterial.unit) : "base unit"}
                <input
                  required
                  min="0"
                  step={stockCountMaterial && costDisplayFactor(stockCountMaterial.unit) === 100 ? "0.000001" : "0.00000001"}
                  type="number"
                  className="h-10 rounded-md border border-slate-300 bg-white px-3"
                  value={stockCountForm.cost_per_unit}
                  onChange={(event) => setStockCountForm({ ...stockCountForm, cost_per_unit: event.target.value })}
                />
              </label>
            </div>
          )}
          <Button disabled={stockCountMutation.isPending}>
            {stockCountMutation.isPending ? "Saving count..." : "Save Stock Count"}
          </Button>
        </form>
      </Dialog>
    </Card>
  );
}

function MaterialFields({
  form,
  deletePending,
  onDelete,
  pending,
  submitLabel,
  onChange,
  onSubmit
}: {
  form: MaterialForm;
  deletePending?: boolean;
  onDelete?: () => void;
  pending: boolean;
  submitLabel: string;
  onChange: (form: MaterialForm) => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
}) {
  const fields: Array<{ key: keyof MaterialForm; label: string; editable: boolean }> = [
    { key: "name", label: "Name", editable: true },
    { key: "category", label: "Category", editable: true },
    { key: "unit", label: "Unit", editable: true },
    { key: "reorder_level", label: "PAR Level (whole units)", editable: true },
    { key: "cost_per_unit", label: `Cost per ${costDisplayUnit(form.unit)}`, editable: true }
  ];

  return (
    <form className="grid gap-4" onSubmit={onSubmit}>
      {fields.map((field) => (
        <label key={field.key} className="grid gap-1 text-sm font-medium text-slate-700">
          <span>{field.label}</span>
          {field.key === "category" ? (
            <select
              className="h-10 rounded-md border border-slate-300 px-3 text-sm outline-none focus:border-red-700 focus:ring-2 focus:ring-red-100"
              required
              value={form.category}
              onChange={(event) => onChange({ ...form, category: event.target.value as MaterialForm["category"] })}
            >
              <option value="Beverage">Beverage</option>
              <option value="Raw Material">Raw Material</option>
            </select>
          ) : field.key === "unit" ? (
            <select
              className="h-10 rounded-md border border-slate-300 px-3 text-sm outline-none focus:border-red-700 focus:ring-2 focus:ring-red-100"
              required
              value={form.unit}
              onChange={(event) => onChange({ ...form, unit: event.target.value })}
            >
              <option value="g">g</option>
              <option value="ml">ml</option>
              <option value="piece">piece</option>
              <option value="bottle">bottle</option>
              <option value="cup">cup</option>
              <option value="sheet">sheet</option>
            </select>
          ) : (
            <input
              className="h-10 rounded-md border border-slate-300 px-3 text-sm outline-none focus:border-red-700 focus:ring-2 focus:ring-red-100 disabled:bg-slate-100"
              disabled={!field.editable}
              required
              min={field.key === "name" ? undefined : "0"}
              type={field.key === "name" ? "text" : "number"}
              step={field.key === "cost_per_unit"
                ? costDisplayFactor(form.unit) === 100 ? "0.000001" : "0.00000001"
                : "1"}
              value={field.key === "cost_per_unit"
                ? (Number(form.cost_per_unit) * costDisplayFactor(form.unit)).toFixed(costDisplayFactor(form.unit) === 100 ? 6 : 8)
                : form[field.key]}
              onChange={(event) => onChange({
                ...form,
                [field.key]: field.key === "cost_per_unit"
                  ? String(Number(event.target.value) / costDisplayFactor(form.unit))
                  : event.target.value
              })}
            />
          )}
        </label>
      ))}
      <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-between">
        {onDelete ? (
          <Button type="button" variant="danger" disabled={deletePending || pending} onClick={onDelete}>
            <Trash2 className="mr-2 h-4 w-4" />
            Delete Material
          </Button>
        ) : (
          <span />
        )}
        <Button disabled={pending}>{submitLabel}</Button>
      </div>
    </form>
  );
}

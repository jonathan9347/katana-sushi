import { FormEvent, useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ArrowDown,
  ArrowUp,
  ArrowUpDown,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  ClipboardCheck,
  CircleAlert,
  PackagePlus,
  Search,
  Trash2,
  X
} from "lucide-react";
import { useSearchParams } from "react-router-dom";
import { api } from "../../../lib/api";
import { formatManilaDate, todayManilaDateKey } from "../../../lib/dateTime";
import { Button } from "../../../components/ui/button";
import { Card, CardContent } from "../../../components/ui/card";
import { Dialog } from "../../../components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "../../../components/ui/table";
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
type StockFilter = "all" | "issues" | "low" | "negative" | "expiring" | "ok";
type SortKey = "name" | "current_stock" | "stock_vs_par" | "reserved_quantity" | "available_quantity" | "cost_per_unit" | "status";
type SortDirection = "asc" | "desc";
type ToastMessage = { message: string; type: "success" | "error" };

const stockFilters: StockFilter[] = ["all", "issues", "low", "negative", "expiring", "ok"];

function isStockFilter(value: string | null): value is StockFilter {
  return value !== null && stockFilters.includes(value as StockFilter);
}

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
  return `₱${(Number(costPerBaseUnit) * costDisplayFactor(unit)).toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  })} / ${costDisplayUnit(unit)}`;
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

function getMaterialStatus(material: RawMaterial) {
  const available = Number(material.available_quantity);
  const isLowStock = available <= Number(material.reorder_level);
  const batchMismatch = Boolean(material.batch_mismatch);
  const expiring = Boolean(material.expiring_within_7_days);
  const status = batchMismatch
    ? "Inconsistent"
    : available < 0
      ? "Negative"
      : expiring
        ? "Expiring"
        : isLowStock
          ? "Low"
          : "OK";

  return {
    available,
    isLowStock,
    batchMismatch,
    expiring,
    status,
    hasIssue: batchMismatch || available < 0
  };
}

export default function MaterialsList({ role, onNavigateStockView, onOpenReservations, initialStockFilter = "all" }: MaterialsListProps) {
  const [searchParams, setSearchParams] = useSearchParams();
  const search = searchParams.get("search") ?? "";
  const searchFilter = searchParams.get("filter");
  const stockFilter = isStockFilter(searchFilter) ? searchFilter : initialStockFilter;
  const [categoryFilter, setCategoryFilter] = useState<CategoryFilter>("all");
  const [addOpen, setAddOpen] = useState(false);
  const [editDialogOpen, setEditDialogOpen] = useState(false);
  const [editMaterial, setEditMaterial] = useState<RawMaterial | null>(null);
  const [detailsMaterial, setDetailsMaterial] = useState<RawMaterial | null>(null);
  const [detailsTab, setDetailsTab] = useState<"batches" | "reservations" | "history" | "edit">("batches");
  const [materialForm, setMaterialForm] = useState<MaterialForm>(emptyMaterialForm);
  const [stockCountOpen, setStockCountOpen] = useState(false);
  const [stockCountForm, setStockCountForm] = useState<StockCountForm>(emptyStockCountForm);
  const [sortState, setSortState] = useState<{ key: SortKey; direction: SortDirection }>({ key: "name", direction: "asc" });
  const [collapsedGroups, setCollapsedGroups] = useState<Record<"Beverage" | "Raw Material", boolean>>({
    Beverage: false,
    "Raw Material": false
  });
  const [toastMessage, setToastMessage] = useState<ToastMessage | null>(null);
  const queryClient = useQueryClient();
  const isAdmin = role === "admin";
  const canManageStock = role === "admin" || role === "inventory_manager";

  function showToast(message: string, type: ToastMessage["type"]) {
    setToastMessage({ message, type });
  }

  function updateListParams(values: { search?: string; stockFilter?: StockFilter }) {
    setSearchParams((current) => {
      const next = new URLSearchParams(current);
      if (values.search !== undefined) {
        if (values.search.trim()) next.set("search", values.search);
        else next.delete("search");
      }
      if (values.stockFilter !== undefined) {
        next.set("filter", values.stockFilter);
      }
      return next;
    }, { replace: true });
  }

  useEffect(() => {
    if (!toastMessage) return;
    const timeout = window.setTimeout(() => setToastMessage(null), 5000);
    return () => window.clearTimeout(timeout);
  }, [toastMessage]);

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
    onSuccess: (response) => {
      setAddOpen(false);
      setMaterialForm(emptyMaterialForm);
      refreshInventoryQueries();
      showToast(
        response.data.unit_preserved
          ? `Material restored. Its original unit (${response.data.material.unit}) was kept because it has inventory history.`
          : "Material added.",
        "success"
      );
    },
    onError: () => showToast("Unable to add material.", "error")
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
      showToast("Material updated.", "success");
    },
    onError: (error: unknown) => {
      const message =
        error && typeof error === "object" && "response" in error
          ? (error as { response?: { data?: { message?: string } } }).response?.data?.message
          : undefined;
      showToast(message ?? "Unable to update material.", "error");
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
      showToast("Material deleted.", "success");
    },
    onError: () => showToast("Unable to delete material.", "error")
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
      showToast(data.adjusted ? "Stock count recorded in inventory movements." : "Count matches the current on-hand quantity; no adjustment was needed.", "success");
    },
    onError: (error: unknown) => {
      const message =
        error && typeof error === "object" && "response" in error
          ? (error as { response?: { data?: { message?: string } } }).response?.data?.message
          : undefined;
      showToast(message ?? "Unable to record stock count.", "error");
    }
  });

  const baseMaterials = materialsQuery.data ?? [];
  const countMaterials = useMemo(() => baseMaterials.filter((material) => {
    const matchesSearch = material.name.toLowerCase().includes(search.trim().toLowerCase());
    const matchesCategory = categoryFilter === "all" || material.category === categoryFilter;
    return matchesSearch && matchesCategory;
  }), [baseMaterials, search, categoryFilter]);

  const filteredMaterials = useMemo(() => {
    const matching = countMaterials.filter((material) => {
      const { available, hasIssue, isLowStock, expiring, status } = getMaterialStatus(material);
      const matchesStock =
        stockFilter === "all" ||
        (stockFilter === "issues" && hasIssue) ||
        (stockFilter === "low" && isLowStock) ||
        (stockFilter === "negative" && available < 0) ||
        (stockFilter === "expiring" && expiring) ||
        (stockFilter === "ok" && status === "OK");
      return matchesStock;
    });
    return matching.sort((left, right) => {
      const leftStatus = getMaterialStatus(left).status;
      const rightStatus = getMaterialStatus(right).status;
      const leftValue = sortState.key === "name"
        ? left.name.toLocaleLowerCase()
        : sortState.key === "current_stock"
          ? Number(left.current_stock)
          : sortState.key === "stock_vs_par"
            ? Number(left.reorder_level) > 0 ? Number(left.current_stock) / Number(left.reorder_level) : Number(left.current_stock)
            : sortState.key === "reserved_quantity"
              ? Number(left.reserved_quantity ?? 0)
              : sortState.key === "available_quantity"
                ? Number(left.available_quantity)
                : sortState.key === "cost_per_unit"
                  ? Number(left.cost_per_unit)
                  : leftStatus.toLocaleLowerCase();
      const rightValue = sortState.key === "name"
        ? right.name.toLocaleLowerCase()
        : sortState.key === "current_stock"
          ? Number(right.current_stock)
          : sortState.key === "stock_vs_par"
            ? Number(right.reorder_level) > 0 ? Number(right.current_stock) / Number(right.reorder_level) : Number(right.current_stock)
            : sortState.key === "reserved_quantity"
              ? Number(right.reserved_quantity ?? 0)
              : sortState.key === "available_quantity"
                ? Number(right.available_quantity)
                : sortState.key === "cost_per_unit"
                  ? Number(right.cost_per_unit)
                  : rightStatus.toLocaleLowerCase();
      const comparison = typeof leftValue === "string" && typeof rightValue === "string"
        ? leftValue.localeCompare(rightValue)
        : Number(leftValue) - Number(rightValue);
      return sortState.direction === "asc" ? comparison : -comparison;
    });
  }, [countMaterials, stockFilter, sortState]);

  const materialGroups = useMemo(() => [
    { category: "Beverage" as const, label: "Beverages", materials: filteredMaterials.filter((material) => material.category === "Beverage") },
    { category: "Raw Material" as const, label: "Raw materials", materials: filteredMaterials.filter((material) => material.category !== "Beverage") }
  ], [filteredMaterials]);
  const countForFilter = (filter: StockFilter) => countMaterials.filter((material) => {
    const { available, hasIssue, isLowStock, expiring, status } = getMaterialStatus(material);
    return filter === "all" ||
      (filter === "issues" && hasIssue) ||
      (filter === "low" && isLowStock) ||
      (filter === "negative" && available < 0) ||
      (filter === "expiring" && expiring) ||
      (filter === "ok" && status === "OK");
  }).length;

  function setStockFilter(filter: StockFilter) {
    updateListParams({ stockFilter: filter });
  }

  function handleSort(key: SortKey) {
    setSortState((current) => ({
      key,
      direction: current.key === key && current.direction === "asc" ? "desc" : "asc"
    }));
  }

  function clearFilters() {
    setCategoryFilter("all");
    updateListParams({ search: "", stockFilter: "all" });
  }

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
  const filterOptions: Array<{ id: StockFilter; label: string }> = [
    { id: "all", label: "All" },
    { id: "low", label: "Low" },
    { id: "expiring", label: "Expiring" },
    { id: "ok", label: "OK" },
    { id: "issues", label: "Issues" },
    { id: "negative", label: "Negative" }
  ];
  const renderSortHeader = (key: SortKey, label: string) => (
    <TableHead
      key={key}
      scope="col"
      aria-sort={sortState.key === key ? sortState.direction === "asc" ? "ascending" : "descending" : "none"}
      className={key === "name" || key === "status" ? "" : "materials-numeric-heading"}
    >
      <button type="button" className="materials-sort-button" onClick={() => handleSort(key)}>
        <span>{label}</span>
        {sortState.key === key
          ? sortState.direction === "asc" ? <ArrowUp aria-hidden="true" /> : <ArrowDown aria-hidden="true" />
          : <ArrowUpDown aria-hidden="true" />}
      </button>
    </TableHead>
  );
  return (
    <div className="inventory-materials">
      {toastMessage && (
        <div className={`inventory-toast is-${toastMessage.type}`} role={toastMessage.type === "error" ? "alert" : "status"} aria-live={toastMessage.type === "error" ? "assertive" : "polite"}>
          {toastMessage.type === "success" ? <CheckCircle2 aria-hidden="true" /> : <CircleAlert aria-hidden="true" />}
          <p>{toastMessage.message}</p>
          <button type="button" aria-label="Dismiss notification" onClick={() => setToastMessage(null)}><X aria-hidden="true" /></button>
        </div>
      )}

      <Card className="materials-card">
        <div className="materials-toolbar">
          <div className="materials-toolbar-left materials-filter-row">
            <label className="materials-search">
              <span className="sr-only">Search materials</span>
              <Search aria-hidden="true" />
              <input
                type="search"
                placeholder="Search materials"
                value={search}
                onChange={(event) => updateListParams({ search: event.target.value })}
              />
            </label>
            <label className="sr-only" htmlFor="materials-category">Filter materials by category</label>
            <select
              id="materials-category"
              className="materials-category-select"
              value={categoryFilter}
              onChange={(event) => setCategoryFilter(event.target.value as CategoryFilter)}
            >
              <option value="all">All categories</option>
              <option value="Raw Material">Raw materials</option>
              <option value="Beverage">Beverages</option>
            </select>
            <div className="materials-filter-pills" role="group" aria-label="Filter materials by stock status">
              {filterOptions.map((option) => (
                <button
                  key={option.id}
                  type="button"
                  aria-pressed={stockFilter === option.id}
                  className={`materials-filter-pill ${stockFilter === option.id ? "is-active" : ""}`}
                  onClick={() => setStockFilter(option.id)}
                >
                  {option.label}<span>{countForFilter(option.id)}</span>
                </button>
              ))}
            </div>
          </div>
          <div className="materials-toolbar-right materials-actions">
            {isAdmin && (
              <Button type="button" className="inventory-control materials-add-button" onClick={openAddModal}>
                Add material
              </Button>
            )}
            {canManageStock && (
              <>
                <Button type="button" variant="outline" className="inventory-control" onClick={() => onNavigateStockView?.("batches")}>
                  <PackagePlus aria-hidden="true" />
                  Receive stock
                </Button>
                <Button type="button" variant="outline" className="inventory-control" onClick={() => onNavigateStockView?.("waste")}>
                  <Trash2 aria-hidden="true" />
                  Record waste
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  className="inventory-control"
                  onClick={() => {
                    setStockCountForm(emptyStockCountForm);
                    setStockCountOpen(true);
                  }}
                >
                  <ClipboardCheck aria-hidden="true" />
                  Stock count
                </Button>
              </>
            )}
          </div>
        </div>

        <CardContent className="materials-content">
          {materialsQuery.isLoading && (
            <div className="materials-skeleton" aria-busy="true">
              <span className="sr-only" role="status">Loading materials...</span>
              {Array.from({ length: 6 }, (_, index) => (
                <div key={index} className="materials-skeleton-row" aria-hidden="true">
                  {Array.from({ length: 8 }, (_, cell) => <span key={cell} />)}
                </div>
              ))}
            </div>
          )}

          {materialsQuery.isError && (
            <div className="materials-error-state" role="alert">
              <CircleAlert aria-hidden="true" />
              <p>Unable to load materials.</p>
              <Button type="button" variant="outline" className="inventory-control" onClick={() => void materialsQuery.refetch()}>
                Try again
              </Button>
            </div>
          )}

          {!materialsQuery.isLoading && !materialsQuery.isError && filteredMaterials.length === 0 && (
            <div className="materials-empty-state">
              <div className="materials-empty-icon"><Search aria-hidden="true" /></div>
              <h3>No materials match your filters</h3>
              <p>Try a different search or clear the selected filters.</p>
              <Button type="button" variant="outline" className="inventory-control" onClick={clearFilters}>
                Clear filters
              </Button>
            </div>
          )}

          {!materialsQuery.isLoading && !materialsQuery.isError && filteredMaterials.length > 0 && (
            <div className="materials-groups">
              {materialGroups.filter((group) => group.materials.length > 0).map((group) => (
                <section key={group.category} className="materials-group">
                  <button
                    type="button"
                    className="materials-group-heading"
                    aria-expanded={!collapsedGroups[group.category]}
                    onClick={() => setCollapsedGroups((current) => ({
                      ...current,
                      [group.category]: !current[group.category]
                    }))}
                  >
                    {collapsedGroups[group.category]
                      ? <ChevronRight aria-hidden="true" />
                      : <ChevronDown aria-hidden="true" />}
                    <span>{group.label}</span>
                    <span className="materials-group-count">{group.materials.length} {group.materials.length === 1 ? "item" : "items"}</span>
                  </button>

                  {!collapsedGroups[group.category] && (
                    <div className="materials-table-scroll">
                      <Table className="materials-table">
                        <caption className="sr-only">{group.label} inventory stock</caption>
                        <TableHeader className="materials-table-header">
                          <TableRow>
                            {renderSortHeader("name", "Item")}
                            {renderSortHeader("current_stock", "On hand")}
                            {renderSortHeader("stock_vs_par", "Stock vs par")}
                            {renderSortHeader("reserved_quantity", "Reserved")}
                            {renderSortHeader("available_quantity", "Available")}
                            {renderSortHeader("cost_per_unit", "Cost")}
                            {renderSortHeader("status", "Status")}
                            <TableHead scope="col">Actions</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {group.materials.map((material) => {
                            const reserved = Number(material.reserved_quantity ?? 0);
                            const currentStock = Number(material.current_stock);
                            const par = Number(material.reorder_level);
                            const { available, isLowStock, batchMismatch, expiring, status } = getMaterialStatus(material);
                            const statusTone = status === "Expiring"
                              ? "is-expiring"
                              : status === "OK"
                                ? "is-ok"
                                : "is-low";
                            const progressMax = Math.max(par * 3, 0);
                            const progressValue = progressMax > 0
                              ? Math.max(0, Math.min(100, (currentStock / progressMax) * 100))
                              : currentStock > 0 ? 100 : 0;
                            const progressAriaMax = progressMax > 0 ? progressMax : 1;
                            const progressAriaValue = Math.max(0, Math.min(progressAriaMax, currentStock));

                            return (
                              <TableRow key={material.id} className="materials-data-row">
                                <TableCell className="materials-item-cell">
                                  <button type="button" className="materials-item-link" onClick={() => openDetails(material)}>
                                    {material.name}
                                  </button>
                                </TableCell>
                                <TableCell className="materials-numeric-cell">
                                  <span>{currentStock.toLocaleString()}</span>
                                  <span className="materials-unit">{material.unit}</span>
                                </TableCell>
                                <TableCell>
                                  <div
                                    className={`materials-progress ${statusTone}`}
                                    role="progressbar"
                                    aria-label={`${material.name} stock against par`}
                                    aria-valuemin={0}
                                    aria-valuemax={progressAriaMax}
                                    aria-valuenow={progressAriaValue}
                                    aria-valuetext={`${currentStock.toLocaleString()} ${material.unit}; Par ${par.toLocaleString()} ${material.unit}`}
                                  >
                                    <span className="materials-progress-fill" style={{ width: `${progressValue}%` }} />
                                    {par > 0 && <span className="materials-progress-marker" aria-hidden="true" />}
                                  </div>
                                  <div className="materials-progress-caption">
                                    <span>Par {par.toLocaleString()} {material.unit}</span>
                                    {isLowStock && <span className="materials-below-par">Below par</span>}
                                    {batchMismatch && <span className="materials-row-note">Batch mismatch</span>}
                                    {available < 0 && <span className="materials-row-note">Short by {Math.abs(available).toLocaleString()}</span>}
                                    {expiring && <span className="sr-only">Expiring within 7 days</span>}
                                  </div>
                                </TableCell>
                                <TableCell className="materials-numeric-cell">
                                  {reserved > 0 ? (
                                    <button
                                      type="button"
                                      className="materials-reserved-link"
                                      onClick={() => {
                                        openDetails(material);
                                        setDetailsTab("reservations");
                                      }}
                                      aria-label={`Show bookings reserving ${material.name}`}
                                    >
                                      {reserved.toLocaleString()}
                                    </button>
                                  ) : <span className="materials-zero">{reserved.toLocaleString()}</span>}
                                </TableCell>
                                <TableCell className={`materials-numeric-cell ${available <= par ? "materials-low-value" : ""}`}>
                                  {available.toLocaleString()} <span className="materials-unit">{material.unit}</span>
                                </TableCell>
                                <TableCell className="materials-cost-cell">
                                  {formatCostPerDisplayUnit(material.cost_per_unit, material.unit)}
                                </TableCell>
                                <TableCell>
                                  <span className={`materials-status ${statusTone}`}>{status}</span>
                                </TableCell>
                                <TableCell>
                                  {isAdmin && (
                                    <Button
                                      type="button"
                                      variant="outline"
                                      className="inventory-control materials-edit-button"
                                      onClick={() => openEditModal(material)}
                                    >
                                      Edit
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
      </Card>

      <Dialog open={addOpen} title="Add material" onClose={() => setAddOpen(false)}>
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
    </div>
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

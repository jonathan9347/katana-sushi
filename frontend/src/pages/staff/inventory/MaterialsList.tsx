import { FormEvent, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Edit, Search, Trash2 } from "lucide-react";
import { api } from "../../../lib/api";
import { formatManilaDate } from "../../../lib/dateTime";
import { Button } from "../../../components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "../../../components/ui/card";
import { Dialog } from "../../../components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "../../../components/ui/table";
import { useToast } from "../../../hooks/useToast";
import { RawMaterial, StaffRole } from "./types";

type MaterialsListProps = {
  role: StaffRole;
};

type MaterialForm = {
  name: string;
  unit: string;
  current_stock: string;
  reorder_level: string;
  cost_per_unit: string;
};

const emptyMaterialForm: MaterialForm = {
  name: "",
  unit: "kg",
  current_stock: "0",
  reorder_level: "0",
  cost_per_unit: "0"
};

function formFromMaterial(material: RawMaterial): MaterialForm {
  return {
    name: material.name,
    unit: material.unit,
    current_stock: String(material.current_stock),
    reorder_level: String(material.reorder_level),
    cost_per_unit: String(material.cost_per_unit)
  };
}

export default function MaterialsList({ role }: MaterialsListProps) {
  const [search, setSearch] = useState("");
  const [addOpen, setAddOpen] = useState(false);
  const [editMaterial, setEditMaterial] = useState<RawMaterial | null>(null);
  const [materialForm, setMaterialForm] = useState<MaterialForm>(emptyMaterialForm);
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const isAdmin = role === "admin";

  const materialsQuery = useQuery({
    queryKey: ["inventory", "materials"],
    queryFn: async () => {
      const response = await api.get<{ materials: RawMaterial[] }>("/api/inventory/materials");
      return response.data.materials;
    }
  });

  function refreshInventoryQueries() {
    queryClient.invalidateQueries({ queryKey: ["inventory"] });
  }

  const createMaterialMutation = useMutation({
    mutationFn: async () =>
      api.post("/api/inventory/materials", {
        name: materialForm.name,
        unit: materialForm.unit,
        current_stock: Number(materialForm.current_stock),
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
        unit: materialForm.unit,
        current_stock: Number(materialForm.current_stock),
        reorder_level: Number(materialForm.reorder_level),
        cost_per_unit: Number(materialForm.cost_per_unit)
      });
    },
    onSuccess: () => {
      setEditMaterial(null);
      refreshInventoryQueries();
      toast("Material updated.");
    },
    onError: () => toast("Unable to update material.")
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

  const filteredMaterials = useMemo(() => {
    return (materialsQuery.data ?? []).filter((material) =>
      material.name.toLowerCase().includes(search.toLowerCase())
    );
  }, [materialsQuery.data, search]);

  function openAddModal() {
    setMaterialForm(emptyMaterialForm);
    setAddOpen(true);
  }

  function openEditModal(material: RawMaterial) {
    setMaterialForm(formFromMaterial(material));
    setEditMaterial(material);
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

  return (
    <Card>
      <CardHeader className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <CardTitle>Raw Materials</CardTitle>
        <div className="flex flex-col gap-2 sm:flex-row">
          <label className="relative block">
            <Search className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-slate-400" />
            <input
              className="h-10 w-full rounded-md border border-slate-300 pl-9 pr-3 text-sm outline-none focus:border-red-700 focus:ring-2 focus:ring-red-100 sm:w-72"
              placeholder="Search materials"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
            />
          </label>
          {isAdmin && <Button onClick={openAddModal}>Add New Material</Button>}
        </div>
      </CardHeader>
      <CardContent>
        {materialsQuery.isLoading && <p className="text-sm text-slate-500">Loading materials...</p>}
        {materialsQuery.isError && <p className="text-sm text-red-700">Unable to load materials.</p>}
        {!materialsQuery.isLoading && !materialsQuery.isError && (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Unit</TableHead>
                  <TableHead>Total Stock</TableHead>
                  <TableHead>Reserved</TableHead>
                  <TableHead>Available</TableHead>
                  <TableHead>Reorder Level</TableHead>
                  <TableHead>Cost per Unit</TableHead>
                  <TableHead>Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredMaterials.map((material) => {
                  const reserved = Number(material.reserved_quantity ?? 0);
                  const available = Number(material.available_quantity ?? Number(material.current_stock) - reserved);
                  const isLowStock = available <= Number(material.reorder_level);
                  const reservedTitle = material.reserved_for?.length
                    ? `Reserved for: ${material.reserved_for
                        .map((lock) => `${lock.event_name.replace(/_/g, " ")} on ${formatManilaDate(lock.event_date, { month: "short", day: "numeric" })}`)
                        .join(", ")}`
                    : "No active catering locks";

                  return (
                    <TableRow key={material.id} className={isLowStock ? "bg-red-50 text-red-950" : ""}>
                      <TableCell className="font-medium">{material.name}</TableCell>
                      <TableCell>{material.unit}</TableCell>
                      <TableCell>{Number(material.current_stock).toLocaleString()}</TableCell>
                      <TableCell>
                        <span
                          className={reserved > 0 ? "rounded-full bg-amber-50 px-2 py-1 text-xs font-bold text-amber-700" : "text-slate-500"}
                          title={reservedTitle}
                        >
                          {reserved.toLocaleString()}
                        </span>
                      </TableCell>
                      <TableCell className={available <= Number(material.reorder_level) ? "font-bold text-red-700" : ""}>
                        {available.toLocaleString()}
                      </TableCell>
                      <TableCell>{Number(material.reorder_level).toLocaleString()}</TableCell>
                      <TableCell>PHP {Number(material.cost_per_unit).toLocaleString()}</TableCell>
                      <TableCell>
                        <div className="flex gap-2">
                          {isAdmin && (
                            <Button size="sm" variant="ghost" onClick={() => openEditModal(material)}>
                              <Edit className="h-4 w-4" />
                            </Button>
                          )}
                        </div>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        )}
      </CardContent>

      <Dialog open={addOpen} title="Add New Material" onClose={() => setAddOpen(false)}>
        <MaterialFields
          form={materialForm}
          includeCurrentStock
          currentStockLabel="Initial Stock"
          pending={createMaterialMutation.isPending}
          submitLabel="Save Material"
          onChange={setMaterialForm}
          onSubmit={handleCreateMaterial}
        />
      </Dialog>

      <Dialog open={Boolean(editMaterial)} title={`Edit ${editMaterial?.name ?? "Material"}`} onClose={() => setEditMaterial(null)}>
        <MaterialFields
          form={materialForm}
          includeCurrentStock
          currentStockLabel="Current Stock"
          deletePending={deleteMaterialMutation.isPending}
          onDelete={isAdmin ? handleDeleteMaterial : undefined}
          pending={updateMaterialMutation.isPending}
          submitLabel="Update Material"
          onChange={setMaterialForm}
          onSubmit={handleUpdateMaterial}
        />
      </Dialog>
    </Card>
  );
}

function MaterialFields({
  form,
  includeCurrentStock,
  currentStockLabel,
  deletePending,
  onDelete,
  pending,
  submitLabel,
  onChange,
  onSubmit
}: {
  form: MaterialForm;
  includeCurrentStock: boolean;
  currentStockLabel: string;
  deletePending?: boolean;
  onDelete?: () => void;
  pending: boolean;
  submitLabel: string;
  onChange: (form: MaterialForm) => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
}) {
  const fields: Array<{ key: keyof MaterialForm; label: string; editable: boolean }> = [
    { key: "name", label: "Name", editable: true },
    { key: "unit", label: "Unit", editable: true },
    { key: "current_stock", label: currentStockLabel, editable: includeCurrentStock },
    { key: "reorder_level", label: "Reorder Level", editable: true },
    { key: "cost_per_unit", label: "Cost Per Unit", editable: true }
  ];

  return (
    <form className="grid gap-4" onSubmit={onSubmit}>
      {fields.map((field) => (
        <label key={field.key} className="grid gap-1 text-sm font-medium text-slate-700">
          <span>{field.label}</span>
          {field.key === "unit" ? (
            <select
              className="h-10 rounded-md border border-slate-300 px-3 text-sm outline-none focus:border-red-700 focus:ring-2 focus:ring-red-100"
              required
              value={form.unit}
              onChange={(event) => onChange({ ...form, unit: event.target.value })}
            >
              <option value="kg">kg</option>
              <option value="g">g</option>
              <option value="pieces">pieces</option>
              <option value="sheets">sheets</option>
              <option value="liters">liters</option>
            </select>
          ) : (
            <input
              className="h-10 rounded-md border border-slate-300 px-3 text-sm outline-none focus:border-red-700 focus:ring-2 focus:ring-red-100 disabled:bg-slate-100"
              disabled={!field.editable}
              required
              type={field.key === "name" ? "text" : "number"}
              step="0.001"
              value={form[field.key]}
              onChange={(event) => onChange({ ...form, [field.key]: event.target.value })}
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

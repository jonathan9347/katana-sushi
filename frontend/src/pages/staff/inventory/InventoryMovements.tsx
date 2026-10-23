import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Download, RefreshCw } from "lucide-react";
import { api } from "../../../lib/api";
import { todayManilaDateKey } from "../../../lib/dateTime";
import { Button } from "../../../components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "../../../components/ui/card";
import { Select } from "../../../components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "../../../components/ui/table";
import { InventoryMaterialWithAvailability } from "./types";

type Movement = {
  id: string;
  created_at: string;
  source_type: string | null;
  source_reference: string | null;
  action: "Received" | "Reserved" | "Released" | "Used" | "Wasted" | "Adjusted" | string;
  quantity: string | number;
  unit: string;
  quantity_before: string | number | null;
  quantity_after: string | number | null;
  reserved_before: string | number | null;
  reserved_after: string | number | null;
  note: string | null;
  raw_material: { id: string; name: string; unit: string };
  batch: { batch_number: string; expiration_date: string | null } | null;
  actor: { name: string } | null;
};

type MovementResponse = {
  movements: Movement[];
  pagination: { page: number; limit: number; total: number; pages: number };
  legacyFallback?: boolean;
  notice?: string;
};

const actions = ["Received", "Deducted", "Returned", "Wasted", "Adjusted"] as const;
type MovementCategory = typeof actions[number];

function displayCategory(action: string): MovementCategory | null {
  if (action === "Received" || action === "Wasted" || action === "Adjusted") return action;
  if (action === "Deducted" || action === "Used") return "Deducted";
  if (action === "Returned" || action === "Released" || action === "Released back") return "Returned";
  return null;
}

function csvCell(value: unknown) {
  return `"${String(value ?? "").replace(/"/g, '""')}"`;
}

export default function InventoryMovements() {
  const today = todayManilaDateKey();
  const [from, setFrom] = useState(today);
  const [to, setTo] = useState(today);
  const [materialId, setMaterialId] = useState("");
  const [booking, setBooking] = useState("");
  const [action, setAction] = useState("");
  const [page, setPage] = useState(1);

  const materialsQuery = useQuery({
    queryKey: ["inventory", "materials"],
    queryFn: async () => {
      const response = await api.get<{ materials: InventoryMaterialWithAvailability[] }>("/api/inventory/materials");
      return response.data.materials;
    }
  });

  const movementsQuery = useQuery({
    queryKey: ["inventory", "movements", from, to, materialId, booking, action, page],
    queryFn: async () => {
      const response = await api.get<MovementResponse>("/api/inventory/movements", {
        params: {
          from,
          to,
          materialId: materialId || undefined,
          booking: booking.trim() || undefined,
          action: action || undefined,
          categoriesOnly: "true",
          page,
          limit: 100
        }
      });
      return response.data;
    }
  });

  const visibleMovements = (movementsQuery.data?.movements ?? [])
    .map((movement) => ({ movement, category: displayCategory(movement.action) }))
    .filter((entry): entry is { movement: Movement; category: MovementCategory } => entry.category !== null);

  const csv = useMemo(() => {
    const rows = [
      ["Date", "Material", "Batch", "Booking/reference", "Source", "Action", "Quantity", "On hand before", "On hand after", "Staff", "Note"],
      ...visibleMovements.map(({ movement, category }) => [
        new Date(movement.created_at).toLocaleString(),
        movement.raw_material.name,
        movement.batch?.batch_number ?? "",
        movement.source_reference ?? "",
        movement.source_type ?? "",
        category,
        `${movement.quantity} ${movement.unit}`,
        movement.quantity_before ?? "",
        movement.quantity_after ?? "",
        movement.actor?.name ?? "System",
        movement.note ?? ""
      ])
    ];
    return rows.map((row) => row.map(csvCell).join(",")).join("\r\n");
  }, [visibleMovements]);

  function exportCsv() {
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = `inventory-movements-${from}-to-${to}-page-${page}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  }

  function changeFilter(update: () => void) {
    update();
    setPage(1);
  }

  return (
    <Card>
      <CardHeader className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div>
          <CardTitle>Inventory Movements</CardTitle>
          <p className="mt-1 text-sm text-slate-600">Stock changes and reservation activity, not sales transactions.</p>
        </div>
        <Button variant="outline" onClick={exportCsv} disabled={!visibleMovements.length}>
          <Download className="mr-2 h-4 w-4" />
          Export this page
        </Button>
      </CardHeader>
      <CardContent className="grid gap-4">
        <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-5">
          <label className="grid gap-1 text-xs text-slate-600">
            From
            <input className="h-10 rounded-md border border-slate-300 px-3 text-sm" type="date" value={from} onChange={(event) => changeFilter(() => setFrom(event.target.value))} />
          </label>
          <label className="grid gap-1 text-xs text-slate-600">
            To
            <input className="h-10 rounded-md border border-slate-300 px-3 text-sm" type="date" value={to} onChange={(event) => changeFilter(() => setTo(event.target.value))} />
          </label>
          <label className="grid gap-1 text-xs text-slate-600">
            Material
            <Select value={materialId} onChange={(event) => changeFilter(() => setMaterialId(event.target.value))}>
              <option value="">All materials</option>
              {materialsQuery.data?.map((material) => <option key={material.id} value={material.id}>{material.name}</option>)}
            </Select>
          </label>
          <label className="grid gap-1 text-xs text-slate-600">
            Action
            <Select value={action} onChange={(event) => changeFilter(() => setAction(event.target.value))}>
              <option value="">All actions</option>
              {actions.map((value) => <option key={value} value={value}>{value}</option>)}
            </Select>
          </label>
          <label className="grid gap-1 text-xs text-slate-600">
            Booking/reference
            <input className="h-10 rounded-md border border-slate-300 px-3 text-sm" placeholder="Search booking number" value={booking} onChange={(event) => changeFilter(() => setBooking(event.target.value))} />
          </label>
        </div>

        {movementsQuery.isLoading && <p className="text-sm text-slate-500">Loading inventory movements…</p>}
        {movementsQuery.isError && (
          <div className="flex flex-col items-start gap-2 rounded-md border border-red-200 bg-red-50 p-4 text-sm text-red-800 sm:flex-row sm:items-center sm:justify-between">
            <p>Unable to load inventory movements. Check your connection and try again.</p>
            <Button variant="outline" size="sm" onClick={() => void movementsQuery.refetch()}>
              <RefreshCw className="mr-2 h-4 w-4" />
              Retry
            </Button>
          </div>
        )}
        {movementsQuery.data?.legacyFallback && (
          <p className="rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
            {movementsQuery.data.notice ?? "Showing legacy inventory records; the movement ledger database migration is pending."}
          </p>
        )}
        {!movementsQuery.isLoading && !movementsQuery.isError && visibleMovements.length === 0 && (
          <p className="rounded-md border border-dashed border-slate-300 p-6 text-center text-sm text-slate-600">
            No inventory movements in this date range. Receive stock, record waste, or make a reservation to create a movement.
          </p>
        )}
        {!!visibleMovements.length && (
          <>
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Date/time</TableHead>
                    <TableHead>Material / batch</TableHead>
                    <TableHead>Booking/reference</TableHead>
                    <TableHead>Action</TableHead>
                    <TableHead>Quantity</TableHead>
                    <TableHead>On hand</TableHead>
                    <TableHead>Reserved</TableHead>
                    <TableHead>By</TableHead>
                    <TableHead>Note</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {visibleMovements.map(({ movement, category }) => (
                    <TableRow key={movement.id}>
                      <TableCell>{new Date(movement.created_at).toLocaleString()}</TableCell>
                      <TableCell>
                        <span className="font-medium">{movement.raw_material.name}</span>
                        <span className="block text-xs text-slate-500">
                          {movement.batch?.batch_number ?? "No batch"} · {movement.source_type ?? "Legacy"}
                        </span>
                      </TableCell>
                      <TableCell>{movement.source_reference ?? "—"}</TableCell>
                      <TableCell>{category}</TableCell>
                      <TableCell>{Number(movement.quantity).toLocaleString()} {movement.unit}</TableCell>
                      <TableCell>
                        {movement.quantity_before === null || movement.quantity_after === null
                          ? "—"
                          : `${Number(movement.quantity_before).toLocaleString()} → ${Number(movement.quantity_after).toLocaleString()}`}
                      </TableCell>
                      <TableCell>
                        {movement.reserved_before === null || movement.reserved_after === null
                          ? "—"
                          : `${Number(movement.reserved_before).toLocaleString()} → ${Number(movement.reserved_after).toLocaleString()} ${movement.unit}`}
                      </TableCell>
                      <TableCell>{movement.actor?.name ?? "System"}</TableCell>
                      <TableCell className="max-w-xs whitespace-normal">{movement.note ?? "—"}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
            {movementsQuery.data && (
              <div className="flex items-center justify-between border-t border-slate-200 pt-3 text-sm">
                <span className="text-slate-600">
                  {movementsQuery.data.pagination.total} movement(s) · Page {page} of {Math.max(movementsQuery.data.pagination.pages, 1)}
                </span>
                <div className="flex gap-2">
                  <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage((current) => current - 1)}>Previous</Button>
                  <Button variant="outline" size="sm" disabled={page >= movementsQuery.data.pagination.pages} onClick={() => setPage((current) => current + 1)}>Next</Button>
                </div>
              </div>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}

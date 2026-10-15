import { useQuery } from "@tanstack/react-query";
import { AlertTriangle, CalendarClock, Package, Trash2, TrendingDown } from "lucide-react";
import { api } from "../../../lib/api";
import { manilaDateKey, todayManilaDateKey } from "../../../lib/dateTime";
import { Button } from "../../../components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "../../../components/ui/card";
import { InventoryMaterialWithAvailability, MaterialBatch } from "./types";

type Reservation = {
  id: string;
  type: "dine-in" | "catering" | "takeout";
  date: string | null;
  status: string;
};

type MovementPage = {
  movements: Array<{ id: string; action: string }>;
  pagination: { total: number };
};

type OverviewNavigation = {
  section: "stock" | "reservations" | "movements";
  stockView?: "materials" | "batches" | "waste";
  stockFilter?: "all" | "issues" | "low" | "expiring";
  batchExpiringOnly?: boolean;
};

export default function InventoryOverview({ onNavigate }: { onNavigate: (target: OverviewNavigation) => void }) {
  const today = todayManilaDateKey();
  const weekStart = new Date(`${today}T00:00:00+08:00`);
  weekStart.setDate(weekStart.getDate() - 6);
  const fromWeek = manilaDateKey(weekStart);

  const materialsQuery = useQuery({
    queryKey: ["inventory", "materials"],
    queryFn: async () => (await api.get<{ materials: Array<InventoryMaterialWithAvailability & { batch_total: number; batch_mismatch: boolean }> }>("/api/inventory/materials")).data.materials
  });
  const expiringQuery = useQuery({
    queryKey: ["inventory", "batches", "expiring", 7],
    queryFn: async () => (await api.get<{ batches: MaterialBatch[] }>("/api/inventory/batches/expiring", { params: { days: 7 } })).data.batches
  });
  const reservationsQuery = useQuery({
    queryKey: ["inventory", "reservations"],
    queryFn: async () => (await api.get<{ reservations: Reservation[] }>("/api/inventory/reservations")).data.reservations
  });
  const releasedQuery = useQuery({
    queryKey: ["inventory", "movements", today, "Released"],
    queryFn: async () => (await api.get<MovementPage>("/api/inventory/movements", {
      params: { from: today, to: today, action: "Released", limit: 100 }
    })).data
  });
  const wastedQuery = useQuery({
    queryKey: ["inventory", "movements", fromWeek, today, "Wasted"],
    queryFn: async () => (await api.get<MovementPage>("/api/inventory/movements", {
      params: { from: fromWeek, to: today, action: "Wasted", limit: 100 }
    })).data
  });

  const materials = materialsQuery.data ?? [];
  const problemCount = materials.filter((material) => material.batch_mismatch || Number(material.available_quantity) < 0).length;
  const lowStockCount = materials.filter((material) => Number(material.available_quantity) <= Number(material.reorder_level)).length;
  const reservationsToday = (reservationsQuery.data ?? []).filter((reservation) => {
    const status = reservation.status.toLowerCase();
    return reservation.date !== null && manilaDateKey(reservation.date) === today &&
      ["pending_approval", "pending", "confirmed", "seated", "in_progress", "preparing", "pending_final_payment"].includes(status);
  }).length;
  const queries = [materialsQuery, expiringQuery, reservationsQuery, releasedQuery, wastedQuery];
  const isError = queries.some((query) => query.isError);

  const cards = [
    {
      label: "Stock needs attention",
      count: problemCount,
      detail: "Negative available or on-hand doesn't match batches",
      icon: AlertTriangle,
      action: () => onNavigate({ section: "stock", stockView: "materials", stockFilter: "issues" }),
      color: "border-red-200 bg-red-50 text-red-900"
    },
    {
      label: "Low available stock",
      count: lowStockCount,
      detail: "Compared with reorder level",
      icon: TrendingDown,
      action: () => onNavigate({ section: "stock", stockView: "materials", stockFilter: "low" }),
      color: "border-amber-200 bg-amber-50 text-amber-900"
    },
    {
      label: "Expiring within 7 days",
      count: expiringQuery.data?.length ?? 0,
      detail: "Includes batches already expired",
      icon: CalendarClock,
      action: () => onNavigate({ section: "stock", stockView: "batches", batchExpiringOnly: true }),
      color: "border-orange-200 bg-orange-50 text-orange-900"
    },
    {
      label: "Reservations today",
      count: reservationsToday,
      detail: "Active dine-in, catering, and pickup orders",
      icon: Package,
      action: () => onNavigate({ section: "reservations" }),
      color: "border-blue-200 bg-blue-50 text-blue-900"
    },
    {
      label: "Released today",
      count: releasedQuery.data?.pagination.total ?? 0,
      detail: "Stock returned after a booking change or cancellation",
      icon: Package,
      action: () => onNavigate({ section: "movements" }),
      color: "border-emerald-200 bg-emerald-50 text-emerald-900"
    },
    {
      label: "Wasted this week",
      count: wastedQuery.data?.pagination.total ?? 0,
      detail: "Recorded waste movements",
      icon: Trash2,
      action: () => onNavigate({ section: "stock", stockView: "waste" }),
      color: "border-slate-200 bg-slate-50 text-slate-900"
    }
  ];

  return (
    <div className="grid gap-5">
      <Card>
        <CardHeader>
          <CardTitle>Inventory overview</CardTitle>
          <p className="text-sm text-slate-600">Problems first. Stock figures use available quantity after active reservations.</p>
        </CardHeader>
        <CardContent>
          {isError && (
            <p className="mb-4 rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-800">
              Some inventory status could not be loaded. Retry the affected section after the inventory database migration is applied.
            </p>
          )}
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {cards.map(({ label, count, detail, icon: Icon, action, color }) => (
              <button
                key={label}
                type="button"
                onClick={action}
                className={`rounded-xl border p-4 text-left transition hover:-translate-y-0.5 hover:shadow-sm ${color}`}
              >
                <span className="flex items-center justify-between gap-3">
                  <span className="text-sm font-semibold">{label}</span>
                  <Icon className="h-5 w-5" />
                </span>
                <span className="mt-3 block text-3xl font-black">{count}</span>
                <span className="mt-1 block text-xs opacity-80">{detail}</span>
                <span className="mt-3 block text-xs font-semibold underline">Open list</span>
              </button>
            ))}
          </div>
          <div className="mt-5 flex justify-end">
            <Button variant="outline" onClick={() => onNavigate({ section: "movements" })}>View today’s movements</Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

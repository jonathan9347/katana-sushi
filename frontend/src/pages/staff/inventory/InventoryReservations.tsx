import { useQuery } from "@tanstack/react-query";
import { RefreshCw } from "lucide-react";
import { api } from "../../../lib/api";
import { formatManilaDate, manilaDateKey, todayManilaDateKey } from "../../../lib/dateTime";
import { Button } from "../../../components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "../../../components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "../../../components/ui/table";

type Reservation = {
  id: string;
  type: "dine-in" | "catering" | "takeout";
  reference: string;
  customer_name: string;
  date: string | null;
  time: string | null;
  guests: number | null;
  status: string;
  menu: unknown;
  stock_note: string | null;
  ingredients: Array<{
    material_id: string;
    material: string;
    quantity: number | string;
    unit: string;
    status: string;
  }>;
};

type MovementPage = { movements: Array<{ id: string; action: string }>; pagination: { total: number } };

function displayMenu(menu: unknown) {
  if (typeof menu === "string") return menu;
  if (Array.isArray(menu)) {
    return menu.map((item) => {
      if (typeof item === "string") return item;
      if (item && typeof item === "object" && "name" in item) return String(item.name);
      return "";
    }).filter(Boolean).join(", ") || "Menu not recorded";
  }
  return menu && typeof menu === "object" && "name" in menu ? String(menu.name) : "Menu not recorded";
}

export default function InventoryReservations() {
  const today = todayManilaDateKey();
  const weekStart = new Date(`${today}T00:00:00+08:00`);
  weekStart.setDate(weekStart.getDate() - 6);
  const from = manilaDateKey(weekStart);

  const reservationsQuery = useQuery({
    queryKey: ["inventory", "reservations"],
    queryFn: async () => (await api.get<{ reservations: Reservation[] }>("/api/inventory/reservations")).data.reservations
  });
  const releasedQuery = useQuery({
    queryKey: ["inventory", "movements", "released", today],
    queryFn: async () => (await api.get<MovementPage>("/api/inventory/movements", {
      params: { from: today, to: today, action: "Released", limit: 100 }
    })).data
  });
  const wasteQuery = useQuery({
    queryKey: ["inventory", "movements", "wasted", from, today],
    queryFn: async () => (await api.get<MovementPage>("/api/inventory/movements", {
      params: { from, to: today, action: "Wasted", limit: 100 }
    })).data
  });

  const reservations = reservationsQuery.data ?? [];
  const reservedToday = reservations.filter((reservation) => {
    const active = !["cancelled", "canceled", "completed", "declined", "expired", "no-show", "no_show", "rejected"].includes(reservation.status.toLowerCase());
    return active && reservation.date !== null && manilaDateKey(reservation.date) === today &&
      reservation.ingredients.some((ingredient) => ingredient.status === "Reserved");
  }).length;

  return (
    <div className="grid gap-5">
      <div className="grid gap-3 sm:grid-cols-3">
        <Card><CardContent className="p-4"><p className="text-sm text-slate-600">Reserved today</p><p className="mt-1 text-2xl font-bold">{reservedToday}</p></CardContent></Card>
        <Card><CardContent className="p-4"><p className="text-sm text-slate-600">Released today</p><p className="mt-1 text-2xl font-bold">{releasedQuery.data?.pagination.total ?? "—"}</p></CardContent></Card>
        <Card><CardContent className="p-4"><p className="text-sm text-slate-600">Wasted this week</p><p className="mt-1 text-2xl font-bold">{wasteQuery.data?.pagination.total ?? "—"}</p></CardContent></Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Reservations</CardTitle>
          <p className="text-sm text-slate-600">Dine-in, catering, and pickup orders with their current inventory status.</p>
        </CardHeader>
        <CardContent>
          {reservationsQuery.isLoading && <p className="text-sm text-slate-500">Loading reservations…</p>}
          {reservationsQuery.isError && (
            <div className="flex items-center justify-between gap-3 rounded-md border border-red-200 bg-red-50 p-4 text-sm text-red-800">
              <p>Unable to load reservations. Check access and try again.</p>
              <Button variant="outline" size="sm" onClick={() => void reservationsQuery.refetch()}>
                <RefreshCw className="mr-2 h-4 w-4" /> Retry
              </Button>
            </div>
          )}
          {reservationsQuery.data?.length === 0 && (
            <p className="rounded-md border border-dashed border-slate-300 p-6 text-center text-sm text-slate-600">No bookings found.</p>
          )}
          {!!reservations.length && (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader><TableRow>
                  <TableHead>Date</TableHead><TableHead>Booking</TableHead><TableHead>Guests</TableHead>
                  <TableHead>Status</TableHead><TableHead>Menu</TableHead><TableHead>Ingredients</TableHead>
                </TableRow></TableHeader>
                <TableBody>
                  {reservations.map((reservation) => (
                    <TableRow key={`${reservation.type}-${reservation.id}`}>
                      <TableCell className="whitespace-nowrap">
                        {reservation.date ? formatManilaDate(reservation.date) : "Date not set"}
                        {reservation.time ? ` · ${reservation.time}` : ""}
                      </TableCell>
                      <TableCell>
                        <span className="font-semibold">{reservation.reference}</span>
                        <span className="block text-xs text-slate-500">{reservation.customer_name} · {reservation.type}</span>
                      </TableCell>
                      <TableCell>{reservation.guests ?? "—"}</TableCell>
                      <TableCell><span className={`rounded-full px-2 py-1 text-xs font-semibold ${["cancelled", "canceled", "rejected", "declined"].includes(reservation.status.toLowerCase()) ? "bg-slate-100 text-slate-600" : "bg-emerald-50 text-emerald-800"}`}>{reservation.status.replace(/_/g, " ")}</span></TableCell>
                      <TableCell className="max-w-xs whitespace-normal">{displayMenu(reservation.menu)}</TableCell>
                      <TableCell className="min-w-52">
                        {reservation.ingredients.length ? (
                          reservation.ingredients.map((ingredient, index) => (
                            <span key={`${ingredient.material_id}-${index}`} className="mb-1 block text-xs">
                            {ingredient.material}: {Number(ingredient.quantity).toLocaleString()} {ingredient.unit} · <strong>{ingredient.status}</strong>
                            </span>
                          ))
                        ) : (
                          <span className="text-xs text-amber-800">{reservation.stock_note ?? "No ingredients reserved."}</span>
                        )}
                      </TableCell>
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

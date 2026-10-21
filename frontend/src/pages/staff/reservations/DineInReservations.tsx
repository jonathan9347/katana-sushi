import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useSearchParams } from "react-router-dom";
import { CalendarDays } from "lucide-react";
import { Dialog } from "../../../components/ui/dialog";
import { MiniCalendar } from "../../../components/ui/MiniCalendar";
import { Button } from "../../../components/ui/button";
import { api } from "../../../lib/api";
import { getApiErrorMessage } from "../../../lib/errors";
import { formatManilaDate, formatManilaDateTime, formatTime12, manilaDateKey, todayManilaDateKey } from "../../../lib/dateTime";

type ReservationView = "tables" | "catering" | "pickup";

type StaffReservation = {
  id: string;
  type: "dine_in" | "catering";
  reference: string;
  customer_name: string;
  date: string;
  time: string;
  guests: number;
  status: string;
  reservation_type?: string;
  table_numbers: number[];
  package_name?: string | null;
};

type PickupOrder = {
  order_number: string;
  status: "pending_payment" | "payment_failed" | "pending_approval" | "confirmed" | "preparing" | "ready" | "released" | "completed" | "declined" | "cancelled" | "expired";
  payment_plan: "pay_now" | "pay_at_pickup";
  payment_status: string;
  payment_method: string | null;
  customer_name: string;
  created_at: string;
  ready_at: string | null;
  total: number;
  items: Array<{ name: string; quantity: number; total_price: number }>;
};

const activeReservationStatuses = new Set([
  "pending",
  "pending_approval",
  "confirmed",
  "approved",
  "seated",
  "preparing",
  "in_progress",
  "pending_final_payment"
]);
const activePickupStatuses = new Set(["pending_payment", "payment_failed", "pending_approval", "confirmed", "preparing", "ready"]);
const allViews: Array<{ id: ReservationView; label: string }> = [
  { id: "tables", label: "Tables" },
  { id: "catering", label: "Catering" },
  { id: "pickup", label: "Pickup" }
];

function getPermittedViews(role: string) {
  if (role === "admin") return allViews;
  if (role === "receptionist") return allViews.filter(({ id }) => id === "tables" || id === "pickup");
  if (role === "event_coordinator") return allViews.filter(({ id }) => id === "catering");
  if (role === "cashier" || role === "chef") return allViews.filter(({ id }) => id === "pickup");
  return [];
}

function formatStatus(status: string) {
  return status.replace(/_/g, " ");
}

function formatMoney(value: number) {
  return new Intl.NumberFormat("en-PH", { style: "currency", currency: "PHP" }).format(value);
}

export default function DineInReservations() {
  const [searchParams, setSearchParams] = useSearchParams();
  const role = localStorage.getItem("katana_role")?.toLowerCase() ?? "";
  const permittedViews = getPermittedViews(role);
  const requestedView = searchParams.get("view");
  const currentView = permittedViews.some(({ id }) => id === requestedView)
    ? requestedView as ReservationView
    : permittedViews[0]?.id ?? "tables";
  const [calendarOpen, setCalendarOpen] = useState(false);
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const [calendarMonth, setCalendarMonth] = useState(() => new Date(`${todayManilaDateKey()}T00:00:00+08:00`));
  const [readyNotice, setReadyNotice] = useState("");
  const previousPickupStatuses = useRef<Map<string, PickupOrder["status"]> | null>(null);
  const queryClient = useQueryClient();
  const canUpdatePickup = ["admin", "cashier", "chef"].includes(role);
  const canOpenCateringActions = role === "admin" || role === "event_coordinator";

  const reservationsQuery = useQuery<StaffReservation[]>({
    queryKey: ["staff-reservations-all"],
    queryFn: async () => {
      const response = await api.get<{ reservations: StaffReservation[] }>("/api/staff/reservations/overview");
      return response.data.reservations;
    },
    refetchInterval: 60_000
  });
  const pickupQuery = useQuery<PickupOrder[]>({
    queryKey: ["staff-reservation-pickup-orders"],
    queryFn: async () => {
      const response = await api.get<{ orders: PickupOrder[] }>("/api/staff/reservations/overview/pickup");
      return response.data.orders;
    },
    enabled: currentView === "pickup",
    refetchInterval: 15_000
  });
  const pickupStatusMutation = useMutation({
    mutationFn: async (input: { order: PickupOrder; status: "preparing" | "ready" | "declined" }) => {
      await api.patch(`/api/admin/takeout/orders/${encodeURIComponent(input.order.order_number)}/status`, {
        status: input.status
      });
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["staff-reservation-pickup-orders"] });
    }
  });

  const upcomingReservations = useMemo(() => {
    const today = todayManilaDateKey();
    return (reservationsQuery.data ?? [])
      .filter((reservation) =>
        activeReservationStatuses.has(reservation.status) &&
        manilaDateKey(reservation.date) >= today
      )
      .sort((first, second) =>
        manilaDateKey(first.date).localeCompare(manilaDateKey(second.date)) ||
        first.time.localeCompare(second.time) ||
        first.reference.localeCompare(second.reference)
      );
  }, [reservationsQuery.data]);
  const tableReservations = upcomingReservations.filter((reservation) => reservation.type === "dine_in");
  const cateringReservations = upcomingReservations.filter((reservation) => reservation.type === "catering");
  const pickupOrders = (pickupQuery.data ?? [])
    .filter((order) => activePickupStatuses.has(order.status))
    .sort((first, second) =>
      first.created_at.localeCompare(second.created_at) ||
      first.order_number.localeCompare(second.order_number)
    );
  useEffect(() => {
    if (!pickupQuery.data) return;
    const previous = previousPickupStatuses.current;
    if (previous) {
      const newlyReady = pickupQuery.data
        .filter((order) => order.status === "ready" && previous.get(order.order_number) !== "ready")
        .map((order) => order.order_number);
      if (newlyReady.length > 0) {
        setReadyNotice(`${newlyReady.join(", ")} ${newlyReady.length === 1 ? "is" : "are"} ready for pickup.`);
      }
    }
    previousPickupStatuses.current = new Map(pickupQuery.data.map((order) => [order.order_number, order.status]));
  }, [pickupQuery.data]);

  const eventsByDate = useMemo(() => {
    const events = new Map<string, number>();
    if (currentView === "tables") {
      tableReservations.forEach((reservation) => {
        const date = manilaDateKey(reservation.date);
        events.set(date, (events.get(date) ?? 0) + 1);
      });
    } else if (currentView === "catering") {
      cateringReservations.forEach((reservation) => {
        const date = manilaDateKey(reservation.date);
        events.set(date, (events.get(date) ?? 0) + 1);
      });
    } else {
      pickupOrders.forEach((order) => {
        const date = manilaDateKey(order.created_at);
        events.set(date, (events.get(date) ?? 0) + 1);
      });
    }
    return events;
  }, [currentView, tableReservations, cateringReservations, pickupOrders]);

  const filteredTableReservations = tableReservations.filter((reservation) =>
    !selectedDate || manilaDateKey(reservation.date) === selectedDate
  );
  const filteredCateringReservations = cateringReservations.filter((reservation) =>
    !selectedDate || manilaDateKey(reservation.date) === selectedDate
  );
  const filteredPickupOrders = pickupOrders.filter((order) =>
    !selectedDate || manilaDateKey(order.created_at) === selectedDate
  );

  function selectView(view: ReservationView) {
    setSearchParams(view === "tables" ? {} : { view }, { replace: true });
    setSelectedDate(null);
  }

  function selectCalendarDate(date: string) {
    setSelectedDate(date);
    setCalendarOpen(false);
  }

  function updatePickup(order: PickupOrder, status: "preparing" | "ready" | "declined") {
    pickupStatusMutation.mutate({ order, status });
  }

  return (
    <main className="min-h-screen bg-slate-100 p-4 sm:p-6 lg:p-8">
      <section className="mx-auto w-full max-w-5xl">
        <header className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-xl bg-white px-5 py-4 shadow-sm">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-red-700">Staff Reservations</p>
            <h1 className="mt-1 text-2xl font-black text-slate-950">Upcoming {currentView}</h1>
          </div>
          <Button type="button" variant="outline" onClick={() => setCalendarOpen(true)}>
            <CalendarDays className="mr-2 h-4 w-4" />
            Calendar
          </Button>
        </header>

        <nav className="mb-4 flex flex-wrap gap-2 rounded-xl bg-white p-2 shadow-sm" aria-label="Reservation views">
          {permittedViews.map((view) => (
            <Button
              key={view.id}
              type="button"
              variant={currentView === view.id ? "default" : "outline"}
              aria-pressed={currentView === view.id}
              onClick={() => selectView(view.id)}
            >
              {view.label}
            </Button>
          ))}
        </nav>

        {selectedDate ? (
          <div className="mb-3 flex items-center justify-between gap-3 rounded-lg border border-slate-200 bg-white px-4 py-3">
            <p className="text-sm font-semibold text-slate-700">
              Showing {formatManilaDate(`${selectedDate}T12:00:00+08:00`, {
                weekday: "long",
                month: "long",
                day: "numeric",
                year: "numeric"
              })}
            </p>
            <Button type="button" size="sm" variant="outline" onClick={() => setSelectedDate(null)}>
              All upcoming
            </Button>
          </div>
        ) : null}

        <section className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm" aria-label={`${allViews.find((view) => view.id === currentView)?.label} upcoming list`}>
          {currentView === "pickup" ? (
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 px-5 py-3">
              <p className="text-sm font-semibold text-slate-600">Pickup order fulfillment</p>
              <Button type="button" variant="outline" size="sm" onClick={() => void pickupQuery.refetch()}>
                Refresh
              </Button>
            </div>
          ) : null}
          {currentView === "pickup" && readyNotice ? (
            <div role="status" className="flex items-center justify-between gap-3 border-b border-emerald-200 bg-emerald-50 px-5 py-3 text-sm font-bold text-emerald-900">
              <p>{readyNotice}</p>
              <button type="button" aria-label="Dismiss ready notification" onClick={() => setReadyNotice("")} className="rounded px-2 py-1 hover:bg-emerald-100">
                Dismiss
              </button>
            </div>
          ) : null}
          {currentView !== "pickup" && reservationsQuery.isLoading ? (
            <p className="p-5 text-sm text-slate-500" role="status">Loading reservations...</p>
          ) : currentView !== "pickup" && reservationsQuery.isError ? (
            <p className="p-5 text-sm text-red-700" role="alert">Unable to load reservations. Please refresh and try again.</p>
          ) : currentView === "pickup" && pickupQuery.isLoading ? (
            <p className="p-5 text-sm text-slate-500" role="status">Loading pickup orders...</p>
          ) : currentView === "pickup" && pickupQuery.isError ? (
            <p className="p-5 text-sm text-red-700" role="alert">Unable to load pickup orders. Please refresh and try again.</p>
          ) : currentView === "tables" ? (
            filteredTableReservations.length === 0 ? (
              <p className="p-5 text-sm text-slate-500">{selectedDate ? "No table reservations for this date." : "No upcoming table reservations."}</p>
            ) : (
              <ul className="divide-y divide-slate-100">
                {filteredTableReservations.map((reservation) => (
                  <li key={reservation.id} className="grid gap-2 px-5 py-4 sm:grid-cols-[minmax(10rem,1fr)_minmax(0,2fr)_auto] sm:items-center">
                    <div>
                      <p className="font-bold text-slate-950">{formatManilaDate(reservation.date, {
                        weekday: "short",
                        month: "short",
                        day: "numeric",
                        year: "numeric"
                      })}</p>
                      <p className="text-sm font-semibold text-slate-600">{formatTime12(reservation.time)}</p>
                    </div>
                    <div className="min-w-0">
                      <p className="truncate font-semibold text-slate-900">{reservation.customer_name}</p>
                      <p className="text-sm text-slate-600">
                        {reservation.reference} · {reservation.guests} guest{reservation.guests === 1 ? "" : "s"}
                        {reservation.reservation_type === "unlimited" ? " · Unlimited" : ""}
                      </p>
                    </div>
                    <div className="flex flex-wrap items-center gap-2 sm:justify-end">
                      <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold capitalize text-slate-700">{formatStatus(reservation.status)}</span>
                      <span className="text-sm text-slate-600">
                        Tables: {reservation.table_numbers.length > 0 ? reservation.table_numbers.join(", ") : "Not assigned"}
                      </span>
                    </div>
                  </li>
                ))}
              </ul>
            )
          ) : currentView === "catering" ? (
            <div>
              {canOpenCateringActions ? (
                <div className="flex justify-end border-b border-slate-100 px-5 py-3">
                  <Link className="text-sm font-semibold text-red-700 underline hover:text-red-900" to="/staff/catering">
                    Open actions
                  </Link>
                </div>
              ) : null}
              {filteredCateringReservations.length === 0 ? (
                <p className="p-5 text-sm text-slate-500">{selectedDate ? "No catering reservations for this date." : "No upcoming catering reservations."}</p>
              ) : (
                <ul className="divide-y divide-slate-100">
                  {filteredCateringReservations.map((reservation) => (
                    <li key={reservation.id} className="grid gap-2 px-5 py-4 sm:grid-cols-[minmax(10rem,1fr)_minmax(0,2fr)_auto] sm:items-center">
                      <div>
                        <p className="font-bold text-slate-950">{formatManilaDate(reservation.date, {
                          weekday: "short",
                          month: "short",
                          day: "numeric",
                          year: "numeric"
                        })}</p>
                        {reservation.time ? <p className="text-sm font-semibold text-slate-600">{formatTime12(reservation.time)}</p> : null}
                      </div>
                      <div className="min-w-0">
                        <p className="truncate font-semibold text-slate-900">{reservation.customer_name}</p>
                        <p className="text-sm text-slate-600">
                          {reservation.reference} · {reservation.guests} guest{reservation.guests === 1 ? "" : "s"}
                          {reservation.package_name ? ` · ${reservation.package_name}` : ""}
                        </p>
                      </div>
                      <span className="w-fit rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold capitalize text-slate-700">{formatStatus(reservation.status)}</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          ) : filteredPickupOrders.length === 0 ? (
            <p className="p-5 text-sm text-slate-500">{selectedDate ? "No pickup orders for this date." : "No active pickup orders."}</p>
          ) : (
            <ul className="divide-y divide-slate-100">
              {filteredPickupOrders.map((order) => (
                <li key={order.order_number} className="space-y-3 px-5 py-4">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <p className="font-bold text-slate-950">{order.order_number} · {order.customer_name}</p>
                      <p className="text-sm text-slate-600">{formatManilaDateTime(order.created_at, {
                        month: "short",
                        day: "numeric",
                        year: "numeric",
                        hour: "numeric",
                        minute: "2-digit"
                      })}</p>
                      {order.ready_at ? (
                        <p className="text-sm font-semibold text-emerald-800">
                          Pickup Time: {formatManilaDateTime(order.ready_at, { hour: "numeric", minute: "2-digit" })}
                        </p>
                      ) : null}
                    </div>
                    <div className="text-right text-sm">
                      <p className="font-semibold capitalize text-slate-800">{formatStatus(order.status)}</p>
                      <p className="text-slate-600">Pay at counter</p>
                    </div>
                  </div>
                  <ul className="grid gap-1 text-sm text-slate-700 sm:grid-cols-2">
                    {order.items.map((item, index) => (
                      <li key={`${item.name}-${index}`}>{item.quantity} × {item.name} · {formatMoney(item.total_price)}</li>
                    ))}
                  </ul>
                  <div className="flex flex-wrap items-center justify-between gap-2 border-t border-slate-100 pt-3">
                    <p className="font-bold text-slate-900">Total: {formatMoney(order.total)}</p>
                    <div className="flex flex-wrap justify-end gap-2">
                      {order.status === "ready" ? <span className="self-center text-sm font-semibold text-emerald-800">Ready for pickup</span> : null}
                      {canUpdatePickup && order.status === "pending_approval" ? (
                        <>
                          <Button
                            type="button"
                            disabled={pickupStatusMutation.isPending}
                            onClick={() => updatePickup(order, "preparing")}
                          >
                            Approve
                          </Button>
                          <Button
                            type="button"
                            variant="outline"
                            disabled={pickupStatusMutation.isPending}
                            onClick={() => updatePickup(order, "declined")}
                          >
                            Decline
                          </Button>
                        </>
                      ) : null}
                      {canUpdatePickup && order.status === "confirmed" ? (
                        <Button type="button" variant="outline" disabled={pickupStatusMutation.isPending} onClick={() => updatePickup(order, "preparing")}>
                          Start preparing
                        </Button>
                      ) : null}
                      {canUpdatePickup && order.status === "preparing" ? (
                        <Button type="button" variant="outline" disabled={pickupStatusMutation.isPending} onClick={() => updatePickup(order, "ready")}>
                          Mark ready
                        </Button>
                      ) : null}
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          )}
          {pickupStatusMutation.isError && currentView === "pickup" ? (
            <p className="border-t border-red-200 bg-red-50 px-5 py-3 text-sm text-red-800" role="alert">
              Unable to update pickup order: {getApiErrorMessage(pickupStatusMutation.error, "Please try again.")}
            </p>
          ) : null}
        </section>
      </section>

      <Dialog open={calendarOpen} title="Reservation calendar" onClose={() => setCalendarOpen(false)} panelClassName="max-w-4xl">
        <MiniCalendar
          month={calendarMonth}
          selectedDate={selectedDate ?? todayManilaDateKey()}
          eventsByDate={eventsByDate}
          onPreviousMonth={() => setCalendarMonth((current) => new Date(current.getFullYear(), current.getMonth() - 1, 1))}
          onNextMonth={() => setCalendarMonth((current) => new Date(current.getFullYear(), current.getMonth() + 1, 1))}
          onSelectDate={selectCalendarDate}
        />
      </Dialog>
    </main>
  );
}

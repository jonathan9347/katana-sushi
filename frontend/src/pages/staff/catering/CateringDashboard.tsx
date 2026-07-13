import { useQuery } from "@tanstack/react-query";
import { CalendarCheck, Inbox, LockKeyhole, RefreshCw } from "lucide-react";
import { FormEvent, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import SectionNav, { SectionNavTab } from "../../../components/layout/SectionNav";
import { Dialog } from "../../../components/ui/dialog";
import { formatManilaDate, manilaDateKey, todayManilaDateKey } from "../../../lib/dateTime";
import { api } from "../../../lib/api";

type Inquiry = {
  id: string;
  inquiry_id: string;
  customer_name: string;
  customer_phone: string;
  customer_email: string;
  event_date: string;
  headcount: number;
  venue_type: string;
  package_type?: string | null;
  message?: string | null;
  status: string;
};

type CateringReservation = {
  id: string;
  reservation_id?: string;
  confirmed_date: string;
  total_price: number;
  deposit_paid: number;
  remaining_balance: number;
  payment_plan: string;
  final_payment_status: string;
  status: string;
  inquiry?: Inquiry | null;
  package?: { name: string; pricePerPerson: number } | null;
  ingredient_locks: Array<{
    id: string;
    reserved_quantity: number;
    unit: string;
    is_released: boolean;
    raw_material: { name: string; current_stock: string };
  }>;
};

function dateText(date: string) {
  return formatManilaDate(date, { month: "short" });
}

function money(value: number) {
  return new Intl.NumberFormat("en-PH", { style: "currency", currency: "PHP" }).format(value);
}

type CateringTab = "pending" | "calendar" | "confirmed" | "locks";

function cateringTabs(pendingCount: number, reservationCount: number): Array<SectionNavTab<CateringTab>> {
  return [
    { id: "pending", label: `Pending Reservations (${pendingCount})`, icon: <CalendarCheck className="h-4 w-4" /> },
    { id: "calendar", label: "Calendar", icon: <CalendarCheck className="h-4 w-4" /> },
    { id: "confirmed", label: `Confirmed Events (${reservationCount})`, icon: <CalendarCheck className="h-4 w-4" /> },
    { id: "locks", label: "Ingredient Locker", icon: <LockKeyhole className="h-4 w-4" /> }
  ];
}

export default function CateringDashboard() {
  const [searchParams] = useSearchParams();
  const [activeTab, setActiveTab] = useState<CateringTab>("pending");
  const [completionTarget, setCompletionTarget] = useState<CateringReservation | null>(null);
  const [actionLoading, setActionLoading] = useState<Record<string, boolean>>({});
  const [eventForm, setEventForm] = useState({ total_price: "", deposit_paid: "", deposit_due_date: "" });
  const [calendarCursor, setCalendarCursor] = useState(() => new Date(`${todayManilaDateKey()}T00:00:00+08:00`));
  const [selectedCalendarDate, setSelectedCalendarDate] = useState(() => todayManilaDateKey());
  const pendingReservations = useQuery({
    queryKey: ["catering-reservations-pending"],
    queryFn: async () => (await api.get<{ reservations: CateringReservation[] }>("/api/staff/catering/reservations/pending")).data.reservations
  });
  const reservations = useQuery({
    queryKey: ["catering-reservations"],
    queryFn: async () => (await api.get<{ reservations: CateringReservation[] }>("/api/staff/catering/reservations")).data.reservations
  });

  const calendarDays = useMemo(() => {
    const first = new Date(calendarCursor.getFullYear(), calendarCursor.getMonth(), 1);
    const start = new Date(first);
    start.setDate(first.getDate() - first.getDay());

    return Array.from({ length: 42 }, (_, index) => {
      const day = new Date(start);
      day.setDate(start.getDate() + index);
      return day;
    });
  }, [calendarCursor]);

  const cateringByDate = useMemo(() => {
    const map = new Map<string, CateringReservation[]>();
    (reservations.data ?? []).forEach((reservation) => {
      const key = manilaDateKey(reservation.confirmed_date);
      map.set(key, [...(map.get(key) ?? []), reservation]);
    });
    return map;
  }, [reservations.data]);

  const selectedEvents = (cateringByDate.get(selectedCalendarDate) ?? []).sort((a, b) =>
    a.confirmed_date.localeCompare(b.confirmed_date)
  );

  useEffect(() => {
    const tab = searchParams.get("tab");

    if (tab === "confirmed" || tab === "locks" || tab === "pending" || tab === "calendar") {
      setActiveTab(tab as CateringTab);
    }
  }, [searchParams]);

  async function approvePendingReservation(id: string) {
    await api.put(`/api/staff/catering/reservations/${id}/approve`);
    await Promise.all([pendingReservations.refetch(), reservations.refetch()]);
  }

  async function startEvent(id: string) {
    setActionLoading((current) => ({ ...current, [id]: true }));
    try {
      await api.put(`/api/staff/catering/reservations/${id}/start-event`);
      await reservations.refetch();
      await pendingReservations.refetch();
    } finally {
      setActionLoading((current) => ({ ...current, [id]: false }));
    }
  }

  function shiftCalendarMonth(delta: number) {
    setCalendarCursor((current) => new Date(current.getFullYear(), current.getMonth() + delta, 1));
  }

  function hasOpenPayment(reservation: CateringReservation) {
    return Number(reservation.remaining_balance) > 0 || reservation.final_payment_status !== "paid";
  }

  async function recordCashPayment(reservation: CateringReservation) {
    setActionLoading((current) => ({ ...current, [reservation.id]: true }));
    try {
      await api.post(`/api/staff/catering/reservations/${reservation.id}/record-cash-payment`, {
        amount: reservation.remaining_balance,
        received_by: "Staff"
      });
      await reservations.refetch();
      await pendingReservations.refetch();
    } finally {
      setActionLoading((current) => ({ ...current, [reservation.id]: false }));
    }
  }

  async function complete(id: string) {
    setActionLoading((current) => ({ ...current, [id]: true }));
    try {
      await api.put(`/api/staff/catering/reservations/${id}/complete`);
      setCompletionTarget(null);
      await Promise.all([reservations.refetch(), pendingReservations.refetch()]);
    } finally {
      setActionLoading((current) => ({ ...current, [id]: false }));
    }
  }


  return (
    <main className="min-h-screen min-w-[1280px] bg-slate-100 p-8">
      <section className="mx-auto max-w-6xl rounded-lg border border-slate-200 bg-white shadow-sm">
        <div className="flex items-center justify-between border-b border-slate-200 px-6 py-4">
          <h1 className="text-xl font-bold uppercase tracking-wide text-slate-950">Catering Management</h1>
          <button onClick={() => void Promise.all([pendingReservations.refetch(), reservations.refetch()])} className="flex items-center gap-2 rounded-md border border-slate-300 px-3 py-2 text-sm font-semibold text-slate-700">
            <RefreshCw className="h-4 w-4" /> Refresh
          </button>
        </div>
        <div className="p-6">
          <SectionNav
            activeTab={activeTab}
            className="mb-6"
            tabs={cateringTabs(
              pendingReservations.data?.length ?? 0,
              reservations.data?.filter((reservation) => reservation.status === "confirmed").length ?? 0
            )}
            onTabChange={setActiveTab}
          />

          {activeTab === "pending" && (
          <section>
            <h2 className="mb-3 text-sm font-bold uppercase tracking-wide text-slate-600">Pending Catering Reservations</h2>
            <div className="space-y-4">
              {pendingReservations.data?.map((reservation) => (
                <article key={reservation.id} className="rounded-lg border border-slate-200 p-5">
                  <h3 className="text-lg font-bold text-slate-950">
                    {reservation.reservation_id ?? "No ID"} | {reservation.package?.name ?? reservation.inquiry?.package_type?.replace("_", " ") ?? "Package"}
                  </h3>
                  <p className="mt-1 text-sm text-slate-700">
                    {reservation.inquiry ? `${reservation.inquiry.customer_name} | ${reservation.inquiry.customer_phone} | ${reservation.inquiry.customer_email}` : "No inquiry details"}
                  </p>
                  <p className="mt-2 text-sm text-slate-600">
                    {reservation.inquiry ? `${dateText(reservation.confirmed_date)} · ${reservation.inquiry.headcount} pax` : "Details pending"}
                  </p>
                  <div className="mt-4 flex flex-wrap gap-3">
                    <button onClick={() => void approvePendingReservation(reservation.id)} className="rounded-md bg-emerald-700 px-4 py-2 text-sm font-bold text-white">
                      Approve Event
                    </button>
                  </div>
                </article>
              ))}
              {pendingReservations.data?.length === 0 && <p className="rounded-md bg-slate-50 p-4 text-sm text-slate-600">No pending catering reservations.</p>}
            </div>
          </section>
          )}

          {activeTab === "calendar" && (
          <section>
            <div className="mb-4 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <h2 className="mb-2 text-sm font-bold uppercase tracking-wide text-slate-600">Catering Calendar</h2>
                <p className="text-sm text-slate-600">View confirmed and in-progress catering events by date.</p>
              </div>
              <div className="flex items-center gap-2">
                <button onClick={() => shiftCalendarMonth(-1)} className="rounded-md border border-slate-300 px-3 py-2 text-sm font-bold text-slate-700">Previous</button>
                <button onClick={() => shiftCalendarMonth(1)} className="rounded-md border border-slate-300 px-3 py-2 text-sm font-bold text-slate-700">Next</button>
              </div>
            </div>
            <div className="grid gap-6 lg:grid-cols-[1.4fr_0.9fr]">
              <div>
                <div className="grid grid-cols-7 gap-2 text-center text-xs font-black uppercase text-slate-500">
                  {['Sun','Mon','Tue','Wed','Thu','Fri','Sat'].map((day) => <div key={day}>{day}</div>)}
                </div>
                <div className="mt-2 grid grid-cols-7 gap-2">
                  {calendarDays.map((day) => {
                    const key = manilaDateKey(day);
                    const events = cateringByDate.get(key) ?? [];
                    const selected = key === selectedCalendarDate;
                    const inMonth = day.getMonth() === calendarCursor.getMonth();

                    return (
                      <button
                        key={key}
                        onClick={() => setSelectedCalendarDate(key)}
                        className={`min-h-24 rounded-md border p-2 text-left ${selected ? 'border-red-700 bg-red-50' : 'border-slate-200 bg-white'} ${inMonth ? 'text-slate-950' : 'text-slate-400'}`}
                      >
                        <span className="text-sm font-black">{day.getDate()}</span>
                        {events.length > 0 && <span className="mt-2 block rounded-full bg-slate-950 px-2 py-1 text-[11px] font-bold text-white">{events.length}</span>}
                      </button>
                    );
                  })}
                </div>
              </div>

              <aside className="rounded-3xl border border-slate-200 bg-slate-50 p-5">
                <div className="mb-4">
                  <p className="text-sm font-semibold uppercase tracking-wide text-slate-600">Events for {formatManilaDate(selectedCalendarDate)}</p>
                </div>
                <div className="space-y-4">
                  {selectedEvents.length > 0 ? (
                    selectedEvents.map((reservation) => (
                      <article key={reservation.id} className="rounded-3xl border border-slate-200 bg-white p-4 shadow-sm">
                        <div className="space-y-3">
                          <div>
                            <p className="text-lg font-bold text-slate-950">{reservation.reservation_id ?? 'No ID'}</p>
                            <p className="mt-1 text-sm text-slate-700">{reservation.package?.name ?? reservation.inquiry?.package_type?.replace('_', ' ') ?? 'Custom'}</p>
                          </div>
                          <div className="grid gap-2 text-sm text-slate-700">
                            <p>{reservation.inquiry?.customer_name ?? 'Unknown customer'}</p>
                            <p>{reservation.inquiry?.headcount ?? '—'} pax</p>
                            <p>Status: {reservation.status.replace('_', ' ')}</p>
                            <p>Total: {money(reservation.total_price)}</p>
                            <p>Deposit: {money(reservation.deposit_paid)}</p>
                            <p>Remaining: {money(reservation.remaining_balance)}</p>
                          </div>
                        </div>
                      </article>
                    ))
                  ) : (
                    <div className="rounded-3xl border border-slate-200 bg-white p-5 text-sm text-slate-600">No catering events scheduled for this date.</div>
                  )}
                </div>
              </aside>
            </div>
          </section>
          )}

          {activeTab === "confirmed" && (
          <section>
            <h2 className="mb-3 text-sm font-bold uppercase tracking-wide text-slate-600">Confirmed Events</h2>
            <div className="space-y-4">
              {reservations.data?.filter((reservation) => reservation.status === "confirmed").map((reservation) => (
                <article key={reservation.id} className="rounded-lg border border-slate-200 p-5">
                  <h3 className="text-lg font-bold text-slate-950">
                    {reservation.reservation_id ?? reservation.inquiry?.inquiry_id ?? "No ID"} | {dateText(reservation.confirmed_date)} | {reservation.inquiry?.headcount ?? "—"} pax
                  </h3>
                  <p className="mt-1 text-sm text-slate-700">
                    Package: {reservation.package?.name ?? reservation.inquiry?.package_type?.replace("_", " ") ?? "Custom"} | Deposit: {money(reservation.deposit_paid)} | Status: {reservation.status}
                  </p>
                  <div className="mt-4 flex flex-wrap gap-3">
                    {reservation.status === "confirmed" && reservation.remaining_balance > 0 ? (
                      <button
                        onClick={() => void recordCashPayment(reservation)}
                        className="rounded-md bg-amber-600 px-4 py-2 text-sm font-bold text-white hover:bg-amber-700 disabled:opacity-50"
                        disabled={actionLoading[reservation.id]}
                      >
                        {actionLoading[reservation.id] ? "Processing..." : "Record cash payment"}
                      </button>
                    ) : null}
                    {reservation.status === "confirmed" ? (
                      <button
                        onClick={() => void startEvent(reservation.id)}
                        className="rounded-md bg-emerald-700 px-4 py-2 text-sm font-bold text-white hover:bg-emerald-800 disabled:opacity-50"
                        disabled={actionLoading[reservation.id]}
                      >
                        {actionLoading[reservation.id] ? "Processing..." : "Start Event"}
                      </button>
                    ) : null}
                    {(reservation.status === "in_progress" || reservation.status === "pending_final_payment") ? (
                      <button
                        onClick={() => setCompletionTarget(reservation)}
                        className="rounded-md bg-red-700 px-4 py-2 text-sm font-bold text-white hover:bg-red-800 disabled:opacity-50"
                        disabled={actionLoading[reservation.id] || hasOpenPayment(reservation)}
                      >
                        {actionLoading[reservation.id] ? "Processing..." : hasOpenPayment(reservation) ? "Pending payment" : "Complete Event"}
                      </button>
                    ) : null}
                    <button onClick={() => setActiveTab("locks")} className="rounded-md border border-slate-300 px-4 py-2 text-sm font-bold text-slate-800">
                      View Locks
                    </button>
                  </div>
                </article>
              ))}
              {reservations.data?.filter((reservation) => reservation.status === "confirmed").length === 0 && <p className="rounded-md bg-slate-50 p-4 text-sm text-slate-600">No confirmed events.</p>}
            </div>
          </section>
          )}

          {activeTab === "locks" && (
          <section>
            <h2 className="mb-3 text-sm font-bold uppercase tracking-wide text-slate-600">Ingredient Locker</h2>
            <div className="space-y-4">
              {reservations.data?.flatMap((reservation) =>
                reservation.ingredient_locks.length > 0 ? (
                  <article key={`${reservation.id}-locks`} className="rounded-lg border border-slate-200 p-5">
                    <h3 className="font-bold text-slate-950">
                      {dateText(reservation.confirmed_date)} {reservation.inquiry?.venue_type ?? ""}
                    </h3>
                    <ul className="mt-3 space-y-1 text-sm text-slate-700">
                      {reservation.ingredient_locks
                        .slice()
                        .sort((a, b) => {
                          if (a.is_released !== b.is_released) {
                            return a.is_released ? 1 : -1;
                          }
                          return a.raw_material.name.localeCompare(b.raw_material.name);
                        })
                        .map((lock) => (
                          <li key={lock.id}>
                            {lock.raw_material.name}: {lock.reserved_quantity}{lock.unit} {lock.is_released ? "released" : "reserved"}
                          </li>
                        ))}
                    </ul>
                  </article>
                ) : []
              )}
              {reservations.data?.every((reservation) => reservation.ingredient_locks.length === 0) && (
                <p className="rounded-md bg-slate-50 p-4 text-sm text-slate-600">No ingredient locks have been set.</p>
              )}
            </div>
          </section>
          )}
        </div>
      </section>

      <Dialog
        open={Boolean(completionTarget)}
        title={`Complete Event${completionTarget?.inquiry?.customer_name ? `: ${completionTarget.inquiry.customer_name}` : ""}`}
        onClose={() => setCompletionTarget(null)}
      >
        {completionTarget && (
          <div className="grid gap-4 text-sm text-slate-700">
            <div className="rounded-md bg-slate-50 p-3">
              <p className="font-bold text-slate-950">
                {completionTarget.inquiry?.customer_name ?? "Customer"} - {dateText(completionTarget.confirmed_date)}
              </p>
              <p>{completionTarget.inquiry?.headcount ?? "—"} pax | {money(completionTarget.total_price)}</p>
            </div>
            <div>
              <p className="font-semibold text-slate-950">This will:</p>
              <ul className="mt-2 list-disc space-y-1 pl-5">
                <li>Release all ingredient locks for this event.</li>
                <li>Deduct reserved ingredients from inventory permanently.</li>
                <li>Mark the event as completed.</li>
              </ul>
            </div>
            <div className="rounded-md border border-slate-200 bg-white p-3">
              <p className="font-semibold text-slate-950">Reserved ingredients to deduct</p>
              <ul className="mt-2 space-y-1">
                {completionTarget.ingredient_locks.filter((lock) => !lock.is_released).map((lock) => (
                  <li key={lock.id}>{lock.raw_material.name}: {lock.reserved_quantity} {lock.unit}</li>
                ))}
                {completionTarget.ingredient_locks.every((lock) => lock.is_released) && <li>No active locks remain.</li>}
              </ul>
            </div>
            <div className="flex flex-col gap-3">
              {hasOpenPayment(completionTarget) ? (
                <div className="rounded-md bg-amber-50 p-3 text-sm text-amber-900">
                  This event cannot be completed until the remaining balance is fully settled. Please record payment first.
                </div>
              ) : null}
              <div className="flex justify-end gap-2">
                <button type="button" onClick={() => setCompletionTarget(null)} className="rounded-md border border-slate-300 px-4 py-2 text-sm font-bold text-slate-700">
                  Cancel
                </button>
                <button onClick={() => void complete(completionTarget.id)} className="rounded-md bg-red-700 px-4 py-2 text-sm font-bold text-white" disabled={actionLoading[completionTarget.id] || hasOpenPayment(completionTarget)}>
                  {actionLoading[completionTarget.id] ? "Processing..." : "Confirm & Release"}
                </button>
              </div>
            </div>
          </div>
        )}
      </Dialog>
    </main>
  );
}

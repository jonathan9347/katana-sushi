import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { BarChart3, Clock3, Hourglass, UtensilsCrossed } from "lucide-react";
import { api } from "../../../lib/api";
import { formatManilaDate, formatTime12, manilaDateKey, todayManilaDateKey } from "../../../lib/dateTime";
import { MiniCalendar } from "../../../components/ui/MiniCalendar";
import { ReservationDetailsModal } from "../../../components/ui/ReservationDetailsModal";
import { QuickStatsWidget } from "../../../components/dinein/QuickStatsWidget";
import { Button } from "../../../components/ui/button";
import { Dialog } from "../../../components/ui/dialog";
import DineInPayRemainingModal from "./DineInPayRemainingModal";


type StaffReservation = {
  id: string;
  type: "dine_in" | "catering";
  reference: string;
  customer_name: string;
  phone?: string;
  email?: string;
  date: string;
  time: string;
  guests: number;
  total_price: number;
  status: string;
  payment_plan?: string;
  downpayment_amount?: number;
  remaining_balance?: number;
  payment_status?: string;
  payment_history?: Array<{
    id: string;
    payment_stage: string;
    method: string;
    amount: number;
    reference_number?: string | null;
    cash_received?: number | null;
    change_due?: number | null;
    received_at?: string | null;
  }>;
  special_requests?: string | null;
  package_name?: string | null;
  venue_type?: string | null;
};

function today() {
  return todayManilaDateKey();
}

function isPending(status: string) {
  return status === "pending" || status === "pending_approval";
}

export default function DineInReservations() {
  const [selectedDate, setSelectedDate] = useState(today());
  const [timelineMonth, setTimelineMonth] = useState(() => today().slice(0, 7));
  const [dateSummaryOpen, setDateSummaryOpen] = useState(false);
  const [quickStatsOpen, setQuickStatsOpen] = useState(false);
  const [pendingOpen, setPendingOpen] = useState(false);
  const [cursor, setCursor] = useState(() => new Date(`${today()}T00:00:00+08:00`));
  const [activeReservation, setActiveReservation] = useState<StaffReservation | null>(null);
  const [cancelTarget, setCancelTarget] = useState<StaffReservation | null>(null);
  const [cancelReason, setCancelReason] = useState("");
  const [cancelCashAmount, setCancelCashAmount] = useState("0");
  const [payOpen, setPayOpen] = useState(false);
  const [actionLoading, setActionLoading] = useState<Record<string, boolean>>({});


  const query = useQuery<StaffReservation[]>({
    queryKey: ["staff-reservations-all"],
    queryFn: async () => {
      const response = await api.get<{ reservations: StaffReservation[] }>("/api/staff/reservations/all");
      return response.data.reservations;
    }
  });

  const dineInReservations = useMemo(
    () => (query.data ?? []).filter((reservation) => reservation.type === "dine_in"),
    [query.data]
  );

  const eventsByDate = useMemo(() => {
    const map = new Map<string, number>();
    dineInReservations.forEach((reservation) => {
      const key = manilaDateKey(reservation.date);
      map.set(key, (map.get(key) ?? 0) + 1);
    });
    return map;
  }, [dineInReservations]);

  const selectedReservations = useMemo(
    () =>
      (eventsByDate.get(selectedDate)
        ? dineInReservations.filter((reservation) => manilaDateKey(reservation.date) === selectedDate)
        : []
      ).sort((a, b) => a.time.localeCompare(b.time)),
    [dineInReservations, eventsByDate, selectedDate]
  );

  const chronologicalReservations = useMemo(
    () => [...dineInReservations].sort((a, b) =>
      manilaDateKey(a.date).localeCompare(manilaDateKey(b.date)) || a.time.localeCompare(b.time)
    ),
    [dineInReservations]
  );

  const reservationsByMonth = useMemo(() => {
    const groups = new Map<string, StaffReservation[]>();
    chronologicalReservations.forEach((reservation) => {
      const monthKey = manilaDateKey(reservation.date).slice(0, 7);
      groups.set(monthKey, [...(groups.get(monthKey) ?? []), reservation]);
    });
    return Array.from(groups.entries());
  }, [chronologicalReservations]);

  const visibleMonthGroups = timelineMonth === "all"
    ? reservationsByMonth
    : reservationsByMonth.filter(([monthKey]) => monthKey === timelineMonth);
  const visibleTimelineCount = visibleMonthGroups.reduce((total, [, reservations]) => total + reservations.length, 0);

  const pendingReservations = useMemo(
    () => chronologicalReservations.filter((reservation) => isPending(reservation.status)),
    [chronologicalReservations]
  );

  const pendingCount = dineInReservations.filter((reservation) => isPending(reservation.status)).length;

  function shiftMonth(delta: number) {
    setCursor((current) => new Date(current.getFullYear(), current.getMonth() + delta, 1));
  }

  function handleSelectDate(date: string) {
    setSelectedDate(date);
    setTimelineMonth(date.slice(0, 7));
    setDateSummaryOpen(true);
  }

  async function handleApprove(reservation: StaffReservation) {
    setActionLoading((current) => ({ ...current, [reservation.id]: true }));
    try {
      await api.put(`/api/staff/reservations/${reservation.id}/approve`, { admin_notes: "Approved by staff" });
      await query.refetch();
    } finally {
      setActionLoading((current) => ({ ...current, [reservation.id]: false }));
    }
  }

  async function handleArrive(reservation: StaffReservation) {
    setActionLoading((current) => ({ ...current, [reservation.id]: true }));
    try {
      await api.put(`/api/staff/reservations/${reservation.id}/arrive`);
      await query.refetch();
    } finally {
      setActionLoading((current) => ({ ...current, [reservation.id]: false }));
    }
  }

  async function handleComplete(reservation: StaffReservation) {
    setActionLoading((current) => ({ ...current, [reservation.id]: true }));
    try {
      await api.put(`/api/staff/reservations/${reservation.id}/complete`);
      await query.refetch();
    } finally {
      setActionLoading((current) => ({ ...current, [reservation.id]: false }));
    }
  }

  async function handleCancel(reservation: StaffReservation) {
    setActionLoading((current) => ({ ...current, [reservation.id]: true }));
    try {
      await api.put(`/api/staff/reservations/${reservation.id}/cancel`, {
        reason: cancelReason || "Customer cancelled reservation.",
        amount: Number(cancelCashAmount || 0),
        payment_method: "cash",
        cash_received: Number(cancelCashAmount || 0)
      });
      setCancelTarget(null);
      setCancelReason("");
      setCancelCashAmount("0");
      await query.refetch();
    } finally {
      setActionLoading((current) => ({ ...current, [reservation.id]: false }));
    }
  }

  const modalActions: Array<{
    label: string;
    onClick: () => void;
    variant?: "default" | "outline" | "ghost" | "danger";
    disabled?: boolean;
  }> = activeReservation
    ? [
        ...(isPending(activeReservation.status)
          ? [
              {
                label: "Approve reservation",
                onClick: () => {
                  void handleApprove(activeReservation);
                  setActiveReservation(null);
                },
                variant: "default" as const,
                disabled: actionLoading[activeReservation.id]
              }
            ]
          : []),
        ...(activeReservation.status === "confirmed"
          ? [
              {
                label: "Mark arrived",
                onClick: () => {
                  void handleArrive(activeReservation);
                  setActiveReservation(null);
                },
                variant: "outline" as const,
                disabled: actionLoading[activeReservation.id]
              }
            ]
          : []),
        ...(activeReservation.status === "seated"
          ? [
              {
                label: Number(activeReservation.remaining_balance ?? 0) > 0 ? "Complete reservation" : "Complete reservation",
                onClick: () => {
                  void handleComplete(activeReservation);
                  setActiveReservation(null);
                },
                variant: "danger" as const,
                disabled: actionLoading[activeReservation.id] || Number(activeReservation.remaining_balance ?? 0) > 0 || activeReservation.payment_status !== "paid"
              }
            ]
          : []),
        ...(activeReservation.status === "pending_final_payment"
          ? [
              {
                label: "Pay remaining & complete",
                onClick: () => {
                  setPayOpen(true);
                },
                variant: "danger" as const,
                disabled: actionLoading[activeReservation.id]
              }
            ]
          : []),
        ...((activeReservation.status === "pending" || activeReservation.status === "pending_approval" || activeReservation.status === "confirmed" || activeReservation.status === "seated")
          ? [
              {
                label: "Cancel reservation",
                onClick: () => {
                  setCancelTarget(activeReservation);
                  setCancelReason("Customer cancelled the reservation.");
                  setCancelCashAmount(String(Number(activeReservation.remaining_balance ?? activeReservation.total_price ?? 0).toFixed(2)));
                },
                variant: "danger" as const,
                disabled: actionLoading[activeReservation.id]
              }
            ]
          : [])
      ]
    : [];


  function statusDotClass(status: string) {
    if (status === "confirmed" || status === "seated") {
      return "bg-emerald-500";
    }
    if (isPending(status)) {
      return "bg-amber-500";
    }
    if (status === "pending_final_payment") {
      return "bg-sky-500";
    }
    return "bg-slate-400";
  }

  function statusSummaryClass(status: string) {
    if (status === "confirmed" || status === "seated") {
      return "bg-emerald-50 text-emerald-700";
    }
    if (status === "pending_final_payment") {
      return "bg-amber-50 text-amber-700";
    }
    if (status === "cancelled" || status === "rejected") {
      return "bg-red-50 text-red-700";
    }
    return "bg-slate-100 text-slate-700";
  }

  return (
    <main className="min-h-screen bg-slate-100 p-6 lg:p-8">
      <section className="mx-auto w-full max-w-[1800px]">
        <div className="sticky top-0 z-30 flex flex-col gap-3 bg-slate-100/95 px-4 py-3 sm:px-5 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <div className="flex flex-wrap items-center gap-2 text-xs font-semibold uppercase tracking-wide text-red-700">
              <UtensilsCrossed className="h-4 w-4" aria-hidden="true" />
              <span>Dine-in Reservations</span>
            </div>
            <h1 className="mt-1 text-xl font-black uppercase text-slate-950 sm:text-2xl">Dine-in reservations</h1>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button type="button" variant="outline" onClick={() => setQuickStatsOpen(true)}>
              <BarChart3 className="mr-2 h-4 w-4" />
              Quick Stats
            </Button>
            <Button type="button" variant="outline" onClick={() => setPendingOpen(true)}>
              <Hourglass className="mr-2 h-4 w-4" />
              Pending <span className="ml-1 rounded-full bg-amber-100 px-2 py-0.5 text-xs text-amber-800">{pendingCount}</span>
            </Button>
          </div>
        </div>

        <div className="grid gap-5 p-4 sm:p-5 xl:grid-cols-[minmax(0,2fr)_minmax(18rem,0.85fr)]">
          <aside className="min-w-0 xl:h-[calc(100vh-10rem)] xl:overflow-y-auto xl:overscroll-contain">
            <MiniCalendar
              month={cursor}
              selectedDate={selectedDate}
              eventsByDate={eventsByDate}
              framed
              onPreviousMonth={() => shiftMonth(-1)}
              onNextMonth={() => shiftMonth(1)}
              onSelectDate={handleSelectDate}
            />
          </aside>

          <section className="min-w-0 overflow-hidden rounded-2xl border border-slate-200 bg-white xl:h-[calc(100vh-9rem)]">
            <div className="max-h-[72vh] overflow-y-auto xl:h-full xl:max-h-none">
            <header className="sticky top-0 z-20 flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 bg-white px-4 py-3 sm:px-5">
              <div>
                <h2 className="text-lg font-black text-slate-950">Reservation timeline</h2>
                <p className="mt-1 text-sm text-slate-500">{timelineMonth === "all" ? "All months · earliest to latest" : formatManilaDate(`${timelineMonth}-01T12:00:00+08:00`, { month: "long", year: "numeric" })}</p>
              </div>
              <div className="flex items-center gap-2">
                <label className="sr-only" htmlFor="reservation-timeline-month">Show reservations for</label>
                <select
                  id="reservation-timeline-month"
                  value={timelineMonth}
                  onChange={(event) => setTimelineMonth(event.target.value)}
                  className="h-10 max-w-44 rounded-md border border-slate-300 bg-white px-3 text-sm font-semibold text-slate-700 outline-none focus:border-red-700 focus:ring-2 focus:ring-red-100"
                >
                  <option value="all">All months</option>
                  {[...new Set([today().slice(0, 7), ...reservationsByMonth.map(([monthKey]) => monthKey)])]
                    .sort((a, b) => b.localeCompare(a))
                    .map((monthKey) => (
                      <option key={monthKey} value={monthKey}>
                        {formatManilaDate(`${monthKey}-01T12:00:00+08:00`, { month: "long", year: "numeric" })}
                      </option>
                    ))}
                </select>
                <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold text-slate-600">
                  {visibleTimelineCount}
                </span>
              </div>
            </header>
            {query.isLoading ? (
              <p className="p-6 text-sm text-slate-500" role="status">Loading reservations...</p>
            ) : query.isError ? (
              <p className="p-6 text-sm text-red-700" role="alert">Unable to load the reservation timeline.</p>
            ) : chronologicalReservations.length === 0 ? (
              <p className="p-6 text-sm text-slate-500">No dine-in reservations yet.</p>
            ) : visibleTimelineCount === 0 ? (
              <p className="p-6 text-sm text-slate-500">
                No reservations in {formatManilaDate(`${timelineMonth}-01T12:00:00+08:00`, { month: "long", year: "numeric" })}. Choose another month or All months.
              </p>
            ) : (
              <div>
                {visibleMonthGroups.map(([monthKey, monthReservations]) => (
                  <section key={monthKey} aria-labelledby={`reservation-month-${monthKey}`}>
                    <h3 id={`reservation-month-${monthKey}`} className="border-y border-slate-200 bg-slate-100 px-4 py-2.5 text-sm font-black uppercase text-slate-700 sm:px-5">
                      {formatManilaDate(monthReservations[0].date, { month: "long", year: "numeric" })}
                      <span className="ml-2 text-xs font-semibold text-slate-500">{monthReservations.length}</span>
                    </h3>
                    <ol className="divide-y divide-slate-100">
                      {monthReservations.map((reservation, index) => {
                        const dateKey = manilaDateKey(reservation.date);
                        const previousDateKey = index > 0 ? manilaDateKey(monthReservations[index - 1].date) : "";

                        return (
                          <li key={reservation.id}>
                            {dateKey !== previousDateKey && (
                              <div className="border-y border-slate-100 bg-slate-50 px-4 py-2 text-xs font-bold uppercase text-slate-600 sm:px-5">
                                {formatManilaDate(reservation.date, { weekday: "short", month: "short", day: "numeric", year: "numeric" })}
                              </div>
                            )}
                            <button
                              type="button"
                              onClick={() => setActiveReservation(reservation)}
                              className="grid w-full gap-3 px-4 py-4 text-left transition hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-red-700 sm:grid-cols-[90px_minmax(0,1fr)_auto] sm:items-center sm:px-5"
                            >
                              <span className="flex items-center gap-2 text-sm font-bold text-slate-800">
                                <Clock3 className="h-4 w-4 text-slate-400" aria-hidden="true" />
                                {formatTime12(reservation.time)}
                              </span>
                              <span className="min-w-0">
                                <span className="block truncate font-semibold text-slate-950">{reservation.customer_name}</span>
                                <span className="mt-1 block text-sm text-slate-500">{reservation.reference} · {reservation.guests} guests</span>
                              </span>
                              <span className={`w-fit rounded-full px-2.5 py-1 text-xs font-bold uppercase ${statusSummaryClass(reservation.status)}`}>
                                {reservation.status.replace(/_/g, " ")}
                              </span>
                            </button>
                          </li>
                        );
                      })}
                    </ol>
                  </section>
                ))}
              </div>
            )}
            </div>
          </section>
        </div>
      </section>

      <Dialog open={quickStatsOpen} title="Dine-in quick stats" onClose={() => setQuickStatsOpen(false)} panelClassName="max-w-2xl">
        <QuickStatsWidget
          selectedDate={selectedDate}
          reservations={dineInReservations}
          isLoading={query.isLoading}
          onViewPending={() => {
            setQuickStatsOpen(false);
            setPendingOpen(true);
          }}
        />
      </Dialog>

      <Dialog open={pendingOpen} title={`Pending reservations (${pendingReservations.length})`} onClose={() => setPendingOpen(false)} panelClassName="max-w-2xl">
        <div className="grid gap-3">
          {pendingReservations.length === 0 ? (
            <p className="rounded-md border border-dashed border-slate-300 p-6 text-center text-sm text-slate-600">There are no pending dine-in reservations.</p>
          ) : (
            pendingReservations.map((reservation) => (
              <article key={reservation.id} className="flex flex-col gap-3 rounded-md border border-slate-200 p-4 sm:flex-row sm:items-center sm:justify-between">
                <div className="min-w-0">
                  <p className="truncate font-semibold text-slate-950">{reservation.customer_name}</p>
                  <p className="mt-1 text-sm text-slate-600">
                    {formatManilaDate(reservation.date, { month: "short", day: "numeric", year: "numeric" })} · {formatTime12(reservation.time)} · {reservation.guests} guests
                  </p>
                  <p className="mt-1 text-xs text-slate-500">{reservation.reference}</p>
                </div>
                <Button size="sm" variant="outline" onClick={() => {
                  setPendingOpen(false);
                  setActiveReservation(reservation);
                }}>
                  Review
                </Button>
              </article>
            ))
          )}
        </div>
      </Dialog>

      <Dialog
        open={dateSummaryOpen}
        title={`Bookings on ${formatManilaDate(selectedDate)}`}
        onClose={() => setDateSummaryOpen(false)}
        panelClassName="max-w-3xl"
      >
        <div className="grid gap-3">
          {selectedReservations.length === 0 ? (
            <p className="rounded-md border border-dashed border-slate-300 p-6 text-center text-sm text-slate-600">
              No dine-in reservations scheduled for this date.
            </p>
          ) : (
            selectedReservations.map((reservation) => (
              <article key={reservation.id} className="flex flex-col gap-3 rounded-md border border-slate-200 bg-white p-4 sm:flex-row sm:items-center sm:justify-between">
                <div className="min-w-0">
                  <p className="font-bold text-slate-950">{formatTime12(reservation.time)} · {reservation.customer_name}</p>
                  <p className="mt-1 text-sm text-slate-600">{reservation.reference} · {reservation.guests} guests</p>
                  <span className={`mt-2 inline-flex rounded-full px-2 py-1 text-xs font-bold uppercase ${statusSummaryClass(reservation.status)}`}>
                    {reservation.status.replace(/_/g, " ")}
                  </span>
                </div>
                <Button size="sm" variant="outline" onClick={() => {
                  setDateSummaryOpen(false);
                  setActiveReservation(reservation);
                }}>
                  View booking
                </Button>
              </article>
            ))
          )}
        </div>
      </Dialog>

      <ReservationDetailsModal
        open={Boolean(activeReservation)}
        title={activeReservation ? `${activeReservation.reference} details` : "Reservation details"}
        reservation={activeReservation}
        onClose={() => setActiveReservation(null)}
        actions={modalActions}
        onPaymentRecorded={async () => {
          const result = await query.refetch();
          const updated = result.data?.find((reservation) => reservation.id === activeReservation?.id) ?? null;
          setActiveReservation(updated);
        }}
      />

      <DineInPayRemainingModal
        open={payOpen}
        bookingId={activeReservation?.reference ?? ""}
        remainingBalance={Number(activeReservation?.remaining_balance ?? 0)}
        onClose={() => setPayOpen(false)}
        onPaid={async () => {
          setPayOpen(false);
          if (activeReservation) {
            await query.refetch();
            // After paying remaining, mark as completed (backend complete sets status based on payment_plan/balance).
            await api.put(`/api/staff/reservations/${activeReservation.id}/complete`);
            await query.refetch();
          }
          setActiveReservation(null);
        }}
      />

      <Dialog open={Boolean(cancelTarget)} title="Cancel reservation" onClose={() => setCancelTarget(null)} panelClassName="max-w-xl">
        {cancelTarget ? (
          <div className="grid gap-4">
            <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-800">
              <p className="font-semibold">This action will cancel the reservation, clear its remaining balance, and record the cancellation cash amount.</p>
            </div>
            <label className="grid gap-1 text-sm font-semibold text-slate-700">
              Cancellation reason
              <textarea className="min-h-24 rounded-md border border-slate-300 px-3 py-2 text-sm" value={cancelReason} onChange={(event) => setCancelReason(event.target.value)} />
            </label>
            <label className="grid gap-1 text-sm font-semibold text-slate-700">
              Recorded cash amount
              <input className="h-10 rounded-md border border-slate-300 px-3 text-sm" type="number" min="0" step="0.01" value={cancelCashAmount} onChange={(event) => setCancelCashAmount(event.target.value)} />
            </label>
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => setCancelTarget(null)}>
                Close
              </Button>
              <Button variant="danger" onClick={() => void handleCancel(cancelTarget)} disabled={actionLoading[cancelTarget.id]}>
                {actionLoading[cancelTarget.id] ? "Cancelling..." : "Confirm cancellation"}
              </Button>
            </div>
          </div>
        ) : null}
      </Dialog>
    </main>
  );
}

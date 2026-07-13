import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { UtensilsCrossed } from "lucide-react";
import { api } from "../../../lib/api";
import { formatManilaDate, formatTime12, manilaDateKey, todayManilaDateKey } from "../../../lib/dateTime";
import { MiniCalendar } from "../../../components/ui/MiniCalendar";
import { ReservationDetailsModal } from "../../../components/ui/ReservationDetailsModal";
import { QuickStatsWidget } from "../../../components/dinein/QuickStatsWidget";
import { Button } from "../../../components/ui/button";
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

function isOpen(status: string) {
  return status !== "cancelled" && status !== "rejected";
}

export default function DineInReservations() {
  const [selectedDate, setSelectedDate] = useState(today());
  const [cursor, setCursor] = useState(() => new Date(`${today()}T00:00:00+08:00`));
  const [activeReservation, setActiveReservation] = useState<StaffReservation | null>(null);
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

  const pendingCount = dineInReservations.filter((reservation) => isPending(reservation.status)).length;
  const upcomingCount = dineInReservations.filter((reservation) => isOpen(reservation.status)).length;

  function shiftMonth(delta: number) {
    setCursor((current) => new Date(current.getFullYear(), current.getMonth() + delta, 1));
  }

  function openFirstPending() {
    const pendingReservation = dineInReservations.find((reservation) => isPending(reservation.status));
    if (!pendingReservation) {
      return;
    }

    setSelectedDate(manilaDateKey(pendingReservation.date));
    setActiveReservation(pendingReservation);
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

  return (
    <main
      className="min-h-screen bg-slate-100 p-6 lg:p-8"
      style={{
        backgroundImage:
          "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100' opacity='0.035'%3E%3Cpath d='M30,10 L30,90 M35,10 L35,90 M32,10 L33,90' stroke='%23000' stroke-width='1'/%3E%3C/svg%3E\")",
        backgroundRepeat: "repeat",
        backgroundColor: "#f8fafc"
      }}
    >
      <section className="mx-auto max-w-6xl rounded-3xl border border-slate-200 bg-white/95 shadow-sm">
        <div className="flex flex-col gap-4 border-b border-slate-200 px-6 py-6 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <div className="flex flex-wrap items-center gap-3 text-sm font-semibold uppercase tracking-wide text-red-700">
              <UtensilsCrossed className="h-6 w-6" aria-hidden="true" />
              <span>Dine-in Reservations</span>
            </div>
            <h1 className="mt-2 text-3xl font-black uppercase tracking-tight text-slate-950">Table bookings for restaurant guests</h1>
            <p className="mt-2 max-w-2xl text-sm text-slate-600">Compact table bookings with date-by-date guest counts and pending approvals.</p>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="rounded-3xl border border-red-100 bg-red-50 p-4">
              <p className="text-xs uppercase tracking-wide text-red-700">Upcoming</p>
              <p className="mt-2 text-3xl font-black text-slate-950">{upcomingCount}</p>
            </div>
            <div className="rounded-3xl border border-amber-100 bg-amber-50 p-4">
              <p className="text-xs uppercase tracking-wide text-amber-700">Pending</p>
              <p className="mt-2 text-3xl font-black text-slate-950">{pendingCount}</p>
            </div>
          </div>
        </div>

        <div className="grid gap-6 p-6 lg:grid-cols-[1.45fr_1fr]">
          <div className="space-y-6">
            <MiniCalendar
              month={cursor}
              selectedDate={selectedDate}
              eventsByDate={eventsByDate}
              onPreviousMonth={() => shiftMonth(-1)}
              onNextMonth={() => shiftMonth(1)}
              onSelectDate={setSelectedDate}
            />

            <QuickStatsWidget
              selectedDate={selectedDate}
              reservations={dineInReservations}
              isLoading={query.isLoading}
              onViewPending={pendingCount > 0 ? openFirstPending : undefined}
            />
          </div>

          <div className="rounded-3xl border border-slate-200 bg-slate-50 p-5">
            <div>
              <p className="text-xs uppercase tracking-wide text-slate-500">Timeline</p>
              <p className="mt-2 text-lg font-black text-slate-950">
                {selectedReservations.length} reservation{selectedReservations.length === 1 ? "" : "s"} on {formatManilaDate(selectedDate)}
              </p>
            </div>

            <div className="mt-5 space-y-3">
              {selectedReservations.length === 0 ? (
                <div className="rounded-3xl border border-dashed border-slate-200 bg-white p-6 text-sm text-slate-600">No dine-in reservations scheduled for this date.</div>
              ) : (
                selectedReservations.map((reservation) => (
                  <div key={reservation.id} className="flex flex-col gap-3 rounded-3xl border border-slate-200 bg-white p-4 shadow-sm sm:flex-row sm:items-center sm:justify-between">
                    <div className="flex items-center gap-3">
                      <span className={`inline-flex h-3.5 w-3.5 shrink-0 rounded-full ${statusDotClass(reservation.status)}`} />
                      <span className="font-bold text-slate-950">{formatTime12(reservation.time)}</span>
                    </div>
                    <div className="min-w-[160px] text-sm font-semibold text-slate-900">{reservation.customer_name}</div>
                    <div className="text-sm text-slate-600">{reservation.guests} guests</div>
                    <Button size="sm" variant="outline" onClick={() => setActiveReservation(reservation)}>
                      View
                    </Button>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      </section>

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
    </main>
  );
}

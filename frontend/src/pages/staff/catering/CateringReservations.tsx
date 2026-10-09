import { useMemo, useState } from "react";
import { Sparkles } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { api } from "../../../lib/api";
import { formatManilaDate, manilaDateKey, todayManilaDateKey } from "../../../lib/dateTime";
import { MiniCalendar } from "../../../components/ui/MiniCalendar";
import { ReservationDetailsModal } from "../../../components/ui/ReservationDetailsModal";
import { Button } from "../../../components/ui/button";
import { Dialog } from "../../../components/ui/dialog";
import { useToast } from "../../../hooks/useToast";
import { getApiErrorMessage } from "../../../lib/errors";

type PaymentHistoryItem = {
  id: string;
  payment_stage: string;
  method: string;
  amount: number;
  reference_number?: string | null;
  cash_received?: number | null;
  change_due?: number | null;
  received_at?: string | null;
};

type RawCateringReservation = {
  id: string;
  reservation_id: string;
  customer_name: string;
  customer_phone?: string;
  customer_email?: string;
  confirmed_date: string;
  total_price: number;
  payment_plan?: string;
  downpayment_amount?: number;
  remaining_balance?: number;
  final_payment_status?: string;
  payment_history?: PaymentHistoryItem[];
  status: string;
  headcount: number;
  inquiry?: {
    venue_type?: string | null;
    event_type?: string | null;
    message?: string | null;
  } | null;
  package?: {
    name?: string | null;
  } | null;
  ingredient_locks?: Array<{
    id: string;
    reserved_quantity: number;
    unit: string;
    is_released: boolean;
    raw_material: {
      id: string;
      name: string;
    };
  }>;
};

type CateringReservation = {
  id: string;
  type: "catering";
  reference: string;
  customer_name: string;
  phone?: string;
  email?: string;
  date: string;
  time?: string;
  guests: number;
  total_price: number;
  status: string;
  payment_plan?: string;
  downpayment_amount?: number;
  remaining_balance?: number;
  payment_status?: string;
  payment_history?: PaymentHistoryItem[];
  special_requests?: string | null;
  event_type?: string | null;
  package_name?: string | null;
  venue_type?: string | null;
  ingredient_locks: Array<{
    id: string;
    reserved_quantity: number;
    unit: string;
    is_released: boolean;
    raw_material: {
      id: string;
      name: string;
    };
  }>;
};

function badgeClass(status: string) {
  switch (status) {
    case "confirmed":
    case "in_progress":
      return "bg-emerald-50 text-emerald-700";
    case "pending_approval":
      return "bg-amber-50 text-amber-700";
    case "pending_final_payment":
      return "bg-amber-100 text-amber-800";
    case "completed":
      return "bg-slate-100 text-slate-700";
    case "rejected":
    case "cancelled":
      return "bg-red-50 text-red-700";
    default:
      return "bg-slate-100 text-slate-700";
  }
}

function statusLabel(status: string) {
  return status.replace(/_/g, " ");
}

function today() {
  return todayManilaDateKey();
}

export default function CateringReservations() {
  const [selectedDate, setSelectedDate] = useState(today());
  const [cursor, setCursor] = useState(() => new Date(`${today()}T00:00:00+08:00`));
  const [activeReservation, setActiveReservation] = useState<CateringReservation | null>(null);
  const [cancelTarget, setCancelTarget] = useState<CateringReservation | null>(null);
  const [cancelReason, setCancelReason] = useState("");
  const [cancelCashAmount, setCancelCashAmount] = useState("0");
  const [completionTarget, setCompletionTarget] = useState<CateringReservation | null>(null);
  const [actionLoading, setActionLoading] = useState<Record<string, boolean>>({});
  const { toast } = useToast();

  const query = useQuery<RawCateringReservation[]>({
    queryKey: ["staff-catering-reservations"],
    queryFn: async () => {
      const response = await api.get<{ reservations: RawCateringReservation[] }>("/api/staff/catering/reservations");
      return response.data.reservations;
    }
  });

  const reservations = useMemo(() => {
    return (query.data ?? []).map((reservation) => ({
      id: reservation.id,
      type: "catering" as const,
      reference: reservation.reservation_id,
      customer_name: reservation.customer_name,
      phone: reservation.customer_phone,
      email: reservation.customer_email,
      date: reservation.confirmed_date,
      time: undefined,
      guests: reservation.headcount,
      total_price: reservation.total_price,
      status: reservation.status,
      payment_plan: reservation.payment_plan,
      downpayment_amount: reservation.downpayment_amount,
      remaining_balance: reservation.remaining_balance,
      payment_status: reservation.final_payment_status,
      payment_history: reservation.payment_history ?? [],
      special_requests: reservation.inquiry?.message ?? null,
      event_type: reservation.inquiry?.event_type ?? null,
      package_name: reservation.package?.name ?? null,
      venue_type: reservation.inquiry?.venue_type ?? null,
      ingredient_locks: reservation.ingredient_locks ?? []
    }));
  }, [query.data]);


  const eventsByDate = useMemo(() => {
    const map = new Map<string, number>();
    reservations.forEach((reservation) => {
      const key = manilaDateKey(reservation.date);
      map.set(key, (map.get(key) ?? 0) + 1);
    });
    return map;
  }, [reservations]);

  const selectedReservations = useMemo(
    () => (eventsByDate.get(selectedDate) ? reservations.filter((reservation) => manilaDateKey(reservation.date) === selectedDate) : []).sort((a, b) => a.reference.localeCompare(b.reference)),
    [eventsByDate, reservations, selectedDate]
  );

  const pendingCount = reservations.filter((reservation) => reservation.status === "pending_approval").length;
  const activeCount = reservations.filter((reservation) => reservation.status !== "cancelled" && reservation.status !== "rejected").length;

  function hasOpenPayment(reservation: CateringReservation) {
    return (reservation.remaining_balance ?? 0) > 0 || reservation.payment_status !== "paid";
  }

  function hasPayableBalance(reservation: CateringReservation) {
    return (reservation.remaining_balance ?? 0) > 0;
  }

  function shiftMonth(delta: number) {
    setCursor((current) => new Date(current.getFullYear(), current.getMonth() + delta, 1));
  }

  async function handleApprove(reservation: CateringReservation) {
    setActionLoading((current) => ({ ...current, [reservation.id]: true }));
    try {
      await api.put(`/api/staff/catering/reservations/${reservation.id}/approve`);
      await query.refetch();
    } finally {
      setActionLoading((current) => ({ ...current, [reservation.id]: false }));
    }
  }

  async function handleStart(reservation: CateringReservation) {
    setActionLoading((current) => ({ ...current, [reservation.id]: true }));
    try {
      await api.put(`/api/staff/catering/reservations/${reservation.id}/start-event`);
      await query.refetch();
    } finally {
      setActionLoading((current) => ({ ...current, [reservation.id]: false }));
    }
  }

  async function handleRecordCash(reservation: CateringReservation) {
    setActionLoading((current) => ({ ...current, [reservation.id]: true }));
    try {
      await api.post(`/api/staff/catering/reservations/${reservation.id}/record-cash-payment`, {
        amount: reservation.remaining_balance ?? 0,
        received_by: "Staff"
      });
      await query.refetch();
    } finally {
      setActionLoading((current) => ({ ...current, [reservation.id]: false }));
    }
  }

  async function handleCancel(reservation: CateringReservation) {
    setActionLoading((current) => ({ ...current, [reservation.id]: true }));
    try {
      await api.put(`/api/staff/catering/reservations/${reservation.id}/cancel`, {
        reason: cancelReason || "Customer cancelled the catering reservation.",
        amount: Number(cancelCashAmount || 0),
        payment_method: "cash",
        cash_received: Number(cancelCashAmount || 0)
      });
      setCancelTarget(null);
      setCancelReason("");
      setCancelCashAmount("0");
      await query.refetch();
      toast("Catering reservation cancelled and inventory locks released.");
    } finally {
      setActionLoading((current) => ({ ...current, [reservation.id]: false }));
    }
  }

  function handleComplete(reservation: CateringReservation) {
    setCompletionTarget(reservation);
  }

  async function confirmComplete() {
    if (!completionTarget) {
      return;
    }

    const reservation = completionTarget;
    setActionLoading((current) => ({ ...current, [reservation.id]: true }));
    try {
      const response = await api.put<{ reservation?: { status?: string } }>(
        `/api/staff/catering/reservations/${reservation.id}/complete`,
        undefined,
        { timeout: 30_000 }
      );
      if (response.data.reservation?.status !== "completed") {
        throw new Error("The server did not mark this event as completed.");
      }
      await query.refetch();
      toast("Catering event marked as completed.");
    } catch (error) {
      toast(getApiErrorMessage(error, "Unable to complete the catering event."));
    } finally {
      setActionLoading((current) => ({ ...current, [reservation.id]: false }));
      setCompletionTarget(null);
    }
  }

  const modalActions: Array<{
    label: string;
    onClick: () => void;
    variant?: "default" | "outline" | "ghost" | "danger";
    disabled?: boolean;
  }> = activeReservation
    ? [
        ...(activeReservation.status === "pending_approval"
          ? [
              {
                label: "Approve event",
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
                label: "Start event",
                onClick: () => {
                  void handleStart(activeReservation);
                  setActiveReservation(null);
                },
                variant: "outline" as const,
                disabled: actionLoading[activeReservation.id]
              }
            ]
          : []),
        ...(activeReservation.status === "in_progress" || activeReservation.status === "pending_final_payment"
          ? [
              {
                label: "Complete event",
                onClick: () => {
                  void handleComplete(activeReservation);
                  setActiveReservation(null);
                },
                variant: "danger" as const,
                disabled: actionLoading[activeReservation.id] || hasOpenPayment(activeReservation)
              }
            ]
          : []),
        ...((activeReservation.status === "pending_approval" || activeReservation.status === "confirmed" || activeReservation.status === "in_progress" || activeReservation.status === "pending_final_payment")
          ? [
              {
                label: "Cancel event",
                onClick: () => {
                  setCancelTarget(activeReservation);
                  setCancelReason("Customer cancelled the catering reservation.");
                  setCancelCashAmount(String(Number(activeReservation.remaining_balance ?? activeReservation.total_price ?? 0).toFixed(2)));
                },
                variant: "danger" as const,
                disabled: actionLoading[activeReservation.id]
              }
            ]
          : [])
      ]
    : [];

  return (
    <main className="min-h-screen bg-slate-100 p-4 lg:p-6">
      <section className="w-full overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
        <div className="flex flex-col gap-4 border-b border-slate-200 px-6 py-6 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-red-700">Catering management</p>
            <h1 className="mt-2 text-3xl font-black uppercase tracking-tight text-slate-950">Calendar first event control</h1>
          </div>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            <div className="rounded-3xl border border-slate-200 bg-slate-50 p-4">
              <p className="text-xs uppercase tracking-wide text-slate-500">Open events</p>
              <p className="mt-2 text-3xl font-black text-slate-950">{activeCount}</p>
            </div>
            <div className="rounded-3xl border border-slate-200 bg-slate-50 p-4">
              <p className="text-xs uppercase tracking-wide text-slate-500">Pending approvals</p>
              <p className="mt-2 text-3xl font-black text-amber-700">{pendingCount}</p>
            </div>
            <div className="rounded-3xl border border-slate-200 bg-slate-50 p-4">
              <p className="text-xs uppercase tracking-wide text-slate-500">Selected date</p>
              <p className="mt-2 text-3xl font-black text-slate-950">{formatManilaDate(selectedDate)}</p>
            </div>
          </div>
        </div>

        <div className="grid gap-5 p-4 sm:p-5 xl:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)]">
          <div className="space-y-6 xl:h-[calc(100vh-15rem)] xl:overflow-y-auto xl:overscroll-contain">
            <MiniCalendar
              month={cursor}
              selectedDate={selectedDate}
              eventsByDate={eventsByDate}
              onPreviousMonth={() => shiftMonth(-1)}
              onNextMonth={() => shiftMonth(1)}
              onSelectDate={setSelectedDate}
            />
          </div>

          <div className="space-y-6 xl:h-[calc(100vh-15rem)] xl:overflow-y-auto xl:overscroll-contain">
            <div className="rounded-3xl border border-slate-200 bg-slate-50 p-5">
              <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <p className="text-xs uppercase tracking-wide text-slate-500">Event stream</p>
                  <p className="mt-2 text-lg font-black text-slate-950">{selectedReservations.length} event{selectedReservations.length === 1 ? "" : "s"}</p>
                </div>
                <div className="inline-flex items-center gap-2 rounded-full bg-white px-3 py-2 text-xs font-semibold uppercase text-slate-600 shadow-sm">
                  <Sparkles className="h-4 w-4 text-red-700" /> Live status
                </div>
              </div>

              <div className="mt-5 grid gap-4">
                {selectedReservations.length === 0 ? (
                  <div className="rounded-3xl border border-dashed border-slate-200 bg-white p-6 text-sm text-slate-600">No catering events booked for this date.</div>
                ) : (
                  selectedReservations.map((reservation) => (
                    <article key={reservation.id} className="relative overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-sm">
                      <div className="absolute inset-y-0 left-0 w-2 bg-red-600" />
                      <div className="grid gap-4 p-5 sm:grid-cols-[minmax(0,1fr)_auto]">
                        <div className="space-y-2 pl-3">
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="text-sm font-semibold uppercase tracking-wide text-slate-500">{reservation.reference}</span>
                            <span className={`rounded-full px-2 py-1 text-xs font-black uppercase ${badgeClass(reservation.status)}`}>
                              {statusLabel(reservation.status)}
                            </span>
                          </div>
                          <p className="text-base font-black text-slate-950">{reservation.customer_name}</p>
                          <p className="text-sm text-slate-600">{reservation.package_name ?? "Catering"} · {reservation.venue_type ?? "Venue address TBD"}</p>
                          <p className="text-sm text-slate-600">Remaining: ₱{reservation.remaining_balance?.toFixed(2) ?? "0.00"}</p>
                        </div>

                        <div className="flex flex-col gap-2 text-right sm:text-left">
                          <Button variant="outline" size="sm" onClick={() => setActiveReservation(reservation)}>
                            View details
                          </Button>
                          {reservation.status === "pending_approval" ? (
                            <Button size="sm" onClick={() => void handleApprove(reservation)} disabled={actionLoading[reservation.id]}>
                              {actionLoading[reservation.id] ? "Processing..." : "Approve"}
                            </Button>
                          ) : null}
                          {reservation.status === "confirmed" ? (
                            <Button variant="outline" size="sm" onClick={() => void handleStart(reservation)} disabled={actionLoading[reservation.id]}>
                              {actionLoading[reservation.id] ? "Processing..." : "Start"}
                            </Button>
                          ) : null}
                          {(["confirmed", "in_progress", "pending_final_payment"].includes(reservation.status) && hasPayableBalance(reservation)) ? (
                            <Button variant="danger" size="sm" onClick={() => void handleRecordCash(reservation)} disabled={actionLoading[reservation.id]}>
                              {actionLoading[reservation.id] ? "Processing..." : reservation.status === "pending_final_payment" ? "Settle balance" : "Record cash"}
                            </Button>
                          ) : null}
                          {(reservation.status === "in_progress" || reservation.status === "pending_final_payment") ? (
                            <Button variant={hasOpenPayment(reservation) ? "outline" : "danger"} size="sm" onClick={() => void handleComplete(reservation)} disabled={actionLoading[reservation.id] || hasOpenPayment(reservation)}>
                              {actionLoading[reservation.id] ? "Processing..." : hasOpenPayment(reservation) ? "Pending payment" : "Complete"}
                            </Button>
                          ) : null}
                        </div>
                      </div>
                    </article>
                  ))
                )}
              </div>
            </div>

            <div className="grid gap-4">
              <div className="rounded-3xl border border-slate-200 bg-white p-5">
                <p className="text-xs uppercase tracking-wide text-slate-500">Balance watch</p>
                <p className="mt-2 text-sm text-slate-700">{reservations.filter((reservation) => reservation.remaining_balance && reservation.remaining_balance > 0).length} events still have unpaid balance.</p>
              </div>
              <div className="rounded-3xl border border-slate-200 bg-white p-5">
                <p className="text-xs uppercase tracking-wide text-slate-500">Workflow tip</p>
                <p className="mt-2 text-sm text-slate-700">Approve pending events from the date panel and manage active bookings from one calendar-first screen.</p>
              </div>
            </div>
          </div>
        </div>
      </section>

      <ReservationDetailsModal
        open={Boolean(activeReservation)}
        title={activeReservation ? `${activeReservation.reference} details` : "Event details"}
        reservation={activeReservation}
        onClose={() => setActiveReservation(null)}
        actions={modalActions}
        onPaymentRecorded={async () => {
          const result = await query.refetch();
          const updatedRaw = result.data?.find((reservation) => reservation.id === activeReservation?.id);
          if (!updatedRaw) {
            setActiveReservation(null);
            return;
          }
          setActiveReservation({
            id: updatedRaw.id,
            type: "catering",
            reference: updatedRaw.reservation_id,
            customer_name: updatedRaw.customer_name,
            phone: updatedRaw.customer_phone,
            email: updatedRaw.customer_email,
            date: updatedRaw.confirmed_date,
            time: undefined,
            guests: updatedRaw.headcount,
            total_price: updatedRaw.total_price,
            status: updatedRaw.status,
            payment_plan: updatedRaw.payment_plan,
            downpayment_amount: updatedRaw.downpayment_amount,
            remaining_balance: updatedRaw.remaining_balance,
            payment_status: updatedRaw.final_payment_status,
            payment_history: updatedRaw.payment_history ?? [],
            special_requests: updatedRaw.inquiry?.message ?? null,
            event_type: updatedRaw.inquiry?.event_type ?? null,
            package_name: updatedRaw.package?.name ?? null,
            venue_type: updatedRaw.inquiry?.venue_type ?? null,
            ingredient_locks: updatedRaw.ingredient_locks ?? []
          });
        }}
      />

      <Dialog open={Boolean(cancelTarget)} title="Cancel catering reservation" onClose={() => setCancelTarget(null)} panelClassName="max-w-xl">
        {cancelTarget ? (
          <div className="grid gap-4">
            <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-800">
              <p className="font-semibold">This will cancel the event, release reserved ingredient locks, and record the cancellation cash amount.</p>
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

      <Dialog open={Boolean(completionTarget)} title="Confirm complete event" onClose={() => setCompletionTarget(null)} panelClassName="max-w-xl">
        {completionTarget && (
          <div className="grid gap-4 text-sm text-slate-700">
            <div className="rounded-md bg-slate-50 p-4">
              <p className="font-semibold text-slate-950">This event will be marked complete and release reserved ingredients from inventory.</p>
              <p className="mt-2">Only events with 100% payment settled can be completed. Ingredient locks are released only when the event is complete, and the reserved stock is permanently deducted.</p>
            </div>
            <div className="rounded-md border border-slate-200 bg-white p-4">
              <p className="text-sm font-semibold uppercase tracking-wide text-slate-500">Event summary</p>
              <p className="mt-3 text-sm text-slate-800">Reference: {completionTarget.reference}</p>
              <p className="text-sm text-slate-800">Customer: {completionTarget.customer_name}</p>
              <p className="text-sm text-slate-800">Date: {formatManilaDate(completionTarget.date)}</p>
              <p className="text-sm text-slate-800">Remaining balance: ₱{completionTarget.remaining_balance?.toFixed(2) ?? "0.00"}</p>
              <p className="text-sm text-slate-800">Payment status: {completionTarget.payment_status ?? "pending"}</p>
              <p className="text-sm text-slate-800">Active ingredient locks: {completionTarget.ingredient_locks.filter((lock) => !lock.is_released).length}</p>
            </div>
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => setCompletionTarget(null)}>
                Cancel
              </Button>
              <Button variant="danger" onClick={() => void confirmComplete()} disabled={actionLoading[completionTarget.id] || hasOpenPayment(completionTarget)}>
                {actionLoading[completionTarget.id] ? "Processing..." : "Confirm & Release"}
              </Button>
            </div>
          </div>
        )}
      </Dialog>

    </main>
  );
}

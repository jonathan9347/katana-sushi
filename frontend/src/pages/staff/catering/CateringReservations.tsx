import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { Sparkles } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { api } from "../../../lib/api";
import { formatManilaDate, formatTime12, manilaDateKey, todayManilaDateKey } from "../../../lib/dateTime";
import { MiniCalendar } from "../../../components/ui/MiniCalendar";
import { ReservationDetailsModal } from "../../../components/ui/ReservationDetailsModal";
import { Button } from "../../../components/ui/button";
import { Dialog } from "../../../components/ui/dialog";
import { useToast } from "../../../hooks/useToast";
import { getApiErrorMessage } from "../../../lib/errors";
import { formatCateringEventType } from "../../../lib/reservationDetails";
import { formatCateringPackageSnapshots } from "../../../lib/cateringPackageSnapshot";

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
  event_time?: string | null;
  package_total?: number;
  mobilization_fee?: number;
  total_price: number;
  payment_plan?: string;
  downpayment_amount?: number;
  remaining_balance?: number;
  final_payment_status?: string;
  payment_status?: string;
  payment_history?: PaymentHistoryItem[];
  status: string;
  headcount: number;
  inquiry?: {
    venue_type?: string | null;
    event_type?: string | null;
    event_type_other?: string | null;
    message?: string | null;
  } | null;
  package?: {
    name?: string | null;
  } | null;
  package_snapshot?: unknown;
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
  event_time?: string | null;
  guests: number;
  package_total?: number;
  mobilization_fee?: number;
  total_price: number;
  status: string;
  payment_plan?: string;
  downpayment_amount?: number;
  remaining_balance?: number;
  payment_status?: string;
  payment_history?: PaymentHistoryItem[];
  special_requests?: string | null;
  event_type?: string | null;
  event_type_other?: string | null;
  package_name?: string | null;
  package_snapshot?: unknown;
  venue_type?: string | null;
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

function isActive(status: string) {
  return ["pending", "pending_approval", "confirmed", "approved", "in_progress", "preparing", "pending_final_payment"].includes(status);
}

export default function CateringReservations() {
  const [selectedDate, setSelectedDate] = useState(today());
  const [cursor, setCursor] = useState(() => new Date(`${today()}T00:00:00+08:00`));
  const [activeReservation, setActiveReservation] = useState<CateringReservation | null>(null);
  const [approvalTarget, setApprovalTarget] = useState<CateringReservation | null>(null);
  const [mobilizationFeeInput, setMobilizationFeeInput] = useState("0");
  const [cancelTarget, setCancelTarget] = useState<CateringReservation | null>(null);
  const [cancelReason, setCancelReason] = useState("");
  const [completionTarget, setCompletionTarget] = useState<CateringReservation | null>(null);
  const [actionLoading, setActionLoading] = useState<Record<string, boolean>>({});
  const { toast } = useToast();
  const canEditPhotos = localStorage.getItem("katana_role")?.toLowerCase() === "admin";

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
      time: reservation.event_time ?? undefined,
      event_time: reservation.event_time,
      guests: reservation.headcount,
      package_total: reservation.package_total,
      mobilization_fee: reservation.mobilization_fee,
      total_price: reservation.total_price,
      status: reservation.status,
      payment_plan: reservation.payment_plan,
      downpayment_amount: reservation.downpayment_amount,
      remaining_balance: reservation.remaining_balance,
      payment_status: reservation.payment_status ?? reservation.final_payment_status,
      payment_history: reservation.payment_history ?? [],
      special_requests: reservation.inquiry?.message ?? null,
      event_type: reservation.inquiry?.event_type ?? null,
      event_type_other: reservation.inquiry?.event_type_other ?? null,
      package_name: reservation.package?.name ?? null,
      package_snapshot: reservation.package_snapshot,
      venue_type: reservation.inquiry?.venue_type ?? null
    }));
  }, [query.data]);

  const activeReservations = useMemo(
    () => reservations.filter((reservation) => isActive(reservation.status)),
    [reservations]
  );

  const eventsByDate = useMemo(() => {
    const map = new Map<string, number>();
    activeReservations.forEach((reservation) => {
      const key = manilaDateKey(reservation.date);
      map.set(key, (map.get(key) ?? 0) + 1);
    });
    return map;
  }, [activeReservations]);

  const selectedReservations = useMemo(
    () => (eventsByDate.get(selectedDate) ? activeReservations.filter((reservation) => manilaDateKey(reservation.date) === selectedDate) : []).sort((a, b) => a.reference.localeCompare(b.reference)),
    [activeReservations, eventsByDate, selectedDate]
  );

  const pendingCount = reservations.filter((reservation) => reservation.status === "pending_approval").length;
  const activeCount = activeReservations.length;
  const balanceWatch = activeReservations.filter((reservation) =>
    ["Balance due", "Balance overdue", "Partial"].includes(reservation.payment_status ?? "") &&
    Number(reservation.remaining_balance ?? 0) > 0
  );
  function hasOpenPayment(reservation: CateringReservation) {
    return (reservation.remaining_balance ?? 0) > 0;
  }

  function shiftMonth(delta: number) {
    setCursor((current) => new Date(current.getFullYear(), current.getMonth() + delta, 1));
  }

  async function handleApprove() {
    if (!approvalTarget) return;
    const mobilizationFee = Number(mobilizationFeeInput.trim());
    if (!mobilizationFeeInput.trim() || !Number.isFinite(mobilizationFee) || mobilizationFee < 0 || mobilizationFee > 1_000_000) {
      toast("Enter a fee between ₱0 and ₱1,000,000.");
      return;
    }
    setActionLoading((current) => ({ ...current, [approvalTarget.id]: true }));
    try {
      await api.put(`/api/staff/catering/reservations/${approvalTarget.id}/approve`, {
        mobilization_fee: mobilizationFee
      });
      await query.refetch();
      setApprovalTarget(null);
    } catch (error) {
      toast(getApiErrorMessage(error, "Unable to approve the catering reservation."));
    } finally {
      setActionLoading((current) => ({ ...current, [approvalTarget.id]: false }));
    }
  }

  async function handleDecline(reservation: CateringReservation) {
    const reason = window.prompt("Why is this catering request being declined?");
    if (!reason?.trim()) return;
    setActionLoading((current) => ({ ...current, [reservation.id]: true }));
    try {
      await api.put(`/api/staff/catering/reservations/${reservation.id}/decline`, { reason: reason.trim() });
      await query.refetch();
    } finally {
      setActionLoading((current) => ({ ...current, [reservation.id]: false }));
    }
  }

  async function handleNoShow(reservation: CateringReservation) {
    const reason = window.prompt("Enter the reason for marking this catering booking as a no-show.");
    if (!reason?.trim()) return;
    setActionLoading((current) => ({ ...current, [reservation.id]: true }));
    try {
      await api.put(`/api/staff/catering/reservations/${reservation.id}/no-show`, { reason: reason.trim() });
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

  async function handleCancel(reservation: CateringReservation) {
    setActionLoading((current) => ({ ...current, [reservation.id]: true }));
    try {
      await api.put(`/api/staff/catering/reservations/${reservation.id}/cancel`, {
        reason: cancelReason || "Staff cancelled the catering reservation."
      });
      setCancelTarget(null);
      setCancelReason("");
      await query.refetch();
      toast("Catering reservation cancelled.");
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
                  setMobilizationFeeInput("0");
                  setApprovalTarget(activeReservation);
                  setActiveReservation(null);
                },
                variant: "default" as const,
                disabled: actionLoading[activeReservation.id]
              },
              {
                label: "Decline request",
                onClick: () => void handleDecline(activeReservation),
                variant: "outline" as const,
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
              },
              {
                label: "Mark no-show",
                onClick: () => void handleNoShow(activeReservation),
                variant: "danger" as const,
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
                  setCancelReason("Staff cancelled the catering reservation.");
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
          {canEditPhotos && (
            <Link
              className="inline-flex min-h-10 items-center justify-center rounded-md border border-slate-300 bg-white px-4 text-sm font-semibold text-slate-800 hover:bg-slate-50"
              to="/staff/catering/photos"
            >
              Catering menu photos
            </Link>
          )}
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
                          {formatCateringPackageSnapshots(reservation.package_snapshot).map((line) => (
                            <p key={line} className="text-sm font-semibold text-slate-700">{line}</p>
                          ))}
                          <p className="text-sm text-slate-600">
                            {reservation.event_time ? `Event time: ${formatTime12(reservation.event_time)}` : "Event time: N/A"}
                            {reservation.event_type
                              ? ` · ${formatCateringEventType(reservation.event_type, reservation.event_type_other)}`
                              : ""}
                          </p>
                          <p className="text-sm text-slate-600">Package total: ₱{reservation.package_total?.toFixed(2) ?? reservation.total_price.toFixed(2)}</p>
                          {Number(reservation.mobilization_fee ?? 0) > 0 && (
                            <p className="text-sm text-slate-600">Mobilization fee: ₱{reservation.mobilization_fee?.toFixed(2)}</p>
                          )}
                          <p className="text-sm text-slate-600">Approved total: ₱{reservation.total_price.toFixed(2)}</p>
                          <p className="text-sm text-slate-600">Amount due: ₱{reservation.remaining_balance?.toFixed(2) ?? "0.00"}</p>
                        </div>

                        <div className="flex flex-col gap-2 text-right sm:text-left">
                          <Button variant="outline" size="sm" onClick={() => setActiveReservation(reservation)}>
                            View details
                          </Button>
                          {reservation.status === "pending_approval" ? (
                            <Button
                              size="sm"
                              onClick={() => {
                                setMobilizationFeeInput("0");
                                setApprovalTarget(reservation);
                              }}
                              disabled={actionLoading[reservation.id]}
                            >
                              {actionLoading[reservation.id] ? "Processing..." : "Approve"}
                            </Button>
                          ) : null}
                          {reservation.status === "confirmed" ? (
                            <Button variant="outline" size="sm" onClick={() => void handleStart(reservation)} disabled={actionLoading[reservation.id]}>
                              {actionLoading[reservation.id] ? "Processing..." : "Start"}
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
                <p className="mt-2 text-sm text-slate-700">{balanceWatch.filter((reservation) => reservation.payment_status === "Balance overdue").length} overdue · {balanceWatch.filter((reservation) => reservation.payment_status !== "Balance overdue").length} due.</p>
                {balanceWatch.length > 0 ? (
                  <ul className="mt-3 grid gap-2">
                    {balanceWatch.slice(0, 5).map((reservation) => (
                      <li key={reservation.id}>
                        <button
                          type="button"
                          className="flex w-full items-center justify-between gap-3 rounded-lg border border-slate-200 px-3 py-2 text-left text-sm hover:bg-slate-50"
                          onClick={() => setActiveReservation(reservation)}
                        >
                          <span className="min-w-0 truncate font-semibold text-slate-800">{reservation.reference} · {reservation.customer_name}</span>
                          <span className={`shrink-0 font-bold ${reservation.payment_status === "Balance overdue" ? "text-red-700" : "text-amber-700"}`}>
                            {reservation.payment_status}
                          </span>
                        </button>
                      </li>
                    ))}
                  </ul>
                ) : null}
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
            time: updatedRaw.event_time ?? undefined,
            event_time: updatedRaw.event_time,
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
            event_type_other: updatedRaw.inquiry?.event_type_other ?? null,
            package_name: updatedRaw.package?.name ?? null,
            package_snapshot: updatedRaw.package_snapshot,
            venue_type: updatedRaw.inquiry?.venue_type ?? null
          });
        }}
      />

      <Dialog open={Boolean(cancelTarget)} title="Cancel catering reservation" onClose={() => setCancelTarget(null)} panelClassName="max-w-xl">
        {cancelTarget ? (
          <div className="grid gap-4">
            <label className="grid gap-1 text-sm font-semibold text-slate-700">
              Cancellation reason
              <textarea required className="min-h-24 rounded-md border border-slate-300 px-3 py-2 text-sm" value={cancelReason} onChange={(event) => setCancelReason(event.target.value)} />
            </label>
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => setCancelTarget(null)}>
                Close
              </Button>
              <Button variant="danger" onClick={() => void handleCancel(cancelTarget)} disabled={actionLoading[cancelTarget.id] || !cancelReason.trim()}>
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
              <p className="font-semibold text-slate-950">This event will be marked complete after payment is fully settled.</p>
            </div>
            <div className="rounded-md border border-slate-200 bg-white p-4">
              <p className="text-sm font-semibold uppercase tracking-wide text-slate-500">Event summary</p>
              <p className="mt-3 text-sm text-slate-800">Reference: {completionTarget.reference}</p>
              <p className="text-sm text-slate-800">Customer: {completionTarget.customer_name}</p>
              <p className="text-sm text-slate-800">Date: {formatManilaDate(completionTarget.date)}</p>
              <p className="text-sm text-slate-800">Amount due: ₱{completionTarget.remaining_balance?.toFixed(2) ?? "0.00"}</p>
              <p className="text-sm text-slate-800">Payment status: {completionTarget.payment_status ?? "pending"}</p>
            </div>
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => setCompletionTarget(null)}>
                Cancel
              </Button>
              <Button variant="danger" onClick={() => void confirmComplete()} disabled={actionLoading[completionTarget.id] || hasOpenPayment(completionTarget)}>
                {actionLoading[completionTarget.id] ? "Processing..." : "Confirm completion"}
              </Button>
            </div>
          </div>
        )}
      </Dialog>

      <Dialog
        open={Boolean(approvalTarget)}
        title={`Approve catering request${approvalTarget ? `: ${approvalTarget.reference}` : ""}`}
        onClose={() => {
          if (!approvalTarget || !actionLoading[approvalTarget.id]) setApprovalTarget(null);
        }}
      >
        {approvalTarget && (
          <div className="grid gap-4 text-sm text-slate-700">
            <div className="rounded-md bg-slate-50 p-4">
              <p className="font-semibold text-slate-950">{approvalTarget.customer_name}</p>
              <p>Package total: ₱{(approvalTarget.package_total ?? approvalTarget.total_price).toFixed(2)}</p>
              <p>Initial payment received: ₱{(approvalTarget.downpayment_amount ?? 0).toFixed(2)}</p>
            </div>
            <label className="grid gap-2 font-medium text-slate-800">
              Mobilization fee (PHP)
              <input
                type="number"
                min="0"
                max="1000000"
                step="0.01"
                value={mobilizationFeeInput}
                onChange={(event) => setMobilizationFeeInput(event.target.value)}
                className="h-10 rounded-md border border-slate-300 px-3"
                aria-label="Mobilization fee in PHP"
              />
            </label>
            <p className="text-xs text-slate-500">
              The fee will be added to the remaining balance. Enter 0 if no fee applies.
            </p>
            <div className="flex justify-end gap-2">
              <Button
                variant="outline"
                onClick={() => setApprovalTarget(null)}
                disabled={actionLoading[approvalTarget.id]}
              >
                Cancel
              </Button>
              <Button onClick={() => void handleApprove()} disabled={actionLoading[approvalTarget.id]}>
                {actionLoading[approvalTarget.id] ? "Approving..." : "Confirm approval"}
              </Button>
            </div>
          </div>
        )}
      </Dialog>

    </main>
  );
}

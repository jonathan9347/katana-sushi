
import { useMemo, useState } from "react";
import { CalendarDays, Sparkles } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { api } from "../../../lib/api";
import { formatManilaDate, formatTime12, manilaDateKey, todayManilaDateKey } from "../../../lib/dateTime";
import { MiniCalendar } from "../../../components/ui/MiniCalendar";
import { ReservationDetailsModal } from "../../../components/ui/ReservationDetailsModal";
import { ReservationReceipt } from "../../../components/ui/ReservationReceipt";
import { BookingDetailsDrawer } from "../../../components/ui/BookingDetailsDrawer";
import { Button } from "../../../components/ui/button";
import { Dialog } from "../../../components/ui/dialog";
import { useToast } from "../../../hooks/useToast";
import { getApiErrorMessage } from "../../../lib/errors";
import { formatCateringEventType } from "../../../lib/reservationDetails";
import { formatCateringPackageSnapshots } from "../../../lib/cateringPackageSnapshot";
import { humanizeEnum, shortRef } from "../../../lib/display";

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
  downpayment_status?: string;
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
  downpayment_status?: string;
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
  return humanizeEnum(status);
}

function today() {
  return todayManilaDateKey();
}

function isActive(status: string) {
  return ["pending", "pending_approval", "confirmed", "approved", "in_progress", "preparing", "pending_final_payment"].includes(status);
}

export default function CateringReservations() {
  const [selectedDate, setSelectedDate] = useState("");
  const [cursor, setCursor] = useState(() => new Date(`${today()}T00:00:00+08:00`));
  const [calendarOpen, setCalendarOpen] = useState(false);
  const [statusFilter, setStatusFilter] = useState("open");
  const [activeReservation, setActiveReservation] = useState<CateringReservation | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [paymentModalOpen, setPaymentModalOpen] = useState(false);
  const [approvalTarget, setApprovalTarget] = useState<CateringReservation | null>(null);
  const [mobilizationFeeInput, setMobilizationFeeInput] = useState("0");
  const [cancelTarget, setCancelTarget] = useState<CateringReservation | null>(null);
  const [cancelReason, setCancelReason] = useState("");
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
      time: reservation.event_time ?? undefined,
      event_time: reservation.event_time,
      guests: reservation.headcount,
      package_total: reservation.package_total,
      mobilization_fee: reservation.mobilization_fee,
      total_price: reservation.total_price,
      status: reservation.status,
      payment_plan: reservation.payment_plan,
      downpayment_amount: reservation.downpayment_amount,
      downpayment_status: reservation.downpayment_status,
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

  const selectedReservations = useMemo(() => {
    return reservations
      .filter((reservation) => !selectedDate || manilaDateKey(reservation.date) === selectedDate)
      .filter((reservation) => {
        if (statusFilter === "open") return isActive(reservation.status);
        if (statusFilter === "needs_action") return reservation.status === "pending_approval";
        if (statusFilter === "active") return ["confirmed", "in_progress", "pending_final_payment", "preparing"].includes(reservation.status);
        if (statusFilter === "completed") return reservation.status === "completed";
        return true;
      })
      .sort((a, b) =>
        manilaDateKey(a.date).localeCompare(manilaDateKey(b.date)) ||
        (a.time ?? "").localeCompare(b.time ?? "") ||
        a.reference.localeCompare(b.reference)
      );
  }, [reservations, selectedDate, statusFilter]);

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

  function closeReservationPanels() {
    setDrawerOpen(false);
    setPaymentModalOpen(false);
    setApprovalTarget(null);
    setCancelTarget(null);
    setCompletionTarget(null);
    setActiveReservation(null);
  }

  const handleDrawerClose = () => {
    closeReservationPanels();
  };

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
        mobilization_fee: mobilizationFee,
        mobilizationFee: mobilizationFee,
        amount: mobilizationFee
      });
      console.log("SUCCESS TRIGGERED", { action: "approve", reservationId: approvalTarget.id });
      await query.refetch();
      console.log("CLOSING DRAWER", { action: "approve", reservationId: approvalTarget.id });
      closeReservationPanels();
      toast("Event approved successfully.");
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
      console.log("SUCCESS TRIGGERED", { action: "decline", reservationId: reservation.id });
      await query.refetch();
      console.log("CLOSING DRAWER", { action: "decline", reservationId: reservation.id });
      closeReservationPanels();
      if (Number(reservation.downpayment_amount ?? 0) > 0) {
        toast("Request declined. Any refund must be handled manually.");
      } else {
        toast("Catering request declined successfully.");
      }
    } catch (error) {
      toast(getApiErrorMessage(error, "Unable to decline the catering request."));
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
      console.log("SUCCESS TRIGGERED", { action: "no-show", reservationId: reservation.id });
      await query.refetch();
      console.log("CLOSING DRAWER", { action: "no-show", reservationId: reservation.id });
      closeReservationPanels();
      toast("Catering booking marked as no-show.");
    } catch (error) {
      toast(getApiErrorMessage(error, "Unable to mark the catering reservation as a no-show."));
    } finally {
      setActionLoading((current) => ({ ...current, [reservation.id]: false }));
    }
  }

  async function handleStart(reservation: CateringReservation) {
    setActionLoading((current) => ({ ...current, [reservation.id]: true }));
    try {
      await api.put(`/api/staff/catering/reservations/${reservation.id}/start-event`);
      console.log("SUCCESS TRIGGERED", { action: "start-event", reservationId: reservation.id });
      await query.refetch();
      console.log("CLOSING DRAWER", { action: "start-event", reservationId: reservation.id });
      closeReservationPanels();
      toast("Catering event started successfully.");
    } catch (error) {
      toast(getApiErrorMessage(error, "Unable to start catering preparation."));
    } finally {
      setActionLoading((current) => ({ ...current, [reservation.id]: false }));
    }
  }

  async function handleCancel(reservation: CateringReservation) {
    setActionLoading((current) => ({ ...current, [reservation.id]: true }));
    try {
      await api.put(`/api/staff/catering/reservations/${reservation.id}/cancel`, {
        reason: cancelReason || "Cancelled from the dashboard."
      });
      console.log("SUCCESS TRIGGERED", { action: "cancel", reservationId: reservation.id });
      setCancelReason("");
      await query.refetch();
      console.log("CLOSING DRAWER", { action: "cancel", reservationId: reservation.id });
      closeReservationPanels();
      toast("Catering reservation cancelled.");
    } catch (error) {
      toast(getApiErrorMessage(error, "Unable to cancel the catering reservation."));
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
      console.log("SUCCESS TRIGGERED", { action: "complete", reservationId: reservation.id });
      await query.refetch();
      console.log("CLOSING DRAWER", { action: "complete", reservationId: reservation.id });
      closeReservationPanels();
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
        ...(["pending", "pending_approval"].includes(activeReservation.status)
          ? [
              {
                label: "Approve event",
                onClick: () => {
                  setMobilizationFeeInput("0");
                  setApprovalTarget(activeReservation);
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
        ...(["confirmed", "approved"].includes(activeReservation.status)
          ? [
              {
                label: "Start event",
                onClick: () => {
                  void handleStart(activeReservation);
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
        ...(["in_progress", "preparing", "pending_final_payment"].includes(activeReservation.status)
          ? [
              {
                label: "Complete event",
                onClick: () => {
                  void handleComplete(activeReservation);
                },
                variant: "danger" as const,
                disabled: actionLoading[activeReservation.id] || hasOpenPayment(activeReservation)
              }
            ]
          : []),
        ...(hasOpenPayment(activeReservation) && ["confirmed", "approved", "in_progress", "preparing", "pending_final_payment"].includes(activeReservation.status)
          ? [{
              label: "Record balance",
              onClick: () => {
                setDrawerOpen(false);
                setPaymentModalOpen(true);
              },
              variant: "outline" as const,
              disabled: actionLoading[activeReservation.id]
            }]
          : []),
        ...((["pending", "pending_approval", "confirmed", "approved", "in_progress", "preparing", "pending_final_payment"].includes(activeReservation.status))
          ? [
              {
                label: "Cancel event",
                onClick: () => {
                  setCancelTarget(activeReservation);
                  setCancelReason("Cancelled from the dashboard.");
                },
                variant: "danger" as const,
                disabled: actionLoading[activeReservation.id]
              }
            ]
          : [])
      ]
    : [];

  return (
    <main className="min-h-screen bg-[#f4f4f8] p-4 lg:p-6">
      <section className="w-full overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm">
        <div className="flex flex-col gap-4 border-b border-slate-200 px-6 py-6 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-red-700">Catering management</p>
            <h1 className="mt-2 text-3xl font-black tracking-tight text-slate-950">Catering operations</h1>
          </div>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            <div className="rounded-lg border border-slate-200 bg-slate-50 p-4">
              <p className="text-xs uppercase tracking-wide text-slate-500">Open events</p>
              <p className="mt-2 text-3xl font-black text-slate-950">{activeCount}</p>
            </div>
            <div className="rounded-lg border border-slate-200 bg-slate-50 p-4">
              <p className="text-xs uppercase tracking-wide text-slate-500">Pending approvals</p>
              <p className="mt-2 text-3xl font-black text-amber-700">{pendingCount}</p>
            </div>
            <div className="rounded-lg border border-slate-200 bg-slate-50 p-4">
              <p className="text-xs uppercase tracking-wide text-slate-500">Bookings shown</p>
              <p className="mt-2 text-3xl font-black text-slate-950">{reservations.length}</p>
            </div>
          </div>
        </div>

        <div className="grid gap-5 p-4 sm:p-5">
          <div className="space-y-6">
            <div className="rounded-lg border border-slate-200 bg-slate-50 p-5">
              <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <p className="text-xs uppercase tracking-wide text-slate-500">Bookings</p>
                  <p className="mt-2 text-lg font-black text-slate-950">{selectedReservations.length} event{selectedReservations.length === 1 ? "" : "s"}</p>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <span className="inline-flex items-center gap-2 rounded-full bg-white px-3 py-2 text-xs font-semibold uppercase text-slate-600 shadow-sm">
                    <span className="h-2 w-2 animate-pulse rounded-full bg-red-600" aria-hidden="true" />
                    <Sparkles className="h-4 w-4 text-red-700" /> Live status
                  </span>
                  <Button variant="outline" size="sm" onClick={() => setCalendarOpen(true)}>
                    <CalendarDays className="mr-2 h-4 w-4" /> Event calendar
                  </Button>
                  {selectedDate && (
                    <Button variant="ghost" size="sm" onClick={() => setSelectedDate("")}>
                      Clear date filter
                    </Button>
                  )}
                </div>
              </div>

              <div className="mt-4 flex flex-wrap gap-2" aria-label="Catering booking filters">
                {[
                  ["open", "Open"],
                  ["needs_action", "Needs approval"],
                  ["active", "Active"],
                  ["completed", "Completed"],
                  ["all", "All"]
                ].map(([value, label]) => (
                  <Button
                    key={value}
                    size="sm"
                    variant={statusFilter === value ? "default" : "outline"}
                    aria-pressed={statusFilter === value}
                    onClick={() => setStatusFilter(value)}
                  >
                    {label}
                  </Button>
                ))}
                <span className="self-center text-sm text-slate-600">
                  {selectedDate ? formatManilaDate(selectedDate) : "All event dates"}
                </span>
              </div>

              <div className="mt-5 grid gap-4">
                {query.isLoading ? (
                  <div className="grid gap-3" role="status">
                    {[1, 2, 3].map((item) => <div key={item} className="h-28 animate-pulse rounded-lg border border-slate-200 bg-white" />)}
                  </div>
                ) : query.isError ? (
                  <div className="rounded-lg border border-red-200 bg-red-50 p-6 text-sm text-red-800" role="alert">
                    <p>Unable to load catering bookings.</p>
                    <Button className="mt-3" size="sm" variant="outline" onClick={() => void query.refetch()}>Retry</Button>
                  </div>
                ) : selectedReservations.length === 0 ? (
                  <div className="rounded-lg border border-dashed border-slate-200 bg-white p-6 text-sm text-slate-600">No catering bookings match these filters.</div>
                ) : (
                  selectedReservations.map((reservation, index) => (
                    <div key={reservation.id} className="contents">
                    {(index === 0 || manilaDateKey(selectedReservations[index - 1].date) !== manilaDateKey(reservation.date)) && (
                      <div className="flex items-center gap-3 pt-2 text-sm font-black uppercase tracking-wide text-slate-600">
                        <span>{formatManilaDate(reservation.date, { weekday: "long", month: "short", day: "numeric" })}</span>
                        <span className="h-px flex-1 bg-slate-200" />
                      </div>
                    )}
                    <article key={reservation.id} role="button" aria-label={`${shortRef(reservation.reference)} ${reservation.customer_name}`} tabIndex={0} onClick={() => { setActiveReservation(reservation); setDrawerOpen(true); }} onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); setActiveReservation(reservation); setDrawerOpen(true); } }} className="relative overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm transition hover:-translate-y-0.5 hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-600">
                      <div className="absolute inset-y-0 left-0 w-2 bg-red-600" />
                      <div className="grid gap-4 p-5 sm:grid-cols-[minmax(0,1fr)_auto]">
                        <div className="space-y-2 pl-3">
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="text-sm font-semibold uppercase tracking-wide text-slate-500" title={reservation.reference}>{shortRef(reservation.reference)}</span>
                            <span className={`rounded-full px-2 py-1 text-xs font-black uppercase ${badgeClass(reservation.status)}`}>
                              {statusLabel(reservation.status)}
                            </span>
                          </div>
                          <p className="text-base font-black text-slate-950">{reservation.customer_name}</p>
                          <p className="text-sm text-slate-600">{reservation.package_name ?? "Catering"} · {reservation.venue_type ?? "Venue address TBD"}</p>
                          <div className="flex flex-wrap gap-2 text-xs font-semibold text-slate-600">
                            <span className="rounded-full bg-slate-100 px-2 py-1">{reservation.guests} guests</span>
                            <span className="rounded-full bg-slate-100 px-2 py-1">{reservation.package_name ?? "Catering package"}</span>
                            <span className="rounded-full bg-slate-100 px-2 py-1">{reservation.venue_type ?? "Venue TBD"}</span>
                            {reservation.event_type && <span className="rounded-full bg-slate-100 px-2 py-1">{formatCateringEventType(reservation.event_type, reservation.event_type_other)}</span>}
                          </div>
                          <div className="pt-1">
                            <div className="mb-1 flex justify-between text-[11px] font-bold uppercase tracking-wide text-slate-500">
                              <span>Initial payment received ₱{Number(reservation.downpayment_amount ?? 0).toFixed(2)}</span>
                              <span>Due ₱{Number(reservation.remaining_balance ?? 0).toFixed(2)}</span>
                            </div>
                            <div className="h-2 overflow-hidden rounded-full bg-slate-200">
                              <div className="h-full rounded-full bg-red-700 transition-all" style={{ width: `${Math.min(100, Math.max(0, ((reservation.total_price - Number(reservation.remaining_balance ?? reservation.total_price)) / Math.max(reservation.total_price, 1)) * 100))}%` }} />
                            </div>
                          </div>
                        </div>

                        <div className="flex flex-col gap-2 text-right sm:text-left">
                          <Button variant="outline" size="sm" onClick={(event) => { event.stopPropagation(); setActiveReservation(reservation); setDrawerOpen(true); }}>
                            View details
                          </Button>
                          {reservation.status === "pending_approval" ? (
                            <Button
                              size="sm"
                              onClick={(event) => {
                                event.stopPropagation();
                                setMobilizationFeeInput("0");
                                setApprovalTarget(reservation);
                              }}
                              disabled={actionLoading[reservation.id]}
                            >
                              {actionLoading[reservation.id] ? "Processing..." : "Approve request"}
                            </Button>
                          ) : null}
                          {reservation.status === "confirmed" ? (
                            <>
                              <Button size="sm" onClick={(event) => { event.stopPropagation(); void handleStart(reservation); }} disabled={actionLoading[reservation.id]}>
                                {actionLoading[reservation.id] ? "Processing..." : "Start preparation"}
                              </Button>
                              {hasOpenPayment(reservation) && (
                                <Button size="sm" variant="outline" onClick={(event) => { event.stopPropagation(); setActiveReservation(reservation); setDrawerOpen(true); }}>
                                  Record balance
                                </Button>
                              )}
                            </>
                          ) : null}
                          {reservation.status === "in_progress" ? (
                            hasOpenPayment(reservation) ? (
                              <Button size="sm" variant="outline" onClick={(event) => { event.stopPropagation(); setActiveReservation(reservation); setDrawerOpen(true); }}>
                                Record balance
                              </Button>
                            ) : (
                              <Button variant="danger" size="sm" onClick={(event) => { event.stopPropagation(); void handleComplete(reservation); }} disabled={actionLoading[reservation.id]}>
                                {actionLoading[reservation.id] ? "Processing..." : "Complete event"}
                              </Button>
                            )
                          ) : null}
                          {reservation.status === "pending_final_payment" ? (
                            <Button size="sm" variant="outline" onClick={(event) => { event.stopPropagation(); setActiveReservation(reservation); setDrawerOpen(true); }}>
                              Record balance
                            </Button>
                          ) : null}
                        </div>
                      </div>
                    </article>
                    </div>
                  ))
                )}
              </div>
            </div>

            <div className="grid gap-4">
              <div className={`rounded-lg border p-5 ${balanceWatch.some((reservation) => reservation.payment_status === "Balance overdue") ? "border-amber-300 bg-amber-50/60" : "border-slate-200 bg-white"}`}>
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
                          <span className="min-w-0 truncate font-semibold text-slate-800" title={reservation.reference}>{shortRef(reservation.reference)} · {reservation.customer_name}</span>
                          <span className={`shrink-0 font-bold ${reservation.payment_status === "Balance overdue" ? "text-red-700" : "text-amber-700"}`}>
                            {humanizeEnum(reservation.payment_status)}
                          </span>
                        </button>
                      </li>
                    ))}
                  </ul>
                ) : null}
              </div>
              <div className="rounded-lg border border-slate-200 bg-white p-5">
                <p className="text-xs uppercase tracking-wide text-slate-500">Workflow tip</p>
                <p className="mt-2 text-sm text-slate-700">Use the booking list for daily work. Each booking has one next-step action; the calendar is a read-only date filter.</p>
              </div>
            </div>
          </div>
        </div>
      </section>

      <Dialog open={calendarOpen} title="Catering event calendar" onClose={() => setCalendarOpen(false)} panelClassName="max-w-4xl">
        <p className="mb-3 text-sm text-slate-600">Calendar is view-only. Selecting a date filters the booking list.</p>
        <MiniCalendar
          month={cursor}
          selectedDate={selectedDate}
          eventsByDate={eventsByDate}
          onPreviousMonth={() => shiftMonth(-1)}
          onNextMonth={() => shiftMonth(1)}
          onSelectDate={(date) => {
            setSelectedDate(date);
            setCalendarOpen(false);
          }}
        />
      </Dialog>

      <ReservationDetailsModal
        open={paymentModalOpen && Boolean(activeReservation)}
        title={activeReservation ? `${shortRef(activeReservation.reference)} details` : "Event details"}
        reservation={activeReservation}
        onClose={() => {
          setPaymentModalOpen(false);
          setActiveReservation(null);
        }}
        actions={modalActions}
        onPaymentRecorded={async () => {
          const result = await query.refetch();
          const updatedRaw = result.data?.find((reservation) => reservation.id === activeReservation?.id);
          if (!updatedRaw) {
            setPaymentModalOpen(false);
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

          setPaymentModalOpen(false);
          setDrawerOpen(false);
          setActiveReservation(null);
          toast("Balance recorded successfully.");
        }}
      />
      <BookingDetailsDrawer
        open={drawerOpen && Boolean(activeReservation)}
        title={activeReservation ? shortRef(activeReservation.reference) : "Catering booking"}
        typeLabel="CATERING BOOKING"
        customerName={activeReservation?.customer_name ?? ""}
        status={activeReservation?.status ?? ""}
        onClose={handleDrawerClose}
        actions={modalActions.map((action) => (
          <Button key={action.label} type="button" variant={action.variant ?? "default"} disabled={action.disabled} onClick={() => {
            action.onClick();
          }}>
            {action.label}
          </Button>
        )).concat(
          <Button key="print-receipt" type="button" variant="outline" onClick={() => window.print()}>
            Print Receipt
          </Button>
        )}
        body={activeReservation ? (
          <ReservationReceipt
            reservation={activeReservation}
            showPrintButton={false}
          />
        ) : null}
      />

      <Dialog open={Boolean(cancelTarget)} title="Cancel catering reservation" onClose={() => setCancelTarget(null)} panelClassName="max-w-xl">
        {cancelTarget ? (
          <div className="grid gap-4">
            <p className="rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
              {["in_progress", "preparing"].includes(cancelTarget.status)
                ? "Preparation has started. All remaining locked ingredients will be recorded as Waste."
                : "Preparation has not started. Locked ingredients will be released back to available stock."}
            </p>
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
              <p className="mt-3 text-sm text-slate-800">Reference: {shortRef(completionTarget.reference)}</p>
              <p className="text-sm text-slate-800">Customer: {completionTarget.customer_name}</p>
              <p className="text-sm text-slate-800">Date: {formatManilaDate(completionTarget.date)}</p>
              <p className="text-sm text-slate-800">Amount due: ₱{completionTarget.remaining_balance?.toFixed(2) ?? "0.00"}</p>
              <p className="text-sm text-slate-800">Payment status: {humanizeEnum(completionTarget.payment_status ?? "pending")}</p>
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
        title={`Approve catering request${approvalTarget ? `: ${shortRef(approvalTarget.reference)}` : ""}`}
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

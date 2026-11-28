import { useEffect, useMemo, useRef, useState } from "react";
import type React from "react";
import { api } from "../../lib/api";
import { getApiErrorMessage } from "../../lib/errors";
import { ReservationReceipt, type ReservationReceiptData } from "./ReservationReceipt";
import { Button } from "./button";
import { Dialog } from "./dialog";
import { Select } from "./select";
import { formatManilaDate, manilaDateKey, todayManilaDateKey } from "../../lib/dateTime";
import { formatDateTime, humanizeEnum, shortRef } from "../../lib/display";
import "../../styles/staff-redesign.css";

type ModalAction = {
  label: string;
  onClick: () => void;
  variant?: "default" | "outline" | "ghost" | "danger";
  disabled?: boolean;
};

export type ReservationDetailsModalProps = {
  open: boolean;
  title: string;
  reservation: ReservationReceiptData | null;
  actions?: React.ReactNode | ModalAction[];
  onPaymentRecorded?: () => Promise<void> | void;
  readOnly?: boolean;

  onClose: () => void;
};

function renderActions(actions: ReservationDetailsModalProps["actions"]) {
  if (!Array.isArray(actions)) {
    return actions;
  }

  return actions.map((action) => (
    <Button key={action.label} type="button" variant={action.variant ?? "default"} onClick={action.onClick} disabled={action.disabled}>
      {action.label}
    </Button>
  ));
}

function methodLabel(method: string) {
  if (method === "bank_transfer") return "BPI";
  if (method === "gcash") return "GCash";
  if (method === "paymongo") return "PayMongo (online)";
  return humanizeEnum(method);
}

const detailTabs = [
  { id: "overview", label: "Overview" },
  { id: "event", label: "Event & package" },
  { id: "payment", label: "Payment" },
  { id: "timeline", label: "Timeline" }
] as const;
type DetailTab = typeof detailTabs[number]["id"];

export function ReservationDetailsModal({ open, title, reservation, actions, onPaymentRecorded, readOnly = false, onClose }: ReservationDetailsModalProps) {
  const [activeTab, setActiveTab] = useState<DetailTab>("overview");
  const bodyRef = useRef<HTMLDivElement>(null);
  const tabButtonRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const [activity, setActivity] = useState<NonNullable<ReservationReceiptData["activity"]>>([]);
  const [activityError, setActivityError] = useState<string | null>(null);
  const [paymentMethod, setPaymentMethod] = useState("cash");
  const [amount, setAmount] = useState("");
  const [referenceNumber, setReferenceNumber] = useState("");
  const [cashReceived, setCashReceived] = useState("");
  const [overrideReason, setOverrideReason] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const remainingBalance = Number(reservation?.remaining_balance ?? 0);
  const paymentStatus = reservation?.payment_status ?? reservation?.final_payment_status ?? "Payment status unavailable";
  const paymentStatusLabel = humanizeEnum(paymentStatus);
  const isFullyPaid = remainingBalance <= 0 || paymentStatus.toLowerCase() === "fully paid";
  const offBookingDate = Boolean(reservation?.date && manilaDateKey(reservation.date) !== todayManilaDateKey());
  const isAdmin = localStorage.getItem("katana_role")?.toLowerCase() === "admin";
  const canRecordPayment = Boolean(reservation?.id) && remainingBalance > 0 && (
    reservation?.type !== "catering" ||
    ["confirmed", "approved", "in_progress", "preparing", "pending_final_payment"].includes(reservation?.status?.toLowerCase() ?? "")
  ) && !["cancelled", "canceled", "declined", "rejected", "expired", "no-show", "no_show", "completed"].includes(reservation?.status?.toLowerCase() ?? "");
  const needsReference = paymentMethod !== "cash";
  const endpoint = useMemo(() => {
    if (!reservation?.id) return "";
    return reservation.type === "catering"
      ? `/api/staff/catering/reservations/${reservation.id}/record-payment`
      : `/api/staff/reservations/${reservation.id}/record-payment`;
  }, [reservation?.id, reservation?.type]);

  useEffect(() => {
    if (!open || !reservation) return;
    setActiveTab("overview");
    setPaymentMethod("cash");
    setAmount(String(Number(reservation.remaining_balance ?? 0).toFixed(2)));
    setReferenceNumber("");
    setCashReceived(String(Number(reservation.remaining_balance ?? 0).toFixed(2)));
    setOverrideReason("");
    setError(null);
  }, [open, reservation]);

  useEffect(() => {
    bodyRef.current?.scrollTo({ top: 0 });
  }, [activeTab]);

  useEffect(() => {
    if (!open || !reservation?.id) {
      setActivity([]);
      setActivityError(null);
      return;
    }
    let active = true;
    const endpoint = reservation.type === "catering"
      ? `/api/staff/catering/reservations/${reservation.id}/activity`
      : `/api/staff/reservations/${reservation.id}/activity`;
    api.get<{ activity: NonNullable<ReservationReceiptData["activity"]> }>(endpoint)
      .then((response) => {
        if (active) {
          setActivity(response.data.activity);
          setActivityError(null);
        }
      })
      .catch((error: unknown) => {
        if (active) {
          setActivityError(error instanceof Error ? error.message : "Unable to load booking activity.");
        }
      });
    return () => {
      active = false;
    };
  }, [open, reservation?.id, reservation?.type]);

  useEffect(() => {
    if (!open) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [open, onClose]);

  async function recordPayment(event: React.FormEvent) {
    event.preventDefault();

    if (!reservation || !endpoint) return;

    setIsSubmitting(true);
    setError(null);
    try {
      await api.post(endpoint, {
        amount: Number(amount),
        payment_method: paymentMethod,
        reference_number: needsReference ? referenceNumber : undefined,
        cash_received: paymentMethod === "cash" ? Number(cashReceived || amount) : undefined,
        override_reason: offBookingDate ? overrideReason.trim() : undefined,
        received_by: "Staff"
      });
      console.log("SUCCESS TRIGGERED", { action: "record-balance", reservationId: reservation?.id });
      await onPaymentRecorded?.();
      console.log("CLOSING DRAWER", { action: "record-balance", reservationId: reservation?.id });
      onClose();
    } catch (e: unknown) {
      setError(getApiErrorMessage(e, "Unable to record payment. Check payment history before retrying."));
    } finally {
      setIsSubmitting(false);
    }
  }

  const paymentControls = !readOnly && reservation ? (
    <div className="rounded-[10px] border border-[#f1dede] bg-[#fffafa] p-4">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p className="text-[11px] font-black uppercase tracking-[0.18em] text-[#7b6f72]">Payment status</p>
          <p className={`mt-1 text-sm font-black uppercase ${isFullyPaid ? "text-emerald-700" : "text-amber-700"}`}>
            {paymentStatusLabel}
          </p>
        </div>
        <div className="text-left sm:text-right">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-[#7b6f72]">Remaining balance</p>
          <p className="text-[22px] font-black text-[#1c1214]">
            {new Intl.NumberFormat("en-PH", { style: "currency", currency: "PHP" }).format(remainingBalance)}
          </p>
        </div>
      </div>

      {canRecordPayment ? (
        <form className="mt-4 grid gap-3 md:grid-cols-2" onSubmit={recordPayment}>
          <label className="grid min-w-0 gap-1 text-sm font-semibold text-slate-700">
            Method
            <Select className="w-full min-w-0" value={paymentMethod} onChange={(event) => setPaymentMethod(event.target.value)}>
              <option value="cash">{methodLabel("cash")}</option>
              <option value="gcash">{methodLabel("gcash")}</option>
              <option value="bank_transfer">{methodLabel("bank_transfer")}</option>
            </Select>
          </label>
          <label className="grid min-w-0 gap-1 text-sm font-semibold text-slate-700">
            Amount received
            <input className="h-10 w-full min-w-0 rounded-md border border-[#e6e4ea] px-3 text-sm transition focus:border-[#a82e27] focus:ring-4 focus:ring-[#a82e2720]" type="number" min="0.01" step="0.01" value={amount} onChange={(event) => setAmount(event.target.value)} />
          </label>
          {paymentMethod === "cash" ? (
            <label className="grid min-w-0 gap-1 text-sm font-semibold text-slate-700 md:col-span-2">
              Cash tendered
              <input className="h-10 w-full min-w-0 rounded-md border border-[#e6e4ea] px-3 text-sm transition focus:border-[#a82e27] focus:ring-4 focus:ring-[#a82e2720]" type="number" min="0.01" step="0.01" value={cashReceived} onChange={(event) => setCashReceived(event.target.value)} />
            </label>
          ) : (
            <label className="grid min-w-0 gap-1 text-sm font-semibold text-slate-700 md:col-span-2">
              Reference number
              <input className="h-10 w-full min-w-0 rounded-md border border-[#e6e4ea] px-3 text-sm transition focus:border-[#a82e27] focus:ring-4 focus:ring-[#a82e2720]" value={referenceNumber} onChange={(event) => setReferenceNumber(event.target.value)} />
            </label>
          )}
          {offBookingDate && isAdmin ? (
            <label className="grid min-w-0 gap-1 text-sm font-semibold text-slate-700 md:col-span-2">
              Admin override reason
              <textarea
                className="min-h-20 w-full min-w-0 rounded-md border border-[#e6e4ea] px-3 py-2 text-sm transition focus:border-[#a82e27] focus:ring-4 focus:ring-[#a82e2720]"
                value={overrideReason}
                onChange={(event) => setOverrideReason(event.target.value)}
                placeholder="Explain why this payment is outside the booking date"
              />
              <span className="text-xs font-normal text-slate-500">The override reason is saved in booking activity.</span>
            </label>
          ) : null}
          {offBookingDate && !isAdmin ? (
            <p className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900 md:col-span-2" role="alert">
              Balance payments are accepted on the booking date. Since that date has passed, an admin must record this payment with an override reason.
            </p>
          ) : null}
          <div className="flex items-end md:col-span-2">
            <Button className="w-full" type="submit" disabled={isSubmitting || !amount || (needsReference && !referenceNumber.trim()) || (offBookingDate && (!isAdmin || !overrideReason.trim()))}>
              {isSubmitting ? "Recording..." : "Record payment"}
            </Button>
          </div>
          {error ? <p className="text-sm font-semibold text-red-700 md:col-span-2">{error}</p> : null}
        </form>
      ) : null}
    </div>
  ) : null;

  if (!open) return null;

  const detailRows = reservation ? [
    { label: "Booking ID", value: shortRef(reservation.reference ?? reservation.booking_id ?? reservation.reservation_id) },
    { label: "Type", value: reservation.type === "catering" ? "Catering" : reservation.reservation_type === "unlimited" ? "Unlimited" : "Dine-in Ala Carte" },
    { label: "Status", value: humanizeEnum(reservation.status ?? reservation.reservation_status) },
    { label: "Created", value: reservation.created_at ? formatDateTime(reservation.created_at) : "N/A" }
  ] : [];

  const customerRows = reservation ? [
    { label: "Name", value: reservation.customer_name ?? "N/A" },
    { label: "Phone", value: reservation.phone ?? reservation.customer_phone ?? "N/A" },
    { label: "Email", value: reservation.email ?? reservation.customer_email ?? "N/A" }
  ] : [];

  const eventDate = reservation?.event_date || reservation?.date;
  const eventDateLabel = eventDate
    ? formatManilaDate(eventDate, { weekday: "short", month: "short", day: "numeric", year: "numeric" })
    : "N/A";
  const eventRows = reservation ? [
    { label: "Event date", value: eventDate ? formatManilaDate(eventDate, { weekday: "long", month: "long", day: "numeric", year: "numeric" }) : "N/A" },
    { label: "Headcount", value: reservation.guests ?? reservation.party_size ?? reservation.headcount ?? 0 },
    { label: "Package", value: reservation.package_name ?? "N/A" },
    { label: "Event type", value: reservation.event_type ? (reservation.event_type_other ? `${humanizeEnum(reservation.event_type)} · ${reservation.event_type_other}` : humanizeEnum(reservation.event_type)) : "N/A" },
    { label: "Venue", value: reservation.venue_address ?? (reservation.venue_type ? humanizeEnum(reservation.venue_type) : "N/A") },
    { label: "Payment plan", value: reservation.payment_plan ? humanizeEnum(reservation.payment_plan) : "N/A" }
  ] : [];

  const packageItems = (() => {
    if (!reservation?.package_items || typeof reservation.package_items !== "object") {
      return [] as string[];
    }
    const items = reservation.package_items as { inclusions?: Array<string | { name?: string }> };
    return (items.inclusions ?? []).map((item) => typeof item === "string" ? item : item.name ?? "").filter(Boolean);
  })();

  const paymentHistory = (reservation?.payment_history ?? []).filter((payment) => !["refund", "refund_downpayment", "cancellation"].includes(payment.payment_stage));
  const totalPaid = reservation?.net_paid !== undefined && reservation?.net_paid !== null
    ? Number(reservation.net_paid)
    : paymentHistory.length > 0
      ? Math.max(paymentHistory.reduce((sum, payment) => sum + Number(payment.amount ?? 0), 0), 0)
      : Number(reservation?.downpayment_amount ?? 0);
  const totalValue = Number(reservation?.total_price ?? reservation?.package_total ?? ((remainingBalance + totalPaid) || 0));
  const progressPercent = Math.min(100, Math.max(0, (totalPaid / Math.max(totalValue, 1)) * 100));

  function handleTabKeyDown(event: React.KeyboardEvent<HTMLButtonElement>, currentIndex: number) {
    let nextIndex: number;
    if (event.key === "ArrowRight") {
      nextIndex = (currentIndex + 1) % detailTabs.length;
    } else if (event.key === "ArrowLeft") {
      nextIndex = (currentIndex - 1 + detailTabs.length) % detailTabs.length;
    } else if (event.key === "Home") {
      nextIndex = 0;
    } else if (event.key === "End") {
      nextIndex = detailTabs.length - 1;
    } else {
      return;
    }

    event.preventDefault();
    setActiveTab(detailTabs[nextIndex].id);
    tabButtonRefs.current[nextIndex]?.focus();
  }

  return (
    <div className="staff-details-backdrop fixed inset-0 z-[60] flex items-center justify-center bg-[#1c203073] p-4 backdrop-blur-[3px]" onMouseDown={(event) => {
      if (event.target === event.currentTarget) onClose();
    }}>
      <div role="dialog" aria-modal="true" aria-labelledby="reservation-details-title" className="staff-details-dialog relative flex w-full flex-col overflow-hidden bg-white shadow-[0_30px_80px_rgba(0,0,0,0.6)] animate-[modal-pop_300ms_cubic-bezier(0.2,1,0.36,1)]">
        <header className="staff-details-header" style={{ backgroundColor: "#1C1416", color: "#FFFFFF" }}>
          <div className="staff-details-decoration" aria-hidden="true" />
          <button type="button" aria-label="Close reservation details" className="staff-details-close" onClick={onClose}>×</button>
          <div className="staff-details-heading">
            <div className="staff-details-title-block">
              <small>RESERVATION DETAILS</small>
              <h2 id="reservation-details-title">{title}</h2>
              <div className="staff-details-customer-line">
                <p>{reservation?.customer_name ?? "Customer"}</p>
                <span className={`staff-details-status ${reservation ? (reservation.status?.toLowerCase() === "pending" || reservation.status?.toLowerCase() === "pending_approval" ? "is-pending" : reservation.status?.toLowerCase() === "confirmed" || reservation.status?.toLowerCase() === "approved" || reservation.status?.toLowerCase() === "seated" ? "is-approved" : reservation.status?.toLowerCase() === "declined" || reservation.status?.toLowerCase() === "cancelled" || reservation.status?.toLowerCase() === "rejected" ? "is-declined" : "is-other") : "is-other"}`}>
                  {humanizeEnum(reservation?.status ?? reservation?.reservation_status)}
                </span>
              </div>
            </div>
            <div className="staff-balance-chip">
              <small>{isFullyPaid ? "PAID IN FULL" : "REMAINING BALANCE"}</small>
              <span>{isFullyPaid ? "PAID IN FULL" : new Intl.NumberFormat("en-PH", { style: "currency", currency: "PHP" }).format(remainingBalance)}</span>
            </div>
          </div>
        </header>

        <div role="tablist" aria-label="Reservation details" className="staff-details-tabs">
          {detailTabs.map((tab, index) => (
            <button
              key={tab.id}
              ref={(element) => { tabButtonRefs.current[index] = element; }}
              id={`reservation-tab-${tab.id}`}
              type="button"
              role="tab"
              aria-selected={activeTab === tab.id}
              aria-controls={`reservation-panel-${tab.id}`}
              tabIndex={activeTab === tab.id ? 0 : -1}
              onClick={() => setActiveTab(tab.id)}
              onKeyDown={(event) => handleTabKeyDown(event, index)}
            >
              {tab.label}
              {activeTab === tab.id && <span className="staff-details-tab-underline" />}
            </button>
          ))}
        </div>
        <div ref={bodyRef} className="staff-details-body">
          {activeTab === "overview" && (
            <div id="reservation-panel-overview" role="tabpanel" aria-labelledby="reservation-tab-overview" className="staff-details-tabpanel-grid staff-overview-grid">
              <div className="staff-details-kpis">
                <section className="staff-details-card">
                  <span>Event date</span><strong>{eventDateLabel}</strong>
                </section>
                <section className="staff-details-card">
                  <span>Guests</span><strong>{reservation?.guests ?? reservation?.party_size ?? reservation?.headcount ?? 0}</strong>
                </section>
                <section className="staff-details-card">
                  <span>Total</span><strong>{new Intl.NumberFormat("en-PH", { style: "currency", currency: "PHP" }).format(totalValue)}</strong>
                </section>
              </div>
              <section className="staff-details-card">
                <h3 className="mb-3 text-[11.5px] font-black uppercase tracking-[0.14em] text-[#a82e27]">Booking Information</h3>
                <dl className="space-y-2">
                  {detailRows.map((row) => (
                    <div key={row.label} className="grid grid-cols-[120px_minmax(0,1fr)] gap-3 border-b border-[#f0eef3] py-2 last:border-b-0">
                      <dt className="text-[11px] font-bold uppercase tracking-[0.08em] text-[#7b6f72]">{row.label}</dt>
                      <dd className="min-w-0 text-right text-sm font-bold text-[#1c1214]">{row.value ?? "N/A"}</dd>
                    </div>
                  ))}
                </dl>
              </section>
              <section className="staff-details-card">
                <h3 className="mb-3 text-[11.5px] font-black uppercase tracking-[0.14em] text-[#a82e27]">Customer Details</h3>
                <dl className="space-y-2">
                  {customerRows.map((row) => (
                    <div key={row.label} className="grid grid-cols-[120px_minmax(0,1fr)] gap-3 border-b border-[#f0eef3] py-2 last:border-b-0">
                      <dt className="text-[11px] font-bold uppercase tracking-[0.08em] text-[#7b6f72]">{row.label}</dt>
                      <dd className="min-w-0 break-words text-right text-sm font-bold text-[#1c1214]">{row.value ?? "N/A"}</dd>
                    </div>
                  ))}
                </dl>
              </section>
            </div>
          )}

          {activeTab === "event" && (
            <div id="reservation-panel-event" role="tabpanel" aria-labelledby="reservation-tab-event" className="staff-details-tabpanel-grid">
              <section className="staff-details-card">
                <h3 className="mb-3 text-[11.5px] font-black uppercase tracking-[0.14em] text-[#a82e27]">Event Details</h3>
                <dl className="space-y-2">
                  {eventRows.map((row) => (
                    <div key={row.label} className="grid grid-cols-[120px_minmax(0,1fr)] gap-3 border-b border-[#f0eef3] py-2 last:border-b-0">
                      <dt className="text-[11px] font-bold uppercase tracking-[0.08em] text-[#7b6f72]">{row.label}</dt>
                      <dd className="min-w-0 break-words text-right text-sm font-bold text-[#1c1214]">{row.value ?? "N/A"}</dd>
                    </div>
                  ))}
                </dl>
              </section>
              <section className="staff-details-card">
                <h3 className="mb-3 text-[11.5px] font-black uppercase tracking-[0.14em] text-[#a82e27]">Package Details</h3>
                <div className="space-y-3">
                  <div className="grid grid-cols-[120px_minmax(0,1fr)] gap-3 border-b border-[#f0eef3] py-1">
                    <span className="text-[11px] font-bold uppercase tracking-[0.08em] text-[#7b6f72]">Package</span>
                    <span className="text-right text-sm font-bold text-[#1c1214]">{reservation?.package_name ?? "N/A"}</span>
                  </div>
                  <div>
                    <p className="mb-2 text-[11px] font-bold uppercase tracking-[0.08em] text-[#7b6f72]">Included items</p>
                    {packageItems.length > 0 ? (
                      <div className="flex flex-wrap gap-2">
                        {packageItems.map((item) => <span key={item} className="rounded-[6px] bg-[#f4f4f8] px-[10px] py-[4px] text-[12.5px] font-semibold text-[#4a4350]">{item}</span>)}
                      </div>
                    ) : <p className="text-sm text-[#7b6f72]">No package inclusions recorded.</p>}
                  </div>
                  <div className="space-y-2 border-t border-dashed border-[#d8d3dc] pt-3">
                    <div className="flex items-center justify-between gap-3 text-sm text-[#7b6f72]"><span>Subtotal</span><strong className="text-[#1c1214]">{new Intl.NumberFormat("en-PH", { style: "currency", currency: "PHP" }).format(Number(reservation?.subtotal ?? reservation?.total_price ?? 0))}</strong></div>
                    <div className="flex items-center justify-between gap-3 text-sm text-[#7b6f72]"><span>Tax</span><strong className="text-[#1c1214]">{new Intl.NumberFormat("en-PH", { style: "currency", currency: "PHP" }).format(Number(reservation?.tax ?? 0))}</strong></div>
                    <div className="mt-3 flex items-center justify-between gap-3 border-t border-[#1c1214] pt-2 text-[18px] font-black text-[#1c1214]"><span>Total</span><span>{new Intl.NumberFormat("en-PH", { style: "currency", currency: "PHP" }).format(Number(reservation?.total_price ?? reservation?.subtotal ?? 0))}</span></div>
                  </div>
                </div>
              </section>
              <section className="staff-details-card staff-details-full-width">
                <h3 className="mb-3 text-[11.5px] font-black uppercase tracking-[0.14em] text-[#a82e27]">Ingredient locks</h3>
                {reservation?.ingredient_locks && reservation.ingredient_locks.length > 0 ? (
                  <div className="space-y-2">
                    <span className={`inline-flex rounded-full px-[10px] py-[5px] text-[11px] font-black uppercase tracking-[0.03em] ${reservation.ingredient_locks.some((lock) => !lock.is_released) ? "bg-[#fff0d9] text-[#8a5200]" : "bg-[#e3f1ea] text-[#1f6b49]"}`}>{reservation.ingredient_locks.some((lock) => !lock.is_released) ? "Locked" : "Released"}</span>
                    <ul className="grid gap-2 text-sm text-[#4a4350]">
                      {reservation.ingredient_locks.map((lock, index) => <li key={lock.id ?? `${lock.raw_material?.name ?? "ingredient"}-${index}`} className="rounded-[6px] bg-[#f4f4f8] px-2 py-1">{lock.raw_material?.name ?? "Ingredient"}: {lock.reserved_quantity} {lock.unit}{lock.is_released ? " (released)" : ""}</li>)}
                    </ul>
                  </div>
                ) : <p className="text-sm text-[#7b6f72]">No ingredient locks recorded.</p>}
              </section>
            </div>
          )}

          {activeTab === "payment" && (
            <div id="reservation-panel-payment" role="tabpanel" aria-labelledby="reservation-tab-payment" className="staff-details-tabpanel-grid">
              <section className="staff-details-card">
                <h3 className="mb-3 text-[11.5px] font-black uppercase tracking-[0.14em] text-[#a82e27]">Payment Summary</h3>
                <div className="flex items-center justify-between gap-2">
                  <span className={`inline-flex rounded-full px-[10px] py-[5px] text-[11px] font-black uppercase tracking-[0.03em] ${isFullyPaid ? "bg-[#e3f1ea] text-[#1f6b49]" : "bg-[#fff0d9] text-[#8a5200]"}`}>{paymentStatusLabel}</span>
                  <span className="text-[11px] font-bold uppercase tracking-[0.08em] text-[#7b6f72]">Paid {Math.round(progressPercent)}%</span>
                </div>
                <div className="mt-3 h-[8px] overflow-hidden rounded-full bg-[#eadfe1]"><div className="h-full rounded-full bg-[#2f8a62] transition-all" style={{ width: `${progressPercent}%` }} /></div>
                <div className="mt-4 space-y-2 text-sm text-[#7b6f72]">
                  <div className="flex items-center justify-between gap-2"><span>Plan</span><strong className="text-[#1c1214]">{reservation?.payment_plan ? humanizeEnum(reservation.payment_plan) : "N/A"}</strong></div>
                  <div className="flex items-center justify-between gap-2"><span>Amount paid</span><strong className="text-[#1c1214]">{new Intl.NumberFormat("en-PH", { style: "currency", currency: "PHP" }).format(totalPaid)}</strong></div>
                  <div className="flex items-center justify-between gap-2"><span>Remaining</span><strong className="text-[#1c1214]">{new Intl.NumberFormat("en-PH", { style: "currency", currency: "PHP" }).format(remainingBalance)}</strong></div>
                </div>
                {paymentControls}
              </section>
              <section className="staff-details-card">
                <h3 className="mb-3 text-[11.5px] font-black uppercase tracking-[0.14em] text-[#a82e27]">Payment History</h3>
                {paymentHistory.length > 0 ? (
                  <div className="overflow-x-auto">
                    <table className="staff-payment-table w-full min-w-[420px] border-collapse text-left text-sm">
                      <thead><tr className="border-b border-[#f0eef3] text-[11px] font-black uppercase tracking-[0.08em] text-[#7b6f72]"><th className="pb-2 pr-3">Stage</th><th className="pb-2 pr-3">Method</th><th className="pb-2 pr-3">Reference</th><th className="pb-2 text-right">Amount</th></tr></thead>
                      <tbody>
                        {paymentHistory.map((payment) => (
                          <tr key={payment.id} className="border-b border-[#f0eef3] last:border-b-0">
                            <td className="py-2 pr-3 font-semibold text-[#1c1214]">{humanizeEnum(payment.payment_stage)}</td>
                            <td className="py-2 pr-3 text-[#4a4350]">{methodLabel(payment.method)}</td>
                            <td className="py-2 pr-3 text-[#7b6f72]"><span className="staff-payment-reference" title={payment.reference_number ?? "-"}>{shortRef(payment.reference_number)}</span></td>
                            <td className="py-2 text-right font-extrabold text-[#1c1214]">{new Intl.NumberFormat("en-PH", { style: "currency", currency: "PHP" }).format(Number(payment.amount ?? 0))}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ) : <p className="text-sm text-[#7b6f72]">No payments recorded.</p>}
              </section>
            </div>
          )}

          {activeTab === "timeline" && (
            <div id="reservation-panel-timeline" role="tabpanel" aria-labelledby="reservation-tab-timeline" className="staff-details-tabpanel-grid">
              <section className="staff-details-card staff-details-full-width">
                <h3 className="mb-3 text-[11.5px] font-black uppercase tracking-[0.14em] text-[#a82e27]">Reservation Timeline</h3>
                {activityError ? <p className="mb-4 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700" role="alert">Booking details loaded, but activity history could not be loaded: {activityError}</p> : null}
                <ul className="staff-timeline-list">
                  {[
                    { label: "Created", time: reservation?.created_at },
                    { label: "Payment", time: reservation?.created_at },
                    { label: "Current status", time: reservation?.created_at },
                    { label: "Booking created", time: reservation?.created_at }
                  ].map((step, index) => (
                    <li key={step.label} className="staff-timeline-step">
                      <span className={`staff-timeline-marker ${index === 2 ? "is-current" : "is-complete"}`}>{index === 2 ? "•" : "✓"}</span>
                      <div className="min-w-0 flex-1">
                        <p className="font-bold text-[#1c1214]">{step.label}</p>
                        <p className="text-[#7b6f72]">{step.time ? formatDateTime(step.time) : "N/A"}</p>
                      </div>
                    </li>
                  ))}
                </ul>
                {activity && activity.length > 0 ? (
                  <div className="mt-3 space-y-2">
                    {activity.map((item) => {
                      const isPositive = !/status/i.test(item.event_type ?? "");
                      return <div key={item.id} className="flex items-start gap-3 text-sm text-[#4a4350]">
                        <span className={`mt-1 inline-flex h-5 w-5 items-center justify-center rounded-full border-2 ${isPositive ? "border-[#2f8a62] bg-[#2f8a62] text-white" : "border-[#a82e27] bg-white shadow-[0_0_0_4px_rgba(168,46,39,0.15)]"}`}>{isPositive ? "✓" : "•"}</span>
                        <div className="min-w-0 flex-1 border-b border-[#f0eef3] pb-2">
                          <p className="font-bold text-[#1c1214]">{humanizeEnum(item.event_type)}</p>
                          <p className="text-[#7b6f72]">{formatDateTime(item.created_at)}</p>
                          {item.reason ? <p className="mt-1 text-[#4a4350]">{item.reason}</p> : null}
                        </div>
                      </div>;
                    })}
                  </div>
                ) : <p className="mt-2 text-sm text-[#7b6f72]">No activity history recorded yet.</p>}
              </section>
            </div>
          )}
        </div>

        <div className="staff-details-footer">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <Button type="button" variant="outline" onClick={() => window.print()}>Print receipt</Button>
            <div className="flex flex-wrap justify-end gap-2">{renderActions(actions)}<Button type="button" variant="outline" onClick={onClose}>Close</Button></div>
          </div>
        </div>
      </div>
    </div>
  );
}

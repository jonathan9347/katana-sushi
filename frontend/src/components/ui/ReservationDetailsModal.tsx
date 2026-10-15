import { useEffect, useMemo, useState } from "react";
import type React from "react";
import { api } from "../../lib/api";
import { getApiErrorMessage } from "../../lib/errors";
import { ReservationReceipt, type ReservationReceiptData } from "./ReservationReceipt";
import { Button } from "./button";
import { Dialog } from "./dialog";
import { Select } from "./select";
import { manilaDateKey, todayManilaDateKey } from "../../lib/dateTime";

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
  return "Cash";
}

export function ReservationDetailsModal({ open, title, reservation, actions, onPaymentRecorded, readOnly = false, onClose }: ReservationDetailsModalProps) {
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
  const isFullyPaid = remainingBalance <= 0 || paymentStatus.toLowerCase() === "fully paid";
  const offBookingDate = Boolean(reservation?.date && manilaDateKey(reservation.date) !== todayManilaDateKey());
  const isAdmin = localStorage.getItem("katana_role")?.toLowerCase() === "admin";
  const canRecordPayment = Boolean(reservation?.id) && remainingBalance > 0 &&
    !["cancelled", "canceled", "declined", "rejected", "expired", "no-show", "no_show"].includes(reservation?.status?.toLowerCase() ?? "");
  const needsReference = paymentMethod !== "cash";
  const endpoint = useMemo(() => {
    if (!reservation?.id) return "";
    return reservation.type === "catering"
      ? `/api/staff/catering/reservations/${reservation.id}/record-payment`
      : `/api/staff/reservations/${reservation.id}/record-payment`;
  }, [reservation?.id, reservation?.type]);

  useEffect(() => {
    if (!open || !reservation) return;
    setPaymentMethod("cash");
    setAmount(String(Number(reservation.remaining_balance ?? 0).toFixed(2)));
    setReferenceNumber("");
    setCashReceived(String(Number(reservation.remaining_balance ?? 0).toFixed(2)));
    setOverrideReason("");
    setError(null);
  }, [open, reservation]);

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
      await onPaymentRecorded?.();
    } catch (e: unknown) {
      setError(getApiErrorMessage(e, "Unable to record payment. Check payment history before retrying."));
    } finally {
      setIsSubmitting(false);
    }
  }

  const paymentControls = !readOnly && reservation ? (
    <div className="rounded-md border border-slate-200 bg-slate-50 p-4">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p className="text-xs font-black uppercase tracking-[0.18em] text-slate-500">Payment Status</p>
          <p className={`mt-1 text-sm font-black uppercase ${isFullyPaid ? "text-emerald-700" : "text-amber-700"}`}>
            {paymentStatus}
          </p>
        </div>
        <div className="text-left sm:text-right">
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Amount due</p>
          <p className="text-xl font-black text-slate-950">
            {new Intl.NumberFormat("en-PH", { style: "currency", currency: "PHP" }).format(remainingBalance)}
          </p>
        </div>
      </div>

      {canRecordPayment ? (
        <form className="mt-4 grid gap-3 sm:grid-cols-[1fr_1fr]" onSubmit={recordPayment}>
          <label className="grid gap-1 text-sm font-semibold text-slate-700">
            Method
            <Select value={paymentMethod} onChange={(event) => setPaymentMethod(event.target.value)}>
              <option value="cash">{methodLabel("cash")}</option>
              <option value="gcash">{methodLabel("gcash")}</option>
              <option value="bank_transfer">{methodLabel("bank_transfer")}</option>
            </Select>
          </label>
          <label className="grid gap-1 text-sm font-semibold text-slate-700">
            Amount received
            <input className="h-10 rounded-md border border-slate-300 px-3 text-sm" type="number" min="0.01" step="0.01" value={amount} onChange={(event) => setAmount(event.target.value)} />
          </label>
          {paymentMethod === "cash" ? (
            <label className="grid gap-1 text-sm font-semibold text-slate-700">
              Cash tendered
              <input className="h-10 rounded-md border border-slate-300 px-3 text-sm" type="number" min="0.01" step="0.01" value={cashReceived} onChange={(event) => setCashReceived(event.target.value)} />
            </label>
          ) : (
            <label className="grid gap-1 text-sm font-semibold text-slate-700">
              Reference number
              <input className="h-10 rounded-md border border-slate-300 px-3 text-sm" value={referenceNumber} onChange={(event) => setReferenceNumber(event.target.value)} />
            </label>
          )}
          {offBookingDate && isAdmin ? (
            <label className="grid gap-1 text-sm font-semibold text-slate-700 sm:col-span-2">
              Admin override reason
              <textarea
                className="min-h-20 rounded-md border border-slate-300 px-3 py-2 text-sm"
                value={overrideReason}
                onChange={(event) => setOverrideReason(event.target.value)}
                placeholder="Explain why this payment is outside the booking date"
              />
              <span className="text-xs font-normal text-slate-500">The override reason is saved in booking activity.</span>
            </label>
          ) : null}
          {offBookingDate && !isAdmin ? (
            <p className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900 sm:col-span-2" role="alert">
              Balance payments are accepted on the booking date. Since that date has passed, an admin must record this payment with an override reason.
            </p>
          ) : null}
          <div className="flex items-end">
            <Button className="w-full" type="submit" disabled={isSubmitting || !amount || (needsReference && !referenceNumber.trim()) || (offBookingDate && (!isAdmin || !overrideReason.trim()))}>
              {isSubmitting ? "Recording..." : "Record Payment"}
            </Button>
          </div>
          {error ? <p className="sm:col-span-2 text-sm font-semibold text-red-700">{error}</p> : null}
        </form>
      ) : null}
    </div>
  ) : null;

  return (
    <Dialog open={open} title={title} onClose={onClose} panelClassName="max-w-4xl">
      {reservation ? (
        <>
          {activityError ? (
            <p className="mb-3 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700" role="alert">
              Booking details loaded, but activity history could not be loaded: {activityError}
            </p>
          ) : null}
          <ReservationReceipt
            reservation={{
              ...reservation,
              activity: activityError ? [] : activity
            }}
            actions={renderActions(actions)}
            paymentControls={paymentControls}
            showPrintButton
            onClose={onClose}
          />
        </>
      ) : (
        <div className="p-2 text-sm text-slate-600">No reservation selected.</div>
      )}
    </Dialog>
  );
}

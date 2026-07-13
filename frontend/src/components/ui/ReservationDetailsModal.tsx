import { useEffect, useMemo, useState } from "react";
import type React from "react";
import { api } from "../../lib/api";
import { ReservationReceipt, type ReservationReceiptData } from "./ReservationReceipt";
import { Button } from "./button";
import { Dialog } from "./dialog";
import { Select } from "./select";

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

export function ReservationDetailsModal({ open, title, reservation, actions, onPaymentRecorded, onClose }: ReservationDetailsModalProps) {
  const [paymentMethod, setPaymentMethod] = useState("cash");
  const [amount, setAmount] = useState("");
  const [referenceNumber, setReferenceNumber] = useState("");
  const [cashReceived, setCashReceived] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const remainingBalance = Number(reservation?.remaining_balance ?? 0);
  const isFullyPaid = remainingBalance <= 0 || reservation?.payment_status === "paid" || reservation?.final_payment_status === "paid";
  const canRecordPayment = Boolean(reservation?.id) && remainingBalance > 0;
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
    setError(null);
  }, [open, reservation]);

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
        received_by: "Staff"
      });
      await onPaymentRecorded?.();
    } catch (e: any) {
      setError(e?.response?.data?.message ?? "Unable to record payment.");
    } finally {
      setIsSubmitting(false);
    }
  }

  const paymentControls = reservation ? (
    <div className="rounded-md border border-slate-200 bg-slate-50 p-4">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p className="text-xs font-black uppercase tracking-[0.18em] text-slate-500">Payment Status</p>
          <p className={`mt-1 text-sm font-black uppercase ${isFullyPaid ? "text-emerald-700" : "text-amber-700"}`}>
            {isFullyPaid ? "Fully paid" : "Pending"}
          </p>
        </div>
        <div className="text-left sm:text-right">
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Remaining balance</p>
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
          <div className="flex items-end">
            <Button className="w-full" type="submit" disabled={isSubmitting || !amount || (needsReference && !referenceNumber.trim())}>
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
        <ReservationReceipt reservation={reservation} actions={renderActions(actions)} paymentControls={paymentControls} showPrintButton onClose={onClose} />
      ) : (
        <div className="p-2 text-sm text-slate-600">No reservation selected.</div>
      )}
    </Dialog>
  );
}


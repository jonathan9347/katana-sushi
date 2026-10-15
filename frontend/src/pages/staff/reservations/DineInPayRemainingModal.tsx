import { FormEvent, useEffect, useMemo, useState } from "react";
import { Banknote, CheckCircle2, Landmark, Smartphone } from "lucide-react";
import { Button } from "../../../components/ui/button";
import { Dialog } from "../../../components/ui/dialog";
import { api } from "../../../lib/api";
import { getApiErrorMessage } from "../../../lib/errors";
import { manilaDateKey, todayManilaDateKey } from "../../../lib/dateTime";

type PaymentMethod = "cash" | "gcash" | "bank_transfer";

type DineInPayRemainingModalProps = {
  open: boolean;
  reservationId: string;
  bookingDate: string;
  remainingBalance: number;
  onClose: () => void;
  onPaid: () => Promise<void> | void;
};

function formatMoneyPHP(value: number) {
  return `PHP ${value.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function methodIcon(method: PaymentMethod) {
  switch (method) {
    case "gcash":
      return <Smartphone className="h-5 w-5" />;
    case "cash":
      return <Banknote className="h-5 w-5" />;
    case "bank_transfer":
      return <Landmark className="h-5 w-5" />;
  }
}

function methodLabel(method: PaymentMethod) {
  if (method === "bank_transfer") {
    return "BPI (Bank Transfer)";
  }

  return method
    .split("_")
    .map((s) => (s ? s[0].toUpperCase() + s.slice(1) : s))
    .join(" ");
}

export default function DineInPayRemainingModal({ open, reservationId, bookingDate, remainingBalance, onClose, onPaid }: DineInPayRemainingModalProps) {
  const [method, setMethod] = useState<PaymentMethod>("cash");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string>("");
  const [overrideReason, setOverrideReason] = useState("");
  const offBookingDate = Boolean(bookingDate) && manilaDateKey(bookingDate) !== todayManilaDateKey();
  const isAdmin = localStorage.getItem("katana_role")?.toLowerCase() === "admin";

  const canSubmit = remainingBalance > 0 && reservationId.trim().length > 0 && !isSubmitting &&
    (!offBookingDate || (isAdmin && overrideReason.trim().length > 0));

  useEffect(() => {
    if (!open) return;
    setMethod("cash");
    setError("");
    setOverrideReason("");
    setIsSubmitting(false);
  }, [open, reservationId]);

  const formTitle = useMemo(() => {
    return `Collect payment • ${formatMoneyPHP(remainingBalance)}`;
  }, [remainingBalance]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!canSubmit) return;

    setError("");
    setIsSubmitting(true);

    try {
      await api.post(`/api/staff/reservations/${reservationId}/record-payment`, {
        amount: remainingBalance,
        payment_method: method,
        cash_received: remainingBalance,
        override_reason: offBookingDate ? overrideReason.trim() : undefined
      });
      await onPaid();
    } catch (e: unknown) {
      setError(getApiErrorMessage(e, "The payment result could not be confirmed. Check payment history before retrying."));
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <Dialog open={open} title={formTitle} onClose={isSubmitting ? () => undefined : onClose} panelClassName="max-w-2xl">
      <form className="grid gap-5" onSubmit={submit}>
        <div className="rounded-md border border-slate-200 bg-slate-50 p-4">
          <p className="text-sm font-medium uppercase text-slate-500">Amount due</p>
          <p className="mt-1 text-3xl font-semibold text-slate-950">{formatMoneyPHP(remainingBalance)}</p>
        </div>

        {offBookingDate ? (
          isAdmin ? (
            <label className="grid gap-1 text-sm font-semibold text-slate-700">
              Admin override reason
              <textarea
                className="min-h-20 rounded-md border border-slate-300 px-3 py-2"
                value={overrideReason}
                onChange={(event) => setOverrideReason(event.target.value)}
                placeholder="Explain why payment is being recorded outside the booking date"
              />
              <span className="text-xs font-normal text-slate-500">The override reason is saved in booking activity.</span>
            </label>
          ) : (
            <p className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900" role="alert">
              Payment is recorded on the booking date. Since that date has passed, an admin must record it with an override reason.
            </p>
          )
        ) : null}

        <section className="grid gap-3">
          <h3 className="text-sm font-semibold uppercase tracking-wide text-slate-500">Choose payment method</h3>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            {(["cash", "gcash", "bank_transfer"] as PaymentMethod[]).map((m) => {
              const comingSoon = m !== "cash";

              return (
              <button
                key={m}
                type="button"
                disabled={isSubmitting || comingSoon}
                onClick={() => setMethod(m)}
                className={`flex flex-col items-start gap-2 rounded-md border p-4 text-left transition ${
                  method === m ? "border-red-700 bg-red-50" : comingSoon ? "cursor-not-allowed border-slate-200 bg-slate-100 opacity-70" : "border-slate-300 bg-white"
                }`}
              >
                <div className={`text-slate-900 ${method === m ? "text-red-800" : "text-slate-900"}`}>{methodIcon(m)}</div>
                <div className="text-sm font-bold text-slate-900">{methodLabel(m)}</div>
                <div className={`text-xs font-semibold ${method === m ? "text-red-700" : "text-slate-500"}`}>{comingSoon ? "Coming soon" : `Pay via ${methodLabel(m)}`}</div>
              </button>
              );
            })}
          </div>
        </section>

        {error ? <p className="rounded-md bg-red-50 px-3 py-2 text-sm font-medium text-red-700">{error}</p> : null}

        <div className="flex flex-col-reverse justify-end gap-3 sm:flex-row">
          <Button type="button" variant="outline" onClick={onClose} disabled={isSubmitting}>
            Cancel
          </Button>
          <Button disabled={!canSubmit} type="submit">
            {isSubmitting ? "Processing..." : (
              <span className="inline-flex items-center gap-2">
                <CheckCircle2 className="h-4 w-4" /> Collect payment
              </span>
            )}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}

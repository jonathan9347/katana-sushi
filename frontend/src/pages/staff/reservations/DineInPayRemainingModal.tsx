import { FormEvent, useMemo, useState } from "react";
import { Banknote, CheckCircle2, Landmark, Smartphone } from "lucide-react";
import { Button } from "../../../components/ui/button";
import { Dialog } from "../../../components/ui/dialog";
import { api } from "../../../lib/api";

type PaymentMethod = "cash" | "gcash" | "bank_transfer";

type DineInPayRemainingModalProps = {
  open: boolean;
  bookingId: string;
  remainingBalance: number;
  onClose: () => void;
  onPaid: () => void;
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

export default function DineInPayRemainingModal({ open, bookingId, remainingBalance, onClose, onPaid }: DineInPayRemainingModalProps) {
  const [method, setMethod] = useState<PaymentMethod>("cash");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string>("");

  const canSubmit = remainingBalance > 0 && bookingId.trim().length > 0 && !isSubmitting;

  const formTitle = useMemo(() => {
    return `Pay remaining • ${formatMoneyPHP(remainingBalance)}`;
  }, [remainingBalance]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!canSubmit) return;

    setError("");
    setIsSubmitting(true);

    try {
      await api.post(`/api/reservations/${bookingId}/pay-remaining`, {
        payment_method: method
      });
      onPaid();
      onClose();
    } catch (e: any) {
      setError(e?.response?.data?.message ?? "Unable to process payment.");
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <Dialog open={open} title={formTitle} onClose={onClose} panelClassName="max-w-2xl">
      <form className="grid gap-5" onSubmit={submit}>
        <div className="rounded-md border border-slate-200 bg-slate-50 p-4">
          <p className="text-sm font-medium uppercase text-slate-500">Remaining balance</p>
          <p className="mt-1 text-3xl font-semibold text-slate-950">{formatMoneyPHP(remainingBalance)}</p>
        </div>

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
                <CheckCircle2 className="h-4 w-4" /> Pay & Complete
              </span>
            )}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}


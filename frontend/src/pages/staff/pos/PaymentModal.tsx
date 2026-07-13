import { FormEvent, useMemo, useState } from "react";
import { Banknote, Landmark, Smartphone } from "lucide-react";
import { Button } from "../../../components/ui/button";
import { Dialog } from "../../../components/ui/dialog";

type PaymentMethod = "cash" | "gcash" | "bank_transfer";

type PaymentModalProps = {
  open: boolean;
  total: number;
  pending: boolean;
  onClose: () => void;
  onConfirm: (payment: { paymentMethod: PaymentMethod; cashReceived?: number }) => void;
};

const comingSoonTitle = "Coming soon - Online payments will be available in future update";

export default function PaymentModal({ open, total, pending, onClose, onConfirm }: PaymentModalProps) {
  const [method, setMethod] = useState<PaymentMethod | null>(null);
  const [cashReceived, setCashReceived] = useState("");
  const cashValue = Number(cashReceived);
  const changeDue = useMemo(() => Math.max(cashValue - total, 0), [cashValue, total]);
  const canConfirm = method === "cash" && cashValue >= total;

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!method || !canConfirm) {
      return;
    }

    onConfirm({ paymentMethod: method, cashReceived: method === "cash" ? cashValue : undefined });
  }

  return (
    <Dialog open={open} title="Payment" panelClassName="max-w-4xl" onClose={onClose}>
      <form className="grid gap-5" onSubmit={submit}>
        <div className="rounded-md border border-slate-200 bg-slate-50 p-4">
          <p className="text-sm font-medium uppercase text-slate-500">Total</p>
          <p className="mt-1 text-3xl font-semibold text-slate-950">PHP {total.toLocaleString()}</p>
        </div>

        <section className="grid gap-3">
          <h3 className="text-sm font-semibold uppercase text-slate-500">Payment Method</h3>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <PaymentChoice active={method === "cash"} label="Cash" icon={<Banknote />} onClick={() => setMethod("cash")} />
            <DisabledChoice label="GCash" icon={<Smartphone />} />
            <DisabledChoice label="BPI (Bank Transfer)" icon={<Landmark />} />
          </div>
        </section>

        {method === "cash" && (
          <section className="grid gap-3 rounded-md border border-slate-200 p-4">
            <label className="grid gap-1 text-sm font-medium text-slate-700">
              <span>Enter Amount Received</span>
              <input
                className="h-12 rounded-md border border-slate-300 px-3 text-lg outline-none focus:border-red-700 focus:ring-2 focus:ring-red-100"
                min={total}
                step="0.01"
                type="number"
                value={cashReceived}
                onChange={(event) => setCashReceived(event.target.value)}
              />
            </label>
            <p className="text-lg font-semibold text-slate-950">Change: PHP {changeDue.toFixed(2)}</p>
          </section>
        )}

        <div className="flex justify-end gap-3">
          <Button className="min-h-11" type="button" variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button className="min-h-11" disabled={!canConfirm || pending}>
            {pending ? "Processing..." : "Confirm"}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}

function PaymentChoice({
  active,
  icon,
  label,
  onClick
}: {
  active: boolean;
  icon: JSX.Element;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      className={`flex min-h-24 items-center justify-center gap-3 rounded-md border p-4 text-lg font-semibold transition ${
        active ? "border-red-700 bg-red-50 text-red-800" : "border-slate-300 bg-white text-slate-900 hover:bg-slate-50"
      }`}
      type="button"
      onClick={onClick}
    >
      <span className="h-6 w-6">{icon}</span>
      {label}
    </button>
  );
}

function DisabledChoice({ icon, label }: { icon: JSX.Element; label: string }) {
  return (
    <button
      className="flex min-h-24 cursor-not-allowed flex-col items-center justify-center gap-2 rounded-md border border-slate-200 bg-slate-100 p-3 text-sm font-semibold text-slate-500 opacity-50 grayscale"
      disabled
      title={comingSoonTitle}
      type="button"
    >
      <span className="h-6 w-6">{icon}</span>
      <span>{label}</span>
      <span className="text-xs font-medium">Soon</span>
    </button>
  );
}

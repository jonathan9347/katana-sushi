import { FormEvent, useEffect, useMemo, useState } from "react";
import { Banknote, Landmark, Smartphone } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { Button } from "../../../components/ui/button";
import { Dialog } from "../../../components/ui/dialog";
import { api } from "../../../lib/api";

type PaymentMethod = "cash" | "gcash" | "bank_transfer";

type DiscountPreview = {
  subtotal: number;
  tax: number;
  discount_base_snapshot: number;
  discount_rate_snapshot: number;
  discounted_guest_count: number;
  discount_amount: number;
  total: number;
};

type PaymentModalProps = {
  open: boolean;
  total: number;
  tableName?: string | null;
  pending: boolean;
  previewRequest: { url: string; body: Record<string, unknown> } | null;
  onClose: () => void;
  onConfirm: (payment: {
    paymentMethod: PaymentMethod;
    cashReceived?: number;
    applyDiscount: boolean;
    guestCount: number;
    seniorPwdCount: number;
  }) => void;
};

const comingSoonTitle = "Coming soon - Online payments will be available in future update";

export default function PaymentModal({ open, total, tableName = null, pending, previewRequest, onClose, onConfirm }: PaymentModalProps) {
  const [method, setMethod] = useState<PaymentMethod>("cash");
  const [cashReceived, setCashReceived] = useState("");
  const [applyDiscount, setApplyDiscount] = useState(false);
  const [guestCount, setGuestCount] = useState("1");
  const [seniorPwdCount, setSeniorPwdCount] = useState("0");
  const previewQuery = useQuery({
    queryKey: [
      "pos",
      "payment-preview",
      previewRequest?.url,
      previewRequest?.body,
      applyDiscount,
      guestCount,
      seniorPwdCount
    ],
    queryFn: async () => {
      if (!previewRequest) throw new Error("Checkout preview is unavailable.");
      const response = await api.post<DiscountPreview>(previewRequest.url, {
        ...previewRequest.body,
        previewOnly: true,
        applyDiscount,
        guestCount: Number(guestCount),
        seniorPwdCount: Number(seniorPwdCount)
      });
      return response.data;
    },
    enabled: open && Boolean(previewRequest)
  });
  const preview = previewQuery.data;
  const amountDue = preview?.total ?? total;
  const cashValue = Number(cashReceived);
  const changeDue = useMemo(() => Math.max(cashValue - amountDue, 0), [cashValue, amountDue]);
  const canConfirm = method === "cash"
    && cashValue >= amountDue
    && !previewQuery.isLoading
    && !previewQuery.isError
    && Boolean(preview);
  useEffect(() => {
    if (open) {
      setMethod("cash");
      setCashReceived("");
      setApplyDiscount(false);
      setGuestCount("1");
      setSeniorPwdCount("0");
    }
  }, [open]);

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!method || !canConfirm) {
      return;
    }

    onConfirm({
      paymentMethod: method,
      cashReceived: method === "cash" ? cashValue : undefined,
      applyDiscount,
      guestCount: Number(guestCount),
      seniorPwdCount: Number(seniorPwdCount)
    });
  }

  return (
    <Dialog open={open} title={tableName ? `Checkout Table ${tableName}` : "Payment"} panelClassName="pos-payment-dialog max-w-[520px]" overlayClassName="pos-payment-backdrop" onClose={onClose}>
      <form className="grid gap-5" onSubmit={submit}>
        <div className="rounded-md border border-slate-200 bg-slate-50 p-4">
          <div className="grid gap-2 text-sm">
            <TotalLine label="Subtotal" value={preview?.subtotal ?? total} />
            {(preview?.tax ?? 0) > 0 && <TotalLine label="Tax" value={preview?.tax ?? 0} />}
            {applyDiscount && preview && (
              <TotalLine
                label={`Senior/PWD discount (${preview.discounted_guest_count} guests × ${preview.discount_rate_snapshot * 100}% of PHP ${preview.discount_base_snapshot.toLocaleString()} a-la-carte total)`}
                value={-preview.discount_amount}
              />
            )}
            <TotalLine label="Total to collect" value={amountDue} strong />
          </div>
        </div>

        {previewQuery.isLoading && <p role="status" className="text-sm text-slate-500">Calculating total...</p>}
        {previewQuery.isError && (
          <div className="flex items-center justify-between gap-3 text-sm text-red-700">
            <span role="alert">Unable to calculate the checkout total.</span>
            <Button type="button" variant="outline" onClick={() => void previewQuery.refetch()}>Retry</Button>
          </div>
        )}
        {preview && preview.discount_base_snapshot > 0 && (
          <SeniorPwdDiscountFields
            applyDiscount={applyDiscount}
            guestCount={guestCount}
            seniorPwdCount={seniorPwdCount}
            onApply={() => setApplyDiscount(true)}
            onGuestCountChange={setGuestCount}
            onSeniorPwdCountChange={setSeniorPwdCount}
          />
        )}

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
                autoFocus
                className="h-12 rounded-md border border-slate-300 px-3 text-lg outline-none focus:border-red-700 focus:ring-2 focus:ring-red-100"
                min={amountDue}
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
          <Button className="min-h-11 pos-payment-primary" disabled={!canConfirm || pending}>
            {pending ? "Processing..." : "Complete payment"}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}

export function SeniorPwdDiscountFields({
  applyDiscount,
  guestCount,
  seniorPwdCount,
  onApply,
  onGuestCountChange,
  onSeniorPwdCountChange,
  guestCountLabel = "Total guests",
  seniorPwdCountLabel = "Senior/PWD guests",
  guestCountAriaLabel = "Checkout guest count",
  seniorPwdCountAriaLabel = "Senior/PWD guest count"
}: {
  applyDiscount: boolean;
  guestCount: string;
  seniorPwdCount: string;
  onApply: () => void;
  onGuestCountChange: (value: string) => void;
  onSeniorPwdCountChange: (value: string) => void;
  guestCountLabel?: string;
  seniorPwdCountLabel?: string;
  guestCountAriaLabel?: string;
  seniorPwdCountAriaLabel?: string;
}) {
  if (!applyDiscount) {
    return <Button type="button" variant="outline" onClick={onApply}>Apply Discount</Button>;
  }

  return (
    <div className="grid gap-3 sm:grid-cols-2">
      <label className="grid gap-1 text-sm font-medium text-slate-700">
        {guestCountLabel}
        <input
          aria-label={guestCountAriaLabel}
          className="h-10 rounded-md border border-slate-300 px-3"
          type="number"
          min={1}
          max={1000}
          step={1}
          value={guestCount}
          onChange={(event) => onGuestCountChange(event.target.value)}
        />
      </label>
      <label className="grid gap-1 text-sm font-medium text-slate-700">
        {seniorPwdCountLabel}
        <input
          aria-label={seniorPwdCountAriaLabel}
          className="h-10 rounded-md border border-slate-300 px-3"
          type="number"
          min={0}
          max={1000}
          step={1}
          value={seniorPwdCount}
          onChange={(event) => onSeniorPwdCountChange(event.target.value)}
        />
      </label>
    </div>
  );
}

function TotalLine({ label, value, strong = false }: { label: string; value: number; strong?: boolean }) {
  return (
    <div className={`flex items-center justify-between ${strong ? "text-lg font-semibold text-slate-950" : "text-slate-600"}`}>
      <span>{label}</span>
      <span>PHP {value.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
    </div>
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

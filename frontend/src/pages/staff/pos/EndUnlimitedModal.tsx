import { FormEvent, useMemo, useState } from "react";
import { Button } from "../../../components/ui/button";
import { Dialog } from "../../../components/ui/dialog";

type OrderedProduct = {
  productId: string;
  name: string;
  price: number;
  quantity: number;
};

type EndUnlimitedModalProps = {
  open: boolean;
  orderedProducts: OrderedProduct[];
  chargePercent: number;
  pending: boolean;
  onClose: () => void;
  onEnd: (leftovers: Array<{ productId: string; quantity: number }>) => void;
};

export default function EndUnlimitedModal({ chargePercent, open, orderedProducts, pending, onClose, onEnd }: EndUnlimitedModalProps) {
  const [hasLeftovers, setHasLeftovers] = useState(false);
  const [leftovers, setLeftovers] = useState<Record<string, string>>({});
  const charge = useMemo(() => {
    return orderedProducts.reduce((total, product) => {
      const quantity = Number(leftovers[product.productId] ?? 0);
      return total + product.price * quantity * (chargePercent / 100);
    }, 0);
  }, [chargePercent, leftovers, orderedProducts]);

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    onEnd(
      hasLeftovers
        ? orderedProducts
            .map((product) => ({ productId: product.productId, quantity: Number(leftovers[product.productId] ?? 0) }))
            .filter((item) => item.quantity > 0)
        : []
    );
  }

  return (
    <Dialog open={open} title="End Unlimited Session" onClose={onClose}>
      <form className="grid gap-4" onSubmit={submit}>
        <label className="flex items-center gap-2 text-sm font-medium text-slate-700">
          <input className="h-4 w-4 accent-red-700" type="checkbox" checked={hasLeftovers} onChange={(event) => setHasLeftovers(event.target.checked)} />
          Customer had leftovers
        </label>
        {hasLeftovers && (
          <div className="grid max-h-64 gap-2 overflow-y-auto">
            {orderedProducts.map((product) => (
              <label key={product.productId} className="flex items-center justify-between gap-3 rounded-md border border-slate-200 p-2 text-sm">
                <span>{product.name}</span>
                <input
                  className="h-10 w-24 rounded-md border border-slate-300 px-2"
                  max={product.quantity}
                  min="0"
                  type="number"
                  value={leftovers[product.productId] ?? "0"}
                  onChange={(event) => setLeftovers((current) => ({ ...current, [product.productId]: event.target.value }))}
                />
              </label>
            ))}
          </div>
        )}
        <div className="rounded-md border border-slate-200 bg-slate-50 p-3 text-sm">
          <p className="font-semibold text-slate-950">Leftover Charges: PHP {charge.toFixed(2)}</p>
        </div>
        <div className="flex justify-end gap-2">
          <Button type="button" variant="outline" onClick={onClose}>Cancel</Button>
          <Button disabled={pending}>Confirm and Close</Button>
        </div>
      </form>
    </Dialog>
  );
}

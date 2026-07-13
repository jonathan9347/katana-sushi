import { FormEvent, useMemo, useState } from "react";
import { Button } from "../../../components/ui/button";
import { Dialog } from "../../../components/ui/dialog";

type StartUnlimitedModalProps = {
  open: boolean;
  pricePerPerson: number;
  pending: boolean;
  onClose: () => void;
  onStart: (payload: { paxCount: number }) => void;
};

const rules = [
  "Strictly No Left Overs. Left over charges will be based on Ala Carte Price.",
  "1 hour and 30 minutes rules. Time will start after serving the 1st round of order.",
  "All guests in the session must use the same menu.",
  "Order as much as you can to avoid left over charges."
];

export default function StartUnlimitedModal({ open, pending, pricePerPerson, onClose, onStart }: StartUnlimitedModalProps) {
  const [paxCount, setPaxCount] = useState("2");
  const numericPaxCount = Number(paxCount);
  const validPaxCount = Number.isInteger(numericPaxCount) && numericPaxCount > 0;
  const canStart = validPaxCount && !pending;
  const total = useMemo(() => (validPaxCount ? numericPaxCount : 0) * pricePerPerson, [numericPaxCount, pricePerPerson, validPaxCount]);

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!canStart) {
      return;
    }

    onStart({ paxCount: numericPaxCount });
  }

  return (
    <Dialog open={open} title="Start Unlimited Session" onClose={onClose}>
      <form className="grid gap-4" onSubmit={submit}>
        <label className="grid gap-1 text-sm font-medium text-slate-700">
          <span>Guests</span>
          <input
            className="h-10 rounded-md border border-slate-300 px-3 text-sm"
            min="1"
            required
            type="number"
            value={paxCount}
            onChange={(event) => setPaxCount(event.target.value)}
          />
        </label>
        <div className="rounded-md border border-slate-200 bg-slate-50 p-3">
          <p className="text-sm text-slate-600">Total Price</p>
          <p className="text-2xl font-semibold text-slate-950">PHP {total.toLocaleString()}</p>
        </div>
        <div className="grid gap-2 rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
          {rules.map((rule, index) => (
            <p key={rule}>{index + 1}. {rule}</p>
          ))}
        </div>
        <div className="flex justify-end gap-2">
          <Button type="button" variant="outline" onClick={onClose}>Cancel</Button>
          <Button disabled={!canStart}>Start</Button>
        </div>
      </form>
    </Dialog>
  );
}

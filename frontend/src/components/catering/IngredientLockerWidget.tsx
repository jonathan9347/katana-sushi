import { Sparkles, Lock } from "lucide-react";
import { Button } from "../ui/button";

type LockSummary = {
  id: string;
  reference: string;
  date: string;
  eventName: string;
  activeLocks: Array<{ name: string; quantity: number; unit: string }>;
};

type IngredientLockerWidgetProps = {
  lockSummaries: LockSummary[];
  onViewAll: () => void;
};

export function IngredientLockerWidget({ lockSummaries, onViewAll }: IngredientLockerWidgetProps) {
  return (
    <div className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
      <div className="flex items-center gap-3 border-b border-slate-200 pb-4">
        <Lock className="h-5 w-5 text-slate-700" />
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Ingredient Locks</p>
          <p className="text-base font-black text-slate-950">Upcoming locked ingredients</p>
        </div>
      </div>
      <div className="mt-4 space-y-4 max-h-[420px] overflow-hidden overflow-y-auto pr-1">
        {lockSummaries.length > 0 ? (
          lockSummaries.map((event) => (
            <div key={event.id} className="rounded-3xl border border-slate-200 bg-slate-50 p-4">
              <div className="flex items-center gap-2 text-sm font-semibold text-slate-800">
                <Sparkles className="h-4 w-4 text-red-600" />
                <span>{event.eventName}</span>
              </div>
              <p className="mt-1 text-sm text-slate-600">{event.date}</p>
              <p className="mt-3 text-sm text-slate-700">
                {event.activeLocks.slice(0, 3).map((lock, index) => (
                  <span key={lock.name} className={index > 0 ? "ml-2" : ""}>
                    {lock.name}: {lock.quantity} {lock.unit}
                  </span>
                ))}
              </p>
            </div>
          ))
        ) : (
          <div className="rounded-3xl border border-slate-200 bg-slate-50 p-6 text-sm text-slate-600">
            No locked ingredients for upcoming events.
          </div>
        )}
      </div>
      <div className="mt-5">
        <Button className="w-full" onClick={onViewAll}>
          View All Locks
        </Button>
      </div>
    </div>
  );
}

import { Dialog } from "../ui/dialog";
import { Button } from "../ui/button";
import { Lock, CalendarDays } from "lucide-react";

type LockItem = {
  id: string;
  name: string;
  reserved_quantity: number;
  unit: string;
  is_released: boolean;
};

type EventLockGroup = {
  id: string;
  reference: string;
  eventName: string;
  date: string;
  locks: LockItem[];
};

type AllLocksModalProps = {
  open: boolean;
  groups: EventLockGroup[];
  onClose: () => void;
  onReleaseCompleted: () => void;
  hasCompletedLocks: boolean;
};

export function AllLocksModal({ open, groups, onClose, onReleaseCompleted, hasCompletedLocks }: AllLocksModalProps) {
  return (
    <Dialog open={open} title="All Locked Ingredients" onClose={onClose} panelClassName="max-w-3xl">
      <div className="space-y-6">
        {groups.length === 0 ? (
          <div className="rounded-3xl border border-slate-200 bg-slate-50 p-6 text-sm text-slate-600">
            No locked ingredients are currently assigned to events.
          </div>
        ) : (
          groups.map((group) => (
            <div key={group.id} className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
              <div className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-2 text-sm font-semibold text-slate-800">
                  <CalendarDays className="h-4 w-4 text-red-600" />
                  <span>{group.eventName} · {group.date}</span>
                </div>
                <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-black uppercase text-slate-700">{group.locks.length} locks</span>
              </div>
              <div className="mt-4 space-y-2">
                {group.locks.map((lock) => (
                  <div key={lock.id} className="grid grid-cols-[1fr_1fr_1fr_auto] gap-3 rounded-3xl border border-slate-200 bg-slate-50 p-3 text-sm text-slate-700">
                    <span className="font-semibold text-slate-950">{lock.name}</span>
                    <span>{lock.reserved_quantity} {lock.unit}</span>
                    <span>{lock.is_released ? "Released" : "Pending"}</span>
                    <Button variant="outline" size="sm" disabled>
                      Release
                    </Button>
                  </div>
                ))}
              </div>
            </div>
          ))
        )}

        <div className="flex flex-col gap-3 sm:flex-row sm:justify-end">
          <Button variant="outline" onClick={onClose}>
            Close
          </Button>
          <Button onClick={onReleaseCompleted} disabled={!hasCompletedLocks}>
            Refresh completed releases
          </Button>
        </div>
      </div>
    </Dialog>
  );
}

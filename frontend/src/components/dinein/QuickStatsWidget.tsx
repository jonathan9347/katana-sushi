import { BarChart3, Clock3, Hourglass, Users } from "lucide-react";
import { formatTime12, manilaDateKey } from "../../lib/dateTime";
import { Button } from "../ui/button";

type DineInStatsReservation = {
  id: string;
  date: string;
  time: string;
  guests: number;
  status: string;
};

type QuickStatsWidgetProps = {
  selectedDate: string;
  reservations: DineInStatsReservation[];
  isLoading?: boolean;
  onViewPending?: () => void;
};

function startOfWeek(dateKey: string) {
  const date = new Date(`${dateKey}T00:00:00+08:00`);
  date.setDate(date.getDate() - date.getDay());
  return date;
}

function endOfWeek(dateKey: string) {
  const date = startOfWeek(dateKey);
  date.setDate(date.getDate() + 6);
  return date;
}

function isPending(status: string) {
  return status === "pending" || status === "pending_approval";
}

function mostRequestedTime(reservations: DineInStatsReservation[]) {
  const counts = new Map<string, number>();

  reservations.forEach((reservation) => {
    counts.set(reservation.time, (counts.get(reservation.time) ?? 0) + 1);
  });

  const top = [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0];
  return top ? formatTime12(top[0]) : "No bookings";
}

export function QuickStatsWidget({ selectedDate, reservations, isLoading = false, onViewPending }: QuickStatsWidgetProps) {
  const selectedReservations = reservations.filter((reservation) => manilaDateKey(reservation.date) === selectedDate);
  const weekStart = startOfWeek(selectedDate);
  const weekEnd = endOfWeek(selectedDate);
  const weekReservations = reservations.filter((reservation) => {
    const date = new Date(`${manilaDateKey(reservation.date)}T00:00:00+08:00`);
    return date >= weekStart && date <= weekEnd;
  });
  const pendingCount = reservations.filter((reservation) => isPending(reservation.status)).length;
  const selectedGuestCount = selectedReservations.reduce((total, reservation) => total + reservation.guests, 0);
  const weekGuestCount = weekReservations.reduce((total, reservation) => total + reservation.guests, 0);
  const averagePartySize = selectedReservations.length > 0 ? selectedGuestCount / selectedReservations.length : 0;

  return (
    <div className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
      <div className="flex items-center gap-3 border-b border-slate-200 pb-4">
        <BarChart3 className="h-5 w-5 text-red-700" />
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Quick Stats</p>
          <p className="text-base font-black text-slate-950">Dine-in guest snapshot</p>
        </div>
      </div>

      <div className="mt-4 grid gap-3">
        <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
          <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
            <Users className="h-4 w-4 text-slate-600" />
            Selected date
          </div>
          <div className="mt-3 grid grid-cols-2 gap-3">
            <div>
              <p className="text-xs text-slate-500">Guests</p>
              <p className="text-2xl font-black text-slate-950">{isLoading ? "-" : selectedGuestCount}</p>
            </div>
            <div>
              <p className="text-xs text-slate-500">Reservations</p>
              <p className="text-2xl font-black text-slate-950">{isLoading ? "-" : selectedReservations.length}</p>
            </div>
          </div>
        </div>

        <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
          <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
            <Clock3 className="h-4 w-4 text-slate-600" />
            This week
          </div>
          <div className="mt-3 grid grid-cols-2 gap-3">
            <div>
              <p className="text-xs text-slate-500">Guests</p>
              <p className="text-2xl font-black text-slate-950">{isLoading ? "-" : weekGuestCount}</p>
            </div>
            <div>
              <p className="text-xs text-slate-500">Reservations</p>
              <p className="text-2xl font-black text-slate-950">{isLoading ? "-" : weekReservations.length}</p>
            </div>
          </div>
        </div>

        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-1 xl:grid-cols-2">
          <div className="rounded-2xl border border-slate-200 bg-white p-4">
            <p className="text-xs uppercase tracking-wide text-slate-500">Most requested</p>
            <p className="mt-2 text-sm font-black text-slate-950">{isLoading ? "-" : mostRequestedTime(selectedReservations)}</p>
          </div>
          <div className="rounded-2xl border border-slate-200 bg-white p-4">
            <p className="text-xs uppercase tracking-wide text-slate-500">Avg. party</p>
            <p className="mt-2 text-sm font-black text-slate-950">{isLoading ? "-" : averagePartySize.toFixed(1)}</p>
          </div>
        </div>
      </div>

      <div className="mt-5 border-t border-slate-200 pt-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between lg:flex-col lg:items-stretch xl:flex-row xl:items-center">
          <div className="flex items-center gap-2 text-sm font-semibold text-amber-700">
            <Hourglass className="h-4 w-4" />
            <span>Pending approvals: {isLoading ? "-" : pendingCount}</span>
          </div>
          <Button type="button" size="sm" variant="outline" onClick={onViewPending} disabled={!onViewPending}>
            View Pending
          </Button>
        </div>
      </div>
    </div>
  );
}

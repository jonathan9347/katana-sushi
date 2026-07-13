import { useQuery } from "@tanstack/react-query";
import { CalendarDays, Clock } from "lucide-react";
import SectionNav, { SectionNavTab } from "../../../components/layout/SectionNav";
import { api } from "../../../lib/api";
import { useMemo, useState } from "react";
import { formatManilaDate, formatTime12, manilaDateKey, todayManilaDateKey } from "../../../lib/dateTime";

type Reservation = {
  id: string;
  booking_id: string;
  customer_name: string;
  date: string;
  time: string;
  party_size: number;
  status: string;
};

const reservationTabs: Array<SectionNavTab> = [
  { id: "pending", label: "Pending Requests", icon: <Clock className="h-4 w-4" />, to: "/staff/reservations/pending" },
  { id: "calendar", label: "Calendar View", icon: <CalendarDays className="h-4 w-4" />, to: "/staff/reservations/calendar" }
];

function today() {
  return todayManilaDateKey();
}

function toDateKey(date: Date) {
  return manilaDateKey(date);
}

function monthLabel(date: Date) {
  return date.toLocaleDateString("en-PH", { timeZone: "Asia/Manila", month: "long", year: "numeric" });
}

function dateText(date: string) {
  return formatManilaDate(date);
}

function statusClass(status: string) {
  if (status === "confirmed" || status === "seated") {
    return "bg-emerald-50 text-emerald-700";
  }
  if (status === "pending_final_payment") {
    return "bg-amber-50 text-amber-700";
  }
  if (status === "rejected" || status === "cancelled") {
    return "bg-red-50 text-red-700";
  }
  return "bg-amber-50 text-amber-700";
}

export default function CalendarView() {
  const [selectedDate, setSelectedDate] = useState(today());
  const [cursor, setCursor] = useState(() => new Date(`${today()}T00:00:00+08:00`));
  const [actionLoading, setActionLoading] = useState<Record<string, boolean>>({});
  const query = useQuery({
    queryKey: ["reservation-calendar"],
    queryFn: async () => (await api.get<{ reservations: Reservation[] }>("/api/staff/reservations/all")).data.reservations
  });

  const days = useMemo(() => {
    const first = new Date(cursor.getFullYear(), cursor.getMonth(), 1);
    const start = new Date(first);
    start.setDate(first.getDate() - first.getDay());

    return Array.from({ length: 42 }, (_, index) => {
      const day = new Date(start);
      day.setDate(start.getDate() + index);
      return day;
    });
  }, [cursor]);

  const reservationsByDate = useMemo(() => {
    const map = new Map<string, Reservation[]>();
    (query.data ?? []).forEach((reservation) => {
      const key = manilaDateKey(reservation.date);
      map.set(key, [...(map.get(key) ?? []), reservation]);
    });
    return map;
  }, [query.data]);
  const selectedReservations = (reservationsByDate.get(selectedDate) ?? []).sort((a, b) => a.time.localeCompare(b.time));

  function shiftMonth(delta: number) {
    setCursor((current) => new Date(current.getFullYear(), current.getMonth() + delta, 1));
  }

  async function handleArrive(reservation: Reservation) {
    setActionLoading((current) => ({ ...current, [reservation.id]: true }));

    try {
      await api.put(`/api/staff/reservations/${reservation.id}/arrive`);
      await query.refetch();
    } finally {
      setActionLoading((current) => ({ ...current, [reservation.id]: false }));
    }
  }

  async function handleComplete(reservation: Reservation) {
    setActionLoading((current) => ({ ...current, [reservation.id]: true }));

    try {
      await api.put(`/api/staff/reservations/${reservation.id}/complete`);
      await query.refetch();
    } finally {
      setActionLoading((current) => ({ ...current, [reservation.id]: false }));
    }
  }

  return (
    <main className="min-h-screen bg-slate-100 p-6 lg:p-8">
      <section className="mx-auto max-w-6xl rounded-lg border border-slate-200 bg-white shadow-sm">
        <div className="flex items-center justify-between border-b border-slate-200 px-6 py-4">
          <div>
            <p className="text-xs font-bold uppercase tracking-wide text-red-700">Reservations</p>
            <h1 className="text-xl font-bold uppercase tracking-wide text-slate-950">Reservation Calendar</h1>
          </div>
        </div>
        <div className="grid gap-6 p-6 lg:grid-cols-[1.4fr_1fr]">
          <div className="lg:col-span-2">
            <SectionNav tabs={reservationTabs} />
          </div>
          <div>
            <div className="mb-4 flex items-center justify-between">
              <button className="rounded-md border border-slate-300 px-3 py-2 text-sm font-bold" onClick={() => shiftMonth(-1)}>Previous</button>
              <h2 className="text-lg font-black uppercase text-slate-950">{monthLabel(cursor)}</h2>
              <button className="rounded-md border border-slate-300 px-3 py-2 text-sm font-bold" onClick={() => shiftMonth(1)}>Next</button>
            </div>
            <div className="grid grid-cols-7 gap-2 text-center text-xs font-black uppercase text-slate-500">
              {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((day) => <div key={day}>{day}</div>)}
            </div>
            <div className="mt-2 grid grid-cols-7 gap-2">
              {days.map((day) => {
                const key = toDateKey(day);
                const count = reservationsByDate.get(key)?.length ?? 0;
                const inMonth = day.getMonth() === cursor.getMonth();
                const selected = key === selectedDate;

                return (
                  <button
                    key={key}
                    onClick={() => setSelectedDate(key)}
                    className={`min-h-24 rounded-md border p-2 text-left ${selected ? "border-red-700 bg-red-50" : "border-slate-200 bg-white"} ${inMonth ? "text-slate-950" : "text-slate-400"}`}
                  >
                    <span className="text-sm font-black">{day.getDate()}</span>
                    {count > 0 && <span className="mt-2 block rounded-full bg-slate-950 px-2 py-1 text-center text-[11px] font-bold text-white">{count} bookings</span>}
                  </button>
                );
              })}
            </div>
          </div>
          <aside className="rounded-lg border border-slate-200 bg-slate-50 p-5">
            <h2 className="text-lg font-black text-slate-950">Selected Date</h2>
            <p className="mt-1 text-sm font-semibold text-slate-600">{dateText(selectedDate)}</p>
            <div className="mt-5 space-y-3">
              {selectedReservations.map((reservation) => (
                <article key={reservation.id} className="rounded-md border border-slate-200 bg-white p-4">
                  <div className="flex flex-col gap-4">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <p className="font-black text-slate-950">{formatTime12(reservation.time)} | {reservation.customer_name}</p>
                        <p className="mt-1 text-sm text-slate-600">
                          {reservation.party_size} guests
                        </p>
                      </div>
                      <span className={`rounded-full px-2 py-1 text-xs font-black uppercase ${statusClass(reservation.status)}`}>{reservation.status}</span>
                    </div>
                    <div className="grid gap-3 sm:grid-cols-2">
                      {reservation.status === "confirmed" ? (
                        <button
                          onClick={() => void handleArrive(reservation)}
                          disabled={actionLoading[reservation.id]}
                          className="rounded-md bg-emerald-700 px-4 py-2 text-sm font-bold text-white hover:bg-emerald-800 disabled:opacity-50"
                        >
                          {actionLoading[reservation.id] ? "Processing..." : "Mark Arrived"}
                        </button>
                      ) : null}
                      {(reservation.status === "seated" || reservation.status === "confirmed") ? (
                        <button
                          onClick={() => void handleComplete(reservation)}
                          disabled={actionLoading[reservation.id]}
                          className="rounded-md border border-slate-300 bg-white px-4 py-2 text-sm font-bold text-slate-800 hover:bg-slate-50 disabled:opacity-50"
                        >
                          {actionLoading[reservation.id] ? "Processing..." : "Complete Reservation"}
                        </button>
                      ) : null}
                      {reservation.status === "pending_final_payment" ? (
                        <div className="rounded-md bg-amber-50 px-3 py-2 text-sm font-semibold text-amber-800">
                          Final payment pending before completion.
                        </div>
                      ) : null}
                    </div>
                  </div>
                </article>
              ))}
              {selectedReservations.length === 0 && <p className="rounded-md bg-white p-4 text-sm font-semibold text-slate-600">No reservations on this date.</p>}
            </div>
          </aside>
        </div>
      </section>
    </main>
  );
}

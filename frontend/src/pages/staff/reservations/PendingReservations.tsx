import { useQuery } from "@tanstack/react-query";
import { CalendarDays, Clock, RefreshCw } from "lucide-react";
import { useState } from "react";
import SectionNav, { SectionNavTab } from "../../../components/layout/SectionNav";
import { api } from "../../../lib/api";
import { formatManilaDate, formatTime12 } from "../../../lib/dateTime";

type Reservation = {
  id: string;
  booking_id: string;
  customer_name: string;
  customer_phone: string;
  customer_email: string;
  date: string;
  time: string;
  party_size: number;
  special_requests?: string | null;
  available_capacity: number;
};

const reservationTabs: Array<SectionNavTab> = [
  { id: "pending", label: "Pending Requests", icon: <Clock className="h-4 w-4" />, to: "/staff/reservations/pending" },
  { id: "calendar", label: "Calendar View", icon: <CalendarDays className="h-4 w-4" />, to: "/staff/reservations/calendar" }
];

function dateText(date: string) {
  return formatManilaDate(date, { month: "short" });
}

export default function PendingReservations() {
  const [notesByReservation, setNotesByReservation] = useState<Record<string, string>>({});
  const [rejectByReservation, setRejectByReservation] = useState<Record<string, string>>({});
  const query = useQuery({
    queryKey: ["pending-reservations"],
    queryFn: async () => (await api.get<{ reservations: Reservation[] }>("/api/staff/reservations/pending")).data.reservations
  });

  async function approve(reservation: Reservation) {
    if (reservation.available_capacity < reservation.party_size) {
      return;
    }
    await api.put(`/api/staff/reservations/${reservation.id}/approve`, {
      admin_notes: notesByReservation[reservation.id]
    });
    await query.refetch();
  }

  async function reject(reservation: Reservation) {
    await api.put(`/api/staff/reservations/${reservation.id}/reject`, {
      rejected_reason: rejectByReservation[reservation.id] || "No available capacity for the selected schedule",
      alternative_suggestions: "Please choose another time or contact the restaurant."
    });
    await query.refetch();
  }

  return (
    <main className="min-h-screen min-w-[1280px] bg-slate-100 p-8">
      <section className="mx-auto max-w-6xl rounded-lg border border-slate-200 bg-white shadow-sm">
        <div className="flex items-center justify-between border-b border-slate-200 px-6 py-4">
          <div>
            <p className="text-xs font-bold uppercase tracking-wide text-red-700">Reservations</p>
            <h1 className="text-xl font-bold uppercase tracking-wide text-slate-950">Pending Reservations</h1>
          </div>
          <div className="flex items-center gap-2">
            <button onClick={() => void query.refetch()} className="flex items-center gap-2 rounded-md border border-slate-300 px-3 py-2 text-sm font-semibold text-slate-700">
              <RefreshCw className="h-4 w-4" /> Refresh
            </button>
          </div>
        </div>
        <div className="space-y-5 p-6">
          <SectionNav tabs={reservationTabs} />
          {query.data?.map((reservation) => (
            <article key={reservation.id} className="rounded-lg border border-slate-200 p-5">
              <div className="flex items-start justify-between gap-5">
                <div>
                  <h2 className="text-lg font-bold text-slate-950">
                    #{reservation.booking_id} | {dateText(reservation.date)} | {formatTime12(reservation.time)} | {reservation.party_size} guests
                  </h2>
                  <p className="mt-1 text-sm text-slate-700">
                    Customer: {reservation.customer_name} | {reservation.customer_phone} | {reservation.customer_email}
                  </p>
                  {reservation.special_requests && <p className="mt-2 text-sm text-slate-600">Special: "{reservation.special_requests}"</p>}
                </div>
                <span className="rounded-full bg-amber-50 px-3 py-1 text-xs font-bold uppercase text-amber-700">Pending</span>
              </div>
              <div className="mt-5 rounded-md border border-slate-200 bg-slate-50 p-3 text-sm">
                <p className="font-semibold text-slate-950">Capacity check</p>
                <p className={reservation.available_capacity >= reservation.party_size ? "text-slate-600" : "font-medium text-red-700"}>
                  {reservation.available_capacity} seats available for this time slot.
                </p>
              </div>
              <div className="mt-5 grid grid-cols-[1fr_1fr_auto_auto] gap-3">
                <input className="rounded-md border border-slate-300 px-3 py-2 text-sm" placeholder="Admin notes" value={notesByReservation[reservation.id] ?? ""} onChange={(event) => setNotesByReservation((current) => ({ ...current, [reservation.id]: event.target.value }))} />
                <input className="rounded-md border border-slate-300 px-3 py-2 text-sm" placeholder="Reject reason" value={rejectByReservation[reservation.id] ?? ""} onChange={(event) => setRejectByReservation((current) => ({ ...current, [reservation.id]: event.target.value }))} />
                <button onClick={() => void approve(reservation)} className="rounded-md bg-emerald-700 px-4 py-2 text-sm font-bold text-white disabled:opacity-50" disabled={reservation.available_capacity < reservation.party_size}>
                  Approve & Notify
                </button>
                <button onClick={() => void reject(reservation)} className="rounded-md border border-red-200 bg-red-50 px-4 py-2 text-sm font-bold text-red-700">
                  Reject
                </button>
              </div>
            </article>
          ))}
          {query.data?.length === 0 && <p className="rounded-md bg-slate-50 p-5 text-sm text-slate-600">No pending reservations.</p>}
        </div>
      </section>
    </main>
  );
}

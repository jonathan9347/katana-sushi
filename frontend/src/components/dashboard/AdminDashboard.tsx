import { useQuery } from "@tanstack/react-query";
import { CalendarDays, CheckCheck, Clock } from "lucide-react";
import { Link } from "react-router-dom";
import { api } from "../../lib/api";
import { formatManilaDate, formatTime12, manilaDateKey, todayManilaDateKey } from "../../lib/dateTime";
import { DashboardWidget } from "./DashboardWidget";

type Reminder = {
  id: string;
  type: "dine_in" | "catering";
  reference: string;
  customerName: string;
  date: string;
  time: string | null;
  status: string;
  detail: string;
};

export default function AdminDashboard() {
  const remindersQuery = useQuery<Reminder[]>({
    queryKey: ["staff-reminders"],
    queryFn: async () => (await api.get<{ reminders: Reminder[] }>("/api/staff/reminders")).data.reminders,
    refetchInterval: 60_000
  });
  const reminders = remindersQuery.data ?? [];

  return (
    <div className="space-y-6">
      <div className="grid gap-6 xl:grid-cols-4 lg:grid-cols-2">
        <DashboardWidget title="Today's Sales" icon="💰" value="₱15,240" subtitle="Total revenue for today" />
        <DashboardWidget title="Pending Approvals" icon="🕒" value={4} subtitle="Open reservation and event requests" />
        <DashboardWidget title="Low Stock Alerts" icon="⚠️" value={3} subtitle="Materials need restocking" />
        <DashboardWidget title="Upcoming Events" icon="🎉" value={2} subtitle="Catering events scheduled" />
      </div>

      <div className="grid gap-6 xl:grid-cols-[1.5fr_1fr]">
        <DashboardWidget title="Recent Sales" icon="📈" value="" subtitle="Latest completed transactions">
          <ul className="space-y-3 text-sm text-slate-700">
            <li>• #KTN-001 ₱1,450</li>
            <li>• #KTN-002 ₱890</li>
            <li>• #KTN-003 ₱2,396</li>
          </ul>
        </DashboardWidget>

        <DashboardWidget title="Inventory Alerts" icon="📦" value="" subtitle="Stock levels to review">
          <ul className="space-y-3 text-sm text-slate-700">
            <li>• Rice – 5kg left (reorder)</li>
            <li>• Salmon – 3kg left (critical)</li>
            <li>• Nori – 50 sheets left</li>
          </ul>
        </DashboardWidget>
      </div>

      <section aria-labelledby="dashboard-reminders-title" className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
        <div className="mb-5 flex items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <span className="flex h-10 w-10 items-center justify-center rounded-lg bg-amber-50 text-amber-700">
              <CalendarDays className="h-5 w-5" aria-hidden="true" />
            </span>
            <div>
              <h2 id="dashboard-reminders-title" className="text-sm font-semibold uppercase tracking-[0.2em] text-red-700">Reminders</h2>
              <p className="mt-1 text-sm text-slate-500">Approved bookings and events coming up this week.</p>
            </div>
          </div>
          <span className="shrink-0 rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold text-slate-600">Next 7 days</span>
        </div>

        {remindersQuery.isPending ? (
          <p className="py-8 text-center text-sm text-slate-500" role="status">Loading reminders...</p>
        ) : remindersQuery.isError ? (
          <div className="py-8 text-center" role="alert">
            <p className="text-sm text-slate-600">Reminders are temporarily unavailable.</p>
            <button type="button" onClick={() => void remindersQuery.refetch()} className="mt-2 text-sm font-semibold text-red-700 hover:underline">
              Try again
            </button>
          </div>
        ) : reminders.length === 0 ? (
          <div className="flex flex-col items-center gap-2 border-t border-slate-100 py-8 text-center">
            <CheckCheck className="h-7 w-7 text-emerald-600" aria-hidden="true" />
            <p className="text-sm font-semibold text-slate-800">No upcoming reminders</p>
            <p className="text-sm text-slate-500">Approved dine-in bookings and catering events will appear here.</p>
          </div>
        ) : (
          <ul className="divide-y divide-slate-100 border-t border-slate-100">
            {reminders.map((reminder) => {
              const reminderDate = manilaDateKey(reminder.date);
              const today = reminderDate === todayManilaDateKey();
              const path = reminder.type === "dine_in" ? "/staff/reservations" : "/staff/catering";
              const title = reminder.type === "dine_in"
                ? today ? "Dine-in expected today" : "Upcoming dine-in reservation"
                : today ? "Catering event today · prepare" : "Upcoming catering event · prepare";

              return (
                <li key={`${reminder.type}-${reminder.id}`}>
                  <Link to={path} className="flex items-center justify-between gap-4 py-4 transition hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-red-700">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="text-sm font-semibold text-slate-900">{title}</p>
                        {today && <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-bold uppercase text-amber-800">Today</span>}
                      </div>
                      <p className="mt-1 truncate text-sm text-slate-700">{reminder.customerName} · {reminder.detail || reminder.reference}</p>
                      <p className="mt-1 text-xs text-slate-500">{reminder.reference}</p>
                    </div>
                    <p className="flex shrink-0 items-center gap-1.5 text-xs font-medium text-slate-500">
                      <Clock className="h-3.5 w-3.5" aria-hidden="true" />
                      {today ? "Today" : formatManilaDate(reminder.date, { month: "short", day: "numeric" })}
                      {reminder.time ? ` · ${formatTime12(reminder.time)}` : ""}
                    </p>
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </div>
  );
}

import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { Bell, CheckCheck, Clock } from "lucide-react";
import { useAuth } from "../../hooks/useAuth";
import { api } from "../../lib/api";
import { formatManilaDate, formatTime12 } from "../../lib/dateTime";
import AdminDashboard from "../../components/dashboard/AdminDashboard";
import CashierDashboard from "../../components/dashboard/CashierDashboard";
import InventoryDashboard from "../../components/dashboard/InventoryDashboard";
import ReceptionDashboard from "../../components/dashboard/ReceptionDashboard";
import EventDashboard from "../../components/dashboard/EventDashboard";
import ChefDashboard from "../../components/dashboard/ChefDashboard";
import FeedbackAnalysisTable from "../../components/dashboard/FeedbackAnalysisTable";

type StaffNotification = {
  id: string;
  type: "dine_in" | "catering";
  reference: string;
  customerName: string;
  date: string;
  time: string | null;
  status: string;
  createdAt: string;
};

export default function Dashboard() {
  const { user } = useAuth();
  const role = user?.role ?? "staff";
  const displayRole = role.replace("_", " ").toUpperCase();

  const dashboardComponent = {
    admin: <AdminDashboard />,
    inventory_manager: <InventoryDashboard />,
    cashier: <CashierDashboard />,
    receptionist: <ReceptionDashboard />,
    event_coordinator: <EventDashboard />,
    chef: <ChefDashboard />
  }[role as keyof Record<string, JSX.Element>] ?? <AdminDashboard />;
  const canViewFeedbackAnalysis = ["admin", "receptionist", "event_coordinator"].includes(role);
  const notificationsQuery = useQuery<StaffNotification[]>({
    queryKey: ["staff-notifications"],
    queryFn: async () => {
      const response = await api.get<{ notifications: StaffNotification[] }>("/api/staff/notifications");
      return response.data.notifications;
    },
    refetchInterval: 30_000
  });
  const notifications = notificationsQuery.data ?? [];

  return (
    <main className="min-h-screen w-full bg-slate-100 p-4 pb-24 md:p-6 lg:p-8">
      <div className="grid w-full grid-cols-1 items-start gap-6 xl:grid-cols-[minmax(0,1fr)_20rem]">
        <section className="min-w-0 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm sm:p-8">
          <div className="mb-8 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <p className="text-sm font-semibold uppercase tracking-[0.3em] text-red-700">Staff Portal</p>
              <h1 className="mt-2 text-4xl font-black text-slate-950">Welcome back, {user?.name ?? "Staff"}</h1>
              <p className="mt-2 text-sm text-slate-600">
                Role: <span className="font-semibold uppercase text-slate-900">{displayRole}</span>
              </p>
            </div>
            <Link
              to="/staff/settings"
              className="inline-flex items-center rounded-full border border-red-700 bg-red-50 px-4 py-2 text-sm font-semibold text-red-700 transition hover:bg-red-100"
            >
              Settings
            </Link>
          </div>

          <section className="grid min-w-0 gap-6">
            {dashboardComponent}
            {canViewFeedbackAnalysis && <FeedbackAnalysisTable />}
          </section>
        </section>

        <aside aria-labelledby="staff-notifications-title" className="rounded-2xl border border-slate-200 bg-white shadow-sm xl:sticky xl:top-6">
          <div className="flex items-center justify-between border-b border-slate-200 px-5 py-4">
            <div className="flex items-center gap-3">
              <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-red-50 text-red-700">
                <Bell className="h-5 w-5" aria-hidden="true" />
              </span>
              <div>
                <h2 id="staff-notifications-title" className="font-bold text-slate-950">Notifications</h2>
                <p className="text-xs text-slate-500">Staff updates</p>
              </div>
            </div>
            <span className="rounded-full bg-amber-50 px-2.5 py-1 text-xs font-semibold text-amber-800">
              {notifications.length} pending
            </span>
          </div>
          {notificationsQuery.isPending ? (
            <div className="flex min-h-56 items-center justify-center px-6 py-10 text-sm text-slate-500" role="status">
              Loading bookings...
            </div>
          ) : notificationsQuery.isError ? (
            <div className="px-5 py-8 text-center" role="alert">
              <p className="text-sm font-semibold text-slate-900">Could not load bookings</p>
              <button
                type="button"
                onClick={() => void notificationsQuery.refetch()}
                className="mt-2 text-sm font-semibold text-red-700 hover:underline"
              >
                Try again
              </button>
            </div>
          ) : notifications.length === 0 ? (
            <div className="flex min-h-56 flex-col items-center justify-center px-6 py-10 text-center">
              <span className="flex h-12 w-12 items-center justify-center rounded-full bg-emerald-50 text-emerald-700">
                <CheckCheck className="h-6 w-6" aria-hidden="true" />
              </span>
              <h3 className="mt-4 text-sm font-semibold text-slate-900">You’re all caught up</h3>
              <p className="mt-1 max-w-xs text-sm leading-6 text-slate-500">
                Pending bookings will appear here.
              </p>
            </div>
          ) : (
            <ul className="divide-y divide-slate-100">
              {notifications.map((notification) => (
                <li key={`${notification.type}-${notification.id}`}>
                  <Link
                    to={notification.type === "dine_in" ? "/staff/reservations" : "/staff/catering"}
                    className="block px-5 py-4 transition hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-red-700"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="truncate text-sm font-semibold text-slate-900">{notification.customerName}</p>
                        <p className="mt-1 text-xs text-slate-500">
                          {notification.type === "dine_in" ? "Dine-in" : "Catering"} · {notification.reference}
                        </p>
                      </div>
                      <span className="shrink-0 rounded-full bg-amber-50 px-2 py-1 text-[11px] font-semibold capitalize text-amber-800">
                        {notification.status.replace(/_/g, " ")}
                      </span>
                    </div>
                    <p className="mt-3 flex items-center gap-1.5 text-xs text-slate-500">
                      <Clock className="h-3.5 w-3.5" aria-hidden="true" />
                      {formatManilaDate(notification.date, { month: "short", day: "numeric" })}
                      {notification.time ? ` · ${formatTime12(notification.time)}` : ""}
                    </p>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </aside>
      </div>
    </main>
  );
}

import { useMemo, useState, type ReactNode } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { isAxiosError } from "axios";
import {
  Check,
  ChevronLeft,
  ChevronRight,
  Clock3,
  Settings,
  X
} from "lucide-react";
import { Link } from "react-router-dom";
import { useAuth } from "../../hooks/useAuth";
import { formatManilaDate, formatTime12, todayManilaDateKey } from "../../lib/dateTime";
import {
  dashboardKeys,
  fetchDashboardCalendar,
  fetchDashboardFeedback,
  fetchDashboardInventory,
  fetchDashboardNotifications,
  fetchDashboardReminders,
  fetchDashboardSales,
  fetchDashboardSummary,
  updateDashboardBooking,
  type DashboardNotification
} from "../../lib/staffDashboard";

const refreshOptions = {
  refetchInterval: 60_000,
  refetchOnWindowFocus: true
} as const;

function money(value: string) {
  return new Intl.NumberFormat("en-PH", { style: "currency", currency: "PHP" }).format(Number(value));
}

function Skeleton({ rows = 2 }: { rows?: number }) {
  return (
    <div className="animate-pulse space-y-3" role="status" aria-label="Loading dashboard data">
      {Array.from({ length: rows }, (_, index) => (
        <div key={index} className="h-10 rounded-md bg-slate-100" />
      ))}
    </div>
  );
}

function Retry({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="mt-2 rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-semibold text-slate-800 hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-700"
    >
      Retry
    </button>
  );
}

function DashboardCard({
  title,
  subtitle,
  children,
  className = ""
}: {
  title: string;
  subtitle?: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={`min-w-0 rounded-lg border border-slate-200 bg-white p-5 shadow-sm ${className}`}>
      <div className="mb-4">
        <h2 className="text-lg font-bold text-slate-950">{title}</h2>
        {subtitle && <p className="mt-1 text-sm text-slate-500">{subtitle}</p>}
      </div>
      {children}
    </section>
  );
}

function salesSparkline(values: number[]) {
  const width = 600;
  const height = 90;
  const maximum = Math.max(...values, 1);
  return values.map((value, index) => {
    const x = values.length < 2 ? width / 2 : (index / (values.length - 1)) * width;
    const y = height - (value / maximum) * (height - 12) - 6;
    return `${index === 0 ? "M" : "L"}${x.toFixed(1)},${y.toFixed(1)}`;
  }).join(" ");
}

function monthLabel(month: string) {
  const [year, monthNumber] = month.split("-").map(Number);
  return new Intl.DateTimeFormat("en", { month: "long", year: "numeric", timeZone: "UTC" })
    .format(new Date(Date.UTC(year, monthNumber - 1, 1)));
}

function nextMonth(month: string, delta: number) {
  const [year, monthNumber] = month.split("-").map(Number);
  const date = new Date(Date.UTC(year, monthNumber - 1 + delta, 1));
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
}

function canChangeBooking(type: DashboardNotification["type"], role: string) {
  if (type === "table") return role === "admin";
  if (type === "catering") return ["admin", "event_coordinator"].includes(role);
  return ["admin", "cashier", "chef"].includes(role);
}

function bookingActionError(error: unknown) {
  if (isAxiosError<{ message?: string }>(error)) {
    return error.response?.data?.message ?? "Booking status could not be updated. Your list was restored.";
  }

  return error instanceof Error ? error.message : "Booking status could not be updated. Your list was restored.";
}

export default function StaffDashboard() {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const [month, setMonth] = useState(() => todayManilaDateKey().slice(0, 7));
  const summaryQuery = useQuery({ queryKey: dashboardKeys.summary, queryFn: fetchDashboardSummary, ...refreshOptions });
  const salesQuery = useQuery({ queryKey: dashboardKeys.sales, queryFn: fetchDashboardSales, ...refreshOptions });
  const inventoryQuery = useQuery({ queryKey: dashboardKeys.inventory, queryFn: fetchDashboardInventory, ...refreshOptions });
  const remindersQuery = useQuery({ queryKey: dashboardKeys.reminders, queryFn: fetchDashboardReminders, ...refreshOptions });
  const feedbackQuery = useQuery({ queryKey: dashboardKeys.feedback, queryFn: fetchDashboardFeedback, ...refreshOptions });
  const notificationsQuery = useQuery({
    queryKey: dashboardKeys.notifications,
    queryFn: fetchDashboardNotifications,
    ...refreshOptions
  });
  const calendarQuery = useQuery({
    queryKey: dashboardKeys.calendar(month),
    queryFn: () => fetchDashboardCalendar(month),
    ...refreshOptions
  });
  const mutation = useMutation({
    mutationFn: ({ notification, status }: { notification: DashboardNotification; status: "approved" | "declined" }) =>
      updateDashboardBooking(notification, status),
    onMutate: async ({ notification }) => {
      await queryClient.cancelQueries({ queryKey: dashboardKeys.notifications });
      const previousNotifications = queryClient.getQueryData<Awaited<ReturnType<typeof fetchDashboardNotifications>>>(dashboardKeys.notifications);
      const previousSummary = queryClient.getQueryData<Awaited<ReturnType<typeof fetchDashboardSummary>>>(dashboardKeys.summary);
      queryClient.setQueryData<Awaited<ReturnType<typeof fetchDashboardNotifications>>>(dashboardKeys.notifications, (current) =>
        current ? { ...current, total: Math.max(current.total - 1, 0), notifications: current.notifications.filter((item) => item.id !== notification.id || item.type !== notification.type) } : current
      );
      if (previousSummary) {
        queryClient.setQueryData(dashboardKeys.summary, {
          ...previousSummary,
          pendingApprovals: Math.max(previousSummary.pendingApprovals - 1, 0)
        });
      }
      return { previousNotifications, previousSummary };
    },
    onError: (_error, _variables, context) => {
      if (context?.previousNotifications) {
        queryClient.setQueryData(dashboardKeys.notifications, context.previousNotifications);
      }
      if (context?.previousSummary) {
        queryClient.setQueryData(dashboardKeys.summary, context.previousSummary);
      }
    },
    onSettled: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: dashboardKeys.notifications }),
        queryClient.invalidateQueries({ queryKey: dashboardKeys.summary }),
        queryClient.invalidateQueries({ queryKey: dashboardKeys.reminders }),
        queryClient.invalidateQueries({ queryKey: ["staff-dashboard", "calendar"] })
      ]);
    }
  });

  const updatedAt = Math.max(
    summaryQuery.dataUpdatedAt,
    salesQuery.dataUpdatedAt,
    inventoryQuery.dataUpdatedAt,
    remindersQuery.dataUpdatedAt,
    feedbackQuery.dataUpdatedAt,
    notificationsQuery.dataUpdatedAt,
    calendarQuery.dataUpdatedAt
  );
  const today = todayManilaDateKey();
  const daysInMonth = useMemo(() => {
    const [year, monthNumber] = month.split("-").map(Number);
    return new Date(Date.UTC(year, monthNumber, 0)).getUTCDate();
  }, [month]);
  const firstWeekday = useMemo(() => {
    const [year, monthNumber] = month.split("-").map(Number);
    return new Date(Date.UTC(year, monthNumber - 1, 1)).getUTCDay();
  }, [month]);
  const latestSales = salesQuery.data ?? [];
  const alerts = inventoryQuery.data?.items ?? [];
  const reminders = remindersQuery.data ?? [];
  const feedback = feedbackQuery.data ?? [];
  const notifications = notificationsQuery.data?.notifications ?? [];
  const approvedDates = new Set(calendarQuery.data ?? []);
  const role = user?.role ?? "staff";
  const displayRole = role === "staff" ? "TEAM MEMBER" : role.replace(/_/g, " ").toUpperCase();

  return (
    <main className="staff-dashboard min-h-screen w-full bg-[#f8f5f7] p-4 pb-24 md:p-6 lg:p-8 min-[1100px]:h-screen min-[1100px]:overflow-hidden">
      <div className="grid min-w-0 gap-5 min-[1100px]:h-full min-[1100px]:grid-cols-[minmax(0,3fr)_minmax(320px,1.35fr)]">
        <div className="min-w-0 space-y-5 min-[1100px]:min-h-0 min-[1100px]:overflow-y-auto min-[1100px]:pb-8 min-[1100px]:pr-1">
          <header className="flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
            <div className="min-w-0">
              <p className="text-xs font-bold uppercase tracking-[0.18em] text-red-800">Operations</p>
              <h1 className="mt-1 text-3xl font-black tracking-tight text-slate-950 sm:text-4xl">
                Welcome back, {user?.name ?? "Team member"}
              </h1>
              <p className="mt-2 text-xs text-slate-500" aria-live="polite">
                {updatedAt ? `Last updated ${new Intl.DateTimeFormat("en-PH", { hour: "numeric", minute: "2-digit" }).format(updatedAt)}` : "Loading dashboard data"}
              </p>
            </div>
            <div className="flex items-center gap-3">
              <span className="rounded-full bg-amber-100 px-3 py-2 text-xs font-bold text-amber-900">
                Role · {displayRole}
              </span>
              <Link
                to="/staff/settings"
                className="inline-flex items-center gap-2 rounded-lg border border-slate-300 bg-white px-4 py-2.5 text-sm font-semibold text-slate-900 hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-700"
              >
                <Settings className="h-4 w-4" aria-hidden="true" /> Settings
              </Link>
            </div>
          </header>

          <div className="grid min-w-0 gap-4 min-[800px]:grid-cols-[minmax(0,3fr)_minmax(240px,2fr)]">
            <section className="relative flex min-h-56 flex-col justify-between overflow-hidden rounded-lg bg-gradient-to-br from-[#a43930] to-[#76221b] p-6 text-white shadow-sm sm:min-h-64">
              <div aria-hidden="true" className="pointer-events-none absolute -right-10 -top-20 h-64 w-64 rounded-full bg-white/10" />
              <div className="relative z-10">
                <p className="text-sm font-medium">Today&apos;s sales</p>
                {summaryQuery.isPending ? (
                  <div className="mt-3 h-12 w-56 animate-pulse rounded-md bg-white/20" role="status" aria-label="Loading sales" />
                ) : summaryQuery.isError ? (
                  <div role="alert" className="mt-3 text-sm">
                    <p>Sales are temporarily unavailable.</p>
                    <Retry onClick={() => void summaryQuery.refetch()} />
                  </div>
                ) : (
                  <>
                    <p className="mt-1 text-4xl font-black tracking-tight sm:text-5xl">{money(summaryQuery.data.todaySales.total)}</p>
                    <p className="mt-3 inline-flex rounded-full bg-amber-100 px-3 py-1 text-xs font-semibold text-amber-950">
                      {summaryQuery.data.todaySales.transactionCount} completed transactions
                    </p>
                  </>
                )}
              </div>
              {!summaryQuery.isError && !summaryQuery.isPending && (
                <svg className="relative z-10 mt-5 h-16 w-full" viewBox="0 0 600 90" preserveAspectRatio="none" role="img" aria-label="Hourly sales sparkline">
                  <path d={salesSparkline(summaryQuery.data.todaySales.series.map((item) => Number(item.total)))} fill="none" stroke="white" strokeWidth="3" vectorEffect="non-scaling-stroke" />
                </svg>
              )}
            </section>

            <div className="grid gap-3">
              <Link to="/staff/reservations" className="flex min-h-20 items-center gap-4 rounded-lg bg-[#191517] p-4 text-white hover:bg-[#282225] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-700">
                <span className="min-w-10 text-3xl font-black">{summaryQuery.isError ? "—" : summaryQuery.data?.pendingApprovals ?? "…"}</span>
                <span><span className="block font-bold">Pending approvals</span><span className="mt-1 block text-xs text-white/70">Open reservation and event requests</span></span>
              </Link>
              <Link to="/staff/inventory" className="flex min-h-20 items-center gap-4 rounded-lg bg-[#fff1df] p-4 text-slate-950 hover:bg-[#ffe8cb] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-700">
                <span className="min-w-10 text-3xl font-black">{summaryQuery.isError ? "—" : summaryQuery.data?.lowStockCount ?? "…"}</span>
                <span><span className="block font-bold">Low stock alerts</span><span className="mt-1 block text-xs text-slate-600">Materials need restocking</span></span>
              </Link>
              <Link to="/staff/catering" className="flex min-h-20 items-center gap-4 rounded-lg bg-[#e7f0e9] p-4 text-slate-950 hover:bg-[#dceade] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-700">
                <span className="min-w-10 text-3xl font-black">{summaryQuery.isError ? "—" : summaryQuery.data?.upcomingEvents ?? "…"}</span>
                <span><span className="block font-bold">Upcoming events</span><span className="mt-1 block text-xs text-slate-600">Approved catering events scheduled</span></span>
              </Link>
            </div>
          </div>

          <div className="grid min-w-0 gap-4 min-[800px]:grid-cols-2">
            <DashboardCard title="Recent sales" subtitle="Latest completed transactions" className="min-h-64">
              {salesQuery.isPending ? <Skeleton rows={3} /> : salesQuery.isError ? (
                <div role="alert"><p className="text-sm text-slate-700">Sales could not be loaded.</p><Retry onClick={() => void salesQuery.refetch()} /></div>
              ) : latestSales.length === 0 ? (
                <p className="py-6 text-center text-sm text-slate-500">No completed sales yet.</p>
              ) : (
                <ul className="divide-y divide-slate-100">
                  {latestSales.map((sale) => (
                    <li key={sale.id} className="flex items-center justify-between gap-3 py-3 text-sm">
                      <span className="truncate font-semibold text-slate-900">#{sale.orderNumber}</span>
                      <span className="shrink-0 text-slate-700">{money(sale.total)}</span>
                    </li>
                  ))}
                </ul>
              )}
            </DashboardCard>

            <DashboardCard title="Inventory alerts" subtitle="Lowest available stock · below par level" className="min-h-64">
              {inventoryQuery.isPending ? <Skeleton rows={4} /> : inventoryQuery.isError ? (
                <div role="alert"><p className="text-sm text-slate-700">Inventory alerts could not be loaded.</p><Retry onClick={() => void inventoryQuery.refetch()} /></div>
              ) : alerts.length === 0 ? (
                <p className="py-6 text-center text-sm text-slate-500">No low stock alerts.</p>
              ) : (
                <ul className="space-y-3">
                  {alerts.map((item) => (
                    <li key={item.id}>
                      <div className="flex items-baseline justify-between gap-2 text-sm">
                        <span className="truncate font-semibold text-slate-900">{item.name}</span>
                        <span className="shrink-0 text-right text-xs text-slate-600">
                          {item.quantityLeft} {item.unit} left · <strong className={item.severity === "critical" ? "text-red-800" : "text-amber-800"}>{item.severity}</strong>
                        </span>
                      </div>
                      <div
                        className="mt-1.5 h-2 overflow-hidden rounded-full bg-rose-100"
                        role="progressbar"
                        aria-label={`${item.name} stock relative to par level`}
                        aria-valuemin={0}
                        aria-valuemax={100}
                        aria-valuenow={Math.max(0, Math.min(100, item.percentOfPar))}
                      >
                        <div
                          className={`h-full ${item.severity === "critical" ? "bg-red-800" : "bg-amber-500"}`}
                          style={{ width: `${Math.max(0, Math.min(100, item.percentOfPar))}%` }}
                        />
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </DashboardCard>
          </div>

          <DashboardCard title="Reminders" subtitle="Approved bookings and events in the next 7 days">
            {remindersQuery.isPending ? <Skeleton rows={3} /> : remindersQuery.isError ? (
              <div role="alert"><p className="text-sm text-slate-700">Reminders could not be loaded.</p><Retry onClick={() => void remindersQuery.refetch()} /></div>
            ) : reminders.length === 0 ? (
              <p className="py-6 text-center text-sm text-slate-500">No upcoming reminders</p>
            ) : (
              <ul className="divide-y divide-slate-100">
                {reminders.map((reminder) => (
                  <li key={`${reminder.type}-${reminder.id}`} className="flex flex-col justify-between gap-2 py-3 sm:flex-row sm:items-center">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-semibold text-slate-900">{reminder.customerName} · {reminder.details}</p>
                      <p className="mt-1 text-xs text-slate-500">{reminder.type === "table" ? "Table booking" : "Catering event"} · {reminder.reference}</p>
                    </div>
                    <p className="flex shrink-0 items-center gap-1.5 text-xs text-slate-600">
                      <Clock3 className="h-3.5 w-3.5" aria-hidden="true" />
                      {formatManilaDate(reminder.date, { month: "short", day: "numeric" })}
                      {reminder.time ? ` · ${formatTime12(reminder.time)}` : ""}
                    </p>
                  </li>
                ))}
              </ul>
            )}
          </DashboardCard>

          <DashboardCard title="Customer feedback" subtitle="Latest 25 feedback entries">
            {feedbackQuery.isPending ? <Skeleton rows={4} /> : feedbackQuery.isError ? (
              <div role="alert"><p className="text-sm text-slate-700">Customer feedback could not be loaded.</p><Retry onClick={() => void feedbackQuery.refetch()} /></div>
            ) : feedback.length === 0 ? (
              <p className="py-6 text-center text-sm text-slate-500">No customer feedback yet.</p>
            ) : (
              <ul className="max-h-96 divide-y divide-slate-100 overflow-y-auto">
                {feedback.map((entry) => (
                  <li key={entry.id} className="flex flex-col gap-1 py-3 sm:flex-row sm:items-start sm:justify-between sm:gap-4">
                    <div className="min-w-0">
                      <p className="text-sm font-semibold text-slate-900">{entry.customer_name} · {entry.visit_type.replace(/_/g, " ")}</p>
                      <p className="mt-1 whitespace-pre-wrap text-sm text-slate-700">{entry.message}</p>
                    </div>
                    <span className="shrink-0 text-xs font-semibold text-slate-600" aria-label={`${entry.rating} out of 5 stars`}>
                      {entry.rating}/5 · {formatManilaDate(entry.created_at, { month: "short", day: "numeric" })}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </DashboardCard>
        </div>

        <aside className="min-w-0 min-[1100px]:sticky min-[1100px]:top-4 min-[1100px]:h-[calc(100dvh-3rem)] min-[1100px]:self-start">
          <section className="flex h-full min-h-[520px] flex-col overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm">
            <header className="flex shrink-0 items-center justify-between gap-3 border-b border-slate-100 px-5 py-4">
              <div>
                <h2 className="text-lg font-bold text-slate-950">Notifications</h2>
                <p className="text-sm text-slate-500">Updates</p>
              </div>
              <span className="rounded-full bg-amber-100 px-3 py-2 text-xs font-bold text-amber-900">
                {notificationsQuery.isError ? "—" : notificationsQuery.data?.total ?? "…"} pending
              </span>
            </header>

            <div className="min-h-0 flex-1 overflow-y-auto px-4">
              {notificationsQuery.isPending ? <div className="py-4"><Skeleton rows={4} /></div> : notificationsQuery.isError ? (
                <div className="py-8 text-center" role="alert">
                  <p className="text-sm font-semibold text-slate-800">Could not load notifications.</p>
                  <Retry onClick={() => void notificationsQuery.refetch()} />
                </div>
              ) : notifications.length === 0 ? (
                <div className="flex min-h-36 flex-col items-center justify-center py-8 text-center">
                  <Check className="h-7 w-7 text-emerald-700" aria-hidden="true" />
                  <p className="mt-2 text-sm font-semibold text-slate-900">You&apos;re all caught up</p>
                </div>
              ) : (
                <ul className="divide-y divide-slate-100">
                  {notifications.map((notification) => {
                    const actionable = canChangeBooking(notification.type, role);
                    return (
                      <li key={`${notification.type}-${notification.id}`} className="py-3">
                        <div className="flex items-start justify-between gap-2">
                          <div className="min-w-0">
                            <p className="break-words text-sm font-semibold text-slate-900">{notification.customerName}</p>
                            <p className="mt-1 text-xs capitalize text-slate-500">{notification.type} · {notification.reference}</p>
                            <p className="mt-1 text-xs text-slate-600">
                              {formatManilaDate(notification.date, { month: "short", day: "numeric" })}
                              {notification.time ? ` · ${formatTime12(notification.time)}` : ""}
                            </p>
                            {notification.details && <p className="mt-1 line-clamp-2 text-xs text-slate-600">{notification.details}</p>}
                          </div>
                          {actionable ? (
                            <div className="flex shrink-0 gap-1.5">
                              <button
                                type="button"
                                aria-label={`Approve ${notification.customerName} ${notification.type} booking`}
                                disabled={mutation.isPending}
                                onClick={() => mutation.mutate({ notification, status: "approved" })}
                                className="inline-flex h-9 w-9 items-center justify-center rounded-lg bg-[#a43930] text-white hover:bg-[#842920] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-800 disabled:opacity-50"
                              ><Check className="h-4 w-4" aria-hidden="true" /></button>
                              <button
                                type="button"
                                aria-label={`Decline ${notification.customerName} ${notification.type} booking`}
                                disabled={mutation.isPending}
                                onClick={() => mutation.mutate({ notification, status: "declined" })}
                                className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-slate-300 bg-white text-slate-800 hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-800 disabled:opacity-50"
                              ><X className="h-4 w-4" aria-hidden="true" /></button>
                            </div>
                          ) : (
                            <Link
                              to={notification.type === "catering" ? "/staff/catering" : "/staff/reservations"}
                              className="shrink-0 rounded-lg border border-slate-300 px-2 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-800"
                            >View</Link>
                          )}
                        </div>
                      </li>
                    );
                  })}
                </ul>
              )}
              {mutation.isError && (
                <p role="alert" className="my-3 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
                  {bookingActionError(mutation.error)}
                </p>
              )}
            </div>

            <div className="shrink-0 border-t border-slate-100 p-4">
              <div className="mb-3 flex items-center justify-between">
                <h3 className="font-bold text-slate-950">{monthLabel(month)}</h3>
                <div className="flex gap-1">
                  <button type="button" aria-label="Previous month" onClick={() => setMonth((current) => nextMonth(current, -1))} className="rounded-lg p-2 text-slate-700 hover:bg-slate-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-700">
                    <ChevronLeft className="h-4 w-4" aria-hidden="true" />
                  </button>
                  <button type="button" aria-label="Next month" onClick={() => setMonth((current) => nextMonth(current, 1))} className="rounded-lg p-2 text-slate-700 hover:bg-slate-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-700">
                    <ChevronRight className="h-4 w-4" aria-hidden="true" />
                  </button>
                </div>
              </div>
              {calendarQuery.isPending ? <Skeleton rows={2} /> : calendarQuery.isError ? (
                <div role="alert" className="text-sm text-slate-700">Calendar could not be loaded.<Retry onClick={() => void calendarQuery.refetch()} /></div>
              ) : (
                <div className="grid grid-cols-7 gap-1 text-center text-xs">
                  {["S", "M", "T", "W", "T", "F", "S"].map((label, index) => (
                    <span key={`${label}-${index}`} className="py-1 font-semibold text-slate-400">{label}</span>
                  ))}
                  {Array.from({ length: firstWeekday }, (_, index) => <span key={`blank-${index}`} aria-hidden="true" />)}
                  {Array.from({ length: daysInMonth }, (_, index) => {
                    const day = index + 1;
                    const key = `${month}-${String(day).padStart(2, "0")}`;
                    const isToday = key === today;
                    const hasBooking = approvedDates.has(key);
                    return (
                      <span
                        key={key}
                        aria-label={`${key}${isToday ? ", today" : ""}${hasBooking ? ", approved booking" : ""}`}
                        className={`relative inline-flex h-8 items-center justify-center rounded-md border text-slate-700 ${
                          isToday ? "border-[#a43930] bg-[#a43930] font-bold text-white" :
                          hasBooking ? "border-[#a43930] font-semibold text-slate-950" :
                          "border-transparent"
                        }`}
                      >
                        {day}
                        {hasBooking && !isToday && <span className="absolute bottom-0.5 h-1 w-1 rounded-full bg-[#a43930]" aria-hidden="true" />}
                      </span>
                    );
                  })}
                </div>
              )}
            </div>
          </section>
        </aside>
      </div>
    </main>
  );
}

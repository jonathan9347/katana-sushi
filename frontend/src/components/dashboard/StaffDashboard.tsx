import { useMemo, useState, type ReactNode } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { isAxiosError } from "axios";
import {
  Bell,
  CalendarDays,
  Check,
  ChevronLeft,
  ChevronRight,
  Clock3,
  Package,
  ReceiptText,
  X
} from "lucide-react";
import { Link } from "react-router-dom";
import { useAuth } from "../../hooks/useAuth";
import { formatManilaDate, formatTime12, todayManilaDateKey } from "../../lib/dateTime";
import { humanizeEnum, shortRef } from "../../lib/display";
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
    <section className={`admin-card min-w-0 ${className}`}>
      <div className="admin-card-heading">
        <div className="min-w-0">
          <h2 className="admin-card-title">{title}</h2>
          {subtitle && <p className="admin-card-subtitle">{subtitle}</p>}
        </div>
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

function getNotificationPath(notification: DashboardNotification) {
  if (notification.type === "catering") return "/staff/reservations?view=catering";
  return `/staff/reservations?view=${notification.type === "pickup" ? "pickup" : "tables"}`;
}

export default function StaffDashboard() {
  const { user } = useAuth();
  const role = user?.role ?? "staff";
  const canViewSales = ["admin", "cashier"].includes(role);
  const canViewInventory = ["admin", "inventory_manager", "chef"].includes(role);
  const canViewReservations = ["admin", "cashier", "receptionist", "event_coordinator", "chef"].includes(role);
  const canViewCatering = ["admin", "event_coordinator"].includes(role);
  const canViewReminders = ["admin", "cashier", "receptionist", "event_coordinator"].includes(role);
  const canViewFeedback = role === "admin";
  const canViewCalendar = ["admin", "cashier", "receptionist", "event_coordinator"].includes(role);
  const queryClient = useQueryClient();
  const [month, setMonth] = useState(() => todayManilaDateKey().slice(0, 7));
  const summaryQuery = useQuery({ queryKey: dashboardKeys.summary, queryFn: fetchDashboardSummary, ...refreshOptions });
  const salesQuery = useQuery({
    queryKey: dashboardKeys.sales,
    queryFn: fetchDashboardSales,
    enabled: canViewSales,
    ...refreshOptions
  });
  const inventoryQuery = useQuery({
    queryKey: dashboardKeys.inventory,
    queryFn: fetchDashboardInventory,
    enabled: canViewInventory,
    ...refreshOptions
  });
  const remindersQuery = useQuery({
    queryKey: dashboardKeys.reminders,
    queryFn: fetchDashboardReminders,
    enabled: canViewReminders,
    ...refreshOptions
  });
  const feedbackQuery = useQuery({
    queryKey: dashboardKeys.feedback,
    queryFn: fetchDashboardFeedback,
    enabled: canViewFeedback,
    ...refreshOptions
  });
  const notificationsQuery = useQuery({
    queryKey: dashboardKeys.notifications,
    queryFn: fetchDashboardNotifications,
    ...refreshOptions
  });
  const calendarQuery = useQuery({
    queryKey: dashboardKeys.calendar(month),
    queryFn: () => fetchDashboardCalendar(month),
    enabled: canViewCalendar,
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
  const displayRole = humanizeEnum(role).toUpperCase();
  const roleFocus = role === "event_coordinator"
    ? { title: "Upcoming catering events", value: summaryQuery.data?.upcomingEvents }
    : role === "inventory_manager" || role === "chef"
      ? { title: "Low stock alerts", value: summaryQuery.data?.lowStockCount }
      : { title: "Open requests", value: summaryQuery.data?.pendingApprovals };
  const updatedLabel = updatedAt
    ? new Intl.DateTimeFormat("en-PH", { hour: "numeric", minute: "2-digit", timeZone: "Asia/Manila" }).format(updatedAt)
    : "Loading";
  const todayDate = new Date(`${today}T12:00:00+08:00`);
  const todayLabel = new Intl.DateTimeFormat("en-PH", {
    weekday: "short", month: "short", day: "numeric", timeZone: "Asia/Manila"
  }).format(todayDate);

  return (
    <main className="admin-dashboard staff-dashboard">
      <div className="admin-dashboard-grid">
        <header className="admin-dashboard-header">
          <div className="min-w-0">
            <p className="admin-dashboard-eyebrow">Operations</p>
            <h1>Welcome back, {user?.name ?? "Team member"}</h1>
            <p className="admin-dashboard-subtitle" aria-live="polite">
              Here&apos;s what&apos;s happening at your store today.
            </p>
          </div>
          <div className="admin-dashboard-header-tools">
            <span className="admin-header-pill">{todayLabel} · Updated {updatedLabel}</span>
            <span className="admin-header-pill admin-header-pill-role">Role · {displayRole}</span>
          </div>
        </header>

        <section className="admin-card admin-dashboard-sales" aria-labelledby="staff-focus-title">
          <div className="admin-dashboard-sales-top">
            <p id="staff-focus-title" className="admin-dashboard-sales-label">
              {canViewSales ? "Today's sales" : "Today's focus"}
            </p>
            {canViewSales ? (
              summaryQuery.isPending ? (
                <div className="mt-3 h-12 w-48 animate-pulse rounded-lg bg-white/20" role="status" aria-label="Loading sales" />
              ) : summaryQuery.isError ? (
                <div role="alert" className="mt-3 text-sm">Sales are unavailable. <Retry onClick={() => void summaryQuery.refetch()} /></div>
              ) : (
                <p className="admin-dashboard-sales-amount">{money(summaryQuery.data.todaySales.total)}</p>
              )
            ) : (
              <>
                <p className="mt-2 text-sm font-semibold text-white/85">{roleFocus.title}</p>
                {summaryQuery.isPending ? (
                  <div className="mt-3 h-12 w-20 animate-pulse rounded-lg bg-white/20" role="status" aria-label="Loading dashboard summary" />
                ) : summaryQuery.isError ? (
                  <div role="alert" className="mt-3 text-sm">Dashboard summary is unavailable. <Retry onClick={() => void summaryQuery.refetch()} /></div>
                ) : (
                  <p className="admin-dashboard-sales-amount">{roleFocus.value ?? 0}</p>
                )}
              </>
            )}
          </div>
          {canViewSales && !summaryQuery.isPending && !summaryQuery.isError && (
            <div className="admin-dashboard-sales-bottom">
              <div className="admin-dashboard-sales-chips">
                <span className="admin-dashboard-sales-chip">{summaryQuery.data.todaySales.transactionCount} completed transactions</span>
                {summaryQuery.data.todaySales.transactionCount > 0 && (
                  <span className="admin-dashboard-sales-chip admin-dashboard-sales-chip-muted">
                    {money(String(Number(summaryQuery.data.todaySales.total) / summaryQuery.data.todaySales.transactionCount))} avg. sale
                  </span>
                )}
              </div>
              {summaryQuery.data.todaySales.series.length > 0 && (
                <svg className="admin-sales-wave" viewBox="0 0 600 90" preserveAspectRatio="none" aria-hidden="true">
                  <path d={salesSparkline(summaryQuery.data.todaySales.series.map((item) => Number(item.total)))} fill="none" stroke="white" strokeWidth="2.5" vectorEffect="non-scaling-stroke" />
                </svg>
              )}
            </div>
          )}
        </section>

        <section className="admin-card admin-dashboard-quick-stats" aria-label="Quick stats">
          {canViewReservations && (
            <Link to={role === "event_coordinator" ? "/staff/reservations?view=catering" : "/staff/reservations"} className="admin-quick-stat">
              <span className="admin-quick-stat-icon"><Clock3 aria-hidden="true" size={16} /></span>
              <span className="admin-quick-stat-copy">
                <span className="admin-quick-stat-value">{summaryQuery.isError ? "—" : summaryQuery.data?.pendingApprovals ?? "…"}</span>
                <span className="admin-quick-stat-label">Pending approvals</span>
              </span>
              <ChevronRight aria-hidden="true" className="admin-quick-stat-chevron" />
            </Link>
          )}
          {canViewInventory && (
            <Link to={role === "chef" ? "/staff/inventory/read-only" : "/staff/inventory"} className="admin-quick-stat">
              <span className="admin-quick-stat-icon is-amber"><Package aria-hidden="true" size={16} /></span>
              <span className="admin-quick-stat-copy">
                <span className="admin-quick-stat-value">{summaryQuery.isError ? "—" : summaryQuery.data?.lowStockCount ?? "…"}</span>
                <span className="admin-quick-stat-label">Low stock alerts</span>
              </span>
              <ChevronRight aria-hidden="true" className="admin-quick-stat-chevron" />
            </Link>
          )}
          {canViewCatering && (
            <Link to="/staff/reservations?view=catering" className="admin-quick-stat">
              <span className="admin-quick-stat-icon is-green"><CalendarDays aria-hidden="true" size={16} /></span>
              <span className="admin-quick-stat-copy">
                <span className="admin-quick-stat-value">{summaryQuery.isError ? "—" : summaryQuery.data?.upcomingEvents ?? "…"}</span>
                <span className="admin-quick-stat-label">Upcoming events</span>
              </span>
              <ChevronRight aria-hidden="true" className="admin-quick-stat-chevron" />
            </Link>
          )}
        </section>

        <section className="admin-card admin-dashboard-notifications" aria-labelledby="staff-notifications-title">
          <div className="admin-card-heading">
            <div className="admin-card-heading-main">
              <span className="admin-card-heading-icon" aria-hidden="true"><Bell size={15} /></span>
              <div>
                <h2 id="staff-notifications-title" className="admin-card-title">Notifications</h2>
                <p className="admin-card-subtitle">Updates that need your attention</p>
              </div>
            </div>
            <span className={`admin-notification-count ${notificationsQuery.data?.total ? "is-pending" : "is-clear"}`}>
              {notificationsQuery.isError ? "—" : `${notificationsQuery.data?.total ?? "…"} pending`}
            </span>
          </div>
          {notificationsQuery.isPending ? <Skeleton rows={2} /> : notificationsQuery.isError ? (
            <div className="admin-dashboard-error" role="alert">
              Could not load notifications. <Retry onClick={() => void notificationsQuery.refetch()} />
            </div>
          ) : notifications.length === 0 ? (
            <div className="admin-notifications-empty">
              <span className="admin-notifications-empty-icon"><Check aria-hidden="true" size={16} /></span>
              <span>You&apos;re all caught up.</span>
            </div>
          ) : (
            <ul className="staff-notification-list">
              {notifications.map((notification) => {
                const actionable = canChangeBooking(notification.type, role);
                return (
                  <li key={`${notification.type}-${notification.id}`} className="staff-notification-item">
                    <div className="min-w-0">
                      <p className="staff-notification-name">{notification.customerName}</p>
                      <p className="staff-notification-meta">{humanizeEnum(notification.type)} · {shortRef(notification.reference)}</p>
                      <p className="staff-notification-meta">
                        {formatManilaDate(notification.date, { month: "short", day: "numeric" })}
                        {notification.time ? ` · ${formatTime12(notification.time)}` : ""}
                      </p>
                      {notification.details && <p className="staff-notification-meta">{notification.details}</p>}
                    </div>
                    {actionable ? (
                      <div className="staff-notification-actions">
                        <button
                          type="button"
                          aria-label={`Approve ${notification.customerName} ${notification.type} booking`}
                          disabled={mutation.isPending}
                          onClick={() => mutation.mutate({ notification, status: "approved" })}
                          className="admin-icon-button staff-notification-approve"
                        ><Check aria-hidden="true" size={15} /></button>
                        <button
                          type="button"
                          aria-label={`Decline ${notification.customerName} ${notification.type} booking`}
                          disabled={mutation.isPending}
                          onClick={() => mutation.mutate({ notification, status: "declined" })}
                          className="admin-icon-button staff-notification-decline"
                        ><X aria-hidden="true" size={15} /></button>
                      </div>
                    ) : (
                      <Link to={getNotificationPath(notification)} className="admin-button admin-button-secondary">View</Link>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
          {mutation.isError && (
            <p role="alert" className="admin-dashboard-error">{bookingActionError(mutation.error)}</p>
          )}
        </section>

        {canViewSales && (
          <DashboardCard title="Recent sales" subtitle="Latest completed transactions" className="admin-dashboard-recent">
            {salesQuery.isPending ? <Skeleton rows={3} /> : salesQuery.isError ? (
              <div role="alert" className="admin-dashboard-error">Sales could not be loaded. <Retry onClick={() => void salesQuery.refetch()} /></div>
            ) : latestSales.length === 0 ? (
              <div className="admin-empty-state">
                <span className="admin-empty-icon"><ReceiptText aria-hidden="true" /></span>
                <strong>No completed sales yet</strong>
                <p>Completed transactions will appear here.</p>
              </div>
            ) : (
              <ul className="admin-sales-list">
                {latestSales.map((sale) => (
                  <li key={sale.id}>
                    <span className="admin-sale-icon"><ReceiptText aria-hidden="true" size={13} /></span>
                    <span className="admin-sale-order">#{sale.orderNumber}</span>
                    <span className="admin-sale-total">{money(sale.total)}</span>
                  </li>
                ))}
              </ul>
            )}
          </DashboardCard>
        )}

        {canViewInventory && (
          <DashboardCard title="Inventory alerts" subtitle="Lowest available stock · below par level" className="admin-dashboard-inventory">
            {inventoryQuery.isPending ? <Skeleton rows={3} /> : inventoryQuery.isError ? (
              <div role="alert" className="admin-dashboard-error">Inventory alerts could not be loaded. <Retry onClick={() => void inventoryQuery.refetch()} /></div>
            ) : alerts.length === 0 ? (
              <div className="admin-empty-state">
                <span className="admin-empty-icon"><Package aria-hidden="true" /></span>
                <strong>Stock levels look good</strong>
                <p>Low-stock materials will appear here.</p>
              </div>
            ) : (
              <ul className="admin-inventory-list">
                {alerts.map((item) => (
                  <li key={item.id}>
                    <span className="admin-inventory-name">{item.name}</span>
                    <span className="admin-inventory-quantity">{item.quantityLeft} {item.unit} left</span>
                    <span className="admin-critical-badge">Critical</span>
                  </li>
                ))}
              </ul>
            )}
          </DashboardCard>
        )}

        {canViewCalendar && (
          <section className="admin-card admin-dashboard-calendar" aria-labelledby="staff-calendar-title">
            <div className="admin-calendar-month">
              <h2 id="staff-calendar-title">{monthLabel(month)}</h2>
              <div className="admin-calendar-controls">
                <button type="button" className="admin-icon-button" aria-label="Previous month" onClick={() => setMonth((current) => nextMonth(current, -1))}>
                  <ChevronLeft aria-hidden="true" />
                </button>
                <button type="button" className="admin-icon-button" aria-label="Next month" onClick={() => setMonth((current) => nextMonth(current, 1))}>
                  <ChevronRight aria-hidden="true" />
                </button>
              </div>
            </div>
            {calendarQuery.isPending ? <Skeleton rows={2} /> : calendarQuery.isError ? (
              <div role="alert" className="admin-dashboard-error">Calendar could not be loaded. <Retry onClick={() => void calendarQuery.refetch()} /></div>
            ) : (
              <>
                <div className="admin-calendar-grid" role="group" aria-label={monthLabel(month)}>
                  {["S", "M", "T", "W", "T", "F", "S"].map((label, index) => (
                    <span key={`${label}-${index}`} className="admin-calendar-weekday">{label}</span>
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
                        className={`admin-calendar-day${isToday ? " is-today" : ""}${hasBooking ? " has-booking" : ""}`}
                      >
                        {day}
                      </span>
                    );
                  })}
                </div>
                <div className="admin-calendar-legend">
                  <span className="admin-legend-dot">Today</span>
                  <span className="admin-legend-dot is-booking">Has booking</span>
                </div>
              </>
            )}
          </section>
        )}

        {canViewReminders && (
          <DashboardCard title="Reminders" subtitle="Approved bookings and events in the next 7 days" className="admin-dashboard-reminders">
            {remindersQuery.isPending ? <Skeleton rows={3} /> : remindersQuery.isError ? (
              <div role="alert" className="admin-dashboard-error">Reminders could not be loaded. <Retry onClick={() => void remindersQuery.refetch()} /></div>
            ) : reminders.length === 0 ? (
              <div className="admin-empty-state">
                <span className="admin-empty-icon"><CalendarDays aria-hidden="true" /></span>
                <strong>No upcoming reminders</strong>
                <p>You&apos;re all caught up for the next 7 days.</p>
              </div>
            ) : (
              <ul className="admin-reminder-list">
                {reminders.map((reminder) => (
                  <li key={`${reminder.type}-${reminder.id}`}>
                    <div className="admin-reminder-row">
                      <div className="min-w-0">
                        <p className="admin-reminder-name">{reminder.customerName} · {reminder.details}</p>
                        <p className="admin-reminder-meta">{reminder.type === "table" ? "Table booking" : "Catering event"} · {shortRef(reminder.reference)}</p>
                      </div>
                      <p className="admin-reminder-meta shrink-0">
                        <Clock3 aria-hidden="true" className="mr-1 inline" size={12} />
                        {formatManilaDate(reminder.date, { month: "short", day: "numeric" })}
                        {reminder.time ? ` · ${formatTime12(reminder.time)}` : ""}
                      </p>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </DashboardCard>
        )}
      </div>
    </main>
  );
}

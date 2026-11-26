import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { isAxiosError } from "axios";
import {
  Bell,
  CalendarDays,
  Check,
  CheckCheck,
  ChevronLeft,
  ChevronRight,
  ChevronsRight,
  Clock3,
  ExternalLink,
  LoaderCircle,
  MessageCircle,
  Package,
  ReceiptText,
  Settings,
  UsersRound
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
import DashboardNotificationsModal, {
  notificationKey,
  type NotificationReviewItem
} from "./DashboardNotificationsModal";
import "./AdminDashboard.css";

const refreshOptions = {
  refetchInterval: 60_000,
  refetchOnWindowFocus: true
} as const;

type DashboardToast = {
  message: string;
  type: "success" | "error";
  onUndo?: () => void;
};

type MutationContext = {
  notifications?: Awaited<ReturnType<typeof fetchDashboardNotifications>>;
  summary?: Awaited<ReturnType<typeof fetchDashboardSummary>>;
};

function money(value: string | number) {
  return new Intl.NumberFormat("en-PH", { style: "currency", currency: "PHP" }).format(Number(value));
}

function Skeleton({ rows = 2 }: { rows?: number }) {
  return (
    <div className="animate-pulse space-y-3" role="status" aria-label="Loading dashboard data">
      {Array.from({ length: rows }, (_, index) => (
        <div key={index} className="h-8 rounded-lg bg-slate-100" />
      ))}
    </div>
  );
}

function Retry({ onClick }: { onClick: () => void }) {
  return <button type="button" className="admin-dashboard-retry" onClick={onClick}>Try again</button>;
}

function CardHeading({
  title,
  subtitle,
  icon,
  action,
  titleId
}: {
  title: string;
  subtitle?: string;
  icon: ReactNode;
  action?: ReactNode;
  titleId?: string;
}) {
  return (
    <div className="admin-card-heading">
      <div className="admin-card-heading-main">
        <span className="admin-card-heading-icon" aria-hidden="true">{icon}</span>
        <div className="min-w-0">
          <h2 id={titleId} className="admin-card-title">{title}</h2>
          {subtitle && <p className="admin-card-subtitle">{subtitle}</p>}
        </div>
      </div>
      {action}
    </div>
  );
}

function monthLabel(month: string) {
  const [year, monthNumber] = month.split("-").map(Number);
  return new Intl.DateTimeFormat("en", { month: "long", year: "numeric", timeZone: "UTC" })
    .format(new Date(Date.UTC(year, monthNumber - 1, 1)));
}

function shiftMonth(month: string, delta: number) {
  const [year, monthNumber] = month.split("-").map(Number);
  const date = new Date(Date.UTC(year, monthNumber - 1 + delta, 1));
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
}

function salesSparkline(values: number[]) {
  const width = 600;
  const height = 72;
  const maximum = Math.max(...values, 1);
  return values.map((value, index) => {
    const x = values.length < 2 ? width / 2 : (index / (values.length - 1)) * width;
    const y = height - (value / maximum) * (height - 12) - 6;
    return `${index === 0 ? "M" : "L"}${x.toFixed(1)},${y.toFixed(1)}`;
  }).join(" ");
}

function actionError(error: unknown) {
  if (isAxiosError<{ message?: string }>(error)) {
    return error.response?.data?.message ?? "The request could not be updated. Please try again.";
  }
  return error instanceof Error ? error.message : "The request could not be updated. Please try again.";
}

function sortNewest(items: DashboardNotification[]) {
  return [...items].sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
}

export default function AdminDashboard() {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const [month, setMonth] = useState(() => todayManilaDateKey().slice(0, 7));
  const [notificationsOpen, setNotificationsOpen] = useState(false);
  const [resolvedNotifications, setResolvedNotifications] = useState<Record<string, NotificationReviewItem>>({});
  const [toast, setToast] = useState<DashboardToast | null>(null);
  const toastTimer = useRef<number | null>(null);
  const closeNotifications = useCallback(() => setNotificationsOpen(false), []);

  const showToast = useCallback((nextToast: DashboardToast) => {
    if (toastTimer.current !== null) window.clearTimeout(toastTimer.current);
    setToast(nextToast);
    toastTimer.current = window.setTimeout(() => setToast(null), 3000);
  }, []);

  useEffect(() => () => {
    if (toastTimer.current !== null) window.clearTimeout(toastTimer.current);
  }, []);

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

  const mutation = useMutation<void, unknown, {
    notification: DashboardNotification;
    status: "approved" | "declined";
  }, MutationContext>({
    mutationFn: ({ notification, status }) => updateDashboardBooking(notification, status),
    onMutate: async ({ notification, status }) => {
      await Promise.all([
        queryClient.cancelQueries({ queryKey: dashboardKeys.notifications }),
        queryClient.cancelQueries({ queryKey: dashboardKeys.summary })
      ]);
      const previousNotifications = queryClient.getQueryData<Awaited<ReturnType<typeof fetchDashboardNotifications>>>(dashboardKeys.notifications);
      const previousSummary = queryClient.getQueryData<Awaited<ReturnType<typeof fetchDashboardSummary>>>(dashboardKeys.summary);
      const key = notificationKey(notification);
      setResolvedNotifications((current) => ({
        ...current,
        [key]: { notification, status }
      }));
      queryClient.setQueryData<Awaited<ReturnType<typeof fetchDashboardNotifications>>>(dashboardKeys.notifications, (current) =>
        current ? {
          ...current,
          total: Math.max(current.total - 1, 0),
          notifications: current.notifications.filter((item) => notificationKey(item) !== key)
        } : current
      );
      if (previousSummary) {
        queryClient.setQueryData(dashboardKeys.summary, {
          ...previousSummary,
          pendingApprovals: Math.max(previousSummary.pendingApprovals - 1, 0)
        });
      }
      return { notifications: previousNotifications, summary: previousSummary };
    },
    onError: (error, { notification }, context) => {
      const key = notificationKey(notification);
      setResolvedNotifications((current) => {
        const next = { ...current };
        delete next[key];
        return next;
      });
      if (context?.notifications) queryClient.setQueryData(dashboardKeys.notifications, context.notifications);
      if (context?.summary) queryClient.setQueryData(dashboardKeys.summary, context.summary);
      showToast({ message: actionError(error), type: "error" });
    },
    onSuccess: (_result, { notification, status }) => {
      const key = notificationKey(notification);
      showToast({
        message: status === "approved" ? "Request approved" : "Request declined",
        type: "success",
        onUndo: () => {
          setResolvedNotifications((current) => {
            const next = { ...current };
            delete next[key];
            return next;
          });
          queryClient.setQueryData<Awaited<ReturnType<typeof fetchDashboardNotifications>>>(
            dashboardKeys.notifications,
            (current) => {
              const existing = current ?? { total: 0, notifications: [] };
              if (existing.notifications.some((item) => notificationKey(item) === key)) return existing;
              return {
                total: existing.total + 1,
                notifications: sortNewest([...existing.notifications, notification])
              };
            }
          );
          queryClient.setQueryData<Awaited<ReturnType<typeof fetchDashboardSummary>>>(dashboardKeys.summary, (current) =>
            current ? { ...current, pendingApprovals: current.pendingApprovals + 1 } : current
          );
          if (toastTimer.current !== null) window.clearTimeout(toastTimer.current);
          setToast(null);
        }
      });
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
  const [calendarYear, calendarMonth] = month.split("-").map(Number);
  const daysInMonth = new Date(Date.UTC(calendarYear, calendarMonth, 0)).getUTCDate();
  const firstWeekday = new Date(Date.UTC(calendarYear, calendarMonth - 1, 1)).getUTCDay();
  const sales = salesQuery.data ?? [];
  const alerts = inventoryQuery.data?.items ?? [];
  const reminders = remindersQuery.data ?? [];
  const feedback = feedbackQuery.data ?? [];
  const pendingNotifications = notificationsQuery.data?.notifications ?? [];
  const notificationCount = notificationsQuery.data?.total ?? 0;
  const resolvedItems = Object.values(resolvedNotifications);
  const modalItems = useMemo(() => {
    const resolvedKeys = new Set(resolvedItems.map((item) => notificationKey(item.notification)));
    const currentPending = pendingNotifications
      .filter((item) => !resolvedKeys.has(notificationKey(item)))
      .map((notification) => ({ notification, status: "pending" as const }));
    return [...currentPending, ...resolvedItems].sort((a, b) =>
      new Date(b.notification.createdAt).getTime() - new Date(a.notification.createdAt).getTime()
    );
  }, [pendingNotifications, resolvedItems]);
  const calendarBookings = new Set(calendarQuery.data ?? []);
  const displayName = user?.name ?? "Administrator";
  const displayRole = (user?.role ?? "admin").replace(/_/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
  const todayDate = new Date(`${today}T12:00:00+08:00`);
  const updatedLabel = updatedAt
    ? new Intl.DateTimeFormat("en-PH", { hour: "numeric", minute: "2-digit", timeZone: "Asia/Manila" }).format(updatedAt)
    : "Loading";
  const todayLabel = new Intl.DateTimeFormat("en-PH", { weekday: "short", month: "short", day: "numeric", timeZone: "Asia/Manila" }).format(todayDate);
  const firstNotification = pendingNotifications[0];
  const pendingActionKey = mutation.isPending && mutation.variables
    ? `${notificationKey(mutation.variables.notification)}:${mutation.variables.status}`
    : null;

  function performAction(notification: DashboardNotification, status: "approved" | "declined") {
    mutation.mutate({ notification, status });
  }

  return (
    <main className="admin-dashboard">
      <div className="admin-dashboard-grid">
        <header className="admin-dashboard-header">
          <div className="min-w-0">
            <p className="admin-dashboard-eyebrow">Operations</p>
            <h1>Welcome back, {displayName}</h1>
            <p className="admin-dashboard-subtitle">Here&apos;s what&apos;s happening at your store today.</p>
          </div>
          <div className="admin-dashboard-header-tools">
            <span className="admin-header-pill">{todayLabel} · Updated {updatedLabel}</span>
            <span className="admin-header-pill admin-header-pill-role">Role · {displayRole}</span>
            <Link to="/staff/settings" className="admin-settings-link"><Settings aria-hidden="true" size={14} /> Settings</Link>
          </div>
        </header>

        <section className="admin-card admin-dashboard-sales" aria-labelledby="admin-sales-title">
          <div className="admin-dashboard-sales-top">
            <p id="admin-sales-title" className="admin-dashboard-sales-label"><ReceiptText aria-hidden="true" size={14} /> Today&apos;s sales</p>
            {summaryQuery.isPending ? (
              <div className="mt-4 h-12 w-48 animate-pulse rounded-lg bg-white/20" role="status" aria-label="Loading sales" />
            ) : summaryQuery.isError ? (
              <div role="alert" className="mt-3 text-sm">Sales are unavailable. <Retry onClick={() => void summaryQuery.refetch()} /></div>
            ) : (
              <p className="admin-dashboard-sales-amount">{money(summaryQuery.data.todaySales.total)}</p>
            )}
          </div>
          {!summaryQuery.isPending && !summaryQuery.isError && (
            <div className="admin-dashboard-sales-bottom">
              <div className="admin-dashboard-sales-chips">
                <span className="admin-dashboard-sales-chip">{summaryQuery.data.todaySales.transactionCount} completed transactions</span>
                {summaryQuery.data.todaySales.transactionCount > 0 && (
                  <span className="admin-dashboard-sales-chip admin-dashboard-sales-chip-muted">
                    {money(Number(summaryQuery.data.todaySales.total) / summaryQuery.data.todaySales.transactionCount)} avg. sale
                  </span>
                )}
              </div>
              {summaryQuery.data.todaySales.series.length > 0 && (
                <svg className="admin-sales-wave" viewBox="0 0 600 72" preserveAspectRatio="none" aria-hidden="true">
                  <path d={salesSparkline(summaryQuery.data.todaySales.series.map((item) => Number(item.total)))} fill="none" stroke="white" strokeWidth="2.5" vectorEffect="non-scaling-stroke" />
                </svg>
              )}
            </div>
          )}
        </section>

        <section className="admin-card admin-dashboard-quick-stats" aria-label="Quick stats">
          <button type="button" className="admin-quick-stat" onClick={() => setNotificationsOpen(true)}>
            <span className="admin-quick-stat-icon"><Clock3 aria-hidden="true" size={16} /></span>
            <span className="admin-quick-stat-copy">
              <span className="admin-quick-stat-value">
                {notificationsQuery.isPending ? "…" : notificationsQuery.isError ? "—" : notificationCount}
              </span>
              <span className="admin-quick-stat-label">Pending approvals</span>
            </span>
            <ChevronRight aria-hidden="true" className="admin-quick-stat-chevron" />
          </button>
          <Link to="/staff/inventory" className="admin-quick-stat">
            <span className="admin-quick-stat-icon is-amber"><Package aria-hidden="true" size={16} /></span>
            <span className="admin-quick-stat-copy">
              <span className="admin-quick-stat-value">{inventoryQuery.isError ? "—" : inventoryQuery.data?.total ?? "…"}</span>
              <span className="admin-quick-stat-label">Low stock alerts</span>
            </span>
            <ChevronRight aria-hidden="true" className="admin-quick-stat-chevron" />
          </Link>
          <Link to="/staff/reservations?view=catering" className="admin-quick-stat">
            <span className="admin-quick-stat-icon is-green"><CalendarDays aria-hidden="true" size={16} /></span>
            <span className="admin-quick-stat-copy">
              <span className="admin-quick-stat-value">{summaryQuery.isError ? "—" : summaryQuery.data?.upcomingEvents ?? "…"}</span>
              <span className="admin-quick-stat-label">Upcoming events</span>
            </span>
            <ChevronRight aria-hidden="true" className="admin-quick-stat-chevron" />
          </Link>
        </section>

        <section className="admin-card admin-dashboard-notifications" aria-labelledby="admin-notifications-title">
          <div className="admin-card-heading">
            <div className="admin-card-heading-main">
              <span className="admin-card-heading-icon" aria-hidden="true"><Bell size={15} /></span>
              <div>
                <h2 id="admin-notifications-title" className="admin-card-title">Notifications</h2>
                <p className="admin-card-subtitle">Updates that need your attention</p>
              </div>
            </div>
            <button
              type="button"
              onClick={() => setNotificationsOpen(true)}
              className={`admin-notification-count ${
                notificationsQuery.isPending || notificationsQuery.isError
                  ? "is-loading"
                  : notificationCount > 0 ? "is-pending" : "is-clear"
              }`}
            >
              {notificationsQuery.isPending
                ? "Loading…"
                : notificationsQuery.isError
                  ? "Unavailable"
                  : notificationCount > 0 ? `${notificationCount} pending` : "All clear"}
            </button>
          </div>
          {notificationsQuery.isPending ? <Skeleton rows={2} /> : notificationsQuery.isError ? (
            <div role="alert" className="admin-dashboard-error">Notifications could not be loaded. <Retry onClick={() => void notificationsQuery.refetch()} /></div>
          ) : firstNotification ? (
            <>
              <div className="admin-notification-preview">
                <span className="admin-notification-preview-icon"><UsersRound aria-hidden="true" size={15} /></span>
                <div className="min-w-0">
                  <button type="button" className="admin-notification-preview-text" onClick={() => setNotificationsOpen(true)}>
                    <span className="admin-notification-preview-name block">{firstNotification.customerName}</span>
                    <span className="admin-notification-preview-type block">{firstNotification.type} · {firstNotification.reference}</span>
                    <span className="admin-notification-preview-meta block">
                      {formatManilaDate(firstNotification.date, { month: "short", day: "numeric" })}
                      {firstNotification.time ? ` · ${formatTime12(firstNotification.time)}` : ""}
                      {firstNotification.details ? ` · ${firstNotification.details}` : ""}
                    </span>
                  </button>
                  <div className="admin-notification-preview-actions">
                    <button
                      type="button"
                      className="admin-button admin-button-primary"
                      disabled={mutation.isPending}
                      onClick={() => performAction(firstNotification, "approved")}
                    >
                      {pendingActionKey === `${notificationKey(firstNotification)}:approved`
                        ? <LoaderCircle aria-hidden="true" className="admin-button-spinner" />
                        : <Check aria-hidden="true" size={13} />}
                      Approve
                    </button>
                    <button
                      type="button"
                      className="admin-button admin-button-secondary"
                      disabled={mutation.isPending}
                      onClick={() => performAction(firstNotification, "declined")}
                    >
                      {pendingActionKey === `${notificationKey(firstNotification)}:declined`
                        ? <LoaderCircle aria-hidden="true" className="admin-button-spinner" />
                        : null}
                      Decline
                    </button>
                  </div>
                </div>
              </div>
              <button type="button" className="admin-notifications-view-all" onClick={() => setNotificationsOpen(true)}>
                View all notifications <ChevronsRight aria-hidden="true" size={13} />
              </button>
            </>
          ) : (
            <button type="button" className="admin-notifications-empty" onClick={() => setNotificationsOpen(true)}>
              <span className="admin-notifications-empty-icon"><CheckCheck aria-hidden="true" size={16} /></span>
              <span>All clear. No requests need your attention.</span>
            </button>
          )}
        </section>

        <section className="admin-card admin-dashboard-recent" aria-labelledby="admin-recent-sales-title">
          <CardHeading
            title="Recent sales"
            subtitle="Latest completed transactions"
            icon={<ReceiptText size={15} />}
            titleId="admin-recent-sales-title"
            action={<Link to="/staff/pos/history" className="admin-card-link">View all <ExternalLink aria-hidden="true" size={11} /></Link>}
          />
          {salesQuery.isPending ? <Skeleton rows={3} /> : salesQuery.isError ? (
            <div role="alert" className="admin-dashboard-error">Sales could not be loaded. <Retry onClick={() => void salesQuery.refetch()} /></div>
          ) : sales.length === 0 ? (
            <div className="admin-empty-state">
              <span className="admin-empty-icon"><ReceiptText aria-hidden="true" /></span>
              <strong>No completed sales yet</strong>
              <p>Completed transactions will appear here.</p>
            </div>
          ) : (
            <ul className="admin-sales-list" aria-labelledby="admin-recent-sales-title">
              {sales.map((sale) => (
                <li key={sale.id}>
                  <span className="admin-sale-icon"><ReceiptText aria-hidden="true" size={13} /></span>
                  <span className="admin-sale-order">#{sale.orderNumber}</span>
                  <span className="admin-sale-total">{money(sale.total)}</span>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="admin-card admin-dashboard-inventory" aria-labelledby="admin-inventory-title">
          <CardHeading
            title="Inventory alerts"
            subtitle="Lowest available stock · below par level"
            icon={<Package size={15} />}
            titleId="admin-inventory-title"
            action={<Link to="/staff/inventory" className="admin-card-link">View all {inventoryQuery.data?.total ?? 0} <ExternalLink aria-hidden="true" size={11} /></Link>}
          />
          {inventoryQuery.isPending ? <Skeleton rows={4} /> : inventoryQuery.isError ? (
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
        </section>

        <section className="admin-card admin-dashboard-calendar" aria-labelledby="admin-calendar-title">
          <div className="admin-calendar-month">
            <h2 id="admin-calendar-title">{monthLabel(month)}</h2>
            <div className="admin-calendar-controls">
              <button type="button" className="admin-icon-button" aria-label="Previous month" onClick={() => setMonth((current) => shiftMonth(current, -1))}>
                <ChevronLeft aria-hidden="true" />
              </button>
              <button type="button" className="admin-icon-button" aria-label="Next month" onClick={() => setMonth((current) => shiftMonth(current, 1))}>
                <ChevronRight aria-hidden="true" />
              </button>
            </div>
          </div>
          {calendarQuery.isPending ? <Skeleton rows={3} /> : calendarQuery.isError ? (
            <div role="alert" className="admin-dashboard-error">Calendar could not be loaded. <Retry onClick={() => void calendarQuery.refetch()} /></div>
          ) : (
            <>
              <div className="admin-calendar-grid" role="group" aria-label={monthLabel(month)}>
                {["S", "M", "T", "W", "T", "F", "S"].map((day, index) => (
                  <span key={`${day}-${index}`} className="admin-calendar-weekday">{day}</span>
                ))}
                {Array.from({ length: firstWeekday }, (_, index) => <span key={`blank-${index}`} aria-hidden="true" />)}
                {Array.from({ length: daysInMonth }, (_, index) => {
                  const day = index + 1;
                  const dateKey = `${month}-${String(day).padStart(2, "0")}`;
                  const isToday = dateKey === today;
                  const hasBooking = calendarBookings.has(dateKey);
                  return (
                    <span
                      key={dateKey}
                      aria-label={`${dateKey}${isToday ? ", today" : ""}${hasBooking ? ", has booking" : ""}`}
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

        <section className="admin-card admin-dashboard-reminders" aria-labelledby="admin-reminders-title">
          <CardHeading
            title="Reminders"
            subtitle="Approved bookings and events in the next 7 days"
            icon={<CheckCheck size={15} />}
            titleId="admin-reminders-title"
          />
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
                      <p className="admin-reminder-name">{reminder.customerName} · {reminder.details || reminder.reference}</p>
                      <p className="admin-reminder-meta">{reminder.type === "table" ? "Table booking" : "Catering event"} · {reminder.reference}</p>
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
        </section>

        <section className="admin-card admin-dashboard-feedback" aria-labelledby="admin-feedback-title">
          <CardHeading title="Customer feedback" subtitle="Latest 25 feedback entries" icon={<MessageCircle size={15} />} titleId="admin-feedback-title" />
          {feedbackQuery.isPending ? <Skeleton rows={3} /> : feedbackQuery.isError ? (
            <div role="alert" className="admin-dashboard-error">Customer feedback could not be loaded. <Retry onClick={() => void feedbackQuery.refetch()} /></div>
          ) : feedback.length === 0 ? (
            <div className="admin-empty-state">
              <span className="admin-empty-icon"><MessageCircle aria-hidden="true" /></span>
              <strong>No customer feedback yet</strong>
              <p>New reviews will appear here.</p>
            </div>
          ) : (
            <ul className="admin-feedback-list">
              {feedback.map((entry) => (
                <li key={entry.id}>
                  <div className="admin-feedback-row">
                    <div className="min-w-0">
                      <p className="admin-feedback-name">{entry.customer_name} · {entry.visit_type.replace(/_/g, " ")}</p>
                      <p className="admin-feedback-message">{entry.message}</p>
                    </div>
                    <span className="admin-rating" aria-label={`${entry.rating} out of 5 stars`}>
                      {entry.rating}/5 · {formatManilaDate(entry.created_at, { month: "short", day: "numeric" })}
                    </span>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>

      <DashboardNotificationsModal
        open={notificationsOpen}
        items={modalItems}
        pendingActionKey={pendingActionKey}
        onAction={performAction}
        onClose={closeNotifications}
      />

      {toast && (
        <div role="status" className={`admin-dashboard-toast${toast.type === "error" ? " is-error" : ""}`}>
          <span>{toast.message}</span>
          {toast.onUndo && <button type="button" className="admin-toast-undo" onClick={toast.onUndo}>Undo</button>}
        </div>
      )}
    </main>
  );
}

import { api } from "./api";

export type DashboardSummary = {
  todaySales: {
    total: string;
    transactionCount: number;
    series: Array<{ hour: number; total: string }>;
  };
  pendingApprovals: number;
  lowStockCount: number;
  upcomingEvents: number;
};

export type DashboardSale = {
  id: string;
  orderNumber: string;
  total: string;
  completedAt: string;
};

export type DashboardInventoryAlert = {
  id: string;
  name: string;
  unit: string;
  quantityLeft: number;
  parLevel: number;
  severity: "critical" | "reorder";
  percentOfPar: number;
};

export type DashboardReminder = {
  id: string;
  type: "table" | "catering";
  reference: string;
  customerName: string;
  date: string;
  time: string | null;
  details: string;
};

export type DashboardFeedback = {
  id: string;
  feedback_id: string;
  customer_name: string;
  visit_type: string;
  rating: number;
  message: string;
  created_at: string;
};

export type DashboardNotification = {
  id: string;
  type: "table" | "catering" | "pickup";
  reference: string;
  customerName: string;
  date: string;
  time: string | null;
  status: string;
  details: string;
  createdAt: string;
};

export const dashboardKeys = {
  summary: ["staff-dashboard", "summary"] as const,
  sales: ["staff-dashboard", "recent-sales"] as const,
  inventory: ["staff-dashboard", "inventory-alerts"] as const,
  reminders: ["staff-dashboard", "reminders"] as const,
  feedback: ["staff-dashboard", "feedback"] as const,
  notifications: ["staff-dashboard", "notifications"] as const,
  calendar: (month: string) => ["staff-dashboard", "calendar", month] as const
};

export async function fetchDashboardSummary() {
  return (await api.get<DashboardSummary>("/api/staff/dashboard/summary")).data;
}

export async function fetchDashboardSales() {
  return (await api.get<{ sales: DashboardSale[] }>("/api/staff/dashboard/recent-sales", { params: { limit: 3 } })).data.sales;
}

export async function fetchDashboardInventory() {
  return (await api.get<{ total: number; items: DashboardInventoryAlert[] }>("/api/staff/dashboard/inventory-alerts", { params: { limit: 4 } })).data;
}

export async function fetchDashboardReminders() {
  return (await api.get<{ reminders: DashboardReminder[] }>("/api/staff/dashboard/reminders", { params: { days: 7, limit: 50 } })).data.reminders;
}

export async function fetchDashboardFeedback() {
  return (await api.get<{ feedback: DashboardFeedback[] }>("/api/staff/dashboard/feedback", { params: { limit: 25 } })).data.feedback;
}

export async function fetchDashboardNotifications() {
  return (await api.get<{ notifications: DashboardNotification[]; total: number }>("/api/staff/notifications", {
    params: { status: "pending", limit: 100 }
  })).data;
}

export async function fetchDashboardCalendar(month: string) {
  return (await api.get<{ month: string; approvedDates: string[] }>("/api/staff/dashboard/calendar", { params: { month } })).data.approvedDates;
}

export async function updateDashboardBooking(
  notification: DashboardNotification,
  status: "approved" | "declined"
) {
  if (notification.type === "table") {
    if (status === "approved") {
      await api.put(`/api/staff/reservations/${encodeURIComponent(notification.id)}/approve`, {});
    } else {
      await api.put(`/api/staff/reservations/${encodeURIComponent(notification.id)}/reject`, {
        rejected_reason: "Declined from staff dashboard."
      });
    }
    return;
  }

  if (notification.type === "catering") {
    if (status === "approved") {
      await api.put(`/api/staff/catering/reservations/${encodeURIComponent(notification.id)}/approve`, {
        mobilization_fee: 0
      });
    } else {
      await api.put(`/api/staff/catering/reservations/${encodeURIComponent(notification.id)}/decline`, {
        reason: "Declined from staff dashboard."
      });
    }
    return;
  }

  await api.patch(`/api/admin/takeout/orders/${encodeURIComponent(notification.reference)}/status`, {
    status: status === "approved" ? "preparing" : "declined"
  });
}

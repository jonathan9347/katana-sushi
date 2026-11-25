import { expect, test, type Page } from "@playwright/test";

const summary = {
  todaySales: {
    total: "1590.00",
    transactionCount: 2,
    series: Array.from({ length: 24 }, (_, hour) => ({ hour, total: hour === 18 ? "1590.00" : "0.00" }))
  },
  pendingApprovals: 1,
  lowStockCount: 1,
  upcomingEvents: 1
};

const notification = {
  id: "table-pending-1",
  type: "table",
  reference: "KTN-TEST-1",
  customerName: "Test Customer",
  date: "2026-10-28T00:00:00.000Z",
  time: "18:30",
  status: "pending_approval",
  details: "4 guests",
  createdAt: "2026-10-20T00:00:00.000Z"
};

async function configureStaff(page: Page, role = "admin") {
  await page.addInitScript((staffRole) => {
    localStorage.setItem("katana_token", "test-token");
    localStorage.setItem("katana_role", staffRole);
    localStorage.setItem("katana_user", JSON.stringify({
      id: "staff-test",
      name: "Dashboard Tester",
      email: "dashboard@example.test",
      role: staffRole
    }));
  }, role);
}

async function mockDashboard(page: Page, overrides: {
  failSummary?: boolean;
  empty?: boolean;
  failApproval?: boolean;
  delaySummary?: boolean;
  notificationType?: "table" | "catering" | "pickup";
} = {}) {
  let pending = overrides.empty ? [] : [{
    ...notification,
    type: overrides.notificationType ?? notification.type
  }];
  let summaryFailuresRemaining = overrides.failSummary ? 4 : 0;
  let summaryValue = overrides.empty
    ? { ...summary, todaySales: { total: "0.00", transactionCount: 0, series: summary.todaySales.series }, pendingApprovals: 0, lowStockCount: 0, upcomingEvents: 0 }
    : summary;

  await page.route("**/api/staff/**", async (route) => {
    const url = new URL(route.request().url());
    const pathname = url.pathname;
    if (pathname.endsWith("/dashboard/summary")) {
      if (overrides.delaySummary) {
        await new Promise((resolve) => setTimeout(resolve, 700));
      }
      if (summaryFailuresRemaining > 0) {
        summaryFailuresRemaining -= 1;
        await route.fulfill({ status: 500, json: { message: "Summary unavailable." } });
      } else {
        await route.fulfill({ json: summaryValue });
      }
    } else if (pathname.endsWith("/dashboard/recent-sales")) {
      await route.fulfill({ json: { sales: overrides.empty ? [] : [{ id: "sale-1", orderNumber: "KTN-006", total: "1320.00", completedAt: "2026-10-26T08:00:00.000Z" }] } });
    } else if (pathname.endsWith("/dashboard/inventory-alerts")) {
      await route.fulfill({
        json: {
          total: overrides.empty ? 0 : 1,
          items: overrides.empty ? [] : [{ id: "rice", name: "Rice", unit: "g", quantityLeft: 500, parLevel: 5000, severity: "reorder", percentOfPar: 10 }]
        }
      });
    } else if (pathname.endsWith("/dashboard/reminders")) {
      await route.fulfill({
        json: {
          reminders: overrides.empty ? [] : [{ id: "event-1", type: "catering", reference: "CAT-1", customerName: "Test Event", date: "2026-10-28T00:00:00.000Z", time: "18:00", details: "Sushi · 50 guests" }]
        }
      });
    } else if (pathname.endsWith("/dashboard/feedback")) {
      await route.fulfill({ json: { feedback: overrides.empty ? [] : [{ id: "feedback-1", feedback_id: "FDB-1", customer_name: "Recent Guest", visit_type: "dine_in", rating: 5, message: "Great food and service.", created_at: "2026-10-26T00:00:00.000Z" }] } });
    } else if (pathname.endsWith("/dashboard/calendar")) {
      await route.fulfill({ json: { month: "2026-10", approvedDates: ["2026-10-28"] } });
    } else if (pathname.endsWith("/notifications")) {
      await route.fulfill({ json: { notifications: pending, total: pending.length } });
    } else if (
      pathname.endsWith("/reservations/table-pending-1/approve")
      || pathname.endsWith("/reservations/table-pending-1/reject")
    ) {
      if (overrides.failApproval) {
        await route.fulfill({ status: 409, json: { message: "This booking is no longer pending." } });
      } else {
        pending = [];
        summaryValue = { ...summaryValue, pendingApprovals: 0 };
        await route.fulfill({ json: { reservation: { status: "confirmed" } } });
      }
    } else {
      await route.fulfill({ json: {} });
    }
  });
}

test("dashboard shows a loading state before summary data arrives", async ({ page }) => {
  await configureStaff(page);
  await mockDashboard(page, { delaySummary: true });
  await page.goto("/staff/dashboard");

  await expect(page.getByRole("status", { name: "Loading sales" })).toBeVisible();
  await expect(page.getByText("₱1,590.00")).toBeVisible();
});

test("dashboard renders database-backed cards and notification actions", async ({ page }) => {
  await configureStaff(page);
  await mockDashboard(page);
  await page.goto("/staff/dashboard");

  await expect(page.getByRole("heading", { name: "Welcome back, Dashboard Tester" })).toBeVisible();
  await expect(page.locator("body")).not.toContainText(/\bstaff\b/i);
  await expect(page.getByText("₱1,590.00")).toBeVisible();
  await expect(page.getByText("#KTN-006")).toBeVisible();
  await expect(page.getByText("Rice")).toBeVisible();
  await expect(page.getByText("Test Event")).toBeVisible();
  await expect(page.getByText("Recent Guest")).toBeVisible();
  await expect(page.getByRole("button", { name: "Approve Test Customer table booking" })).toBeVisible();

  await page.getByRole("button", { name: "Approve Test Customer table booking" }).click();
  await expect(page.getByText("You're all caught up")).toBeVisible();
  await expect(page.getByText("0 pending")).toBeVisible();
});

test("dashboard shows empty states when API lists have no records", async ({ page }) => {
  await configureStaff(page);
  await mockDashboard(page, { empty: true });
  await page.goto("/staff/dashboard");

  await expect(page.getByText("No completed sales yet.")).toBeVisible();
  await expect(page.getByText("No low stock alerts.")).toBeVisible();
  await expect(page.getByText("No upcoming reminders")).toBeVisible();
  await expect(page.getByText("No customer feedback yet.")).toBeVisible();
  await expect(page.getByText("You're all caught up")).toBeVisible();
});

test("summary failure is isolated and can be retried", async ({ page }) => {
  test.setTimeout(20_000);
  await configureStaff(page);
  await mockDashboard(page, { failSummary: true });
  await page.goto("/staff/dashboard");

  await expect(page.getByText("Sales are temporarily unavailable.")).toBeVisible({ timeout: 15_000 });
  await expect(page.getByText("#KTN-006")).toBeVisible();
  await expect(page.getByText("Rice")).toBeVisible();
  await page.getByRole("alert").filter({ hasText: "Sales are temporarily unavailable." }).getByRole("button", { name: "Retry" }).click();
  await expect(page.getByText("₱1,590.00")).toBeVisible();
});

test("failed approval rolls back notification and shows an error", async ({ page }) => {
  await configureStaff(page);
  await mockDashboard(page, { failApproval: true });
  await page.goto("/staff/dashboard");

  await page.getByRole("button", { name: "Approve Test Customer table booking" }).click();
  await expect(page.getByText("This booking is no longer pending.")).toBeVisible();
  await expect(page.getByRole("button", { name: "Approve Test Customer table booking" })).toBeVisible();
  await expect(page.getByText("1 pending")).toBeVisible();
});

test("declining a notification removes it from the pending list", async ({ page }) => {
  await configureStaff(page);
  await mockDashboard(page);
  await page.goto("/staff/dashboard");

  await page.getByRole("button", { name: "Decline Test Customer table booking" }).click();
  await expect(page.getByText("You're all caught up")).toBeVisible();
  await expect(page.getByText("0 pending")).toBeVisible();
});

test("cashier dashboard shows sales and booking operations without admin settings", async ({ page }) => {
  await configureStaff(page, "cashier");
  await mockDashboard(page);
  await page.goto("/staff/dashboard");

  await expect(page.getByRole("heading", { name: "Recent sales" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Reminders" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Inventory alerts" })).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "Customer feedback" })).toHaveCount(0);
  await expect(page.getByRole("link", { name: "Settings" })).toHaveCount(0);
});

test("event coordinator dashboard shows catering operations without sales or inventory", async ({ page }) => {
  await configureStaff(page, "event_coordinator");
  await mockDashboard(page, { notificationType: "catering" });
  await page.goto("/staff/dashboard");

  await expect(page.getByRole("heading", { name: "Upcoming catering events" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Reminders" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Recent sales" })).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "Inventory alerts" })).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "Customer feedback" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Approve Test Customer catering booking" })).toBeVisible();
});

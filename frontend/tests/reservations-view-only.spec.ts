import { expect, test } from "@playwright/test";

test("unified reservations page lists all three views and keeps pickup actions", async ({ page }) => {
  await page.addInitScript(() => {
    const role = localStorage.getItem("test-role") ?? "receptionist";
    localStorage.setItem("katana_token", "playwright-token");
    localStorage.setItem("katana_role", role);
    localStorage.setItem("katana_user", JSON.stringify({
      id: `${role}-1`,
      email: `${role}@example.test`,
      name: `Test ${role}`,
      role
    }));
  });

  const date = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
  let pickupStatus = "pending_approval";
  await page.route("**/api/**", async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname === "/api/staff/reservations/overview") {
      await route.fulfill({
        json: {
          reservations: [{
            id: "reservation-1",
            type: "dine_in",
            reference: "KTN-DINE-TEST",
            customer_name: "Test Guest",
            date,
            time: "18:00",
            guests: 4,
            status: "confirmed",
            reservation_type: "dine_in",
            table_numbers: [2, 5]
          }, {
            id: "catering-1",
            type: "catering",
            reference: "CAT-TEST",
            customer_name: "Catering Guest",
            date,
            time: "17:00",
            guests: 20,
            status: "confirmed",
            table_numbers: [],
            package_name: "Party Set"
          }]
        }
      });
      return;
    }
    if (url.pathname === "/api/staff/reservations/overview/pickup" && route.request().method() === "GET") {
      await route.fulfill({
        json: {
          orders: [{
            order_number: "PICKUP-TEST",
            status: pickupStatus,
            payment_plan: "pay_now",
            payment_status: "paid",
            payment_method: "gcash",
            customer_name: "Pickup Guest",
            customer_phone: "09123456789",
            created_at: date,
            total: 250,
            items: [{ name: "Salmon Roll", quantity: 2, total_price: 250 }]
          }]
        }
      });
      return;
    }
    if (url.pathname === "/api/admin/takeout/orders/PICKUP-TEST/status" && route.request().method() === "PATCH") {
      pickupStatus = (route.request().postDataJSON() as { status: string }).status;
      await route.fulfill({ json: { order: { order_number: "PICKUP-TEST", status: pickupStatus } } });
      return;
    }
    await route.fulfill({ json: {} });
  });

  await page.goto("/staff/reservations");

  await expect(page.getByRole("heading", { name: "Upcoming tables" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Reservations" })).toBeVisible();
  await expect(page.getByText("Test Guest")).toBeVisible();
  await expect(page.getByText("Tables: 2, 5")).toBeVisible();

  const reservationsList = page.getByRole("region", { name: "Tables upcoming list" });
  await expect(reservationsList.getByRole("button")).toHaveCount(0);
  await expect(page.getByRole("button", { name: /mark arrived|seat|approve|decline|cancel|complete|collect payment/i })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Catering" })).toHaveCount(0);

  await page.getByRole("button", { name: "Pickup" }).click();
  await expect(page).toHaveURL(/view=pickup/);
  await expect(page.getByRole("heading", { name: "Upcoming pickup" })).toBeVisible();
  await expect(page.getByText("Pickup Guest")).toBeVisible();
  await expect(page.getByRole("button", { name: /approve|start preparing|mark ready/i })).toHaveCount(0);

  await page.evaluate(() => {
    localStorage.setItem("test-role", "cashier");
    localStorage.setItem("katana_role", "cashier");
    localStorage.setItem("katana_user", JSON.stringify({
      id: "cashier-1",
      email: "cashier@example.test",
      name: "Test Cashier",
      role: "cashier"
    }));
  });
  await page.reload();
  await expect(page.getByText("Pickup Guest")).toBeVisible();
  await page.getByRole("button", { name: "Approve & start preparing" }).click();
  await expect(page.getByRole("button", { name: "Mark ready" })).toBeVisible();
  await page.getByRole("button", { name: "Mark ready" }).click();
  await expect(page.getByText("Ready for pickup")).toBeVisible();

  await page.evaluate(() => {
    localStorage.setItem("test-role", "admin");
    localStorage.setItem("katana_role", "admin");
    localStorage.setItem("katana_user", JSON.stringify({
      id: "admin-1",
      email: "admin@example.test",
      name: "Test Admin",
      role: "admin"
    }));
  });
  await page.reload();
  await page.getByRole("button", { name: "Catering" }).click();
  await expect(page.getByRole("heading", { name: "Upcoming catering" })).toBeVisible();
  await expect(page.getByText("Catering Guest")).toBeVisible();
  await expect(page.getByRole("link", { name: "Open actions" })).toBeVisible();
  await expect(page.getByRole("button", { name: /approve|decline|cancel|complete/i })).toHaveCount(0);

  await page.getByRole("button", { name: "Calendar" }).click();
  await expect(page.getByRole("dialog", { name: "Reservation calendar" })).toBeVisible();

  await page.getByRole("button", { name: "Close dialog" }).click();
  await page.goto("/staff/catering");
  await expect(page.getByRole("heading", { name: "Calendar first event control" })).toBeVisible();

  await page.goto("/staff/takeout");
  await expect(page).toHaveURL(/\/staff\/reservations\?view=pickup/);
  await expect(page.getByRole("heading", { name: "Upcoming pickup" })).toBeVisible();
});

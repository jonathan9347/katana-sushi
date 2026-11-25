import { expect, test, type Page } from "@playwright/test";

function setupCashier(page: Page) {
  return page.addInitScript(() => {
    localStorage.setItem("katana_token", "playwright-token");
    localStorage.setItem("katana_role", "cashier");
    localStorage.setItem("katana_user", JSON.stringify({
      id: "cashier-1",
      email: "cashier@example.test",
      name: "Test Cashier",
      role: "cashier"
    }));
  });
}

async function routeDefaultPosApis(page: Page) {
  await page.route("**/api/**", async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname === "/api/products") {
      await route.fulfill({ json: { products: [] } });
      return;
    }
    if (url.pathname === "/api/settings/system") {
      await route.fulfill({ json: { settings: {} } });
      return;
    }
    if (url.pathname === "/api/pos/dining/upcoming-reservations") {
      await route.fulfill({ json: { reservations: [] } });
      return;
    }
    if (url.pathname === "/api/pos/pickup-orders") {
      await route.fulfill({ json: { orders: [] } });
      return;
    }
    await route.fulfill({ json: {} });
  });
}

async function openReservationPicker(page: Page) {
  await page.getByRole("button", { name: "Reservation", exact: true }).click();
  return page.getByRole("dialog", { name: "Today's reservations" });
}

async function openPickupPicker(page: Page) {
  await page.getByRole("button", { name: "Pickup", exact: true }).click();
  return page.getByRole("dialog", { name: "Select pickup order" });
}

test("inline order paths open accessible pickers and Escape restores focus", async ({ page }) => {
  await setupCashier(page);
  await routeDefaultPosApis(page);
  await page.goto("/staff/pos");

  const trigger = page.getByRole("button", { name: "Reservation", exact: true });
  await trigger.focus();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("dialog", { name: "Today's reservations" })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(trigger).toBeFocused();
  await expect(page.getByRole("button", { name: "Dine-in walk-in", exact: true })).toHaveAttribute("aria-pressed", "false");
});

test("reservation picker shows loading, empty, and retryable error states", async ({ page }) => {
  let reservationRequests = 0;
  await setupCashier(page);
  await page.route("**/api/**", async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname === "/api/products") {
      await route.fulfill({ json: { products: [] } });
      return;
    }
    if (url.pathname === "/api/settings/system") {
      await route.fulfill({ json: { settings: {} } });
      return;
    }
    if (url.pathname === "/api/pos/dining/upcoming-reservations") {
      reservationRequests += 1;
      if (reservationRequests === 1) {
        await new Promise((resolve) => setTimeout(resolve, 350));
        await route.fulfill({ json: { reservations: [] } });
      } else if (reservationRequests === 2) {
        await route.fulfill({ status: 500, json: { message: "Unavailable" } });
      } else {
        await route.fulfill({ json: { reservations: [] } });
      }
      return;
    }
    await route.fulfill({ json: {} });
  });
  await page.goto("/staff/pos");

  let dialog = await openReservationPicker(page);
  await expect(dialog.getByRole("status")).toHaveText("Loading reservations…");
  await expect(dialog.getByText("No reservations for today")).toBeVisible();
  await dialog.getByRole("button", { name: "Close order picker" }).click();
  dialog = await openReservationPicker(page);
  await expect(dialog.getByRole("alert")).toContainText("Unable to load today’s reservations.");
  await dialog.getByRole("button", { name: "Retry" }).click();
  await expect(dialog.getByText("No reservations for today")).toBeVisible();
});

test("reservation selection continues through the existing table assignment flow", async ({ page }) => {
  await setupCashier(page);
  await page.route("**/api/**", async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname === "/api/products") {
      await route.fulfill({ json: { products: [] } });
    } else if (url.pathname === "/api/settings/system") {
      await route.fulfill({ json: { settings: {} } });
    } else if (url.pathname === "/api/pos/dining/upcoming-reservations") {
      await route.fulfill({ json: { reservations: [{
        id: "reservation-8",
        time: "06:30 PM",
        customer_name: "Dela Cruz",
        party_size: 6,
        table_numbers: [8],
        temporary_table_numbers: [],
        state: "upcoming"
      }] } });
    } else if (url.pathname === "/api/pos/dining/tables") {
      await route.fulfill({ json: { tables: [{
        id: "table-8",
        table_number: 8,
        capacity: 6,
        status: "reserved",
        linked_to_table_id: null,
        unavailable_reason: null,
        active_session: null
      }] } });
    } else {
      await route.fulfill({ json: {} });
    }
  });
  await page.goto("/staff/pos");

  const dialog = await openReservationPicker(page);
  await dialog.getByRole("button", { name: /Dela Cruz/ }).click();
  await expect(page.getByRole("region", { name: "Table board" })).toContainText("Assign table(s) for Dela Cruz");
  await expect(page.getByRole("region", { name: "Current order" })).toContainText("Dela Cruz · 06:30 PM");
});

test("pickup picker loads matching orders and the selected order continues to checkout", async ({ page }) => {
  await setupCashier(page);
  await page.route("**/api/**", async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname === "/api/products") {
      await route.fulfill({ json: { products: [] } });
    } else if (url.pathname === "/api/settings/system") {
      await route.fulfill({ json: { settings: {} } });
    } else if (url.pathname === "/api/pos/pickup-orders") {
      const search = url.searchParams.get("search") ?? "";
      await route.fulfill({
        json: {
          orders: search === "PICK-42" ? [{
            order_number: "PICK-42",
            status: "ready",
            payment_plan: "pay_at_pickup",
            payment_status: "unpaid",
            payment_method: null,
            customer_name: "Mika Tan",
            created_at: "2026-10-27T00:00:00.000Z",
            pickup_time: "2026-10-27T02:30:00.000Z",
            total: 250,
            items: [{ name: "Roll", quantity: 2, unit_price: 125, total_price: 250 }]
          }] : []
        }
      });
    } else {
      await route.fulfill({ json: {} });
    }
  });
  await page.goto("/staff/pos");

  const dialog = await openPickupPicker(page);
  await dialog.getByLabel("Search pickup orders by customer or reference").fill("PICK-42");
  await dialog.getByRole("button", { name: /Mika Tan/ }).click();
  await expect(page.getByRole("region", { name: "Current order" })).toContainText("Mika Tan · PICK-42");
  await expect(page.getByRole("button", { name: "Checkout" })).toBeEnabled();
});

test("keeps the main order action visible at cashier PC and tablet sizes", async ({ page }) => {
  await setupCashier(page);
  await routeDefaultPosApis(page);
  await page.goto("/staff/pos");

  for (const viewport of [{ width: 1920, height: 1080 }, { width: 800, height: 1024 }]) {
    await page.setViewportSize(viewport);
    const builder = page.getByRole("region", { name: "POS order builder" });
    const primaryAction = builder.getByRole("button", { name: "Checkout", exact: true });
    await expect(primaryAction).toBeVisible();
    const bounds = await primaryAction.boundingBox();
    expect(bounds).not.toBeNull();
    expect(bounds?.y ?? -1).toBeGreaterThanOrEqual(0);
    expect((bounds?.y ?? 0) + (bounds?.height ?? 0)).toBeLessThanOrEqual(viewport.height);
    await expect(page.getByRole("button", { name: "Dine-in walk-in", exact: true })).toHaveCSS("min-height", "44px");
  }
});

test("pickup picker shows empty and retryable error states", async ({ page }) => {
  let pickupRequests = 0;
  await setupCashier(page);
  await page.route("**/api/**", async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname === "/api/products") {
      await route.fulfill({ json: { products: [] } });
    } else if (url.pathname === "/api/settings/system") {
      await route.fulfill({ json: { settings: {} } });
    } else if (url.pathname === "/api/pos/pickup-orders") {
      pickupRequests += 1;
      if (pickupRequests === 1) {
        await route.fulfill({ json: { orders: [] } });
      } else if (pickupRequests === 2) {
        await route.fulfill({ status: 500, json: { message: "Unavailable" } });
      } else {
        await route.fulfill({ json: { orders: [] } });
      }
    } else {
      await route.fulfill({ json: {} });
    }
  });
  await page.goto("/staff/pos");

  let dialog = await openPickupPicker(page);
  const search = dialog.getByLabel("Search pickup orders by customer or reference");
  await search.fill("NO-ORDER");
  await expect(dialog.getByText("No pickup orders found.")).toBeVisible();
  await search.fill("ERROR-ORDER");
  await expect(dialog.getByRole("alert")).toContainText("Unable to load pickup orders.");
  await dialog.getByRole("button", { name: "Retry" }).click();
  await expect(dialog.getByText("No pickup orders found.")).toBeVisible();
});

import { expect, test } from "@playwright/test";

test("inline order paths open table, reservation, and pickup selection views", async ({ page }) => {
  let sessionCreationCount = 0;
  let reservationSeatCount = 0;
  await page.addInitScript(() => {
    localStorage.setItem("katana_token", "playwright-token");
    localStorage.setItem("katana_role", "cashier");
    localStorage.setItem("katana_user", JSON.stringify({
      id: "cashier-1",
      email: "cashier@example.test",
      name: "Test Cashier",
      role: "cashier"
    }));
  });
  await page.route("**/api/**", async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname === "/api/products") {
      await route.fulfill({ json: { products: [{
        id: "included-product",
        name: "Iced Tea",
        category: "Beverage",
        price: 45,
        image_url: "/test-roll-photo.jpg",
        is_available: true,
        available_stock: 5,
        cart_compatibility: {
          a_la_carte: { allowed: true, classification: "included_in_unlimited" },
          unlimited: { allowed: true, classification: "included_in_unlimited" }
        }
      }] } });
      return;
    }
    if (url.pathname === "/api/settings/system") {
      await route.fulfill({ json: { settings: {} } });
      return;
    }
    if (url.pathname === "/api/pos/dining/tables") {
      await route.fulfill({ json: { tables: [
        {
          id: "table-12",
          table_number: 12,
          capacity: 4,
          status: "available",
          linked_to_table_id: null,
          unavailable_reason: null,
          active_session: null
        },
        {
          id: "table-15",
          table_number: 15,
          capacity: 4,
          status: "available",
          linked_to_table_id: null,
          unavailable_reason: null,
          active_session: null
        }
      ] } });
      return;
    }
    if (url.pathname === "/api/pos/dining/upcoming-reservations") {
      await route.fulfill({ json: { reservations: [{
        id: "reservation-1",
        time: "07:30 PM",
        customer_name: "Ava Guest",
        party_size: 2,
        table_numbers: [15],
        temporary_table_numbers: [],
        state: "late"
      }] } });
      return;
    }
    if (url.pathname === "/api/pos/pickup-orders") {
      await route.fulfill({ json: { orders: [{
        order_number: "PICK-123",
        status: "preparing",
        payment_plan: "pay_at_pickup",
        payment_status: "unpaid",
        payment_method: null,
        customer_name: "Mika Customer",
        created_at: "2026-10-22T10:00:00.000Z",
        pickup_time: null,
        total: 250,
        items: [{ name: "Iced Tea", quantity: 1, unit_price: 250, total_price: 250 }]
      }] } });
      return;
    }
    if (url.pathname === "/api/pos/dining/sessions" && route.request().method() === "POST") {
      sessionCreationCount += 1;
    }
    if (url.pathname.endsWith("/seat") && route.request().method() === "POST") {
      reservationSeatCount += 1;
    }
    await route.fulfill({ json: {} });
  });

  await page.goto("/staff/pos");
  await expect(page.getByRole("heading", { name: "Point of Sale" })).toBeVisible();
  await page.getByText("More", { exact: true }).click();
  await expect(page.getByRole("link", { name: "Transaction history" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Unli Settings" })).toHaveCount(0);
  await expect(page.getByRole("link", { name: "Takeout Sale" })).toHaveCount(0);

  await page.getByRole("button", { name: "Dine-in walk-in", exact: true }).click();
  await expect(page.getByRole("region", { name: "POS order builder" })).toContainText("Menu");
  await expect(page.getByRole("button", { name: /Iced Tea/ })).toBeVisible();
  await expect(page.getByRole("button", { name: /Iced Tea/ }).locator("img")).toHaveAttribute("src", "/test-roll-photo.jpg");
  await expect(page.getByRole("group", { name: "Menu layout" })).toHaveCount(0);
  const menuGrid = page.locator(".pos-menu-grid");
  await expect(menuGrid).not.toHaveClass(/is-compact/);
  expect(await menuGrid.evaluate((element) => getComputedStyle(element).gridTemplateColumns.split(" ").length)).toBeGreaterThan(1);
  await page.getByRole("region", { name: "POS order builder" }).getByRole("button", { name: /Iced Tea Beverage/ }).click();
  await page.getByRole("button", { name: "Proceed" }).click();
  await expect(page.getByRole("region", { name: "Table board" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Select Table 12, Free" })).toBeVisible();
  await expect(page.getByRole("region", { name: "POS order builder" })).toContainText("1 × Iced Tea");
  await expect(page.getByText("Upcoming reservations")).toHaveCount(0);
  await expect(page.getByText("Active tables")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Seat walk-in" })).toHaveCount(0);
  await page.getByRole("button", { name: "Select Table 12, Free" }).click();
  await expect(page.getByRole("region", { name: "POS order builder" })).toBeVisible();
  await expect(page.getByText("Table 12 selected")).toBeVisible();
  await expect(page.getByRole("button", { name: "Confirm & Print" })).toBeVisible();
  expect(sessionCreationCount).toBe(0);

  await page.getByRole("button", { name: "Reservation", exact: true }).click();
  await page.getByRole("dialog", { name: "Today's reservations" }).getByRole("button", { name: /Ava Guest/ }).click();
  const reservationBoard = page.getByRole("region", { name: "Table board" });
  await expect(reservationBoard).toBeVisible();
  await expect(reservationBoard).toContainText("Assign table(s) for Ava Guest");
  await expect(page.getByRole("region", { name: "POS order builder" })).toContainText("1 × Iced Tea");
  const reservationConfirmButton = page.getByRole("button", { name: "Select table/s", exact: true });
  await expect(reservationConfirmButton).toBeVisible();
  await expect(reservationConfirmButton).toBeDisabled();
  const reservationTable = reservationBoard.getByRole("button", { name: "Choose Table 15, Reserved" });
  await expect(reservationTable).toHaveAttribute("aria-pressed", "false");
  await reservationTable.click();
  await expect(reservationTable).toHaveAttribute("aria-pressed", "true");
  await expect(reservationBoard.getByRole("button", { name: "Select table/s" })).toBeVisible();
  await expect(reservationConfirmButton).toBeEnabled();
  await expect(page.getByText("Selected seats: 4 / 2")).toBeVisible();
  await reservationConfirmButton.click();
  await expect(page.getByText("Ava Guest · 07:30 PM · Table 15 selected")).toBeVisible();
  await expect(page.getByRole("button", { name: "Confirm & Print" })).toBeVisible();
  expect(reservationSeatCount).toBe(0);

  await page.getByRole("button", { name: "Takeout", exact: true }).click();
  await expect(page.getByRole("region", { name: "POS order builder" })).toContainText("PHP 45.00");

  await page.getByRole("button", { name: "Pickup", exact: true }).click();
  await page.getByLabel("Search pickup orders by customer or reference").fill("PICK");
  await page.getByRole("dialog", { name: "Select pickup order" }).getByRole("button", { name: /Mika Customer.*PICK-123/ }).click();
  await expect(page.getByRole("region", { name: "POS order builder" })).toContainText("1 × Iced Tea");
  await expect(page.getByRole("region", { name: "POS order builder" })).toContainText("PHP 250.00");
  await expect(page.getByRole("button", { name: "Checkout" })).toBeVisible();
  await expect(page.getByRole("region", { name: "POS order builder" })).toContainText("Menu");
});

test("confirms a walk-in dine-in order atomically after table selection and resets the POS to Menu", async ({ page }) => {
  let confirmationBody: Record<string, unknown> | null = null;
  await page.addInitScript(() => {
    localStorage.setItem("katana_token", "playwright-token");
    localStorage.setItem("katana_role", "cashier");
    localStorage.setItem("katana_user", JSON.stringify({
      id: "cashier-1",
      email: "cashier@example.test",
      name: "Test Cashier",
      role: "cashier"
    }));
  });
  await page.route("**/api/**", async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname === "/api/products") {
      await route.fulfill({ json: { products: [{
        id: "product-1",
        name: "California Roll",
        category: "Sushi",
        price: 100,
        available_stock: 5,
        is_available: true,
        is_included: false,
        is_sold_a_la_carte: true,
        cart_compatibility: {
          a_la_carte: { allowed: true, classification: "a_la_carte_only" },
          unlimited: { allowed: false, classification: "a_la_carte_only" }
        }
      }] } });
      return;
    }
    if (url.pathname === "/api/pos/dining/tables") {
      await route.fulfill({ json: { tables: [{
        id: "table-12",
        table_number: 12,
        capacity: 4,
        status: "available",
        linked_to_table_id: null,
        unavailable_reason: null,
        active_session: null
      }] } });
      return;
    }
    if (url.pathname === "/api/pos/dining/upcoming-reservations") {
      await route.fulfill({ json: { reservations: [] } });
      return;
    }
    if (url.pathname === "/api/pos/dining/confirm-order" && route.request().method() === "POST") {
      confirmationBody = route.request().postDataJSON() as Record<string, unknown>;
      await route.fulfill({ status: 201, json: {
        replayed: false,
        order: {
          id: "order-1",
          dining_session_id: "session-1",
          order_number: "DIN-20261022-ABC12345",
          table_number_snapshot: 12,
          created_at: "2026-10-22T12:00:00.000Z",
          items: [{
            id: "line-1",
            name_snapshot: "California Roll",
            quantity: 1,
            unit_price: 100,
            total_price: 100
          }]
        }
      } });
      return;
    }
    await route.fulfill({ json: {} });
  });
  await page.goto("/staff/pos");

  const builder = page.getByRole("region", { name: "POS order builder" });
  await page.getByRole("button", { name: "Dine-in walk-in", exact: true }).click();
  await expect(builder.getByLabel("Headcount")).toHaveCount(0);
  await builder.getByRole("button", { name: /California Roll/ }).click();
  await expect(builder).toContainText("1 × California Roll");
  await page.getByRole("button", { name: "Proceed" }).click();
  await expect(page.getByRole("region", { name: "Table board" })).toBeVisible();
  await expect(builder).toContainText("1 × California Roll");
  await page.getByRole("button", { name: "Select Table 12, Free" }).click();

  const popupPromise = page.waitForEvent("popup");
  await page.getByRole("button", { name: "Confirm & Print" }).click();
  const slip = await popupPromise;
  await expect(slip.locator("body")).toContainText("DIN-20261022-ABC12345");
  await expect(slip.locator("body")).toContainText("Table: 12");
  await slip.close();
  await expect(builder).toContainText("Menu");
  await expect(builder).toContainText("Cart is empty");
  const reprintPromise = page.waitForEvent("popup");
  await page.getByRole("button", { name: "Reprint", exact: true }).click();
  const reprint = await reprintPromise;
  await expect(reprint.locator("body")).toContainText("REPRINT");
  await expect(reprint.locator("body")).toContainText("DIN-20261022-ABC12345");
  expect(confirmationBody).toMatchObject({
    selection: { type: "table", tableId: "table-12" },
    orderType: "ala_carte",
    items: [{ productId: "product-1", quantity: 1, expectedUnitPrice: 100 }]
  });
  expect(confirmationBody).not.toHaveProperty("paxCount");
  expect(confirmationBody?.idempotencyKey).toEqual(expect.any(String));
});

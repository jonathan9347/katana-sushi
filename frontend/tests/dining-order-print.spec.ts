import { expect, test } from "@playwright/test";
import type { Page, Route } from "@playwright/test";

const orderResponse = {
  order: {
    id: "order-1",
    order_number: "DO-PRINT-001",
    table_number_snapshot: 4,
    created_at: "2026-10-19T12:00:00.000Z",
    items: [
      {
        id: "line-1",
        name_snapshot: "California Roll",
        quantity: 2,
        unit_price: 100,
        total_price: 200
      }
    ]
  },
  replayed: false
};

type MockMenuProduct = {
  id: string;
  name: string;
  category: string;
  price: number;
  is_available: boolean;
  is_included: boolean;
  is_sold_a_la_carte: boolean;
  cart_compatibility: {
    a_la_carte: { allowed: boolean; classification: string; message?: string };
    unlimited: { allowed: boolean; classification: string; message?: string };
  };
};

async function openDiningService(
  page: Page,
  postOrder: (route: Route) => Promise<void>,
  getProductPrice: () => number = () => 100,
  menuProducts?: MockMenuProduct[],
  path = "/staff/pos",
  sessionGuestCount = 0
) {
  let activeUnlimitedSession: {
    id: string;
    pax_count: number;
    price_per_pax: number;
    status: string;
    ends_at: string;
    first_round_at: string | null;
    extensions: Array<{ minutes: number; created_at: string }>;
  } | null = null;
  await page.context().addInitScript(() => {
    localStorage.setItem("katana_token", "playwright-token");
    localStorage.setItem("katana_role", "cashier");
    localStorage.setItem("katana_user", JSON.stringify({
      id: "cashier-1",
      email: "cashier@example.test",
      name: "Test Cashier",
      role: "cashier"
    }));
    window.print = () => document.body.setAttribute("data-print-requested", "true");
  });
  await page.route("**/api/**", async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname === "/api/pos/dining/tables") {
      await route.fulfill({ json: { tables: [{
        id: "table-1",
        table_number: 4,
        capacity: 4,
        status: "occupied",
        linked_to_table_id: null,
        unavailable_reason: null,
        active_session: { id: "session-1", guests: [] }
      }] } });
      return;
    }
    if (url.pathname === "/api/pos/dining/sessions") {
      await route.fulfill({ json: { sessions: [{
        id: "session-1",
        status: "active",
        table_id: "table-1",
        table: { id: "table-1", table_number: 4, capacity: 4 },
        guests: Array.from({ length: sessionGuestCount }, (_, index) => ({
          id: `guest-${index + 1}`,
          guest_number: index + 1
        })),
        orders: [],
        unlimited_sessions: activeUnlimitedSession ? [activeUnlimitedSession] : []
      }] } });
      return;
    }
    if (url.pathname === "/api/pos/dining/sessions/session-1/unlimited-sessions" && route.request().method() === "POST") {
      const body = route.request().postDataJSON() as { paxCount: number };
      const startedAt = new Date();
      activeUnlimitedSession = {
        id: "unlimited-session-1",
        pax_count: body.paxCount,
        price_per_pax: 1500,
        status: "active",
        first_round_at: startedAt.toISOString(),
        ends_at: new Date(startedAt.getTime() + 90 * 60_000).toISOString(),
        extensions: []
      };
      await route.fulfill({ status: 201, json: { unlimited_session: activeUnlimitedSession } });
      return;
    }
    if (url.pathname === "/api/pos/dining/unlimited-sessions/unlimited-session-1/extend" && route.request().method() === "POST") {
      if (activeUnlimitedSession) {
        const extendedAt = new Date();
        activeUnlimitedSession = {
          ...activeUnlimitedSession,
          ends_at: new Date(Math.max(new Date(activeUnlimitedSession.ends_at).getTime(), extendedAt.getTime()) + 30 * 60_000).toISOString(),
          extensions: [...activeUnlimitedSession.extensions, { minutes: 30, created_at: extendedAt.toISOString() }]
        };
      }
      await route.fulfill({ json: { extension: { minutes: 30 }, session: activeUnlimitedSession } });
      return;
    }
    if (url.pathname === "/api/pos/dining/upcoming-reservations") {
      await route.fulfill({ json: { reservations: [] } });
      return;
    }
    if (url.pathname === "/api/pos/dining/sessions/session-1/checkout-preview") {
      await route.fulfill({ json: {
        session_id: "session-1",
        table_number: 4,
        guest_count: 10,
        a_la_carte_lines: [{
          name: "California Roll",
          guest_number: null,
          quantity: 2,
          unit_price: 100,
          total_price: 200
        }],
        unlimited_order_lines: [],
        unlimited_lines: [],
        leftover_lines: [],
        subtotal: 200,
        unlimited_amount: 0,
        leftover_amount: 0,
        discount_base_snapshot: 200,
        discount_rate_snapshot: 0.2,
        discounted_guest_count: 3,
        discount_amount: 12,
        total: 188
      } });
      return;
    }
    if (url.pathname === "/api/pos/kitchen/orders") {
      await route.fulfill({ json: { orders: [] } });
      return;
    }
    if (url.pathname === "/api/products") {
      await route.fulfill({ json: { products: menuProducts ?? [{
        id: "product-1",
        name: "California Roll",
        category: "Sushi",
        price: getProductPrice(),
        is_available: true,
        is_included: false,
        is_sold_a_la_carte: true,
        cart_compatibility: {
          a_la_carte: { allowed: true, classification: "a_la_carte_only" },
          unlimited: { allowed: false, classification: "a_la_carte_only", message: "Not included in Unlimited." }
        }
      }] } });
      return;
    }
    if (url.pathname === "/api/admin/unlimited/settings") {
      await route.fulfill({ json: { settings: { price_per_person: 1500, extension_minutes: 30 } } });
      return;
    }
    if (url.pathname === `/api/pos/dining/orders/${orderResponse.order.id}` && route.request().method() === "GET") {
      await route.fulfill({ json: { order: orderResponse.order } });
      return;
    }
    if (url.pathname === "/api/pos/dining/sessions/session-1/orders" && route.request().method() === "POST") {
      await postOrder(route);
      return;
    }
    await route.fulfill({ json: {} });
  });
  await page.goto(path);
  await page.getByRole("button", { name: "Existing Table" }).click();
  await page.getByRole("button", { name: "Select Table 4, Occupied" }).click();
  await page.getByRole("button", { name: "Open table session tools" }).click();
  await expect(page.getByRole("heading", { name: "Dine-in order", exact: true })).toBeVisible();
}

async function addOneOrderLine(page: Page) {
  await page.getByLabel("Product").selectOption("product-1");
  await page.getByLabel("Qty").fill("2");
  await page.getByRole("button", { name: "Add item" }).click();
  await page.getByRole("button", { name: "Review order" }).click();
  await expect(page.getByTestId("order-review")).toContainText("Confirm a la carte order · Table 4");
  await expect(page.getByTestId("order-review")).toContainText("2 × California Roll at PHP 100.00");
  await expect(page.getByTestId("order-review")).toContainText("Total: PHP 200.00");
}

test("confirms guestless order with reviewed price and reprints saved slip without another commit", async ({ page }) => {
  const requests: Array<Record<string, unknown>> = [];
  page.on("dialog", (dialog) => dialog.accept());
  await openDiningService(page, async (route) => {
    requests.push(route.request().postDataJSON() as Record<string, unknown>);
    await route.fulfill({ json: orderResponse, status: 201 });
  });
  await addOneOrderLine(page);

  const firstPopup = page.waitForEvent("popup");
  await page.getByTestId("order-review").getByRole("button", { name: "Confirm & Print" }).click();
  const printedSlip = await firstPopup;
  await expect(printedSlip.locator("body")).toContainText("DO-PRINT-001");
  await expect(printedSlip.locator("body")).toContainText("Table 4");
  await expect(printedSlip.locator("body")).toContainText("California Roll");
  await expect(printedSlip.locator("body")).toContainText("PHP 200.00");
  await expect(printedSlip.locator("body")).toHaveAttribute("data-print-requested", "true");
  expect(requests).toHaveLength(1);
  expect(requests[0]).toMatchObject({
    orderType: "ala_carte",
    items: [{ productId: "product-1", quantity: 2, expectedUnitPrice: 100 }]
  });
  expect(requests[0]).not.toHaveProperty("items.0.guestNumber");

  const reprintPopupPromise = page.waitForEvent("popup");
  await page.getByRole("button", { name: "Reprint" }).click();
  const reprintedSlip = await reprintPopupPromise;
  await expect(reprintedSlip.locator("body")).toContainText("REPRINT");
  await expect(reprintedSlip.locator("body")).toContainText("DO-PRINT-001");
  await expect(reprintedSlip.locator("body")).toHaveAttribute("data-print-requested", "true");
  expect(requests).toHaveLength(1);
});

test("reload fetches the tab's saved order ID and reprints without committing again", async ({ page }) => {
  let postCount = 0;
  let lookupCount = 0;
  page.on("dialog", (dialog) => dialog.accept());
  await openDiningService(page, async (route) => {
    postCount += 1;
    await route.fulfill({ json: orderResponse, status: 201 });
  });
  page.on("request", (request) => {
    if (request.method() === "GET" && request.url().includes(`/api/pos/dining/orders/${orderResponse.order.id}`)) {
      lookupCount += 1;
    }
  });
  await addOneOrderLine(page);
  const firstPopupPromise = page.waitForEvent("popup");
  await page.getByTestId("order-review").getByRole("button", { name: "Confirm & Print" }).click();
  await firstPopupPromise;
  await expect(page.getByRole("button", { name: "Reprint" })).toBeVisible();
  await expect.poll(() => postCount).toBe(1);

  await page.reload();
  await page.getByRole("button", { name: "Existing Table" }).click();
  await page.getByRole("button", { name: "Select Table 4, Occupied" }).click();
  await page.getByRole("button", { name: "Open table session tools" }).click();
  await expect(page.getByText(`Saved order ${orderResponse.order.order_number} · Table 4`)).toBeVisible();
  await expect.poll(() => lookupCount).toBeGreaterThan(0);

  const reprintPopupPromise = page.waitForEvent("popup");
  await page.getByRole("button", { name: "Reprint" }).click();
  const reprintedSlip = await reprintPopupPromise;
  await expect(reprintedSlip.locator("body")).toContainText("REPRINT");
  await expect(reprintedSlip.locator("body")).toContainText("DO-PRINT-001");
  expect(postCount).toBe(1);
});

test("main POS dine-in commits, reprints, and checks out through the saved-order flow", async ({ page }) => {
  let orderPostCount = 0;
  let submittedCheckout: Record<string, unknown> | undefined;
  page.on("dialog", (dialog) => dialog.accept());
  await openDiningService(page, async (route) => {
    orderPostCount += 1;
    await route.fulfill({ json: orderResponse, status: 201 });
  }, () => 100, undefined, "/staff/pos");

  await expect(page.getByRole("button", { name: /^Unlimited/ })).toHaveCount(1);
  await addOneOrderLine(page);
  const printPopupPromise = page.waitForEvent("popup");
  await page.getByTestId("order-review").getByRole("button", { name: "Confirm & Print" }).click();
  const printPopup = await printPopupPromise;
  await expect(printPopup.locator("body")).toContainText("California Roll");
  await expect(printPopup.locator("body")).toContainText("Table 4");
  await expect(page.getByRole("button", { name: "Reprint" })).toBeVisible();
  expect(orderPostCount).toBe(1);

  const reprintPopupPromise = page.waitForEvent("popup");
  await page.getByRole("button", { name: "Reprint" }).click();
  const reprintPopup = await reprintPopupPromise;
  await expect(reprintPopup.locator("body")).toContainText("REPRINT");
  expect(orderPostCount).toBe(1);

  await page.route("**/api/pos/dining/sessions/session-1/checkout", async (route) => {
    submittedCheckout = route.request().postDataJSON() as Record<string, unknown>;
    await route.fulfill({ status: 201, json: {
      replayed: false,
      transaction: {
        transaction_number: "POS-MAIN-001",
        subtotal: 200,
        tax: 0,
        unlimited_amount: 0,
        leftover_amount: 0,
        discount_amount: 12,
        discount_base_snapshot: 200,
        discount_rate_snapshot: 0.2,
        guest_count: 10,
        discount_guest_count: 3,
        total: 188,
        payment_method: "cash",
        cash_received: 200,
        change_due: 12,
        created_at: "2026-10-19T12:00:00.000Z",
        table_number_snapshot: 4,
        items: [{
          quantity: 2,
          unit_price: 100,
          total_price: 200,
          name_snapshot: "California Roll",
          selling_product: { name: "California Roll" }
        }],
        charges: [],
        dining_session: { table: { table_number: 4 } }
      }
    } });
  });

  await page.getByRole("button", { name: "Review bill" }).click();
  await page.getByLabel("Total guests at this table").fill("10");
  await page.getByLabel("Senior/PWD guests").fill("3");
  await page.getByLabel("Cash received").fill("200");
  await page.getByRole("button", { name: "Complete checkout" }).click();
  await expect(page.getByText("Checkout complete")).toBeVisible();
  expect(submittedCheckout).toMatchObject({ guestCount: 10, seniorPwdCount: 3, cashReceived: 200 });
  expect(orderPostCount).toBe(1);
});

test("main POS offers smart conversion to the Unlimited cart", async ({ page }) => {
  let conversionPrompt = "";
  page.on("dialog", async (dialog) => {
    conversionPrompt = dialog.message();
    await dialog.accept();
  });
  await openDiningService(page, async (route) => {
    await route.fulfill({ json: orderResponse, status: 201 });
  }, () => 100, [{
    id: "included-product",
    name: "Iced Tea",
    category: "Beverage",
    price: 45,
    is_available: true,
    is_included: true,
    is_sold_a_la_carte: true,
    cart_compatibility: {
      a_la_carte: { allowed: true, classification: "included_in_unlimited" },
      unlimited: { allowed: true, classification: "included_in_unlimited" }
    }
  }], "/staff/pos");

  await page.getByLabel("Product").selectOption("included-product");
  await page.getByRole("button", { name: "Add item" }).click();
  await expect.poll(() => conversionPrompt).toContain("Convert this cart to the Unlimited cart");
  await expect(page.getByRole("group", { name: "Order type" }).getByRole("button", { name: "Unlimited" })).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByText("1 × Iced Tea · Included")).toBeVisible();
});

test("main POS supports both carts, saved headcount, live Unlimited timer, and free configured extension", async ({ page }) => {
  let submittedOrder: Record<string, unknown> | undefined;
  let extensionPrompt = "";
  page.on("dialog", async (dialog) => {
    extensionPrompt = dialog.message();
    await dialog.accept();
  });
  await openDiningService(page, async (route) => {
    submittedOrder = route.request().postDataJSON() as Record<string, unknown>;
    await route.fulfill({ json: orderResponse, status: 201 });
  }, () => 100, [
    {
      id: "product-1",
      name: "California Roll",
      category: "Sushi",
      price: 100,
      is_available: true,
      is_included: false,
      is_sold_a_la_carte: true,
      cart_compatibility: {
        a_la_carte: { allowed: true, classification: "a_la_carte_only" },
        unlimited: { allowed: false, classification: "a_la_carte_only", message: "Not included in Unlimited." }
      }
    },
    {
      id: "included-product",
      name: "Iced Tea",
      category: "Beverage",
      price: 45,
      is_available: true,
      is_included: true,
      is_sold_a_la_carte: true,
      cart_compatibility: {
        a_la_carte: { allowed: true, classification: "included_in_unlimited" },
        unlimited: { allowed: true, classification: "included_in_unlimited" }
      }
    }
  ], "/staff/pos", 1);
  const orderBuilder = page.getByRole("region", { name: "POS order builder" });

  await page.getByLabel("Product").selectOption("product-1");
  await page.getByRole("button", { name: "Add item" }).click();
  await expect(page.getByText("1 × California Roll · PHP 100.00 each")).toBeVisible();

  await page.getByRole("group", { name: "Order type" }).getByRole("button", { name: "Unlimited" }).click();
  await expect(orderBuilder.getByText("Time Remaining")).toHaveCount(0);
  await page.getByLabel("Product").selectOption("included-product");
  await page.getByRole("button", { name: "Add item" }).click();
  await expect(page.getByText("1 × Iced Tea · Included")).toBeVisible();
  await page.getByLabel("Unlimited headcount").fill("3");

  const startRequestPromise = page.waitForRequest((request) =>
    request.method() === "POST" && request.url().endsWith("/sessions/session-1/unlimited-sessions")
  );
  await page.getByRole("button", { name: "Start session" }).click();
  const startRequest = await startRequestPromise;
  expect(startRequest.postDataJSON()).toEqual({ paxCount: 3 });
  await expect(page.getByText("3 covers × PHP 1,500.00")).toBeVisible();
  await expect(orderBuilder.getByText("Time Remaining")).toBeVisible();
  await expect(page.locator("text=/\\b\\d{2}:\\d{2}\\b/").first()).toBeVisible();

  const extensionRequestPromise = page.waitForRequest((request) =>
    request.method() === "POST" && request.url().endsWith("/unlimited-session-1/extend")
  );
  await orderBuilder.getByRole("button", { name: "Extend Session", exact: true }).click();
  const extensionRequest = await extensionRequestPromise;
  expect(extensionPrompt).toContain("30 minutes");
  expect(extensionPrompt).toContain("no fee");
  expect(extensionRequest.postData()).toBeNull();

  await page.getByRole("group", { name: "Order type" }).getByRole("button", { name: "A la carte" }).click();
  await expect(page.getByText("1 × California Roll · PHP 100.00 each")).toBeVisible();
  await page.getByRole("group", { name: "Order type" }).getByRole("button", { name: "Unlimited" }).click();
  await page.getByRole("button", { name: "Review order" }).click();
  await expect(page.getByTestId("order-review")).toContainText("Confirm Unlimited order · Table 4");
  const printPopupPromise = page.waitForEvent("popup");
  await page.getByTestId("order-review").getByRole("button", { name: "Confirm & Print" }).click();
  await printPopupPromise;
  expect(submittedOrder).toMatchObject({
    orderType: "unlimited",
    unlimitedSessionId: "unlimited-session-1",
    items: [{ productId: "included-product", quantity: 1, expectedUnitPrice: 0 }]
  });
});

test("preserves the dine-in cart when opening customer selection", async ({ page }) => {
  await openDiningService(page, async (route) => {
    await route.fulfill({ json: orderResponse, status: 201 });
  }, () => 100, undefined, "/staff/pos");
  await addOneOrderLine(page);

  await page.getByRole("button", { name: "New Customer" }).click();
  const serviceDialog = page.getByRole("dialog", { name: "New Customer" });
  await expect(serviceDialog.getByRole("button", { name: "Take-out" })).toBeVisible();
  await serviceDialog.getByRole("button", { name: "Take-out" }).click();
  await page.getByRole("dialog", { name: "Take-out" }).getByRole("button", { name: "Walk-in" }).click();
  await expect(page.getByRole("region", { name: "POS order builder" })).toContainText("Cart is empty");
  await page.getByRole("button", { name: "Existing Table" }).click();
  await page.getByRole("button", { name: "Select Table 4, Occupied" }).click();
  await expect(page.getByRole("region", { name: "POS order builder" }).getByText("2 × California Roll")).toBeVisible();
});

test("keeps separate a-la-carte and Unlimited carts while using one menu", async ({ page }) => {
  await openDiningService(page, async (route) => {
    await route.fulfill({ json: orderResponse, status: 201 });
  }, () => 100, [
    {
      id: "regular-product",
      name: "Regular Roll",
      category: "Sushi",
      price: 100,
      is_available: true,
      is_included: false,
      is_sold_a_la_carte: true,
      cart_compatibility: {
        a_la_carte: { allowed: true, classification: "a_la_carte_only" },
        unlimited: { allowed: false, classification: "a_la_carte_only", message: "Not included in Unlimited." }
      }
    },
    {
      id: "beverage-addon",
      name: "Bottled Water",
      category: "Beverage",
      price: 30,
      is_available: true,
      is_included: false,
      is_sold_a_la_carte: true,
      cart_compatibility: {
        a_la_carte: { allowed: true, classification: "beverage_add_on" },
        unlimited: { allowed: true, classification: "beverage_add_on" }
      }
    }
  ]);
  await page.getByLabel("Product").selectOption("regular-product");
  await page.getByRole("button", { name: "Add item" }).click();
  await expect(page.getByText("1 × Regular Roll · PHP 100.00 each")).toBeVisible();

  await page.getByRole("group", { name: "Order type" }).getByRole("button", { name: "Unlimited" }).click();
  await page.getByLabel("Product").selectOption("beverage-addon");
  await page.getByRole("button", { name: "Add item" }).click();
  await expect(page.getByText("1 × Bottled Water · PHP 30.00 each")).toBeVisible();

  await page.getByRole("group", { name: "Order type" }).getByRole("button", { name: "A la carte" }).click();
  await expect(page.getByText("1 × Regular Roll · PHP 100.00 each")).toBeVisible();
  await page.getByRole("group", { name: "Order type" }).getByRole("button", { name: "Unlimited" }).click();
  await expect(page.getByText("1 × Bottled Water · PHP 30.00 each")).toBeVisible();
});

test("shows guestless a-la-carte lines in checkout without a guest label", async ({ page }) => {
  await openDiningService(page, async (route) => {
    await route.fulfill({ json: orderResponse, status: 201 });
  });
  await page.getByRole("button", { name: "Review bill" }).click();
  await page.getByLabel("Total guests at this table").fill("10");
  await page.getByLabel("Senior/PWD guests").fill("3");
  await expect(page.getByText("2 × California Roll")).toBeVisible();
  await expect(page.getByText(/Guest null/)).toHaveCount(0);
  await expect(page.getByText(/Senior\/PWD discount \(3 of 10 guests; 20% of PHP 200.00 a-la-carte total\)/)).toBeVisible();
});

test("receipt uses saved a-la-carte base and rate instead of the whole-subtotal share", async ({ page }) => {
  let submittedCheckout: Record<string, unknown> | undefined;
  await openDiningService(page, async (route) => {
    await route.fulfill({ json: orderResponse, status: 201 });
  });
  await page.route("**/api/pos/dining/sessions/session-1/checkout", async (route) => {
    submittedCheckout = route.request().postDataJSON() as Record<string, unknown>;
    await route.fulfill({ status: 201, json: {
      replayed: false,
      transaction: {
        transaction_number: "POS-SENIOR-001",
        subtotal: 200,
        tax: 0,
        unlimited_amount: 0,
        leftover_amount: 0,
        discount_amount: 12,
        discount_base_snapshot: 200,
        discount_rate_snapshot: 0.2,
        guest_count: 10,
        discount_guest_count: 3,
        total: 188,
        payment_method: "cash",
        cash_received: 200,
        change_due: 12,
        created_at: "2026-10-19T12:00:00.000Z",
        table_number_snapshot: 4,
        items: [{
          quantity: 2,
          unit_price: 100,
          total_price: 200,
          name_snapshot: "California Roll",
          selling_product: { name: "California Roll" }
        }],
        charges: [],
        dining_session: { table: { table_number: 4 } }
      }
    } });
  });

  await page.getByRole("button", { name: "Review bill" }).click();
  await page.getByLabel("Total guests at this table").fill("10");
  await page.getByLabel("Senior/PWD guests").fill("3");
  await page.getByLabel("Cash received").fill("200");
  await expect(page.getByRole("button", { name: "Complete checkout" })).toBeEnabled();
  await page.getByRole("button", { name: "Complete checkout" }).click();
  await expect(page.getByText("Checkout complete")).toBeVisible();

  const receiptPromise = page.waitForEvent("popup");
  await page.getByRole("button", { name: "Print receipt" }).click();
  const receipt = await receiptPromise;
  await expect(receipt.locator("body")).toContainText("3 of 10 guests; 20% of PHP 200.00 a-la-carte total");
  await expect(receipt.locator("body")).toContainText("−PHP 12.00");
  await expect(receipt.locator("body")).not.toContainText("per-guest share");
  expect(submittedCheckout).toMatchObject({ guestCount: 10, seniorPwdCount: 3 });
});

test("offers conversion when the a-la-carte cart has included items and preserves them in Unlimited", async ({ page }) => {
  const dialogMessages: string[] = [];
  page.on("dialog", async (dialog) => {
    dialogMessages.push(dialog.message());
    await dialog.accept();
  });
  await openDiningService(page, async (route) => {
    await route.fulfill({ json: orderResponse, status: 201 });
  }, () => 100, [{
    id: "included-product",
    name: "Iced Tea",
    category: "Beverage",
    price: 45,
    is_available: true,
    is_included: true,
    is_sold_a_la_carte: true,
    cart_compatibility: {
      a_la_carte: { allowed: true, classification: "included_in_unlimited" },
      unlimited: { allowed: true, classification: "included_in_unlimited" }
    }
  }]);
  await page.getByLabel("Product").selectOption("included-product");
  await page.getByRole("button", { name: "Add item" }).click();
  await expect.poll(() => dialogMessages.length).toBe(1);
  expect(dialogMessages[0]).toContain("Convert this cart to the Unlimited cart");
  expect(dialogMessages[0]).toContain("beverage add-ons are charged at menu price");
  await expect(page.getByRole("group", { name: "Order type" }).getByRole("button", { name: "Unlimited" })).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByText("1 × Iced Tea · Included")).toBeVisible();
});

test("double-click commits only once", async ({ page }) => {
  let postCount = 0;
  page.on("dialog", (dialog) => dialog.accept());
  await openDiningService(page, async (route) => {
    postCount += 1;
    await new Promise((resolve) => setTimeout(resolve, 150));
    await route.fulfill({ json: orderResponse, status: 201 });
  });
  await addOneOrderLine(page);

  const popupPromise = page.waitForEvent("popup");
  await page.getByTestId("order-review").getByRole("button", { name: "Confirm & Print" }).dblclick({ delay: 20 });
  await popupPromise;
  await expect(page.getByRole("button", { name: "Reprint" })).toBeVisible();
  expect(postCount).toBe(1);
});

test("keeps the editable cart and requires a fresh review after a stale-price rejection", async ({ page }) => {
  const dialogMessages: string[] = [];
  let productPrice = 100;
  page.on("dialog", async (dialog) => {
    dialogMessages.push(dialog.message());
    await dialog.accept();
  });
  await openDiningService(page, async (route) => {
    productPrice = 125;
    await route.fulfill({
      status: 409,
      json: {
        code: "PRODUCT_PRICE_CHANGED",
        message: "California Roll's price has changed. Review the order again before confirming."
      }
    });
  }, () => productPrice);
  await addOneOrderLine(page);
  await page.evaluate(() => { window.open = () => null; });

  await page.getByTestId("order-review").getByRole("button", { name: "Confirm & Print" }).click();
  await expect.poll(() => dialogMessages.length).toBe(1);
  await expect(page.getByTestId("order-review")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Review order" })).toBeVisible();
  await expect(page.locator("text=PHP 125.00 each")).toBeVisible();
  expect(dialogMessages[0]).toContain("Review the order again before confirming");
  await page.getByRole("button", { name: "Review order" }).click();
  await expect(page.getByTestId("order-review")).toContainText("2 × California Roll at PHP 125.00");
  await expect(page.getByTestId("order-review")).toContainText("Total: PHP 250.00");
});

test("retries with the same idempotency key after an uncertain response", async ({ page }) => {
  const requests: Array<Record<string, unknown>> = [];
  const dialogMessages: string[] = [];
  let postCount = 0;
  page.on("dialog", async (dialog) => {
    dialogMessages.push(dialog.message());
    await dialog.accept();
  });
  await openDiningService(page, async (route) => {
    postCount += 1;
    requests.push(route.request().postDataJSON() as Record<string, unknown>);
    if (postCount === 1) {
      await route.fulfill({ status: 503, json: { message: "Temporary response failure" } });
      return;
    }
    await route.fulfill({ json: orderResponse, status: 200 });
  });
  await addOneOrderLine(page);
  await page.evaluate(() => {
    Object.defineProperty(window, "__originalOpen", { value: window.open.bind(window) });
    window.open = () => null;
  });

  await page.getByTestId("order-review").getByRole("button", { name: "Confirm & Print" }).click();
  await expect.poll(() => requests.length).toBe(1);
  await expect.poll(() => dialogMessages.length).toBe(1);
  expect(dialogMessages).toContain("Temporary response failure");
  await expect(page.getByTestId("order-review")).toBeVisible();
  const retryKey = requests[0].idempotencyKey;

  await page.evaluate(() => {
    window.open = Object.getOwnPropertyDescriptor(window, "__originalOpen")?.value ?? window.open;
  });
  const popupPromise = page.waitForEvent("popup");
  await page.getByTestId("order-review").getByRole("button", { name: "Confirm & Print" }).click();
  const popup = await popupPromise;
  await expect(popup.locator("body")).toContainText("DO-PRINT-001");
  await expect(page.getByRole("button", { name: "Reprint" })).toBeVisible();
  expect(postCount).toBe(2);
  expect(requests[1].idempotencyKey).toBe(retryKey);
});

test("keeps a committed order and offers print-only recovery when the first popup is blocked", async ({ page }) => {
  let postCount = 0;
  const dialogMessages: string[] = [];
  page.on("dialog", async (dialog) => {
    dialogMessages.push(dialog.message());
    await dialog.accept();
  });
  await openDiningService(page, async (route) => {
    postCount += 1;
    await route.fulfill({ json: orderResponse, status: 201 });
  });
  await addOneOrderLine(page);
  await page.evaluate(() => {
    Object.defineProperty(window, "__originalOpen", { value: window.open.bind(window) });
    window.open = () => null;
  });

  await page.getByTestId("order-review").getByRole("button", { name: "Confirm & Print" }).click();
  await expect(page.getByRole("button", { name: "Reprint" })).toBeVisible();
  expect(dialogMessages).toContain("The order was saved, but the print window was blocked. Use Reprint to try again.");
  expect(postCount).toBe(1);

  await page.evaluate(() => {
    window.open = Object.getOwnPropertyDescriptor(window, "__originalOpen")?.value ?? window.open;
  });
  const reprintPopupPromise = page.waitForEvent("popup");
  await page.getByRole("button", { name: "Reprint" }).click();
  const reprintedSlip = await reprintPopupPromise;
  await expect(reprintedSlip.locator("body")).toContainText("REPRINT");
  await expect(reprintedSlip.locator("body")).toContainText("DO-PRINT-001");
  expect(postCount).toBe(1);
});

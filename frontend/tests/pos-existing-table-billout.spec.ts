import { expect, test } from "@playwright/test";
import { expectPrintLinesWithin32 } from "./printAssertions";

const product = {
  id: "sushi-1",
  name: "Sushi Set",
  category: "Sushi",
  price: 1000,
  is_available: true,
  available_stock: 20,
  cart_compatibility: {
    a_la_carte: { allowed: true, classification: "a_la_carte_only" },
    unlimited: { allowed: true, classification: "a_la_carte_only" }
  }
};

function activeSession(unlimitedSessions: Array<Record<string, unknown>> = []) {
  return {
    id: "session-1",
    status: "active",
    table_id: "table-4",
    table: { id: "table-4", table_number: 4, capacity: 10 },
    guests: Array.from({ length: 10 }, (_, index) => ({ id: `guest-${index + 1}` })),
    orders: [] as Array<{ status: string; items: Array<{ total_price: number }> }>,
    unlimited_sessions: unlimitedSessions
  };
}

async function signIn(page: import("@playwright/test").Page) {
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
}

async function printBillAndContinue(
  page: import("@playwright/test").Page,
  billDialog: import("@playwright/test").Locator,
  beforeContinue?: () => void
) {
  const popupPromise = page.waitForEvent("popup");
  await billDialog.getByRole("button", { name: "Print Bill", exact: true }).click();
  const popup = await popupPromise;
  await expect(popup.locator("body")).toHaveAttribute("data-print-requested", "true");
  await expectPrintLinesWithin32(popup);
  const content = await popup.locator("pre").textContent() ?? "";
  beforeContinue?.();
  await popup.evaluate(() => window.dispatchEvent(new Event("afterprint")));
  await expect(page.getByRole("dialog", { name: "Checkout Table 4" })).toBeVisible();
  return content;
}

function printedAmount(text: string | null, label: string) {
  const line = text?.split("\n").find((candidate) => candidate.includes(label));
  const amount = line?.match(/PHP ([\d,]+\.\d{2})/)?.[1];
  if (!amount) throw new Error(`Missing printed amount for ${label}`);
  return Number(amount.replace(/,/g, ""));
}

test("existing table order can be committed, previewed with Senior/PWD discount, and billed out", async ({ page }) => {
  let currentSession: ReturnType<typeof activeSession> | null = activeSession();
  let confirmationCount = 0;
  let checkoutBody: Record<string, unknown> | null = null;
  let releaseCheckout = () => {};
  const checkoutGate = new Promise<void>((resolve) => {
    releaseCheckout = resolve;
  });
  let checkoutStartedResolve = () => {};
  const checkoutStarted = new Promise<void>((resolve) => {
    checkoutStartedResolve = resolve;
  });

  await page.setViewportSize({ width: 1280, height: 800 });
  await signIn(page);
  await page.route("**/api/**", async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname === "/api/products") {
      await route.fulfill({ json: { products: [product] } });
      return;
    }
    if (url.pathname === "/api/settings/system") {
      await route.fulfill({ json: { settings: { restaurant_name: "Katana", receipt_footer: "Thank you" } } });
      return;
    }
    if (url.pathname === "/api/pos/dining/tables") {
      await route.fulfill({ json: { tables: [{
        id: "table-4",
        table_number: 4,
        capacity: 10,
        status: "occupied",
        linked_to_table_id: null,
        unavailable_reason: null,
        active_session: { id: "session-1", guests: Array.from({ length: 10 }, (_, index) => ({ id: `guest-${index + 1}` })) }
      }] } });
      return;
    }
    if (url.pathname === "/api/pos/dining/sessions" && route.request().method() === "GET") {
      await route.fulfill({ json: { sessions: currentSession ? [currentSession] : [] } });
      return;
    }
    if (url.pathname === "/api/pos/dining/confirm-order") {
      confirmationCount += 1;
      if (currentSession) {
        currentSession.orders = [{ status: "committed", items: [{ total_price: 1000 }] }];
      }
      await route.fulfill({
        status: 201,
        json: {
          replayed: false,
          order: {
            id: "order-1",
            dining_session_id: "session-1",
            order_number: "DO-001",
            table_number_snapshot: 4,
            created_at: "2026-10-20T12:00:00.000Z",
            items: [{ id: "line-1", name_snapshot: "Sushi Set", quantity: 1, unit_price: 1000, total_price: 1000 }]
          }
        }
      });
      return;
    }
    if (url.pathname === "/api/pos/dining/sessions/session-1/checkout-preview") {
      const seniorPwdCount = Number(url.searchParams.get("seniorPwdCount"));
      const discountAmount = seniorPwdCount * 20;
      await route.fulfill({
        json: {
          session_id: "session-1",
          table_number: 4,
          guest_count: Number(url.searchParams.get("guestCount")),
          a_la_carte_lines: [{ name: "Sushi Set", quantity: 1, unit_price: 1000, total_price: 1000 }],
          unlimited_order_lines: [],
          unlimited_lines: [],
          leftover_lines: [],
          subtotal: 1000,
          unlimited_amount: 0,
          leftover_amount: 0,
          discount_base_snapshot: 1000,
          discount_rate_snapshot: 0.2,
          discounted_guest_count: seniorPwdCount,
          discount_amount: discountAmount,
          total: 1000 - discountAmount
        }
      });
      return;
    }
    if (url.pathname === "/api/pos/dining/sessions/session-1/checkout") {
      checkoutBody = route.request().postDataJSON() as Record<string, unknown>;
      currentSession = null;
      checkoutStartedResolve();
      await checkoutGate;
      await route.fulfill({
        status: 201,
        json: {
          replayed: false,
          transaction: {
            id: "transaction-1",
            transaction_number: "POS-001",
            transaction_type: "dine_in",
            subtotal: 1000,
            tax: 0,
            total: 940,
            payment_method: "cash",
            cash_received: 1000,
            change_due: 60,
            created_at: "2026-10-20T12:30:00.000Z",
            items: [{ quantity: 1, unit_price: 1000, total_price: 1000, selling_product: { name: "Sushi Set" } }],
            charges: []
          }
        }
      });
      return;
    }
    await route.fulfill({ json: {} });
  });

  await page.goto("/staff/pos");
  await page.getByRole("button", { name: "Existing Table" }).click();
  await page.getByRole("button", { name: "Select Table 4, Occupied" }).click();
  const orderBuilder = page.getByRole("region", { name: "POS order builder" });
  const cartPanel = page.getByTestId("pos-cart-panel");
  await expect(cartPanel).toHaveCSS("position", "sticky");
  const cartHeight = await cartPanel.evaluate((element) => element.getBoundingClientRect().height);
  const viewportHeight = await page.evaluate(() => window.innerHeight);
  expect(cartHeight).toBe(viewportHeight - 32);
  await expect(orderBuilder.getByRole("button", { name: "Checkout" })).toHaveCount(0);
  await expect(orderBuilder.getByText(/checkout/i)).toHaveCount(0);
  await page.getByRole("button", { name: /Sushi Set Sushi/ }).click();

  const slipPopup = page.waitForEvent("popup");
  await orderBuilder.getByRole("button", { name: "Print order" }).click();
  const slip = await slipPopup;
  await expect(slip.locator("body")).toContainText("DO-001");
  await expect(slip.locator("body")).toContainText("Table: 4");
  await expect(slip.locator("body")).toContainText("Sushi Set");
  await expect(slip.locator("body")).toContainText("ORDER SLIP - NOT A RECEIPT");
  await expect(slip.locator("body")).toContainText("Cashier: Test Cashier");
  await expect(slip.locator("body")).toContainText("Table total so far");
  await expect(slip.locator("body")).not.toContainText(/address|\bTIN\b|official receipt|\binvoice\b/i);
  await expectPrintLinesWithin32(slip);
  await expect(orderBuilder.getByRole("button", { name: "Print Bill" })).toBeVisible();
  expect(confirmationCount).toBe(1);

  await orderBuilder.getByRole("button", { name: "Print Bill" }).click();
  const billOut = page.getByRole("dialog", { name: "Print Bill Table 4" });
  await expect(billOut.getByLabel("Bill-out guest count")).toHaveCount(0);
  await expect(billOut.getByLabel("Senior/PWD guest count")).toHaveCount(0);
  await expect(billOut.getByRole("group", { name: "Bill-out payment method" })).toHaveCount(0);
  await billOut.getByRole("button", { name: "Apply Discount" }).click();
  await billOut.getByLabel("Bill-out guest count").fill("10");
  await billOut.getByLabel("Senior/PWD guest count").fill("3");
  await expect(billOut).toContainText("Senior/PWD discount (3 guests × 20% of PHP 1,000.00 a-la-carte total)");
  await expect(billOut).toContainText("PHP 940.00");

  const billSlipText = await printBillAndContinue(page, billOut, () => {
    expect(checkoutBody).toBeNull();
  });
  const checkout = page.getByRole("dialog", { name: "Checkout Table 4" });
  const paymentMethods = checkout.getByRole("group", { name: "Bill-out payment method" });
  await expect(paymentMethods.getByRole("button", { name: "Cash", exact: true })).toBeVisible();
  await expect(paymentMethods.getByRole("button", { name: "GCash", exact: true })).toBeVisible();
  await expect(paymentMethods.getByRole("button", { name: "BPI", exact: true })).toBeVisible();
  await checkout.getByLabel("Bill-out cash received").fill("1000");
  await expect(checkout).toContainText("Change: PHP 60.00");

  const receiptPopup = page.waitForEvent("popup");
  await checkout.getByRole("button", { name: "Complete Payment" }).click();
  const receipt = await receiptPopup;
  await checkoutStarted;
  expect(billSlipText).toContain("BILL SLIP - NOT A RECEIPT");
  expect(billSlipText).toContain("TOTAL TO PAY");
  expect(billSlipText).toContain("PHP 940.00");
  expect(billSlipText).not.toContain("Payment:");
  expect(billSlipText).not.toMatch(/address|\bTIN\b|official receipt|\binvoice\b/i);
  await expect(receipt.locator("body")).not.toContainText("POS-001");
  releaseCheckout();
  await expect(receipt.locator("body")).toContainText("POS-001");
  await expect(receipt.locator("body")).toContainText("PAID");
  await expect(receipt.locator("body")).toContainText("Thank you");
  await expect(receipt.locator("body")).toContainText("TOTAL PAID");
  await expect(receipt.locator("body")).not.toContainText(/address|\bTIN\b|official receipt|\binvoice\b/i);
  const billSlipTotal = printedAmount(billSlipText, "TOTAL TO PAY");
  const receiptTotal = printedAmount(await receipt.locator("pre").textContent(), "TOTAL PAID");
  expect(billSlipTotal).toBe(receiptTotal);
  expect(receiptTotal).toBe(940);
  await expect(receipt.locator("body")).toContainText("PHP 940.00");
  await expect(receipt.locator("body")).toHaveAttribute("data-print-requested", "true");
  await expectPrintLinesWithin32(receipt);
  expect(checkoutBody).not.toBeNull();
  expect(Number((checkoutBody as Record<string, unknown> | null)?.cashReceived)).toBe(1000);
  expect(Number((checkoutBody as Record<string, unknown> | null)?.seniorPwdCount)).toBe(3);
  expect(checkoutBody).toMatchObject({
    guestCount: 10,
    seniorPwdCount: 3,
    paymentMethod: "cash",
    cashReceived: 1000
  });
  await expect(orderBuilder.getByRole("button", { name: "Print Bill" })).toHaveCount(0);
});

test("bill-out warns when the charged total differs from the printed preview", async ({ page }) => {
  const session = activeSession();
  session.orders = [{ status: "committed", items: [{ total_price: 100 }] }];
  await signIn(page);
  await page.route("**/api/**", async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname === "/api/products") {
      await route.fulfill({ json: { products: [] } });
      return;
    }
    if (url.pathname === "/api/settings/system") {
      await route.fulfill({ json: { settings: { receipt_paper_size: "58mm" } } });
      return;
    }
    if (url.pathname === "/api/pos/dining/tables") {
      await route.fulfill({ json: { tables: [{
        id: "table-4",
        table_number: 4,
        capacity: 10,
        status: "occupied",
        linked_to_table_id: null,
        unavailable_reason: null,
        active_session: { id: "session-1", guests: session.guests }
      }] } });
      return;
    }
    if (url.pathname === "/api/pos/dining/sessions" && route.request().method() === "GET") {
      await route.fulfill({ json: { sessions: [session] } });
      return;
    }
    if (url.pathname === "/api/pos/dining/sessions/session-1/checkout-preview") {
      await route.fulfill({ json: {
        session_id: "session-1",
        table_number: 4,
        guest_count: 10,
        a_la_carte_lines: [{ name: "Sushi Set", quantity: 1, unit_price: 100, total_price: 100 }],
        unlimited_order_lines: [],
        unlimited_lines: [],
        leftover_lines: [],
        subtotal: 100,
        unlimited_amount: 0,
        leftover_amount: 0,
        discount_base_snapshot: 100,
        discount_rate_snapshot: 0.2,
        discounted_guest_count: 0,
        discount_amount: 0,
        total: 100
      } });
      return;
    }
    if (url.pathname === "/api/pos/dining/sessions/session-1/checkout") {
      await route.fulfill({ status: 201, json: { transaction: {
        id: "transaction-2",
        transaction_number: "POS-MISMATCH-001",
        transaction_type: "dine_in",
        subtotal: 100,
        tax: 0,
        total: 99,
        payment_method: "cash",
        cash_received: 100,
        change_due: 1,
        created_at: "2026-10-20T12:30:00.000Z",
        items: [{ quantity: 1, unit_price: 100, total_price: 100, selling_product: { name: "Sushi Set" } }],
        charges: []
      } } });
      return;
    }
    await route.fulfill({ json: {} });
  });

  await page.goto("/staff/pos");
  await page.getByRole("button", { name: "Existing Table" }).click();
  await page.getByRole("button", { name: "Select Table 4, Occupied" }).click();
  await page.getByRole("button", { name: "Print Bill" }).click();
  const billOut = page.getByRole("dialog", { name: "Print Bill Table 4" });
  await printBillAndContinue(page, billOut);
  const checkout = page.getByRole("dialog", { name: "Checkout Table 4" });
  await checkout.getByLabel("Bill-out cash received").fill("100");
  const receiptPopup = page.waitForEvent("popup");
  await checkout.getByRole("button", { name: "Complete Payment" }).click();
  await receiptPopup;
  await expect(page.getByText("Bill slip total PHP 100.00 differs from charged total PHP 99.00")).toBeVisible();
});

test("Unlimited-only table bill out does not offer a discount", async ({ page }) => {
  const session = activeSession([{
    id: "unlimited-1",
    status: "active",
    pax_count: 10,
    price_per_pax: 700
  }]);

  await signIn(page);
  await page.route("**/api/**", async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname === "/api/pos/dining/tables") {
      await route.fulfill({ json: { tables: [{
        id: "table-4",
        table_number: 4,
        capacity: 10,
        status: "occupied",
        linked_to_table_id: null,
        unavailable_reason: null,
        active_session: { id: "session-1", guests: session.guests }
      }] } });
      return;
    }
    if (url.pathname === "/api/pos/dining/sessions" && route.request().method() === "GET") {
      await route.fulfill({ json: { sessions: [session] } });
      return;
    }
    if (url.pathname === "/api/pos/dining/sessions/session-1/checkout-preview") {
      await route.fulfill({ json: {
        session_id: "session-1",
        table_number: 4,
        guest_count: 10,
        subtotal: 7000,
        discount_base_snapshot: 0,
        discount_rate_snapshot: 0.2,
        discounted_guest_count: 0,
        discount_amount: 0,
        total: 7000
      } });
      return;
    }
    await route.fulfill({ json: {} });
  });

  await page.goto("/staff/pos");
  await page.getByRole("button", { name: "Existing Table" }).click();
  await page.getByRole("button", { name: "Select Table 4, Occupied" }).click();
  await page.getByRole("button", { name: "Print Bill" }).click();

  const billOut = page.getByRole("dialog", { name: "Print Bill Table 4" });
  await expect(billOut.getByText("PHP 7,000.00").first()).toBeVisible();
  await expect(billOut.getByRole("button", { name: "Apply Discount" })).toHaveCount(0);
  await expect(billOut.getByLabel("Bill-out guest count")).toHaveCount(0);
  await expect(billOut.getByLabel("Senior/PWD guest count")).toHaveCount(0);
});

test("Mixed Unlimited and a-la-carte table bill out offers a discount on the a-la-carte portion", async ({ page }) => {
  const session = activeSession([{
    id: "unlimited-1",
    status: "active",
    pax_count: 10,
    price_per_pax: 700
  }]);

  await signIn(page);
  await page.route("**/api/**", async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname === "/api/pos/dining/tables") {
      await route.fulfill({ json: { tables: [{
        id: "table-4",
        table_number: 4,
        capacity: 10,
        status: "occupied",
        linked_to_table_id: null,
        unavailable_reason: null,
        active_session: { id: "session-1", guests: session.guests }
      }] } });
      return;
    }
    if (url.pathname === "/api/pos/dining/sessions" && route.request().method() === "GET") {
      await route.fulfill({ json: { sessions: [session] } });
      return;
    }
    if (url.pathname === "/api/pos/dining/sessions/session-1/checkout-preview") {
      const seniorPwdCount = Number(url.searchParams.get("seniorPwdCount"));
      const discountAmount = seniorPwdCount * 20;
      await route.fulfill({ json: {
        session_id: "session-1",
        table_number: 4,
        guest_count: 10,
        subtotal: 8000,
        discount_base_snapshot: 1000,
        discount_rate_snapshot: 0.2,
        discounted_guest_count: seniorPwdCount,
        discount_amount: discountAmount,
        total: 8000 - discountAmount
      } });
      return;
    }
    await route.fulfill({ json: {} });
  });

  await page.goto("/staff/pos");
  await page.getByRole("button", { name: "Existing Table" }).click();
  await page.getByRole("button", { name: "Select Table 4, Occupied" }).click();
  await page.getByRole("button", { name: "Print Bill" }).click();

  const billOut = page.getByRole("dialog", { name: "Print Bill Table 4" });
  await billOut.getByRole("button", { name: "Apply Discount" }).click();
  await billOut.getByLabel("Senior/PWD guest count").fill("3");
  await expect(billOut).toContainText("Senior/PWD discount (3 guests × 20% of PHP 1,000.00 a-la-carte total)");
  await expect(billOut).toContainText("PHP 7,940.00");
});

test("active Unlimited session filters to included products and allows the full menu toggle", async ({ page }) => {
  const products = [
    {
      id: "included-roll",
      name: "Included Roll",
      category: "Rolls",
      price: 250,
      is_available: true,
      cart_compatibility: {
        a_la_carte: { allowed: true, classification: "included_in_unlimited" },
        unlimited: { allowed: true, classification: "included_in_unlimited" }
      }
    },
    {
      id: "unlimited-only",
      name: "Unlimited-only Roll",
      category: "Rolls",
      price: 300,
      is_available: true,
      cart_compatibility: {
        a_la_carte: { allowed: false, classification: "unlimited_only" },
        unlimited: { allowed: true, classification: "unlimited_only" }
      }
    },
    {
      id: "beverage",
      name: "Iced Tea",
      category: "Beverage",
      price: 100,
      is_available: true,
      cart_compatibility: {
        a_la_carte: { allowed: true, classification: "beverage_add_on" },
        unlimited: { allowed: true, classification: "beverage_add_on" }
      }
    },
    {
      id: "ala-carte-only",
      name: "A la carte Maki",
      category: "Maki",
      price: 250,
      is_available: true,
      cart_compatibility: {
        a_la_carte: { allowed: true, classification: "a_la_carte_only" },
        unlimited: { allowed: false, classification: "a_la_carte_only" }
      }
    }
  ];
  const session = {
    ...activeSession([{
      id: "unlimited-1",
      status: "active",
      pax_count: 2,
      price_per_pax: 700,
      ends_at: "2026-10-28T12:00:00.000Z",
      first_round_at: null,
      extensions: []
    }]),
    table: { table_number: 4 }
  };

  await signIn(page);
  await page.route("**/api/**", async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname === "/api/products") {
      await route.fulfill({ json: { products } });
      return;
    }
    if (url.pathname === "/api/pos/dining/tables") {
      await route.fulfill({ json: { tables: [{
        id: "table-4",
        table_number: 4,
        capacity: 10,
        status: "occupied",
        linked_to_table_id: null,
        unavailable_reason: null,
        active_session: { id: "session-1", guests: session.guests }
      }] } });
      return;
    }
    if (url.pathname === "/api/pos/dining/sessions" && route.request().method() === "GET") {
      await route.fulfill({ json: { sessions: [session] } });
      return;
    }
    if (url.pathname === "/api/admin/unlimited/settings") {
      await route.fulfill({ json: { settings: { price_per_person: 700, extension_minutes: 30 } } });
      return;
    }
    await route.fulfill({ json: {} });
  });

  await page.goto("/staff/pos");
  await page.getByRole("button", { name: "Existing Table" }).click();
  await page.getByRole("button", { name: "Select Table 4, Occupied" }).click();
  const builder = page.getByRole("region", { name: "POS order builder" });
  await expect(builder.getByText("Showing Unlimited items only")).toBeVisible();
  await expect(builder.getByRole("button", { name: /Included Roll/ })).toBeVisible();
  await expect(builder.getByRole("button", { name: /Unlimited-only Roll/ })).toBeVisible();
  await expect(builder.getByRole("button", { name: /Iced Tea/ })).toHaveCount(0);
  await expect(builder.getByRole("button", { name: /A la carte Maki/ })).toHaveCount(0);

  await builder.getByLabel("Show all items").check();
  await expect(builder.getByText("Showing all menu items")).toBeVisible();
  await expect(builder.getByRole("button", { name: /Iced Tea/ })).toBeVisible();
  await builder.getByRole("button", { name: /A la carte Maki/ }).click();
  await expect(builder).toContainText("1 × A la carte Maki");
});

test("Unlimited cart mode does not start a timer until staff starts the existing table session", async ({ page }) => {
  let unlimitedSession: Record<string, unknown> | null = null;
  let startRequestBody: Record<string, unknown> | null = null;
  let extensionRequests = 0;
  let endRequests = 0;
  page.on("dialog", async (dialog) => {
    if (dialog.type() === "confirm") {
      if (dialog.message().startsWith("Extend this Unlimited session")) {
        expect(dialog.message()).toContain("30 minutes");
        expect(dialog.message()).toContain("There is no fee");
      }
    }
    await dialog.accept();
  });
  await signIn(page);
  await page.route("**/api/**", async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname === "/api/products") {
      await route.fulfill({ json: { products: [product] } });
      return;
    }
    if (url.pathname === "/api/settings/system") {
      await route.fulfill({ json: { settings: {} } });
      return;
    }
    if (url.pathname === "/api/admin/unlimited/settings") {
      await route.fulfill({ json: { settings: { price_per_person: 1500, extension_minutes: 30 } } });
      return;
    }
    if (url.pathname === "/api/pos/dining/tables") {
      await route.fulfill({ json: { tables: [{
        id: "table-4", table_number: 4, capacity: 10, status: "occupied",
        linked_to_table_id: null, unavailable_reason: null,
        active_session: { id: "session-1", guests: [] }
      }] } });
      return;
    }
    if (url.pathname === "/api/pos/dining/sessions" && route.request().method() === "GET") {
      await route.fulfill({ json: { sessions: [activeSession(unlimitedSession ? [unlimitedSession] : [])] } });
      return;
    }
    if (url.pathname === "/api/pos/dining/sessions/session-1/unlimited-sessions" && route.request().method() === "POST") {
      startRequestBody = route.request().postDataJSON() as Record<string, unknown>;
      const started = new Date();
      unlimitedSession = {
        id: "unlimited-1",
        pax_count: Number(startRequestBody.paxCount),
        price_per_pax: 1500,
        status: "active",
        first_round_at: started.toISOString(),
        ends_at: new Date(started.getTime() + 90 * 60_000).toISOString(),
        extensions: []
      };
      await route.fulfill({ status: 201, json: { unlimited_session: unlimitedSession } });
      return;
    }
    if (url.pathname === "/api/pos/dining/unlimited-sessions/unlimited-1/extend" && route.request().method() === "POST") {
      extensionRequests += 1;
      if (unlimitedSession) {
        const endsAt = new Date(String(unlimitedSession.ends_at));
        unlimitedSession = {
          ...unlimitedSession,
          ends_at: new Date(endsAt.getTime() + 30 * 60_000).toISOString()
        };
      }
      await route.fulfill({ json: { extension: { minutes: 30 }, session: unlimitedSession } });
      return;
    }
    if (url.pathname === "/api/pos/dining/unlimited-sessions/unlimited-1/end" && route.request().method() === "POST") {
      endRequests += 1;
      if (unlimitedSession) unlimitedSession = { ...unlimitedSession, status: "completed" };
      await route.fulfill({ json: { session: unlimitedSession } });
      return;
    }
    await route.fulfill({ json: {} });
  });

  await page.goto("/staff/pos");
  await page.getByRole("button", { name: "Existing Table" }).click();
  await page.getByRole("button", { name: "Select Table 4, Occupied" }).click();
  await page.getByRole("button", { name: "Unlimited", exact: true }).click();
  const guestCountDialog = page.getByRole("dialog", { name: "Unlimited guest count" });
  await guestCountDialog.getByLabel("Unlimited guest count").fill("3");
  await guestCountDialog.getByRole("button", { name: "Continue" }).click();
  await page.getByLabel("Unlimited headcount").fill("3");
  await expect(page.getByText("Unlimited package: 3 × PHP 1,500.00 = PHP 4,500.00")).toBeVisible();
  await expect(page.getByRole("button", { name: "Start Unlimited Session" })).toBeVisible();
  await expect(page.getByText("Time Remaining")).toHaveCount(0);

  await page.getByRole("button", { name: "Start Unlimited Session" }).click();
  expect(startRequestBody).toEqual({ paxCount: 3 });
  await expect(page.getByText("Time Remaining")).toBeVisible();
  await expect(page.getByText("Time Remaining")).toHaveCount(1);
  await expect(page.getByText("Timer starts after first round")).toHaveCount(0);

  await page.getByRole("button", { name: "New Customer" }).click();
  await expect(page.getByRole("dialog", { name: "New Customer" })).toBeVisible();
  await expect(page.getByRole("button", { name: "End Session", exact: true })).toHaveCount(0);
  await expect(page.getByText("Time Remaining")).toHaveCount(0);
  await page.getByRole("button", { name: "Close dialog" }).click();
  await page.getByRole("button", { name: "Existing Table" }).click();
  await page.getByRole("button", { name: "Select Table 4, Occupied" }).click();
  await expect(page.getByRole("button", { name: "End Session", exact: true })).toBeVisible();

  await page.getByRole("button", { name: "Extend Session" }).click();
  await expect.poll(() => extensionRequests).toBe(1);
  await expect(page.getByText("Adds 30 minutes · no fee")).toBeVisible();
  await page.getByRole("button", { name: "End Session", exact: true }).click();
  await expect.poll(() => endRequests).toBe(1);
  await expect(page.getByRole("button", { name: "End Session", exact: true })).toHaveCount(0);
});

test("one table cart keeps regular a-la-carte and Unlimited items together with separate pricing", async ({ page }) => {
  const confirmationBodies: Array<Record<string, unknown>> = [];
  const products = [
    {
      id: "regular-1",
      name: "A la carte Maki",
      category: "Maki",
      price: 250,
      is_available: true,
      available_stock: 10,
      cart_compatibility: {
        a_la_carte: { allowed: true, classification: "a_la_carte_only" },
        unlimited: { allowed: false, classification: "a_la_carte_only" }
      }
    },
    {
      id: "unlimited-1",
      name: "Unlimited Roll",
      category: "Maki",
      price: 500,
      is_available: true,
      available_stock: 10,
      cart_compatibility: {
        a_la_carte: { allowed: false, classification: "unlimited_only" },
        unlimited: { allowed: true, classification: "unlimited_only" }
      }
    }
  ];
  await signIn(page);
  await page.route("**/api/**", async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname === "/api/products") {
      await route.fulfill({ json: { products } });
      return;
    }
    if (url.pathname === "/api/settings/system") {
      await route.fulfill({ json: { settings: {} } });
      return;
    }
    if (url.pathname === "/api/admin/unlimited/settings") {
      await route.fulfill({ json: { settings: { price_per_person: 1500, extension_minutes: 30 } } });
      return;
    }
    if (url.pathname === "/api/pos/dining/tables") {
      await route.fulfill({ json: { tables: [{
        id: "table-4", table_number: 4, capacity: 10, status: "occupied",
        linked_to_table_id: null, unavailable_reason: null,
        active_session: { id: "session-1", guests: [] }
      }] } });
      return;
    }
    if (url.pathname === "/api/pos/dining/sessions" && route.request().method() === "GET") {
      await route.fulfill({ json: { sessions: [activeSession()] } });
      return;
    }
    if (url.pathname === "/api/pos/dining/confirm-order") {
      confirmationBodies.push(route.request().postDataJSON() as Record<string, unknown>);
      await route.fulfill({
        status: 201,
        json: {
          replayed: false,
          order: {
            id: "mixed-order-1",
            dining_session_id: "session-1",
            order_number: "DO-MIXED-001",
            table_number_snapshot: 4,
            created_at: "2026-10-23T12:00:00.000Z",
            items: [
              { id: "line-1", name_snapshot: "A la carte Maki", quantity: 1, unit_price: 250, total_price: 250 },
              { id: "line-2", name_snapshot: "Unlimited Roll", quantity: 1, unit_price: 0, total_price: 0 }
            ]
          }
        }
      });
      return;
    }
    await route.fulfill({ json: {} });
  });

  await page.goto("/staff/pos");
  await page.getByRole("button", { name: "Existing Table" }).click();
  await page.getByRole("button", { name: "Select Table 4, Occupied" }).click();
  const builder = page.getByRole("region", { name: "POS order builder" });
  await builder.getByRole("button", { name: /A la carte Maki/ }).click();
  await expect(builder).toContainText("A la carte · PHP 250.00");
  await page.getByRole("button", { name: "Unlimited", exact: true }).click();
  const guestCountDialog = page.getByRole("dialog", { name: "Unlimited guest count" });
  await guestCountDialog.getByLabel("Unlimited guest count").fill("3");
  await guestCountDialog.getByRole("button", { name: "Continue" }).click();
  await page.getByLabel("Unlimited headcount").fill("3");
  await builder.getByRole("button", { name: /Unlimited Roll/ }).click();

  await expect(builder).toContainText("A la carte Maki");
  await expect(builder).toContainText("Unlimited Roll");
  await expect(builder).toContainText("Unlimited included");
  await expect(builder).toContainText("Unlimited package · due at bill-out");
  await expect(builder).toContainText("PHP 4,750.00");

  const slipPromise = page.waitForEvent("popup");
  await page.getByRole("button", { name: "Print order" }).click();
  const slip = await slipPromise;
  await expect(slip.locator("body")).toContainText("DO-MIXED-001");
  expect(confirmationBodies).toHaveLength(1);
  expect(confirmationBodies[0]).toMatchObject({
    orderType: "unlimited",
    paxCount: 3,
    items: [
      { productId: "regular-1", quantity: 1, orderType: "ala_carte", expectedUnitPrice: 250 },
      { productId: "unlimited-1", quantity: 1, orderType: "unlimited", expectedUnitPrice: 0 }
    ]
  });
});

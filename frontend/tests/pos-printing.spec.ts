import { expect, test, type Page } from "@playwright/test";
import { expectPrintLinesWithin32 } from "./printAssertions";

const committedOrder = {
  id: "order-1",
  dining_session_id: "session-1",
  order_number: "DO-PRINT-001",
  table_number_snapshot: 4,
  created_at: "2026-10-20T12:00:00.000Z",
  items: [{
    id: "line-1",
    name_snapshot: "California Roll",
    quantity: 2,
    unit_price: 100,
    total_price: 200
  }]
};

const session = {
  id: "session-1",
  status: "active",
  table_id: "table-4",
  table: { id: "table-4", table_number: 4, capacity: 10 },
  guests: Array.from({ length: 10 }, (_, index) => ({ id: `guest-${index + 1}` })),
  orders: [{
    status: "committed",
    items: [{ total_price: 200 }, { total_price: 150 }]
  }],
  unlimited_sessions: []
};

async function setUp(page: Page, includeOrder = false) {
  await page.context().addInitScript((hasOrder) => {
    localStorage.setItem("katana_token", "playwright-token");
    localStorage.setItem("katana_role", "cashier");
    localStorage.setItem("katana_user", JSON.stringify({
      id: "cashier-1",
      email: "cashier@example.test",
      name: "Test Cashier",
      role: "cashier"
    }));
    if (hasOrder) localStorage.setItem("katana_last_committed_dining_order_id", "order-1");
    window.print = () => document.body.setAttribute("data-print-requested", "true");
  }, includeOrder);
}

test("printer test slip invokes print and keeps every line plain and within 32 characters", async ({ page }) => {
  await setUp(page);
  await page.route("**/api/**", async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname === "/api/settings/system") {
      await route.fulfill({ json: { settings: { receipt_paper_size: "58mm" } } });
      return;
    }
    await route.fulfill({ json: {} });
  });

  await page.goto("/staff/pos");
  await page.getByText("More", { exact: true }).click();
  const popupPromise = page.waitForEvent("popup");
  await page.getByRole("button", { name: "Print test slip" }).click();
  const popup = await popupPromise;
  await expect(popup.locator("body")).toHaveAttribute("data-print-requested", "true");
  await expectPrintLinesWithin32(popup);
  const printContent = await popup.locator("pre").textContent() ?? "";
  const printLines = printContent.split("\n");
  const edgeLine = `|${"-".repeat(30)}|`;
  expect(printLines).toContain("12345678901234567890123456789012");
  expect(printLines.filter((line) => line === edgeLine)).toHaveLength(2);
  expect(printContent).toContain("Paper width: 58mm");
  expect(printContent).toContain("Printable area: 48 mm");
  expect(printContent).toContain("ORDER SLIP - NOT A RECEIPT");
  expect(printContent).toContain("BILL SLIP - NOT A RECEIPT");
  expect(printContent).toContain("SAMPLE SUSHI");
  expect(printContent).toContain("RECEIPT");
  expect(printContent).toContain("PAID");
  expect(printContent).not.toMatch(/address|\bTIN\b|official receipt|\binvoice\b/i);

  const printStyle = await popup.locator("style").textContent() ?? "";
  expect(printStyle).toContain("@page { size: 58mm auto; margin: 0; }");
  expect(printStyle).toContain("font: 7pt/1.2");
  const layout = await popup.locator("pre").evaluate((element) => ({
    width: element.getBoundingClientRect().width,
    fontSize: Number.parseFloat(getComputedStyle(element).fontSize)
  }));
  expect(layout.width).toBeLessThanOrEqual((48 * 96) / 25.4);
  expect(layout.fontSize).toBeCloseTo((7 * 96) / 72, 2);
});

test("reprinting a committed order prints saved session totals without committing or changing stock", async ({ page }) => {
  const writeRequests: string[] = [];
  await setUp(page, true);
  page.on("request", (request) => {
    if (request.url().includes("/api/") && request.method() !== "GET") {
      writeRequests.push(`${request.method()} ${new URL(request.url()).pathname}`);
    }
  });
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
    if (url.pathname === "/api/pos/dining/sessions") {
      await route.fulfill({ json: { sessions: [session] } });
      return;
    }
    if (url.pathname === "/api/pos/dining/orders/order-1") {
      await route.fulfill({ json: { order: committedOrder } });
      return;
    }
    await route.fulfill({ json: {} });
  });

  await page.goto("/staff/pos");
  await page.getByRole("button", { name: "Existing table", exact: true }).click();
  await page.getByRole("button", { name: "Select Table 4, Occupied" }).click();
  const popupPromise = page.waitForEvent("popup");
  await page.getByRole("button", { name: "Reprint", exact: true }).click();
  const popup = await popupPromise;

  await expect(popup.locator("body")).toHaveAttribute("data-print-requested", "true");
  await expect(popup.locator("pre")).toContainText("REPRINT");
  await expect(popup.locator("pre")).toContainText("DO-PRINT-001");
  await expect(popup.locator("pre")).toContainText("PHP 350.00");
  await expectPrintLinesWithin32(popup);
  expect(writeRequests).toEqual([]);
});

test("takeout opens its receipt window before checkout finishes", async ({ page }) => {
  let releaseCheckout = () => {};
  const checkoutGate = new Promise<void>((resolve) => {
    releaseCheckout = resolve;
  });
  let checkoutStartedResolve = () => {};
  const checkoutStarted = new Promise<void>((resolve) => {
    checkoutStartedResolve = resolve;
  });

  await setUp(page);
  await page.route("**/api/**", async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname === "/api/products") {
      await route.fulfill({ json: { products: [{
        id: "product-1",
        name: "California Roll",
        category: "Sushi",
        price: 100,
        is_available: true,
        available_stock: 5
      }] } });
      return;
    }
    if (url.pathname === "/api/settings/system") {
      await route.fulfill({ json: { settings: { restaurant_name: "Katana Sushi", receipt_paper_size: "58mm" } } });
      return;
    }
    if (url.pathname === "/api/pos/transaction" && route.request().method() === "POST") {
      const body = route.request().postDataJSON() as Record<string, unknown>;
      if (body.previewOnly) {
        await route.fulfill({ json: {
          subtotal: 100,
          tax: 0,
          discount_base_snapshot: 0,
          discount_rate_snapshot: 0.2,
          discounted_guest_count: 0,
          discount_amount: 0,
          total: 100
        } });
        return;
      }
      checkoutStartedResolve();
      await checkoutGate;
      await route.fulfill({ status: 201, json: { transaction: {
        id: "transaction-1",
        transaction_number: "POS-TAKEOUT-001",
        transaction_type: "takeout",
        subtotal: 100,
        tax: 0,
        total: 100,
        payment_method: "cash",
        cash_received: 150,
        change_due: 50,
        created_at: "2026-10-20T12:00:00.000Z",
        items: [{
          quantity: 1,
          unit_price: 100,
          total_price: 100,
          selling_product: { name: "California Roll" }
        }]
      } } });
      return;
    }
    await route.fulfill({ json: {} });
  });

  await page.goto("/staff/pos");
  await page.getByRole("region", { name: "POS order builder" }).getByRole("button", { name: /California Roll Sushi/ }).click();
  await page.getByRole("button", { name: "Checkout" }).click();
  const payment = page.getByRole("dialog", { name: "Payment" });
  await payment.getByRole("button", { name: "Cash", exact: true }).click();
  await payment.getByLabel("Enter Amount Received").fill("150");

  const popupPromise = page.waitForEvent("popup");
  await payment.getByRole("button", { name: "Confirm" }).click();
  const popup = await popupPromise;
  await checkoutStarted;
  await expect(popup.locator("body")).not.toContainText("POS-TAKEOUT-001");
  releaseCheckout();
  await expect(popup.locator("body")).toContainText("POS-TAKEOUT-001");
  await expect(popup.locator("body")).toHaveAttribute("data-print-requested", "true");
  await expectPrintLinesWithin32(popup);
});

import { expect, test, type Page } from "@playwright/test";
import { renderCateringReceipt } from "../src/print/receiptTemplates";
import { RECEIPT_LOGO_DATA_URL } from "../src/print/receiptLogo";
import { expectPrintLinesWithin32, finishReceiptPrint } from "./printAssertions";

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
    window.print = () => {
      window.parent.document.body.setAttribute("data-print-requested", "true");
    };
  }, includeOrder);
}

test("catering receipt normalizes payment status and omits unavailable venue", () => {
  const content = renderCateringReceipt({
    type: "catering",
    reference: "CAT-2026-001",
    customer_name: "Test Customer",
    payment_status: "Fully Paid"
  }, {
    totalPaid: 800,
    remainingBalance: 0,
    total: 800,
    printedAt: new Date("2026-11-28T10:00:00+08:00")
  });

  expect(content).toContain("FULLY PAID");
  expect(content).toContain("PHP 800.00");
  expect(content).not.toContain("N/A");
});

test("embedded receipt logo decodes in the browser", async ({ page }) => {
  const width = await page.evaluate(async (source) => {
    const image = new Image();
    image.src = source;
    await image.decode();
    return image.naturalWidth;
  }, RECEIPT_LOGO_DATA_URL);

  expect(width).toBe(384);
});

test("printer test slip prints in a hidden iframe with the selected paper profile", async ({ page }) => {
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
  await page.getByRole("button", { name: "Print test slip" }).click();
  await expect(page.locator("body")).toHaveAttribute("data-print-requested", "true");
  const printFrame = page.locator('iframe[data-receipt-print-frame="true"]');
  await expect(printFrame).toHaveAttribute("title", "Printer test slip");
  const content = page.frameLocator('iframe[data-receipt-print-frame="true"]');
  const printContent = await content.locator(".plain-lines").textContent() ?? "";
  await expectPrintLinesWithin32(content);
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

  const printStyle = (await content.locator("style").allTextContents()).join("\n");
  expect(printStyle).toMatch(/@page\s*\{\s*size:\s*58mm \d+mm; margin: 0;\s*\}/);
  const layout = await content.locator(".plain-lines").evaluate((element) => ({
    width: element.getBoundingClientRect().width,
    fontSize: Number.parseFloat(getComputedStyle(element).fontSize)
  }));
  expect(layout.width).toBeLessThanOrEqual((48 * 96) / 25.4 + 0.1);
  expect(layout.fontSize).toBe(10);
  await finishReceiptPrint(page);
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
  await page.getByRole("button", { name: "Reprint", exact: true }).click();
  await expect(page.locator("body")).toHaveAttribute("data-print-requested", "true");
  const printFrame = page.locator('iframe[data-receipt-print-frame="true"]');
  await expect(printFrame).toHaveAttribute("title", "Order DO-PRINT-001");
  const content = page.frameLocator('iframe[data-receipt-print-frame="true"]');
  await expect(content.locator("body")).toContainText("REPRINT");
  await expect(content.locator("body")).toContainText("DO-PRINT-001");
  await expect(content.locator("body")).toContainText("PHP 350.00");
  expect(writeRequests).toEqual([]);
  await finishReceiptPrint(page);
});

test("takeout prints the saved receipt after checkout finishes", async ({ page }) => {
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

  await payment.getByRole("button", { name: "Complete payment" }).click();
  await checkoutStarted;
  await expect(page.locator('iframe[data-receipt-print-frame="true"]')).toHaveCount(0);
  releaseCheckout();
  await expect(page.locator("body")).toHaveAttribute("data-print-requested", "true");
  const printFrame = page.locator('iframe[data-receipt-print-frame="true"]');
  await expect(printFrame).toHaveAttribute("title", "Receipt POS-TAKEOUT-001");
  const content = page.frameLocator('iframe[data-receipt-print-frame="true"]');
  await expect(content.locator("body")).toContainText("POS-TAKEOUT-001");
  await expect(content.locator("body")).toContainText("PAID");
  await finishReceiptPrint(page);
});

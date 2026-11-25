import { expect, test } from "@playwright/test";
import { expectPrintLinesWithin32 } from "./printAssertions";

type PickupStatus = "preparing" | "ready";
type PickupOrder = {
  order_number: string;
  status: PickupStatus;
  payment_plan: "pay_at_pickup";
  payment_status: "unpaid";
  payment_method: null;
  customer_name: string;
  created_at: string;
  pickup_time: string | null;
  total: number;
  items: Array<{ name: string; quantity: number; unit_price: number; total_price: number }>;
};

function order(orderNumber: string, status: PickupStatus): PickupOrder {
  return {
    order_number: orderNumber,
    status,
    payment_plan: "pay_at_pickup",
    payment_status: "unpaid",
    payment_method: null,
    customer_name: `${status} Customer`,
    created_at: "2026-10-20T10:00:00.000Z",
    pickup_time: status === "ready" ? "2026-10-20T10:05:00.000Z" : null,
    total: 200,
    items: [{ name: "California Roll", quantity: 2, unit_price: 100, total_price: 200 }]
  };
}

test("cashier searches by order ID and completes preparing or ready pickups with cash", async ({ page }) => {
  const completionRequests: Array<{ orderNumber: string; body: Record<string, unknown> }> = [];
  const searches: string[] = [];
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
    if (url.pathname === "/api/products") {
      await route.fulfill({ json: { products: [] } });
      return;
    }
    if (url.pathname === "/api/settings/system") {
      await route.fulfill({ json: { settings: {} } });
      return;
    }
    if (url.pathname === "/api/pos/pickup-orders" && route.request().method() === "GET") {
      const search = url.searchParams.get("search") ?? "";
      searches.push(search);
      const pickupOrder = search.includes("PREP") || search.toLowerCase().includes("preparing customer")
        ? order("KTO-PREP-001", "preparing")
        : search.includes("READY") || search.toLowerCase().includes("ready customer")
          ? order("KTO-READY-001", "ready")
          : null;
      await route.fulfill({ json: { orders: pickupOrder ? [pickupOrder] : [] } });
      return;
    }
    if (url.pathname.startsWith("/api/pos/pickup-orders/") && route.request().method() === "POST") {
      const body = (route.request().postDataJSON() ?? {}) as Record<string, unknown>;
      const discountAmount = body.applyDiscount
        ? Math.round((200 * Number(body.seniorPwdCount) / Number(body.guestCount) * 0.2) * 100) / 100
        : 0;
      if (body.previewOnly) {
        await route.fulfill({ json: {
          subtotal: 200,
          tax: 0,
          discount_base_snapshot: 200,
          discount_rate_snapshot: 0.2,
          discounted_guest_count: body.applyDiscount ? body.seniorPwdCount : 0,
          discount_amount: discountAmount,
          total: 200 - discountAmount
        } });
        return;
      }
      completionRequests.push({
        orderNumber: decodeURIComponent(url.pathname.split("/").slice(-2, -1)[0] ?? ""),
        body
      });
      await route.fulfill({
        json: {
          order: {
            order_number: "KTO-COMPLETED",
            status: "completed",
            payment_plan: "pay_at_pickup",
            payment_status: "paid",
            subtotal: 200,
            total: 200,
            ready_at: null,
            items: []
          },
          transaction: {
            id: "transaction-1",
            transaction_number: "POS-PICKUP-001",
            customer_name: "Pickup Customer",
            transaction_type: "takeout",
            subtotal: 200,
            tax: 0,
            discount_amount: discountAmount,
            discount_base_snapshot: 200,
            discount_rate_snapshot: 0.2,
            guest_count: body.guestCount ?? 1,
            discount_guest_count: body.applyDiscount ? body.seniorPwdCount : 0,
            total: 200 - discountAmount,
            payment_method: "cash",
            cash_received: 250,
            change_due: 250 - (200 - discountAmount),
            created_at: "2026-10-27T00:00:00.000Z",
            items: [{ quantity: 2, unit_price: 100, total_price: 200, selling_product: { name: "California Roll" } }]
          }
        }
      });
      return;
    }
    await route.fulfill({ json: {} });
  });

  await page.goto("/staff/pos");
  await page.getByRole("button", { name: "Pickup", exact: true }).click();
  const searchInput = page.getByLabel("Search pickup orders by customer or reference");

  for (const [orderId, status] of [["KTO-PREP-001", "Preparing"], ["KTO-READY-001", "Ready for pickup"]] as const) {
    await searchInput.fill(orderId);
    const result = page.getByRole("dialog", { name: "Select pickup order" }).getByRole("button", { name: new RegExp(orderId) });
    await expect(result).toBeVisible();
    await result.click();
    await expect(page.getByRole("region", { name: "POS order builder" })).toContainText(status);
    if (orderId.includes("READY")) {
      await expect(page.getByRole("region", { name: "POS order builder" }).getByText(/Pickup Time:/)).toBeVisible();
    }
    await page.getByRole("button", { name: "Checkout" }).click();
    const payment = page.getByRole("dialog", { name: "Payment" });
    if (orderId.includes("READY")) {
      await payment.getByRole("button", { name: "Apply Discount" }).click();
      await payment.getByLabel("Checkout guest count").fill("10");
      await payment.getByLabel("Senior/PWD guest count").fill("3");
      await expect(payment.getByText("PHP 188.00")).toBeVisible();
    }
    await payment.getByRole("button", { name: "Cash", exact: true }).click();
    await payment.getByLabel("Enter Amount Received").fill("250");
    if (orderId.includes("READY")) {
      await expect(payment.getByText("Change: PHP 62.00")).toBeVisible();
    }
    const receiptPopupPromise = page.waitForEvent("popup");
    await payment.getByRole("button", { name: "Confirm" }).click();
    const receipt = await receiptPopupPromise;
    await expect(receipt.locator("body")).toHaveAttribute("data-print-requested", "true");
    await expectPrintLinesWithin32(receipt);
    if (orderId.includes("READY")) {
      await expect(receipt.locator("body")).toContainText("Senior/PWD discount");
      await expect(receipt.locator("body")).toContainText("PHP 12.00");
    }
    await expect(page.getByRole("region", { name: "POS order builder" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Pickup", exact: true })).toBeVisible();
    if (orderId.includes("PREP")) {
      await page.getByRole("button", { name: "Pickup", exact: true }).click();
    }
  }

  expect(searches).toContain("KTO-PREP-001");
  expect(searches).toContain("KTO-READY-001");
  expect(completionRequests).toEqual([
    {
      orderNumber: "KTO-PREP-001",
      body: { paymentMethod: "cash", cashReceived: 250, applyDiscount: false, guestCount: 1, seniorPwdCount: 0 }
    },
    {
      orderNumber: "KTO-READY-001",
      body: { paymentMethod: "cash", cashReceived: 250, applyDiscount: true, guestCount: 10, seniorPwdCount: 3 }
    }
  ]);
});

test("cashier can find a pickup order by customer name", async ({ page }) => {
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
    if (url.pathname === "/api/products" || url.pathname === "/api/settings/system") {
      await route.fulfill({ json: url.pathname === "/api/products" ? { products: [] } : { settings: {} } });
      return;
    }
    if (url.pathname === "/api/pos/pickup-orders") {
      const search = url.searchParams.get("search") ?? "";
      await route.fulfill({
        json: {
          orders: search.toLowerCase() === "preparing customer"
            ? [order("KTO-PREP-001", "preparing")]
            : []
        }
      });
      return;
    }
    await route.fulfill({ json: {} });
  });

  await page.goto("/staff/pos");
  await page.getByRole("button", { name: "Pickup", exact: true }).click();
  await page.getByLabel("Search pickup orders by customer or reference").fill("preparing Customer");

  await expect(page.getByRole("dialog", { name: "Select pickup order" }).getByRole("button", { name: /KTO-PREP-001/ })).toBeVisible();
});

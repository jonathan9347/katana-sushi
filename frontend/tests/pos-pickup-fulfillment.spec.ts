import { expect, test } from "@playwright/test";

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
      completionRequests.push({
        orderNumber: decodeURIComponent(url.pathname.split("/").slice(-2, -1)[0] ?? ""),
        body: (route.request().postDataJSON() ?? {}) as Record<string, unknown>
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
          }
        }
      });
      return;
    }
    await route.fulfill({ json: {} });
  });

  await page.goto("/staff/pos");
  await page.getByRole("button", { name: "New Customer" }).click();
  await page.getByRole("dialog", { name: "New Customer" }).getByRole("button", { name: "Take-out" }).click();
  await page.getByRole("dialog", { name: "Take-out" }).getByRole("button", { name: "Pickup" }).click();
  const searchInput = page.getByLabel("Search by Order ID or customer name");

  for (const [orderId, status] of [["KTO-PREP-001", "Preparing"], ["KTO-READY-001", "Ready for pickup"]] as const) {
    await searchInput.fill(orderId);
    const result = page.getByRole("button", { name: new RegExp(orderId) });
    await expect(result).toBeVisible();
    await result.click();
    await expect(page.getByRole("region", { name: "POS order builder" })).toContainText(status);
    if (orderId.includes("READY")) {
      await expect(page.getByRole("region", { name: "POS order builder" }).getByText(/Pickup Time:/)).toBeVisible();
    }
    await page.getByRole("button", { name: "Checkout" }).click();
    const payment = page.getByRole("dialog", { name: "Payment" });
    await payment.getByRole("button", { name: "Cash", exact: true }).click();
    await payment.getByLabel("Enter Amount Received").fill("250");
    await payment.getByRole("button", { name: "Confirm" }).click();
    await expect(page.getByRole("region", { name: "POS order builder" })).toBeVisible();
    await expect(page.getByRole("button", { name: "New Customer" })).toBeVisible();
    if (orderId.includes("PREP")) {
      await page.getByRole("button", { name: "New Customer" }).click();
      await page.getByRole("dialog", { name: "New Customer" }).getByRole("button", { name: "Take-out" }).click();
      await page.getByRole("dialog", { name: "Take-out" }).getByRole("button", { name: "Pickup" }).click();
    }
  }

  expect(searches).toContain("KTO-PREP-001");
  expect(searches).toContain("KTO-READY-001");
  expect(completionRequests).toEqual([
    { orderNumber: "KTO-PREP-001", body: { paymentMethod: "cash", cashReceived: 250 } },
    { orderNumber: "KTO-READY-001", body: { paymentMethod: "cash", cashReceived: 250 } }
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
  await page.getByRole("button", { name: "New Customer" }).click();
  await page.getByRole("dialog", { name: "New Customer" }).getByRole("button", { name: "Take-out" }).click();
  await page.getByRole("dialog", { name: "Take-out" }).getByRole("button", { name: "Pickup" }).click();
  await page.getByLabel("Search by Order ID or customer name").fill("preparing Customer");

  await expect(page.getByRole("button", { name: /KTO-PREP-001/ })).toBeVisible();
});

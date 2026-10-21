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
      const orderId = url.searchParams.get("orderId") ?? "";
      searches.push(orderId);
      const pickupOrder = orderId.includes("PREP")
        ? order("KTO-PREP-001", "preparing")
        : orderId.includes("READY")
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
  await page.getByRole("region", { name: "Customer type" }).getByRole("button", { name: "Pickup customer" }).click();
  const searchInput = page.getByLabel("Order ID");

  for (const [orderId, status] of [["KTO-PREP-001", "Preparing"], ["KTO-READY-001", "Ready for pickup"]] as const) {
    await searchInput.fill(orderId);
    const result = page.getByRole("button", { name: new RegExp(orderId) });
    await expect(result).toBeVisible();
    await result.click();
    await expect(page.getByText(status, { exact: true })).toBeVisible();
    if (orderId.includes("READY")) {
      await expect(page.getByText(/Pickup Time:/)).toBeVisible();
    }
    await page.getByRole("button", { name: "Collect payment & complete" }).click();
    const payment = page.getByRole("dialog", { name: "Payment" });
    await payment.getByRole("button", { name: "Cash", exact: true }).click();
    await payment.getByLabel("Enter Amount Received").fill("250");
    await payment.getByRole("button", { name: "Confirm" }).click();
    await expect(page.getByText("Select a preparing or ready pickup order to load its cart.")).toBeVisible();
  }

  expect(searches).toContain("KTO-PREP-001");
  expect(searches).toContain("KTO-READY-001");
  expect(completionRequests).toEqual([
    { orderNumber: "KTO-PREP-001", body: { paymentMethod: "cash", cashReceived: 250 } },
    { orderNumber: "KTO-READY-001", body: { paymentMethod: "cash", cashReceived: 250 } }
  ]);
});

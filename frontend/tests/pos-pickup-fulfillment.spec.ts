import { expect, test } from "@playwright/test";

type PickupOrder = {
  order_number: string;
  status: "ready";
  payment_plan: "pay_now" | "pay_at_pickup";
  payment_status: string;
  payment_method: string | null;
  customer_name: string;
  created_at: string;
  total: number;
  items: Array<{ name: string; quantity: number; unit_price: number; total_price: number }>;
};

function order(name: string, paymentPlan: "pay_now" | "pay_at_pickup", paymentStatus: string): PickupOrder {
  return {
    order_number: `KTO-${paymentPlan === "pay_now" ? "PAID" : "UNPAID"}-001`,
    status: "ready",
    payment_plan: paymentPlan,
    payment_status: paymentStatus,
    payment_method: paymentStatus === "paid" ? "gcash" : null,
    customer_name: name,
    created_at: "2026-10-20T10:00:00.000Z",
    total: 200,
    items: [{ name: "California Roll", quantity: 2, unit_price: 100, total_price: 200 }]
  };
}

test("cashier completes paid pickups without payment and collects cash for unpaid pickups", async ({ page }) => {
  const completionRequests: Array<{ orderNumber: string; body: Record<string, unknown> }> = [];
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
      const name = url.searchParams.get("name") ?? "";
      const pickupOrder = name.startsWith("Paid")
        ? order("Paid Customer", "pay_now", "paid")
        : name.startsWith("Unpaid")
          ? order("Unpaid Customer", "pay_at_pickup", "unpaid")
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
            payment_plan: "pay_now",
            payment_status: "paid",
            subtotal: 200,
            total: 200,
            items: []
          }
        }
      });
      return;
    }
    await route.fulfill({ json: {} });
  });

  await page.goto("/staff/pos");
  const customerType = page.getByRole("region", { name: "Customer type" });
  await customerType.getByRole("button", { name: "Pickup customer" }).click();

  await page.getByLabel("Customer name").fill("Paid");
  const paidOrder = page.getByRole("button", { name: /Paid Customer/ });
  await expect(paidOrder).toBeVisible();
  await paidOrder.click();
  await page.getByRole("button", { name: "Complete pickup" }).click();
  await expect(page.getByText("Select a ready pickup order to load its cart.")).toBeVisible();
  expect(completionRequests[0]).toEqual({
    orderNumber: "KTO-PAID-001",
    body: {}
  });
  await expect(page.getByRole("dialog", { name: "Payment" })).toHaveCount(0);

  await page.getByLabel("Customer name").fill("Unpaid");
  const unpaidOrder = page.getByRole("button", { name: /Unpaid Customer/ });
  await expect(unpaidOrder).toBeVisible();
  await unpaidOrder.click();
  await page.getByRole("button", { name: "Collect payment & complete" }).click();
  const payment = page.getByRole("dialog", { name: "Payment" });
  await expect(payment.getByText("PHP 200")).toBeVisible();
  await payment.getByRole("button", { name: "Cash", exact: true }).click();
  await payment.getByLabel("Enter Amount Received").fill("250");
  await payment.getByRole("button", { name: "Confirm" }).click();
  await expect(page.getByText("Select a ready pickup order to load its cart.")).toBeVisible();

  expect(completionRequests[1]).toEqual({
    orderNumber: "KTO-UNPAID-001",
    body: { paymentMethod: "cash", cashReceived: 250 }
  });
});

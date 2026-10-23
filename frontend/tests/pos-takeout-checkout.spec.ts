import { expect, test } from "@playwright/test";

test("takeout checkout creates one immediate sale and receipt without entering dine-in flow", async ({ page }) => {
  const checkoutBodies: Array<Record<string, unknown>> = [];
  const diningRequests: string[] = [];
  await page.addInitScript(() => {
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
    if (url.pathname.startsWith("/api/pos/dining/") || url.pathname === "/api/pos/kitchen/orders") {
      diningRequests.push(`${route.request().method()} ${url.pathname}`);
      await route.fulfill({ json: {} });
      return;
    }
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
      await route.fulfill({ json: { settings: {
        restaurant_name: "Katana Sushi",
        tax_rate_percent: 0,
        receipt_paper_size: "80mm",
        receipt_footer: "Thank you"
      } } });
      return;
    }
    if (url.pathname === "/api/pos/transaction" && route.request().method() === "POST") {
      const body = route.request().postDataJSON() as Record<string, unknown>;
      checkoutBodies.push(body);
      await route.fulfill({ status: 201, json: { transaction: {
        id: "transaction-1",
        transaction_number: "POS-TAKEOUT-001",
        customer_name: "Walk-in",
        transaction_type: "takeout",
        subtotal: 200,
        tax: 0,
        total: 200,
        payment_method: "cash",
        cash_received: 250,
        change_due: 50,
        created_at: "2026-10-19T16:00:00.000Z",
        items: [{
          quantity: 2,
          unit_price: 100,
          total_price: 200,
          selling_product: { name: "California Roll" }
        }]
      } } });
      return;
    }
    await route.fulfill({ json: {} });
  });

  await page.goto("/staff/pos");
  await page.getByRole("button", { name: "New Customer" }).click();
  await page.getByRole("dialog", { name: "New Customer" }).getByRole("button", { name: "Take-out" }).click();
  await page.getByRole("dialog", { name: "Take-out" }).getByRole("button", { name: "Walk-in" }).click();
  await expect(page.getByRole("region", { name: "POS order builder" })).toContainText("Menu");
  const menuProduct = page.getByRole("region", { name: "POS order builder" }).getByRole("button", { name: /California Roll Sushi/ });
  await menuProduct.click();
  await menuProduct.click();
  await expect(page.getByText("2 × California Roll")).toBeVisible();
  await page.getByRole("button", { name: "Checkout" }).click();

  const payment = page.getByRole("dialog", { name: "Payment" });
  await expect(payment.getByText("PHP 200")).toBeVisible();
  await payment.getByRole("button", { name: "Cash", exact: true }).click();
  await payment.getByLabel("Enter Amount Received").fill("250");
  await expect(payment.getByText("Change: PHP 50.00")).toBeVisible();

  const receiptPopupPromise = page.waitForEvent("popup");
  await payment.getByRole("button", { name: "Confirm" }).click();
  const receipt = await receiptPopupPromise;
  await expect(receipt.locator("body")).toContainText("POS-TAKEOUT-001");
  await expect(receipt.locator("body")).toContainText("2 x California Roll");
  await expect(receipt.locator("body")).not.toContainText("Table");
  await expect(receipt.locator("body")).not.toContainText("Order POS-TAKEOUT-001");

  expect(checkoutBodies).toHaveLength(1);
  expect(checkoutBodies[0]).toMatchObject({
    transactionType: "takeout",
    paymentMethod: "cash",
    cashReceived: 250,
    items: [{ productId: "product-1", quantity: 2, unitPrice: 100 }]
  });
  expect(checkoutBodies[0]).not.toHaveProperty("tableId");
  expect(checkoutBodies[0]).not.toHaveProperty("sessionId");
  expect(checkoutBodies[0]).not.toHaveProperty("seniorPwdCount");
  expect(checkoutBodies[0]).not.toHaveProperty("orderType");
  expect(diningRequests).toEqual([]);
  await expect(page.getByRole("button", { name: "Checkout" })).toBeDisabled();
});

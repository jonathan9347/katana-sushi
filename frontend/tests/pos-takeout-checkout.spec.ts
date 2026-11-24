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
      if (body.previewOnly) {
        await route.fulfill({ json: {
          subtotal: 200,
          tax: 0,
          discount_base_snapshot: 200,
          discount_rate_snapshot: 0.2,
          discounted_guest_count: body.applyDiscount ? body.seniorPwdCount : 0,
          discount_amount: 0,
          total: 200
        } });
        return;
      }
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
  await page.getByRole("dialog", { name: "New Customer" }).getByRole("button", { name: /Take-out/ }).click();
  await page.getByRole("dialog", { name: "Take-out" }).getByRole("button", { name: /Walk-in/ }).click();
  await page.getByRole("dialog", { name: "Ready to order" }).getByRole("button", { name: "Start ordering" }).click();
  await expect(page.getByRole("region", { name: "POS order builder" })).toContainText("Menu");
  const menuProduct = page.getByRole("region", { name: "POS order builder" }).getByRole("button", { name: /California Roll Sushi/ });
  await menuProduct.click();
  await page.getByRole("button", { name: "Increase California Roll" }).click();
  await expect(page.getByText("2 × California Roll")).toBeVisible();
  await page.getByRole("button", { name: "Checkout" }).click();

  const payment = page.getByRole("dialog", { name: "Payment" });
  await expect(payment).toContainText("PHP 200.00");
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
  expect(checkoutBodies[0]).toMatchObject({
    applyDiscount: false,
    guestCount: 1,
    seniorPwdCount: 0
  });
  expect(checkoutBodies[0]).not.toHaveProperty("orderType");
  expect(diningRequests).toEqual([]);
  await expect(page.getByRole("button", { name: "Checkout" })).toBeDisabled();
});

test("takeout checkout applies the shared Senior/PWD discount to the server-calculated total and receipt", async ({ page }) => {
  const checkoutBodies: Array<Record<string, unknown>> = [];
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
        price: 1000,
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
      const amount = body.applyDiscount
        ? Math.round((1000 * Number(body.seniorPwdCount) / Number(body.guestCount) * 0.2) * 100) / 100
        : 0;
      const total = 1000 - amount;
      if (body.previewOnly) {
        await route.fulfill({ json: {
          subtotal: 1000,
          tax: 0,
          discount_base_snapshot: 1000,
          discount_rate_snapshot: 0.2,
          discounted_guest_count: body.applyDiscount ? body.seniorPwdCount : 0,
          discount_amount: amount,
          total
        } });
        return;
      }
      checkoutBodies.push(body);
      await route.fulfill({ status: 201, json: { transaction: {
        id: "transaction-2",
        transaction_number: "POS-TAKEOUT-940",
        customer_name: "Walk-in",
        transaction_type: "takeout",
        subtotal: 1000,
        tax: 0,
        discount_amount: amount,
        discount_base_snapshot: 1000,
        discount_rate_snapshot: 0.2,
        guest_count: 10,
        discount_guest_count: 3,
        total,
        payment_method: "cash",
        cash_received: 1000,
        change_due: 60,
        created_at: "2026-10-19T16:00:00.000Z",
        items: [{
          quantity: 1,
          unit_price: 1000,
          total_price: 1000,
          selling_product: { name: "California Roll" }
        }]
      } } });
      return;
    }
    await route.fulfill({ json: {} });
  });

  await page.goto("/staff/pos");
  await page.getByRole("button", { name: "New Customer" }).click();
  await page.getByRole("dialog", { name: "New Customer" }).getByRole("button", { name: /Take-out/ }).click();
  await page.getByRole("dialog", { name: "Take-out" }).getByRole("button", { name: /Walk-in/ }).click();
  await page.getByRole("dialog", { name: "Ready to order" }).getByRole("button", { name: "Start ordering" }).click();
  await page.getByRole("region", { name: "POS order builder" }).getByRole("button", { name: /California Roll Sushi/ }).click();
  await page.getByRole("button", { name: "Checkout" }).click();

  const payment = page.getByRole("dialog", { name: "Payment" });
  await expect(payment).toContainText("PHP 1,000.00");
  await payment.getByRole("button", { name: "Apply Discount" }).click();
  await payment.getByLabel("Checkout guest count").fill("10");
  await payment.getByLabel("Senior/PWD guest count").fill("3");
  await expect(payment).toContainText("PHP 940.00");
  await payment.getByRole("button", { name: "Cash", exact: true }).click();
  await payment.getByLabel("Enter Amount Received").fill("1000");
  await expect(payment.getByText("Change: PHP 60.00")).toBeVisible();

  const receiptPopupPromise = page.waitForEvent("popup");
  await payment.getByRole("button", { name: "Confirm" }).click();
  const receipt = await receiptPopupPromise;
  await expect(receipt.locator("body")).toContainText("Senior/PWD discount");
  await expect(receipt.locator("body")).toContainText("PHP 60.00");
  await expect(receipt.locator("body")).toContainText("Total: PHP 940.00");
  expect(checkoutBodies).toHaveLength(1);
  expect(checkoutBodies[0]).toMatchObject({
    transactionType: "takeout",
    applyDiscount: true,
    guestCount: 10,
    seniorPwdCount: 3,
    cashReceived: 1000
  });
});

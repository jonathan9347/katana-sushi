import { expect, test } from "@playwright/test";

test("customer pickup checkout is cash-at-counter only", async ({ page }) => {
  let submittedBody: Record<string, unknown> | null = null;
  await page.route("**/api/takeout/catalog", async (route) => {
    await route.fulfill({
      json: {
        products: [{
          id: "roll-1",
          name: "California Roll",
          category: "Rolls",
          price: 120,
          description: "Crab and cucumber",
          image_url: null,
          is_available: true
        }]
      }
    });
  });
  await page.route("**/api/takeout/orders", async (route) => {
    submittedBody = route.request().postDataJSON() as Record<string, unknown>;
    await route.fulfill({
      status: 201,
      json: {
        order: {
          order_number: "KTO-CASH-001",
          status: "pending_approval",
          payment_plan: "pay_at_pickup",
          payment_status: "unpaid",
          subtotal: 120,
          total: 120,
          ready_at: null,
          items: [{ name: "California Roll", quantity: 1, unit_price: 120, total_price: 120 }]
        },
        payment: null
      }
    });
  });

  await page.goto("/takeout");
  await page.getByRole("button", { name: "Add to cart" }).click();
  await expect(page.getByText("Pay in cash when you arrive at the counter.")).toBeVisible();
  await expect(page.getByText("Pay in full now")).toHaveCount(0);
  await page.getByRole("button", { name: "Confirm pickup order" }).first().click();
  const details = page.getByRole("dialog", { name: "Your details" });
  await details.getByLabel("Your name *").fill("Pickup Guest");
  await details.getByLabel("Phone number *").fill("09123456789");
  await details.getByRole("button", { name: "Confirm pickup order" }).click();

  await expect(page.getByText("KTO-CASH-001")).toBeVisible();
  await expect(page.getByText(/Pay in cash at the counter/)).toBeVisible();
  expect(submittedBody).toMatchObject({
    customer_name: "Pickup Guest",
    customer_phone: "09123456789",
    payment_plan: "pay_at_pickup",
    items: [{ product_id: "roll-1", quantity: 1 }]
  });
  expect(submittedBody).not.toHaveProperty("payment_method");
});

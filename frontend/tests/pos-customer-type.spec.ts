import { expect, test } from "@playwright/test";

test("keeps takeout as the default and enables Pickup customer", async ({ page }) => {
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
    await route.fulfill({ json: {} });
  });

  await page.goto("/staff/pos");

  const customerType = page.getByRole("region", { name: "Customer type" });
  await expect(customerType.getByRole("button", { name: "New customer" })).toHaveAttribute("aria-pressed", "true");
  await expect(customerType.getByRole("button", { name: "Existing table" })).toBeEnabled();
  await expect(customerType.getByRole("button", { name: "Existing table" })).toHaveAttribute("aria-pressed", "false");
  await expect(customerType.getByRole("button", { name: "Pickup customer" })).toBeEnabled();
  await expect(customerType.getByRole("button", { name: "Dine in" })).toBeEnabled();
  await expect(customerType.getByRole("button", { name: "Takeout" })).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByRole("heading", { name: "Takeout Sale" })).toBeVisible();

  await customerType.getByRole("button", { name: "Pickup customer" }).click();
  await expect(page.getByRole("heading", { name: "Pickup customer" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Find ready pickup orders" })).toBeVisible();

  await customerType.getByRole("button", { name: "New customer" }).click();
  await customerType.getByRole("group", { name: "New customer service type" }).getByRole("button", { name: "Dine in" }).click();
  await expect(page.locator("header").getByRole("heading", { name: "Table board", exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Dine-in order" })).toHaveCount(0);
});

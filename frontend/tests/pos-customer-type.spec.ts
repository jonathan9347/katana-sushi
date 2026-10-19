import { expect, test } from "@playwright/test";

test("keeps takeout active and disables customer types whose POS flows are not built yet", async ({ page }) => {
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
  await expect(customerType.getByRole("button", { name: "Existing table" })).toBeDisabled();
  await expect(customerType.getByRole("button", { name: "Pickup customer" })).toBeDisabled();
  await expect(customerType.getByRole("button", { name: "Dine in" })).toBeDisabled();
  await expect(customerType.getByRole("button", { name: "Takeout" })).toHaveAttribute("aria-pressed", "true");
  await expect(customerType).toContainText("Existing table will be available when the table board is added to this POS.");
  await expect(customerType).toContainText("Pickup customer is disabled until Phase 4.");
  await expect(page.getByRole("heading", { name: "Takeout Sale" })).toBeVisible();
});

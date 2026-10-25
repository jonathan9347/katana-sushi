import { expect, test, type Page } from "@playwright/test";

async function setUpStaffSession(page: Page) {
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
    if (url.pathname === "/api/pos/kitchen/orders") {
      await route.fulfill({ json: { orders: [] } });
      return;
    }
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
}

test("redirects the retired Table Service URL to the main POS", async ({ page }) => {
  await setUpStaffSession(page);

  await page.goto("/staff/pos/dining");

  await expect(page).toHaveURL(/\/staff\/pos$/);
  await expect(page.getByRole("heading", { name: "Point of Sale" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Table Service" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Open table session tools" })).toHaveCount(0);
});

test("keeps the legacy kitchen route and links back to the main POS", async ({ page }) => {
  await setUpStaffSession(page);

  await page.goto("/staff/kitchen");

  await expect(page.getByRole("heading", { name: "Kitchen tickets" })).toBeVisible();
  await expect(page.getByText("No open kitchen tickets.")).toBeVisible();
  await expect(page.getByText("Dine-in operations")).toHaveCount(0);
  await expect(page.getByRole("link", { name: "Main POS" })).toHaveAttribute("href", "/staff/pos");
  await expect(page.getByRole("link", { name: "Table Service" })).toHaveCount(0);
});

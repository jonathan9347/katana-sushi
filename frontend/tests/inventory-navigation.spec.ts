import { expect, test, type Page } from "@playwright/test";

async function setStaffRole(page: Page, role: string) {
  await page.addInitScript((staffRole: string) => {
    localStorage.setItem("katana_token", "playwright-token");
    localStorage.setItem("katana_role", staffRole);
    localStorage.setItem("katana_user", JSON.stringify({
      id: `${staffRole}-1`,
      email: `${staffRole}@example.test`,
      name: `Test ${staffRole}`,
      role: staffRole
    }));
  }, role);
  await page.route("**/api/**", async (route) => {
    const { pathname } = new URL(route.request().url());
    if (pathname === "/api/inventory/materials") {
      await route.fulfill({ json: { materials: [] } });
      return;
    }
    if (pathname === "/api/inventory/reservations") {
      await route.fulfill({ json: { reservations: [] } });
      return;
    }
    if (pathname === "/api/inventory/movements") {
      await route.fulfill({ json: { movements: [], pagination: { page: 1, limit: 100, total: 0, pages: 0 } } });
      return;
    }
    if (pathname === "/api/inventory/yield") {
      await route.fulfill({ json: { products: [], globalBottleneck: { ingredient: "", affectedProducts: [], suggestion: "" } } });
      return;
    }
    if (pathname === "/api/products") {
      await route.fulfill({ json: { products: [] } });
      return;
    }
    await route.fulfill({ json: {} });
  });
}

test("inventory has three primary tabs and keeps stock tools under Stock", async ({ page }) => {
  await setStaffRole(page, "admin");
  await page.goto("/staff/inventory");

  const navigation = page.getByRole("navigation", { name: "Section navigation" });
  await expect(navigation.getByRole("button")).toHaveCount(3);
  await expect(navigation.getByRole("button", { name: "Stock" })).toHaveClass(/bg-red-700/);
  await expect(navigation.getByRole("button", { name: "Reservations" })).toBeVisible();
  await expect(navigation.getByRole("button", { name: "Movements" })).toBeVisible();
  await expect(page.getByText("Overview", { exact: true })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Materials" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Batches & Expiry" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Waste Disposal" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Menu Products" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Yield Estimator" })).toBeVisible();

  await page.getByRole("button", { name: "Menu Products" }).click();
  await expect(page.getByRole("heading", { name: "Menu Products" })).toBeVisible();
  await page.getByRole("button", { name: "Yield Estimator" }).click();
  await expect(page.getByRole("heading", { name: "Yield Estimator" })).toBeVisible();
});

test("Reservations and Movements are direct primary tabs", async ({ page }) => {
  await setStaffRole(page, "inventory_manager");
  await page.goto("/staff/inventory");

  const navigation = page.getByRole("navigation", { name: "Section navigation" });
  const reservationsTab = navigation.getByRole("button", { name: "Reservations" });
  await reservationsTab.click();
  await expect(reservationsTab).toHaveClass(/bg-red-700/);
  await expect(page.getByText("Dine-in, catering, and pickup orders with their current inventory status.")).toBeVisible();

  const movementsTab = navigation.getByRole("button", { name: "Movements" });
  await movementsTab.click();
  await expect(movementsTab).toHaveClass(/bg-red-700/);
  await expect(page.getByRole("heading", { name: "Inventory Movements" })).toBeVisible();
});

test("chef read-only inventory remains limited to Stock", async ({ page }) => {
  await setStaffRole(page, "chef");
  await page.goto("/staff/inventory/read-only");

  const navigation = page.getByRole("navigation", { name: "Section navigation" });
  await expect(navigation.getByRole("button")).toHaveCount(1);
  await expect(navigation.getByRole("button", { name: "Stock" })).toBeVisible();
  await expect(navigation.getByRole("button", { name: "Reservations" })).toHaveCount(0);
  await expect(navigation.getByRole("button", { name: "Movements" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Materials" })).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "Raw Materials", exact: true })).toBeVisible();
});

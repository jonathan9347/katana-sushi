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
  await expect(page.locator("body")).not.toContainText(/\bstaff\b/i);

  const navigation = page.getByRole("navigation", { name: "Section navigation" });
  await expect(navigation.getByRole("button")).toHaveCount(3);
  await expect(navigation.getByRole("button", { name: "Stock" })).toHaveClass(/bg-red-700/);
  await expect(navigation.getByRole("button", { name: "Reservations" })).toBeVisible();
  await expect(navigation.getByRole("button", { name: "Movements" })).toBeVisible();
  await expect(page.getByText("Overview", { exact: true })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Materials" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Stock In" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Waste Disposal" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Menu Products" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Yield Estimator" })).toBeVisible();

  await page.getByRole("button", { name: "Menu Products" }).click();
  await expect(page.getByRole("heading", { name: "Menu Products" })).toBeVisible();
  await page.getByRole("button", { name: "Yield Estimator" }).click();
  await expect(page.getByRole("heading", { name: "Yield Estimator" })).toBeVisible();
});

test("Menu Products and Yield Estimator hide recipe confirmation labels", async ({ page }) => {
  await setStaffRole(page, "admin");
  await page.route("**/api/products", async (route) => {
    await route.fulfill({
      json: {
        products: [{
          id: "product-1",
          name: "Salmon Roll",
          category: "Classic Roll",
          price: 250,
          is_available: true,
          recipes: [{ status: "recipe not confirmed", recipe_ingredients: [] }]
        }]
      }
    });
  });
  await page.route("**/api/inventory/yield", async (route) => {
    await route.fulfill({
      json: {
        products: [{
          id: "product-1",
          name: "Salmon Roll",
          category: "Classic Roll",
          maxPortions: 12,
          limitingIngredient: "Salmon",
          limitingStock: 120,
          requiredPerPortion: 10,
          potentialRevenue: 3000
        }],
        globalBottleneck: { ingredient: "Salmon", affectedProducts: ["Salmon Roll"], suggestion: "Restock salmon." }
      }
    });
  });
  await page.route("**/api/products/product-1/recipe", async (route) => {
    await route.fulfill({
      json: {
        productId: "product-1",
        productName: "Salmon Roll",
        status: "recipe not confirmed",
        sellingPrice: 250,
        ingredients: [],
        totalIngredientCost: 0,
        profitMargin: 100
      }
    });
  });

  await page.goto("/staff/inventory");
  await page.getByRole("button", { name: "Menu Products" }).click();
  await page.getByRole("button", { name: "Edit Salmon Roll" }).click();
  await expect(page.getByRole("heading", { name: "Edit Salmon Roll" })).toBeVisible();
  await expect(page.getByText("recipe not confirmed", { exact: true })).toHaveCount(0);

  await page.getByRole("button", { name: "Close dialog" }).click();
  await page.getByRole("button", { name: "Yield Estimator" }).click();
  await page.getByRole("button", { name: "Salmon Roll" }).click();
  await expect(page.getByRole("heading", { name: "Salmon Roll Recipe" })).toBeVisible();
  await expect(page.getByText("recipe not confirmed", { exact: true })).toHaveCount(0);
});

test("Reservations and Movements are direct primary tabs", async ({ page }) => {
  await setStaffRole(page, "inventory_manager");
  await page.goto("/staff/inventory");

  const navigation = page.getByRole("navigation", { name: "Section navigation" });
  const reservationsTab = navigation.getByRole("button", { name: "Reservations" });
  await reservationsTab.click();
  await expect(reservationsTab).toHaveClass(/bg-red-700/);
  await expect(page.getByText("Pickup orders and catering reservations with their current inventory status.")).toBeVisible();

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

test("inventory Reservations shows only Pickup and Catering entries", async ({ page }) => {
  await setStaffRole(page, "inventory_manager");
  await page.route("**/api/inventory/reservations", async (route) => {
    await route.fulfill({
      json: {
        reservations: [
          {
            id: "pickup-1",
            type: "takeout",
            reference: "KTO-TEST-1",
            customer_name: "Pickup Fixture",
            date: "2026-10-24T00:00:00.000Z",
            time: null,
            guests: null,
            status: "preparing",
            menu: ["2 × Roll"],
            stock_note: null,
            ingredients: [{ material_id: "material-1", material: "Rice", quantity: 2, unit: "g", status: "Reserved" }]
          },
          {
            id: "catering-1",
            type: "catering",
            reference: "CAT-TEST-1",
            customer_name: "Catering Fixture",
            date: "2026-10-25T00:00:00.000Z",
            time: null,
            guests: 12,
            status: "confirmed",
            menu: "Package",
            stock_note: null,
            ingredients: [{ material_id: "material-2", material: "Fish", quantity: 3, unit: "g", status: "Reserved" }]
          },
          {
            id: "dinein-1",
            type: "dine-in",
            reference: "KTN-TEST-1",
            customer_name: "Legacy Dine-in Fixture",
            date: "2026-10-26T00:00:00.000Z",
            time: "18:00",
            guests: 4,
            status: "confirmed",
            menu: [],
            stock_note: "Legacy",
            ingredients: []
          }
        ]
      }
    });
  });

  await page.goto("/staff/inventory");
  await page.getByRole("button", { name: "Reservations" }).click();
  await expect(page.getByText("KTO-TEST-1")).toBeVisible();
  await expect(page.getByText("CAT-TEST-1")).toBeVisible();
  await expect(page.getByText("KTN-TEST-1")).toHaveCount(0);
  await expect(page.getByText("Legacy Dine-in Fixture")).toHaveCount(0);
});

test("Movements shows only approved categories and maps legacy action names", async ({ page }) => {
  const movementRequests: URL[] = [];
  await setStaffRole(page, "inventory_manager");
  await page.route("**/api/inventory/movements**", async (route) => {
    const url = new URL(route.request().url());
    movementRequests.push(url);
    const actions = ["Received", "Used", "Released back", "Reserved", "Wasted", "Adjusted"];
    await route.fulfill({
      json: {
        movements: actions.map((action) => ({
          id: action,
          created_at: "2026-10-24T01:00:00.000Z",
          source_type: "inventory",
          source_reference: `REF-${action}`,
          action,
          quantity: 2,
          unit: "g",
          quantity_before: null,
          quantity_after: null,
          reserved_before: null,
          reserved_after: null,
          note: null,
          raw_material: { id: "material-1", name: "Rice", unit: "g" },
          batch: null,
          actor: { name: "Alex Rivera" }
        })),
        pagination: { page: 1, limit: 100, total: 5, pages: 1 }
      }
    });
  });

  await page.goto("/staff/inventory");
  await page.getByRole("button", { name: "Movements" }).click();

  const actionSelect = page.getByLabel("Action");
  await expect(actionSelect.locator("option")).toHaveText([
    "All actions",
    "Received",
    "Deducted",
    "Returned",
    "Wasted",
    "Adjusted"
  ]);
  await expect(page.getByText("REF-Received")).toBeVisible();
  await expect(page.getByText("REF-Used")).toBeVisible();
  await expect(page.getByText("REF-Released back")).toBeVisible();
  await expect(page.getByText("REF-Reserved")).toHaveCount(0);
  await expect(page.getByRole("cell", { name: "Deducted", exact: true })).toBeVisible();
  await expect(page.getByRole("cell", { name: "Returned", exact: true })).toBeVisible();
  expect(movementRequests[0]?.searchParams.get("categoriesOnly")).toBe("true");

  await actionSelect.selectOption("Returned");
  await expect.poll(() => movementRequests.at(-1)?.searchParams.get("action")).toBe("Returned");
});

test("Stock Reserved column uses the Pickup and Catering quantity", async ({ page }) => {
  await setStaffRole(page, "inventory_manager");
  await page.route("**/api/inventory/materials", async (route) => {
    await route.fulfill({
      json: {
        materials: [{
          id: "material-1",
          name: "Inventory Fixture Rice",
          category: "Raw Material",
          unit: "g",
          current_stock: 20,
          reserved_quantity: 5,
          available_quantity: 10,
          reorder_level: 2,
          cost_per_unit: 1,
          reserved_for: []
        }]
      }
    });
  });

  await page.goto("/staff/inventory");
  await expect(page.getByText("Reserved shows Pickup and Catering holds only; Available continues to account for all active stock commitments.")).toHaveCount(0);
  const row = page.getByRole("row").filter({ hasText: "Inventory Fixture Rice" });
  await expect(row.getByRole("cell").nth(3)).toHaveText("5");
  await expect(row.getByRole("cell").nth(4)).toHaveText("10");
});

test("Waste Disposal records stock without asking for or sending a booking link", async ({ page }) => {
  await setStaffRole(page, "admin");
  await page.route("**/api/inventory/materials", async (route) => {
    await route.fulfill({
      json: {
        materials: [{
          id: "material-waste",
          name: "Waste Fixture Rice",
          category: "Raw Material",
          unit: "g",
          current_stock: 100,
          available_quantity: 100,
          reorder_level: 5,
          cost_per_unit: 1
        }]
      }
    });
  });

  let submittedBody: Record<string, unknown> | undefined;
  await page.route("**/api/inventory/waste", async (route) => {
    submittedBody = route.request().postDataJSON() as Record<string, unknown>;
    await route.fulfill({ json: { success: true } });
  });

  await page.goto("/staff/inventory");
  await page.getByRole("button", { name: "Waste Disposal" }).click();
  await expect(page.getByText("Link to booking (optional)")).toHaveCount(0);
  await page.getByLabel("Material").selectOption("material-waste");
  await page.getByLabel("Quantity to dispose").fill("3");
  await page.getByLabel("Notes").fill("Expired stock");
  await page.getByRole("button", { name: "Record Disposal" }).click();

  await expect.poll(() => submittedBody).toMatchObject({
    raw_material_id: "material-waste",
    quantity: 3,
    reason: "spoilage",
    notes: "Expired stock"
  });
  expect(submittedBody).not.toHaveProperty("booking_type");
  expect(submittedBody).not.toHaveProperty("booking_reference");
});

test("Stock uses PAR level wording while retaining the reorder API field", async ({ page }) => {
  await setStaffRole(page, "admin");
  await page.route("**/api/inventory/materials", async (route) => {
    await route.fulfill({
      json: {
        materials: [{
          id: "material-1",
          name: "Inventory Fixture Rice",
          category: "Raw Material",
          unit: "g",
          current_stock: 20,
          reserved_quantity: 0,
          available_quantity: 1,
          reorder_level: 2,
          cost_per_unit: 1,
          reserved_for: []
        }]
      }
    });
  });

  await page.goto("/staff/inventory");
  const stockFilter = page.getByRole("combobox", { name: "Filter materials by stock status" });
  await expect(stockFilter.locator("option")).toContainText(["At or below PAR level"]);
  await stockFilter.selectOption("low");

  const row = page.getByRole("row").filter({ hasText: "Inventory Fixture Rice" });
  await expect(page.getByRole("columnheader", { name: "PAR Level" })).toBeVisible();
  await expect(row.getByText("Below PAR level.")).toBeVisible();

  await page.getByRole("button", { name: "Add New Material" }).click();
  await expect(page.getByText("PAR Level (whole units)")).toBeVisible();
  await expect(page.getByText(/Reorder Level/i)).toHaveCount(0);
});

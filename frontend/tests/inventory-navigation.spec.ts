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
  await expect(navigation.getByRole("button", { name: "Stock" })).toHaveAttribute("aria-pressed", "true");
  await expect(navigation.getByRole("button", { name: "Reservations" })).toBeVisible();
  await expect(navigation.getByRole("button", { name: "Movements" })).toBeVisible();
  await expect(page.getByText("Overview", { exact: true })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Materials" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Stock In" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Waste disposal" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Menu products" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Yield estimator" })).toBeVisible();

  await page.getByRole("button", { name: "Menu products" }).click();
  await expect(page.getByRole("heading", { name: "Menu Products" })).toBeVisible();
  await page.getByRole("button", { name: "Yield estimator" }).click();
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
  await page.getByRole("button", { name: "Menu products" }).click();
  await page.getByRole("button", { name: "Edit Salmon Roll" }).click();
  await expect(page.getByRole("heading", { name: "Edit Salmon Roll" })).toBeVisible();
  await expect(page.getByText("recipe not confirmed", { exact: true })).toHaveCount(0);

  await page.getByRole("button", { name: "Close dialog" }).click();
  await page.getByRole("button", { name: "Yield estimator" }).click();
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
  await expect(page.getByRole("heading", { name: "Inventory", exact: true })).toBeVisible();
  await expect(page.getByRole("searchbox", { name: "Search materials" })).toBeVisible();
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
  await expect(row.getByRole("cell").nth(4)).toHaveText("10 g");
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
    await new Promise((resolve) => setTimeout(resolve, 10_500));
    await route.fulfill({ json: { success: true } });
  });

  await page.goto("/staff/inventory");
  await page.getByRole("button", { name: "Waste disposal" }).click();
  await expect(page.getByText("Link to booking (optional)")).toHaveCount(0);
  await page.getByLabel("Material").selectOption("material-waste");
  await page.getByLabel("Quantity to dispose").fill("3");
  await page.getByLabel("Notes").fill("Expired stock");
  await page.getByRole("button", { name: "Record disposal" }).click();
  await expect(page.getByText("Saving the disposal and updating inventory. This may take a little while.")).toBeVisible();
  await expect(page.getByRole("button", { name: /Recording disposal/ })).toBeDisabled();

  await expect(page.getByRole("status").filter({ hasText: "Waste recorded and stock updated." })).toBeVisible({ timeout: 20_000 });
  await expect.poll(() => submittedBody).toMatchObject({
    raw_material_id: "material-waste",
    quantity: 3,
    reason: "spoilage",
    notes: "Expired stock"
  });
  expect(submittedBody).not.toHaveProperty("booking_type");
  expect(submittedBody).not.toHaveProperty("booking_reference");
});

test("Waste Disposal shows server errors without clearing the form", async ({ page }) => {
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
  await page.route("**/api/inventory/waste", async (route) => {
    await route.fulfill({
      status: 409,
      json: { message: "The selected batch has insufficient remaining stock." }
    });
  });

  await page.goto("/staff/inventory");
  await page.getByRole("button", { name: "Waste disposal" }).click();
  await page.getByLabel("Material").selectOption("material-waste");
  await page.getByLabel("Quantity to dispose").fill("3");
  await page.getByLabel("Notes").fill("Expired stock");
  await page.getByRole("button", { name: "Record disposal" }).click();

  await expect(page.getByRole("alert")).toHaveText(/The selected batch has insufficient remaining stock/);
  await expect(page.getByLabel("Quantity to dispose")).toHaveValue("3");
  await expect(page.getByLabel("Notes")).toHaveValue("Expired stock");
});

test("Batch receiving succeeds when the server responds after the old timeout", async ({ page }) => {
  await setStaffRole(page, "admin");
  await page.route("**/api/inventory/materials", async (route) => {
    await route.fulfill({
      json: {
        materials: [{
          id: "material-batch",
          name: "Batch Fixture Rice",
          category: "Raw Material",
          unit: "g",
          current_stock: 100,
          available_quantity: 100,
          reorder_level: 5,
          cost_per_unit: 0.5
        }]
      }
    });
  });

  let submittedBody: Record<string, unknown> | undefined;
  await page.route("**/api/inventory/batches", async (route) => {
    if (route.request().method() !== "POST") {
      await route.fulfill({ json: { batches: [] } });
      return;
    }
    submittedBody = route.request().postDataJSON() as Record<string, unknown>;
    await new Promise((resolve) => setTimeout(resolve, 10_500));
    await route.fulfill({ json: { batch: { id: "batch-1" }, material: {} } });
  });
  await page.route("**/api/inventory/batches/expiring*", async (route) => {
    await route.fulfill({ json: { batches: [] } });
  });

  await page.goto("/staff/inventory");
  await page.getByRole("button", { name: "Stock In" }).click();
  await page.getByRole("button", { name: "Receive Batch" }).click();
  await page.getByLabel("Material").selectOption("material-batch");
  await page.getByLabel("Batch number").fill("BATCH-TEST-1");
  await page.getByLabel("Quantity").fill("250");
  await page.getByLabel("Expiration date").fill("2026-12-01");
  await page.getByLabel("Cost per 100 g").fill("50");
  await page.getByRole("button", { name: "Receive Batch" }).last().click();

  await expect(page.getByText("Saving the batch and updating inventory. This may take a little while.")).toBeVisible();
  await expect(page.getByRole("button", { name: /Receiving batch/ })).toBeDisabled();
  await expect(page.getByRole("status").filter({ hasText: "Batch received and stock updated." })).toBeVisible({ timeout: 20_000 });
  expect(submittedBody).toMatchObject({
    raw_material_id: "material-batch",
    batch_number: "BATCH-TEST-1",
    quantity: 250
  });
});

test("Batch receiving shows server errors and keeps the entered details", async ({ page }) => {
  await setStaffRole(page, "admin");
  await page.route("**/api/inventory/materials", async (route) => {
    await route.fulfill({
      json: {
        materials: [{
          id: "material-batch",
          name: "Batch Fixture Rice",
          category: "Raw Material",
          unit: "g",
          current_stock: 100,
          available_quantity: 100,
          reorder_level: 5,
          cost_per_unit: 0.5
        }]
      }
    });
  });
  await page.route("**/api/inventory/batches", async (route) => {
    if (route.request().method() === "POST") {
      await route.fulfill({ status: 409, json: { message: "That batch number already exists." } });
      return;
    }
    await route.fulfill({ json: { batches: [] } });
  });
  await page.route("**/api/inventory/batches/expiring*", async (route) => {
    await route.fulfill({ json: { batches: [] } });
  });

  await page.goto("/staff/inventory");
  await page.getByRole("button", { name: "Stock In" }).click();
  await page.getByRole("button", { name: "Receive Batch" }).click();
  await page.getByLabel("Material").selectOption("material-batch");
  await page.getByLabel("Batch number").fill("BATCH-TEST-1");
  await page.getByLabel("Quantity").fill("250");
  await page.getByLabel("Expiration date").fill("2026-12-01");
  await page.getByLabel("Cost per 100 g").fill("50");
  await page.getByRole("button", { name: "Receive Batch" }).last().click();

  await expect(page.getByRole("alert")).toContainText("That batch number already exists.");
  await expect(page.getByLabel("Batch number")).toHaveValue("BATCH-TEST-1");
  await expect(page.getByLabel("Quantity")).toHaveValue("250");
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
  const stockFilters = page.getByRole("group", { name: "Filter materials by stock status" });
  const lowFilter = stockFilters.getByRole("button", { name: /^Low/ });
  await expect(page.getByText("Below par level", { exact: true })).toHaveCount(0);
  await lowFilter.click();
  await expect(page).toHaveURL(/filter=low/);

  const row = page.getByRole("row").filter({ hasText: "Inventory Fixture Rice" });
  await expect(page.getByRole("columnheader", { name: "Stock vs par" })).toBeVisible();
  await expect(row.getByText("Below par")).toBeVisible();

  await page.getByRole("button", { name: "Add material" }).click();
  await expect(page.getByText("PAR Level (whole units)")).toBeVisible();
  await expect(page.getByText(/Reorder Level/i)).toHaveCount(0);
});

test("typing in material, stock count, and batch dialogs keeps focus in the active field", async ({ page }) => {
  await setStaffRole(page, "admin");
  await page.route("**/api/inventory/materials", async (route) => {
    await route.fulfill({
      json: {
        materials: [{
          id: "material-focus",
          name: "Focus Fixture Rice",
          category: "Raw Material",
          unit: "g",
          current_stock: 20,
          available_quantity: 20,
          reorder_level: 5,
          cost_per_unit: 0.5
        }]
      }
    });
  });

  await page.goto("/staff/inventory");

  await page.getByRole("button", { name: "Add material" }).click();
  const materialName = page.getByLabel("Name");
  await materialName.click();
  await materialName.pressSequentially("Focus Rice");
  await expect(materialName).toBeFocused();
  await expect(materialName).toHaveValue("Focus Rice");
  await page.getByRole("button", { name: "Close dialog" }).click();

  await page.getByRole("button", { name: "Stock count" }).click();
  const physicalCount = page.getByLabel("Physical count");
  await page.getByRole("dialog").getByLabel("Material").selectOption("material-focus");
  await physicalCount.click();
  await physicalCount.pressSequentially("25");
  await expect(physicalCount).toBeFocused();
  await expect(physicalCount).toHaveValue("25");
  const countReason = page.getByLabel("Reason");
  await countReason.click();
  await countReason.pressSequentially("weekly count");
  await expect(countReason).toBeFocused();
  await expect(countReason).toHaveValue("weekly count");
  await page.getByRole("button", { name: "Close dialog" }).click();

  await page.getByRole("button", { name: "Stock In" }).click();
  await page.getByRole("button", { name: "Receive Batch" }).click();
  await page.getByRole("dialog").getByLabel("Material").selectOption("material-focus");
  const batchNumber = page.getByLabel("Batch number");
  await batchNumber.click();
  await batchNumber.pressSequentially("BATCH-FOCUS-1");
  await expect(batchNumber).toBeFocused();
  await expect(batchNumber).toHaveValue("BATCH-FOCUS-1");
});

test("expired batches can be disposed from both expiry alerts and the batch list", async ({ page }) => {
  await setStaffRole(page, "admin");
  const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const expiredBatch = {
    id: "batch-expired",
    batch_number: "EXPIRED-001",
    quantity: 50,
    remaining_quantity: 12,
    expiration_date: yesterday,
    received_at: yesterday,
    is_disposed: false,
    daysUntilExpiry: -1,
    expiryStatus: "expired",
    raw_material: { id: "material-expired", name: "Expired Tuna", unit: "g", current_stock: 12 }
  };
  let expiringEndpointRequested = false;
  await page.route("**/api/inventory/materials", async (route) => {
    await route.fulfill({
      json: {
        materials: [{
          id: "material-expired",
          name: "Expired Tuna",
          category: "Raw Material",
          unit: "g",
          current_stock: 12,
          available_quantity: 12,
          reorder_level: 5,
          cost_per_unit: 1
        }]
      }
    });
  });
  await page.route("**/api/inventory/batches*", async (route) => {
    await route.fulfill({ json: { batches: [expiredBatch] } });
  });
  await page.route("**/api/inventory/batches/expiring*", async (route) => {
    expiringEndpointRequested = true;
    await route.fulfill({ json: { batches: [expiredBatch] } });
  });

  await page.goto("/staff/inventory");
  await page.getByRole("button", { name: "Stock In" }).click();
  await expect.poll(() => expiringEndpointRequested).toBe(true);
  await expect(page.getByRole("heading", { name: "Expiration Alerts" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Dispose Now" })).toHaveCount(2);
  await expect(page.getByText(/Expired —/)).toBeVisible();
  await page.getByRole("button", { name: "Dispose Now" }).last().click();

  await expect(page.getByRole("heading", { name: "Dispose / Waste Product" })).toBeVisible();
  await expect(page.getByLabel("Material")).toHaveValue("material-expired");
  await expect(page.getByLabel("Batch (optional — auto FEFO if not selected)")).toHaveValue("batch-expired");
  await expect(page.getByLabel("Quantity to dispose")).toHaveValue("12");
});

test("materials search and status filters persist in the URL and clear together", async ({ page }) => {
  await setStaffRole(page, "admin");
  await page.route("**/api/inventory/materials", async (route) => {
    await route.fulfill({
      json: {
        materials: [
          {
            id: "material-rice",
            name: "Rice",
            category: "Raw Material",
            unit: "g",
            current_stock: 900,
            reserved_quantity: 0,
            available_quantity: 300,
            reorder_level: 500,
            cost_per_unit: 0.65
          },
          {
            id: "material-water",
            name: "Bottled Water",
            category: "Beverage",
            unit: "bottle",
            current_stock: 18,
            reserved_quantity: 0,
            available_quantity: 18,
            reorder_level: 20,
            cost_per_unit: 65
          },
          {
            id: "material-tuna",
            name: "Tuna",
            category: "Raw Material",
            unit: "g",
            current_stock: 2500,
            reserved_quantity: 0,
            available_quantity: 2500,
            reorder_level: 500,
            cost_per_unit: 0.82
          }
        ]
      }
    });
  });

  await page.goto("/staff/inventory?search=rice&filter=low");

  const search = page.getByRole("searchbox", { name: "Search materials" });
  await expect(search).toHaveValue("rice");
  const row = page.getByRole("row").filter({ hasText: "Rice" });
  await expect(row).toBeVisible();
  await expect(row).toContainText("₱65.00 / 100 g");
  await expect(page.getByRole("row").filter({ hasText: "Tuna" })).toHaveCount(0);

  await page.getByRole("button", { name: /^OK/ }).click();
  await expect(page).toHaveURL(/filter=ok/);
  await expect(page.getByText("No materials match your filters")).toBeVisible();

  await page.getByRole("button", { name: "Clear filters" }).click();
  await expect(page).toHaveURL(/filter=all/);
  await expect(page).not.toHaveURL(/search=/);
  await expect(page.getByRole("row").filter({ hasText: "Tuna" })).toBeVisible();
  await expect(page.getByRole("row").filter({ hasText: "Bottled Water" })).toBeVisible();

  const beveragesGroup = page.getByRole("button", { name: /Beverages/ });
  await expect(beveragesGroup).toHaveAttribute("aria-expanded", "true");
  await beveragesGroup.click();
  await expect(page.getByRole("row").filter({ hasText: "Bottled Water" })).toHaveCount(0);
  await beveragesGroup.click();

  const onHandHeader = page.getByRole("columnheader", { name: "On hand" }).first();
  await onHandHeader.getByRole("button").click();
  await expect(onHandHeader).toHaveAttribute("aria-sort", "ascending");

  await page.setViewportSize({ width: 390, height: 844 });
  const addMaterialButton = page.getByRole("button", { name: "Add material" });
  const addButtonBox = await addMaterialButton.boundingBox();
  expect(addButtonBox?.height).toBeGreaterThanOrEqual(44);
  const tableScroller = page.locator(".materials-table-scroll").first();
  await expect.poll(() => tableScroller.evaluate((element) => element.scrollWidth > element.clientWidth)).toBe(true);
});

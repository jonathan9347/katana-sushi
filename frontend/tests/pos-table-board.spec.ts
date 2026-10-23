import { expect, test, type Page } from "@playwright/test";

const tables = [
  {
    id: "table-1",
    table_number: 11,
    capacity: 4,
    status: "occupied",
    linked_to_table_id: null,
    unavailable_reason: null,
    active_session: { id: "session-1", guests: [{ id: "guest-1" }] }
  },
  {
    id: "table-2",
    table_number: 12,
    capacity: 4,
    status: "available",
    linked_to_table_id: null,
    unavailable_reason: null,
    active_session: null
  },
  {
    id: "table-3",
    table_number: 13,
    capacity: 4,
    status: "unavailable",
    linked_to_table_id: "table-1",
    unavailable_reason: "linked",
    active_session: null
  },
  {
    id: "table-4",
    table_number: 14,
    capacity: 4,
    status: "available",
    linked_to_table_id: null,
    unavailable_reason: null,
    active_session: null
  }
];

async function openPosWithTableMocks(
  page: Page,
  role = "cashier",
  onCreateTable: () => void = () => {},
  onSeat: (tableId: string) => void = () => {}
) {
  let createdSession: {
    id: string;
    status: string;
    table_id: string;
    table: { id: string; table_number: number; capacity: number };
    guests: Array<{ id: string; guest_number: number }>;
    orders: unknown[];
    unlimited_sessions: unknown[];
  } | null = null;
  await page.addInitScript((storedRole) => {
    localStorage.setItem("katana_token", "playwright-token");
    localStorage.setItem("katana_role", storedRole);
    localStorage.setItem("katana_user", JSON.stringify({
      id: "staff-1",
      email: "staff@example.test",
      name: "Test Staff",
      role: storedRole
    }));
  }, role);
  await page.route("**/api/**", async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname === "/api/products") {
      await route.fulfill({ json: { products: [{
        id: "product-1",
        name: "California Roll",
        category: "Sushi",
        price: 100,
        is_available: true,
        available_stock: 10,
        cart_compatibility: {
          a_la_carte: { allowed: true, classification: "a_la_carte_only" },
          unlimited: { allowed: false, classification: "a_la_carte_only" }
        }
      }] } });
      return;
    }
    if (url.pathname === "/api/pos/dining/tables" && route.request().method() === "GET") {
      await route.fulfill({ json: { tables } });
      return;
    }
    if (url.pathname === "/api/pos/dining/sessions" && route.request().method() === "GET") {
      await route.fulfill({ json: { sessions: [{
        id: "session-1",
        status: "active",
        table_id: "table-1",
        table: { id: "table-1", table_number: 11, capacity: 4 },
        guests: [{ id: "guest-1", guest_number: 1 }],
        orders: [],
        unlimited_sessions: []
      }, ...(createdSession ? [createdSession] : [])] } });
      return;
    }
    if (url.pathname === "/api/pos/dining/upcoming-reservations") {
      await route.fulfill({ json: { reservations: [{
        id: "reservation-1",
        time: "07:30 PM",
        customer_name: "Ava Guest",
        party_size: 3,
        table_numbers: [12],
        temporary_table_numbers: [],
        state: "late"
      }] } });
      return;
    }
    if (url.pathname === "/api/pos/dining/sessions" && route.request().method() === "POST") {
      const tableId = route.request().postDataJSON().tableId as string;
      onSeat(tableId);
      createdSession = {
        id: "session-new",
        status: "active",
        table_id: tableId,
        table: { id: tableId, table_number: 14, capacity: 4 },
        guests: [],
        orders: [],
        unlimited_sessions: []
      };
      await route.fulfill({ status: 201, json: { session: { id: "session-new" } } });
      return;
    }
    if (url.pathname === "/api/pos/dining/tables" && route.request().method() === "POST") {
      onCreateTable();
      await route.fulfill({ status: 201, json: { table: { ...tables[3], id: "table-5", table_number: 15 } } });
      return;
    }
    await route.fulfill({ json: {} });
  });
  await page.goto("/staff/pos");
}

test("walk-in board is a pure status grid and stages free-table choice without seating", async ({ page }) => {
  let sessionCreationCount = 0;
  await openPosWithTableMocks(page, "cashier", undefined, () => { sessionCreationCount += 1; });

  await page.getByRole("button", { name: "New Customer" }).click();
  await page.getByRole("dialog", { name: "New Customer" }).getByRole("button", { name: "Dine-in" }).click();
  await page.getByRole("dialog", { name: "Dine-in" }).getByRole("button", { name: "Walk-in" }).click();
  await page.getByRole("button", { name: /California Roll/ }).click();
  await page.getByRole("button", { name: "Proceed" }).click();

  const tableBoard = page.getByRole("region", { name: "Table board" });
  await expect(tableBoard).toBeVisible();
  await expect(tableBoard.getByRole("button", { name: "Select Table 14, Free" })).toBeVisible();
  await expect(tableBoard.getByRole("article", { name: "Table 11, Occupied" })).toBeVisible();
  await expect(tableBoard.getByRole("article", { name: "Table 12, Reserved" })).toBeVisible();
  await expect(tableBoard.getByRole("article", { name: "Table 13, Unavailable" })).toBeVisible();
  await expect(tableBoard.getByText("Upcoming reservations")).toHaveCount(0);
  await expect(tableBoard.getByText("Active tables")).toHaveCount(0);
  await expect(tableBoard.getByRole("button", { name: "Seat walk-in" })).toHaveCount(0);

  await tableBoard.getByRole("button", { name: "Select Table 14, Free" }).click();
  await expect(page.getByRole("region", { name: "POS order builder" })).toBeVisible();
  await expect(page.getByText("Table 14 selected")).toBeVisible();
  expect(sessionCreationCount).toBe(0);
});

test("existing-table board only selects occupied tables with a live session", async ({ page }) => {
  await openPosWithTableMocks(page);
  await page.getByRole("button", { name: "Existing Table" }).click();
  await page.getByRole("button", { name: /California Roll/ }).click();
  await page.getByRole("button", { name: "Proceed" }).click();

  const tableBoard = page.getByRole("region", { name: "Table board" });
  await expect(tableBoard.getByRole("button", { name: "Select Table 11, Occupied" })).toBeVisible();
  await expect(tableBoard.getByRole("article", { name: "Table 12, Reserved" })).toBeVisible();
  await tableBoard.getByRole("button", { name: "Select Table 11, Occupied" }).click();
  await expect(page.getByRole("region", { name: "POS order builder" })).toBeVisible();
  await page.getByRole("button", { name: "Open table session tools" }).click();
  await expect(page.getByRole("heading", { name: "Table 11" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Confirm & Print" })).toBeVisible();
});

test("opens Manage tables from the main POS and preserves table creation and link controls", async ({ page }) => {
  let createTableCalled = false;
  await openPosWithTableMocks(page, "admin", () => { createTableCalled = true; });
  await page.getByRole("button", { name: "Existing Table" }).click();
  await page.getByRole("button", { name: "Proceed" }).click();
  await page.getByRole("button", { name: "Manage Tables" }).click();

  const dialog = page.getByRole("dialog", { name: "Manage tables" });
  await expect(dialog.getByLabel("Link to existing table (seated customer)").first()).toBeVisible();
  await dialog.getByLabel("New table seats").fill("6");
  await dialog.getByRole("button", { name: "Add table" }).click();
  await expect.poll(() => createTableCalled).toBe(true);
});

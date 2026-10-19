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

test("opens the existing-table board, shows live table and reservation states, and seats a walk-in", async ({ page }) => {
  let seatedTableId = "";
  await openPosWithTableMocks(page, "cashier", undefined, (tableId) => { seatedTableId = tableId; });

  const customerType = page.getByRole("region", { name: "Customer type" });
  await customerType.getByRole("button", { name: "Existing table" }).click();

  await expect(page.locator("header").getByRole("heading", { name: "Table board", exact: true })).toBeVisible();
  await expect(page.getByText("Table 11").first()).toBeVisible();
  await expect(page.getByText("Occupied", { exact: true }).first()).toBeVisible();
  await expect(page.getByText("Reserved / held", { exact: true }).first()).toBeVisible();
  await expect(page.getByText("Unavailable · linked to Table 11")).toBeVisible();
  await expect(page.getByText("Ava Guest · 07:30 PM · Late")).toBeVisible();
  await expect(page.getByRole("heading", { name: "Dine-in order" })).toHaveCount(0);

  const freeTable = page.locator("article").filter({ hasText: "Table 14" });
  await freeTable.getByRole("button", { name: "Seat walk-in" }).click();
  await expect.poll(() => seatedTableId).toBe("table-4");
  await expect(page.getByRole("heading", { name: "Dine-in order", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: /^Unlimited/ })).toHaveCount(1);
});

test("opens Manage tables from the main POS and preserves table creation and link controls", async ({ page }) => {
  let createTableCalled = false;
  await openPosWithTableMocks(page, "admin", () => { createTableCalled = true; });
  await page.getByRole("button", { name: "Existing table" }).click();
  await page.getByRole("button", { name: "Manage tables" }).click();

  const dialog = page.getByRole("dialog", { name: "Manage tables" });
  await expect(dialog.getByLabel("Link to existing table (seated customer)").first()).toBeVisible();
  await dialog.getByLabel("New table seats").fill("6");
  await dialog.getByRole("button", { name: "Add table" }).click();
  await expect.poll(() => createTableCalled).toBe(true);
});

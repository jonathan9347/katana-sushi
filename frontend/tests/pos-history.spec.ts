import { expect, test } from "@playwright/test";

test("filters purchase history by stable table ID and includes archived temporary tables", async ({ page }) => {
  let requestedTableId = "";
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
    if (url.pathname === "/api/pos/dining/history-tables") {
      await route.fulfill({
        json: {
          tables: [
            { id: "table-12-id", table_number: 12, is_archived: false, is_temporary: false },
            { id: "temporary-table-id", table_number: 77, is_archived: true, is_temporary: true }
          ]
        }
      });
      return;
    }
    if (url.pathname === "/api/pos/transactions/unified") {
      requestedTableId = url.searchParams.get("table_id") ?? "";
      await route.fulfill({ json: { transactions: [], pagination: { page: 1, limit: 100, total: 0, pages: 0 } } });
      return;
    }
    if (url.pathname === "/api/pos/transactions/summary") {
      await route.fulfill({
        json: {
          totalSales: 0,
          totalTransactions: 0,
          averageOrderValue: 0,
          byType: {},
          byPayment: {}
        }
      });
      return;
    }
    await route.fulfill({ json: {} });
  });

  await page.goto("/staff/pos/history");

  const tableFilter = page.getByRole("combobox", { name: "Table" });
  await expect(tableFilter.locator('option[value="temporary-table-id"]')).toHaveText("Table 77 (temporary) (archived)");
  await tableFilter.selectOption("temporary-table-id");
  await expect.poll(() => requestedTableId).toBe("temporary-table-id");
});

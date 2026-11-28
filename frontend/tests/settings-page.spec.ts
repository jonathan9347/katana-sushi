import { expect, test } from "@playwright/test";

async function setUser(page: import("@playwright/test").Page, role: string) {
  await page.addInitScript((staffRole) => {
    localStorage.setItem("katana_token", "playwright-token");
    localStorage.setItem("katana_role", staffRole);
    localStorage.setItem("katana_user", JSON.stringify({
      id: `${staffRole}-1`,
      email: `${staffRole}@example.test`,
      name: `Test ${staffRole}`,
      role: staffRole
    }));
  }, role);
}

async function mockSettingsApi(page: import("@playwright/test").Page) {
  await page.route("**/api/**", async (route) => {
    const url = new URL(route.request().url());

    if (url.pathname === "/api/admin/users") {
      await route.fulfill({
        json: {
          users: [{
            id: "staff-1",
            name: "Alex Rivera",
            email: "alex@example.test",
            role: "cashier",
            last_login: null,
            created_at: "2026-11-19T00:00:00.000Z",
            updated_at: "2026-11-19T00:00:00.000Z"
          }, {
            id: "manager-1",
            name: "Jordan Manager",
            email: "jordan@example.test",
            role: "inventory_manager",
            last_login: null,
            created_at: "2026-11-19T00:00:00.000Z",
            updated_at: "2026-11-19T00:00:00.000Z"
          }],
          total: 2,
          page: 1,
          limit: 50,
          totalPages: 1
        }
      });
      return;
    }

    if (url.pathname === "/api/admin/users/staff-1/reset-password" && route.request().method() === "POST") {
      await route.fulfill({
        json: {
          message: "Password reset.",
          user: { id: "staff-1", name: "Alex Rivera", email: "alex@example.test", role: "cashier" }
        }
      });
      return;
    }

    if (url.pathname === "/api/admin/activity-logs") {
      await route.fulfill({
        json: {
          logs: [],
          total: 0,
          page: 1,
          limit: 10,
          totalPages: 1
        }
      });
      return;
    }

    await route.fulfill({ json: {} });
  });
}

test("admin Settings has Users and Activity log tabs with one view at a time", async ({ page }) => {
  await setUser(page, "admin");
  await mockSettingsApi(page);
  await page.goto("/staff/settings");

  await expect(page.getByRole("heading", { name: "Settings", exact: true })).toBeVisible();
  await expect(page.getByText("ADMIN", { exact: true })).toBeVisible();
  await expect(page.getByRole("tab", { name: "Users", exact: true })).toHaveAttribute("aria-selected", "true");
  await expect(page.locator("body")).not.toContainText(/\bstaff\b/i);
  await expect(page.getByRole("heading", { name: "User management", exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "User activity log", exact: true })).toHaveCount(0);

  await page.getByRole("tab", { name: "Activity log", exact: true }).click();
  await expect(page.getByRole("tab", { name: "Activity log", exact: true })).toHaveAttribute("aria-selected", "true");
  await expect(page.getByRole("heading", { name: "User activity log", exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "User management", exact: true })).toHaveCount(0);
});

test("non-admin roles do not see or access Settings", async ({ page }) => {
  await setUser(page, "inventory_manager");
  await mockSettingsApi(page);
  await page.goto("/staff/settings");

  await expect(page).toHaveURL(/\/staff\/dashboard$/);
  await expect(page.getByRole("link", { name: "Settings" })).toHaveCount(0);
});

test("account menu no longer offers profile or password actions", async ({ page }) => {
  await setUser(page, "admin");
  await mockSettingsApi(page);
  await page.goto("/staff/settings");
  await page.getByRole("button", { name: "Profile" }).click();

  await expect(page.getByRole("button", { name: "My Profile" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Change Password" })).toHaveCount(0);
  await expect(page.getByRole("menuitem", { name: "Log out" })).toBeVisible();
});

test("Users filters by role and has no status or deactivation controls", async ({ page }) => {
  await setUser(page, "admin");
  await mockSettingsApi(page);
  await page.goto("/staff/settings");

  await page.getByRole("group", { name: "Filter users by role" }).getByRole("button", { name: "Inventory manager" }).click();
  await expect(page.getByText("Jordan Manager")).toBeVisible();
  await expect(page.getByText("Alex Rivera")).toHaveCount(0);
  await expect(page.getByRole("columnheader", { name: "Status" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: /Deactivate/ })).toHaveCount(0);
});

test("the legacy staff role is displayed as Team member", async ({ page }) => {
  await setUser(page, "admin");
  await mockSettingsApi(page);
  await page.goto("/staff/settings");
  await page.getByRole("button", { name: "Add user" }).click();

  await expect(page.getByRole("radio", { name: "Team member" })).toBeVisible();
  await expect(page.locator("body")).not.toContainText(/\bstaff\b/i);
});

test("admin reset-password action submits the new password but never displays it in the response", async ({ page }) => {
  await setUser(page, "admin");
  await mockSettingsApi(page);
  await page.goto("/staff/settings");
  await page.getByRole("button", { name: "Edit Alex Rivera" }).click();

  const resetRequest = page.waitForRequest((request) =>
    request.url().includes("/api/admin/users/staff-1/reset-password") && request.method() === "POST"
  );
  const resetResponse = page.waitForResponse((response) =>
    response.url().includes("/api/admin/users/staff-1/reset-password")
  );

  const newPassword = page.getByRole("textbox", { name: "New password", exact: true });
  await newPassword.fill("NewStaffPassword123!");
  await page.getByRole("button", { name: "Reset password" }).click();

  expect((await resetRequest).postDataJSON()).toEqual({ password: "NewStaffPassword123!" });
  const responseBody = await (await resetResponse).json();
  expect(responseBody).toEqual({
    message: "Password reset.",
    user: { id: "staff-1", name: "Alex Rivera", email: "alex@example.test", role: "cashier" }
  });
  expect(JSON.stringify(responseBody)).not.toContain("NewStaffPassword123!");
  await expect(newPassword).toHaveValue("");
});
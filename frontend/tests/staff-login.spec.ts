import { expect, test } from "@playwright/test";

test("staff login retains validation, password visibility, and forgot-password messaging", async ({ page }) => {
  await page.goto("/staff/login");

  await expect(page.getByRole("heading", { name: "Service starts here." })).toBeVisible();
  await expect(page.getByLabel("Email address")).toHaveAttribute("autocomplete", "username");
  await expect(page.getByRole("textbox", { name: "Password", exact: true })).toHaveAttribute("autocomplete", "current-password");

  await page.getByRole("textbox", { name: "Password", exact: true }).fill("secret123");
  const passwordToggle = page.getByRole("button", { name: "Show password" });
  await passwordToggle.click();
  await expect(page.getByRole("textbox", { name: "Password", exact: true })).toHaveAttribute("type", "text");
  await expect(page.getByRole("button", { name: "Hide password" })).toHaveAttribute("aria-pressed", "true");

  await page.getByLabel("Keep me signed in").check();
  await expect(page.getByLabel("Keep me signed in")).toBeChecked();
  await page.getByRole("button", { name: "Forgot password?" }).click();
  await expect(page.getByRole("alert")).toContainText("Contact your manager to reset your login access.");

  await page.getByLabel("Email address").fill("invalid");
  await page.getByRole("button", { name: "Sign in now" }).click();
  await expect(page.getByText("Enter a valid email address.")).toBeVisible();
});

test("successful login shows the signing and welcome stages then uses the existing role redirect", async ({ page }) => {
  await page.route("**/api/auth/login", async (route) => {
    await new Promise((resolve) => setTimeout(resolve, 500));
    await route.fulfill({
      json: {
        token: "test-token",
        user: { id: "staff-1", email: "staff@example.test", role: "cashier", name: "Staff Tester" }
      }
    });
  });
  await page.goto("/staff/login");
  await page.getByLabel("Email address").fill("staff@example.test");
  await page.getByRole("textbox", { name: "Password", exact: true }).fill("secret123");

  await page.getByRole("button", { name: "Sign in now" }).click();
  await expect(page.getByRole("heading", { name: "Signing you in" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Sign in now" })).toBeDisabled();
  await expect(page.getByRole("heading", { name: "Welcome back" })).toBeVisible({ timeout: 3000 });
  await expect(page).toHaveURL(/\/staff\/pos$/);
  expect(await page.evaluate(() => localStorage.getItem("katana_token"))).toBe("test-token");
});

test("failed login closes the animation, keeps entered values, and shows the existing error", async ({ page }) => {
  await page.route("**/api/auth/login", (route) => route.fulfill({ status: 401, json: { message: "Unauthorized" } }));
  await page.goto("/staff/login");
  await page.getByLabel("Email address").fill("staff@example.test");
  await page.getByRole("textbox", { name: "Password", exact: true }).fill("wrong-password");

  await page.getByRole("button", { name: "Sign in now" }).click();
  await expect(page.getByRole("alert")).toContainText("Invalid email or password. Please try again.");
  await expect(page.locator(".staff-login-auth-overlay")).toHaveCount(0, { timeout: 2000 });
  await expect(page.getByLabel("Email address")).toHaveValue("staff@example.test");
  await expect(page.getByRole("textbox", { name: "Password", exact: true })).toHaveValue("wrong-password");
  await expect(page.getByRole("button", { name: "Sign in now" })).toBeEnabled();
});

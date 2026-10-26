import { expect, test, type Page } from "@playwright/test";

const products = [
  {
    id: "roll-1",
    name: "California Roll",
    category: "Rolls",
    price: 120,
    description: "Crab and cucumber",
    image_url: null,
    is_available: true
  },
  {
    id: "nigiri-1",
    name: "Salmon Nigiri",
    category: "Nigiri",
    price: 80,
    description: "Fresh salmon",
    image_url: null,
    is_available: true
  }
];

async function mockPickupApi(page: Page, catalog = products) {
  const submittedBodies: Array<Record<string, unknown>> = [];
  const statusRequests: Array<{ orderNumber: string; phone: string | null }> = [];
  await page.route("**/api/takeout/catalog", async (route) => {
    await route.fulfill({ json: { products: catalog } });
  });
  await page.route("**/api/takeout/orders**", async (route) => {
    if (route.request().method() === "POST") {
      submittedBodies.push(route.request().postDataJSON() as Record<string, unknown>);
      await route.fulfill({
        status: 201,
        json: {
          order: {
            order_number: "KTO-CASH-001",
            status: "pending_approval",
            payment_plan: "pay_at_pickup",
            payment_status: "unpaid",
            subtotal: 320,
            total: 320,
            ready_at: null,
            items: [
              { name: "California Roll", quantity: 2, unit_price: 120, total_price: 240 },
              { name: "Salmon Nigiri", quantity: 1, unit_price: 80, total_price: 80 }
            ]
          },
          payment: null
        }
      });
      return;
    }

    const url = new URL(route.request().url());
    statusRequests.push({
      orderNumber: decodeURIComponent(url.pathname.split("/").at(-1) ?? ""),
      phone: url.searchParams.get("phone")
    });
    await route.fulfill({
      json: {
        order: {
          status: "pending_approval",
          payment_plan: "pay_at_pickup",
          payment_status: "unpaid",
          ready_at: null,
          total: 320,
          items: [
            { name: "California Roll", quantity: 2, unit_price: 120, total_price: 240 },
            { name: "Salmon Nigiri", quantity: 1, unit_price: 80, total_price: 80 }
          ]
        }
      }
    });
  });
  return { submittedBodies, statusRequests };
}

test("pickup contact popup validates, submits without email, and opens pickup status", async ({ page }) => {
  const { submittedBodies, statusRequests } = await mockPickupApi(page);
  await page.goto("/takeout", { waitUntil: "domcontentloaded" });
  await page.getByRole("button", { name: "Add to cart" }).first().click();
  await page.getByRole("button", { name: "Add to cart", exact: true }).click();
  await page.getByRole("region", { name: "Choose pickup menu items" })
    .getByRole("button", { name: "Add one California Roll" }).click();

  const cartPanel = page.getByRole("complementary", { name: "Your pickup order" });
  await expect(cartPanel).toBeVisible();
  await expect(cartPanel.getByRole("region", { name: "Contact details" })).toHaveCount(0);
  await expect(page.getByLabel(/email/i)).toHaveCount(0);
  await expect(cartPanel).toContainText("Your pickup order");
  await expect(cartPanel).toContainText("3 items");
  await expect(cartPanel).toContainText("California Roll");
  await expect(cartPanel).toContainText(/120.*each/);
  await expect(cartPanel).toContainText(/240/);
  await expect(cartPanel).toContainText("Prep time");
  await expect(cartPanel).toContainText("About 25 min");
  await expect(cartPanel).toContainText("Katana counter");
  await expect(cartPanel.getByRole("region", { name: "How pickup works" })).toBeVisible();
  await expect(cartPanel).toContainText("No payment needed now. Orders are held for pickup once approved.");
  await expect(cartPanel).not.toContainText("30 minutes");
  await expect(cartPanel).toContainText("Total to pay at counter");

  await cartPanel.getByRole("button", { name: "Confirm pickup order" }).click();
  const dialog = page.getByRole("dialog", { name: "Contact details" });
  await expect(dialog).toBeVisible();
  await expect(dialog).toContainText("Almost done");
  await expect(dialog).toContainText("So we can call you when your order is ready.");
  await expect(dialog.locator("input")).toHaveCount(2);
  await expect(dialog.getByLabel("Name")).toBeVisible();
  await expect(dialog.getByLabel("Phone number")).toBeVisible();
  await expect(dialog.getByLabel(/email/i)).toHaveCount(0);
  await expect(dialog).toContainText("3 items, pay at counter");
  await expect(dialog).toContainText(/320/);

  await dialog.getByRole("button", { name: "Send pickup order" }).click();
  await expect(dialog.locator('[role="alert"]')).toHaveCount(2);
  await expect(dialog).toContainText("Enter your name.");
  await expect(dialog).toContainText("Enter a valid 11-digit mobile number starting with 09.");
  await dialog.getByLabel("Name").fill("Pickup Guest");
  await dialog.getByLabel("Phone number").fill("0912345");
  await dialog.getByRole("button", { name: "Send pickup order" }).click();
  await expect(dialog).toContainText("Enter a valid 11-digit mobile number starting with 09.");

  await dialog.getByLabel("Phone number").fill("09123456789");
  await dialog.getByRole("button", { name: "Back to order" }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await cartPanel.getByRole("button", { name: "Confirm pickup order" }).click();
  await dialog.getByRole("button", { name: "Close dialog" }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await cartPanel.getByRole("button", { name: "Confirm pickup order" }).click();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await cartPanel.getByRole("button", { name: "Confirm pickup order" }).click();
  await dialog.getByLabel("Name").fill("Pickup Guest");
  await dialog.getByLabel("Phone number").fill("09123456789");
  await dialog.getByRole("button", { name: "Send pickup order" }).click();

  await expect(page).toHaveURL(/\/reservation\/status\?bookingId=KTO-CASH-001$/);
  await expect(page.getByRole("heading", { name: "Check Booking Status" })).toBeVisible();
  await expect(page.getByText("pending approval")).toBeVisible();
  expect(submittedBodies).toHaveLength(1);
  expect(submittedBodies[0]).toMatchObject({
    customer_name: "Pickup Guest",
    customer_phone: "09123456789",
    payment_plan: "pay_at_pickup",
    items: [
      { product_id: "roll-1", quantity: 2 },
      { product_id: "nigiri-1", quantity: 1 }
    ]
  });
  expect(submittedBodies[0]).not.toHaveProperty("customer_email");
  expect(submittedBodies[0]).not.toHaveProperty("email");
  expect(submittedBodies[0]).not.toHaveProperty("payment_method");
  await expect.poll(() => statusRequests.length).toBeGreaterThan(0);
  expect(statusRequests.every(({ orderNumber, phone }) =>
    orderNumber === "KTO-CASH-001" && phone === "09123456789"
  )).toBe(true);
});

test("empty pickup cart keeps confirmation disabled and shows guidance", async ({ page }) => {
  await mockPickupApi(page, []);
  await page.goto("/takeout", { waitUntil: "domcontentloaded" });

  const cartPanel = page.getByRole("complementary", { name: "Your pickup order" });
  await expect(cartPanel.getByText("Nothing here yet")).toBeVisible();
  await expect(cartPanel).toContainText("Add rolls, nigiri or bowls from the menu to start your pickup order.");
  await expect(cartPanel.getByRole("region", { name: "How pickup works" })).toBeVisible();
  await expect(cartPanel.getByRole("button", { name: "Confirm pickup order" })).toBeDisabled();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(page.getByLabel(/email/i)).toHaveCount(0);
});

test("pickup contact popup fits mobile width", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await mockPickupApi(page);
  await page.goto("/takeout", { waitUntil: "domcontentloaded" });
  await page.getByRole("button", { name: "Add to cart" }).first().click();
  await page.getByRole("button", { name: "Confirm pickup order" }).click();

  const dialog = page.getByRole("dialog", { name: "Contact details" });
  await expect(dialog).toBeVisible();
  const dialogBox = await dialog.boundingBox();
  expect(dialogBox).not.toBeNull();
  expect(dialogBox!.width).toBeLessThanOrEqual(390);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
});

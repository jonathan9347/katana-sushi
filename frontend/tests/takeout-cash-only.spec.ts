import { expect, test, type Page } from "@playwright/test";

const products = [
  {
    id: "roll-1",
    name: "California Roll",
    category: "Rolls",
    price: 120,
    description: "Crab and cucumber",
    image_url: null,
    available_stock: 5,
    is_available: true
  },
  {
    id: "nigiri-1",
    name: "Salmon Nigiri",
    category: "Nigiri",
    price: 80,
    description: "Fresh salmon",
    image_url: null,
    available_stock: 8,
    is_available: true
  }
];

async function mockPickupApi(page: Page, catalog = products) {
  const submittedBodies: Array<Record<string, unknown>> = [];
  const statusRequests: Array<{ orderNumber: string; phone: string | null }> = [];
  await page.route("**/api/reservations/rules", async (route) => {
    await route.fulfill({
      json: {
        settings: {
          OPENING_TIME: "10:00",
          CLOSING_TIME: "22:00"
        },
        server_now: "2025-01-01T00:00:00.000Z"
      }
    });
  });
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
            pickup_time: "2026-10-28T05:00:00.000Z",
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
  await expect(cartPanel.getByRole("region", { name: "How pickup works" })).toHaveCount(0);
  await expect(cartPanel.getByRole("region", { name: "Pickup location" })).toBeVisible();
  await expect(cartPanel.getByRole("region", { name: "Pickup location" })).toContainText("Katana Sushi, front counter");
  await expect(cartPanel.getByRole("region", { name: "Pickup location" })).toContainText("[Add restaurant street address]");
  await expect(cartPanel.getByRole("region", { name: "Pickup location" })).toContainText("10:00 AM – 10:00 PM");
  await expect(cartPanel.getByRole("region", { name: "Pickup location" })).toContainText("[Add restaurant phone number]");
  await expect(cartPanel.getByRole("region", { name: "Pickup time" })).toBeVisible();
  await expect(cartPanel).toContainText("Pickup is available from 1:00 PM until 9:00 PM.");
  await expect(cartPanel).toContainText("No payment is needed now. Please wait for staff approval before preparation begins.");
  await expect(cartPanel).not.toContainText("30 minutes");
  await expect(cartPanel).toContainText("Total to pay at counter");

  await expect(cartPanel.getByRole("button", { name: "Choose a pickup time" })).toBeDisabled();
  await cartPanel.getByRole("button", { name: "1:00 PM" }).click();
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
  await expect(dialog).toContainText("Pickup time: 1:00 PM");

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

  const success = page.getByRole("dialog", { name: "Your pickup order is sent." });
  await expect(success).toBeVisible();
  await expect(success).toContainText("KTO-CASH-001");
  await expect(success).toContainText("1:00 PM");
  await expect(success.getByRole("link", { name: "See order status" })).toHaveAttribute("href", /reservation\/status\?bookingId=KTO-CASH-001/);
  await expect(success.getByLabel("Booking ID")).toHaveCount(0);
  await expect(success.getByLabel("Phone number")).toHaveCount(0);
  expect(submittedBodies).toHaveLength(1);
  expect(submittedBodies[0]).toMatchObject({
    customer_name: "Pickup Guest",
    customer_phone: "09123456789",
    payment_plan: "pay_at_pickup",
    pickup_time: "2026-10-28T05:00:00.000Z",
    items: [
      { product_id: "roll-1", quantity: 2 },
      { product_id: "nigiri-1", quantity: 1 }
    ]
  });
  expect(submittedBodies[0]).not.toHaveProperty("customer_email");
  expect(submittedBodies[0]).not.toHaveProperty("email");
  expect(submittedBodies[0]).not.toHaveProperty("payment_method");
  expect(statusRequests).toHaveLength(0);
});

test("empty pickup cart keeps confirmation disabled and shows location details", async ({ page }) => {
  await mockPickupApi(page, []);
  await page.goto("/takeout", { waitUntil: "domcontentloaded" });

  const cartPanel = page.getByRole("complementary", { name: "Your pickup order" });
  await expect(cartPanel).toContainText("0 items");
  await expect(cartPanel.getByText("Nothing here yet")).toBeVisible();
  await expect(cartPanel).toContainText("Add rolls, nigiri or bowls from the menu to start your pickup order.");
  await expect(cartPanel.getByRole("region", { name: "How pickup works" })).toHaveCount(0);
  await expect(cartPanel.getByRole("region", { name: "Pickup location" })).toBeVisible();
  await expect(cartPanel.getByRole("region", { name: "Pickup time" })).toBeVisible();
  await expect(cartPanel.getByRole("region", { name: "Pickup location" })).toContainText("[Add restaurant street address]");
  await expect(cartPanel.getByRole("button", { name: "Choose a pickup time" })).toBeDisabled();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(page.getByLabel(/email/i)).toHaveCount(0);
});

test("pickup menu and cart stop at the available stock quantity", async ({ page }) => {
  await mockPickupApi(page, [{ ...products[0], available_stock: 2 }]);
  await page.goto("/takeout", { waitUntil: "domcontentloaded" });

  const menu = page.getByRole("region", { name: "Choose pickup menu items" });
  await expect(menu).toContainText("2 available");
  await menu.getByRole("button", { name: "Add to cart" }).click();
  await menu.getByRole("button", { name: "Add one California Roll" }).click();

  const cart = page.getByRole("complementary", { name: "Your pickup order" });
  await expect(cart).toContainText("2 items");
  await expect(cart.getByRole("button", { name: "Add one California Roll" })).toBeDisabled();
  await expect(menu.getByRole("button", { name: "Add one California Roll" })).toBeDisabled();
});

test("pickup custom time rejects out-of-range values and accepts both endpoints", async ({ page }) => {
  await mockPickupApi(page);
  await page.goto("/takeout", { waitUntil: "domcontentloaded" });
  const panel = page.getByRole("complementary", { name: "Your pickup order" });
  await page.getByRole("button", { name: "Add to cart" }).first().click();
  const input = panel.getByLabel("Or choose another time");
  await input.fill("12:45");
  await expect(panel.getByRole("alert")).toContainText("Pickup time must be between 1:00 PM and 9:00 PM.");
  await expect(panel.getByRole("button", { name: "Choose a pickup time" })).toBeDisabled();
  await input.fill("13:00");
  await expect(panel.getByText("1:00 PM", { exact: true }).first()).toBeVisible();
  await expect(panel.getByRole("button", { name: "Confirm pickup order" })).toBeEnabled();
  await input.fill("21:15");
  await expect(panel.getByRole("alert")).toContainText("Pickup time must be between 1:00 PM and 9:00 PM.");
  await input.fill("21:00");
  await expect(panel.getByText("9:00 PM", { exact: true }).first()).toBeVisible();
  await expect(panel.getByRole("button", { name: "Confirm pickup order" })).toBeEnabled();
});

for (const viewport of [
  { width: 1366, height: 768 },
  { width: 1920, height: 910 },
  { width: 1920, height: 1080 }
]) {
  test(`pickup cart fills the viewport at ${viewport.width}x${viewport.height}`, async ({ page }) => {
    await page.setViewportSize(viewport);
    await mockPickupApi(page);
    await page.goto("/takeout", { waitUntil: "domcontentloaded" });
    const cartPanel = page.getByRole("complementary", { name: "Your pickup order" });
    await expect(cartPanel).toBeVisible();
    const homeButton = page.getByRole("link", { name: "Back to home" });
    const confirmButton = cartPanel.getByRole("button", { name: "Choose a pickup time" });

    async function expectPanelGeometry() {
      const panelBox = await cartPanel.boundingBox();
      const homeBox = await homeButton.boundingBox();
      const buttonBox = await confirmButton.boundingBox();
      expect(panelBox).not.toBeNull();
      expect(homeBox).not.toBeNull();
      expect(buttonBox).not.toBeNull();
      expect(Math.abs(panelBox!.y - homeBox!.y)).toBeLessThanOrEqual(2);
      expect(Math.abs(viewport.height - panelBox!.y - panelBox!.height - 16)).toBeLessThanOrEqual(2);
      expect(buttonBox!.y).toBeGreaterThanOrEqual(panelBox!.y);
      expect(buttonBox!.y + buttonBox!.height).toBeLessThanOrEqual(panelBox!.y + panelBox!.height);
      expect(await page.evaluate(() => window.scrollY)).toBe(0);
      await expect(confirmButton).toBeInViewport();
    }

    await expectPanelGeometry();
    await page.getByRole("button", { name: "Add to cart" }).first().click();
    await expectPanelGeometry();
  });
}

test("pickup cart scroll reveals location and pickup time at 1920x910", async ({ page }) => {
  await page.setViewportSize({ width: 1920, height: 910 });
  const expandedCatalog = Array.from({ length: 6 }, (_, index) => ({
    ...products[0],
    id: `roll-${index + 1}`,
    name: `California Roll ${index + 1}`
  }));
  await mockPickupApi(page, expandedCatalog);
  await page.goto("/takeout", { waitUntil: "domcontentloaded" });
  const menu = page.getByRole("region", { name: "Choose pickup menu items" });
  for (let index = 0; index < expandedCatalog.length; index += 1) {
    await menu.getByRole("button", { name: "Add to cart", exact: true }).first().click();
  }
  await page.evaluate(() => window.scrollTo(0, 0));

  const cartPanel = page.getByRole("complementary", { name: "Your pickup order" });
  const scrollArea = cartPanel.locator(".customer-pickup-cart-scroll");
  await expect(scrollArea).toHaveAttribute("data-scroll-active", "false");
  const scrollMetrics = await scrollArea.evaluate((element) => ({
    clientHeight: element.clientHeight,
    scrollHeight: element.scrollHeight
  }));
  expect(scrollMetrics.scrollHeight).toBeGreaterThan(scrollMetrics.clientHeight);

  const callRow = cartPanel.getByText("Call the restaurant");
  await scrollArea.evaluate((element) => {
    const target = element.querySelector(".customer-pickup-location-row:last-child");
    if (target) element.scrollTop += target.getBoundingClientRect().top - element.getBoundingClientRect().top;
  });
  await expect(callRow).toBeInViewport();
  const pickupTime = cartPanel.getByRole("region", { name: "Pickup time" });
  await scrollArea.evaluate((element) => {
    element.scrollTop = element.scrollHeight;
  });
  await expect(pickupTime).toBeInViewport();
  await expect(scrollArea).toHaveAttribute("data-scroll-active", "true");
  await expect(scrollArea).toHaveAttribute("data-scroll-active", "false", { timeout: 2_000 });
  expect(await page.evaluate(() => window.scrollY)).toBe(0);
});

test("pickup contact popup fits mobile width", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await mockPickupApi(page);
  await page.goto("/takeout", { waitUntil: "domcontentloaded" });
  await page.getByRole("button", { name: "Add to cart" }).first().click();
  await page.getByRole("button", { name: "1:00 PM" }).click();
  await page.getByRole("button", { name: "Confirm pickup order" }).click();

  const dialog = page.getByRole("dialog", { name: "Contact details" });
  await expect(dialog).toBeVisible();
  const dialogBox = await dialog.boundingBox();
  expect(dialogBox).not.toBeNull();
  expect(dialogBox!.width).toBeLessThanOrEqual(390);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
});

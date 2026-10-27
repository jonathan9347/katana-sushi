import { expect, test, type Page } from "@playwright/test";

const viewportSizes = [
  { width: 1366, height: 768 },
  { width: 1440, height: 900 },
  { width: 1920, height: 1080 }
];

const products = ["Sushi", "Sashimi"].flatMap((category) =>
  Array.from({ length: 12 }, (_, index) => ({
    id: `${category.toLowerCase()}-${index}`,
    name: `Test ${category} ${index + 1}`,
    category,
    price: 500,
    is_available: true
  }))
);

const reservationRules = {
  MAX_PAX_PER_SLOT: 60,
  MAX_GUESTS_PER_BOOKING: 20,
  SLOT_DURATION_MINUTES: 30,
  LATE_ALERT_MINUTES: 15,
  LATE_ACTION: "alert_staff",
  OPENING_TIME: "11:00",
  CLOSING_TIME: "22:00",
  LAST_BOOKING_TIME: "21:00",
  MIN_LEAD_MINUTES: 15,
  TIME_ZONE: "Asia/Manila",
  PAYMENT_GATEWAY: "fake"
};

const staffCateringReservations = [
  {
    id: "catering-pending",
    reservation_id: "CAT-PENDING-001",
    customer_name: "Pending Customer",
    customer_phone: "09123456789",
    customer_email: "pending@example.test",
    confirmed_date: "2099-01-10T00:00:00.000Z",
    event_time: "12:00",
    package_total: 6000,
    total_price: 6000,
    downpayment_amount: 3000,
    remaining_balance: 3000,
    payment_status: "Partial",
    status: "pending_approval",
    headcount: 50,
    package: { name: "Sushi Station" },
    package_snapshot: []
  },
  {
    id: "catering-confirmed",
    reservation_id: "CAT-CONFIRMED-001",
    customer_name: "Confirmed Customer",
    customer_phone: "09123456789",
    customer_email: "confirmed@example.test",
    confirmed_date: "2099-01-10T00:00:00.000Z",
    event_time: "13:00",
    package_total: 6000,
    total_price: 6000,
    downpayment_amount: 6000,
    remaining_balance: 0,
    payment_status: "Paid",
    status: "confirmed",
    headcount: 50,
    package: { name: "Sushi Station" },
    package_snapshot: []
  },
  {
    id: "catering-in-progress",
    reservation_id: "CAT-PREPARING-001",
    customer_name: "Preparing Customer",
    customer_phone: "09123456789",
    customer_email: "preparing@example.test",
    confirmed_date: "2099-01-10T00:00:00.000Z",
    event_time: "14:00",
    package_total: 6000,
    total_price: 6000,
    downpayment_amount: 6000,
    remaining_balance: 0,
    payment_status: "Paid",
    status: "in_progress",
    headcount: 50,
    package: { name: "Sushi Station" },
    package_snapshot: []
  }
];

const cateringPackages = [
  {
    id: "pkg_sushi_test",
    stationType: "sushi_station",
    name: "Sushi Station",
    description: "50-60 pax",
    pricePerPerson: 0,
    minPax: 50,
    maxPax: 60,
    items: {
      pricingType: "flat",
      pricingModel: "tier",
      flatPrice: 6000,
      inclusions: [
        "California Maki",
        "Mango Roll",
        "Volcano Roll",
        "Tori Teriyaki Roll",
        "Salmon Cheese Maki",
        "Futo California",
        "Tamago Sushi",
        "Kani Sushi",
        "Salmon Nigiri"
      ],
      galleryImages: ["/sushi-1.jpg", "/sushi-2.jpg", "/sushi-3.jpg"]
    },
    imageUrl: "/sushi-1.jpg"
  },
  {
    id: "pkg_sashimi_tuna_test",
    stationType: "tuna_add_on",
    name: "Tuna",
    description: "Tuna add-on, 1-40 kg at PHP 1,200/kg.",
    pricePerPerson: 0,
    minPax: 0,
    maxPax: 0,
    items: {
      pricingType: "range",
      pricingModel: "per_unit",
      pricePerKg: 1200,
      pricePerUnit: 1200,
      unit: "kg",
      minimum: 1,
      minKg: 1,
      step: 1,
      stepKg: 1,
      maximum: 40,
      maxKg: 40,
      minPrice: 1200,
      galleryImages: ["/tuna-1.jpg", "/tuna-2.jpg", "/tuna-3.jpg"]
    },
    imageUrl: "/tuna-1.jpg"
  },
  {
    id: "pkg_whole_tuna_test",
    stationType: "whole_tuna",
    name: "Whole Tuna",
    description: "Whole tuna sold by weight; 20-40 kg at PHP 1,200/kg. Booked as a standalone item.",
    pricePerPerson: 0,
    minPax: 0,
    maxPax: 0,
    items: {
      pricingType: "range",
      pricingModel: "per_unit",
      pricePerKg: 1200,
      pricePerUnit: 1200,
      unit: "kg",
      minimum: 20,
      minKg: 20,
      step: 1,
      stepKg: 1,
      maximum: 40,
      maxKg: 40,
      minPrice: 24000,
      maxPrice: 48000,
      galleryImages: ["/whole-tuna-1.jpg", "/whole-tuna-2.jpg", "/whole-tuna-3.jpg"]
    },
    imageUrl: "/whole-tuna-1.jpg"
  },
  {
    id: "pkg_sashimi_salmon_test",
    stationType: "salmon_add_on",
    name: "Salmon",
    description: "Salmon add-on, 1-40 kg at PHP 2,400/kg.",
    pricePerPerson: 0,
    minPax: 0,
    maxPax: 0,
    items: {
      pricingType: "range",
      pricingModel: "per_unit",
      pricePerKg: 2400,
      pricePerUnit: 2400,
      unit: "kg",
      minimum: 1,
      minKg: 1,
      step: 1,
      stepKg: 1,
      maximum: 40,
      maxKg: 40,
      minPrice: 2400,
      galleryImages: ["/salmon-1.jpg", "/salmon-2.jpg", "/salmon-3.jpg"]
    },
    imageUrl: "/salmon-1.jpg"
  },
  {
    id: "pkg_tempura_test",
    stationType: "tempura_live",
    name: "Live Tempura",
    description: "Live tempura station",
    pricePerPerson: 0,
    minPax: 50,
    maxPax: 50,
    items: {
      pricingType: "flat",
      pricingModel: "fixed",
      fixedPrice: 6000,
      flatPrice: 6000,
      fixedPax: 50,
      unit: "pax",
      galleryImages: ["/tempura-1.jpg", "/tempura-2.jpg", "/tempura-3.jpg"]
    },
    imageUrl: "/tempura-1.jpg"
  }
];

async function mockApi(page: Page, packages: typeof cateringPackages = []) {
  await page.route("**/api/**", async (route) => {
    const url = new URL(route.request().url());
    const origin = route.request().headers().origin ?? "http://127.0.0.1:4173";

    const headers = {
      "access-control-allow-origin": origin,
      "access-control-allow-credentials": "true",
      "access-control-allow-methods": "GET, POST, PUT, DELETE, OPTIONS",
      "access-control-allow-headers": "*"
    };
    if (route.request().method() === "OPTIONS") {
      await route.fulfill({ status: 204, headers });
      return;
    }

    let body: Record<string, unknown> = {};
    if (url.pathname === "/api/products") {
      body = { products };
    } else if (url.pathname === "/api/takeout/catalog") {
      body = { products };
    } else if (url.pathname === "/api/reservations/dine-in" && route.request().method() === "POST") {
      body = {
        booking_id: "KTN-DINE-TEST-001",
        paid_amount: 0,
        remaining_balance: 500,
        payment_plan: "pay_at_venue"
      };
    } else if (url.pathname === "/api/reservations/table-availability") {
      body = {
        availability: url.searchParams.get("time") === "12:00" ? "full" : "available",
        seats_left: url.searchParams.get("time") === "12:00" ? 0 : 20,
        checked_at: new Date().toISOString()
      };
    } else if (url.pathname === "/api/reservations/table" && route.request().method() === "POST") {
      body = { booking_id: "KTN-DINE-TEST-001", status: "confirmed" };
    } else if (url.pathname === "/api/reservations/rules") {
      body = { settings: reservationRules, server_now: new Date().toISOString() };
    } else if (url.pathname === "/api/reservations/dine-in/availability") {
      body = {
        availability: products.map((product) => ({
          product_id: product.id,
          available: true,
          can_add: true,
          maximum_quantity: 8
        })),
        checked_at: new Date().toISOString()
      };
    } else if (url.pathname === "/api/settings/system") {
      body = {
        settings: {
          timezone: "Asia/Manila",
          max_party_size: 30,
          reservation_duration_minutes: 90,
          reservation_grace_period_minutes: 15,
          minimum_catering_pax: 10,
          default_downpayment_percent: 50
        }
      };
    } else if (url.pathname === "/api/unlimited/settings") {
      body = { settings: {} };
    } else if (url.pathname === "/api/unlimited/products") {
      body = { productIds: [] };
    } else if (url.pathname === "/api/catering/packages") {
      body = { packages };
    } else if (url.pathname === "/api/staff/catering/reservations") {
      body = { reservations: staffCateringReservations };
    } else if (url.pathname === "/api/catering/reservations/status/CAT-TEST-001") {
      body = {
        status: "pending_approval",
        date: "2026-11-01",
        party_size: 50,
        total_price: 15600,
        package_name: "Sushi Station",
        package_snapshot: [
          {
            stationType: "tuna_add_on",
            packageName: "Tuna",
            unit: "kg",
            quantity: 3,
            rate: 1200,
            price: 3600
          },
          {
            stationType: "tempura_live",
            packageName: "Live Tempura",
            description: "Live tempura station",
            quantity: 50,
            fixedPax: 50,
            price: 6000
          }
        ]
      };
    }

    await route.fulfill({
      status: 200,
      headers: { ...headers, "content-type": "application/json" },
      body: JSON.stringify(body)
    });
  });
}

async function expectPanelBounds(page: Page, selector: string, height: number) {
  const bounds = await page.locator(selector).evaluate((panel) => {
    const rect = panel.getBoundingClientRect();
    return {
      top: Math.round(rect.top),
      bottomGap: Math.round(window.innerHeight - rect.bottom),
      rightGap: Math.round(document.documentElement.clientWidth - rect.right),
      height: Math.round(rect.height)
    };
  });

  expect(bounds).toEqual({ top: 24, bottomGap: 24, rightGap: 12, height: height - 48 });
}

test("table booking route uses the minimal Back control instead of the Home header", async ({ page }) => {
  await mockApi(page);
  await page.goto("/reserve/book");
  await expect(page.getByRole("heading", { name: "Book a table" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Back to home" })).toHaveAttribute("href", "/");
  await expect(page.getByTestId("desktop-customer-nav")).toHaveCount(0);
});

test("Catering booking summary stays full-height and keeps actions pinned at desktop widths", async ({ page }) => {
  await mockApi(page);
  await page.setViewportSize(viewportSizes[0]);
  await page.goto("/catering/book");
  const panel = page.locator("#catering-mobile-details");
  const back = page.getByRole("link", { name: "Back to home" });
  const body = panel.locator(".catering-booking-body");
  const footer = panel.locator(".catering-booking-actions");
  const action = panel.getByRole("button", { name: "Review request" });

  await expect(panel).toBeVisible();
  await expect(back).toHaveAttribute("href", "/");
  await expect(page.locator('nav a[href="/"]')).toHaveCount(0);
  await expect(panel.getByRole("heading", { name: "Event and booking details" })).toBeVisible();
  await expect(panel.getByText("Your order", { exact: true })).toBeVisible();
  await expect(page.getByText("Select a station package to begin your order.")).toBeVisible();

  for (const viewport of viewportSizes) {
    await page.setViewportSize(viewport);
    await expectPanelBounds(page, "#catering-mobile-details", viewport.height);
    await expect(action).toBeInViewport();
    await expect(body.getByLabel("Event Date *")).toBeVisible();
    await expect(body.getByLabel("Event Time *")).toBeVisible();
    await expect(footer).toBeVisible();
    await expect.poll(() => footer.evaluate((element) => element.getBoundingClientRect().bottom)).toBeLessThanOrEqual(viewport.height - 11);
  }

  await page.locator("main form > div > div").first().evaluate((left) => {
    (left as HTMLElement).style.minHeight = "1600px";
  });
  await page.evaluate(() => window.scrollTo(0, 200));
  await expect.poll(() => panel.evaluate((element) => Math.round(element.getBoundingClientRect().top))).toBe(24);
  await page.setViewportSize({ width: 800, height: 900 });
  await expect.poll(() => panel.evaluate((element) => getComputedStyle(element).position)).toBe("static");
});

test("booking summary panels show their existing empty states and action availability", async ({ page }) => {
  await mockApi(page);
  await page.setViewportSize({ width: 1280, height: 640 });
  await page.goto("/reserve/book");

  const reservationPanel = page.locator(".table-reservation-summary-panel");
  await expect(reservationPanel.getByText("Choose a time to check seat availability.")).toBeVisible();
  await expect(reservationPanel.locator(".table-reservation-summary-details")).toContainText("Date");
  await expect(reservationPanel.locator(".table-reservation-summary-details")).toContainText("Time");
  await expect(reservationPanel.locator(".table-reservation-summary-details")).toContainText("Guests");
  await expect(reservationPanel.locator(".table-reservation-summary-details")).toContainText("Dining mode");
  await expect(reservationPanel.getByRole("button", { name: "Choose a time" })).toBeDisabled();
  const reservationBounds = await reservationPanel.evaluate((element) => {
    const rect = element.getBoundingClientRect();
    return {
      top: Math.round(rect.top),
      bottomGap: Math.round(window.innerHeight - rect.bottom),
      height: Math.round(rect.height)
    };
  });
  expect(reservationBounds).toEqual({ top: 24, bottomGap: 24, height: 592 });

  await page.getByLabel("Or choose a date").fill("2099-01-01");
  await page.getByRole("button", { name: "11:00 AM, 20 seats left" }).click();
  await expect(reservationPanel.getByTestId("reservation-time-state")).toContainText("Seats available");
  await expect(reservationPanel.getByRole("button", { name: "Confirm booking" })).toBeEnabled();

  await page.goto("/catering/book");
  const cateringPanel = page.locator("#catering-mobile-details");
  await expect(cateringPanel.getByText("Select a station package to begin your order.")).toBeVisible();
  await expect(cateringPanel.locator(".catering-booking-header")).toContainText("0 stations");
  await expect(cateringPanel.locator(".catering-booking-price-summary")).toContainText("Total");
  await expect(cateringPanel.getByRole("button", { name: "Review request" })).toBeDisabled();
});

test("booking summaries use 24px sticky margins at desktop sizes and stack below the main form", async ({ page }) => {
  await mockApi(page);
  await page.goto("/catering/book");

  const cateringPanel = page.locator("#catering-mobile-details");
  const cateringAction = cateringPanel.getByRole("button", { name: "Review request" });
  for (const viewport of [
    { width: 360, height: 640 },
    { width: 768, height: 800 },
    { width: 1000, height: 800 },
    { width: 1280, height: 640 },
    { width: 1920, height: 1080 }
  ]) {
    await page.setViewportSize(viewport);
    if (viewport.width <= 1000) {
      await expect.poll(() => cateringPanel.evaluate((element) => getComputedStyle(element).position)).toBe("static");
      await expect.poll(() => cateringPanel.evaluate((element) => {
        const grid = element.parentElement;
        return grid ? getComputedStyle(grid).gridTemplateColumns.split(" ").length : 0;
      })).toBe(1);
      await cateringAction.scrollIntoViewIfNeeded();
    } else {
      await expectPanelBounds(page, "#catering-mobile-details", viewport.height);
    }
    await expect(cateringAction).toBeInViewport();
  }

  await page.goto("/reserve/book");
  const reservationPanel = page.locator(".table-reservation-summary");
  for (const viewport of [
    { width: 360, height: 640 },
    { width: 768, height: 800 },
    { width: 1000, height: 800 },
    { width: 1280, height: 640 },
    { width: 1920, height: 1080 }
  ]) {
    await page.setViewportSize(viewport);
    if (viewport.width <= 1000) {
      await expect.poll(() => reservationPanel.evaluate((element) => getComputedStyle(element).position)).toBe("static");
      await reservationPanel.getByRole("button", { name: "Choose a time" }).scrollIntoViewIfNeeded();
    } else {
      const bounds = await reservationPanel.evaluate((element) => {
        const rect = element.getBoundingClientRect();
        return {
          top: Math.round(rect.top),
          bottomGap: Math.round(window.innerHeight - rect.bottom),
          height: Math.round(rect.height)
        };
      });
      expect(bounds).toEqual({ top: 24, bottomGap: 24, height: viewport.height - 48 });
    }
    await expect(reservationPanel.getByRole("button", { name: "Choose a time" })).toBeInViewport();
  }
});

test("Catering booking selects package cards and prices add-ons from their quantities", async ({ page }) => {
  await mockApi(page, cateringPackages);
  await page.setViewportSize({ width: 1366, height: 900 });
  await page.goto("/catering/book");

  const sushiStation = page.getByRole("button", { name: /50–60 pax/ });
  const tempuraStation = page.locator('button[aria-label^="Live tempura station"]');
  await sushiStation.click();
  await expect(sushiStation).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator("#catering-mobile-details")).toContainText("1 station");
  await sushiStation.click();
  await expect(sushiStation).toHaveAttribute("aria-pressed", "false");
  await expect(page.getByRole("button", { name: "Add-ons", exact: true })).toBeDisabled();
  await sushiStation.click();
  await page.getByRole("button", { name: "Add-ons", exact: true }).click();
  const addonsDialog = page.getByRole("dialog", { name: "Add-ons" });
  await addonsDialog.getByRole("checkbox", { name: "Tuna" }).check();

  const quantity = addonsDialog.getByRole("spinbutton", { name: "Tuna add-on quantity" });
  await expect(quantity).toHaveValue("2");
  await expect(quantity).toHaveAttribute("min", "2");
  await expect(addonsDialog).toContainText("₱2,400.00");
  await expect(addonsDialog.getByRole("button", { name: "Decrease Tuna add-on quantity" })).toBeDisabled();
  await addonsDialog.getByRole("button", { name: "Increase Tuna add-on quantity" }).click();
  await expect(quantity).toHaveValue("3");
  await addonsDialog.getByRole("button", { name: "Done" }).click();

  await tempuraStation.click();
  const summary = page.locator("#catering-mobile-details");
  await expect(summary).toContainText("3 kg");
  await expect(summary).toContainText("₱3,600.00");
  await expect(summary).toContainText("Tempura Live");
  await expect(summary).toContainText("₱15,600.00");
  await expect(summary.getByRole("button", { name: /Pay 50% now/ })).toContainText("₱7,800.00");
  await expect(summary.getByRole("button", { name: /Pay in full/ })).toContainText("₱15,600.00");

  await page.getByRole("button", { name: "Add-ons", exact: true }).click();
  const reopenedAddons = page.getByRole("dialog", { name: "Add-ons" });
  const reopenedQuantity = reopenedAddons.getByRole("spinbutton", { name: "Tuna add-on quantity" });
  await reopenedQuantity.fill("41");
  await reopenedQuantity.blur();
  await expect(reopenedQuantity).toHaveValue("40");
  await expect(reopenedAddons).toContainText("₱48,000.00");
  await expect(reopenedAddons.getByRole("button", { name: "Increase Tuna add-on quantity" })).toBeDisabled();

  await expect(tempuraStation).toBeVisible();
  await expect(page.locator("#catering-mobile-details")).toContainText("Tempura Live");
  await reopenedAddons.getByRole("button", { name: "Done" }).click();
  await page.getByRole("button", { name: "Add-ons", exact: true }).click();
  await page.getByRole("dialog", { name: "Add-ons" }).getByRole("checkbox", { name: "Tuna" }).uncheck();
  await page.getByRole("dialog", { name: "Add-ons" }).getByRole("button", { name: "Done" }).click();
  await expect(page.locator("#catering-mobile-details")).not.toContainText("Tuna add-on");
});

test("Catering inclusions modal displays the loaded Sushi Station products", async ({ page }) => {
  await mockApi(page, cateringPackages);
  await page.goto("/catering/book");

  await page.getByRole("button", { name: "View inclusions" }).click();

  const dialog = page.getByRole("dialog", { name: "Sushi Station inclusions" });
  const inclusions = dialog.locator("li");
  await expect(inclusions).toHaveCount(9);
  await expect(inclusions).toHaveText([
    "California Maki",
    "Mango Roll",
    "Volcano Roll",
    "Tori Teriyaki Roll",
    "Salmon Cheese Maki",
    "Futo California",
    "Tamago Sushi",
    "Kani Sushi",
    "Salmon Nigiri"
  ]);
  await expect(dialog).toHaveAttribute("aria-modal", "true");
  const closeIcon = dialog.getByRole("button", { name: "Close dialog" });
  const closeButton = dialog.getByRole("button", { name: "Close", exact: true });
  await closeButton.focus();
  await page.keyboard.press("Tab");
  await expect(closeIcon).toBeFocused();
  await closeIcon.focus();
  await page.keyboard.press("Shift+Tab");
  await expect(closeButton).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);

  await page.getByRole("button", { name: "View inclusions" }).click();
  await page.getByRole("dialog", { name: "Sushi Station inclusions" }).getByRole("button", { name: "Close dialog" }).click();
  await expect(dialog).toHaveCount(0);

  await page.getByRole("button", { name: "View inclusions" }).click();
  const dialogOverlay = page.getByRole("dialog", { name: "Sushi Station inclusions" }).locator("xpath=..");
  await dialogOverlay.click({ position: { x: 8, y: 8 } });
  await expect(dialog).toHaveCount(0);
});

test("Catering booking keeps Sashimi Bar and shows Tuna and Salmon as separate add-ons", async ({ page }) => {
  const packagesWithSashimiBar = [
    ...cateringPackages.map((item) => (
      item.id === "pkg_sashimi_tuna_test" || item.id === "pkg_sashimi_salmon_test" || item.id === "pkg_whole_tuna_test"
        ? {
          ...item,
          stationType: "Sashimi Bar",
          items: item.id === "pkg_sashimi_tuna_test" || item.id === "pkg_sashimi_salmon_test"
            ? { ...item.items, minimum: 2, minKg: 2, bookingRole: "add_on" }
            : item.items
        }
        : item
    ))
  ];
  await mockApi(page, packagesWithSashimiBar);
  await page.goto("/catering/book");

  const wholeTunaOption = page.getByRole("button", { name: /Whole Tuna, 20-40 kg/ });
  await expect(wholeTunaOption).toBeVisible();
  await expect(page.getByText("Sashimi service station", { exact: true })).toHaveCount(0);
  await expect(wholeTunaOption).toContainText("20-40 kg");
  await page.getByRole("button", { name: /50–60 pax/ }).click();
  await page.getByRole("button", { name: "Add-ons", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Add-ons" });
  await dialog.getByRole("checkbox", { name: "Tuna" }).check();
  await dialog.getByRole("checkbox", { name: "Salmon" }).check();
  await expect(dialog.getByRole("spinbutton", { name: "Tuna add-on quantity" })).toHaveAttribute("min", "2");
  await expect(dialog.getByRole("spinbutton", { name: "Tuna add-on quantity" })).toHaveValue("2");
  await expect(dialog.getByRole("spinbutton", { name: "Salmon add-on quantity" })).toHaveAttribute("max", "40");
  await expect(dialog.getByRole("spinbutton", { name: "Salmon add-on quantity" })).toHaveValue("2");
  await dialog.getByRole("spinbutton", { name: "Salmon add-on quantity" }).fill("1");
  await dialog.getByRole("spinbutton", { name: "Salmon add-on quantity" }).blur();
  await expect(dialog.getByRole("spinbutton", { name: "Salmon add-on quantity" })).toHaveValue("2");
});

test("Whole Tuna is priced from 20 kg and cannot be mixed with station packages", async ({ page }) => {
  await mockApi(page, cateringPackages);
  await page.goto("/catering/book");

  await page.getByRole("button", { name: /Whole Tuna, 20-40 kg/ }).click();
  const quantity = page.locator('input[type="number"]').first();
  await expect(quantity).toHaveValue("20");
  await expect(page.locator("#catering-mobile-details")).toContainText("₱24,000.00");
  await expect(page.locator("#catering-mobile-details")).toContainText("Not applicable");

  await page.getByLabel("Event Time *").fill("18:00");
  await page.getByLabel("Type of Event *").selectOption("Wedding");
  await page.getByRole("button", { name: /50–60 pax/ }).click();
  await page.getByRole("checkbox", { name: /understand this reservation is pending staff approval/i }).check();
  await page.locator("#catering-mobile-details").getByRole("button", { name: "Review request" }).click();
  await expect(page.getByRole("alert")).toContainText("Whole Tuna can only be booked by itself.");
});

test("Catering keeps required event, payment, and approval checks before contact details", async ({ page }) => {
  await mockApi(page, cateringPackages);
  await page.setViewportSize({ width: 1366, height: 900 });
  await page.goto("/catering/book");

  const panel = page.locator("#catering-mobile-details");
  const confirm = panel.getByRole("button", { name: "Review request" });
  await expect(confirm).toBeDisabled();
  await expect(page.getByRole("button", { name: "Add-ons", exact: true })).toBeDisabled();
  await page.getByRole("button", { name: /50–60 pax/ }).click();
  await expect(confirm).toBeDisabled();

  await page.getByLabel("Event Time *").fill("18:00");
  await page.getByLabel("Type of Event *").selectOption("Wedding");
  await page.getByLabel("Event Date *").fill("2099-01-01");

  await expect(confirm).toBeDisabled();
  await page.getByRole("checkbox", { name: /understand this reservation is pending staff approval/i }).check();
  await expect(confirm).toBeEnabled();
  await confirm.click();
  await expect(page.getByRole("alert")).toContainText("Choose a payment option.");
  await expect(page.getByRole("dialog")).toHaveCount(0);

  await panel.getByRole("button", { name: /Pay 50% now/ }).click();
  await confirm.click();
  await expect(page.getByRole("dialog", { name: "Your contact details" })).toBeVisible();
});

test("Catering summary panel keeps its body scrollable and footer visible", async ({ page }) => {
  await mockApi(page, cateringPackages);
  await page.goto("/catering/book");

  await page.getByRole("button", { name: /50–60 pax/ }).click();
  await page.locator('button[aria-label^="Live tempura station"]').click();
  await page.getByRole("button", { name: "Add-ons", exact: true }).click();
  const addons = page.getByRole("dialog", { name: "Add-ons" });
  await addons.getByRole("checkbox", { name: "Tuna" }).check();
  await addons.getByRole("button", { name: "Done" }).click();
  const panel = page.locator("#catering-mobile-details");
  await panel.getByRole("button", { name: /Pay 50% now/ }).click();

  for (const viewport of viewportSizes) {
    await page.setViewportSize(viewport);
    await expectPanelBounds(page, "#catering-mobile-details", viewport.height);
    await expect(panel.getByRole("button", { name: "Review request" })).toBeInViewport();

    const fit = await panel.evaluate((element) => {
      const body = element.querySelector(".catering-booking-body");
      const footer = element.querySelector(".catering-booking-actions");
      return {
        panelHeight: Math.round(element.getBoundingClientRect().height),
        bodyScrollable: body ? body.scrollHeight >= body.clientHeight : false,
        footerInside: Boolean(body && footer && footer.getBoundingClientRect().top >= body.getBoundingClientRect().bottom - 2)
      };
    });

    expect(fit.panelHeight, JSON.stringify({ viewport, fit })).toBe(viewport.height - 48);
    expect(fit.footerInside, JSON.stringify({ viewport, fit })).toBeTruthy();
  }
});

test("Catering inquiry shows per-kilogram add-ons and the fixed Tempura package", async ({ page }) => {
  await mockApi(page, cateringPackages);
  await page.goto("/catering/inquiry");

  await page.getByRole("button", { name: /Tuna Add-on/ }).click();
  const quantity = page.locator('input[type="number"]').first();
  await expect(quantity).toHaveValue("1");
  await expect(quantity).toHaveAttribute("min", "1");
  await quantity.fill("2");
  await expect(page.getByText("Tuna - 2 kg - PHP 2,400")).toBeVisible();
  await quantity.fill("41");
  await expect(quantity).toHaveValue("40");
  await expect(page.getByText("Tuna - 40 kg - PHP 48,000")).toBeVisible();

  await page.getByRole("button", { name: /Tempura \(50 pax\)/ }).click();
  await expect(page.getByText("Live tempura station - 50 pax - PHP 6,000")).toBeVisible();
  await expect(page.getByText(/custom quote/i)).toHaveCount(0);
});

test("Catering staff workspace is list-first with one state-based next action", async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem("katana_token", "test-token");
    localStorage.setItem("katana_role", "admin");
    localStorage.setItem("katana_user", JSON.stringify({
      id: "test-admin",
      email: "admin@example.test",
      name: "Test Admin",
      role: "admin"
    }));
  });
  await mockApi(page);
  await page.goto("/staff/catering");

  await expect(page.getByRole("heading", { name: "Catering operations" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Approve request" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Start preparation" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Complete event" })).toBeVisible();

  await page.getByRole("button", { name: "Needs approval" }).click();
  await expect(page.getByText("1 event", { exact: false })).toBeVisible();
  await expect(page.getByRole("button", { name: "Approve request" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Start preparation" })).toHaveCount(0);

  await page.getByRole("button", { name: "Event calendar" }).click();
  await expect(page.getByRole("dialog", { name: "Catering event calendar" })).toContainText("Calendar is view-only.");
});

test("legacy catering dashboard route redirects to the Phase 7 workspace", async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem("katana_token", "test-token");
    localStorage.setItem("katana_role", "admin");
    localStorage.setItem("katana_user", JSON.stringify({
      id: "test-admin",
      email: "admin@example.test",
      name: "Test Admin",
      role: "admin"
    }));
  });
  await mockApi(page);
  await page.goto("/staff/catering/dashboard");

  await expect(page).toHaveURL(/\/staff\/catering$/);
  await expect(page.getByRole("heading", { name: "Catering operations" })).toBeVisible();
});

test("Catering status displays each saved station snapshot", async ({ page }) => {
  await mockApi(page);
  await page.goto("/reservation/status?bookingId=CAT-TEST-001");

  await expect(page.getByText("Tuna Add-on — Tuna - 3 kg · ₱1,200.00/kg - ₱3,600.00")).toBeVisible();
  await expect(page.getByText("Tempura — Live tempura station - 50 pax - ₱6,000.00")).toBeVisible();
});

test("customer inner routes hide the header and link home", async ({ page }) => {
  await mockApi(page);

  for (const path of [
    "/menu",
    "/reserve",
    "/reserve/book",
    "/reservation/status",
    "/catering",
    "/catering/book",
    "/catering/inquiry",
    "/feedback"
  ]) {
    await page.goto(path);
    await expect(page.locator(".customer-app > nav")).toHaveCount(0);
    const backToHome = page.getByRole("link", { name: "Back to home" });
    await expect(backToHome).toHaveAttribute("href", "/");
    expect(await backToHome.evaluate((link) => link.getBoundingClientRect().height)).toBeGreaterThanOrEqual(44);
  }
});

test("Reserve hub offers table and catering booking, and Pickup navigation opens ordering", async ({ page }) => {
  await mockApi(page);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/");

  const customerNav = page.getByRole("navigation", { name: "Customer navigation" }).first();
  await customerNav.getByRole("link", { name: "Reserve", exact: true }).click();
  await expect(page).toHaveURL(/\/reserve$/);
  await expect(page.getByRole("heading", { name: "How would you like to book?" })).toBeVisible();
  await expect(page.getByRole("link", { name: /Book a table/ })).toHaveAttribute("href", "/reserve/book");
  await expect(page.getByRole("link", { name: /Book catering/ })).toHaveAttribute("href", "/catering/book");

  await page.getByRole("link", { name: /Book catering/ }).click();
  await expect(page).toHaveURL(/\/catering\/book$/);
  await expect(page.getByText("Pick a package size under each station, then add Tuna or Salmon by the kilo if you like.")).toBeVisible();

  await page.goto("/");
  await customerNav.getByRole("link", { name: "Pickup", exact: true }).click();
  await expect(page).toHaveURL(/\/takeout$/);
  await expect(page.getByRole("heading", { name: "Choose your menu" })).toBeVisible();
});

test("Home desktop header centers the tabs between the logo and search controls", async ({ page }) => {
  await mockApi(page);

  for (const viewport of [
    { width: 768, height: 900 },
    { width: 1024, height: 900 },
    { width: 1440, height: 900 },
    { width: 1920, height: 1080 }
  ]) {
    await page.setViewportSize(viewport);
    await page.goto("/");
    const header = page.getByRole("navigation", { name: "Customer navigation" }).first();
    const tabs = page.getByTestId("desktop-customer-tabs");

    await expect(header).toBeVisible();
    await expect(tabs.locator("a")).toHaveCount(6);
    const logo = header.locator('a[href="/"]').first();
    const search = page.getByRole("combobox", { name: "Search menu products" });
    const themeToggle = header.getByRole("button", { name: "Toggle color theme" });
    await expect(search).toBeVisible();
    await expect(themeToggle).toBeVisible();
    await expect.poll(async () => {
      const bounds = await tabs.boundingBox();
      return bounds ? Math.abs(bounds.x + bounds.width / 2 - viewport.width / 2) : Number.POSITIVE_INFINITY;
    }).toBeLessThanOrEqual(1);
    const [logoBounds, tabsBounds, searchBounds, themeBounds] = await Promise.all([
      logo.boundingBox(),
      tabs.boundingBox(),
      search.boundingBox(),
      themeToggle.boundingBox()
    ]);
    if (!logoBounds || !tabsBounds || !searchBounds || !themeBounds) {
      throw new Error("Expected all desktop header elements to have visible bounds.");
    }
    expect(logoBounds.x + logoBounds.width).toBeLessThan(tabsBounds.x);
    expect(tabsBounds.x + tabsBounds.width).toBeLessThan(searchBounds.x);
    expect(searchBounds.x + searchBounds.width).toBeLessThan(themeBounds.x);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(viewport.width);
  }
});

test("Home search normalizes menu queries, limits results, clears, and closes", async ({ page }) => {
  await mockApi(page);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/");

  const search = page.getByRole("combobox", { name: "Search menu products" });
  const listbox = page.getByRole("listbox", { name: "Menu product search results" });

  await search.fill("  tEsT   sUsHi 6  ");
  await expect(listbox.getByRole("option")).toHaveCount(1);
  await expect(listbox.getByRole("option").first()).toContainText("Test Sushi 6");
  await expect(listbox.getByRole("option").first()).toContainText("Sushi");
  await expect(listbox.getByRole("option").first()).toContainText("500");
  await expect(listbox).not.toContainText(/stock|in stock|available/i);

  await search.fill("  sushi  ");
  await expect(listbox.getByRole("option")).toHaveCount(8);

  await search.fill("no-such-menu-item");
  await expect(page.getByText("No results")).toBeVisible();
  const clearSearch = page.getByRole("button", { name: "Clear menu search" });
  await expect(clearSearch).toBeVisible();
  await clearSearch.click();
  await expect(search).toHaveValue("");
  await expect(page.getByRole("listbox")).toHaveCount(0);

  await search.fill("sashimi");
  await expect(listbox).toBeVisible();
  await search.press("Escape");
  await expect(listbox).toBeHidden();

  await page.getByRole("button", { name: "Clear menu search" }).click();
  await search.fill("sashimi");
  await expect(listbox).toBeVisible();
  await page.locator("main h1").first().click();
  await expect(listbox).toBeHidden();
});

test("Home search keyboard selection opens and highlights the matching menu product", async ({ page }) => {
  await mockApi(page);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/");

  const search = page.getByRole("combobox", { name: "Search menu products" });
  const options = page.getByRole("listbox", { name: "Menu product search results" }).getByRole("option");
  await search.fill("test sushi");
  await expect(options).toHaveCount(8);

  await search.press("ArrowDown");
  await expect(options.nth(0)).toHaveAttribute("aria-selected", "true");
  await search.press("ArrowUp");
  await expect(options.nth(7)).toHaveAttribute("aria-selected", "true");
  await search.press("Enter");

  await expect(page).toHaveURL(/\/menu\?productId=sushi-7$/);
  const product = page.locator("#menu-product-sushi-7");
  await expect(product).toHaveClass(/ring-4/);
  await expect(product).toBeInViewport();
});

test("clicking a Home search result opens the matching product in Menu", async ({ page }) => {
  await mockApi(page);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/");

  const search = page.getByRole("combobox", { name: "Search menu products" });
  await search.fill("test sashimi 3");
  const result = page.getByRole("option", { name: /Test Sashimi 3/ });
  await expect(result).toBeVisible();
  await result.click();

  await expect(page).toHaveURL(/\/menu\?productId=sashimi-2$/);
  const product = page.locator("#menu-product-sashimi-2");
  await expect(product).toHaveClass(/ring-4/);
  await expect(product).toBeInViewport();
});

test("mobile Home header centers search and shows full-width results", async ({ page }) => {
  await mockApi(page);

  for (const width of [320, 375, 640, 767]) {
    await page.setViewportSize({ width, height: 844 });
    await page.goto("/");

    const header = page.getByTestId("mobile-customer-nav");
    const logo = header.locator('a[href="/"]').first();
    const search = header.getByRole("combobox", { name: "Search menu products" });
    const burger = header.getByRole("button", { name: "Open navigation menu" });

    await expect(header).toBeVisible();
    await expect(search).toBeVisible();
    await expect(burger).toBeVisible();
    const [logoBounds, searchBounds, burgerBounds] = await Promise.all([
      logo.boundingBox(),
      search.boundingBox(),
      burger.boundingBox()
    ]);
    if (!logoBounds || !searchBounds || !burgerBounds) {
      throw new Error("Expected all mobile header elements to have visible bounds.");
    }
    expect(logoBounds.x + logoBounds.width).toBeLessThan(searchBounds.x);
    expect(searchBounds.x + searchBounds.width).toBeLessThan(burgerBounds.x);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);

    if (width < 640) {
      await expect(header.getByText("KATANA", { exact: true })).toBeHidden();
    } else {
      await expect(header.getByText("KATANA", { exact: true })).toBeVisible();
    }

    if (width === 320) {
      await search.fill("test sushi 6");
      const listbox = page.getByRole("listbox", { name: "Menu product search results" });
      await expect(listbox).toBeVisible();
      const dropdownBounds = await listbox.boundingBox();
      const headerBounds = await header.boundingBox();
      if (!dropdownBounds || !headerBounds) {
        throw new Error("Expected the mobile search dropdown and header to have visible bounds.");
      }
      expect(dropdownBounds.x).toBeGreaterThanOrEqual(12);
      expect(dropdownBounds.x).toBeLessThanOrEqual(13);
      expect(width - dropdownBounds.x - dropdownBounds.width).toBeGreaterThanOrEqual(12);
      expect(width - dropdownBounds.x - dropdownBounds.width).toBeLessThanOrEqual(13);
      expect(Math.round(dropdownBounds.y)).toBe(Math.round(headerBounds.y + headerBounds.height));
    }
  }
});

test("mobile burger contains theme toggle and closes by Escape, outside tap, and navigation", async ({ page }) => {
  await mockApi(page);
  await page.setViewportSize({ width: 375, height: 844 });
  await page.goto("/");

  const header = page.getByTestId("mobile-customer-nav");
  const burger = header.getByRole("button", { name: "Open navigation menu" });
  const panel = page.getByTestId("mobile-navigation-menu");
  const search = header.getByRole("combobox", { name: "Search menu products" });

  await expect(header.getByRole("button", { name: "Toggle color theme" })).toHaveCount(0);
  await burger.click();
  await expect(panel.getByRole("link")).toHaveCount(6);
  const themeToggle = panel.getByRole("button", { name: "Toggle color theme" });
  await expect(themeToggle).toBeVisible();
  await expect(panel.getByRole("link", { name: "Home", exact: true })).toHaveAttribute("aria-current", "page");
  await expect.poll(() => page.evaluate(() => localStorage.getItem("customer-theme"))).toMatch(/light|dark/);
  const initialTheme = await page.evaluate(() => localStorage.getItem("customer-theme"));
  await themeToggle.click();
  await expect.poll(() => page.evaluate(() => localStorage.getItem("customer-theme"))).not.toBe(initialTheme);
  await expect(panel).toBeVisible();

  await page.keyboard.press("Escape");
  await expect(panel).toBeHidden();
  await expect(header.getByRole("button", { name: "Open navigation menu" })).toBeFocused();

  await header.getByRole("button", { name: "Open navigation menu" }).click();
  await expect(panel).toBeVisible();
  await search.click();
  await expect(panel).toBeHidden();

  await header.getByRole("button", { name: "Open navigation menu" }).click();
  await expect(panel).toBeVisible();
  await panel.getByRole("link", { name: "Menu", exact: true }).click();
  await expect(page).toHaveURL(/\/menu$/);
  await expect(page.getByTestId("mobile-customer-nav")).toHaveCount(0);
});

for (const theme of ["light", "dark"] as const) {
  test(`${theme} theme is applied before first paint on direct inner-page loads`, async ({ page }) => {
    await mockApi(page);
    await page.addInitScript((savedTheme: "light" | "dark") => {
      if (location.origin !== "http://127.0.0.1:4173") return;

      localStorage.setItem("customer-theme", savedTheme);
      const nativeSetAttribute = Element.prototype.setAttribute;
      Element.prototype.setAttribute = function (name, value) {
        if (this === document.documentElement && name === "data-theme") {
          const existing = this.getAttribute("data-theme-trace");
          const events: Array<{ theme: string; bodyPresent: boolean }> = existing ? JSON.parse(existing) : [];
          events.push({ theme: value, bodyPresent: document.body !== null });
          nativeSetAttribute.call(this, "data-theme-trace", JSON.stringify(events));
        }
        nativeSetAttribute.call(this, name, value);
      };
    }, theme);
    await page.goto("/menu");

    await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
    const traceText = await page.locator("html").getAttribute("data-theme-trace");
    const themeEvents = JSON.parse(traceText ?? "[]") as Array<{ theme: string; bodyPresent: boolean }>;
    expect(themeEvents[0]).toEqual({ theme, bodyPresent: false });
    expect(themeEvents.every((event) => event.theme === theme)).toBe(true);
    const background = await page.evaluate(() =>
      getComputedStyle(document.documentElement).getPropertyValue("--customer-bg").trim()
    );
    expect(background).toBe(theme === "light" ? "#f8fafc" : "#050505");
  });
}

test("Reserve hub opens table booking and keeps the minimal Back control", async ({ page }) => {
  await mockApi(page);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/");
  await page.getByRole("navigation", { name: "Customer navigation" }).first()
    .getByRole("link", { name: "Reserve", exact: true }).click();
  await page.getByRole("link", { name: /Book a table/ }).click();

  await expect(page).toHaveURL(/\/reserve\/book$/);
  await expect(page.getByRole("heading", { name: "Book a table" })).toBeVisible();
  await expect(page.getByTestId("desktop-customer-nav")).toHaveCount(0);
  await expect(page.getByRole("link", { name: "Back to home" })).toHaveAttribute("href", "/");
});

test("successful dine-in reservation links to its Status page", async ({ page }) => {
  await mockApi(page);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/reserve/book");

  await page.getByLabel("Or choose a date").fill("2099-01-01");
  await page.getByLabel("Choose another reservation time").fill("12:30");

  const confirmBooking = page.getByRole("button", { name: "Confirm booking" });
  await expect(confirmBooking).toBeEnabled();
  await confirmBooking.click();

  const details = page.getByRole("dialog");
  await details.getByLabel("Full name *").fill("Test Customer");
  await details.getByLabel("Mobile number *").fill("09123456789");
  await details.getByLabel("Email address *").fill("test@example.com");
  await details.getByRole("button", { name: "Confirm table reservation" }).click();

  const statusLink = page.getByRole("link", { name: "View Reservation Status" });
  await expect(statusLink).toHaveAttribute("href", "/reservation/status?bookingId=KTN-DINE-TEST-001");
  await statusLink.click();
  await expect(page).toHaveURL(/\/reservation\/status\?bookingId=KTN-DINE-TEST-001$/);
});

test("table booking checks manual time changes and keeps the configured guest limit", async ({ page }) => {
  await mockApi(page);
  const availabilityRequests: URL[] = [];
  page.on("request", (request) => {
    const url = new URL(request.url());
    if (url.pathname === "/api/reservations/table-availability") {
      availabilityRequests.push(url);
    }
  });

  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/reserve/book");
  await page.getByLabel("Date *").fill("2099-01-01");

  const timeInput = page.getByLabel("Reservation time");
  const availability = page.getByTestId("table-reservation-availability");
  await timeInput.fill("12:00");
  await expect(availability).toHaveText("Full");
  await timeInput.fill("12:30");
  await expect(availability).toHaveText("Available");
  await expect(page.getByText("Maximum 20 guests per booking.")).toBeVisible();
  await expect(page.getByText(/seats? available|guest count/i)).toHaveCount(0);
  await expect.poll(() => availabilityRequests.some((url) =>
    url.searchParams.get("date") === "2099-01-01"
    && url.searchParams.get("time") === "12:30"
    && url.searchParams.get("party_size") === "1"
  )).toBe(true);
  await page.getByRole("button", { name: "Add one guest" }).click();
  await expect.poll(() => availabilityRequests.some((url) =>
    url.searchParams.get("date") === "2099-01-01"
    && url.searchParams.get("time") === "12:30"
    && url.searchParams.get("party_size") === "2"
  )).toBe(true);
});

test("staff login remains outside the customer navigation layout", async ({ page }) => {
  await page.goto("/staff/login");

  await expect(page.getByText("Staff portal")).toBeVisible();
  await expect(page.getByRole("img", { name: "Katana Sushi logo" })).toHaveAttribute("src", "/images/katana-logo.jpg");
  await expect(page.getByTestId("staff-login-card")).toHaveCSS("border-radius", "0px");
  await expect(page.locator(".customer-app")).toHaveCount(0);
  await expect(page.getByTestId("desktop-customer-nav")).toHaveCount(0);
  await expect(page.getByTestId("mobile-customer-nav")).toHaveCount(0);
});

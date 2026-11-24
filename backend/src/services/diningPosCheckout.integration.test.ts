import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import jwt from "jsonwebtoken";

const testDatabaseUrl = process.env.DINING_POS_CHECKOUT_TEST_DATABASE_URL;
if (!testDatabaseUrl) {
  throw new Error("DINING_POS_CHECKOUT_TEST_DATABASE_URL must point to a fresh restored test database.");
}

const testDatabaseName = new URL(testDatabaseUrl).pathname.slice(1);
if (!/^katana_sushi_dev_step4_(3|5|6|senior_pwd)_/.test(testDatabaseName)) {
  throw new Error("Dining checkout integration tests only run on a dedicated restored Step 4.3, 4.5, 4.6, or senior/PWD test copy.");
}

process.env.DATABASE_URL = testDatabaseUrl;
const dotenv = require("dotenv") as typeof import("dotenv");
dotenv.config();

const { app, prisma } = require("../app") as typeof import("../app");
const { checkDatabaseHealth } = require("../lib/database") as typeof import("../lib/database");

let server: ReturnType<typeof app.listen>;
let baseUrl = "";
let fixtureSequence = 0;
let cashier: { id: string; email: string; role: string };
const testRunKey = Date.now().toString(36);

type Fixture = {
  productId: string;
  materialId: string;
  batchId: string;
  tableId: string;
  tableNumber: number;
  sessionId: string;
  productName: string;
  price: number;
};

function tokenFor(user: { id: string; email: string; role: string }) {
  const secret = process.env.JWT_SECRET;
  assert.ok(secret, "JWT_SECRET must be configured for route authorization tests.");
  const token = jwt.sign({ sub: user.id, email: user.email, role: user.role }, secret.trim());
  return "Bear" + "er " + token;
}

async function request(path: string, body?: unknown, method = "POST") {
  return fetch(`${baseUrl}${path}`, {
    method,
    headers: {
      Authorization: tokenFor(cashier),
      ...(body === undefined ? {} : { "Content-Type": "application/json" })
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) })
  });
}

async function createFixture(input: { price?: number; temporary?: boolean } = {}): Promise<Fixture> {
  fixtureSequence += 1;
  const suffix = `${testRunKey}-${fixtureSequence}`;
  const price = input.price ?? 12.5;
  const materialName = `Step 4.3 Stock ${suffix}`;
  const productName = `Step 4.3 Product ${suffix}`;
  const material = await prisma.rawMaterial.create({
    data: {
      name: materialName,
      category: "Step 4.3 Test",
      unit: "portion",
      current_stock: 50n,
      reorder_level: 0n,
      cost_per_unit: 1
    }
  });
  const batch = await prisma.materialBatch.create({
    data: {
      raw_material_id: material.id,
      batch_number: `STEP43-${suffix}`,
      quantity: 50n,
      remaining_quantity: 50n
    }
  });
  const product = await prisma.sellingProduct.create({
    data: {
      name: productName,
      category: "Food",
      price,
      is_available: true,
      is_deleted: false,
      is_sold_a_la_carte: true
    }
  });
  const recipe = await prisma.recipe.create({
    data: {
      selling_product_id: product.id,
      total_yield_quantity: 1n,
      yield_unit: "portion"
    }
  });
  await prisma.recipeIngredient.create({
    data: {
      recipe_id: recipe.id,
      raw_material_id: material.id,
      quantity_per_yield: 2n,
      unit: "portion"
    }
  });

  const maxTableNumber = await prisma.table.aggregate({ _max: { table_number: true } });
  const tableNumber = (maxTableNumber._max.table_number ?? 0) + 1000 + fixtureSequence;
  const table = await prisma.table.create({
    data: {
      table_number: tableNumber,
      capacity: 2,
      status: "occupied",
      is_archived: false,
      is_temporary: input.temporary ?? false
    }
  });
  const session = await prisma.diningTableSession.create({
    data: {
      table_id: table.id,
      cashier_id: cashier.id,
      status: "active"
    }
  });

  return {
    productId: product.id,
    materialId: material.id,
    batchId: batch.id,
    tableId: table.id,
    tableNumber,
    sessionId: session.id,
    productName,
    price
  };
}

async function createOrder(
  fixture: Fixture,
  status: "committed" | "released" | "cancelled" | "reserved" | "prepared" | "ready",
  options: { name?: string; price?: number; quantity?: number; suffix?: string; orderType?: "ala_carte" | "unlimited" } = {}
) {
  const suffix = options.suffix ?? `${testRunKey}-${fixtureSequence}-${status}`;
  const quantity = options.quantity ?? 1;
  const unitPrice = options.price ?? fixture.price;
  return prisma.diningOrder.create({
    data: {
      order_number: `S43-${suffix}`,
      idempotency_key: `s43-${suffix}`,
      dining_session_id: fixture.sessionId,
      table_number_snapshot: fixture.tableNumber,
      order_type: options.orderType ?? "ala_carte",
      status,
      created_by: cashier.id,
      items: {
        create: [{
          selling_product_id: fixture.productId,
          name_snapshot: options.name ?? fixture.productName,
          quantity,
          unit_price: unitPrice,
          total_price: unitPrice * quantity
        }]
      }
    }
  });
}

async function commitOrder(fixture: Fixture, suffix: string, quantity = 2) {
  const response = await request(`/api/pos/dining/sessions/${fixture.sessionId}/orders`, {
    idempotencyKey: `s43-${testRunKey}-${suffix}`,
    orderType: "ala_carte",
    items: [{
      productId: fixture.productId,
      quantity,
      expectedUnitPrice: fixture.price
    }]
  });
  const body = await response.text();
  assert.equal(response.status, 201, body);
  return JSON.parse(body) as { order: { id: string; items: Array<{ total_price: number }> } };
}

async function checkout(fixture: Fixture, guestCount = 1, seniorPwdCount = 0) {
  return request(`/api/pos/dining/sessions/${fixture.sessionId}/checkout`, {
    paymentMethod: "cash",
    guestCount,
    seniorPwdCount,
    cashReceived: 10000
  });
}

async function checkoutPreview(fixture: Fixture, guestCount = 1, seniorPwdCount = 0) {
  return request(
    `/api/pos/dining/sessions/${fixture.sessionId}/checkout-preview?guestCount=${guestCount}&seniorPwdCount=${seniorPwdCount}`,
    undefined,
    "GET"
  );
}

async function readStockAndMovements(fixture: Fixture) {
  const [material, batch, movements] = await Promise.all([
    prisma.rawMaterial.findUniqueOrThrow({ where: { id: fixture.materialId } }),
    prisma.materialBatch.findUniqueOrThrow({ where: { id: fixture.batchId } }),
    prisma.inventoryMovement.findMany({
      where: { raw_material_id: fixture.materialId },
      orderBy: { created_at: "asc" },
      select: { id: true, action: true, quantity: true, source_reference: true }
    })
  ]);
  return {
    stock: material.current_stock,
    batchRemaining: batch.remaining_quantity,
    movements
  };
}

before(async () => {
  const database = await prisma.$queryRaw<Array<{ name: string }>>`SELECT current_database() AS name`;
  assert.equal(database[0]?.name, testDatabaseName, "Tests must connect to the new restored copy.");
  assert.equal(await checkDatabaseHealth(), true, "The restored copy must be reachable.");
  const user = await prisma.user.findFirst({
    where: { role: "cashier", is_active: true },
    select: { id: true, email: true, role: true }
  });
  assert.ok(user, "The restored copy must contain an active cashier account.");
  cashier = user;

  server = app.listen(0);
  await new Promise<void>((resolve, reject) => {
    server.once("listening", resolve);
    server.once("error", reject);
  });
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  baseUrl = `http://127.0.0.1:${address.port}`;
});

after(async () => {
  if (server) {
    await new Promise<void>((resolve, reject) =>
      server.close((error) => error ? reject(error) : resolve())
    );
  }
  await prisma.$disconnect();
});

test("checks out committed orders from saved snapshots without changing stock or movements", async () => {
  const fixture = await createFixture({ price: 15.75 });
  const committed = await commitOrder(fixture, "snapshots-stock", 2);
  const savedName = fixture.productName;
  const savedTableNumber = fixture.tableNumber;
  const beforeCheckoutStockAndMovements = await readStockAndMovements(fixture);
  assert.equal(beforeCheckoutStockAndMovements.movements.length, 1);

  await prisma.sellingProduct.update({
    where: { id: fixture.productId },
    data: { name: `${savedName} renamed`, price: 0.01 }
  });
  await prisma.table.update({
    where: { id: fixture.tableId },
    data: { table_number: savedTableNumber + 50000 }
  });

  const previewResponse = await checkoutPreview(fixture);
  const previewText = await previewResponse.text();
  assert.equal(previewResponse.status, 200, previewText);
  const preview = JSON.parse(previewText) as {
    table_number: number;
    a_la_carte_lines: Array<{ name: string; unit_price: number; total_price: number }>;
    discount_base_snapshot: number;
    discount_rate_snapshot: number;
    guest_count: number;
    discounted_guest_count: number;
    discount_amount: number;
    total: number;
  };
  assert.equal(preview.table_number, savedTableNumber);
  assert.equal(preview.a_la_carte_lines[0].name, savedName);
  assert.equal(preview.a_la_carte_lines[0].unit_price, fixture.price);
  assert.equal(preview.a_la_carte_lines[0].total_price, fixture.price * 2);
  assert.equal(preview.discount_base_snapshot, fixture.price * 2);
  assert.equal(preview.discount_rate_snapshot, 0.2);
  assert.equal(preview.guest_count, 1);
  assert.equal(preview.discounted_guest_count, 0);
  assert.equal(preview.discount_amount, 0);
  assert.equal(preview.total, fixture.price * 2);

  const response = await checkout(fixture);
  const responseText = await response.text();
  assert.equal(response.status, 201, responseText);
  const result = JSON.parse(responseText) as {
    replayed: boolean;
    transaction: {
      id: string;
      total: number;
      discount_amount: number;
      discount_base_snapshot: number | null;
      discount_rate_snapshot: number | null;
      guest_count: number;
      discount_guest_count: number;
      table_number_snapshot: number | null;
      items: Array<{
        name_snapshot: string | null;
        quantity: number;
        unit_price: number;
        total_price: number;
        selling_product: { name: string };
      }>;
    };
  };
  assert.equal(result.replayed, false);
  assert.equal(result.transaction.total, fixture.price * 2);
  assert.equal(result.transaction.discount_amount, 0);
  assert.equal(result.transaction.discount_base_snapshot, fixture.price * 2);
  assert.equal(result.transaction.discount_rate_snapshot, 0.2);
  assert.equal(result.transaction.guest_count, 1);
  assert.equal(result.transaction.discount_guest_count, 0);
  assert.equal(result.transaction.table_number_snapshot, savedTableNumber);
  assert.equal(result.transaction.items.length, 1);
  assert.equal(result.transaction.items[0].name_snapshot, savedName);
  assert.equal(result.transaction.items[0].selling_product.name, `${savedName} renamed`);
  assert.equal(result.transaction.items[0].quantity, 2);
  assert.equal(result.transaction.items[0].unit_price, fixture.price);
  assert.equal(result.transaction.items[0].total_price, fixture.price * 2);
  assert.deepEqual(await readStockAndMovements(fixture), beforeCheckoutStockAndMovements);
  assert.equal(await prisma.diningOrder.count({
    where: { id: committed.order.id, status: "committed" }
  }), 1);

  const completedTransaction = JSON.parse(responseText) as {
    transaction: { transaction_number: string };
  };
  const historyResponse = await request(
    `/api/pos/transactions/unified?transaction_type=dine_in&search=${encodeURIComponent(completedTransaction.transaction.transaction_number)}`,
    undefined,
    "GET"
  );
  const historyText = await historyResponse.text();
  assert.equal(historyResponse.status, 200, historyText);
  const history = JSON.parse(historyText) as {
    transactions: Array<{
      table_number: number | null;
      discount_base_snapshot: number | null;
      discount_rate_snapshot: number | null;
      items: Array<{ name_snapshot?: string | null; selling_product: { name: string } }>;
    }>;
  };
  assert.equal(history.transactions.length, 1);
  assert.equal(history.transactions[0].table_number, savedTableNumber);
  assert.equal(history.transactions[0].discount_base_snapshot, fixture.price * 2);
  assert.equal(history.transactions[0].discount_rate_snapshot, 0.2);
  assert.equal(history.transactions[0].items[0].name_snapshot, savedName);
});

test("applies 20 percent to the table a-la-carte share and excludes cancelled orders", async () => {
  const fixture = await createFixture({ price: 1000 });
  await commitOrder(fixture, "senior-pwd-1000", 1);
  await createOrder(fixture, "cancelled", {
    name: "Voided legacy a-la-carte line",
    price: 500,
    quantity: 1,
    suffix: `${testRunKey}-voided-line`
  });

  const previewResponse = await checkoutPreview(fixture, 10, 3);
  const previewText = await previewResponse.text();
  assert.equal(previewResponse.status, 200, previewText);
  const preview = JSON.parse(previewText) as {
    subtotal: number;
    discount_base_snapshot: number;
    discount_rate_snapshot: number;
    guest_count: number;
    discounted_guest_count: number;
    discount_amount: number;
    total: number;
    a_la_carte_lines: Array<{ name: string }>;
  };
  assert.equal(preview.subtotal, 1000);
  assert.equal(preview.discount_base_snapshot, 1000);
  assert.equal(preview.discount_rate_snapshot, 0.2);
  assert.equal(preview.guest_count, 10);
  assert.equal(preview.discounted_guest_count, 3);
  assert.equal(preview.discount_amount, 60);
  assert.equal(preview.total, 940);
  assert.equal(preview.a_la_carte_lines.length, 1);
  assert.notEqual(preview.total, 700);

  const checkoutResponse = await checkout(fixture, 10, 3);
  const checkoutText = await checkoutResponse.text();
  assert.equal(checkoutResponse.status, 201, checkoutText);
  const result = JSON.parse(checkoutText) as {
    transaction: {
      subtotal: number;
      discount_amount: number;
      discount_base_snapshot: number | null;
      discount_rate_snapshot: number | null;
      guest_count: number;
      discount_guest_count: number;
      total: number;
    };
  };
  assert.equal(result.transaction.subtotal, 1000);
  assert.equal(result.transaction.discount_amount, 60);
  assert.equal(result.transaction.discount_base_snapshot, 1000);
  assert.equal(result.transaction.discount_rate_snapshot, 0.2);
  assert.equal(result.transaction.guest_count, 10);
  assert.equal(result.transaction.discount_guest_count, 3);
  assert.equal(result.transaction.total, 940);
});

test("validates bill-time guest counts before preview or checkout", async () => {
  const fixture = await createFixture();
  const noGuests = await checkout(fixture, 0, 0);
  assert.equal(noGuests.status, 400);
  const tooManySeniors = await checkout(fixture, 2, 3);
  assert.equal(tooManySeniors.status, 400);
  const invalidPreview = await request(
    `/api/pos/dining/sessions/${fixture.sessionId}/checkout-preview?guestCount=2&seniorPwdCount=3`,
    undefined,
    "GET"
  );
  assert.equal(invalidPreview.status, 400);
  assert.equal(await prisma.posTransaction.count({ where: { dining_session_id: fixture.sessionId } }), 0);
});

test("checkout totals committed and legacy released orders from their saved prices", async () => {
  const fixture = await createFixture();
  await commitOrder(fixture, "mixed-committed", 2);
  await createOrder(fixture, "released", {
    name: "Legacy saved item",
    price: 7,
    quantity: 3,
    suffix: `${testRunKey}-mixed-released`
  });

  const response = await checkout(fixture);
  const responseText = await response.text();
  assert.equal(response.status, 201, responseText);
  const result = JSON.parse(responseText) as {
    transaction: {
      total: number;
      items: Array<{ name_snapshot: string | null; unit_price: number; total_price: number; quantity: number }>;
    };
  };
  assert.equal(result.transaction.total, fixture.price * 2 + 7 * 3);
  assert.deepEqual(
    result.transaction.items.map((item) => ({
      name: item.name_snapshot,
      unitPrice: item.unit_price,
      total: item.total_price,
      quantity: item.quantity
    })),
    [
      { name: fixture.productName, unitPrice: fixture.price, total: fixture.price * 2, quantity: 2 },
      { name: "Legacy saved item", unitPrice: 7, total: 21, quantity: 3 }
    ]
  );
});

test("checkout includes saved Unlimited beverage add-ons separately from the Unlimited package", async () => {
  const fixture = await createFixture({ price: 17.25 });
  await prisma.sellingProduct.update({
    where: { id: fixture.productId },
    data: { category: "Beverage" }
  });
  const packageResponse = await request(
    `/api/pos/dining/sessions/${fixture.sessionId}/unlimited-sessions`,
    { paxCount: 2 }
  );
  const packageText = await packageResponse.text();
  assert.equal(packageResponse.status, 201, packageText);
  const packageId = (JSON.parse(packageText) as { unlimited_session: { id: string } }).unlimited_session.id;
  const orderResponse = await request(`/api/pos/dining/sessions/${fixture.sessionId}/orders`, {
    idempotencyKey: `step45-unlimited-addon-${testRunKey}`,
    orderType: "unlimited",
    unlimitedSessionId: packageId,
    items: [{ productId: fixture.productId, quantity: 2, expectedUnitPrice: fixture.price }]
  });
  const orderText = await orderResponse.text();
  assert.equal(orderResponse.status, 201, orderText);

  const endResponse = await request(`/api/pos/dining/unlimited-sessions/${packageId}/end`, {
    leftovers: [{ productId: fixture.productId, quantity: 1 }]
  });
  const endText = await endResponse.text();
  assert.equal(endResponse.status, 200, endText);
  const settings = await prisma.unlimitedSetting.findFirstOrThrow();
  const previewResponse = await checkoutPreview(fixture, 10, 3);
  const previewText = await previewResponse.text();
  assert.equal(previewResponse.status, 200, previewText);
  const preview = JSON.parse(previewText) as {
    unlimited_order_lines: Array<{ name: string; quantity: number; unit_price: number; total_price: number }>;
    unlimited_amount: number;
    leftover_amount: number;
    discount_base_snapshot: number;
    discount_rate_snapshot: number;
    discounted_guest_count: number;
    discount_amount: number;
    subtotal: number;
  };
  assert.deepEqual(preview.unlimited_order_lines.map((line) => ({
    name: line.name,
    quantity: line.quantity,
    unit_price: line.unit_price,
    total_price: line.total_price
  })), [{
    name: fixture.productName,
    quantity: 2,
    unit_price: fixture.price,
    total_price: fixture.price * 2
  }]);
  assert.equal(preview.unlimited_amount, 2 * Number(settings.price_per_person));
  assert.equal(preview.leftover_amount, fixture.price * Number(settings.leftover_charge_percent) / 100);
  assert.equal(preview.discount_base_snapshot, 0);
  assert.equal(preview.discount_rate_snapshot, 0.2);
  assert.equal(preview.discounted_guest_count, 3);
  assert.equal(preview.discount_amount, 0);
  assert.equal(preview.subtotal, 2 * fixture.price + preview.unlimited_amount + preview.leftover_amount);

  const stockAndMovementsBeforeCheckout = await readStockAndMovements(fixture);
  const checkoutResponse = await checkout(fixture, 10, 3);
  const checkoutText = await checkoutResponse.text();
  assert.equal(checkoutResponse.status, 201, checkoutText);
  const checkoutResult = JSON.parse(checkoutText) as {
    transaction: {
      total: number;
      items: Array<{ name_snapshot: string | null; quantity: number; unit_price: number; total_price: number }>;
      charges: Array<{ line_type: string; total_price: number }>;
    };
  };
  assert.equal(checkoutResult.transaction.total, preview.subtotal);
  assert.deepEqual(checkoutResult.transaction.items.map((item) => ({
    name: item.name_snapshot,
    quantity: item.quantity,
    unit_price: item.unit_price,
    total_price: item.total_price
  })), [{
    name: fixture.productName,
    quantity: 2,
    unit_price: fixture.price,
    total_price: fixture.price * 2
  }]);
  assert.equal(checkoutResult.transaction.charges.some((charge) => charge.line_type === "unlimited_package"), true);
  assert.deepEqual(await readStockAndMovements(fixture), stockAndMovementsBeforeCheckout);
});

test("legacy sale-history rows with null snapshots fall back to live product and table values", async () => {
  const fixture = await createFixture();
  await prisma.diningTableSession.update({
    where: { id: fixture.sessionId },
    data: { status: "closed", closed_at: new Date() }
  });
  await prisma.table.update({
    where: { id: fixture.tableId },
    data: { status: "available" }
  });
  const transaction = await prisma.posTransaction.create({
    data: {
      transaction_number: `S43-LEGACY-${testRunKey}-${fixtureSequence}`,
      customer_name: null,
      dining_session_id: fixture.sessionId,
      transaction_type: "dine_in",
      subtotal: fixture.price,
      tax: 0,
      total: fixture.price,
      payment_method: "cash",
      status: "paid",
      cashier_id: cashier.id,
      items: {
        create: [{
          selling_product_id: fixture.productId,
          name_snapshot: null,
          quantity: 1,
          unit_price: fixture.price,
          total_price: fixture.price
        }]
      }
    }
  });

  const response = await request(
    `/api/pos/transactions/unified?transaction_type=dine_in&search=${encodeURIComponent(transaction.transaction_number)}`,
    undefined,
    "GET"
  );
  const responseText = await response.text();
  assert.equal(response.status, 200, responseText);
  const history = JSON.parse(responseText) as {
    transactions: Array<{
      table_number: number | null;
      items: Array<{ name_snapshot?: string | null; selling_product: { name: string } }>;
    }>;
  };
  assert.equal(history.transactions.length, 1);
  assert.equal(history.transactions[0].table_number, fixture.tableNumber);
  assert.equal(history.transactions[0].items[0].name_snapshot, null);
  assert.equal(history.transactions[0].items[0].selling_product.name, fixture.productName);
});

test("unfinished legacy kitchen tickets block checkout until released or cancelled", async () => {
  for (const status of ["reserved", "prepared", "ready"] as const) {
    const fixture = await createFixture();
    await createOrder(fixture, status, { suffix: `${testRunKey}-block-${status}` });
    const response = await checkout(fixture);
    const body = await response.json() as { message: string };
    assert.equal(response.status, 409);
    assert.match(body.message, /legacy kitchen tickets/i);
    assert.match(body.message, /released or cancelled/i);
    const session = await prisma.diningTableSession.findUniqueOrThrow({
      where: { id: fixture.sessionId }
    });
    assert.equal(session.status, "active");
    assert.equal(await prisma.posTransaction.count({ where: { dining_session_id: fixture.sessionId } }), 0);
  }
});

test("checkout frees linked tables and archives a temporary table", async () => {
  const linkedFixture = await createFixture();
  await createOrder(linkedFixture, "committed", { suffix: `${testRunKey}-linked` });
  const maxTable = await prisma.table.aggregate({ _max: { table_number: true } });
  const linkedTable = await prisma.table.create({
    data: {
      table_number: (maxTable._max.table_number ?? 0) + 1,
      capacity: 2,
      status: "unavailable",
      unavailable_reason: "Linked to active table",
      linked_to_table_id: linkedFixture.tableId,
      is_archived: false
    }
  });
  const linkedCheckout = await checkout(linkedFixture);
  const linkedText = await linkedCheckout.text();
  assert.equal(linkedCheckout.status, 201, linkedText);
  assert.equal((await prisma.table.findUniqueOrThrow({ where: { id: linkedFixture.tableId } })).status, "available");
  const freedLink = await prisma.table.findUniqueOrThrow({ where: { id: linkedTable.id } });
  assert.equal(freedLink.status, "available");
  assert.equal(freedLink.linked_to_table_id, null);
  assert.equal(freedLink.unavailable_reason, null);

  const temporaryFixture = await createFixture({ temporary: true });
  await createOrder(temporaryFixture, "committed", { suffix: `${testRunKey}-temporary` });
  const temporaryCheckout = await checkout(temporaryFixture);
  const temporaryText = await temporaryCheckout.text();
  assert.equal(temporaryCheckout.status, 201, temporaryText);
  const archived = await prisma.table.findUniqueOrThrow({ where: { id: temporaryFixture.tableId } });
  assert.equal(archived.is_temporary, true);
  assert.equal(archived.is_archived, true);
  assert.ok(archived.archived_at);
  assert.equal(archived.status, "unavailable");
  assert.equal((await prisma.diningTableSession.findUniqueOrThrow({
    where: { id: temporaryFixture.sessionId }
  })).status, "closed");
});

test("table history finds a combined-table sale by a secondary table after checkout unlinks it", async () => {
  const fixture = await createFixture();
  const maxTableNumber = await prisma.table.aggregate({ _max: { table_number: true } });
  const secondaryTable = await prisma.table.create({
    data: {
      table_number: (maxTableNumber._max.table_number ?? 0) + 1,
      capacity: 2,
      status: "unavailable",
      linked_to_table_id: fixture.tableId,
      unavailable_reason: "Linked to active table",
      is_archived: false
    }
  });
  const combination = await prisma.tableCombination.create({
    data: {
      name: `Step 4.6 history ${testRunKey}-${fixtureSequence}`,
      members: {
        create: [
          { table_id: fixture.tableId, order_index: 0 },
          { table_id: secondaryTable.id, order_index: 1 }
        ]
      }
    }
  });
  await prisma.diningTableSession.update({
    where: { id: fixture.sessionId },
    data: { table_combination_id: combination.id }
  });
  await createOrder(fixture, "committed", {
    suffix: `${testRunKey}-combined-table-history`
  });

  const checkoutResponse = await checkout(fixture);
  const checkoutText = await checkoutResponse.text();
  assert.equal(checkoutResponse.status, 201, checkoutText);
  const checkoutResult = JSON.parse(checkoutText) as {
    transaction: { id: string; transaction_number: string; table_ids_snapshot: string[] };
  };
  assert.deepEqual(
    checkoutResult.transaction.table_ids_snapshot.sort(),
    [fixture.tableId, secondaryTable.id].sort()
  );
  assert.equal((await prisma.table.findUniqueOrThrow({ where: { id: secondaryTable.id } })).linked_to_table_id, null);

  await prisma.table.update({
    where: { id: secondaryTable.id },
    data: { table_number: secondaryTable.table_number + 50000 }
  });
  const historyResponse = await request(
    `/api/pos/transactions/unified?transaction_type=dine_in&table_id=${encodeURIComponent(secondaryTable.id)}&search=${encodeURIComponent(checkoutResult.transaction.transaction_number)}`,
    undefined,
    "GET"
  );
  const historyText = await historyResponse.text();
  assert.equal(historyResponse.status, 200, historyText);
  const history = JSON.parse(historyText) as {
    transactions: Array<{ id: string; transaction_number: string }>;
  };
  assert.deepEqual(history.transactions.map((transaction) => transaction.id), [checkoutResult.transaction.id]);
});

test("table history finds archived temporary-table sales by their saved stable ID", async () => {
  const fixture = await createFixture({ temporary: true });
  await createOrder(fixture, "committed", { suffix: `${testRunKey}-temporary-table-history` });
  const checkoutResponse = await checkout(fixture);
  const checkoutText = await checkoutResponse.text();
  assert.equal(checkoutResponse.status, 201, checkoutText);
  const checkoutResult = JSON.parse(checkoutText) as {
    transaction: { id: string; transaction_number: string; table_ids_snapshot: string[] };
  };
  assert.deepEqual(checkoutResult.transaction.table_ids_snapshot, [fixture.tableId]);
  const archivedTable = await prisma.table.findUniqueOrThrow({ where: { id: fixture.tableId } });
  assert.equal(archivedTable.is_archived, true);

  const tablesResponse = await request("/api/pos/dining/history-tables", undefined, "GET");
  const tablesText = await tablesResponse.text();
  assert.equal(tablesResponse.status, 200, tablesText);
  const tables = JSON.parse(tablesText) as {
    tables: Array<{ id: string; is_archived: boolean; is_temporary: boolean }>;
  };
  assert.ok(tables.tables.some((table) =>
    table.id === fixture.tableId && table.is_archived && table.is_temporary
  ));

  const historyResponse = await request(
    `/api/pos/transactions/unified?table_id=${encodeURIComponent(fixture.tableId)}&search=${encodeURIComponent(checkoutResult.transaction.transaction_number)}`,
    undefined,
    "GET"
  );
  const historyText = await historyResponse.text();
  assert.equal(historyResponse.status, 200, historyText);
  const history = JSON.parse(historyText) as { transactions: Array<{ id: string }> };
  assert.deepEqual(history.transactions.map((transaction) => transaction.id), [checkoutResult.transaction.id]);
});

test("legacy history falls back to the dining session table when the snapshot is null", async () => {
  const fixture = await createFixture();
  const transaction = await prisma.posTransaction.create({
    data: {
      transaction_number: `LEGACY-${testRunKey}-${fixtureSequence}`,
      customer_name: null,
      dining_session_id: fixture.sessionId,
      table_number_snapshot: null,
      transaction_type: "dine_in",
      subtotal: fixture.price,
      tax: 0,
      unlimited_amount: 0,
      leftover_amount: 0,
      discount_amount: 0,
      guest_count: 1,
      discount_guest_count: 0,
      total: fixture.price,
      payment_method: "cash",
      cash_received: fixture.price,
      change_due: 0,
      status: "paid",
      cashier_id: cashier.id
    }
  });
  assert.equal(transaction.table_ids_snapshot, null);

  const historyResponse = await request(
    `/api/pos/transactions/unified?transaction_type=dine_in&table_id=${encodeURIComponent(fixture.tableId)}&search=${encodeURIComponent(transaction.transaction_number)}`,
    undefined,
    "GET"
  );
  const historyText = await historyResponse.text();
  assert.equal(historyResponse.status, 200, historyText);
  const history = JSON.parse(historyText) as {
    transactions: Array<{ id: string; table_number: number | null }>;
  };
  assert.equal(history.transactions.length, 1);
  assert.equal(history.transactions[0].id, transaction.id);
  assert.equal(history.transactions[0].table_number, fixture.tableNumber);
});

test("concurrent checkout retries create one transaction and replay the saved result", async () => {
  const fixture = await createFixture();
  await createOrder(fixture, "committed", { suffix: `${testRunKey}-idempotent-checkout` });
  const responses = await Promise.all([checkout(fixture), checkout(fixture)]);
  assert.deepEqual(responses.map((response) => response.status).sort(), [200, 201]);
  const results = await Promise.all(responses.map(async (response) => {
    const text = await response.text();
    assert.ok(response.status === 200 || response.status === 201, text);
    return JSON.parse(text) as { replayed: boolean; transaction: { id: string } };
  }));
  assert.equal(results[0].transaction.id, results[1].transaction.id);
  assert.equal(results.filter((result) => result.replayed).length, 1);
  assert.equal(await prisma.posTransaction.count({ where: { dining_session_id: fixture.sessionId } }), 1);
  assert.equal((await prisma.diningTableSession.findUniqueOrThrow({
    where: { id: fixture.sessionId }
  })).status, "closed");
});

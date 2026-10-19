import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import jwt from "jsonwebtoken";

const testDatabaseUrl = process.env.DINING_POS_ORDER_COMMIT_TEST_DATABASE_URL;
if (!testDatabaseUrl) {
  throw new Error("DINING_POS_ORDER_COMMIT_TEST_DATABASE_URL must point to a fresh restored test database.");
}

const testDatabaseName = new URL(testDatabaseUrl).pathname.slice(1);
if (!/^katana_sushi_dev_step4_(2|4|6)_/.test(testDatabaseName)) {
  throw new Error("Dining order commit integration tests only run on a dedicated restored Step 4.2, 4.4, or 4.6 test copy.");
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
  productId?: string;
  materialId?: string;
  tableId?: string;
  sessionId?: string;
  price: number;
  materialName: string;
  stock: number;
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

async function createFixture(input: {
  stock?: number;
  price?: number;
  soldAlaCarte?: boolean;
  category?: string;
  beverageWithoutRecipe?: boolean;
} = {}): Promise<Fixture> {
  fixtureSequence += 1;
  const fixture: Fixture = {
    price: input.price ?? 12.5,
    materialName: `Step 4.2 Stock ${testRunKey} ${fixtureSequence}`,
    stock: input.stock ?? 20
  };

  fixture.materialName = input.beverageWithoutRecipe
    ? `Step 4.2 Beverage ${testRunKey} ${fixtureSequence}`
    : fixture.materialName;
  const material = await prisma.rawMaterial.create({
    data: {
      name: fixture.materialName,
      category: "Step 4.2 Test",
      unit: "portion",
      current_stock: BigInt(fixture.stock),
      reorder_level: 0n,
      cost_per_unit: 1
    }
  });
  fixture.materialId = material.id;
  await prisma.materialBatch.create({
    data: {
      raw_material_id: material.id,
      batch_number: `STEP42-${testRunKey}-${fixtureSequence}`,
      quantity: BigInt(fixture.stock),
      remaining_quantity: BigInt(fixture.stock)
    }
  });

  const productName = input.beverageWithoutRecipe
    ? `${fixture.materialName} `
    : `Step 4.2 Product ${testRunKey} ${fixtureSequence}`;
  const product = await prisma.sellingProduct.create({
    data: {
      name: productName,
      category: input.category ?? (input.beverageWithoutRecipe ? "Beverage" : "Food"),
      price: fixture.price,
      is_available: true,
      is_deleted: false,
      is_sold_a_la_carte: input.soldAlaCarte ?? true
    }
  });
  fixture.productId = product.id;

  if (!input.beverageWithoutRecipe) {
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
  }

  const maxTable = await prisma.table.aggregate({ _max: { table_number: true } });
  const table = await prisma.table.create({
    data: {
      table_number: (maxTable._max.table_number ?? 0) + 1000 + fixtureSequence,
      capacity: 2,
      status: "available",
      is_archived: false
    }
  });
  fixture.tableId = table.id;
  const session = await prisma.diningTableSession.create({
    data: {
      table_id: table.id,
      cashier_id: cashier.id,
      status: "active"
    }
  });
  fixture.sessionId = session.id;
  await prisma.table.update({ where: { id: table.id }, data: { status: "occupied" } });
  return fixture;
}

async function createAdditionalSession() {
  const maxTable = await prisma.table.aggregate({ _max: { table_number: true } });
  const table = await prisma.table.create({
    data: {
      table_number: (maxTable._max.table_number ?? 0) + 1,
      capacity: 2,
      status: "available",
      is_archived: false
    }
  });
  const session = await prisma.diningTableSession.create({
    data: {
      table_id: table.id,
      cashier_id: cashier.id,
      status: "active"
    }
  });
  await prisma.table.update({ where: { id: table.id }, data: { status: "occupied" } });
  return session.id;
}

function orderBody(
  fixture: Fixture,
  idempotencyKey: string,
  quantity = 2,
  expectedUnitPrice = fixture.price,
  guestNumber?: number
) {
  return {
    idempotencyKey: `${testRunKey}-${idempotencyKey}`,
    orderType: "ala_carte",
    items: [{
      productId: fixture.productId,
      quantity,
      expectedUnitPrice,
      ...(guestNumber === undefined ? {} : { guestNumber })
    }]
  };
}

async function readStock(fixture: Fixture) {
  assert.ok(fixture.materialId);
  const material = await prisma.rawMaterial.findUniqueOrThrow({ where: { id: fixture.materialId } });
  const batch = await prisma.materialBatch.findFirstOrThrow({
    where: { raw_material_id: fixture.materialId }
  });
  return { onHand: Number(material.current_stock), batchRemaining: Number(batch.remaining_quantity) };
}

async function databaseAllowsCommittedOrders() {
  const [constraint] = await prisma.$queryRaw<Array<{ allowed: boolean }>>`
    SELECT EXISTS (
      SELECT 1
      FROM pg_constraint AS c
      WHERE c.conrelid = to_regclass('public.dining_orders')
        AND c.conname = 'dining_orders_status_check'
        AND c.contype = 'c'
        AND c.convalidated
        AND pg_get_constraintdef(c.oid) =
          'CHECK ((status = ANY (ARRAY[''reserved''::text, ''prepared''::text, ''ready''::text, ''released''::text, ''cancelled''::text, ''committed''::text])))'
    ) AS allowed
  `;
  return constraint?.allowed ?? false;
}

before(async () => {
  const database = await prisma.$queryRaw<Array<{ name: string }>>`SELECT current_database() AS name`;
  assert.equal(database[0]?.name, testDatabaseName, "Tests must connect to the new restored copy.");
  assert.equal(await checkDatabaseHealth(), true, "The restored test database must be reachable.");
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

test("commit guard follows the database rule and blocks without writes until committed is allowed", async () => {
  const fixture = await createFixture();
  const allowed = await databaseAllowsCommittedOrders();
  const orderCountBefore = await prisma.diningOrder.count({
    where: { dining_session_id: fixture.sessionId }
  });
  const stockBefore = await readStock(fixture);
  const response = await request(
    `/api/pos/dining/sessions/${fixture.sessionId}/orders`,
    orderBody(fixture, "step42-db-rule-guard-00001")
  );
  const responseText = await response.text();

  if (!allowed) {
    assert.equal(response.status, 503, responseText);
    assert.equal(
      (JSON.parse(responseText) as { message: string }).message,
      "Order commit is not available until the pending database migration is deployed"
    );
    assert.equal(
      await prisma.diningOrder.count({ where: { dining_session_id: fixture.sessionId } }),
      orderCountBefore
    );
    assert.equal(
      await prisma.inventoryMovement.count({ where: { raw_material_id: fixture.materialId } }),
      0
    );
    assert.deepEqual(await readStock(fixture), stockBefore);
  } else {
    assert.equal(response.status, 201, responseText);
    assert.equal((JSON.parse(responseText) as { order: { status: string } }).order.status, "committed");
    assert.equal(
      await prisma.diningOrder.count({ where: { dining_session_id: fixture.sessionId } }),
      orderCountBefore + 1
    );
    assert.deepEqual(await readStock(fixture), {
      onHand: stockBefore.onHand - 4,
      batchRemaining: stockBefore.batchRemaining - 4
    });
  }
});

test("commits a guestless a-la-carte order, snapshots price/table, and consumes stock once outside kitchen tickets", async () => {
  const fixture = await createFixture();
  const response = await request(
    `/api/pos/dining/sessions/${fixture.sessionId}/orders`,
    orderBody(fixture, "step42-guestless-commit-0001")
  );
  const responseText = await response.text();
  assert.equal(response.status, 201, responseText);
  const payload = JSON.parse(responseText) as {
    replayed: boolean;
    order: {
      id: string;
      order_number: string;
      order_type: string;
      status: string;
      table_number_snapshot: number;
      items: Array<{ guest: null; unit_price: number; total_price: number; quantity: number }>;
      ingredient_locks: unknown[];
    };
  };
  assert.equal(payload.replayed, false);
  assert.equal(payload.order.order_type, "ala_carte");
  assert.equal(payload.order.status, "committed");
  assert.equal(payload.order.table_number_snapshot, (await prisma.table.findUniqueOrThrow({
    where: { id: fixture.tableId }
  })).table_number);
  assert.equal(payload.order.items.length, 1);
  assert.equal(payload.order.items[0].guest, null);
  assert.equal(payload.order.items[0].unit_price, fixture.price);
  assert.equal(payload.order.items[0].total_price, fixture.price * 2);
  assert.deepEqual(payload.order.ingredient_locks, []);

  assert.deepEqual(await readStock(fixture), { onHand: 16, batchRemaining: 16 });
  const movement = await prisma.inventoryMovement.findMany({
    where: { raw_material_id: fixture.materialId, source_reference: payload.order.order_number }
  });
  assert.equal(movement.length, 1);
  assert.equal(movement[0].action, "Used");
  assert.equal(Number(movement[0].quantity), 4);

  const kitchenResponse = await request("/api/pos/kitchen/orders", undefined, "GET");
  const kitchenText = await kitchenResponse.text();
  assert.equal(kitchenResponse.status, 200, kitchenText);
  const kitchen = JSON.parse(kitchenText) as { orders: Array<{ id: string }> };
  assert.equal(kitchen.orders.some((order) => order.id === payload.order.id), false);

  const cancelResponse = await request(`/api/pos/kitchen/orders/${payload.order.id}/status`, { status: "cancelled" }, "PATCH");
  const cancelText = await cancelResponse.text();
  assert.equal(cancelResponse.status, 409, cancelText);
  assert.deepEqual(await readStock(fixture), { onHand: 16, batchRemaining: 16 });
});

test("concurrent duplicate commits and retries replay one order without a second stock deduction", async () => {
  const fixture = await createFixture();
  const body = orderBody(fixture, "step44-idempotent-concurrent-01");
  const responses = await Promise.all([
    request(`/api/pos/dining/sessions/${fixture.sessionId}/orders`, body),
    request(`/api/pos/dining/sessions/${fixture.sessionId}/orders`, body)
  ]);
  const statusCodes = responses.map((response) => response.status).sort();
  assert.deepEqual(statusCodes, [200, 201]);
  const results = await Promise.all(responses.map((response) => response.json())) as Array<{
    replayed: boolean;
    order: { id: string; order_number: string };
  }>;
  assert.equal(results[0].order.id, results[1].order.id);
  assert.equal(results.filter((result) => result.replayed).length, 1);
  assert.deepEqual(await readStock(fixture), { onHand: 16, batchRemaining: 16 });
  assert.equal(await prisma.inventoryMovement.count({
    where: { raw_material_id: fixture.materialId, source_reference: results[0].order.order_number }
  }), 1);
  assert.equal(await prisma.inventoryMovement.count({
    where: { raw_material_id: fixture.materialId, action: "Used" }
  }), 1);
  assert.equal(await prisma.diningOrder.count({ where: { dining_session_id: fixture.sessionId } }), 1);

  const retry = await request(`/api/pos/dining/sessions/${fixture.sessionId}/orders`, body);
  const retryText = await retry.text();
  assert.equal(retry.status, 200, retryText);
  assert.equal((JSON.parse(retryText) as { replayed: boolean }).replayed, true);
  assert.deepEqual(await readStock(fixture), { onHand: 16, batchRemaining: 16 });
  assert.equal(await prisma.inventoryMovement.count({
    where: { raw_material_id: fixture.materialId, action: "Used" }
  }), 1);

  const conflict = await request(
    `/api/pos/dining/sessions/${fixture.sessionId}/orders`,
    orderBody(fixture, "step44-idempotent-concurrent-01", 3)
  );
  const conflictText = await conflict.text();
  assert.equal(conflict.status, 409, conflictText);
  assert.deepEqual(await readStock(fixture), { onHand: 16, batchRemaining: 16 });
  assert.equal(await prisma.inventoryMovement.count({
    where: { raw_material_id: fixture.materialId, action: "Used" }
  }), 1);
});

test("concurrent orders at separate tables cannot oversell the same locked material", async () => {
  const fixture = await createFixture({ stock: 4 });
  const secondSessionId = await createAdditionalSession();
  const responses = await Promise.all([
    request(
      `/api/pos/dining/sessions/${fixture.sessionId}/orders`,
      orderBody(fixture, "step42-stock-race-first-0001", 2)
    ),
    request(
      `/api/pos/dining/sessions/${secondSessionId}/orders`,
      orderBody(fixture, "step42-stock-race-second-001", 2)
    )
  ]);
  const statuses = responses.map((response) => response.status).sort();
  assert.deepEqual(statuses, [201, 409]);
  const messages = await Promise.all(responses.map((response) => response.text()));
  const shortageIndex = responses.findIndex((response) => response.status === 409);
  assert.match(messages[shortageIndex], /not enough/i);
  assert.equal(await prisma.diningOrder.count({
    where: { dining_session_id: { in: [fixture.sessionId!, secondSessionId] } }
  }), 1);
  assert.deepEqual(await readStock(fixture), { onHand: 0, batchRemaining: 0 });
  assert.equal(await prisma.inventoryMovement.count({
    where: { raw_material_id: fixture.materialId, action: "Used" }
  }), 1);
});

test("rejects a stale reviewed price without creating an order or consuming stock", async () => {
  const fixture = await createFixture();
  const response = await request(
    `/api/pos/dining/sessions/${fixture.sessionId}/orders`,
    orderBody(fixture, "step42-price-review-000001", 2, fixture.price + 0.01)
  );
  assert.equal(response.status, 409);
  const error = await response.json() as { message: string };
  assert.match(error.message, /review the order again/i);
  assert.equal(await prisma.diningOrder.count({ where: { dining_session_id: fixture.sessionId } }), 0);
  assert.deepEqual(await readStock(fixture), { onHand: 20, batchRemaining: 20 });
});

test("insufficient stock rolls back the order and every inventory change with a clear shortage", async () => {
  const fixture = await createFixture({ stock: 4 });
  const response = await request(
    `/api/pos/dining/sessions/${fixture.sessionId}/orders`,
    orderBody(fixture, "step42-shortage-rollback-0001", 3)
  );
  assert.equal(response.status, 409);
  const error = await response.json() as { message: string };
  assert.match(error.message, new RegExp(fixture.materialName));
  assert.equal(await prisma.diningOrder.count({ where: { dining_session_id: fixture.sessionId } }), 0);
  assert.equal(await prisma.inventoryMovement.count({ where: { raw_material_id: fixture.materialId } }), 0);
  assert.deepEqual(await readStock(fixture), { onHand: 4, batchRemaining: 4 });
});

test("requires a-la-carte sale eligibility and keeps Unlimited commits disabled in this step", async () => {
  const fixture = await createFixture({ soldAlaCarte: false });
  const alaCarteResponse = await request(
    `/api/pos/dining/sessions/${fixture.sessionId}/orders`,
    orderBody(fixture, "step42-unsold-product-00001")
  );
  assert.equal(alaCarteResponse.status, 409);
  assert.match(
    (await alaCarteResponse.json() as { message: string }).message,
    /only available in the Unlimited cart/i
  );

  const unlimitedResponse = await request(`/api/pos/dining/sessions/${fixture.sessionId}/orders`, {
    idempotencyKey: "step42-unlimited-disabled-001",
    orderType: "unlimited",
    unlimitedSessionId: "not-yet-enabled",
    items: [{ productId: fixture.productId, quantity: 1, expectedUnitPrice: fixture.price }]
  });
  assert.equal(unlimitedResponse.status, 409);
  assert.match(
    (await unlimitedResponse.json() as { message: string }).message,
    /Unlimited order commits are not available yet/i
  );
  assert.equal(await prisma.diningOrder.count({ where: { dining_session_id: fixture.sessionId } }), 0);
  assert.deepEqual(await readStock(fixture), { onHand: 20, batchRemaining: 20 });
});

test("preserves beverage stock-name lookup for products without recipe ingredients", async () => {
  const fixture = await createFixture({ beverageWithoutRecipe: true });
  const response = await request(
    `/api/pos/dining/sessions/${fixture.sessionId}/orders`,
    orderBody(fixture, "step42-beverage-fallback-001", 2)
  );
  const responseText = await response.text();
  assert.equal(response.status, 201, responseText);
  assert.deepEqual(await readStock(fixture), { onHand: 18, batchRemaining: 18 });
  assert.equal(await prisma.inventoryMovement.count({
    where: { raw_material_id: fixture.materialId, action: "Used" }
  }), 1);
});

test("still supports optional guest assignment for legacy sessions that have guest records", async () => {
  const fixture = await createFixture();
  assert.ok(fixture.sessionId);
  const guest = await prisma.diningGuest.create({
    data: { dining_session_id: fixture.sessionId, guest_number: 1 }
  });

  test("starts Unlimited with explicit headcount on a guestless session and starts the timer at the button action", async () => {
    const fixture = await createFixture();
    const settings = await prisma.unlimitedSetting.findFirstOrThrow();
    const before = Date.now();
    const response = await request(
      `/api/pos/dining/sessions/${fixture.sessionId}/unlimited-sessions`,
      { paxCount: 3 }
    );
    const responseText = await response.text();
    assert.equal(response.status, 201, responseText);
    const payload = JSON.parse(responseText) as {
      unlimited_session: {
        id: string;
        pax_count: number;
        price_per_pax: number;
        time_limit_minutes: number;
        first_round_at: string | null;
        started_at: string;
        ends_at: string;
      };
    };
    const started = new Date(payload.unlimited_session.first_round_at ?? "").getTime();
    const ends = new Date(payload.unlimited_session.ends_at).getTime();
    assert.equal(payload.unlimited_session.pax_count, 3);
    assert.equal(payload.unlimited_session.price_per_pax, Number(settings.price_per_person));
    assert.equal(payload.unlimited_session.time_limit_minutes, settings.time_limit_minutes);
    assert.ok(payload.unlimited_session.first_round_at);
    assert.ok(started >= before && started <= Date.now());
    assert.equal(ends - started, settings.time_limit_minutes * 60_000);

    const invalidHeadcount = await request(
      `/api/pos/dining/sessions/${fixture.sessionId}/unlimited-sessions`,
      { paxCount: 0 }
    );
    assert.equal(invalidHeadcount.status, 400);
  });

  test("concurrent Unlimited starts create exactly one active package", async () => {
    const fixture = await createFixture();
    const path = `/api/pos/dining/sessions/${fixture.sessionId}/unlimited-sessions`;
    const responses = await Promise.all([
      request(path, { paxCount: 2 }),
      request(path, { paxCount: 2 })
    ]);
    const responseTexts = await Promise.all(responses.map((response) => response.text()));
    assert.deepEqual(responses.map((response) => response.status).sort(), [201, 409]);
    const activePackages = await prisma.unlimitedSession.findMany({
      where: { dining_session_id: fixture.sessionId, status: "active" }
    });
    assert.equal(activePackages.length, 1, responseTexts.join("\n"));
  });

  test("cashier extends Unlimited by the configured no-fee duration", async () => {
    const fixture = await createFixture();
    const settings = await prisma.unlimitedSetting.findFirstOrThrow();
    await prisma.unlimitedSetting.update({
      where: { id: settings.id },
      data: { extension_minutes: 45 }
    });
    const startResponse = await request(
      `/api/pos/dining/sessions/${fixture.sessionId}/unlimited-sessions`,
      { paxCount: 2 }
    );
    const startText = await startResponse.text();
    assert.equal(startResponse.status, 201, startText);
    const sessionId = (JSON.parse(startText) as { unlimited_session: { id: string; ends_at: string } }).unlimited_session.id;
    const previousEnd = new Date((JSON.parse(startText) as { unlimited_session: { ends_at: string } }).unlimited_session.ends_at).getTime();

    const extensionResponse = await request(`/api/pos/dining/unlimited-sessions/${sessionId}/extend`, {});
    const extensionText = await extensionResponse.text();
    assert.equal(extensionResponse.status, 200, extensionText);
    const extensionPayload = JSON.parse(extensionText) as {
      extension: { minutes: number };
      session: { ends_at: string };
    };
    assert.equal(extensionPayload.extension.minutes, 45);
    assert.equal(new Date(extensionPayload.session.ends_at).getTime(), previousEnd + 45 * 60_000);
    assert.equal(await prisma.unlimitedExtension.count({ where: { unlimited_session_id: sessionId } }), 1);
  });

  test("Unlimited extension setting accepts only whole-number values from 5 through 120", async () => {
    const settings = await prisma.unlimitedSetting.findFirstOrThrow();
    const originalValue = settings.extension_minutes;
    for (const extensionMinutes of [4, 121, 30.5]) {
      const invalidResponse = await request("/api/admin/unlimited/settings", {
        price_per_person: settings.price_per_person,
        time_limit_minutes: settings.time_limit_minutes,
        extension_minutes: extensionMinutes,
        leftover_charge_percent: settings.leftover_charge_percent
      }, "PUT");
      assert.equal(invalidResponse.status, 400, `Expected ${extensionMinutes} to be rejected.`);
    }

    const validResponse = await request("/api/admin/unlimited/settings", {
      price_per_person: settings.price_per_person,
      time_limit_minutes: settings.time_limit_minutes,
      extension_minutes: 45,
      leftover_charge_percent: settings.leftover_charge_percent
    }, "PUT");
    const validText = await validResponse.text();
    assert.equal(validResponse.status, 200, validText);
    assert.equal((JSON.parse(validText) as { settings: { extension_minutes: number } }).settings.extension_minutes, 45);
    await prisma.unlimitedSetting.update({
      where: { id: settings.id },
      data: { extension_minutes: originalValue }
    });
  });
  const response = await request(
    `/api/pos/dining/sessions/${fixture.sessionId}/orders`,
    orderBody(fixture, "step42-optional-guest-00001", 1, fixture.price, guest.guest_number)
  );
  const responseText = await response.text();
  assert.equal(response.status, 201, responseText);
  const payload = JSON.parse(responseText) as { order: { items: Array<{ guest_id: string | null }> } };
  assert.equal(payload.order.items[0].guest_id, guest.id);
  assert.deepEqual(await readStock(fixture), { onHand: 18, batchRemaining: 18 });
});

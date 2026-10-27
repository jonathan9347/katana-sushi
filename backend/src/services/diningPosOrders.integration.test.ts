import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import jwt from "jsonwebtoken";

const testDatabaseUrl = process.env.DINING_POS_ORDER_COMMIT_TEST_DATABASE_URL;
if (!testDatabaseUrl) {
  throw new Error("DINING_POS_ORDER_COMMIT_TEST_DATABASE_URL must point to a fresh restored test database.");
}

const testDatabaseName = new URL(testDatabaseUrl).pathname.slice(1);
if (!/^katana_sushi_dev_step4_(2|4|5|6|7)_/.test(testDatabaseName)) {
  throw new Error("Dining order commit integration tests only run on a dedicated restored Step 4.2, 4.4, 4.5, 4.6, or 4.7 test copy.");
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

async function request(
  path: string,
  body?: unknown,
  method = "POST",
  user = cashier
) {
  return fetch(`${baseUrl}${path}`, {
    method,
    headers: {
      Authorization: tokenFor(user),
      ...(body === undefined ? {} : { "Content-Type": "application/json" })
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) })
  });
}

async function createFixture(input: {
  stock?: number;
  price?: number;
  soldAlaCarte?: boolean;
  included?: boolean;
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
  if (input.included) {
    await prisma.unlimitedIncludedProduct.create({
      data: { selling_product_id: product.id, is_included: true }
    });
  }

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

async function createAvailableTable() {
  const maxTable = await prisma.table.aggregate({ _max: { table_number: true } });
  return prisma.table.create({
    data: {
      table_number: (maxTable._max.table_number ?? 0) + 2000 + fixtureSequence,
      capacity: 4,
      status: "available",
      is_archived: false
    }
  });
}

function orderBody(
  fixture: Fixture,
  idempotencyKey: string,
  quantity = 2,
  expectedUnitPrice = fixture.price
) {
  return {
    idempotencyKey: `${testRunKey}-${idempotencyKey}`,
    orderType: "ala_carte",
    items: [{
      productId: fixture.productId,
      quantity,
      expectedUnitPrice
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

test("read-only committed-order lookup returns saved snapshots without changing stock or movements", async () => {
  const fixture = await createFixture();
  const commitResponse = await request(
    `/api/pos/dining/sessions/${fixture.sessionId}/orders`,
    orderBody(fixture, "step46-reprint-readonly-0001")
  );
  const commitText = await commitResponse.text();
  assert.equal(commitResponse.status, 201, commitText);
  const committed = JSON.parse(commitText) as {
    order: {
      id: string;
      order_number: string;
      table_number_snapshot: number;
      created_at: string;
      items: Array<{ id: string; name_snapshot: string; quantity: number; unit_price: number; total_price: number }>;
    };
  };
  const stockBeforeLookup = await readStock(fixture);
  const movementsBeforeLookup = await prisma.inventoryMovement.count({
    where: { raw_material_id: fixture.materialId, source_reference: committed.order.order_number }
  });

  const lookupResponse = await request(`/api/pos/dining/orders/${committed.order.id}`, undefined, "GET");
  const lookupText = await lookupResponse.text();
  assert.equal(lookupResponse.status, 200, lookupText);
  const lookup = JSON.parse(lookupText) as { order: typeof committed.order };
  assert.equal(lookup.order.id, committed.order.id);
  assert.equal(lookup.order.order_number, committed.order.order_number);
  assert.equal(lookup.order.table_number_snapshot, committed.order.table_number_snapshot);
  assert.ok(lookup.order.created_at);
  assert.equal(lookup.order.items.length, committed.order.items.length);
  assert.equal(lookup.order.items[0].id, committed.order.items[0].id);
  assert.equal(lookup.order.items[0].name_snapshot, committed.order.items[0].name_snapshot);
  assert.equal(lookup.order.items[0].quantity, committed.order.items[0].quantity);
  assert.equal(lookup.order.items[0].unit_price, committed.order.items[0].unit_price);
  assert.equal(lookup.order.items[0].total_price, committed.order.items[0].total_price);
  assert.deepEqual(await readStock(fixture), stockBeforeLookup);
  assert.equal(await prisma.inventoryMovement.count({
    where: { raw_material_id: fixture.materialId, source_reference: committed.order.order_number }
  }), movementsBeforeLookup);
  assert.equal(await prisma.diningOrder.count({ where: { id: committed.order.id } }), 1);

  const missingResponse = await request("/api/pos/dining/orders/does-not-exist", undefined, "GET");
  assert.equal(missingResponse.status, 404);
});

test("POS product availability subtracts active reservations from sellable batch stock", async () => {
  const fixture = await createFixture({ stock: 20 });
  assert.ok(fixture.materialId);
  assert.ok(fixture.sessionId);
  await prisma.materialBatch.updateMany({
    where: { raw_material_id: fixture.materialId },
    data: { remaining_quantity: 8n }
  });
  const reservedOrder = await prisma.diningOrder.create({
    data: {
      order_number: `POS-AVAIL-${testRunKey}-${fixtureSequence}`,
      idempotency_key: `pos-availability-${testRunKey}-${fixtureSequence}`,
      dining_session_id: fixture.sessionId,
      order_type: "ala_carte",
      status: "reserved",
      created_by: cashier.id
    }
  });
  await prisma.dineInIngredientLock.create({
    data: {
      order_id: reservedOrder.id,
      raw_material_id: fixture.materialId,
      reserved_quantity: 4n,
      unit: "portion"
    }
  });

  const response = await request("/api/products", undefined, "GET");
  assert.equal(response.status, 200, await response.text());
  const payload = await response.json() as {
    products: Array<{ id: string; is_available: boolean; available_stock: number }>;
  };
  const product = payload.products.find(({ id }) => id === fixture.productId);
  assert.ok(product);
  assert.equal(product.is_available, true);
  assert.equal(product.available_stock, 2);
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

test("takeout checkout deducts ingredient stock once when the sale is created", async () => {
  const fixture = await createFixture();
  const stockBefore = await readStock(fixture);
  const response = await request("/api/pos/transaction", {
    customerName: "Takeout stock test",
    transactionType: "takeout",
    paymentMethod: "cash",
    cashReceived: fixture.price * 2,
    items: [{ productId: fixture.productId, quantity: 2, unitPrice: fixture.price }]
  });
  const responseText = await response.text();
  assert.equal(response.status, 201, responseText);
  const result = JSON.parse(responseText) as {
    transaction: {
      id: string;
      transaction_number: string;
      transaction_type: string;
      dining_session_id?: string | null;
      table_ids_snapshot?: string[] | null;
    };
  };
  assert.equal(result.transaction.transaction_type, "takeout");
  assert.equal(result.transaction.dining_session_id ?? null, null);
  assert.equal(result.transaction.table_ids_snapshot, null);
  assert.equal((await prisma.posTransaction.findUniqueOrThrow({
    where: { id: result.transaction.id },
    select: { table_ids_snapshot: true }
  })).table_ids_snapshot, null);
  assert.deepEqual(await readStock(fixture), {
    onHand: stockBefore.onHand - 4,
    batchRemaining: stockBefore.batchRemaining - 4
  });
  assert.equal(await prisma.inventoryMovement.count({
    where: {
      raw_material_id: fixture.materialId,
      source_reference: result.transaction.transaction_number
    }
  }), 1);
  assert.equal(await prisma.inventoryTransaction.count({
    where: {
      raw_material_id: fixture.materialId,
      reference: `POS Transaction ${result.transaction.transaction_number}`,
      transaction_type: "deduct"
    }
  }), 1);
  assert.equal(await prisma.posTransaction.count({
    where: { id: result.transaction.id, dining_session_id: null, transaction_type: "takeout" }
  }), 1);
});

test("takeout checkout previews and saves the configured Senior/PWD discount", async () => {
  const fixture = await createFixture({ price: 1000 });
  const stockBefore = await readStock(fixture);
  const salesBefore = await prisma.posTransaction.count({ where: { transaction_type: "takeout" } });
  const items = [{ productId: fixture.productId!, quantity: 1, unitPrice: 1000 }];
  const previewResponse = await request("/api/pos/transaction", {
    transactionType: "takeout",
    paymentMethod: "cash",
    applyDiscount: true,
    guestCount: 10,
    seniorPwdCount: 3,
    previewOnly: true,
    items
  });
  const previewText = await previewResponse.text();
  assert.equal(previewResponse.status, 200, previewText);
  const preview = JSON.parse(previewText) as {
    subtotal: number;
    discount_base_snapshot: number;
    discount_amount: number;
    total: number;
  };
  assert.equal(preview.subtotal, 1000);
  assert.equal(preview.discount_base_snapshot, 1000);
  assert.equal(preview.discount_amount, 60);
  assert.equal(await prisma.posTransaction.count({ where: { transaction_type: "takeout" } }), salesBefore);
  assert.deepEqual(await readStock(fixture), stockBefore);

  const response = await request("/api/pos/transaction", {
    transactionType: "takeout",
    paymentMethod: "cash",
    cashReceived: 2000,
    applyDiscount: true,
    guestCount: 10,
    seniorPwdCount: 3,
    items
  });
  const responseText = await response.text();
  assert.equal(response.status, 201, responseText);
  const result = JSON.parse(responseText) as {
    transaction: {
      id: string;
      total: number;
      tax: number;
      discount_amount: number;
      discount_base_snapshot: number;
      discount_rate_snapshot: number;
      guest_count: number;
      discount_guest_count: number;
      change_due: number;
    };
  };
  assert.equal(result.transaction.discount_amount, 60);
  assert.equal(result.transaction.discount_base_snapshot, 1000);
  assert.equal(result.transaction.discount_rate_snapshot, 0.2);
  assert.equal(result.transaction.guest_count, 10);
  assert.equal(result.transaction.discount_guest_count, 3);
  assert.equal(result.transaction.total, 1000 + result.transaction.tax - 60);
  assert.equal(result.transaction.change_due, 2000 - result.transaction.total);
  assert.deepEqual(await readStock(fixture), {
    onHand: stockBefore.onHand - 2,
    batchRemaining: stockBefore.batchRemaining - 2
  });
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

test("requires a-la-carte sale eligibility and refuses Unlimited-only products in that cart", async () => {
  const fixture = await createFixture({ soldAlaCarte: false, included: true });
  const alaCarteResponse = await request(
    `/api/pos/dining/sessions/${fixture.sessionId}/orders`,
    orderBody(fixture, "step42-unsold-product-00001")
  );
  assert.equal(alaCarteResponse.status, 409);
  assert.match(
    (await alaCarteResponse.json() as { message: string }).message,
    /only available in the Unlimited cart/i
  );

  assert.equal(await prisma.diningOrder.count({ where: { dining_session_id: fixture.sessionId } }), 0);
  assert.deepEqual(await readStock(fixture), { onHand: 20, batchRemaining: 20 });
});

test("Unlimited cart commits included products free and charges beverage add-ons at menu price", async () => {
  const included = await createFixture({ included: true });
  const packageResponse = await request(
    `/api/pos/dining/sessions/${included.sessionId}/unlimited-sessions`,
    { paxCount: 2 }
  );
  const packageText = await packageResponse.text();
  assert.equal(packageResponse.status, 201, packageText);
  const packageId = (JSON.parse(packageText) as { unlimited_session: { id: string } }).unlimited_session.id;
  const includedResponse = await request(`/api/pos/dining/sessions/${included.sessionId}/orders`, {
    idempotencyKey: `${testRunKey}-unlimited-included-free`,
    orderType: "unlimited",
    unlimitedSessionId: packageId,
    items: [{ productId: included.productId, quantity: 2, expectedUnitPrice: 0 }]
  });
  const includedText = await includedResponse.text();
  assert.equal(includedResponse.status, 201, includedText);
  const includedOrder = JSON.parse(includedText) as {
    order: { order_type: string; unlimited_session_id: string; status: string; items: Array<{ unit_price: number; total_price: number }> };
  };
  assert.equal(includedOrder.order.order_type, "unlimited");
  assert.equal(includedOrder.order.unlimited_session_id, packageId);
  assert.equal(includedOrder.order.status, "committed");
  assert.equal(includedOrder.order.items[0].unit_price, 0);
  assert.equal(includedOrder.order.items[0].total_price, 0);
  assert.deepEqual(await readStock(included), { onHand: 16, batchRemaining: 16 });

  const beverage = await createFixture({ beverageWithoutRecipe: true, price: 7.25 });
  const beveragePackage = await request(
    `/api/pos/dining/sessions/${beverage.sessionId}/unlimited-sessions`,
    { paxCount: 2 }
  );
  const beveragePackageText = await beveragePackage.text();
  assert.equal(beveragePackage.status, 201, beveragePackageText);
  const beveragePackageId = (JSON.parse(beveragePackageText) as { unlimited_session: { id: string } }).unlimited_session.id;
  const beverageResponse = await request(`/api/pos/dining/sessions/${beverage.sessionId}/orders`, {
    idempotencyKey: `${testRunKey}-unlimited-beverage-addon`,
    orderType: "unlimited",
    unlimitedSessionId: beveragePackageId,
    items: [{ productId: beverage.productId, quantity: 2, expectedUnitPrice: beverage.price }]
  });
  const beverageText = await beverageResponse.text();
  assert.equal(beverageResponse.status, 201, beverageText);
  const beverageOrder = JSON.parse(beverageText) as {
    order: { items: Array<{ unit_price: number; total_price: number }> };
  };
  assert.equal(beverageOrder.order.items[0].unit_price, beverage.price);
  assert.equal(beverageOrder.order.items[0].total_price, beverage.price * 2);
  assert.deepEqual(await readStock(beverage), { onHand: 18, batchRemaining: 18 });
});

test("Unlimited cart refuses non-included non-beverage products with a clear message", async () => {
  const fixture = await createFixture();
  const packageResponse = await request(
    `/api/pos/dining/sessions/${fixture.sessionId}/unlimited-sessions`,
    { paxCount: 2 }
  );
  const packageText = await packageResponse.text();
  assert.equal(packageResponse.status, 201, packageText);
  const packageId = (JSON.parse(packageText) as { unlimited_session: { id: string } }).unlimited_session.id;
  const response = await request(`/api/pos/dining/sessions/${fixture.sessionId}/orders`, {
    idempotencyKey: `${testRunKey}-unlimited-regular-refused`,
    orderType: "unlimited",
    unlimitedSessionId: packageId,
    items: [{ productId: fixture.productId, quantity: 1, expectedUnitPrice: fixture.price }]
  });
  const responseText = await response.text();
  assert.equal(response.status, 409, responseText);
  assert.match(responseText, /not included in Unlimited/i);
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

test("rejects guestNumber in new order item requests", async () => {
  const fixture = await createFixture();
  assert.ok(fixture.sessionId);
  const body = orderBody(fixture, "guest-assignment-rejected-0001", 1);
  const response = await request(
    `/api/pos/dining/sessions/${fixture.sessionId}/orders`,
    { ...body, items: [{ ...body.items[0], guestNumber: 1 }] }
  );
  assert.equal(response.status, 400, await response.text());
  assert.equal(await prisma.diningOrder.count({ where: { dining_session_id: fixture.sessionId } }), 0);
  assert.deepEqual(await readStock(fixture), { onHand: 20, batchRemaining: 20 });

  const guest = await prisma.diningGuest.create({
    data: { dining_session_id: fixture.sessionId, guest_number: 1 }
  });
  const patchResponse = await request(
    `/api/pos/dining/sessions/${fixture.sessionId}/guests/${guest.id}`,
    { discountType: "senior" },
    "PATCH"
  );
  assert.equal(patchResponse.status, 404);
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

test("atomic walk-in confirmation creates one session and deducts stock once across retries", async (t) => {
  if (!(await databaseAllowsCommittedOrders())) {
    t.skip("The committed-order database rule is not deployed on this restored copy.");
    return;
  }
  const fixture = await createFixture();
  const table = await createAvailableTable();
  const body = {
    ...orderBody(fixture, "atomic-walkin-retry-00001"),
    selection: { type: "table" as const, tableId: table.id }
  };
  const firstResponse = await request("/api/pos/dining/confirm-order", body);
  const firstText = await firstResponse.text();
  assert.equal(firstResponse.status, 201, firstText);
  const first = JSON.parse(firstText) as {
    replayed: boolean;
    order: { id: string; status: string; table_number_snapshot: number };
  };
  assert.equal(first.replayed, false);
  assert.equal(first.order.status, "committed");
  assert.equal(first.order.table_number_snapshot, table.table_number);
  assert.equal((await prisma.table.findUniqueOrThrow({ where: { id: table.id } })).status, "occupied");
  assert.equal(await prisma.diningTableSession.count({ where: { table_id: table.id, status: "active" } }), 1);
  assert.deepEqual(await readStock(fixture), { onHand: 16, batchRemaining: 16 });

  const retryResponse = await request("/api/pos/dining/confirm-order", body);
  const retryText = await retryResponse.text();
  assert.equal(retryResponse.status, 200, retryText);
  const retry = JSON.parse(retryText) as { replayed: boolean; order: { id: string } };
  assert.equal(retry.replayed, true);
  assert.equal(retry.order.id, first.order.id);
  assert.deepEqual(await readStock(fixture), { onHand: 16, batchRemaining: 16 });
  assert.equal(await prisma.diningOrder.count({ where: { idempotency_key: body.idempotencyKey } }), 1);
});

test("atomic confirmation commits onto an already active table session", async (t) => {
  if (!(await databaseAllowsCommittedOrders())) {
    t.skip("The committed-order database rule is not deployed on this restored copy.");
    return;
  }
  const fixture = await createFixture();
  const body = {
    ...orderBody(fixture, "atomic-existing-session-0001"),
    selection: { type: "session" as const, sessionId: fixture.sessionId! }
  };
  const response = await request("/api/pos/dining/confirm-order", body);
  const responseText = await response.text();
  assert.equal(response.status, 201, responseText);
  const result = JSON.parse(responseText) as {
    order: { dining_session_id: string; table_number_snapshot: number };
  };
  assert.equal(result.order.dining_session_id, fixture.sessionId);
  assert.equal(result.order.table_number_snapshot, (await prisma.table.findUniqueOrThrow({
    where: { id: fixture.tableId }
  })).table_number);
  assert.equal(await prisma.diningTableSession.count({
    where: { id: fixture.sessionId, status: "active" }
  }), 1);
  assert.deepEqual(await readStock(fixture), { onHand: 16, batchRemaining: 16 });
});

test("atomic Unlimited confirmation starts one timed package with the confirmed headcount", async (t) => {
  if (!(await databaseAllowsCommittedOrders())) {
    t.skip("The committed-order database rule is not deployed on this restored copy.");
    return;
  }
  const fixture = await createFixture({ included: true });
  const table = await createAvailableTable();
  const settings = await prisma.unlimitedSetting.findFirstOrThrow();
  const body = {
    selection: { type: "table" as const, tableId: table.id },
    idempotencyKey: `${testRunKey}-atomic-unlimited-confirm-001`,
    orderType: "unlimited" as const,
    paxCount: 3,
    items: [{ productId: fixture.productId!, quantity: 2, expectedUnitPrice: 0 }]
  };
  const response = await request("/api/pos/dining/confirm-order", body);
  const responseText = await response.text();
  assert.equal(response.status, 201, responseText);
  const result = JSON.parse(responseText) as {
    order: { order_type: string; unlimited_session_id: string };
  };
  const unlimited = await prisma.unlimitedSession.findUniqueOrThrow({
    where: { id: result.order.unlimited_session_id }
  });
  assert.equal(result.order.order_type, "unlimited");
  assert.equal(unlimited.status, "active");
  assert.equal(unlimited.pax_count, 3);
  assert.equal(Number(unlimited.price_per_pax), Number(settings.price_per_person));
  assert.ok(unlimited.first_round_at);
  assert.equal(unlimited.ends_at.getTime() - unlimited.first_round_at!.getTime(), settings.time_limit_minutes * 60_000);
  const committed = await prisma.diningOrder.findUniqueOrThrow({
    where: { idempotency_key: body.idempotencyKey },
    select: { dining_session_id: true }
  });
  const activePackages = await prisma.unlimitedSession.count({
    where: { dining_session_id: committed.dining_session_id, status: "active" }
  });
  assert.equal(activePackages, 1);
  const retryResponse = await request("/api/pos/dining/confirm-order", body);
  assert.equal(retryResponse.status, 200, await retryResponse.text());
  assert.equal(await prisma.unlimitedSession.count({
    where: { dining_session_id: committed.dining_session_id, status: "active" }
  }), 1);
  assert.deepEqual(await readStock(fixture), { onHand: 16, batchRemaining: 16 });
});

test("atomic Unlimited confirmation supports a paid a-la-carte line in the same cart and discounts it at bill-out", async (t) => {
  if (!(await databaseAllowsCommittedOrders())) {
    t.skip("The committed-order database rule is not deployed on this restored copy.");
    return;
  }
  const regular = await createFixture({ price: 1000 });
  const included = await createFixture({ price: 500, included: true });
  const unlimitedSettings = await prisma.unlimitedSetting.findFirstOrThrow();
  const body = {
    selection: { type: "session" as const, sessionId: regular.sessionId! },
    idempotencyKey: `${testRunKey}-atomic-mixed-cart-0001`,
    orderType: "unlimited" as const,
    paxCount: 3,
    items: [
      {
        productId: regular.productId!,
        quantity: 1,
        orderType: "ala_carte" as const,
        expectedUnitPrice: 1000
      },
      {
        productId: included.productId!,
        quantity: 1,
        orderType: "unlimited" as const,
        expectedUnitPrice: 0
      }
    ]
  };
  const response = await request("/api/pos/dining/confirm-order", body);
  const responseText = await response.text();
  assert.equal(response.status, 201, responseText);
  const result = JSON.parse(responseText) as {
    order: {
      id: string;
      order_type: string;
      unlimited_session_id: string | null;
      items: Array<{ selling_product_id: string; unit_price: number }>;
    };
  };
  assert.equal(result.order.order_type, "unlimited");
  assert.deepEqual(
    result.order.items.map((item) => [item.selling_product_id, Number(item.unit_price)]).sort(),
    [[regular.productId, 1000], [included.productId, 0]].sort()
  );
  assert.deepEqual(await readStock(regular), { onHand: 18, batchRemaining: 18 });
  assert.deepEqual(await readStock(included), { onHand: 18, batchRemaining: 18 });
  assert.ok(result.order.unlimited_session_id);
  const endSessionResponse = await request(
    `/api/pos/dining/unlimited-sessions/${result.order.unlimited_session_id}/end`,
    { leftovers: [] },
    "POST"
  );
  assert.equal(endSessionResponse.status, 200, await endSessionResponse.text());

  const previewResponse = await request(
    `/api/pos/dining/sessions/${regular.sessionId}/checkout-preview?guestCount=10&seniorPwdCount=3`,
    undefined,
    "GET"
  );
  const previewText = await previewResponse.text();
  assert.equal(previewResponse.status, 200, previewText);
  const preview = JSON.parse(previewText) as {
    discount_base_snapshot: number;
    discount_amount: number;
    total: number;
  };
  assert.equal(preview.discount_base_snapshot, 1000);
  assert.equal(preview.discount_amount, 60);
  assert.equal(preview.total, Number(unlimitedSettings.price_per_person) * 3 + 940);
});

test("atomic confirmation rolls back table occupation and session creation when stock consumption fails", async (t) => {
  if (!(await databaseAllowsCommittedOrders())) {
    t.skip("The committed-order database rule is not deployed on this restored copy.");
    return;
  }
  const fixture = await createFixture({ stock: 1 });
  const table = await createAvailableTable();
  const body = {
    ...orderBody(fixture, "atomic-abandonment-rollback-01"),
    selection: { type: "table" as const, tableId: table.id }
  };
  const response = await request("/api/pos/dining/confirm-order", body);
  const responseText = await response.text();
  assert.equal(response.status, 409, responseText);
  assert.equal((await prisma.table.findUniqueOrThrow({ where: { id: table.id } })).status, "available");
  assert.equal(await prisma.diningTableSession.count({ where: { table_id: table.id } }), 0);
  assert.equal(await prisma.diningOrder.count({ where: { idempotency_key: body.idempotencyKey } }), 0);
  assert.deepEqual(await readStock(fixture), { onHand: 1, batchRemaining: 1 });
});

test("two cashiers cannot atomically confirm competing orders for the same free table", async (t) => {
  if (!(await databaseAllowsCommittedOrders())) {
    t.skip("The committed-order database rule is not deployed on this restored copy.");
    return;
  }
  const fixture = await createFixture();
  const table = await createAvailableTable();
  const secondCashier = await prisma.user.create({
    data: {
      email: `atomic-cashier-${testRunKey}@example.test`,
      name: "Atomic Test Cashier",
      password_hash: "integration-test-only",
      role: "cashier",
      is_active: true
    },
    select: { id: true, email: true, role: true }
  });
  const responses = await Promise.all([
    request("/api/pos/dining/confirm-order", {
      ...orderBody(fixture, "atomic-cashier-one-000001"),
      selection: { type: "table", tableId: table.id }
    }),
    request("/api/pos/dining/confirm-order", {
      ...orderBody(fixture, "atomic-cashier-two-000001"),
      selection: { type: "table", tableId: table.id }
    }, "POST", secondCashier)
  ]);
  const responseTexts = await Promise.all(responses.map((response) => response.text()));
  assert.deepEqual(responses.map((response) => response.status).sort(), [201, 409], responseTexts.join("\n"));
  assert.equal(await prisma.diningTableSession.count({ where: { table_id: table.id, status: "active" } }), 1);
  assert.deepEqual(await readStock(fixture), { onHand: 16, batchRemaining: 16 });
});

test("atomic reservation confirmation seats every assigned table and retries without duplicating the order", async (t) => {
  if (!(await databaseAllowsCommittedOrders())) {
    t.skip("The committed-order database rule is not deployed on this restored copy.");
    return;
  }
  const fixture = await createFixture();
  const primaryTable = await createAvailableTable();
  const linkedTable = await createAvailableTable();
  const manuallySelectedPrimary = await createAvailableTable();
  const manuallySelectedLinked = await createAvailableTable();
  const date = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Manila",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).format(new Date());
  const reservation = await prisma.reservation.create({
    data: {
      booking_id: `ATOMIC-${testRunKey}-RESERVATION`,
      customer_name: "Atomic Multi-table Guest",
      customer_phone: "0000000000",
      customer_email: "atomic-reservation@example.test",
      date: new Date(`${date}T12:00:00+08:00`),
      time: "07:00 PM",
      party_size: 6,
      status: "confirmed",
      table_assignments: {
        create: [
          { table_id: primaryTable.id, seat_count: 4 },
          { table_id: linkedTable.id, seat_count: 2 }
        ]
      }
    }
  });
  const body = {
    ...orderBody(fixture, "atomic-reservation-retry-00001"),
    selection: {
      type: "reservation" as const,
      reservationId: reservation.id,
      tableIds: [manuallySelectedPrimary.id, manuallySelectedLinked.id]
    }
  };

  const firstResponse = await request("/api/pos/dining/confirm-order", body);
  const firstText = await firstResponse.text();
  assert.equal(firstResponse.status, 201, firstText);
  const first = JSON.parse(firstText) as {
    order: { id: string; table_number_snapshot: number };
  };
  const seatedReservation = await prisma.reservation.findUniqueOrThrow({
    where: { id: reservation.id },
    include: { table_assignments: { orderBy: { table: { table_number: "asc" } } } }
  });
  assert.equal(seatedReservation.status, "seated");
  assert.deepEqual(
    seatedReservation.table_assignments
      .filter(({ status }) => status === "seated")
      .map(({ table_id }) => table_id),
    [manuallySelectedPrimary.id, manuallySelectedLinked.id].sort()
  );
  assert.equal(
    seatedReservation.table_assignments
      .find(({ table_id }) => table_id === primaryTable.id)?.status,
    "released"
  );
  assert.equal(
    seatedReservation.table_assignments
      .find(({ table_id }) => table_id === linkedTable.id)?.status,
    "released"
  );
  assert.equal(first.order.table_number_snapshot, manuallySelectedPrimary.table_number);
  assert.equal((await prisma.table.findUniqueOrThrow({ where: { id: manuallySelectedPrimary.id } })).status, "occupied");
  const linked = await prisma.table.findUniqueOrThrow({ where: { id: manuallySelectedLinked.id } });
  assert.equal(linked.status, "unavailable");
  assert.equal(linked.linked_to_table_id, manuallySelectedPrimary.id);

  const retryResponse = await request("/api/pos/dining/confirm-order", body);
  const retryText = await retryResponse.text();
  assert.equal(retryResponse.status, 200, retryText);
  const retry = JSON.parse(retryText) as { replayed: boolean; order: { id: string } };
  assert.equal(retry.replayed, true);
  assert.equal(retry.order.id, first.order.id);
  assert.equal(await prisma.diningOrder.count({ where: { idempotency_key: body.idempotencyKey } }), 1);
  assert.deepEqual(await readStock(fixture), { onHand: 16, batchRemaining: 16 });
});

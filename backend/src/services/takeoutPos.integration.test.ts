import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import jwt from "jsonwebtoken";

const dotenv = require("dotenv") as typeof import("dotenv");
dotenv.config();

const testDatabaseUrl = process.env.DINING_POS_PICKUP_TEST_DATABASE_URL;
if (!testDatabaseUrl) {
  throw new Error("DINING_POS_PICKUP_TEST_DATABASE_URL must point to an isolated restored test database.");
}

const testDatabaseName = new URL(testDatabaseUrl).pathname.slice(1);
if (!/^katana_sushi_dev_step4_6_/.test(testDatabaseName)) {
  throw new Error("Pickup POS integration tests only run on a restored Step 4.6 test copy.");
}

process.env.DATABASE_URL = testDatabaseUrl;
const { app, prisma } = require("../app") as typeof import("../app");
const { checkDatabaseHealth } = require("../lib/database") as typeof import("../lib/database");

let server: ReturnType<typeof app.listen>;
let baseUrl = "";
let adminToken = "";
let cashierToken = "";
let chefToken = "";
let fixtureSequence = 0;
const testRunKey = Date.now().toString(36);

function tokenFor(user: { id: string; email: string; role: string }) {
  const secret = process.env.JWT_SECRET;
  assert.ok(secret, "JWT_SECRET must be configured for route authorization tests.");
  return "Bear" + "er " + jwt.sign({ sub: user.id, email: user.email, role: user.role }, secret.trim());
}

async function request(
  path: string,
  options: { method?: string; body?: unknown; token?: string } = {}
) {
  return fetch(`${baseUrl}${path}`, {
    method: options.method ?? "POST",
    headers: {
      ...(options.token ? { Authorization: options.token } : {}),
      ...(options.body === undefined ? {} : { "Content-Type": "application/json" })
    },
    ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) })
  });
}

async function createOrder(input: {
  name: string;
  status: string;
  paymentStatus: string;
}): Promise<{
  orderNumber: string;
  stockBefore: number;
  materialId: string;
  productId: string;
}> {
  fixtureSequence += 1;
  const suffix = `${testRunKey}-${fixtureSequence}`;
  const stockBefore = 20;
  const material = await prisma.rawMaterial.create({
    data: {
      name: `Phase 4 Pickup Material ${suffix}`,
      category: "Phase 4 Test",
      unit: "g",
      current_stock: BigInt(stockBefore),
      reorder_level: 0n,
      cost_per_unit: 1
    }
  });
  await prisma.materialBatch.create({
    data: {
      raw_material_id: material.id,
      batch_number: `PICKUP-${suffix}`,
      quantity: BigInt(stockBefore),
      remaining_quantity: BigInt(stockBefore)
    }
  });
  const product = await prisma.sellingProduct.create({
    data: {
      name: `Phase 4 Pickup Product ${suffix}`,
      category: "Food",
      price: 10,
      is_available: true,
      is_deleted: false,
      is_sold_a_la_carte: true,
      recipes: {
        create: {
          total_yield_quantity: 1n,
          yield_unit: "portion",
          recipe_ingredients: {
            create: {
              raw_material_id: material.id,
              quantity_per_yield: 2n,
              unit: "g"
            }
          }
        }
      }
    }
  });
  const orderNumber = `KTO-PHASE4-${suffix}`;
  await prisma.takeoutOrder.create({
    data: {
      order_number: orderNumber,
      idempotency_key: `phase4-pickup-${suffix}`,
      customer_name: input.name,
      customer_phone: "09123456789",
      status: input.status,
      payment_plan: "pay_at_pickup",
      payment_status: input.paymentStatus,
      payment_method: null,
      subtotal: 20,
      total: 20,
      items: {
        create: {
          selling_product_id: product.id,
          name_snapshot: product.name,
          quantity: 2,
          unit_price: 10,
          total_price: 20
        }
      }
    }
  });

  return {
    orderNumber,
    stockBefore,
    materialId: material.id,
    productId: product.id
  };
}

before(async () => {
  await checkDatabaseHealth();
  const cashier = await prisma.user.create({
    data: {
      email: `phase4-cashier-${testRunKey}@example.invalid`,
      name: "Phase 4 Test Cashier",
      password_hash: "integration-test",
      role: "cashier"
    }
  });
  const admin = await prisma.user.create({
    data: {
      email: `phase4-admin-${testRunKey}@example.invalid`,
      name: "Phase 4 Test Admin",
      password_hash: "integration-test",
      role: "admin"
    }
  });
  const chef = await prisma.user.create({
    data: {
      email: `phase4-chef-${testRunKey}@example.invalid`,
      name: "Phase 4 Test Chef",
      password_hash: "integration-test",
      role: "chef"
    }
  });
  cashierToken = tokenFor(cashier);
  adminToken = tokenFor(admin);
  chefToken = tokenFor(chef);
  server = app.listen(0);
  await new Promise<void>((resolve) => server.once("listening", resolve));
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  baseUrl = `http://127.0.0.1:${address.port}`;
});

after(async () => {
  if (server) {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => error ? reject(error) : resolve());
    });
  }
  await prisma.$disconnect();
});

test("new pickup orders do not lock stock and online payment is rejected", async () => {
  const fixture = await createOrder({
    name: `Order Creation Fixture ${testRunKey}`,
    status: "pending_approval",
    paymentStatus: "unpaid"
  });
  const accepted = await request("/api/takeout/orders", {
    body: {
      customer_name: `New Pickup ${testRunKey}`,
      customer_phone: "09123456789",
      payment_plan: "pay_at_pickup",
      idempotency_key: `phase4-pickup-submit-${testRunKey}`,
      items: [{ product_id: fixture.productId, quantity: 1 }]
    }
  });
  assert.equal(accepted.status, 201, await accepted.clone().text());
  const acceptedBody = await accepted.json() as {
    order: { order_number: string; status: string; payment_status: string; ready_at: string | null };
    payment: unknown;
  };
  assert.equal(acceptedBody.order.status, "pending_approval");
  assert.equal(acceptedBody.order.payment_status, "unpaid");
  assert.equal(acceptedBody.order.ready_at, null);
  assert.equal(acceptedBody.payment, null);
  assert.equal(await prisma.takeoutIngredientLock.count({
    where: { order: { order_number: acceptedBody.order.order_number }, is_released: false }
  }), 0);
  assert.equal(await prisma.inventoryMovement.count({
    where: { source_reference: acceptedBody.order.order_number, action: "Reserved" }
  }), 0);

  const onlineOrder = await request("/api/takeout/orders", {
    body: {
      customer_name: `Online Pickup ${testRunKey}`,
      customer_phone: "09123456789",
      payment_plan: "pay_now",
      payment_method: "gcash",
      idempotency_key: `phase4-pickup-online-${testRunKey}`,
      items: [{ product_id: fixture.productId, quantity: 1 }]
    }
  });
  assert.equal(onlineOrder.status, 400);

  const intent = await request("/api/payments/create-intent", {
    body: {
      amount: 10,
      paymentMethod: "gcash",
      bookingId: acceptedBody.order.order_number,
      reservationType: "takeout"
    }
  });
  assert.equal(intent.status, 400);
});

test("declining a pending pickup order leaves stock untouched", async () => {
  const fixture = await createOrder({
    name: `Declined Pickup ${testRunKey}`,
    status: "pending_approval",
    paymentStatus: "unpaid"
  });
  const path = `/api/admin/takeout/orders/${encodeURIComponent(fixture.orderNumber)}/status`;
  const response = await request(path, {
    method: "PATCH",
    body: { status: "declined" },
    token: cashierToken
  });
  assert.equal(response.status, 200, await response.clone().text());
  assert.equal((await prisma.takeoutOrder.findUniqueOrThrow({
    where: { order_number: fixture.orderNumber }
  })).status, "declined");
  assert.equal(await prisma.takeoutIngredientLock.count({
    where: { order: { order_number: fixture.orderNumber } }
  }), 0);
  assert.equal(Number((await prisma.rawMaterial.findUniqueOrThrow({
    where: { id: fixture.materialId },
    select: { current_stock: true }
  })).current_stock), fixture.stockBefore);
  assert.equal(await prisma.inventoryMovement.count({
    where: { source_reference: fixture.orderNumber }
  }), 0);
});

test("POS pickup search is cashier-only, uses order ID, and includes Preparing and Ready", async () => {
  const ready = await createOrder({
    name: `Ready Search Pickup ${testRunKey}`,
    status: "ready",
    paymentStatus: "unpaid"
  });
  const preparing = await createOrder({
    name: `Preparing Search Pickup ${testRunKey}`,
    status: "preparing",
    paymentStatus: "unpaid"
  });

  const anonymous = await request(`/api/pos/pickup-orders?orderId=${encodeURIComponent(ready.orderNumber)}`, { method: "GET" });
  assert.equal(anonymous.status, 401);

  const chef = await request(`/api/pos/pickup-orders?orderId=${encodeURIComponent(ready.orderNumber)}`, {
    method: "GET",
    token: chefToken
  });
  assert.equal(chef.status, 403);

  const tooShort = await request("/api/pos/pickup-orders?orderId=S", {
    method: "GET",
    token: cashierToken
  });
  assert.deepEqual((await tooShort.json() as { orders: unknown[] }).orders, []);

  const response = await request(`/api/pos/pickup-orders?orderId=${encodeURIComponent(ready.orderNumber)}`, {
    method: "GET",
    token: cashierToken
  });
  assert.equal(response.status, 200);
  const result = await response.json() as { orders: Array<{ order_number: string; status: string; pickup_time: string | null }> };
  assert.deepEqual(result.orders.map((order) => order.order_number), [ready.orderNumber]);
  assert.equal(result.orders[0].status, "ready");

  const preparingResponse = await request(`/api/pos/pickup-orders?orderId=${encodeURIComponent(preparing.orderNumber)}`, {
    method: "GET",
    token: cashierToken
  });
  assert.equal(preparingResponse.status, 200);
  const preparingResult = await preparingResponse.json() as { orders: Array<{ order_number: string; status: string }> };
  assert.deepEqual(preparingResult.orders.map((order) => order.order_number), [preparing.orderNumber]);
  assert.equal(preparingResult.orders[0].status, "preparing");

  const adminResponse = await request(`/api/pos/pickup-orders?orderId=${encodeURIComponent(ready.orderNumber)}`, {
    method: "GET",
    token: adminToken
  });
  assert.equal(adminResponse.status, 200);
});

test("cash checkout deducts approved stock exactly once from Preparing and Ready", async () => {
  for (const checkoutStatus of ["preparing", "ready"] as const) {
    const fixture = await createOrder({
      name: `${checkoutStatus} Pickup ${testRunKey}`,
      status: "pending_approval",
      paymentStatus: "unpaid"
    });
    const statusPath = `/api/admin/takeout/orders/${encodeURIComponent(fixture.orderNumber)}/status`;
    const approval = await request(statusPath, {
      method: "PATCH",
      body: { status: "preparing" },
      token: cashierToken
    });
    assert.equal(approval.status, 200, await approval.clone().text());
    assert.equal((await approval.json() as { order: { status: string } }).order.status, "preparing");

    const lock = await prisma.takeoutIngredientLock.findFirstOrThrow({
      where: { order: { order_number: fixture.orderNumber }, is_released: false }
    });
    assert.equal(Number(lock.reserved_quantity), 4);
    assert.equal(await prisma.inventoryMovement.count({
      where: { source_reference: fixture.orderNumber, source_type: "takeout", action: "Reserved" }
    }), 1);

    if (checkoutStatus === "ready") {
      const beforeReady = Date.now();
      const readyResponse = await request(statusPath, {
        method: "PATCH",
        body: { status: "ready" },
        token: cashierToken
      });
      assert.equal(readyResponse.status, 200, await readyResponse.clone().text());
      const readyOrder = await readyResponse.json() as { order: { status: string; ready_at: string } };
      assert.equal(readyOrder.order.status, "ready");
      assert.ok(Date.parse(readyOrder.order.ready_at) >= beforeReady);
      assert.equal(
        (await prisma.takeoutOrder.findUniqueOrThrow({ where: { order_number: fixture.orderNumber } })).ready_at?.toISOString(),
        readyOrder.order.ready_at
      );
    } else {
      assert.equal(
        (await prisma.takeoutOrder.findUniqueOrThrow({ where: { order_number: fixture.orderNumber } })).ready_at,
        null
      );
    }

    const path = `/api/pos/pickup-orders/${encodeURIComponent(fixture.orderNumber)}/complete`;
    const chefCheckout = await request(path, {
      body: { paymentMethod: "cash", cashReceived: 25 },
      token: chefToken
    });
    assert.equal(chefCheckout.status, 403);
    const noPayment = await request(path, { body: {}, token: cashierToken });
    assert.equal(noPayment.status, 400);
    const insufficientCash = await request(path, {
      body: { paymentMethod: "cash", cashReceived: 19.99 },
      token: cashierToken
    });
    assert.equal(insufficientCash.status, 400);

    const responses = await Promise.all([
      request(path, { body: { paymentMethod: "cash", cashReceived: 25 }, token: cashierToken }),
      request(path, { body: { paymentMethod: "cash", cashReceived: 25 }, token: cashierToken })
    ]);
    assert.deepEqual(responses.map((response) => response.status).sort(), [200, 409]);
    const completedResponse = responses.find((response) => response.status === 200);
    assert.ok(completedResponse);
    assert.equal((await completedResponse.json() as { order: { status: string } }).order.status, "completed");
    const [order, material, batch, updatedLock, transaction] = await Promise.all([
      prisma.takeoutOrder.findUniqueOrThrow({ where: { order_number: fixture.orderNumber } }),
      prisma.rawMaterial.findUniqueOrThrow({ where: { id: fixture.materialId } }),
      prisma.materialBatch.findFirstOrThrow({ where: { raw_material_id: fixture.materialId } }),
      prisma.takeoutIngredientLock.findUniqueOrThrow({ where: { id: lock.id } }),
      prisma.posTransaction.findFirstOrThrow({
        where: { transaction_type: "takeout", items: { some: { selling_product_id: fixture.productId } } },
        include: { items: true }
      })
    ]);
    assert.equal(order.status, "released");
    assert.equal(order.payment_status, "paid");
    assert.equal(order.payment_method, "cash");
    assert.equal(transaction.transaction_type, "takeout");
    assert.equal(transaction.payment_method, "cash");
    assert.equal(transaction.cash_received, 25);
    assert.equal(transaction.change_due, 5);
    assert.equal(transaction.items.length, 1);
    assert.equal(transaction.items[0].name_snapshot?.includes("Phase 4 Pickup Product"), true);
    assert.equal(Number(material.current_stock), fixture.stockBefore - 4);
    assert.equal(Number(batch.remaining_quantity), fixture.stockBefore - 4);
    assert.equal(updatedLock.is_released, true);
    assert.equal(await prisma.inventoryMovement.count({
      where: { source_reference: transaction.transaction_number, source_type: "POS", action: "Used" }
    }), 1);

    const retry = await request(path, {
      body: { paymentMethod: "cash", cashReceived: 25 },
      token: cashierToken
    });
    assert.equal(retry.status, 409);
    assert.equal(Number((await prisma.rawMaterial.findUniqueOrThrow({
      where: { id: fixture.materialId },
      select: { current_stock: true }
    })).current_stock), fixture.stockBefore - 4);
    assert.equal(await prisma.inventoryMovement.count({
      where: { source_reference: transaction.transaction_number, source_type: "POS", action: "Used" }
    }), 1);
    assert.equal(await prisma.posTransaction.count({
      where: { transaction_number: transaction.transaction_number }
    }), 1);
  }
});

test("staff approval starts preparation and staff cannot complete pickup handover", async () => {
  const fixture = await createOrder({
    name: `Approval Pickup ${testRunKey}`,
    status: "pending_approval",
    paymentStatus: "unpaid"
  });
  const statusPath = `/api/admin/takeout/orders/${encodeURIComponent(fixture.orderNumber)}/status`;

  const approval = await request(statusPath, {
    method: "PATCH",
    body: { status: "preparing" },
    token: cashierToken
  });
  assert.equal(approval.status, 200, await approval.clone().text());

  const ready = await request(statusPath, {
    method: "PATCH",
    body: { status: "ready" },
    token: cashierToken
  });
  assert.equal(ready.status, 200, await ready.clone().text());

  const directHandover = await request(statusPath, {
    method: "PATCH",
    body: { status: "released" },
    token: cashierToken
  });
  assert.equal(directHandover.status, 400);
  assert.equal((await prisma.takeoutOrder.findUniqueOrThrow({
    where: { order_number: fixture.orderNumber }
  })).status, "ready");
});

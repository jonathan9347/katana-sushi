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
  paymentPlan: "pay_now" | "pay_at_pickup";
  paymentStatus: string;
  paymentMethod?: string;
}): Promise<{
  orderNumber: string;
  stockBefore: number;
  materialId: string;
  productId: string;
  lockId: string;
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
  const order = await prisma.takeoutOrder.create({
    data: {
      order_number: orderNumber,
      idempotency_key: `phase4-pickup-${suffix}`,
      customer_name: input.name,
      customer_phone: "09123456789",
      status: input.status,
      payment_plan: input.paymentPlan,
      payment_status: input.paymentStatus,
      payment_method: input.paymentMethod ?? null,
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
      },
      ingredient_locks: {
        create: {
          raw_material_id: material.id,
          reserved_quantity: 4n,
          unit: "g"
        }
      }
    },
    include: { ingredient_locks: true }
  });

  return {
    orderNumber,
    stockBefore,
    materialId: material.id,
    productId: product.id,
    lockId: order.ingredient_locks[0].id
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

test("POS pickup search is cashier-only and returns only ready, payable orders", async () => {
  const name = `Search Pickup ${testRunKey}`;
  const ready = await createOrder({
    name,
    status: "ready",
    paymentPlan: "pay_at_pickup",
    paymentStatus: "unpaid"
  });
  await createOrder({
    name,
    status: "preparing",
    paymentPlan: "pay_at_pickup",
    paymentStatus: "unpaid"
  });
  await createOrder({
    name,
    status: "ready",
    paymentPlan: "pay_now",
    paymentStatus: "pending"
  });

  const anonymous = await request(`/api/pos/pickup-orders?name=${encodeURIComponent(name)}`, { method: "GET" });
  assert.equal(anonymous.status, 401);

  const chef = await request(`/api/pos/pickup-orders?name=${encodeURIComponent(name)}`, {
    method: "GET",
    token: chefToken
  });
  assert.equal(chef.status, 403);

  const tooShort = await request("/api/pos/pickup-orders?name=S", {
    method: "GET",
    token: cashierToken
  });
  assert.deepEqual((await tooShort.json() as { orders: unknown[] }).orders, []);

  const response = await request(`/api/pos/pickup-orders?name=${encodeURIComponent(name.toLowerCase())}`, {
    method: "GET",
    token: cashierToken
  });
  assert.equal(response.status, 200);
  const result = await response.json() as { orders: Array<{ order_number: string; status: string }> };
  assert.deepEqual(result.orders.map((order) => order.order_number), [ready.orderNumber]);
  assert.equal(result.orders[0].status, "ready");

  const adminResponse = await request(`/api/pos/pickup-orders?name=${encodeURIComponent(name)}`, {
    method: "GET",
    token: adminToken
  });
  assert.equal(adminResponse.status, 200);
});

test("unpaid ready pickup order is paid and stock is deducted once at POS completion", async () => {
  const fixture = await createOrder({
    name: `Unpaid Pickup ${testRunKey}`,
    status: "ready",
    paymentPlan: "pay_at_pickup",
    paymentStatus: "unpaid"
  });
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
  const [order, material, batch, lock, transaction] = await Promise.all([
    prisma.takeoutOrder.findUniqueOrThrow({ where: { order_number: fixture.orderNumber } }),
    prisma.rawMaterial.findUniqueOrThrow({ where: { id: fixture.materialId } }),
    prisma.materialBatch.findFirstOrThrow({ where: { raw_material_id: fixture.materialId } }),
    prisma.takeoutIngredientLock.findUniqueOrThrow({ where: { id: fixture.lockId } }),
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
  assert.equal(lock.is_released, true);
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

  const refund = await request(`/api/pos/refund/${transaction.id}`, {
    method: "POST",
    body: {},
    token: adminToken
  });
  assert.equal(refund.status, 200, await refund.clone().text());
  assert.equal(Number((await prisma.rawMaterial.findUniqueOrThrow({
    where: { id: fixture.materialId },
    select: { current_stock: true }
  })).current_stock), fixture.stockBefore);
  assert.equal(await prisma.inventoryMovement.count({
    where: {
      source_reference: transaction.transaction_number,
      source_type: "POS",
      action: "Adjusted"
    }
  }), 1);
});

test("online-paid ready pickup order completes without collecting payment again", async () => {
  const fixture = await createOrder({
    name: `Paid Pickup ${testRunKey}`,
    status: "ready",
    paymentPlan: "pay_now",
    paymentStatus: "paid",
    paymentMethod: "gcash"
  });
  const response = await request(
    `/api/pos/pickup-orders/${encodeURIComponent(fixture.orderNumber)}/complete`,
    { body: {}, token: cashierToken }
  );
  assert.equal(response.status, 200, await response.clone().text());
  assert.equal((await response.json() as { order: { status: string } }).order.status, "completed");

  const [order, material, transaction] = await Promise.all([
    prisma.takeoutOrder.findUniqueOrThrow({ where: { order_number: fixture.orderNumber } }),
    prisma.rawMaterial.findUniqueOrThrow({ where: { id: fixture.materialId } }),
    prisma.posTransaction.findFirstOrThrow({
      where: { transaction_type: "takeout", items: { some: { selling_product_id: fixture.productId } } }
    })
  ]);
  assert.equal(order.status, "released");
  assert.equal(order.payment_status, "paid");
  assert.equal(order.payment_method, "gcash");
  assert.equal(transaction.payment_method, "gcash");
  assert.equal(transaction.cash_received, null);
  assert.equal(transaction.change_due, null);
  assert.equal(Number(material.current_stock), fixture.stockBefore - 4);

  const duplicatePayment = await request(
    `/api/pos/pickup-orders/${encodeURIComponent(fixture.orderNumber)}/complete`,
    { body: { paymentMethod: "cash", cashReceived: 20 }, token: cashierToken }
  );
  assert.equal(duplicatePayment.status, 409);
  assert.equal(Number((await prisma.rawMaterial.findUniqueOrThrow({
    where: { id: fixture.materialId },
    select: { current_stock: true }
  })).current_stock), fixture.stockBefore - 4);
  assert.equal(await prisma.posTransaction.count({
    where: { transaction_number: transaction.transaction_number }
  }), 1);
});

test("staff approval starts preparation and staff cannot complete pickup handover", async () => {
  const fixture = await createOrder({
    name: `Approval Pickup ${testRunKey}`,
    status: "pending_approval",
    paymentPlan: "pay_at_pickup",
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

import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import path from "node:path";
import jwt from "jsonwebtoken";

const dotenv = require("dotenv") as typeof import("dotenv");
dotenv.config({ path: path.resolve(__dirname, "..", "..", ".env") });
process.env.NODE_ENV = "test";
process.env.SEND_EMAILS_IN_DEVELOPMENT = "false";

const expectedDatabaseName = "katana_sushi_dev_step4_7_phase2_pos_test";
const testDatabaseUrl = process.env.CATERING_LIFECYCLE_TEST_DATABASE_URL;
if (!testDatabaseUrl) {
  throw new Error("CATERING_LIFECYCLE_TEST_DATABASE_URL must target the approved catering test copy.");
}

const testDatabase = new URL(testDatabaseUrl);
if (
  testDatabase.hostname !== "localhost" ||
  testDatabase.port !== "5433" ||
  testDatabase.pathname.slice(1) !== expectedDatabaseName
) {
  throw new Error("Catering lifecycle integration tests only run on the approved local test copy.");
}

process.env.DATABASE_URL = testDatabaseUrl;
process.env.DIRECT_URL = testDatabaseUrl;

const { app, prisma } = require("../app") as typeof import("../app");
const { checkDatabaseHealth } = require("../lib/database") as typeof import("../lib/database");

let server: ReturnType<typeof app.listen>;
let baseUrl = "";
let authorization = "";
let fixtureSequence = 0;
const testRunId = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
const createdReservationReferences: string[] = [];
const createdMaterialIds: string[] = [];
const createdPackageIds: string[] = [];
const createdProductIds: string[] = [];
const createdPaymentIntentReferences: string[] = [];

function nextFixtureId() {
  fixtureSequence += 1;
  return `catering-lifecycle-${testRunId}-${fixtureSequence}`;
}

async function request(
  pathName: string,
  options: { method?: string; body?: unknown; authorized?: boolean } = {}
) {
  return fetch(`${baseUrl}${pathName}`, {
    method: options.method ?? "PUT",
    headers: {
      ...(options.authorized === false ? {} : { Authorization: authorization }),
      ...(options.body === undefined ? {} : { "Content-Type": "application/json" })
    },
    ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) })
  });
}

async function createReservation(input: {
  status: string;
  paidAmount?: number;
  totalPrice?: number;
}) {
  const fixtureId = nextFixtureId();
  const reservationId = `CAT-${fixtureId}`;
  const fullyPaid = Boolean(input.paidAmount) && input.paidAmount === input.totalPrice;
  createdReservationReferences.push(reservationId);
  const reservation = await prisma.cateringReservation.create({
    data: {
      reservation_id: reservationId,
      customer_name: "Catering lifecycle integration fixture",
      customer_phone: "09000000000",
      customer_email: `${fixtureId}@example.invalid`,
      event_date: new Date(),
      package_total: input.totalPrice ?? 0,
      total_price: input.totalPrice ?? 0,
      payment_plan: input.paidAmount ? fullyPaid ? "full_payment" : "downpayment" : "pay_at_venue",
      downpayment_percent: input.paidAmount ? fullyPaid ? 100 : 50 : 0,
      downpayment_amount: input.paidAmount ?? 0,
      downpayment_status: input.paidAmount ? "paid" : "pending",
      full_payment_paid: fullyPaid,
      remaining_balance: Math.max((input.totalPrice ?? 0) - (input.paidAmount ?? 0), 0),
      final_payment_status: fullyPaid ? "paid" : "pending",
      status: input.status,
      ingredients_locked: true
    }
  });
  if (input.paidAmount) {
    await prisma.reservationPayment.create({
      data: {
        catering_reservation_id: reservation.id,
        payment_stage: fullyPaid ? "full_payment" : "downpayment",
        method: "cash",
        amount: input.paidAmount,
        source: "staff"
      }
    });
  }

  return reservation;
}

async function createMaterialLock(reservationId: string) {
  const fixtureId = nextFixtureId();
  const material = await prisma.rawMaterial.create({
    data: {
      name: `Catering lifecycle material ${fixtureId}`,
      category: "Integration Test",
      unit: "g",
      current_stock: 20n,
      reorder_level: 0n,
      cost_per_unit: 1
    }
  });
  createdMaterialIds.push(material.id);
  const batch = await prisma.materialBatch.create({
    data: {
      raw_material_id: material.id,
      batch_number: `CAT-LIFECYCLE-${fixtureId}`,
      quantity: 20n,
      remaining_quantity: 20n
    }
  });
  const lock = await prisma.cateringIngredientLock.create({
    data: {
      catering_reservation_id: reservationId,
      raw_material_id: material.id,
      reserved_quantity: 4n,
      unit: "g"
    }
  });
  return { material, batch, lock };
}

async function createSushiPackageFixture(stockQuantity: bigint) {
  const fixtureId = nextFixtureId();
  const material = await prisma.rawMaterial.create({
    data: {
      name: `Catering lifecycle material ${fixtureId}`,
      category: "Integration Test",
      unit: "g",
      current_stock: stockQuantity,
      reorder_level: 0n,
      cost_per_unit: 1
    }
  });
  createdMaterialIds.push(material.id);
  await prisma.materialBatch.create({
    data: {
      raw_material_id: material.id,
      batch_number: `CAT-LIFECYCLE-${fixtureId}`,
      quantity: stockQuantity,
      remaining_quantity: stockQuantity
    }
  });
  const productNames = Array.from({ length: 9 }, (_, index) => `Catering lifecycle product ${fixtureId} ${index + 1}`);
  const products = await Promise.all(productNames.map((name) => prisma.sellingProduct.create({
    data: {
      name,
      category: "Integration Test",
      price: 50,
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
  })));
  createdProductIds.push(...products.map((product) => product.id));
  const stationPackage = await prisma.cateringPackage.create({
    data: {
      name: `Catering lifecycle package ${fixtureId}`,
      stationType: "sushi_station",
      isActive: true,
      pricePerPerson: 50,
      minPax: 2,
      maxPax: 20,
      items: { inclusions: productNames }
    }
  });
  createdPackageIds.push(stationPackage.id);
  return { fixtureId, material, product: products[0], stationPackage };
}

async function createPendingSushiReservation(packageId: string, fixtureId: string) {
  const reservationId = `CAT-${fixtureId}`;
  createdReservationReferences.push(reservationId);
  return prisma.cateringReservation.create({
    data: {
      reservation_id: reservationId,
      customer_name: "Catering lifecycle approval fixture",
      customer_phone: "09000000000",
      customer_email: `${fixtureId}@example.invalid`,
      event_date: new Date(),
      headcount: 2,
      package_id: packageId,
      package_ids: [packageId],
      package_snapshot: [{ packageId, stationType: "sushi_station", quantity: 2 }],
      package_total: 100,
      total_price: 100,
      payment_plan: "pay_at_venue",
      status: "pending_approval"
    }
  });
}

function manilaDateAfter(days: number) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Manila",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).format(new Date()).split("-").map(Number);
  const date = new Date(Date.UTC(parts[0], parts[1] - 1, parts[2] + days));
  return date.toISOString().slice(0, 10);
}

async function createVerifiedPaymentIntent(input: {
  reservationId: string;
  amount: number;
  purpose: "downpayment" | "full_payment";
}) {
  const fixtureId = nextFixtureId();
  const referenceId = `catering-lifecycle-payment-${fixtureId}`;
  createdPaymentIntentReferences.push(referenceId);
  await prisma.paymentIntent.create({
    data: {
      reference_id: referenceId,
      booking_id: input.reservationId,
      purpose: input.purpose,
      idempotency_key: referenceId,
      amount: input.amount,
      payment_method: "gcash",
      reservation_type: "catering",
      status: "succeeded",
      transaction_id: `txn-${fixtureId}`,
      paid_at: new Date()
    }
  });
  return `txn-${fixtureId}`;
}

before(async () => {
  const database = await prisma.$queryRaw<Array<{ name: string }>>`SELECT current_database() AS name`;
  assert.equal(database[0]?.name, expectedDatabaseName, "Tests must connect to the approved catering test copy.");
  assert.equal(await checkDatabaseHealth(), true, "The approved catering test copy must be reachable.");

  const admin = await prisma.user.findFirst({
    where: { role: "admin", is_active: true },
    select: { id: true, email: true }
  });
  assert.ok(admin, "The approved test copy must contain an active admin account.");
  const secret = process.env.JWT_SECRET?.trim();
  assert.ok(secret, "JWT_SECRET must be configured for staff route authorization tests.");
  authorization = `Bearer ${jwt.sign(
    { sub: admin.id, email: admin.email, role: "admin" },
    secret
  )}`;

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
    await new Promise<void>((resolve, reject) => {
      server.close((error) => error ? reject(error) : resolve());
    });
  }

  const reservations = createdReservationReferences.length > 0
    ? await prisma.cateringReservation.findMany({
      where: { reservation_id: { in: createdReservationReferences } },
      select: { id: true, inquiry_id: true }
    })
    : [];
  if (reservations.length > 0) {
    await prisma.cateringReservation.deleteMany({
      where: { id: { in: reservations.map((reservation) => reservation.id) } }
    });
    const inquiryIds = reservations.flatMap((reservation) => reservation.inquiry_id ? [reservation.inquiry_id] : []);
    if (inquiryIds.length > 0) {
      await prisma.cateringInquiry.deleteMany({ where: { id: { in: inquiryIds } } });
    }
  }
  if (createdPaymentIntentReferences.length > 0) {
    await prisma.paymentIntent.deleteMany({
      where: { reference_id: { in: createdPaymentIntentReferences } }
    });
  }
  if (createdPackageIds.length > 0) {
    await prisma.cateringPackage.deleteMany({
      where: { id: { in: createdPackageIds } }
    });
  }
  if (createdProductIds.length > 0) {
    await prisma.sellingProduct.deleteMany({
      where: { id: { in: createdProductIds } }
    });
  }
  if (createdMaterialIds.length > 0) {
    // Inventory movements are append-only, so archive fixture materials without deleting their audit trail.
    await prisma.rawMaterial.updateMany({
      where: { id: { in: createdMaterialIds } },
      data: { is_deleted: true }
    });
  }
  await prisma.$disconnect();
});

test("catering booking verifies 50% downpayments and 100% full payments", async () => {
  const packageId = "pkg_whole_tuna";
  const eventDate = manilaDateAfter(2);

  for (const plan of [
    { paymentPlan: "downpayment" as const, purpose: "downpayment" as const, amount: 12000, remaining: 12000 },
    { paymentPlan: "full_payment" as const, purpose: "full_payment" as const, amount: 24000, remaining: 0 }
  ]) {
    const fixtureId = nextFixtureId();
    const reservationId = `CAT-${fixtureId}`;
    createdReservationReferences.push(reservationId);
    const transactionId = await createVerifiedPaymentIntent({
      reservationId,
      amount: plan.amount,
      purpose: plan.purpose
    });
    const response = await request("/api/catering/reservations", {
      method: "POST",
      authorized: false,
      body: {
        customer_name: `Catering lifecycle ${fixtureId}`,
        customer_phone: `09${String(100000000 + fixtureSequence).slice(-9)}`,
        customer_email: `${fixtureId}@example.invalid`,
        event_date: eventDate,
        event_time: "12:00",
        venue_address: "Integration Test Venue",
        event_type: "Birthday",
        package_id: packageId,
        package_ids: [packageId],
        package_quantities: { [packageId]: 20 },
        payment_plan: plan.paymentPlan,
        payment_method: "gcash",
        payment_transaction_id: transactionId,
        reservation_id: reservationId
      }
    });
    assert.equal(response.status, 201, await response.clone().text());

    const [reservation, payment] = await Promise.all([
      prisma.cateringReservation.findUniqueOrThrow({ where: { reservation_id: reservationId } }),
      prisma.reservationPayment.findFirstOrThrow({
        where: { catering_reservation: { reservation_id: reservationId } }
      })
    ]);
    assert.equal(Number(reservation.downpayment_amount), plan.amount);
    assert.equal(Number(reservation.remaining_balance), plan.remaining);
    assert.equal(reservation.full_payment_paid, plan.remaining === 0);
    assert.equal(payment.payment_stage, plan.purpose);
    assert.equal(Number(payment.amount), plan.amount);
  }
});

test("customers can create repeated catering bookings for the same event details", async () => {
  const eventDate = manilaDateAfter(4);
  const fixtureId = nextFixtureId();
  const customer = {
    customer_name: `Catering repeat ${fixtureId}`,
    customer_phone: `09${String(100000000 + fixtureSequence).slice(-9)}`,
    customer_email: `${fixtureId}@example.invalid`,
    event_date: eventDate,
    event_time: "12:00",
    venue_address: "Integration Test Venue",
    event_type: "Birthday",
    package_id: "pkg_whole_tuna",
    package_ids: ["pkg_whole_tuna"],
    package_quantities: { pkg_whole_tuna: 20 },
    payment_plan: "downpayment" as const,
    payment_method: "gcash" as const
  };

  const bookingIds = [`CAT-${fixtureId}-first`, `CAT-${fixtureId}-second`];
  const responses = await Promise.all(bookingIds.map(async (reservationId) => {
    createdReservationReferences.push(reservationId);
    const paymentTransactionId = await createVerifiedPaymentIntent({
      reservationId,
      amount: 12000,
      purpose: "downpayment"
    });
    return request("/api/catering/reservations", {
      method: "POST",
      authorized: false,
      body: { ...customer, reservation_id: reservationId, payment_transaction_id: paymentTransactionId }
    });
  }));

  assert.deepEqual(responses.map((response) => response.status), [201, 201]);
  await Promise.all(bookingIds.map((reservationId) =>
    prisma.cateringReservation.findUniqueOrThrow({ where: { reservation_id: reservationId } })
  ));
});

test("cancelling before preparation releases locks without consuming stock", async () => {
  const reservation = await createReservation({ status: "confirmed"   });

  test("concurrent catering approvals do not oversell and failed approval rolls back", async () => {
    const fixture = await createSushiPackageFixture(6n);
    const reservations = await Promise.all([
      createPendingSushiReservation(fixture.stationPackage.id, `${fixture.fixtureId}-first`),
      createPendingSushiReservation(fixture.stationPackage.id, `${fixture.fixtureId}-second`)
    ]);
    const approvalResponses = await Promise.all(reservations.map((reservation) =>
      request(`/api/staff/catering/reservations/${reservation.id}/approve`, {
        body: { mobilization_fee: 0 }
      })
    ));
    assert.deepEqual(approvalResponses.map((response) => response.status).sort(), [200, 409]);

    const [updatedReservations, locks, reservedMovements] = await Promise.all([
      prisma.cateringReservation.findMany({
        where: { id: { in: reservations.map((reservation) => reservation.id) } },
        orderBy: { reservation_id: "asc" },
        select: { id: true, status: true }
      }),
      prisma.cateringIngredientLock.findMany({
        where: { catering_reservation_id: { in: reservations.map((reservation) => reservation.id) } }
      }),
      prisma.inventoryMovement.count({
        where: {
          raw_material_id: fixture.material.id,
          source_type: "catering",
          action: "Reserved"
        }
      })
    ]);
    assert.deepEqual(updatedReservations.map((reservation) => reservation.status).sort(), ["confirmed", "pending_approval"]);
    assert.equal(locks.length, 1);
    assert.equal(Number(locks[0].reserved_quantity), 4);
    assert.equal(reservedMovements, 1);
  });
  const { material, lock } = await createMaterialLock(reservation.id);

  const response = await request(`/api/staff/catering/reservations/${reservation.id}/cancel`, {
    body: { reason: "Integration test cancellation before preparation" }
  });
  assert.equal(response.status, 200, await response.clone().text());

  const [updatedMaterial, updatedLock, releasedMovements, wastedMovements] = await Promise.all([
    prisma.rawMaterial.findUniqueOrThrow({ where: { id: material.id } }),
    prisma.cateringIngredientLock.findUniqueOrThrow({ where: { id: lock.id } }),
    prisma.inventoryMovement.count({
      where: { source_reference: reservation.reservation_id, action: "Released" }
    }),
    prisma.inventoryMovement.count({
      where: { source_reference: reservation.reservation_id, action: "Wasted" }
    })
  ]);
  assert.equal(Number(updatedMaterial.current_stock), 20);
  assert.equal(updatedLock.is_released, true);
  assert.equal(releasedMovements, 1);
  assert.equal(wastedMovements, 0);
});

test("cancelling after preparation records remaining locked ingredients as waste", async () => {
  const reservation = await createReservation({ status: "in_progress" });
  const { material, batch, lock } = await createMaterialLock(reservation.id);

  const response = await request(`/api/staff/catering/reservations/${reservation.id}/cancel`, {
    body: { reason: "Integration test cancellation after preparation" }
  });
  assert.equal(response.status, 200, await response.clone().text());

  const [updatedMaterial, updatedBatch, updatedLock, wastedMovements] = await Promise.all([
    prisma.rawMaterial.findUniqueOrThrow({ where: { id: material.id } }),
    prisma.materialBatch.findUniqueOrThrow({ where: { id: batch.id } }),
    prisma.cateringIngredientLock.findUniqueOrThrow({ where: { id: lock.id } }),
    prisma.inventoryMovement.count({
      where: { source_reference: reservation.reservation_id, action: "Wasted" }
    })
  ]);
  assert.equal(Number(updatedMaterial.current_stock), 16);
  assert.equal(Number(updatedBatch.remaining_quantity), 16);
  assert.equal(updatedLock.is_released, true);
  assert.equal(wastedMovements, 1);
});

test("starting a fully paid catering event consumes stock once and completion does not deduct again", async () => {
  const reservation = await createReservation({
    status: "confirmed",
    paidAmount: 100,
    totalPrice: 100
  });
  const { material, batch, lock } = await createMaterialLock(reservation.id);
  const startResponse = await request(`/api/staff/catering/reservations/${reservation.id}/start-event`);
  assert.equal(startResponse.status, 200, await startResponse.clone().text());

  const [startedReservation, startedMaterial, startedBatch, startedLock] = await Promise.all([
    prisma.cateringReservation.findUniqueOrThrow({ where: { id: reservation.id } }),
    prisma.rawMaterial.findUniqueOrThrow({ where: { id: material.id } }),
    prisma.materialBatch.findUniqueOrThrow({ where: { id: batch.id } }),
    prisma.cateringIngredientLock.findUniqueOrThrow({ where: { id: lock.id } })
  ]);
  assert.equal(startedReservation.status, "in_progress");
  assert.equal(startedReservation.ingredients_locked, false);
  assert.equal(Number(startedMaterial.current_stock), 16);
  assert.equal(Number(startedBatch.remaining_quantity), 16);
  assert.equal(startedLock.is_released, true);

  const completeResponse = await request(`/api/staff/catering/reservations/${reservation.id}/complete`);
  assert.equal(completeResponse.status, 200, await completeResponse.clone().text());
  const retryResponse = await request(`/api/staff/catering/reservations/${reservation.id}/start-event`);
  assert.equal(retryResponse.status, 409);

  const [updatedReservation, updatedMaterial, updatedBatch, updatedLock, usedMovements, deductions] = await Promise.all([
    prisma.cateringReservation.findUniqueOrThrow({ where: { id: reservation.id } }),
    prisma.rawMaterial.findUniqueOrThrow({ where: { id: material.id } }),
    prisma.materialBatch.findUniqueOrThrow({ where: { id: batch.id } }),
    prisma.cateringIngredientLock.findUniqueOrThrow({ where: { id: lock.id } }),
    prisma.inventoryMovement.count({
      where: { source_reference: reservation.reservation_id, action: "Used" }
    }),
    prisma.inventoryTransaction.count({
      where: { reference: reservation.reservation_id, transaction_type: "deduct" }
    })
  ]);
  assert.equal(updatedReservation.status, "completed");
  assert.equal(Number(updatedMaterial.current_stock), 16);
  assert.equal(Number(updatedBatch.remaining_quantity), 16);
  assert.equal(updatedLock.is_released, true);
  assert.equal(usedMovements, 1);
  assert.equal(deductions, 1);
});

test("declining a paid catering booking does not create an automatic refund", async () => {
  const reservation = await createReservation({
    status: "pending_approval",
    paidAmount: 500,
    totalPrice: 1000
  });

  const response = await request(`/api/staff/catering/reservations/${reservation.id}/decline`, {
    body: { reason: "Integration test decline; refund remains manual" }
  });
  assert.equal(response.status, 200, await response.clone().text());

  const [updatedReservation, payments] = await Promise.all([
    prisma.cateringReservation.findUniqueOrThrow({ where: { id: reservation.id } }),
    prisma.reservationPayment.findMany({
      where: { catering_reservation_id: reservation.id },
      select: { payment_stage: true, amount: true }
    })
  ]);
  assert.equal(updatedReservation.status, "declined");
  assert.equal(payments.length, 1);
  assert.deepEqual(payments[0], { payment_stage: "downpayment", amount: 500 });
});

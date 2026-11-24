import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import jwt from "jsonwebtoken";

const testDatabaseUrl = process.env.DINING_POS_TEMPORARY_TABLE_TEST_DATABASE_URL;
if (!testDatabaseUrl) {
  throw new Error("DINING_POS_TEMPORARY_TABLE_TEST_DATABASE_URL must point to a fresh restored test database.");
}

const testDatabaseName = new URL(testDatabaseUrl).pathname.slice(1);
if (!testDatabaseName.startsWith("katana_sushi_dev_phase2_step3c_")) {
  throw new Error("Temporary-table integration tests only run on a dedicated restored Step 3c test copy.");
}

process.env.DATABASE_URL = testDatabaseUrl;
const dotenv = require("dotenv") as typeof import("dotenv");
dotenv.config();

const { app, prisma } = require("../app") as typeof import("../app");
const { checkDatabaseHealth } = require("../lib/database") as typeof import("../lib/database");

let server: ReturnType<typeof app.listen>;
let baseUrl = "";
let tableIds: string[] = [];
let reservationSequence = 0;

type TestUser = { id: string; email: string; role: string };

function tokenFor(user: TestUser) {
  const secret = process.env.JWT_SECRET;
  assert.ok(secret, "JWT_SECRET must be configured for route authorization tests.");
  return `Bearer ${jwt.sign({ sub: user.id, email: user.email, role: user.role }, secret)}`;
}

function manilaDateOffset(days: number) {
  const today = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Manila",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).format(new Date());
  const base = new Date(`${today}T00:00:00+08:00`);
  base.setUTCDate(base.getUTCDate() + days);
  const dateText = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Manila",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).format(base);
  return { date: new Date(`${dateText}T00:00:00+08:00`), dateText };
}

async function request(
  path: string,
  user?: TestUser,
  body?: unknown,
  method = "POST"
) {
  return fetch(`${baseUrl}${path}`, {
    method,
    headers: {
      ...(user ? { Authorization: tokenFor(user) } : {}),
      ...(body === undefined ? {} : { "Content-Type": "application/json" })
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) })
  });
}

async function getUser(role: string) {
  const user = await prisma.user.findFirst({
    where: { role },
    select: { id: true, email: true, role: true }
  });
  assert.ok(user, `The restored copy must contain a ${role} account.`);
  return user;
}

async function createReservation(tableId: string, partySize: number, dayOffset = 0, status = "confirmed") {
  reservationSequence += 1;
  const unique = `${Date.now()}-${reservationSequence}`;
  const { date } = manilaDateOffset(dayOffset);
  const reservation = await prisma.reservation.create({
    data: {
      booking_id: `TEMP-${unique}`,
      customer_name: `Temporary Table Test ${reservationSequence}`,
      customer_phone: `09${String(Date.now() + reservationSequence).slice(-9)}`,
      customer_email: `temporary-${unique}@example.test`,
      date,
      time: "12:00",
      party_size: partySize,
      status,
      reservation_type: "dine_in"
    }
  });
  await prisma.reservationTableAssignment.create({
    data: {
      reservation_id: reservation.id,
      table_id: tableId,
      seat_count: partySize,
      status: "assigned"
    }
  });
  return reservation;
}

async function setTableState(tableId: string, status: string) {
  await prisma.table.update({
    where: { id: tableId },
    data: {
      status,
      is_archived: false,
      linked_to_table_id: null,
      unavailable_reason: null
    }
  });
}

before(async () => {
  const database = await prisma.$queryRaw<Array<{ name: string }>>`SELECT current_database() AS name`;
  assert.equal(database[0]?.name, testDatabaseName, "Tests must connect to the fresh restored copy.");
  assert.equal(await checkDatabaseHealth(), true, "The restored test database must be reachable.");
  assert.equal(await prisma.reservation.count(), 0, "The fresh restored copy must contain no reservations.");
  assert.equal(
    await prisma.diningTableSession.count({ where: { status: "active" } }),
    0,
    "The fresh restored copy must contain no active dining sessions."
  );
  assert.equal(
    await prisma.table.count({ where: { is_temporary: true } }),
    0,
    "The fresh restored copy must contain no temporary tables."
  );

  const tables = await prisma.table.findMany({
    where: { is_archived: false, is_temporary: false },
    orderBy: [{ table_number: "asc" }, { id: "asc" }],
    take: 10,
    select: { id: true }
  });
  assert.equal(tables.length, 10, "The restored copy must contain at least ten regular tables.");
  tableIds = tables.map((table) => table.id);
  await Promise.all(tableIds.slice(0, 9).map((tableId) => setTableState(tableId, "available")));
  await prisma.table.update({
    where: { id: tableIds[9] },
    data: { table_number: 9000, is_archived: true, status: "unavailable" }
  });

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

test("admin and cashier can create a party-sized temporary table, while other roles cannot", async () => {
  const [admin, cashier, inventoryManager] = await Promise.all([
    getUser("admin"),
    getUser("cashier"),
    getUser("inventory_manager")
  ]);
  const firstReservation = await createReservation(tableIds[0], 5);
  const secondReservation = await createReservation(tableIds[1], 9);
  await setTableState(tableIds[0], "unavailable");
  await setTableState(tableIds[1], "occupied");

  assert.equal(
    (await request(`/api/pos/dining/reservations/${firstReservation.id}/temporary-table`)).status,
    401
  );
  assert.equal(
    (await request(`/api/pos/dining/reservations/${firstReservation.id}/temporary-table`, inventoryManager)).status,
    403
  );

  const adminResponse = await request(
    `/api/pos/dining/reservations/${firstReservation.id}/temporary-table`,
    admin,
    {}
  );
  const adminText = await adminResponse.text();
  assert.equal(adminResponse.status, 201, adminText);
  const adminResult = JSON.parse(adminText) as {
    table: { id: string; table_number: number; capacity: number; is_temporary: boolean };
  };
  assert.equal(adminResult.table.table_number, 9001);
  assert.equal(adminResult.table.capacity, 5);
  assert.equal(adminResult.table.is_temporary, true);

  const cashierResponse = await request(
    `/api/pos/dining/reservations/${secondReservation.id}/temporary-table`,
    cashier,
    {}
  );
  const cashierText = await cashierResponse.text();
  assert.equal(cashierResponse.status, 201, cashierText);
  const cashierResult = JSON.parse(cashierText) as {
    table: { table_number: number; capacity: number; is_temporary: boolean };
  };
  assert.equal(cashierResult.table.table_number, 9002);
  assert.equal(cashierResult.table.capacity, 9);
  assert.equal(cashierResult.table.is_temporary, true);
});

test("refuses temporary-table creation if the assigned tables are available", async () => {
  const admin = await getUser("admin");
  const reservation = await createReservation(tableIds[2], 4);
  await setTableState(tableIds[2], "available");

  const response = await request(
    `/api/pos/dining/reservations/${reservation.id}/temporary-table`,
    admin,
    {}
  );
  assert.equal(response.status, 409);
  assert.match((await response.json() as { message: string }).message, /assigned tables are available/i);
  assert.equal(await prisma.table.count({ where: { is_temporary: true } }), 2);
  assert.equal(
    (await prisma.reservationTableAssignment.findFirstOrThrow({ where: { reservation_id: reservation.id } })).status,
    "assigned"
  );
});

test("concurrent temporary-table requests create one table and switch assignments atomically", async () => {
  const [admin, cashier] = await Promise.all([getUser("admin"), getUser("cashier")]);
  const reservation = await createReservation(tableIds[3], 7);
  await setTableState(tableIds[3], "occupied");

  const responses = await Promise.all([
    request(`/api/pos/dining/reservations/${reservation.id}/temporary-table`, admin, {}),
    request(`/api/pos/dining/reservations/${reservation.id}/temporary-table`, cashier, {})
  ]);
  assert.deepEqual(responses.map((response) => response.status).sort(), [201, 409]);
  const assignments = await prisma.reservationTableAssignment.findMany({
    where: { reservation_id: reservation.id },
    include: { table: true },
    orderBy: { created_at: "asc" }
  });
  assert.equal(assignments.length, 2);
  assert.equal(assignments[0].status, "released");
  assert.equal(assignments[1].status, "seated");
  assert.equal(assignments[1].table.is_temporary, true);
  assert.equal(assignments[1].table.capacity, 7);
  assert.equal(
    await prisma.diningTableSession.count({ where: { table_id: assignments[1].table_id, status: "active" } }),
    1
  );
  assert.equal((await prisma.reservation.findUniqueOrThrow({ where: { id: reservation.id } })).status, "seated");
});

test("temporary assignments are not shown as regular tables or used for customer availability, and archive at checkout", async () => {
  const cashier = await getUser("cashier");
  const reservation = await createReservation(tableIds[4], 8);
  await setTableState(tableIds[4], "unavailable");
  const createResponse = await request(
    `/api/pos/dining/reservations/${reservation.id}/temporary-table`,
    cashier,
    {}
  );
  const createText = await createResponse.text();
  assert.equal(createResponse.status, 201, createText);
  const created = JSON.parse(createText) as {
    table: { id: string; table_number: number };
    session: { id: string };
  };
  assert.equal(created.table.table_number, 9004);

  const stripResponse = await request("/api/pos/dining/upcoming-reservations", cashier, undefined, "GET");
  const stripText = await stripResponse.text();
  assert.equal(stripResponse.status, 200, stripText);
  const strip = JSON.parse(stripText) as {
    reservations: Array<{
      id: string;
      table_numbers: number[];
      temporary_table_numbers: number[];
      state: string;
    }>;
  };
  const stripItem = strip.reservations.find((item) => item.id === reservation.id);
  assert.deepEqual(stripItem?.table_numbers, []);
  assert.deepEqual(stripItem?.temporary_table_numbers, [created.table.table_number]);
  assert.equal(stripItem?.state, "arrived");

  await prisma.table.updateMany({
    where: { is_archived: false, is_temporary: false },
    data: { status: "unavailable", linked_to_table_id: null, unavailable_reason: null }
  });
  const future = manilaDateOffset(2);
  const availabilityResponse = await request(
    `/api/reservations/table-availability?date=${future.dateText}&time=18%3A00&party_size=2`,
    undefined,
    undefined,
    "GET"
  );
  const availabilityText = await availabilityResponse.text();
  assert.equal(availabilityResponse.status, 200, availabilityText);
  assert.equal((JSON.parse(availabilityText) as { availability: string }).availability, "full");

  const checkoutResponse = await request(
    `/api/pos/dining/sessions/${created.session.id}/checkout`,
    cashier,
    { paymentMethod: "cash", cashReceived: 0 }
  );
  const checkoutText = await checkoutResponse.text();
  assert.equal(checkoutResponse.status, 201, checkoutText);
  const [archivedTable, closedSession, retainedAssignments] = await Promise.all([
    prisma.table.findUniqueOrThrow({ where: { id: created.table.id } }),
    prisma.diningTableSession.findUniqueOrThrow({ where: { id: created.session.id } }),
    prisma.reservationTableAssignment.findMany({ where: { reservation_id: reservation.id } })
  ]);
  assert.equal(archivedTable.is_temporary, true);
  assert.equal(archivedTable.is_archived, true);
  assert.equal(archivedTable.status, "unavailable");
  assert.ok(archivedTable.archived_at);
  assert.equal(closedSession.status, "closed");
  assert.equal(retainedAssignments.length, 2);
});

test("refuses cancelled and non-today reservations", async () => {
  const cashier = await getUser("cashier");
  const cancelled = await createReservation(tableIds[5], 3, 0, "cancelled");
  const future = await createReservation(tableIds[6], 3, 1);
  await setTableState(tableIds[5], "occupied");
  await setTableState(tableIds[6], "occupied");

  const cancelledResponse = await request(
    `/api/pos/dining/reservations/${cancelled.id}/temporary-table`,
    cashier,
    {}
  );
  assert.equal(cancelledResponse.status, 409);
  assert.match((await cancelledResponse.json() as { message: string }).message, /cannot use a temporary table/i);

  const futureResponse = await request(
    `/api/pos/dining/reservations/${future.id}/temporary-table`,
    cashier,
    {}
  );
  assert.equal(futureResponse.status, 409);
  assert.match((await futureResponse.json() as { message: string }).message, /only today's reservations/i);
});

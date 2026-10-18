import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import jwt from "jsonwebtoken";

const testDatabaseUrl = process.env.DINING_POS_SEATING_TEST_DATABASE_URL;
if (!testDatabaseUrl) {
  throw new Error("DINING_POS_SEATING_TEST_DATABASE_URL must point to a fresh restored test database.");
}

const testDatabaseName = new URL(testDatabaseUrl).pathname.slice(1);
if (!testDatabaseName.startsWith("katana_sushi_dev_phase2_step3a_")) {
  throw new Error("Dining seating integration tests only run on a dedicated restored Step 3a test copy.");
}

process.env.DATABASE_URL = testDatabaseUrl;
const dotenv = require("dotenv") as typeof import("dotenv");
dotenv.config();

const { app, prisma } = require("../app") as typeof import("../app");
const { checkDatabaseHealth } = require("../lib/database") as typeof import("../lib/database");

let server: ReturnType<typeof app.listen>;
let baseUrl = "";
let tableIds: string[] = [];

type TestUser = { id: string; email: string; role: string };

function tokenFor(user: TestUser) {
  const secret = process.env.JWT_SECRET;
  assert.ok(secret, "JWT_SECRET must be configured for route authorization tests.");
  const token = jwt.sign({ sub: user.id, email: user.email, role: user.role }, secret);
  return `Bearer ${token}`;
}

function manilaDateOffset(days: number) {
  const today = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Manila",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).format(new Date());
  const date = new Date(`${today}T00:00:00+08:00`);
  date.setUTCDate(date.getUTCDate() + days);
  const dateText = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Manila",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).format(date);
  return { date: new Date(`${dateText}T00:00:00+08:00`), dateText };
}

async function request(
  path: string,
  user: TestUser | undefined,
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

async function setTableAvailable(tableId: string, capacity = 1) {
  await prisma.table.update({
    where: { id: tableId },
    data: {
      capacity,
      status: "available",
      linked_to_table_id: null,
      unavailable_reason: null,
      is_archived: false
    }
  });
}

async function createReservation(input: {
  tableIndexes: number[];
  status?: string;
  dayOffset?: number;
  name?: string;
}) {
  const unique = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const { date } = manilaDateOffset(input.dayOffset ?? 0);
  const reservation = await prisma.reservation.create({
    data: {
      booking_id: `SEAT-${unique}`,
      customer_name: input.name ?? `Seating Test ${unique}`,
      customer_phone: "09000000000",
      customer_email: `seating-${unique}@example.test`,
      date,
      time: "00:01",
      party_size: 7,
      status: input.status ?? "confirmed",
      reservation_type: "dine_in"
    }
  });
  await prisma.reservationTableAssignment.createMany({
    data: input.tableIndexes.map((index) => ({
      reservation_id: reservation.id,
      table_id: tableIds[index],
      seat_count: 0,
      status: "assigned"
    }))
  });
  return reservation;
}

before(async () => {
  const database = await prisma.$queryRaw<Array<{ name: string }>>`SELECT current_database() AS name`;
  assert.equal(database[0]?.name, testDatabaseName, "Tests must connect to the new restored copy.");
  assert.equal(await checkDatabaseHealth(), true, "The restored test database must be reachable.");
  assert.equal(
    await prisma.diningTableSession.count({ where: { status: "active" } }),
    0,
    "The fresh restored copy must not contain active dining sessions."
  );
  assert.equal(
    await prisma.reservation.count(),
    0,
    "The fresh restored copy must not contain reservations."
  );

  const tables = await prisma.table.findMany({
    where: { is_archived: false },
    orderBy: [{ table_number: "asc" }, { id: "asc" }],
    take: 10,
    select: { id: true }
  });
  assert.equal(tables.length, 10, "The restored copy must contain ten live tables.");
  tableIds = tables.map((table) => table.id);
  await Promise.all(tableIds.map((tableId) => setTableAvailable(tableId)));

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

async function getUser(role: string) {
  const user = await prisma.user.findFirst({
    where: { role },
    select: { id: true, email: true, role: true }
  });
  assert.ok(user, `The restored copy must contain a ${role} account.`);
  return user;
}

test("walk-in seating requires no guest count and does not enforce table capacity", async () => {
  const [admin, cashier] = await Promise.all([getUser("admin"), getUser("cashier")]);
  const tableId = tableIds[0];
  await setTableAvailable(tableId, 1);

  const response = await request("/api/pos/dining/sessions", cashier, { tableId });
  const text = await response.text();
  assert.equal(response.status, 201, text);
  const payload = JSON.parse(text) as { session: { id: string; guests: unknown[] } };
  assert.deepEqual(payload.session.guests, []);

  const unauthorized = await request("/api/pos/dining/sessions", undefined, { tableId });
  assert.equal(unauthorized.status, 401);
  const inventoryManager = await getUser("inventory_manager");
  assert.equal(
    (await request("/api/pos/dining/sessions", inventoryManager, { tableId: tableIds[1] })).status,
    403
  );

  const secondWalkIn = await request("/api/pos/dining/sessions", admin, { tableId: tableIds[1] });
  assert.equal(secondWalkIn.status, 201, await secondWalkIn.text());
});

test("concurrent walk-in seating of one table creates only one active session", async () => {
  const cashier = await getUser("cashier");
  const tableId = tableIds[2];
  await setTableAvailable(tableId);

  const responses = await Promise.all([
    request("/api/pos/dining/sessions", cashier, { tableId }),
    request("/api/pos/dining/sessions", cashier, { tableId })
  ]);
  const statuses = responses.map((response) => response.status).sort();
  assert.deepEqual(statuses, [201, 409]);
  assert.equal(await prisma.diningTableSession.count({ where: { table_id: tableId, status: "active" } }), 1);
});

test("reserved multi-table seating creates links, marks assignments, clears late alert, and bill-out frees every table", async () => {
  const cashier = await getUser("cashier");
  const [primaryId, linkedId] = [tableIds[3], tableIds[4]];
  await Promise.all([setTableAvailable(primaryId), setTableAvailable(linkedId)]);
  const reservation = await createReservation({
    tableIndexes: [3, 4],
    name: "Multi Table Seating Test"
  });

  const listResponse = await request("/api/pos/dining/upcoming-reservations", cashier, undefined, "GET");
  const listText = await listResponse.text();
  assert.equal(listResponse.status, 200, listText);
  const list = JSON.parse(listText) as {
    reservations: Array<{ id: string; customer_name: string; table_numbers: number[]; state: string }>;
  };
  const listed = list.reservations.find((item) => item.id === reservation.id);
  assert.ok(listed, "Today's assigned reservation should be listed for POS staff.");
  assert.equal(listed.customer_name, "Multi Table Seating Test");
  assert.deepEqual(listed.table_numbers, [
    (await prisma.table.findUniqueOrThrow({ where: { id: primaryId } })).table_number,
    (await prisma.table.findUniqueOrThrow({ where: { id: linkedId } })).table_number
  ]);

  const seatResponse = await request(
    `/api/pos/dining/reservations/${reservation.id}/seat`,
    cashier,
    {}
  );
  const seatText = await seatResponse.text();
  assert.equal(seatResponse.status, 201, seatText);
  const seatedPayload = JSON.parse(seatText) as { session: { id: string; table_id: string; guests: unknown[] } };
  assert.equal(seatedPayload.session.table_id, primaryId);
  assert.deepEqual(seatedPayload.session.guests, []);

  const [savedReservation, primary, linked, assignments] = await Promise.all([
    prisma.reservation.findUniqueOrThrow({ where: { id: reservation.id } }),
    prisma.table.findUniqueOrThrow({ where: { id: primaryId } }),
    prisma.table.findUniqueOrThrow({ where: { id: linkedId } }),
    prisma.reservationTableAssignment.findMany({
      where: { reservation_id: reservation.id },
      orderBy: { table_id: "asc" }
    })
  ]);
  assert.equal(savedReservation.status, "seated");
  assert.equal(primary.status, "occupied");
  assert.equal(linked.status, "unavailable");
  assert.equal(linked.linked_to_table_id, primaryId);
  assert.deepEqual(assignments.map((assignment) => assignment.status), ["seated", "seated"]);

  const posStripResponse = await request("/api/pos/dining/upcoming-reservations", cashier, undefined, "GET");
  const strip = JSON.parse(await posStripResponse.text()) as {
    reservations: Array<{ id: string; state: string; table_numbers: number[] }>;
  };
  const arrivedItem = strip.reservations.find((item) => item.id === reservation.id);
  assert.equal(arrivedItem?.state, "arrived");
  assert.equal(arrivedItem?.table_numbers.length, 2);

  const admin = await getUser("admin");
  const { dateText } = manilaDateOffset(0);
  const reservationsResponse = await request(
    `/api/staff/reservations/all?date=${dateText}`,
    admin,
    undefined,
    "GET"
  );
  const reservationDetails = JSON.parse(await reservationsResponse.text()) as {
    reservations: Array<{ id: string; late_alert?: boolean }>;
  };
  assert.equal(reservationsResponse.status, 200);
  assert.equal(
    reservationDetails.reservations.find((item) => item.id === reservation.id)?.late_alert,
    false
  );

  const checkoutResponse = await request(
    `/api/pos/dining/sessions/${seatedPayload.session.id}/checkout`,
    cashier,
    { paymentMethod: "cash", cashReceived: 0 }
  );
  assert.equal(checkoutResponse.status, 201, await checkoutResponse.text());
  const [freedPrimary, freedLinked] = await Promise.all([
    prisma.table.findUniqueOrThrow({ where: { id: primaryId } }),
    prisma.table.findUniqueOrThrow({ where: { id: linkedId } })
  ]);
  assert.equal(freedPrimary.status, "available");
  assert.equal(freedLinked.status, "available");
  assert.equal(freedLinked.linked_to_table_id, null);
});

test("concurrent seating of reservations assigned to one table allows only one reservation to seat", async () => {
  const admin = await getUser("admin");
  const tableId = tableIds[5];
  await setTableAvailable(tableId);
  const first = await createReservation({ tableIndexes: [5], name: "Concurrent Seat First" });
  const second = await createReservation({ tableIndexes: [5], name: "Concurrent Seat Second" });

  const responses = await Promise.all([
    request(`/api/pos/dining/reservations/${first.id}/seat`, admin, {}),
    request(`/api/pos/dining/reservations/${second.id}/seat`, admin, {})
  ]);
  assert.deepEqual(responses.map((response) => response.status).sort(), [201, 409]);
  assert.equal(await prisma.diningTableSession.count({ where: { table_id: tableId, status: "active" } }), 1);
  assert.equal(await prisma.reservation.count({
    where: { id: { in: [first.id, second.id] }, status: "seated" }
  }), 1);
});

test("occupied or unavailable assigned tables refuse seating and direct staff to offer a temporary table", async () => {
  const cashier = await getUser("cashier");
  const occupiedId = tableIds[6];
  await setTableAvailable(occupiedId);
  await prisma.table.update({ where: { id: occupiedId }, data: { status: "occupied" } });
  const occupiedReservation = await createReservation({ tableIndexes: [6], name: "Occupied Assignment" });
  const occupiedResponse = await request(
    `/api/pos/dining/reservations/${occupiedReservation.id}/seat`,
    cashier,
    {}
  );
  assert.equal(occupiedResponse.status, 409);
  assert.match((await occupiedResponse.json() as { message: string }).message, /offer the customer a temporary table/i);

  const unavailableId = tableIds[7];
  await setTableAvailable(unavailableId);
  await prisma.table.update({ where: { id: unavailableId }, data: { status: "unavailable" } });
  const unavailableReservation = await createReservation({ tableIndexes: [7], name: "Unavailable Assignment" });
  const unavailableResponse = await request(
    `/api/pos/dining/reservations/${unavailableReservation.id}/seat`,
    cashier,
    {}
  );
  assert.equal(unavailableResponse.status, 409);
  assert.match((await unavailableResponse.json() as { message: string }).message, /temporary table/i);
});

test("refuses already seated, cancelled, and non-today reservations", async () => {
  const admin = await getUser("admin");
  const cases = [
    { tableIndex: 8, name: "Already Seated", status: "seated", dayOffset: 0, expected: /already been seated/i },
    { tableIndex: 9, name: "Cancelled", status: "cancelled", dayOffset: 0, expected: /cannot be seated/i },
    { tableIndex: 8, name: "Not Today", status: "confirmed", dayOffset: 1, expected: /only today's reservations/i }
  ];

  for (const item of cases) {
    await setTableAvailable(tableIds[item.tableIndex]);
    const reservation = await createReservation({
      tableIndexes: [item.tableIndex],
      name: item.name,
      status: item.status,
      dayOffset: item.dayOffset
    });
    const response = await request(`/api/pos/dining/reservations/${reservation.id}/seat`, admin, {});
    assert.equal(response.status, 409);
    assert.match((await response.json() as { message: string }).message, item.expected);
  }
});

test("reservation seating endpoint allows admin and cashier and rejects other roles", async () => {
  const tableId = tableIds[0];
  await setTableAvailable(tableId);
  const inventoryManager = await getUser("inventory_manager");
  assert.equal((await request("/api/pos/dining/reservations/missing/seat", undefined, {})).status, 401);
  assert.equal(
    (await request("/api/pos/dining/reservations/missing/seat", inventoryManager, {})).status,
    403
  );
});

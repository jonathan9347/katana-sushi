import assert from "node:assert/strict";
import { after, before, test } from "node:test";

const testDatabaseUrl = process.env.RESERVATION_ASSIGNMENT_TEST_DATABASE_URL;
if (!testDatabaseUrl) {
  throw new Error("RESERVATION_ASSIGNMENT_TEST_DATABASE_URL must point to a fresh restored test database.");
}

const testDatabaseName = new URL(testDatabaseUrl).pathname.slice(1);
if (!testDatabaseName.startsWith("katana_sushi_dev_3c_assignment_")) {
  throw new Error("Reservation assignment integration tests only run on a dedicated 3c assignment test copy.");
}

process.env.DATABASE_URL = testDatabaseUrl;
const dotenv = require("dotenv") as typeof import("dotenv");
dotenv.config();

const { app, prisma } = require("../app") as typeof import("../app");
const { checkDatabaseHealth } = require("../lib/database") as typeof import("../lib/database");
let server: ReturnType<typeof app.listen>;
let baseUrl = "";
let phoneSequence = 0;

before(async () => {
  const database = await prisma.$queryRaw<Array<{ name: string }>>`SELECT current_database() AS name`;
  assert.equal(database[0]?.name, testDatabaseName, "Tests must connect to the fresh restored copy.");
  assert.equal(await checkDatabaseHealth(), true, "The restored test database must be reachable.");
  assert.equal(
    await prisma.diningTableSession.count({ where: { status: "active" } }),
    0,
    "The fresh copy must not contain active dining sessions."
  );

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
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
  await prisma.$disconnect();
});

async function setAvailableTables(tableNumbers: number[]) {
  await prisma.table.updateMany({
    where: { is_archived: false },
    data: { status: "unavailable", linked_to_table_id: null, unavailable_reason: null }
  });
  const tables = await prisma.table.findMany({
    where: { table_number: { in: tableNumbers }, is_archived: false },
    select: { id: true, table_number: true }
  });
  assert.deepEqual(tables.map((table) => table.table_number).sort((a, b) => a - b), [...tableNumbers].sort((a, b) => a - b));
  await prisma.table.updateMany({
    where: { id: { in: tables.map((table) => table.id) } },
    data: { status: "available" }
  });
  return tables;
}

function bookingBody(partySize: number, date: string, time: string) {
  phoneSequence += 1;
  const runKey = `${Date.now()}-${phoneSequence}`;
  const suffix = String(Date.now() + phoneSequence).slice(-9).padStart(9, "0");
  return {
    customer_name: `Assignment Test ${runKey}`,
    customer_phone: `09${suffix}`,
    customer_email: `assignment-test-${runKey}@example.test`,
    date,
    time,
    party_size: partySize,
    reservation_type: "dine_in"
  };
}

async function book(partySize: number, date: string, time: string, requestedTableId?: string) {
  const body = {
    ...bookingBody(partySize, date, time),
    ...(requestedTableId ? { table_id: requestedTableId } : {})
  };
  const response = await fetch(`${baseUrl}/api/reservations/table`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });
  return { body, response };
}

test("confirms a larger party with multiple assignment rows in one booking", async () => {
  const available = await setAvailableTables([1, 9]);
  assert.deepEqual(available.map((table) => table.table_number).sort((a, b) => a - b), [1, 9]);

  const { body, response } = await book(6, "2026-11-10", "18:00");
  assert.equal(response.status, 201, await response.text());

  const reservation = await prisma.reservation.findFirst({
    where: { customer_email: body.customer_email },
    include: { table_assignments: { orderBy: { table: { table_number: "asc" } } } }
  });
  assert.equal(reservation?.status, "confirmed");
  assert.equal(reservation?.table_assignments.length, 2);
  assert.deepEqual(
    reservation?.table_assignments.map((assignment) => assignment.seat_count).sort((a, b) => a - b),
    [2, 4]
  );
});

test("overlapping bookings conflict, while an exact estimated-duration boundary is available", async () => {
  const [table] = await setAvailableTables([2]);
  const first = await book(4, "2026-11-11", "18:00");
  assert.equal(first.response.status, 201, await first.response.text());

  const overlapping = await book(1, "2026-11-11", "19:59");
  assert.equal(overlapping.response.status, 409);
  assert.match((await overlapping.response.json() as { message: string }).message, /No suitable tables/);

  const nextWindow = await book(1, "2026-11-11", "20:00");
  assert.equal(nextWindow.response.status, 201, await nextWindow.response.text());
  const assignments = await prisma.reservationTableAssignment.findMany({
    where: {
      table_id: table.id,
      reservation: {
        is: { customer_email: { in: [first.body.customer_email, nextWindow.body.customer_email] } }
      }
    },
    include: { reservation: { select: { time: true } } }
  });
  assert.deepEqual(assignments.map((assignment) => assignment.reservation.time).sort(), ["18:00", "20:00"]);
});

test("does not assign a table marked unavailable", async () => {
  await setAvailableTables([3]);
  await prisma.table.update({ where: { table_number: 3 }, data: { status: "unavailable" } });
  await prisma.table.update({ where: { table_number: 4 }, data: { status: "available" } });

  const { body, response } = await book(2, "2026-11-12", "18:00");
  assert.equal(response.status, 201, await response.text());
  const reservation = await prisma.reservation.findFirst({
    where: { customer_email: body.customer_email },
    include: { table_assignments: { include: { table: { select: { table_number: true } } } } }
  });
  assert.deepEqual(reservation?.table_assignments.map((assignment) => assignment.table.table_number), [4]);
});

test("customer-supplied table IDs do not override automatic assignment", async () => {
  const [available] = await setAvailableTables([6]);
  const unavailable = await prisma.table.findUniqueOrThrow({
    where: { table_number: 7 },
    select: { id: true }
  });

  const { body, response } = await book(2, "2026-11-16", "18:00", unavailable.id);
  assert.equal(response.status, 201, await response.text());
  const reservation = await prisma.reservation.findFirst({
    where: { customer_email: body.customer_email },
    include: { table_assignments: { select: { table_id: true } } }
  });
  assert.deepEqual(reservation?.table_assignments.map((assignment) => assignment.table_id), [available.id]);
});

test("returns a clear conflict without creating a reservation or partial assignments when no table fits", async () => {
  await setAvailableTables([]);
  const { body, response } = await book(2, "2026-11-13", "18:00");

  assert.equal(response.status, 409);
  assert.match((await response.json() as { message: string }).message, /No suitable tables/);
  assert.equal(await prisma.reservation.count({ where: { customer_email: body.customer_email } }), 0);
  assert.equal(await prisma.reservationTableAssignment.count({
    where: { reservation: { is: { customer_email: body.customer_email } } }
  }), 0);
});

test("serializes concurrent bookings so the same table is assigned only once for overlapping windows", async () => {
  const [table] = await setAvailableTables([5]);
  const results = await Promise.all([
    book(4, "2026-11-14", "18:00"),
    book(4, "2026-11-14", "18:00")
  ]);
  const statuses = results.map(({ response }) => response.status).sort();

  assert.deepEqual(statuses, [201, 409]);
  const assignments = await prisma.reservationTableAssignment.findMany({
    where: {
      table_id: table.id,
      reservation: { is: { customer_email: { in: results.map(({ body }) => body.customer_email) } } }
    },
    include: { reservation: { select: { time: true } } }
  });
  assert.equal(assignments.length, 1);
});

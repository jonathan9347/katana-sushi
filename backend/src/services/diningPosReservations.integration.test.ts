import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import jwt from "jsonwebtoken";

const testDatabaseUrl = process.env.DINING_POS_RESERVATIONS_TEST_DATABASE_URL;
if (!testDatabaseUrl) {
  throw new Error("DINING_POS_RESERVATIONS_TEST_DATABASE_URL must point to a fresh restored test database.");
}

const testDatabaseName = new URL(testDatabaseUrl).pathname.slice(1);
if (!testDatabaseName.startsWith("katana_sushi_dev_3d_upcoming_")) {
  throw new Error("Upcoming reservation integration tests only run on a dedicated restored 3d test copy.");
}

process.env.DATABASE_URL = testDatabaseUrl;
const dotenv = require("dotenv") as typeof import("dotenv");
dotenv.config();

const { app, prisma } = require("../app") as typeof import("../app");
const { checkDatabaseHealth } = require("../lib/database") as typeof import("../lib/database");

type ReservationStripItem = {
  id: string;
  time: string;
  customer_name: string;
  party_size: number;
  table_numbers: number[];
  state: "upcoming" | "arrived" | "late";
};

let server: ReturnType<typeof app.listen>;
let baseUrl = "";
let testEmailPrefix = "";
let assignedTableIds: string[] = [];

function tokenFor(user: { id: string; email: string; role: string }) {
  const secret = process.env.JWT_SECRET;
  assert.ok(secret, "JWT_SECRET must be configured for route authorization tests.");
  return `Bearer ${jwt.sign({ sub: user.id, email: user.email, role: user.role }, secret)}`;
}

async function fetchReservations(authorization?: string) {
  return fetch(`${baseUrl}/api/pos/dining/upcoming-reservations`, {
    headers: authorization ? { Authorization: authorization } : undefined
  });
}

function manilaTodayStart() {
  const date = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Manila",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).format(new Date());
  return new Date(`${date}T00:00:00+08:00`);
}

before(async () => {
  const database = await prisma.$queryRaw<Array<{ name: string }>>`SELECT current_database() AS name`;
  assert.equal(database[0]?.name, testDatabaseName, "Tests must connect to the new restored copy.");
  assert.equal(await checkDatabaseHealth(), true, "The restored test database must be reachable.");
  const dayStart = manilaTodayStart();
  const nextDayStart = new Date(dayStart.getTime() + 24 * 60 * 60 * 1000);
  assert.equal(
    await prisma.reservation.count({
      where: {
        date: { gte: dayStart, lt: nextDayStart },
        status: { in: ["confirmed", "seated", "preparing", "in_progress", "pending_final_payment"] },
        table_assignments: { some: { status: "assigned" } }
      }
    }),
    0,
    "The fresh restored copy must have no existing assigned reservations for today."
  );

  const tables = await prisma.table.findMany({
    where: { is_archived: false, linked_to_table_id: null },
    orderBy: { table_number: "asc" },
    take: 5,
    select: { id: true }
  });
  assert.equal(tables.length, 5, "The restored copy must contain at least five live tables.");
  assignedTableIds = tables.map((table) => table.id);
  testEmailPrefix = `pos-strip-${Date.now()}-`;

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
  if (testEmailPrefix) {
    await prisma.reservation.deleteMany({
      where: { customer_email: { startsWith: testEmailPrefix } }
    });
  }
  await prisma.$disconnect();
});

async function createReservationFixture(input: {
  name: string;
  time: string;
  partySize: number;
  status?: string;
  tableIndexes: number[];
}) {
  const key = input.name.toLowerCase().replace(/[^a-z0-9]+/g, "-");
  const reservation = await prisma.reservation.create({
    data: {
      booking_id: `STRIP-${Date.now()}-${key}`,
      customer_name: input.name,
      customer_phone: "09000000000",
      customer_email: `${testEmailPrefix}${key}@example.test`,
      date: manilaTodayStart(),
      time: input.time,
      party_size: input.partySize,
      status: input.status ?? "confirmed",
      reservation_type: "dine_in"
    }
  });

  await prisma.reservationTableAssignment.createMany({
    data: input.tableIndexes.map((index, order) => ({
      reservation_id: reservation.id,
      table_id: assignedTableIds[index],
      seat_count: order === 0 ? input.partySize : 0,
      status: "assigned"
    }))
  });
  return reservation.id;
}

test("returns an empty strip when there are no assigned reservations today", async () => {
  const admin = await prisma.user.findFirst({
    where: { role: "admin" },
    select: { id: true, email: true, role: true }
  });
  assert.ok(admin, "The restored copy must contain an admin account.");
  const response = await fetchReservations(tokenFor(admin));
  const responseText = await response.text();
  assert.equal(response.status, 200, responseText);
  assert.deepEqual(JSON.parse(responseText), { reservations: [] });
});

test("is POS-staff-only: permits cashier and admin, rejects unauthenticated or other roles", async () => {
  const [cashier, nonPosStaff, admin] = await Promise.all([
    prisma.user.findFirst({ where: { role: "cashier" }, select: { id: true, email: true, role: true } }),
    prisma.user.findFirst({ where: { role: "inventory_manager" }, select: { id: true, email: true, role: true } }),
    prisma.user.findFirst({ where: { role: "admin" }, select: { id: true, email: true, role: true } })
  ]);
  assert.ok(cashier, "The restored copy must contain a cashier account.");
  assert.ok(nonPosStaff, "The restored copy must contain an inventory-manager account.");
  assert.ok(admin, "The restored copy must contain an admin account.");

  assert.equal((await fetchReservations()).status, 401);
  assert.equal((await fetchReservations(tokenFor(nonPosStaff))).status, 403);
  assert.equal((await fetchReservations(tokenFor(cashier))).status, 200);
  assert.equal((await fetchReservations(tokenFor(admin))).status, 200);
});

test("lists upcoming, late, arrived and multi-table reservations in time order with minimal fields", async () => {
  await createReservationFixture({
    name: "Late Customer",
    time: "12:00",
    partySize: 2,
    tableIndexes: [0]
  });
  await createReservationFixture({
    name: "Arrived Customer",
    time: "12:30",
    partySize: 3,
    status: "seated",
    tableIndexes: [1]
  });
  await createReservationFixture({
    name: "Multi Table Customer",
    time: "18:00",
    partySize: 6,
    tableIndexes: [2, 3]
  });
  await createReservationFixture({
    name: "Upcoming Customer",
    time: "20:00",
    partySize: 2,
    tableIndexes: [4]
  });

  const admin = await prisma.user.findFirstOrThrow({
    where: { role: "admin" },
    select: { id: true, email: true, role: true }
  });
  const response = await fetchReservations(tokenFor(admin));
  const responseText = await response.text();
  assert.equal(response.status, 200, responseText);
  const payload = JSON.parse(responseText) as { reservations: ReservationStripItem[] };

  assert.deepEqual(
    payload.reservations.map((reservation) => [reservation.time, reservation.customer_name, reservation.state]),
    [
      ["12:00", "Late Customer", "late"],
      ["12:30", "Arrived Customer", "arrived"],
      ["18:00", "Multi Table Customer", "upcoming"],
      ["20:00", "Upcoming Customer", "upcoming"]
    ]
  );
  const multiTable = payload.reservations.find((reservation) => reservation.customer_name === "Multi Table Customer");
  assert.deepEqual(multiTable?.table_numbers, [3, 4]);
  assert.deepEqual(Object.keys(payload.reservations[0]).sort(), [
    "customer_name",
    "id",
    "party_size",
    "state",
    "table_numbers",
    "time"
  ]);
  assert.ok(payload.reservations.every((reservation) => !("customer_phone" in reservation)));
});

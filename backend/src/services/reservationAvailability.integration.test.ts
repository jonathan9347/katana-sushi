import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import jwt from "jsonwebtoken";

const testDatabaseUrl = process.env.RESERVATION_AVAILABILITY_TEST_DATABASE_URL;
if (!testDatabaseUrl) {
  throw new Error("RESERVATION_AVAILABILITY_TEST_DATABASE_URL must point to a fresh restored test database.");
}

const testDatabaseName = new URL(testDatabaseUrl).pathname.slice(1);
if (!testDatabaseName.startsWith("katana_sushi_dev_3b_availability_")) {
  throw new Error("Reservation availability integration tests only run on a dedicated restored 3b test copy.");
}

process.env.DATABASE_URL = testDatabaseUrl;
const dotenv = require("dotenv") as typeof import("dotenv");
dotenv.config();

const { app, prisma } = require("../app") as typeof import("../app");
const { checkDatabaseHealth } = require("../lib/database") as typeof import("../lib/database");

type AvailabilityResponse = {
  availability: "available" | "full";
  checked_at: string;
};

type SystemSettingsResponse = {
  settings: Record<string, unknown> & {
    estimated_dining_duration_minutes: number;
    reservation_duration_minutes: number;
  };
};

let server: ReturnType<typeof app.listen>;
let baseUrl = "";
let emailPrefix = "";
let adminAuthorization = "";
let originalTables: Array<{
  id: string;
  status: string;
  is_archived: boolean;
  archived_at: Date | null;
  unavailable_reason: string | null;
}> = [];
let originalEstimatedDuration = 120;
let createdSessionIds: string[] = [];
let requestSequence = 0;

before(async () => {
  const database = await prisma.$queryRaw<Array<{ name: string }>>`SELECT current_database() AS name`;
  assert.equal(database[0]?.name, testDatabaseName, "Tests must connect to the new restored copy.");
  assert.equal(await checkDatabaseHealth(), true, "The restored test database must be reachable.");
  assert.equal(
    await prisma.diningTableSession.count({ where: { status: "active" } }),
    0,
    "The fresh restored copy must not contain active dining sessions."
  );

  const settings = await prisma.systemSetting.findUniqueOrThrow({
    where: { singleton_key: "default" },
    select: {
      estimated_dining_duration_minutes: true,
      reservation_duration_minutes: true
    }
  });
  originalEstimatedDuration = settings.estimated_dining_duration_minutes;
  assert.equal(originalEstimatedDuration, 120);

  originalTables = await prisma.table.findMany({
    select: {
      id: true,
      status: true,
      is_archived: true,
      archived_at: true,
      unavailable_reason: true
    }
  });
  emailPrefix = `availability-test-${Date.now()}-`;

  const admin = await prisma.user.findFirst({
    where: { role: "admin" },
    select: { id: true, email: true }
  });
  assert.ok(admin, "The restored copy must contain an admin account.");
  assert.ok(process.env.JWT_SECRET, "JWT_SECRET must be configured for settings authorization tests.");
  adminAuthorization = `Bearer ${jwt.sign(
    { sub: admin.id, email: admin.email, role: "admin" },
    process.env.JWT_SECRET
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
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }

  if (emailPrefix) {
    await prisma.reservation.updateMany({
      where: { customer_email: { startsWith: emailPrefix } },
      data: { status: "cancelled" }
    });
  }
  if (createdSessionIds.length > 0) {
    await prisma.diningTableSession.updateMany({
      where: { id: { in: createdSessionIds }, status: "active" },
      data: { status: "closed", closed_at: new Date() }
    });
  }
  if (originalTables.length > 0) {
    await prisma.$transaction(originalTables.map((table) => prisma.table.update({
      where: { id: table.id },
      data: {
        status: table.status,
        is_archived: table.is_archived,
        archived_at: table.archived_at,
        unavailable_reason: table.unavailable_reason
      }
    })));
  }
  await prisma.systemSetting.update({
    where: { singleton_key: "default" },
    data: { estimated_dining_duration_minutes: originalEstimatedDuration }
  });
  await prisma.$disconnect();
});

async function setAvailableTables(tableNumbers: number[]) {
  await prisma.table.updateMany({
    where: { is_archived: false, linked_to_table_id: null },
    data: { status: "unavailable", unavailable_reason: null }
  });
  const tables = await prisma.table.findMany({
    where: { table_number: { in: tableNumbers }, is_archived: false, linked_to_table_id: null },
    select: { id: true, table_number: true, capacity: true }
  });
  assert.deepEqual(
    tables.map((table) => table.table_number).sort((a, b) => a - b),
    [...tableNumbers].sort((a, b) => a - b)
  );
  await prisma.table.updateMany({
    where: { id: { in: tables.map((table) => table.id) } },
    data: { status: "available" }
  });
  return tables;
}

async function availability(date: string, time: string, partySize: number) {
  const params = new URLSearchParams({
    date,
    time,
    party_size: String(partySize)
  });
  const response = await fetch(`${baseUrl}/api/reservations/table-availability?${params}`);
  const responseText = await response.text();
  assert.equal(response.status, 200, responseText);
  const result = JSON.parse(responseText) as AvailabilityResponse;
  assert.deepEqual(Object.keys(result).sort(), ["availability", "checked_at"]);
  assert.ok(["available", "full"].includes(result.availability));
  return result.availability;
}

function dateAfter(days: number) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Manila",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).format(new Date()).split("-").map(Number);
  const date = new Date(Date.UTC(parts[0], parts[1] - 1, parts[2] + days));
  return date.toISOString().slice(0, 10);
}

function currentManilaMinute() {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Manila",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23"
  }).format(new Date()).split(":").map(Number);
  return parts[0] * 60 + parts[1];
}

function formatMinute(value: number) {
  return `${String(Math.floor(value / 60)).padStart(2, "0")}:${String(value % 60).padStart(2, "0")}`;
}

async function book(
  partySize: number,
  date: string,
  time: string,
  reservationType: "dine_in" | "unlimited" = "dine_in"
) {
  requestSequence += 1;
  const key = `${emailPrefix}${requestSequence}`;
  const suffix = String(Date.now() + requestSequence).slice(-9).padStart(9, "0");
  const body = {
    customer_name: `Availability Test ${key}`,
    customer_phone: `09${suffix}`,
    customer_email: `${key}@example.test`,
    date,
    time,
    party_size: partySize,
    reservation_type: reservationType
  };
  const response = await fetch(`${baseUrl}/api/reservations/table`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });
  return { body, response };
}

async function updateEstimatedDuration(minutes: number) {
  const currentResponse = await fetch(`${baseUrl}/api/settings/system`);
  assert.equal(currentResponse.status, 200);
  const current = await currentResponse.json() as SystemSettingsResponse;
  const response = await fetch(`${baseUrl}/api/admin/settings/system`, {
    method: "PUT",
    headers: {
      Authorization: adminAuthorization,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      ...current.settings,
      estimated_dining_duration_minutes: minutes
    })
  });
  const responseText = await response.text();
  assert.equal(response.status, 200, responseText);
  return (JSON.parse(responseText) as SystemSettingsResponse).settings;
}

test("reports Available or Full from party size and supports multi-table combinations without counts", async () => {
  const [fourSeatTable] = await setAvailableTables([1]);
  assert.equal(fourSeatTable.capacity, 4);
  const date = dateAfter(3000);
  assert.equal(await availability(date, "18:00", 4), "available");
  assert.equal(await availability(date, "18:00", 5), "full");

  const multiTable = await setAvailableTables([1, 9]);
  assert.deepEqual(
    multiTable.map((table) => table.capacity).sort((a, b) => a - b),
    [2, 4]
  );
  assert.equal(await availability(dateAfter(3001), "18:00", 6), "available");
  assert.equal(await availability(dateAfter(3001), "18:00", 7), "full");
});

test("uses the estimate window at its exact reservation-assignment boundary", async () => {
  await setAvailableTables([2]);
  const date = dateAfter(3002);
  const booked = await book(4, date, "18:00", "unlimited");
  assert.equal(booked.response.status, 201, await booked.response.text());

  assert.equal(await availability(date, "19:59", 1), "full");
  assert.equal(await availability(date, "20:00", 1), "available");
});

test("excludes unavailable and archived tables from customer availability", async () => {
  const [table] = await setAvailableTables([3]);
  const date = dateAfter(3003);

  await prisma.table.update({
    where: { id: table.id },
    data: { status: "unavailable" }
  });
  assert.equal(await availability(date, "18:00", 1), "full");

  await prisma.table.update({
    where: { id: table.id },
    data: { status: "available", is_archived: true, archived_at: new Date() }
  });
  assert.equal(await availability(date, "18:00", 1), "full");
  await prisma.table.update({
    where: { id: table.id },
    data: { is_archived: false, archived_at: null, status: "available" }
  });
});

test("counts active POS sessions for today but not future-date availability and keeps estimates planning-only", async () => {
  const [table] = await setAvailableTables([8]);
  const cashier = await prisma.user.findFirst({
    where: { role: "cashier" },
    select: { id: true }
  });
  assert.ok(cashier, "The restored copy must contain a cashier account.");

  const session = await prisma.diningTableSession.create({
    data: {
      table_id: table.id,
      cashier_id: cashier.id,
      status: "active",
      opened_at: new Date(Date.now() - 45 * 60_000)
    }
  });
  createdSessionIds.push(session.id);
  await prisma.table.update({ where: { id: table.id }, data: { status: "occupied" } });

  const requestedTime = formatMinute(Math.max(currentManilaMinute() + 10, 12 * 60 + 10));
  const today = dateAfter(0);
  assert.equal(await availability(today, requestedTime, 1), "full");
  assert.equal(await availability(dateAfter(3005), "18:00", 1), "available");

  const updatedSettings = await updateEstimatedDuration(30);
  assert.equal(updatedSettings.estimated_dining_duration_minutes, 30);
  assert.equal(updatedSettings.reservation_duration_minutes, 90);
  assert.equal(await availability(today, requestedTime, 1), "available");

  const [tableAfterPlanning, sessionAfterPlanning, savedSettings, unlimitedSettings] = await Promise.all([
    prisma.table.findUniqueOrThrow({
      where: { id: table.id },
      select: { status: true }
    }),
    prisma.diningTableSession.findUniqueOrThrow({
      where: { id: session.id },
      select: { status: true, closed_at: true }
    }),
    prisma.systemSetting.findUniqueOrThrow({
      where: { singleton_key: "default" },
      select: { reservation_duration_minutes: true, estimated_dining_duration_minutes: true }
    }),
    prisma.unlimitedSetting.findFirst({ select: { time_limit_minutes: true } })
  ]);

  assert.equal(tableAfterPlanning.status, "occupied");
  assert.equal(sessionAfterPlanning.status, "active");
  assert.equal(sessionAfterPlanning.closed_at, null);
  assert.equal(savedSettings.reservation_duration_minutes, 90);
  assert.equal(savedSettings.estimated_dining_duration_minutes, 30);
  assert.equal(unlimitedSettings?.time_limit_minutes, 90);
  await prisma.diningTableSession.update({
    where: { id: session.id },
    data: { status: "closed", closed_at: new Date() }
  });
  await prisma.table.update({ where: { id: table.id }, data: { status: "available" } });
});

test("booking confirmation rejects a table taken after availability was checked", async () => {
  await setAvailableTables([4]);
  const date = dateAfter(3004);
  assert.equal(await availability(date, "18:00", 4), "available");

  const occupyingBooking = await book(4, date, "18:00");
  assert.equal(occupyingBooking.response.status, 201, await occupyingBooking.response.text());
  const competingBooking = await book(4, date, "18:00");
  assert.equal(competingBooking.response.status, 409);
  assert.match((await competingBooking.response.json() as { message: string }).message, /No suitable tables/);
  assert.equal(
    await prisma.reservation.count({ where: { customer_email: competingBooking.body.customer_email } }),
    0
  );
  assert.equal(
    await prisma.reservationTableAssignment.count({
      where: { reservation: { is: { customer_email: competingBooking.body.customer_email } } }
    }),
    0
  );
});

test("serializes concurrent confirmations against real table assignments", async () => {
  const [table] = await setAvailableTables([5]);
  const date = dateAfter(3006);
  const results = await Promise.all([
    book(4, date, "18:00"),
    book(4, date, "18:00")
  ]);
  assert.deepEqual(results.map(({ response }) => response.status).sort(), [201, 409]);
  assert.equal(
    await prisma.reservationTableAssignment.count({
      where: {
        table_id: table.id,
        reservation: { is: { customer_email: { startsWith: emailPrefix } } }
      }
    }),
    1
  );
});

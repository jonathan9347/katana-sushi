import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import jwt from "jsonwebtoken";

const testDatabaseUrl = process.env.TABLE_MANAGEMENT_TEST_DATABASE_URL;
if (!testDatabaseUrl) {
  throw new Error("TABLE_MANAGEMENT_TEST_DATABASE_URL must point to a fresh restored test database.");
}

const testDatabaseName = new URL(testDatabaseUrl).pathname.slice(1);
if (!testDatabaseName.startsWith("katana_sushi_dev_3c_tests_")) {
  throw new Error("Table-management integration tests only run on a dedicated 3c test-copy database.");
}

process.env.DATABASE_URL = testDatabaseUrl;
const dotenv = require("dotenv") as typeof import("dotenv");
dotenv.config();

const { app, prisma } = require("../app") as typeof import("../app");
const { checkDatabaseHealth } = require("../lib/database") as typeof import("../lib/database");
const port = 0;
let server: ReturnType<typeof app.listen>;
let baseUrl = "";

before(async () => {
  const database = await prisma.$queryRaw<Array<{ name: string }>>`SELECT current_database() AS name`;
  assert.equal(database[0]?.name, testDatabaseName, "Tests must connect to the dedicated restored copy.");
  assert.equal(await checkDatabaseHealth(), true, "The isolated test database must be reachable.");

  server = app.listen(port);
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

async function cashierToken() {
  const cashier = await prisma.user.findFirst({
    where: { role: "cashier" },
    select: { id: true, email: true }
  });
  assert.ok(cashier, "Restored copy must contain a cashier account.");
  const secret = process.env.JWT_SECRET;
  assert.ok(secret, "JWT_SECRET must be configured for route authorization tests.");
  return jwt.sign({ sub: cashier.id, email: cashier.email, role: "cashier" }, secret);
}

async function cashierRequest(path: string, method: string, body: unknown) {
  return fetch(`${baseUrl}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${await cashierToken()}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify(body)
  });
}

test("cashiers are refused when adding, archiving, or editing table seats", async () => {
  const add = await cashierRequest("/api/pos/dining/tables", "POST", { capacity: 2 });
  const archive = await cashierRequest("/api/pos/dining/tables/not-a-table/archive", "POST", {});
  const editSeats = await cashierRequest("/api/pos/dining/tables/not-a-table/seats", "PATCH", { capacity: 4 });

  assert.equal(add.status, 403);
  assert.equal(archive.status, 403);
  assert.equal(editSeats.status, 403);
});

test("checkout closes the session and frees its linked table in one database transaction", async () => {
  const cashier = await prisma.user.findFirst({
    where: { role: "cashier" },
    select: { id: true, email: true }
  });
  assert.ok(cashier, "Restored copy must contain a cashier account.");

  const fixture = await prisma.$transaction(async (tx) => {
    const maximum = await tx.table.aggregate({ _max: { table_number: true } });
    const firstNumber = (maximum._max.table_number ?? 0) + 1;
    const occupied = await tx.table.create({
      data: { table_number: firstNumber, capacity: 2, status: "occupied" }
    });
    const linked = await tx.table.create({
      data: {
        table_number: firstNumber + 1,
        capacity: 2,
        status: "unavailable",
        linked_to_table_id: occupied.id
      }
    });
    const session = await tx.diningTableSession.create({
      data: {
        table_id: occupied.id,
        cashier_id: cashier.id,
        guests: { create: [{ guest_number: 1 }] }
      }
    });
    return { occupiedId: occupied.id, linkedId: linked.id, sessionId: session.id };
  });
  const token = jwt.sign(
    { sub: cashier.id, email: cashier.email, role: "cashier" },
    process.env.JWT_SECRET!
  );

  const response = await fetch(`${baseUrl}/api/pos/dining/sessions/${fixture.sessionId}/checkout`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ paymentMethod: "cash", cashReceived: 0 })
  });

  assert.equal(response.status, 201, await response.text());
  const state = await prisma.$transaction(async (tx) => {
    const [session, occupied, linked] = await Promise.all([
      tx.diningTableSession.findUnique({ where: { id: fixture.sessionId }, select: { status: true } }),
      tx.table.findUnique({ where: { id: fixture.occupiedId }, select: { status: true } }),
      tx.table.findUnique({
        where: { id: fixture.linkedId },
        select: { status: true, linked_to_table_id: true }
      })
    ]);
    return { session, occupied, linked };
  });

  assert.equal(state.session?.status, "closed");
  assert.equal(state.occupied?.status, "available");
  assert.equal(state.linked?.status, "available");
  assert.equal(state.linked?.linked_to_table_id, null);
});

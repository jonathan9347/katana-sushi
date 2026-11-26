import assert from "node:assert/strict";
import { AddressInfo } from "node:net";
import { after, afterEach, before, test } from "node:test";
import type { Server } from "node:http";
import jwt from "jsonwebtoken";
import { Prisma } from "@prisma/client";
import { prisma } from "./lib/prisma";

Object.assign(process.env, {
  DATABASE_URL: "postgresql://test:test@127.0.0.1:1/katana_route_test",
  DIRECT_URL: "postgresql://test:test@127.0.0.1:1/katana_route_test",
  JWT_SECRET: "raw-material-route-test-secret"
});

const originalTransaction = Object.getOwnPropertyDescriptor(prisma, "$transaction");
const originalAuditCreate = Object.getOwnPropertyDescriptor(prisma.auditLog, "create");
const authorization = `Bearer ${jwt.sign(
  { sub: "test-admin", email: "admin@example.invalid", role: "admin" },
  "raw-material-route-test-secret"
)}`;

let server: Server;
let baseUrl = "";

before(async () => {
  const originalQueryRaw = Object.getOwnPropertyDescriptor(prisma, "$queryRaw");
  Object.defineProperty(prisma, "$queryRaw", {
    configurable: true,
    value: async () => []
  });
  const { checkDatabaseHealth } = require("./lib/database") as typeof import("./lib/database");
  assert.equal(await checkDatabaseHealth(), true);
  if (originalQueryRaw) {
    Object.defineProperty(prisma, "$queryRaw", originalQueryRaw);
  } else {
    delete (prisma as unknown as Record<string, unknown>).$queryRaw;
  }

  const { default: app } = require("./app") as typeof import("./app");
  Object.defineProperty(prisma.auditLog, "create", {
    configurable: true,
    value: async () => ({})
  });
  server = app.listen(0);
  await new Promise<void>((resolve, reject) => {
    server.once("listening", resolve);
    server.once("error", reject);
  });
  const address = server.address() as AddressInfo;
  baseUrl = `http://127.0.0.1:${address.port}`;
});

after(async () => {
  server.closeAllConnections();
  await new Promise<void>((resolve, reject) => {
    server.close((error) => error ? reject(error) : resolve());
  });
  if (originalAuditCreate) {
    Object.defineProperty(prisma.auditLog, "create", originalAuditCreate);
  } else {
    delete (prisma.auditLog as unknown as Record<string, unknown>).create;
  }
});

afterEach(() => {
  if (originalTransaction) {
    Object.defineProperty(prisma, "$transaction", originalTransaction);
  } else {
    delete (prisma as unknown as Record<string, unknown>).$transaction;
  }
});

function mockTransaction(tx: object) {
  Object.defineProperty(prisma, "$transaction", {
    configurable: true,
    value: (callback: (client: Prisma.TransactionClient) => Promise<unknown>) =>
      callback(tx as Prisma.TransactionClient)
  });
}

function transactionMock(rawMaterial: object, sellingProduct: object = {
  findMany: async () => [],
  findFirst: async () => null,
  create: async () => ({})
}) {
  return {
    rawMaterial,
    sellingProduct,
    $queryRaw: async () => [],
    materialBatch: { count: async () => 0 },
    recipeIngredient: { count: async () => 0 },
    cateringIngredientLock: { count: async () => 0 },
    inventoryMovement: { count: async () => 0 },
    inventoryTransaction: { count: async () => 0 }
  };
}

async function createMaterial(unit = "sheet", category: "Beverage" | "Raw Material" = "Raw Material") {
  return fetch(`${baseUrl}/api/inventory/materials`, {
    method: "POST",
    headers: {
      Authorization: authorization,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      name: "Nori",
      category,
      unit,
      reorder_level: 5,
      cost_per_unit: 12
    })
  });
}

test("accepts cans as a beverage material unit", async () => {
  let createdData: Record<string, unknown> | undefined;
  let createdProductData: Record<string, unknown> | undefined;
  mockTransaction(transactionMock(
    {
      findUnique: async () => null,
      create: async ({ data }: { data: Record<string, unknown> }) => {
        createdData = data;
        return { id: "material-can", ...data };
      }
    },
    {
      findMany: async () => [],
      findFirst: async () => null,
      create: async ({ data }: { data: Record<string, unknown> }) => {
        createdProductData = data;
        return { id: "product-can", ...data };
      }
    }
  ));

  const response = await createMaterial("can", "Beverage");
  assert.equal(response.status, 201);
  assert.equal(createdData?.unit, "can");
  assert.equal(createdData?.category, "Beverage");
  assert.equal(createdProductData?.name, "Nori");
  assert.equal(createdProductData?.category, "Beverage");
  assert.equal(createdProductData?.price, 0);
  assert.equal(createdProductData?.image_url, null);
  assert.equal((await response.json()).product_created, true);
});

test("restores a deleted material while preserving its historical unit and stock", async () => {
  const archived = {
    id: "material-1",
    name: "Nori",
    category: "Beverage",
    unit: "sheet",
    reorder_level: 2,
    cost_per_unit: 8,
    current_stock: 17n,
    is_deleted: true
  };
  let updatedData: Record<string, unknown> | undefined;
  mockTransaction(transactionMock({
    findUnique: async ({ where }: { where: { name?: string; id?: string } }) =>
      where.name ? archived : archived,
    update: async ({ data }: { data: Record<string, unknown> }) => {
      updatedData = data;
      return { ...archived, ...data };
    }
  }));

  const response = await createMaterial("g");
  const result = await response.json();

  assert.equal(response.status, 201);
  assert.equal(result.material.id, archived.id);
  assert.equal(result.material.current_stock, 17);
  assert.equal(result.material.is_deleted, false);
  assert.equal(result.material.category, "Raw Material");
  assert.equal(result.material.unit, "sheet");
  assert.equal(result.unit_preserved, true);
  assert.deepEqual(updatedData, {
    name: "Nori",
    category: "Raw Material",
    unit: "sheet",
    reorder_level: 5,
    cost_per_unit: 12,
    is_deleted: false
  });
});

test("returns the specified conflict for an already active material", async () => {
  const active = { id: "material-2", name: "Nori", is_deleted: false };
  mockTransaction(transactionMock({
    findUnique: async () => active
  }));

  const response = await createMaterial();
  assert.equal(response.status, 409);
  assert.deepEqual(await response.json(), {
    message: "A raw material with this name already exists."
  });
});

test("still rejects changing the unit of an active material with stock", async () => {
  mockTransaction(transactionMock({
    findFirst: async () => ({
      id: "material-3",
      unit: "sheet",
      current_stock: 17n,
      is_deleted: false
    }),
    update: async () => {
      throw new Error("The material should not be updated when its unit is in use.");
    }
  }));

  const response = await fetch(`${baseUrl}/api/inventory/materials/material-3`, {
    method: "PUT",
    headers: {
      Authorization: authorization,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      name: "Nori",
      category: "Raw Material",
      unit: "g",
      reorder_level: 5,
      cost_per_unit: 12
    })
  });

  assert.equal(response.status, 400);
  assert.equal(
    (await response.json()).message,
    "A material's base unit cannot change after it has stock, batches, recipes, reservations, or movement history."
  );
});

test("maps a concurrent unique-name conflict to HTTP 409", async () => {
  mockTransaction(transactionMock({
    findUnique: async () => null,
    create: async () => {
      throw new Prisma.PrismaClientKnownRequestError("Unique constraint failed", {
        code: "P2002",
        clientVersion: "test"
      });
    }
  }));

  const response = await createMaterial();
  assert.equal(response.status, 409);
  assert.deepEqual(await response.json(), {
    message: "A raw material with this name already exists."
  });
});

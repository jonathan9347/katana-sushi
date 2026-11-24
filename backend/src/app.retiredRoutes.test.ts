import assert from "node:assert/strict";
import { AddressInfo } from "node:net";
import { after, before, test } from "node:test";
import type { Server } from "node:http";
import type * as AppModule from "./app";

// app.ts loads backend/.env but never overrides variables already set, so these
// dummies keep this test away from the real database, storage, email, and PayMongo.
Object.assign(process.env, {
  DATABASE_URL: "postgresql://test:test@127.0.0.1:1/katana_route_test",
  DIRECT_URL: "postgresql://test:test@127.0.0.1:1/katana_route_test",
  SUPABASE_URL: "",
  SUPABASE_SERVICE_ROLE_KEY: "",
  SUPABASE_STORAGE_BUCKET: "",
  RESEND_API_KEY: "",
  PAYMENT_GATEWAY: "fake",
  PAYMONGO_SECRET_KEY: ""
});

let server: Server;
let baseUrl = "";

before(async () => {
  const { default: app } = require("./app") as typeof AppModule;
  server = app.listen(0);
  await new Promise<void>((resolve) => server.once("listening", () => resolve()));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

after(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

test("the public dine-in pay-remaining route cannot mark a reservation paid", async () => {
  const response = await fetch(`${baseUrl}/api/reservations/KTN-20261201-0001/pay-remaining`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ payment_method: "gcash", reference_number: "FAKE-REF" })
  });

  // 410 (not 503) also shows the route answers before any database access.
  assert.equal(response.status, 410);
  assert.match((await response.json()).message, /not available for dine-in/);
});

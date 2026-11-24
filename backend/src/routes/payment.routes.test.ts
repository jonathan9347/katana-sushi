import assert from "node:assert/strict";
import crypto from "node:crypto";
import { AddressInfo } from "node:net";
import { after, before, test } from "node:test";
import express from "express";
import type { Server } from "node:http";
import type * as JsonBodyModule from "../lib/jsonBody";
import type * as PaymentHooksModule from "../services/payment/paymentHooks";
import type * as GatewayFactoryModule from "../services/payment/paymentGateway.factory";
import type * as PaymentRoutesModule from "./payment.routes";

// These requests never reach the database: each one is answered before any query.
let server: Server;
let baseUrl = "";
const WEBHOOK_SECRET = "whsk_route_test_secret";

before(async () => {
  process.env.PAYMENT_GATEWAY = "paymongo";
  process.env.PAYMONGO_SECRET_KEY = "sk_test_routeTestOnly123";
  delete process.env.PAYMONGO_PAYMENT_METHODS;

  // Loaded after the env above so the gateway factory picks PayMongo.
  const { jsonBodyParser } = require("../lib/jsonBody") as typeof JsonBodyModule;
  const { registerPaymentHooks } = require("../services/payment/paymentHooks") as typeof PaymentHooksModule;
  const { PaymentGatewayFactory } = require("../services/payment/paymentGateway.factory") as typeof GatewayFactoryModule;
  PaymentGatewayFactory.reset();
  const { default: paymentRoutes } = require("./payment.routes") as typeof PaymentRoutesModule;

  registerPaymentHooks({
    resolvePayableBooking: async () => ({ ok: false, status: 404, message: "Catering booking not found." })
  });

  const app = express();
  app.use(jsonBodyParser());
  app.use("/api", paymentRoutes);
  server = app.listen(0);
  await new Promise<void>((resolve) => server.once("listening", () => resolve()));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

after(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

function signed(body: string, secret = WEBHOOK_SECRET) {
  const timestamp = "1795479890";
  const signature = crypto.createHmac("sha256", secret).update(`${timestamp}.${body}`).digest("hex");
  return `t=${timestamp},te=${signature},li=`;
}

function postWebhook(body: string, signature?: string) {
  return fetch(`${baseUrl}/api/payments/paymongo/webhook`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(signature ? { "Paymongo-Signature": signature } : {}) },
    body
  });
}

const ignoredEvent = JSON.stringify({
  data: { id: "evt_1", type: "event", attributes: { type: "payment.failed", livemode: false, data: { id: "pay_1", type: "payment" } } }
});

test("publishes the PayMongo checkout configuration without secrets", async () => {
  const response = await fetch(`${baseUrl}/api/payments/config`);
  const body = await response.json();
  assert.equal(response.status, 200);
  assert.deepEqual(body, {
    gateway: "paymongo",
    hostedCheckout: true,
    testMode: true,
    available: true,
    methods: ["qrph", "card", "gcash", "paymaya"]
  });
  assert.doesNotMatch(JSON.stringify(body), /sk_test/);
});

test("refuses webhooks while no webhook secret is configured", async () => {
  delete process.env.PAYMONGO_WEBHOOK_SECRET;
  const response = await postWebhook(ignoredEvent, signed(ignoredEvent));
  assert.equal(response.status, 503);
});

test("rejects webhooks with a missing or wrong signature", async () => {
  process.env.PAYMONGO_WEBHOOK_SECRET = WEBHOOK_SECRET;
  assert.equal((await postWebhook(ignoredEvent)).status, 401);
  assert.equal((await postWebhook(ignoredEvent, signed(ignoredEvent, "whsk_wrong"))).status, 401);
});

test("verifies the raw bytes PayMongo sent, not re-serialized JSON", async () => {
  process.env.PAYMONGO_WEBHOOK_SECRET = WEBHOOK_SECRET;
  const spacedBody = ignoredEvent.replace(/,/g, ", ").replace(/:/g, ": ");
  const response = await postWebhook(spacedBody, signed(spacedBody));
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { received: true });
});

test("only accepts the online method while PayMongo is active", async () => {
  const response = await fetch(`${baseUrl}/api/payments/create-intent`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ amount: 100, paymentMethod: "cash", bookingId: "CAT-1", reservationType: "catering" })
  });
  assert.equal(response.status, 400);
  assert.match((await response.json()).message, /PayMongo/);
});

test("passes booking rule failures through with their status", async () => {
  const response = await fetch(`${baseUrl}/api/payments/create-intent`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ amount: 100, paymentMethod: "paymongo", bookingId: "CAT-404", reservationType: "catering" })
  });
  assert.equal(response.status, 404);
  const body = await response.json();
  assert.equal(body.success, false);
  assert.equal(body.message, "Catering booking not found.");
  assert.equal(body.httpStatus, undefined);
});

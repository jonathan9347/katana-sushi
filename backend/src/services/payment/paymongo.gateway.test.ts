import assert from "node:assert/strict";
import crypto from "node:crypto";
import { afterEach, beforeEach, test } from "node:test";
import { PayMongoGateway } from "./paymongo.gateway";
import { toCentavos, verifyPayMongoSignature } from "./paymongo.client";

const TEST_KEY = "sk_test_unitTestOnlyKey123";
const RETURN_URL = "https://app.example/payment/return?reference=PMG-1";

type Call = { url: string; init?: RequestInit };

function fakeFetch(responses: Array<{ status?: number; body: unknown }>) {
  const calls: Call[] = [];
  const fetchImpl = async (url: string, init?: RequestInit) => {
    calls.push({ url, init });
    const next = responses.shift();
    if (!next) {
      throw new Error(`Unexpected request to ${url}`);
    }
    return new Response(JSON.stringify(next.body), {
      status: next.status ?? 200,
      headers: { "Content-Type": "application/json" }
    });
  };
  return { calls, fetchImpl };
}

function intent(overrides: Record<string, unknown> = {}) {
  return {
    data: {
      id: "pi_test_123",
      type: "payment_intent",
      attributes: {
        amount: 15050,
        currency: "PHP",
        status: "awaiting_payment_method",
        client_key: "pi_test_123_client_abc",
        payments: [],
        next_action: null,
        ...overrides
      }
    }
  };
}

function session(overrides: Record<string, unknown> = {}) {
  return {
    data: {
      id: "cs_test_123",
      type: "checkout_session",
      attributes: { checkout_url: "https://checkout.paymongo.com/cs_test_123", status: "active", payments: [], ...overrides }
    }
  };
}

const paidPayment = {
  id: "pay_abc",
  type: "payment",
  attributes: { amount: 15050, currency: "PHP", status: "paid", paid_at: 1795479890, source: { type: "qrph" } }
};

function body(call: Call) {
  return JSON.parse(String(call.init?.body)).data.attributes;
}

function sign(payload: string, secret: string, timestamp = "1700000000") {
  return crypto.createHmac("sha256", secret).update(`${timestamp}.${payload}`).digest("hex");
}

let savedPublicKey: string | undefined;
beforeEach(() => {
  savedPublicKey = process.env.PAYMONGO_PUBLIC_KEY;
  process.env.PAYMONGO_PUBLIC_KEY = "pk_test_unitTestPublicKey1";
  delete process.env.PAYMONGO_PAYMENT_METHODS;
});
afterEach(() => {
  if (savedPublicKey === undefined) delete process.env.PAYMONGO_PUBLIC_KEY;
  else process.env.PAYMONGO_PUBLIC_KEY = savedPublicKey;
});

test("converts pesos to integer centavos without float drift", () => {
  assert.equal(toCentavos(150.5), 15050);
  assert.equal(toCentavos(0.1 + 0.2), 30);
  assert.equal(toCentavos(1234.56), 123456);
  assert.throws(() => toCentavos(0));
  assert.throws(() => toCentavos(Number.NaN));
});

test("accepts a valid test-mode webhook signature and rejects tampering", () => {
  const secret = "whsk_unit_test";
  const payload = JSON.stringify({ data: { id: "evt_1", type: "event", attributes: { livemode: false } } });
  const header = `t=1700000000,te=${sign(payload, secret)},li=`;

  assert.deepEqual(verifyPayMongoSignature(Buffer.from(payload), header, secret, false), { valid: true });
  assert.equal(verifyPayMongoSignature(Buffer.from(`${payload} `), header, secret, false).valid, false);
  assert.equal(verifyPayMongoSignature(Buffer.from(payload), header, "whsk_other", false).valid, false);
  assert.equal(verifyPayMongoSignature(Buffer.from(payload), header, secret, true).valid, false);
});

test("uses the live signature for live-mode events", () => {
  const secret = "whsk_unit_test";
  const payload = "{\"live\":true}";
  const header = `t=1700000001,te=,li=${sign(payload, secret, "1700000001")}`;
  assert.deepEqual(verifyPayMongoSignature(payload, header, secret, true), { valid: true });
});

test("rejects missing or malformed signature headers", () => {
  assert.equal(verifyPayMongoSignature("{}", undefined, "whsk", false).valid, false);
  assert.equal(verifyPayMongoSignature("{}", "garbage", "whsk", false).valid, false);
  assert.equal(verifyPayMongoSignature("{}", "t=1,te=abc", "whsk", false).valid, false);
});

test("opens a payment intent in centavos with the allowed methods and booking metadata", async () => {
  const { calls, fetchImpl } = fakeFetch([{ body: intent() }]);
  const gateway = new PayMongoGateway(TEST_KEY, fetchImpl);

  const result = await gateway.createPaymentIntent({
    amount: 2500.75,
    paymentMethod: "paymongo",
    bookingId: "CAT-20261201-001",
    reservationType: "catering",
    purpose: "downpayment",
    referenceId: "PMG-ref-1",
    description: "Katana Sushi catering CAT-20261201-001 - 50% downpayment"
  });

  assert.equal(result.success, true);
  assert.equal(result.referenceId, "PMG-ref-1");
  assert.equal(result.gatewayReference, "pi_test_123");
  assert.equal(result.paymentUrl, undefined);
  assert.ok(result.expiresAt instanceof Date);

  assert.equal(calls[0].url, "https://api.paymongo.com/v1/payment_intents");
  const headers = calls[0].init?.headers as Record<string, string>;
  assert.equal(headers.Authorization, `Basic ${Buffer.from(`${TEST_KEY}:`).toString("base64")}`);
  const attributes = body(calls[0]);
  assert.equal(attributes.amount, 250075);
  assert.equal(attributes.currency, "PHP");
  assert.equal(attributes.capture_type, "automatic");
  assert.deepEqual(attributes.payment_method_allowed, ["qrph", "card", "gcash", "paymaya"]);
  assert.equal(attributes.statement_descriptor, "KATANA SUSHI");
  assert.equal(attributes.metadata.booking_id, "CAT-20261201-001");
  assert.equal(attributes.metadata.reference_id, "PMG-ref-1");
});

test("hides card when no matching public key is configured", () => {
  delete process.env.PAYMONGO_PUBLIC_KEY;
  assert.deepEqual(new PayMongoGateway(TEST_KEY).availableChannels, ["qrph", "gcash", "paymaya"]);

  process.env.PAYMONGO_PUBLIC_KEY = "pk_live_mismatchedKey1";
  assert.equal(new PayMongoGateway(TEST_KEY).publicKey, null);
});

test("QR Ph: creates the payment method server-side and returns the QR to show", async () => {
  const { calls, fetchImpl } = fakeFetch([
    { body: { data: { id: "pm_qr1", attributes: { type: "qrph" } } } },
    {
      body: intent({
        status: "awaiting_next_action",
        next_action: {
          type: "consume_qr",
          code: { id: "qr_1", amount: 15050, image_url: "data:image/png;base64,AAAA", test_url: "https://test.example/sim", expires_at: "2026-11-24T02:20:00Z" }
        }
      })
    }
  ]);
  const gateway = new PayMongoGateway(TEST_KEY, fetchImpl);

  const result = await gateway.startPayment("pi_test_123", {
    channel: "qrph",
    billing: { name: "Juan", email: "juan@example.com", phone: "" },
    returnUrl: RETURN_URL
  });

  assert.equal(result.status, "action_required");
  assert.deepEqual(result.nextAction, {
    type: "qr",
    imageUrl: "data:image/png;base64,AAAA",
    expiresAt: "2026-11-24T02:20:00Z",
    testUrl: "https://test.example/sim"
  });
  assert.equal(calls[0].url, "https://api.paymongo.com/v1/payment_methods");
  assert.deepEqual(body(calls[0]), { type: "qrph", billing: { name: "Juan", email: "juan@example.com" } });
  assert.equal(calls[1].url, "https://api.paymongo.com/v1/payment_intents/pi_test_123/attach");
  assert.deepEqual(body(calls[1]), { payment_method: "pm_qr1", return_url: RETURN_URL });
});

test("GCash and Maya: return the wallet page to redirect to", async () => {
  const { fetchImpl } = fakeFetch([
    { body: { data: { id: "pm_gc1", attributes: { type: "gcash" } } } },
    { body: intent({ status: "awaiting_next_action", next_action: { type: "redirect", redirect: { url: "https://pm.example/gcash", return_url: RETURN_URL } } }) }
  ]);
  const result = await new PayMongoGateway(TEST_KEY, fetchImpl).startPayment("pi_test_123", { channel: "gcash", returnUrl: RETURN_URL });
  assert.deepEqual(result, { status: "action_required", nextAction: { type: "redirect", url: "https://pm.example/gcash" } });
});

test("Card: attaches the browser-created payment method and never creates one server-side", async () => {
  const { calls, fetchImpl } = fakeFetch([{ body: intent({ status: "succeeded", payments: [paidPayment] }) }]);
  const gateway = new PayMongoGateway(TEST_KEY, fetchImpl);

  const result = await gateway.startPayment("pi_test_123", { channel: "card", paymentMethodId: "pm_card1", returnUrl: RETURN_URL });
  assert.deepEqual(result, { status: "paid" });
  assert.equal(calls.length, 1);
  assert.match(calls[0].url, /\/attach$/);

  const missing = await gateway.startPayment("pi_test_123", { channel: "card", returnUrl: RETURN_URL });
  assert.equal(missing.status, "failed");
});

test("reports a declined attempt so the customer can choose again", async () => {
  const { fetchImpl } = fakeFetch([
    { body: { data: { id: "pm_gc2", attributes: { type: "gcash" } } } },
    { body: intent({ status: "awaiting_payment_method", last_payment_error: { failed_message: "Insufficient balance." } }) }
  ]);
  const result = await new PayMongoGateway(TEST_KEY, fetchImpl).startPayment("pi_test_123", { channel: "gcash", returnUrl: RETURN_URL });
  assert.deepEqual(result, { status: "failed", message: "Insufficient balance." });
});

test("verifies a paid intent with the PayMongo payment id, amount, and channel", async () => {
  const { fetchImpl } = fakeFetch([{ body: intent({ status: "succeeded", payments: [paidPayment] }) }]);
  const result = await new PayMongoGateway(TEST_KEY, fetchImpl).verifyPayment({ referenceId: "PMG-1", bookingId: "CAT-1", gatewayReference: "pi_test_123" });
  assert.equal(result.success, true);
  assert.equal(result.status, "paid");
  assert.equal(result.amount, 150.5);
  assert.equal(result.transactionId, "pay_abc");
  assert.equal(result.paymentChannel, "qrph");
  assert.equal(result.paidAt?.getTime(), 1795479890 * 1000);
});

test("reports a pending intent with its QR and last error", async () => {
  const { fetchImpl } = fakeFetch([{
    body: intent({
      status: "awaiting_next_action",
      next_action: { type: "consume_qr", code: { id: "qr_1", amount: 15050, image_url: "data:image/png;base64,BBBB" } },
      last_payment_error: "Card declined."
    })
  }]);
  const result = await new PayMongoGateway(TEST_KEY, fetchImpl).verifyPayment({ referenceId: "PMG-1", bookingId: "CAT-1", gatewayReference: "pi_test_123" });
  assert.equal(result.status, "pending");
  assert.equal(result.transactionId, "");
  assert.equal(result.nextAction?.type, "qr");
  assert.equal(result.lastError, "Card declined.");
});

test("still reads payments started on the old checkout page", async () => {
  const { fetchImpl } = fakeFetch([
    { body: session({ payments: [paidPayment] }) },
    { body: session({ status: "expired" }) }
  ]);
  const gateway = new PayMongoGateway(TEST_KEY, fetchImpl);
  const paid = await gateway.verifyPayment({ referenceId: "PMG-1", bookingId: "CAT-1", gatewayReference: "cs_test_123" });
  assert.equal(paid.status, "paid");
  assert.equal(paid.transactionId, "pay_abc");
  const expired = await gateway.verifyPayment({ referenceId: "PMG-1", bookingId: "CAT-1", gatewayReference: "cs_test_123" });
  assert.equal(expired.status, "expired");
});

test("resumes open intents, never old checkout sessions", async () => {
  const { calls, fetchImpl } = fakeFetch([
    { body: intent() },
    { body: intent({ status: "succeeded", payments: [paidPayment] }) }
  ]);
  const gateway = new PayMongoGateway(TEST_KEY, fetchImpl);
  assert.deepEqual(await gateway.resumePaymentIntent("pi_test_123"), { paymentUrl: "" });
  assert.equal(await gateway.resumePaymentIntent("pi_test_123"), null);
  assert.equal(await gateway.resumePaymentIntent("cs_old_1"), null);
  assert.equal(calls.length, 2);
});

test("expires old checkout sessions, tolerating ones PayMongo already closed; intents are left alone", async () => {
  const { calls, fetchImpl } = fakeFetch([
    { status: 400, body: { errors: [{ code: "invalid_request_body", detail: "Checkout session is already paid" }] } },
    { status: 503, body: { errors: [{ detail: "unavailable" }] } }
  ]);
  const gateway = new PayMongoGateway(TEST_KEY, fetchImpl);

  await gateway.cancelPaymentIntent("cs_test_123");
  await assert.rejects(() => gateway.cancelPaymentIntent("cs_test_123"), /unavailable/);
  await gateway.cancelPaymentIntent("pi_test_123");
  assert.equal(calls.length, 2);
});

test("fails closed without a valid secret key", async () => {
  const missing = new PayMongoGateway("");
  assert.equal(missing.isConfigured, false);
  await assert.rejects(
    () => missing.createPaymentIntent({ amount: 100, paymentMethod: "paymongo", bookingId: "CAT-1", reservationType: "catering" }),
    /PAYMONGO_SECRET_KEY/
  );

  const publicKey = new PayMongoGateway("pk_test_notASecretKey");
  assert.equal(publicKey.isConfigured, false);
  assert.match(publicKey.configurationProblem ?? "", /secret key/);
});

import assert from "node:assert/strict";
import crypto from "node:crypto";
import { test } from "node:test";
import { PayMongoGateway } from "./paymongo.gateway";
import { toCentavos, verifyPayMongoSignature } from "./paymongo.client";

const TEST_KEY = "sk_test_unitTestOnlyKey123";

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

function session(overrides: Record<string, unknown> = {}) {
  return {
    data: {
      id: "cs_test_123",
      type: "checkout_session",
      attributes: {
        checkout_url: "https://checkout.paymongo.com/cs_test_123",
        status: "active",
        payments: [],
        ...overrides
      }
    }
  };
}

function sign(body: string, secret: string, timestamp = "1700000000") {
  return crypto.createHmac("sha256", secret).update(`${timestamp}.${body}`).digest("hex");
}

test("converts pesos to integer centavos without float drift", () => {
  assert.equal(toCentavos(150.5), 15050);
  assert.equal(toCentavos(0.1 + 0.2), 30);
  assert.equal(toCentavos(1234.56), 123456);
  assert.throws(() => toCentavos(0));
  assert.throws(() => toCentavos(Number.NaN));
});

test("accepts a valid test-mode webhook signature and rejects tampering", () => {
  const secret = "whsk_unit_test";
  const body = JSON.stringify({ data: { id: "evt_1", type: "event", attributes: { livemode: false } } });
  const header = `t=1700000000,te=${sign(body, secret)},li=`;

  assert.deepEqual(verifyPayMongoSignature(Buffer.from(body), header, secret, false), { valid: true });
  assert.equal(verifyPayMongoSignature(Buffer.from(`${body} `), header, secret, false).valid, false);
  assert.equal(verifyPayMongoSignature(Buffer.from(body), header, "whsk_other", false).valid, false);
  // A test signature must not satisfy a live-mode event.
  assert.equal(verifyPayMongoSignature(Buffer.from(body), header, secret, true).valid, false);
});

test("uses the live signature for live-mode events", () => {
  const secret = "whsk_unit_test";
  const body = "{\"live\":true}";
  const header = `t=1700000001,te=,li=${sign(body, secret, "1700000001")}`;
  assert.deepEqual(verifyPayMongoSignature(body, header, secret, true), { valid: true });
});

test("rejects missing or malformed signature headers", () => {
  assert.equal(verifyPayMongoSignature("{}", undefined, "whsk", false).valid, false);
  assert.equal(verifyPayMongoSignature("{}", "garbage", "whsk", false).valid, false);
  assert.equal(verifyPayMongoSignature("{}", "t=1,te=abc", "whsk", false).valid, false);
});

test("creates a checkout session with centavo amounts, methods, and return URLs", async () => {
  const { calls, fetchImpl } = fakeFetch([{ body: session() }]);
  const gateway = new PayMongoGateway(TEST_KEY, fetchImpl);

  const result = await gateway.createPaymentIntent({
    amount: 2500.75,
    paymentMethod: "paymongo",
    bookingId: "CAT-20261201-001",
    reservationType: "catering",
    purpose: "downpayment",
    referenceId: "PMG-ref-1",
    lineItemName: "Catering package downpayment (50%)",
    description: "Katana Sushi catering CAT-20261201-001 - 50% downpayment",
    customer: { name: "Juan", email: "juan@example.com", phone: "" },
    successUrl: "https://app.example/payment/return?reference=PMG-ref-1",
    failureUrl: "https://app.example/payment/return?reference=PMG-ref-1&cancelled=1"
  });

  assert.equal(result.success, true);
  assert.equal(result.referenceId, "PMG-ref-1");
  assert.equal(result.gatewayReference, "cs_test_123");
  assert.equal(result.paymentUrl, "https://checkout.paymongo.com/cs_test_123");
  assert.ok(result.expiresAt instanceof Date);

  assert.equal(calls[0].url, "https://api.paymongo.com/v1/checkout_sessions");
  assert.equal(calls[0].init?.method, "POST");
  const headers = calls[0].init?.headers as Record<string, string>;
  assert.equal(headers.Authorization, `Basic ${Buffer.from(`${TEST_KEY}:`).toString("base64")}`);

  const attributes = JSON.parse(String(calls[0].init?.body)).data.attributes;
  assert.equal(attributes.line_items[0].amount, 250075);
  assert.equal(attributes.line_items[0].currency, "PHP");
  assert.equal(attributes.line_items[0].quantity, 1);
  assert.deepEqual(attributes.payment_method_types, ["qrph", "card", "gcash", "paymaya"]);
  assert.equal(attributes.reference_number, "CAT-20261201-001");
  assert.equal(attributes.success_url, "https://app.example/payment/return?reference=PMG-ref-1");
  assert.equal(attributes.cancel_url, "https://app.example/payment/return?reference=PMG-ref-1&cancelled=1");
  assert.deepEqual(attributes.billing, { name: "Juan", email: "juan@example.com" });
  assert.equal(attributes.metadata.reference_id, "PMG-ref-1");
  assert.equal(attributes.send_email_receipt, true);
});

test("reports a paid checkout with the PayMongo payment id, amount, and channel", async () => {
  const { fetchImpl } = fakeFetch([{
    body: session({
      payments: [{
        id: "pay_abc",
        type: "payment",
        attributes: { amount: 15050, currency: "PHP", status: "paid", paid_at: 1795479890, source: { type: "qrph" } }
      }]
    })
  }]);
  const gateway = new PayMongoGateway(TEST_KEY, fetchImpl);

  const result = await gateway.verifyPayment({ referenceId: "PMG-1", bookingId: "CAT-1", gatewayReference: "cs_test_123" });
  assert.equal(result.success, true);
  assert.equal(result.status, "paid");
  assert.equal(result.amount, 150.5);
  assert.equal(result.transactionId, "pay_abc");
  assert.equal(result.paymentChannel, "qrph");
  assert.equal(result.paidAt?.getTime(), 1795479890 * 1000);
});

test("reports pending and expired checkouts without a transaction", async () => {
  const { fetchImpl } = fakeFetch([
    { body: session() },
    { body: session({ status: "expired" }) }
  ]);
  const gateway = new PayMongoGateway(TEST_KEY, fetchImpl);

  const pending = await gateway.verifyPayment({ referenceId: "PMG-1", bookingId: "CAT-1", gatewayReference: "cs_test_123" });
  assert.equal(pending.status, "pending");
  assert.equal(pending.success, false);
  assert.equal(pending.transactionId, "");

  const expired = await gateway.verifyPayment({ referenceId: "PMG-1", bookingId: "CAT-1", gatewayReference: "cs_test_123" });
  assert.equal(expired.status, "expired");
});

test("resumes only active, unpaid checkouts", async () => {
  const { fetchImpl } = fakeFetch([
    { body: session() },
    { body: session({ status: "expired" }) },
    { body: session({ payments: [{ id: "pay_x", type: "payment", attributes: { amount: 100, currency: "PHP", status: "paid" } }] }) }
  ]);
  const gateway = new PayMongoGateway(TEST_KEY, fetchImpl);

  assert.deepEqual(await gateway.resumePaymentIntent("cs_test_123"), { paymentUrl: "https://checkout.paymongo.com/cs_test_123" });
  assert.equal(await gateway.resumePaymentIntent("cs_test_123"), null);
  assert.equal(await gateway.resumePaymentIntent("cs_test_123"), null);
});

test("tolerates expiring a session PayMongo already closed, but not outages", async () => {
  const { fetchImpl } = fakeFetch([
    { status: 400, body: { errors: [{ code: "invalid_request_body", detail: "Checkout session is already paid" }] } },
    { status: 503, body: { errors: [{ detail: "unavailable" }] } }
  ]);
  const gateway = new PayMongoGateway(TEST_KEY, fetchImpl);

  await gateway.cancelPaymentIntent("cs_test_123");
  await assert.rejects(() => gateway.cancelPaymentIntent("cs_test_123"), /unavailable/);
});

test("fails closed without a valid secret key", async () => {
  const missing = new PayMongoGateway("");
  assert.equal(missing.isConfigured, false);
  await assert.rejects(
    () => missing.createPaymentIntent({
      amount: 100,
      paymentMethod: "paymongo",
      bookingId: "CAT-1",
      reservationType: "catering",
      successUrl: "https://a/b",
      failureUrl: "https://a/c"
    }),
    /PAYMONGO_SECRET_KEY/
  );

  const publicKey = new PayMongoGateway("pk_test_notASecretKey");
  assert.equal(publicKey.isConfigured, false);
  assert.match(publicKey.configurationProblem ?? "", /secret key/);
});

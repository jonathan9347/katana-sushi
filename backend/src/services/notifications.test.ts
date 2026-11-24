import assert from "node:assert/strict";
import { afterEach, beforeEach, test } from "node:test";
import { TextBeeSmsService, toPhilippineMobileE164 } from "./sms.service";
import { NotificationService } from "./notification.service";
import { registerNotificationPreferences } from "./notificationPreferences";
import { getSmtpConfig } from "./email.service";

type Call = { url: string; init?: RequestInit };

function fakeFetch(status = 200, body: unknown = { data: { success: true } }) {
  const calls: Call[] = [];
  const fetchImpl = async (url: string, init?: RequestInit) => {
    calls.push({ url, init });
    return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
  };
  return { calls, fetchImpl };
}

let savedNodeEnv: string | undefined;
let savedSmsFlag: string | undefined;
beforeEach(() => {
  savedNodeEnv = process.env.NODE_ENV;
  savedSmsFlag = process.env.SEND_SMS_IN_DEVELOPMENT;
  process.env.SEND_SMS_IN_DEVELOPMENT = "true";
  registerNotificationPreferences(async () => ({ email: true, sms: true }));
});
afterEach(() => {
  if (savedNodeEnv === undefined) delete process.env.NODE_ENV;
  else process.env.NODE_ENV = savedNodeEnv;
  if (savedSmsFlag === undefined) delete process.env.SEND_SMS_IN_DEVELOPMENT;
  else process.env.SEND_SMS_IN_DEVELOPMENT = savedSmsFlag;
});

test("normalizes Philippine mobile numbers to +63 format", () => {
  assert.equal(toPhilippineMobileE164("09171234567"), "+639171234567");
  assert.equal(toPhilippineMobileE164("0917 123 4567"), "+639171234567");
  assert.equal(toPhilippineMobileE164("+639171234567"), "+639171234567");
  assert.equal(toPhilippineMobileE164("639171234567"), "+639171234567");
  assert.equal(toPhilippineMobileE164("9171234567"), "+639171234567");
  assert.equal(toPhilippineMobileE164("0281234567"), null);
  assert.equal(toPhilippineMobileE164("12345"), null);
  assert.equal(toPhilippineMobileE164(undefined), null);
});

test("sends SMS through the TextBee device with the API key header", async () => {
  const { calls, fetchImpl } = fakeFetch();
  const sms = new TextBeeSmsService("txb_unitTestKey", "device123", fetchImpl);

  const result = await sms.send("09171234567", "Hello from Katana");
  assert.deepEqual(result, { sent: true });
  assert.equal(calls[0].url, "https://api.textbee.dev/api/v1/gateway/devices/device123/send-sms");
  assert.equal((calls[0].init?.headers as Record<string, string>)["x-api-key"], "txb_unitTestKey");
  assert.deepEqual(JSON.parse(String(calls[0].init?.body)), { recipients: ["+639171234567"], message: "Hello from Katana" });
});

test("never throws when TextBee fails, is unreachable, or is not configured", async () => {
  const failing = new TextBeeSmsService("txb_k", "dev", fakeFetch(500, { error: "down" }).fetchImpl);
  assert.equal((await failing.send("09171234567", "x")).sent, false);

  const unreachable = new TextBeeSmsService("txb_k", "dev", async () => { throw new Error("offline"); });
  assert.equal((await unreachable.send("09171234567", "x")).sent, false);

  const unconfigured = new TextBeeSmsService("", "", fakeFetch().fetchImpl);
  assert.equal((await unconfigured.send("09171234567", "x")).sent, false);
});

test("skips invalid numbers and stays quiet in development unless enabled", async () => {
  const { calls, fetchImpl } = fakeFetch();
  const sms = new TextBeeSmsService("txb_k", "dev", fetchImpl);
  assert.equal((await sms.send("not-a-number", "x")).sent, false);

  process.env.SEND_SMS_IN_DEVELOPMENT = "false";
  process.env.NODE_ENV = "development";
  assert.equal((await sms.send("09171234567", "x")).sent, false);
  assert.equal(calls.length, 0);
});

test("customer notices respect the admin SMS switch", async () => {
  const { calls, fetchImpl } = fakeFetch();
  const notifications = new NotificationService(new TextBeeSmsService("txb_k", "dev", fetchImpl));

  registerNotificationPreferences(async () => ({ email: true, sms: false }));
  const off = await notifications.sendCateringApproved("CAT-1", { phone: "09171234567" }, "2026-12-01T00:00:00Z");
  assert.equal(off.sent, false);
  assert.equal(calls.length, 0);

  registerNotificationPreferences(async () => ({ email: true, sms: true }));
  const on = await notifications.sendCateringReceived("CAT-1", { phone: "09171234567" }, 6000);
  assert.equal(on.sent, true);
  const message = JSON.parse(String(calls[0].init?.body)).message as string;
  assert.match(message, /CAT-1/);
  assert.match(message, /PHP 6,000\.00/);
  assert.match(message, /Katana Sushi/);
});

test("reservation SMS shows a friendly date and 12-hour time", async () => {
  const { calls, fetchImpl } = fakeFetch();
  const notifications = new NotificationService(new TextBeeSmsService("txb_k", "dev", fetchImpl));
  await notifications.sendConfirmation("KTN-1", { phone: "09171234567" }, { date: new Date("2026-12-24T04:00:00Z"), time: "18:30" });
  const message = JSON.parse(String(calls[0].init?.body)).message as string;
  assert.match(message, /Dec 24, 2026/);
  assert.match(message, /6:30 PM/);
});

test("reads Gmail SMTP settings: 465 uses SSL/TLS, 587 uses STARTTLS", () => {
  assert.equal(getSmtpConfig({}), null);

  const ssl = getSmtpConfig({ SMTP_USER: "katana@gmail.com", SMTP_PASS: "abcd efgh ijkl mnop" });
  assert.deepEqual(ssl, {
    host: "smtp.gmail.com",
    port: 465,
    secure: true,
    requireTLS: false,
    auth: { user: "katana@gmail.com", pass: "abcdefghijklmnop" },
    from: "Katana Sushi <katana@gmail.com>"
  });

  const starttls = getSmtpConfig({ SMTP_USER: "katana@gmail.com", SMTP_PASS: "x", SMTP_PORT: "587", EMAIL_FROM: "Katana <katana@gmail.com>" });
  assert.equal(starttls?.port, 587);
  assert.equal(starttls?.secure, false);
  assert.equal(starttls?.requireTLS, true);
  assert.equal(starttls?.from, "Katana <katana@gmail.com>");
});

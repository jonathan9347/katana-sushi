import assert from "node:assert/strict";
import { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { after, before, beforeEach, test } from "node:test";
import bcrypt from "bcrypt";
import express from "express";
import { SupabaseEmailOtp } from "../lib/supabaseOtp";
import { createStaffPasswordRouter, StaffPasswordStore } from "./staffPassword.routes";

type Call = { url: string; body: any };

// Fake Supabase Auth: code "123456" is valid for any email it was sent to.
const supabaseCalls: Call[] = [];
let supabaseStatus = 200;
const fakeSupabase = async (url: string, init?: RequestInit) => {
  const body = JSON.parse(String(init?.body));
  supabaseCalls.push({ url, body });
  if (supabaseStatus !== 200) {
    return new Response(JSON.stringify({ msg: "rate limited" }), { status: supabaseStatus });
  }
  if (url.endsWith("/auth/v1/verify")) {
    return body.token === "123456"
      ? new Response(JSON.stringify({ access_token: "x", user: { email: body.email } }), { status: 200 })
      : new Response(JSON.stringify({ msg: "Token has expired or is invalid" }), { status: 403 });
  }
  return new Response("{}", { status: 200 });
};

const users = new Map([
  ["chef@katana.test", { id: "u1", name: "Chef", is_active: true }],
  ["former@katana.test", { id: "u2", name: "Former", is_active: false }]
]);
const savedHashes = new Map<string, string>();
const store: StaffPasswordStore = {
  findByEmail: async (email) => users.get(email) ?? null,
  savePassword: async (user, hash) => { savedHashes.set(user.id, hash); }
};

let clock = 1_000_000;
let server: Server;
let baseUrl = "";

before(async () => {
  const app = express();
  app.use(express.json());
  app.use("/api", createStaffPasswordRouter({
    otp: new SupabaseEmailOtp("https://project.supabase.co", "sb_test_key", fakeSupabase),
    store,
    now: () => clock
  }));
  server = app.listen(0);
  await new Promise<void>((resolve) => server.once("listening", () => resolve()));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

after(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

beforeEach(() => {
  supabaseCalls.length = 0;
  supabaseStatus = 200;
  clock += 10 * 60_000;
});

function post(path: string, body: unknown) {
  return fetch(`${baseUrl}/api${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });
}

test("sends a code to an active staff account through Supabase", async () => {
  const response = await post("/auth/password/forgot", { email: "  Chef@Katana.test " });
  assert.equal(response.status, 200);
  assert.equal(supabaseCalls.length, 1);
  assert.equal(supabaseCalls[0].url, "https://project.supabase.co/auth/v1/otp");
  assert.deepEqual(supabaseCalls[0].body, { email: "chef@katana.test", create_user: true });
});

test("gives the same answer for unknown or inactive accounts and sends nothing", async () => {
  const known = await (await post("/auth/password/forgot", { email: "chef@katana.test" })).json();
  supabaseCalls.length = 0;
  clock += 10 * 60_000;

  for (const email of ["nobody@katana.test", "former@katana.test"]) {
    const response = await post("/auth/password/forgot", { email });
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), known);
  }
  assert.equal(supabaseCalls.length, 0);
});

test("asks the user to wait before sending another code", async () => {
  assert.equal((await post("/auth/password/forgot", { email: "chef@katana.test" })).status, 200);
  assert.equal((await post("/auth/password/forgot", { email: "chef@katana.test" })).status, 429);
  clock += 61_000;
  assert.equal((await post("/auth/password/forgot", { email: "chef@katana.test" })).status, 200);
});

test("sets a new password only with a valid code", async () => {
  const wrong = await post("/auth/password/reset", { email: "chef@katana.test", code: "999999", password: "newpassword1" });
  assert.equal(wrong.status, 400);
  assert.equal(savedHashes.has("u1"), false);

  const right = await post("/auth/password/reset", { email: "Chef@katana.test", code: "123456", password: "newpassword1" });
  assert.equal(right.status, 200);
  assert.equal(await bcrypt.compare("newpassword1", savedHashes.get("u1")!), true);
});

test("never resets inactive or unknown accounts, even with a valid code", async () => {
  for (const email of ["former@katana.test", "nobody@katana.test"]) {
    const response = await post("/auth/password/reset", { email, code: "123456", password: "newpassword1" });
    assert.equal(response.status, 400);
  }
  assert.equal(savedHashes.has("u2"), false);
  assert.equal(supabaseCalls.some((call) => call.url.endsWith("/verify")), false);
});

test("locks out after five wrong codes", async () => {
  const email = "chef@katana.test";
  for (let attempt = 0; attempt < 5; attempt += 1) {
    assert.equal((await post("/auth/password/reset", { email, code: "000000", password: "newpassword1" })).status, 400);
  }
  const blocked = await post("/auth/password/reset", { email, code: "123456", password: "newpassword1" });
  assert.equal(blocked.status, 429);
});

test("rejects short passwords and malformed codes before calling Supabase", async () => {
  assert.equal((await post("/auth/password/reset", { email: "chef@katana.test", code: "123456", password: "short" })).status, 400);
  assert.equal((await post("/auth/password/reset", { email: "chef@katana.test", code: "abc", password: "newpassword1" })).status, 400);
  assert.equal(supabaseCalls.length, 0);
});

test("explains when Supabase is not configured", async () => {
  const app = express();
  app.use(express.json());
  app.use("/api", createStaffPasswordRouter({ otp: new SupabaseEmailOtp("https://your-project-ref.supabase.co", "your-service-role-key"), store }));
  const local = app.listen(0);
  await new Promise<void>((resolve) => local.once("listening", () => resolve()));
  const response = await fetch(`http://127.0.0.1:${(local.address() as AddressInfo).port}/api/auth/password/forgot`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: "chef@katana.test" })
  });
  await new Promise<void>((resolve) => local.close(() => resolve()));
  assert.equal(response.status, 503);
});

test("verifyCode refuses a code Supabase issued for a different email", async () => {
  const otp = new SupabaseEmailOtp("https://project.supabase.co", "sb_test_key", async () =>
    new Response(JSON.stringify({ user: { email: "someone-else@katana.test" } }), { status: 200 })
  );
  const result = await otp.verifyCode("chef@katana.test", "123456");
  assert.equal(result.ok, false);
});

test("sends new-style keys only as apikey, and strips pasted line breaks", async () => {
  const seen: Array<Record<string, string>> = [];
  const capture = async (_url: string, init?: RequestInit) => {
    seen.push(init?.headers as Record<string, string>);
    return new Response("{}", { status: 200 });
  };
  await new SupabaseEmailOtp("https://project.supabase.co", "sb_publishable_abc\n123", capture).sendCode("a@b.test");
  assert.equal(seen[0].apikey, "sb_publishable_abc123");
  assert.equal(seen[0].Authorization, undefined);

  await new SupabaseEmailOtp("https://project.supabase.co", " eyJhbGci.payload.sig ", capture).sendCode("a@b.test");
  assert.equal(seen[1].apikey, "eyJhbGci.payload.sig");
  assert.equal(seen[1].Authorization, "Bearer eyJhbGci.payload.sig");
});

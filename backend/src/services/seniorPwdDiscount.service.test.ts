import assert from "node:assert/strict";
import { test } from "node:test";
import { calculateSeniorPwdDiscount } from "./seniorPwdDiscount.service";

test("applies 20 percent to the a-la-carte share for senior/PWD guests", () => {
  const result = calculateSeniorPwdDiscount({
    aLaCarteTotal: 1000,
    guestCount: 10,
    seniorPwdCount: 3,
    discountRate: 0.2
  });

  assert.equal(result.discountBase, 1000);
  assert.equal(result.discountAmount, 60);
  assert.notEqual(result.discountAmount, 300);
  assert.equal(1000 - result.discountAmount, 940);
});

test("rounds half up once from the unrounded share", () => {
  const result = calculateSeniorPwdDiscount({
    aLaCarteTotal: 0.25,
    guestCount: 2,
    seniorPwdCount: 1,
    discountRate: 0.2
  });

  assert.equal(result.discountAmount, 0.03);
});

test("zero senior/PWD guests produce no discount", () => {
  assert.equal(calculateSeniorPwdDiscount({
    aLaCarteTotal: 1000,
    guestCount: 10,
    seniorPwdCount: 0,
    discountRate: 0.2
  }).discountAmount, 0);
});

test("validates headcount, eligible count, amount, and rate", () => {
  const valid = { aLaCarteTotal: 100, guestCount: 2, seniorPwdCount: 1, discountRate: 0.2 };
  assert.throws(() => calculateSeniorPwdDiscount({ ...valid, guestCount: 0 }), /at least 1/);
  assert.throws(() => calculateSeniorPwdDiscount({ ...valid, seniorPwdCount: 3 }), /between 0 and total guests/);
  assert.throws(() => calculateSeniorPwdDiscount({ ...valid, aLaCarteTotal: -1 }), /non-negative/);
  assert.throws(() => calculateSeniorPwdDiscount({ ...valid, discountRate: 1.1 }), /between 0 and 1/);
});

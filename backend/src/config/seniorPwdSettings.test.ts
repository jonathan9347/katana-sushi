import assert from "node:assert/strict";
import { test } from "node:test";
import { parseSeniorPwdDiscountRate } from "./seniorPwdSettings";

test("defaults the senior/PWD discount rate to 20 percent", () => {
  assert.equal(parseSeniorPwdDiscountRate(undefined), 0.2);
});

test("accepts configured rates from zero through one", () => {
  assert.equal(parseSeniorPwdDiscountRate("0"), 0);
  assert.equal(parseSeniorPwdDiscountRate("0.2"), 0.2);
  assert.equal(parseSeniorPwdDiscountRate("1"), 1);
});

test("rejects invalid senior/PWD discount rates", () => {
  for (const value of ["", "abc", "-0.01", "1.01"]) {
    assert.throws(() => parseSeniorPwdDiscountRate(value), /between 0 and 1/);
  }
});

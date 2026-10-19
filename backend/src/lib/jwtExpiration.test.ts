import assert from "node:assert/strict";
import { test } from "node:test";
import { jwtExpirationSeconds } from "./jwtExpiration";

test("converts JWT duration strings to seconds", () => {
  assert.equal(jwtExpirationSeconds("8h"), 8 * 60 * 60);
  assert.equal(jwtExpirationSeconds("2 days"), 2 * 24 * 60 * 60);
  assert.equal(jwtExpirationSeconds("3600000"), 3600);
  assert.equal(jwtExpirationSeconds("500ms"), 0);
});

test("rejects invalid or non-positive JWT durations", () => {
  for (const value of ["", "soon", "0s", "-1h", "1 month", "1".repeat(101)]) {
    assert.throws(() => jwtExpirationSeconds(value), /JWT_EXPIRES_IN must be a positive duration/);
  }
});

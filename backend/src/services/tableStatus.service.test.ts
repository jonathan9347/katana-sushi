import test from "node:test";
import assert from "node:assert/strict";

import { normalizeTableStatus } from "./tableStatus.service";

test("normalizes legacy uppercase table statuses", () => {
  assert.equal(normalizeTableStatus("AVAILABLE"), "available");
  assert.equal(normalizeTableStatus("OCCUPIED"), "occupied");
  assert.equal(normalizeTableStatus("RESERVED"), "reserved");
});

test("normalizes current lowercase table statuses and surrounding whitespace", () => {
  assert.equal(normalizeTableStatus("available"), "available");
  assert.equal(normalizeTableStatus(" occupied "), "occupied");
});

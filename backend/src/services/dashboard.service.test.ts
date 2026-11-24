import assert from "node:assert/strict";
import { test } from "node:test";
import {
  DASHBOARD_CRITICAL_STOCK_PERCENT,
  getDashboardStockSeverity,
  localDateTimeToUtc
} from "./dashboard.service";

test("dashboard day boundaries use business-local time, including midnight Manila", () => {
  assert.equal(
    localDateTimeToUtc("2026-10-26", "Asia/Manila").toISOString(),
    "2026-10-25T16:00:00.000Z"
  );
  assert.equal(
    localDateTimeToUtc("2026-10-27", "Asia/Manila").toISOString(),
    "2026-10-26T16:00:00.000Z"
  );
});

test("dashboard inventory critical threshold is centralized at 25 percent", () => {
  assert.equal(DASHBOARD_CRITICAL_STOCK_PERCENT, 25);
  assert.equal(getDashboardStockSeverity(0, 100), "critical");
  assert.equal(getDashboardStockSeverity(1, 25), "critical");
  assert.equal(getDashboardStockSeverity(26, 26), "reorder");
});

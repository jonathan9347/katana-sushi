import test from "node:test";
import assert from "node:assert/strict";

import {
  findBestTableCombination,
  getReservationTableHoldsForDate,
  isSameDayReservationWindow
} from "./tableAllocation.service";

test("fits six guests with a 2-seat plus 4-seat table", () => {
  const result = findBestTableCombination(6, [
    { id: "t1", table_number: 1, capacity: 2 },
    { id: "t2", table_number: 2, capacity: 4 }
  ]);

  assert.deepEqual(result, {
    tableIds: ["t1", "t2"],
    totalCapacity: 6,
    unusedSeats: 0,
    tableCount: 2
  });
});

test("prefers the minimum number of tables even if a single larger table wastes fewer seats", () => {
  const result = findBestTableCombination(5, [
    { id: "a", table_number: 1, capacity: 2 },
    { id: "b", table_number: 2, capacity: 2 },
    { id: "c", table_number: 3, capacity: 4 },
    { id: "d", table_number: 4, capacity: 6 }
  ]);

  assert.deepEqual(result, {
    tableIds: ["d"],
    totalCapacity: 6,
    unusedSeats: 1,
    tableCount: 1
  });
});

test("rejects impossible allocations", () => {
  const result = findBestTableCombination(12, [
    { id: "a", table_number: 1, capacity: 2 },
    { id: "b", table_number: 2, capacity: 2 }
  ]);

  assert.equal(result, null);
});

test("does not allocate occupied or archived tables", () => {
  const result = findBestTableCombination(2, [
    { id: "occupied", table_number: 1, capacity: 4, status: "OCCUPIED" },
    { id: "archived", table_number: 2, capacity: 4, is_archived: true },
    { id: "available", table_number: 3, capacity: 2, status: "AVAILABLE" }
  ]);

  assert.deepEqual(result, {
    tableIds: ["available"],
    totalCapacity: 2,
    unusedSeats: 0,
    tableCount: 1
  });
});

test("same-day POS occupancy lookahead includes exactly two hours", () => {
  const now = new Date("2026-10-17T18:00:00");
  assert.equal(isSameDayReservationWindow(new Date("2026-10-17T00:00:00"), "18:30", now), true);
  assert.equal(isSameDayReservationWindow(new Date("2026-10-17T00:00:00"), "20:00", now), true);
  assert.equal(isSameDayReservationWindow(new Date("2026-10-17T00:00:00"), "20:01", now), false);
});

test("active reservations hold tables for the date until staff releases or completes them", () => {
  const date = new Date("2026-10-17T00:00:00");
  const activeReservations = [
    { date, time: "18:00", party_size: 2 },
    { date: new Date("2026-10-18T00:00:00"), time: "10:00", party_size: 2 }
  ];

  assert.deepEqual(getReservationTableHoldsForDate(date, activeReservations), [activeReservations[0]]);
});

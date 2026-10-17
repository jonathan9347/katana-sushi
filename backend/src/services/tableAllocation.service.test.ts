import test from "node:test";
import assert from "node:assert/strict";

import {
  findBestTableCombination,
  getTablesUnavailableForSlot,
  type TablePlanningWindow
} from "./tableAllocation.service";

const estimatedDurationMinutes = 120;

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

test("excludes archived and already allocated tables", () => {
  const result = findBestTableCombination(2, [
    { id: "archived", table_number: 2, capacity: 4, is_archived: true },
    { id: "held", table_number: 1, capacity: 4 },
    { id: "available", table_number: 3, capacity: 2 }
  ], { unavailableTableIds: ["held"] });

  assert.deepEqual(result, {
    tableIds: ["available"],
    totalCapacity: 2,
    unusedSeats: 0,
    tableCount: 1
  });
});

test("reservation assignments block a slot only when estimated intervals overlap", () => {
  const reservations: TablePlanningWindow[] = [
    { serviceDate: "2026-10-17", startTime: "18:00", tableIds: ["t1"] }
  ];

  assert.deepEqual(
    getTablesUnavailableForSlot("2026-10-17", "19:59", estimatedDurationMinutes, reservations, []),
    ["t1"]
  );
  assert.deepEqual(
    getTablesUnavailableForSlot("2026-10-17", "20:00", estimatedDurationMinutes, reservations, []),
    []
  );
  assert.deepEqual(
    getTablesUnavailableForSlot("2026-10-18", "18:00", estimatedDurationMinutes, reservations, []),
    []
  );
});

test("same-day POS sessions affect planning availability by estimated interval", () => {
  const sessions: TablePlanningWindow[] = [
    { serviceDate: "2026-10-17", startTime: "18:00", tableIds: ["t2"] }
  ];

  assert.deepEqual(
    getTablesUnavailableForSlot("2026-10-17", "19:00", estimatedDurationMinutes, [], sessions),
    ["t2"]
  );
  assert.deepEqual(
    getTablesUnavailableForSlot("2026-10-17", "20:00", estimatedDurationMinutes, [], sessions),
    []
  );
  assert.deepEqual(
    getTablesUnavailableForSlot("2026-10-18", "19:00", estimatedDurationMinutes, [], sessions),
    []
  );
  assert.equal(sessions[0].tableIds[0], "t2");
});

test("uses stable table ID order to break otherwise equal allocation ties", () => {
  const result = findBestTableCombination(2, [
    { id: "b", table_number: 2, capacity: 2 },
    { id: "a", table_number: 1, capacity: 2 }
  ]);

  assert.deepEqual(result, {
    tableIds: ["a"],
    totalCapacity: 2,
    unusedSeats: 0,
    tableCount: 1
  });
});

test("rejects an invalid estimated duration instead of silently treating it as an availability rule", () => {
  assert.throws(
    () => getTablesUnavailableForSlot("2026-10-17", "18:00", 0, [], []),
    RangeError
  );
});

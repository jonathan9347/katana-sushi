import test from "node:test";
import assert from "node:assert/strict";

import {
  assertCanArchiveTable,
  assertCanChangeTableAvailability,
  assertCanEditTableSeats,
  assertCanLinkUnavailableTable,
  getNextTableNumber,
  type ManagedTableState
} from "./tableManagement.service";

function table(overrides: Partial<ManagedTableState> = {}): ManagedTableState {
  return {
    id: "table-1",
    status: "available",
    is_archived: false,
    linked_to_table_id: null,
    has_active_session: false,
    has_linked_tables: false,
    has_seated_customer: false,
    ...overrides
  };
}

test("allocates a table number above every existing number, including archived tables", () => {
  assert.equal(getNextTableNumber([1, 2, 16, 20]), 21);
  assert.equal(getNextTableNumber([]), 1);
});

test("rejects table numbers beyond PostgreSQL INTEGER range", () => {
  assert.throws(() => getNextTableNumber([2_147_483_647]), /No table numbers remain available/);
});

test("blocks seat edits and archive when a table is occupied or archived", () => {
  assert.throws(() => assertCanEditTableSeats(table({ status: "OCCUPIED" })), /seated customer/);
  assert.throws(() => assertCanArchiveTable(table({ is_archived: true })), /Archived tables/);
  assert.throws(() => assertCanArchiveTable(table({ has_linked_tables: true })), /linked unavailable tables/);
});

test("blocks manual unavailability for occupied or linked tables", () => {
  assert.throws(
    () => assertCanChangeTableAvailability(table({ status: "occupied" }), "unavailable"),
    /seated customer/
  );
  assert.throws(
    () => assertCanChangeTableAvailability(table({ linked_to_table_id: "table-2" }), "available"),
    /automatically/
  );
});

test("allows linking an unavailable table only to a seated active table that is not itself linked", () => {
  const source = table({ id: "table-1", status: "unavailable" });
  const seatedTarget = table({
    id: "table-2",
    status: "occupied",
    has_active_session: true,
    has_seated_customer: true
  });
  assert.doesNotThrow(() => assertCanLinkUnavailableTable(source, seatedTarget));
  assert.throws(
    () => assertCanLinkUnavailableTable(source, table({ id: "table-2", status: "occupied" })),
    /seated customer/
  );
  assert.throws(
    () => assertCanLinkUnavailableTable(source, { ...seatedTarget, linked_to_table_id: "table-3" }),
    /not itself linked/
  );
  assert.throws(() => assertCanLinkUnavailableTable(source, table({ id: "table-1" })), /itself/);
  assert.throws(
    () => assertCanLinkUnavailableTable({ ...source, linked_to_table_id: "table-3" }, seatedTarget),
    /already linked/
  );
});

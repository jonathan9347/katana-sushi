import { InventoryError } from "./inventory.service";

export type ManagedTableState = {
  id: string;
  status: string;
  is_archived: boolean;
  linked_to_table_id: string | null;
  has_active_session: boolean;
  has_linked_tables?: boolean;
  has_seated_customer?: boolean;
};

function assertTableIsLive(table: ManagedTableState) {
  if (table.is_archived) {
    throw new InventoryError("Archived tables cannot be changed.", "TABLE_ARCHIVED", 409);
  }
}

function assertTableHasNoSession(table: ManagedTableState) {
  if (table.has_active_session || table.status.trim().toLowerCase() === "occupied") {
    throw new InventoryError("This table has a seated customer and cannot be changed.", "TABLE_OCCUPIED", 409);
  }
}

export function assertCanEditTableSeats(table: ManagedTableState) {
  assertTableIsLive(table);
  assertTableHasNoSession(table);
  if (table.linked_to_table_id) {
    throw new InventoryError("A linked table's seats cannot be edited until the seated party checks out.", "TABLE_LINKED", 409);
  }
}

export function assertCanArchiveTable(table: ManagedTableState) {
  assertCanEditTableSeats(table);
  if (table.has_linked_tables) {
    throw new InventoryError("This table has linked unavailable tables and cannot be archived.", "TABLE_HAS_LINKED_TABLES", 409);
  }
}

export function assertCanChangeTableAvailability(table: ManagedTableState, status: "available" | "unavailable") {
  assertTableIsLive(table);
  assertTableHasNoSession(table);
  if (table.linked_to_table_id) {
    throw new InventoryError("A linked table becomes available automatically when the seated party checks out.", "TABLE_LINKED", 409);
  }
  if (status === "available" && table.status.trim().toLowerCase() === "occupied") {
    throw new InventoryError("An occupied table is released only when its dining session is checked out.", "TABLE_OCCUPIED", 409);
  }
}

export function assertCanLinkUnavailableTable(source: ManagedTableState, target: ManagedTableState) {
  assertTableIsLive(source);
  assertTableHasNoSession(source);
  if (source.id === target.id) {
    throw new InventoryError("A table cannot be linked to itself.", "TABLE_LINK_SELF", 400);
  }
  if (source.linked_to_table_id) {
    throw new InventoryError("This table is already linked to another table.", "TABLE_ALREADY_LINKED", 409);
  }
  assertTableIsLive(target);
  if (target.linked_to_table_id) {
    throw new InventoryError("Choose a seated table that is not itself linked.", "TABLE_LINK_TARGET_LINKED", 409);
  }
  if (
    target.status.trim().toLowerCase() !== "occupied" ||
    !target.has_active_session ||
    !target.has_seated_customer
  ) {
    throw new InventoryError("Choose a table with a seated customer and an active dining session.", "TABLE_LINK_TARGET_NOT_SEATED", 409);
  }
}

export function getNextTableNumber(existingNumbers: number[]) {
  const highest = existingNumbers.reduce((max, value) => {
    if (!Number.isSafeInteger(value) || value < 1) {
      throw new InventoryError("An existing table has an invalid table number.", "INVALID_TABLE_NUMBER", 409);
    }
    return Math.max(max, value);
  }, 0);
  if (highest >= 2_147_483_647) {
    throw new InventoryError("No table numbers remain available.", "TABLE_NUMBER_EXHAUSTED", 409);
  }
  return highest + 1;
}

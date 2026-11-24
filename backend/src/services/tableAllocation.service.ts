export type TableSeatCandidate = {
  id: string;
  table_number: number;
  capacity: number;
  is_archived?: boolean | null;
  is_temporary?: boolean | null;
};

export type AllocationResult = {
  tableIds: string[];
  totalCapacity: number;
  unusedSeats: number;
  tableCount: number;
};

export type TablePlanningWindow = {
  serviceDate: string;
  startTime: string;
  tableIds: string[];
};

type TableAllocationOptions = {
  unavailableTableIds?: Iterable<string>;
};

function normalizeTable(table: TableSeatCandidate) {
  return {
    ...table,
    capacity: Number(table.capacity),
    table_number: Number(table.table_number),
    is_archived: Boolean(table.is_archived),
    is_temporary: Boolean(table.is_temporary)
  };
}

function serviceMinute(serviceDate: string, startTime: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(serviceDate)) {
    throw new RangeError(`Invalid service date: ${serviceDate}`);
  }
  const [year, month, day] = serviceDate.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.toISOString().slice(0, 10) !== serviceDate) {
    throw new RangeError(`Invalid service date: ${serviceDate}`);
  }
  const time24 = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(startTime);
  const time12 = /^(0?[1-9]|1[0-2]):([0-5]\d)\s*(AM|PM)$/i.exec(startTime.trim());
  let hours: number;
  let minutes: number;
  if (time24) {
    hours = Number(time24[1]);
    minutes = Number(time24[2]);
  } else if (time12) {
    hours = (Number(time12[1]) % 12) + (time12[3].toUpperCase() === "PM" ? 12 : 0);
    minutes = Number(time12[2]);
  } else {
    throw new RangeError(`Invalid service time: ${startTime}`);
  }

  return Math.floor(date.getTime() / 60_000) + hours * 60 + minutes;
}

function overlaps(leftStart: number, leftEnd: number, rightStart: number, rightEnd: number) {
  return leftStart < rightEnd && rightStart < leftEnd;
}

export function findBestTableCombination(
  requiredSeats: number,
  tables: TableSeatCandidate[],
  options: TableAllocationOptions = {}
): AllocationResult | null {
  if (!Number.isInteger(requiredSeats) || requiredSeats <= 0) {
    return null;
  }

  const unavailableTableIds = new Set(options.unavailableTableIds ?? []);
  const activeTables = tables
    .map(normalizeTable)
    .filter((table) =>
      !table.is_archived &&
      !table.is_temporary &&
      table.capacity > 0 &&
      !unavailableTableIds.has(table.id)
    )
    .sort((left, right) => left.table_number - right.table_number || left.id.localeCompare(right.id));

  if (activeTables.length === 0) {
    return null;
  }

  let bestChoice: { combo: TableSeatCandidate[]; score: [number, number, string[]] } | undefined;

  const visit = (startIndex: number, picked: TableSeatCandidate[]) => {
    const totalCapacity = picked.reduce((sum: number, table: TableSeatCandidate) => sum + table.capacity, 0);
    if (totalCapacity >= requiredSeats) {
      const unusedSeats = totalCapacity - requiredSeats;
      const score: [number, number, string[]] = [
        picked.length,
        unusedSeats,
        picked.map((table: TableSeatCandidate) => table.id).sort()
      ];
      const currentChoice = { combo: [...picked], score };
      if (!bestChoice || score[0] < bestChoice.score[0] ||
          (score[0] === bestChoice.score[0] && (score[1] < bestChoice.score[1] ||
            (score[1] === bestChoice.score[1] && score[2].join(",") < bestChoice.score[2].join(","))))) {
        bestChoice = currentChoice;
      }
      return;
    }

    for (let index = startIndex; index < activeTables.length; index += 1) {
      visit(index + 1, [...picked, activeTables[index]]);
    }
  };

  visit(0, []);

  if (!bestChoice) {
    return null;
  }

  return {
    tableIds: bestChoice.combo.map((table) => table.id),
    totalCapacity: bestChoice.combo.reduce((sum: number, table: TableSeatCandidate) => sum + table.capacity, 0),
    unusedSeats: bestChoice.combo.reduce((sum: number, table: TableSeatCandidate) => sum + table.capacity, 0) - requiredSeats,
    tableCount: bestChoice.combo.length
  };
}

export function getTablesUnavailableForSlot(
  serviceDate: string,
  startTime: string,
  tableWindowMinutes: number,
  reservationWindows: TablePlanningWindow[],
  activeDiningSessions: TablePlanningWindow[]
) {
  if (!Number.isInteger(tableWindowMinutes) || tableWindowMinutes <= 0) {
    throw new RangeError("Table window must be a positive whole number of minutes.");
  }

  const requestedStart = serviceMinute(serviceDate, startTime);
  const requestedEnd = requestedStart + tableWindowMinutes;
  const unavailableTableIds = new Set<string>();

  for (const window of reservationWindows) {
    const windowStart = serviceMinute(window.serviceDate, window.startTime);
    const windowEnd = windowStart + tableWindowMinutes;
    if (overlaps(requestedStart, requestedEnd, windowStart, windowEnd)) {
      window.tableIds.forEach((tableId) => unavailableTableIds.add(tableId));
    }
  }

  activeDiningSessions
    .filter((session) => session.serviceDate === serviceDate)
    .forEach((session) => session.tableIds.forEach((tableId) => unavailableTableIds.add(tableId)));

  return Array.from(unavailableTableIds).sort();
}

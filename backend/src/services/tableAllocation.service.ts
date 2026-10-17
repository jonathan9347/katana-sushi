export type TableSeatCandidate = {
  id: string;
  table_number: number;
  capacity: number;
  status?: string | null;
  is_archived?: boolean | null;
};

export type AllocationResult = {
  tableIds: string[];
  totalCapacity: number;
  unusedSeats: number;
  tableCount: number;
};

function normalizeTable(table: TableSeatCandidate) {
  return {
    ...table,
    capacity: Number(table.capacity),
    table_number: Number(table.table_number),
    status: table.status?.trim().toLowerCase() ?? "available",
    is_archived: Boolean(table.is_archived)
  };
}

export function findBestTableCombination(
  requiredSeats: number,
  tables: TableSeatCandidate[]
): AllocationResult | null {
  if (!Number.isInteger(requiredSeats) || requiredSeats <= 0) {
    return null;
  }

  const activeTables = tables
    .map(normalizeTable)
    .filter((table) => !table.is_archived && table.capacity > 0 && table.status === "available")
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

export function isSameDayReservationWindow(date: Date, time: string, now: Date) {
  const [hours, minutes] = time.split(":").map(Number);
  const candidate = new Date(date);
  candidate.setHours(hours, minutes, 0, 0);

  const todayStart = new Date(now);
  todayStart.setHours(0, 0, 0, 0);
  const todayEnd = new Date(todayStart);
  todayEnd.setHours(23, 59, 59, 999);

  if (date < todayStart || date > todayEnd) {
    return false;
  }

  const diffMinutes = (candidate.getTime() - now.getTime()) / 60000;
  return diffMinutes >= 0 && diffMinutes <= 120;
}

export function getReservationTableHoldsForDate(
  reservationDate: Date,
  activeReservations: Array<{ date: Date; time: string; party_size: number }>
) {
  return activeReservations.filter((reservation) =>
    reservation.date.getFullYear() === reservationDate.getFullYear() &&
    reservation.date.getMonth() === reservationDate.getMonth() &&
    reservation.date.getDate() === reservationDate.getDate()
  );
}

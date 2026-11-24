export function getReservationSlotStart(
  time: string,
  openingTime: string,
  slotDurationMinutes: number
) {
  const match = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(time);
  if (!match || !Number.isInteger(slotDurationMinutes) || slotDurationMinutes <= 0) {
    throw new Error("Invalid reservation time or slot duration.");
  }

  const minutes = Number(match[1]) * 60 + Number(match[2]);
  const openingParts = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(openingTime);
  if (!openingParts) {
    throw new Error("Invalid reservation opening time.");
  }

  const openingMinutes = Number(openingParts[1]) * 60 + Number(openingParts[2]);
  if (minutes < openingMinutes) {
    throw new Error("Reservation time is before opening.");
  }

  const slotStart = openingMinutes
    + Math.floor((minutes - openingMinutes) / slotDurationMinutes) * slotDurationMinutes;
  return `${String(Math.floor(slotStart / 60)).padStart(2, "0")}:${String(slotStart % 60).padStart(2, "0")}`;
}

export function calculateAvailableReservationPax(
  totalTableCapacity: number,
  walkInPax: number,
  reservedPax: number,
  onlinePaxLimit: number
) {
  return Math.max(
    0,
    Math.min(onlinePaxLimit, totalTableCapacity - walkInPax - reservedPax)
  );
}

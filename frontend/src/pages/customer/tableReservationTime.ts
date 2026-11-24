export type ReservationTimeRules = {
  OPENING_TIME: string;
  LAST_BOOKING_TIME: string;
  MAX_PAX_PER_SLOT: number;
  SLOT_DURATION_MINUTES: number;
  TIME_ZONE: string;
};

export type ReservationTimeState =
  | "no_time"
  | "outside_hours"
  | "unavailable"
  | "available";

function timeToMinutes(time: string) {
  const match = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(time);
  return match ? Number(match[1]) * 60 + Number(match[2]) : null;
}

export function reservationSlotStart(time: string, rules: ReservationTimeRules) {
  const requested = timeToMinutes(time);
  const opening = timeToMinutes(rules.OPENING_TIME);
  if (requested === null || opening === null || requested < opening || rules.SLOT_DURATION_MINUTES <= 0) {
    return null;
  }

  const slotStart = opening
    + Math.floor((requested - opening) / rules.SLOT_DURATION_MINUTES) * rules.SLOT_DURATION_MINUTES;
  return `${String(Math.floor(slotStart / 60)).padStart(2, "0")}:${String(slotStart % 60).padStart(2, "0")}`;
}

export function createReservationSlots(rules: ReservationTimeRules) {
  const opening = timeToMinutes(rules.OPENING_TIME);
  const lastBooking = timeToMinutes(rules.LAST_BOOKING_TIME);
  if (opening === null || lastBooking === null || rules.SLOT_DURATION_MINUTES <= 0) {
    return [];
  }

  const slots: string[] = [];
  for (let minute = opening; minute <= lastBooking; minute += rules.SLOT_DURATION_MINUTES) {
    slots.push(`${String(Math.floor(minute / 60)).padStart(2, "0")}:${String(minute % 60).padStart(2, "0")}`);
  }
  return slots;
}

function localDateTimeToEpoch(date: string, time: string, timeZone: string) {
  const [year, month, day] = date.split("-").map(Number);
  const [hour, minute] = time.split(":").map(Number);
  const target = Date.UTC(year, month - 1, day, hour, minute);
  let guess = target;

  for (let attempt = 0; attempt < 3; attempt += 1) {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hourCycle: "h23"
    }).formatToParts(new Date(guess));
    const part = (type: string) => Number(parts.find((value) => value.type === type)?.value);
    const observed = Date.UTC(
      part("year"),
      part("month") - 1,
      part("day"),
      part("hour"),
      part("minute"),
      part("second")
    );
    guess = target - (observed - guess);
  }

  return guess;
}

export function isReservationTimePastToday(date: string, time: string, timeZone: string, now: Date) {
  const nowParts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).formatToParts(now);
  const localToday = `${nowParts.find((part) => part.type === "year")?.value}-${nowParts.find((part) => part.type === "month")?.value}-${nowParts.find((part) => part.type === "day")?.value}`;
  if (date < localToday) return true;
  if (date > localToday) return false;
  return localDateTimeToEpoch(date, time, timeZone) <= now.getTime();
}

export function getReservationTimeState(input: {
  date: string;
  time: string;
  partySize: number;
  rules: ReservationTimeRules;
  now: Date;
  seatsLeft?: number;
}): ReservationTimeState {
  const { date, time, partySize, rules, now, seatsLeft } = input;
  if (!time) return "no_time";
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return "outside_hours";

  const selectedMinute = timeToMinutes(time);
  const openingMinute = timeToMinutes(rules.OPENING_TIME);
  const lastBookingMinute = timeToMinutes(rules.LAST_BOOKING_TIME);
  if (
    selectedMinute === null
    || openingMinute === null
    || lastBookingMinute === null
    || selectedMinute < openingMinute
    || selectedMinute > lastBookingMinute
    || isReservationTimePastToday(date, time, rules.TIME_ZONE, now)
  ) {
    return "outside_hours";
  }

  if (seatsLeft === undefined || seatsLeft < partySize) {
    return "unavailable";
  }

  return "available";
}

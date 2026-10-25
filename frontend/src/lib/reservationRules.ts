import { api } from "./api";

export type ReservationRules = {
  MAX_GUESTS_PER_BOOKING: number;
  MAX_PAX_PER_SLOT: number;
  SLOT_DURATION_MINUTES: number;
  LATE_ALERT_MINUTES: number;
  LATE_ACTION: "alert_staff";
  OPENING_TIME: string;
  CLOSING_TIME: string;
  LAST_BOOKING_TIME: string;
  MIN_LEAD_MINUTES: number;
  TIME_ZONE: string;
  PAYMENT_GATEWAY: string;
};

export type ReservationRulesResponse = {
  settings: ReservationRules;
  server_now: string;
  fetched_at: number;
};

export async function fetchReservationRules(): Promise<ReservationRulesResponse> {
  const response = await api.get<{ settings: ReservationRules; server_now: string }>("/api/reservations/rules");
  return { ...response.data, fetched_at: performance.now() };
}

export function getServerNow(rules: ReservationRulesResponse) {
  return new Date(Date.parse(rules.server_now) + performance.now() - rules.fetched_at);
}

export function manilaDateKeyAt(date: Date, timeZone: string) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).format(date);
}

export function timeToMinutes(time: string) {
  const [hour, minute] = time.split(":").map(Number);
  return hour * 60 + minute;
}

export function minutesToTime(minutes: number) {
  const bounded = Math.max(0, Math.min(23 * 60 + 59, Math.floor(minutes)));
  return `${String(Math.floor(bounded / 60)).padStart(2, "0")}:${String(bounded % 60).padStart(2, "0")}`;
}

export function nextAllowedTime(date: string, rules: ReservationRules, now: Date) {
  const opening = timeToMinutes(rules.OPENING_TIME);
  const closing = timeToMinutes(rules.LAST_BOOKING_TIME);
  let earliest = opening;

  if (date === manilaDateKeyAt(now, rules.TIME_ZONE)) {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone: rules.TIME_ZONE,
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23"
    }).formatToParts(now);
    const currentMinute = Number(parts.find((part) => part.type === "hour")?.value) * 60
      + Number(parts.find((part) => part.type === "minute")?.value);
    earliest = Math.max(opening, currentMinute + rules.MIN_LEAD_MINUTES + 1);
  }

  return earliest <= closing ? minutesToTime(earliest) : "";
}

export function isValidReservationTime(date: string, time: string, rules: ReservationRules, now: Date) {
  if (!date || !/^([01]\d|2[0-3]):[0-5]\d$/.test(time)) {
    return false;
  }
  if (date < manilaDateKeyAt(now, rules.TIME_ZONE)) {
    return false;
  }

  const minutes = timeToMinutes(time);
  if (minutes < timeToMinutes(rules.OPENING_TIME) || minutes > timeToMinutes(rules.LAST_BOOKING_TIME)) {
    return false;
  }

  const bookingEpoch = Date.parse(`${date}T${time}:00+08:00`);
  return Number.isFinite(bookingEpoch) && bookingEpoch > now.getTime() + rules.MIN_LEAD_MINUTES * 60_000;
}

export function clampReservationTime(date: string, time: string, rules: ReservationRules, now: Date) {
  const opening = timeToMinutes(rules.OPENING_TIME);
  const closing = timeToMinutes(rules.LAST_BOOKING_TIME);
  const nextTime = nextAllowedTime(date, rules, now);
  if (!nextTime) {
    return "";
  }
  const minTime = Math.max(opening, timeToMinutes(nextTime));
  const requested = Number.isFinite(timeToMinutes(time)) ? timeToMinutes(time) : minTime;
  return minutesToTime(Math.max(minTime, Math.min(closing, requested)));
}

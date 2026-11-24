export const timeOptions = [
  "12:00",
  "12:30",
  "13:00",
  "13:30",
  "14:00",
  "14:30",
  "15:00",
  "15:30",
  "16:00",
  "16:30",
  "17:00",
  "17:30",
  "18:00",
  "18:30",
  "19:00",
  "19:30",
  "20:00"
];

export function isFutureManilaReservationTime(date: string, time: string, now = new Date()) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !/^([01]\d|2[0-3]):[0-5]\d$/.test(time)) {
    return false;
  }

  const bookingTime = new Date(`${date}T${time}:00+08:00`);
  return Number.isFinite(bookingTime.getTime()) && bookingTime.getTime() > now.getTime();
}

function normalizeDateInput(date: string | Date | null | undefined) {
  if (!date) {
    return null;
  }

  if (date instanceof Date) {
    return Number.isNaN(date.getTime()) ? null : date;
  }

  const trimmed = date.trim();
  if (!trimmed) {
    return null;
  }

  const parsed = /^\d{4}-\d{2}-\d{2}$/.test(trimmed)
    ? new Date(`${trimmed}T00:00:00+08:00`)
    : new Date(trimmed);

  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

export function formatManilaDate(date: string | Date | null | undefined, options?: Intl.DateTimeFormatOptions) {
  const parsed = normalizeDateInput(date);
  if (!parsed) {
    return "Invalid date";
  }

  return parsed.toLocaleDateString("en-PH", {
    timeZone: "Asia/Manila",
    year: "numeric",
    month: "long",
    day: "numeric",
    ...options
  });
}

export function formatManilaDateTime(date: string | Date | null | undefined, options?: Intl.DateTimeFormatOptions) {
  const parsed = normalizeDateInput(date);
  if (!parsed) {
    return "Invalid date";
  }

  return parsed.toLocaleString("en-PH", {
    timeZone: "Asia/Manila",
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
    ...options
  });
}

export function manilaDateKey(date: string | Date | null | undefined) {
  const parsed = normalizeDateInput(date);
  if (!parsed) {
    return "invalid-date";
  }

  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Manila",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).format(parsed);
}

export function todayManilaDateKey() {
  return manilaDateKey(new Date());
}

export function formatTime12(time: string) {
  const [hourText, minute = "00"] = time.split(":");
  const hour = Number(hourText);

  if (!Number.isFinite(hour)) {
    return time;
  }

  const hour12 = hour % 12 || 12;
  const ampm = hour >= 12 ? "PM" : "AM";
  return `${hour12}:${minute.padStart(2, "0")} ${ampm}`;
}

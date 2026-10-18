export const RESERVATION_SETTINGS = {
  MAX_GUESTS: 20,
  MAX_PAX_PER_SLOT: 20,
  SLOT_DURATION_MINUTES: 120,
  LATE_ALERT_MINUTES: 30,
  LATE_ACTION: "alert_staff" as const,
  OPENING_TIME: "12:00",
  CLOSING_TIME: "21:30",
  LAST_BOOKING_TIME: "21:30",
  MIN_LEAD_MINUTES: 0,
  TIME_ZONE: "Asia/Manila"
};

export function isDineInReservationLate(date: Date, time: string, now = new Date()) {
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(time)) return false;
  const serviceDate = new Intl.DateTimeFormat("en-CA", {
    timeZone: RESERVATION_SETTINGS.TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).format(date);
  const scheduledTime = Date.parse(`${serviceDate}T${time}:00+08:00`);
  return Number.isFinite(scheduledTime)
    && now.getTime() >= scheduledTime + RESERVATION_SETTINGS.LATE_ALERT_MINUTES * 60_000;
}

export function isDineInReservationLateAlert(
  date: Date,
  time: string,
  status: string,
  lateArrivalAcknowledged: boolean,
  now = new Date()
) {
  if (lateArrivalAcknowledged || !["confirmed", "approved"].includes(status.toLowerCase())) {
    return false;
  }
  return isDineInReservationLate(date, time, now);
}

export function reservationTimeError(date: string, time: string, now = new Date()) {
  const settings = RESERVATION_SETTINGS;
  const dateParts = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  if (!dateParts) {
    return "Choose a valid reservation date.";
  }
  const [, yearText, monthText, dayText] = dateParts;
  const calendarDate = new Date(Date.UTC(Number(yearText), Number(monthText) - 1, Number(dayText)));
  if (calendarDate.toISOString().slice(0, 10) !== date) {
    return "Choose a valid reservation date.";
  }

  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(time)) {
    return `Choose a reservation time between ${formatTime(settings.OPENING_TIME)} and ${formatTime(settings.LAST_BOOKING_TIME)}.`;
  }

  if (time < settings.OPENING_TIME || time > settings.LAST_BOOKING_TIME) {
    return `Choose a reservation time between ${formatTime(settings.OPENING_TIME)} and ${formatTime(settings.LAST_BOOKING_TIME)}.`;
  }

  const bookingTime = new Date(`${date}T${time}:00+08:00`);
  const today = new Intl.DateTimeFormat("en-CA", {
    timeZone: settings.TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).format(now);
  if (date < today) {
    return "Choose a date that is not in the past.";
  }
  if (!Number.isFinite(bookingTime.getTime()) || bookingTime.getTime() <= now.getTime() + settings.MIN_LEAD_MINUTES * 60_000) {
    return "Choose a reservation time later than the current time.";
  }
  return null;
}

function formatTime(time: string) {
  const [hourText, minute] = time.split(":");
  const hour = Number(hourText);
  return `${hour % 12 || 12}:${minute} ${hour >= 12 ? "PM" : "AM"}`;
}

import test from "node:test";
import assert from "node:assert/strict";

import { isDineInReservationLateAlert, RESERVATION_SETTINGS } from "./reservationSettings";

const oldReservationDate = new Date("2020-01-01T00:00:00.000Z");
const lateTime = "12:00";
const now = new Date("2020-01-01T05:30:00.000Z");

test("maximum guests per booking defaults to 20", () => {
  assert.equal(RESERVATION_SETTINGS.MAX_GUESTS_PER_BOOKING, 20);
});

test("late alert is available only for an unacknowledged confirmed or approved reservation", () => {
  assert.equal(isDineInReservationLateAlert(oldReservationDate, lateTime, "confirmed", false, now), true);
  assert.equal(isDineInReservationLateAlert(oldReservationDate, lateTime, "approved", false, now), true);
  assert.equal(isDineInReservationLateAlert(oldReservationDate, lateTime, "confirmed", true, now), false);
});

test("late alert starts exactly at LATE_ALERT_MINUTES", () => {
  const scheduled = new Date("2020-01-01T04:00:00.000Z");
  assert.equal(
    isDineInReservationLateAlert(scheduled, lateTime, "confirmed", false, new Date("2020-01-01T04:29:59.999Z")),
    false
  );
  assert.equal(
    isDineInReservationLateAlert(scheduled, lateTime, "confirmed", false, new Date("2020-01-01T04:30:00.000Z")),
    true
  );
});

test("late alert clears for arrived, seated, cancelled, and other non-confirmed states", () => {
  for (const status of ["arrived", "seated", "preparing", "in_progress", "cancelled", "no_show"]) {
    assert.equal(
      isDineInReservationLateAlert(oldReservationDate, lateTime, status, false, now),
      false,
      `${status} reservations must not show a late alert`
    );
  }
});

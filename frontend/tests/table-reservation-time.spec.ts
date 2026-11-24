import { expect, test } from "@playwright/test";
import {
  createReservationSlots,
  getReservationTimeState,
  isReservationTimePastToday,
  reservationSlotStart,
  type ReservationTimeRules
} from "../src/pages/customer/tableReservationTime";

const rules: ReservationTimeRules = {
  OPENING_TIME: "12:00",
  LAST_BOOKING_TIME: "21:30",
  MAX_PAX_PER_SLOT: 20,
  SLOT_DURATION_MINUTES: 30,
  TIME_ZONE: "Asia/Manila"
};
const futureDate = "2026-10-27";
const morningManila = new Date("2026-10-26T02:00:00.000Z");

test("creates half-hour slots from configured opening to last-booking time inclusively", () => {
  const slots = createReservationSlots(rules);
  expect(slots).toHaveLength(20);
  expect(slots[0]).toBe("12:00");
  expect(slots.at(-1)).toBe("21:30");
});

test("no time selected is state A", () => {
  expect(getReservationTimeState({
    date: futureDate,
    time: "",
    partySize: 2,
    rules,
    now: morningManila
  })).toBe("no_time");
});

test("time before opening and after last booking are state B", () => {
  for (const time of ["11:59", "21:31", "22:00"]) {
    expect(getReservationTimeState({
      date: futureDate,
      time,
      partySize: 2,
      rules,
      now: morningManila,
      seatsLeft: 20
    })).toBe("outside_hours");
  }
});

test("opening and last-bookable times are valid when seats are available", () => {
  for (const time of ["12:00", "21:30"]) {
    expect(getReservationTimeState({
      date: futureDate,
      time,
      partySize: 2,
      rules,
      now: morningManila,
      seatsLeft: 20
    })).toBe("available");
  }
});

test("full slots and slots with fewer than the requested seats are state C", () => {
  expect(getReservationTimeState({
    date: futureDate,
    time: "18:00",
    partySize: 2,
    rules,
    now: morningManila,
    seatsLeft: 0
  })).toBe("unavailable");
  expect(getReservationTimeState({
    date: futureDate,
    time: "18:00",
    partySize: 6,
    rules,
    now: morningManila,
    seatsLeft: 5
  })).toBe("unavailable");
});

test("sufficient seats are state D", () => {
  expect(getReservationTimeState({
    date: futureDate,
    time: "18:00",
    partySize: 6,
    rules,
    now: morningManila,
    seatsLeft: 6
  })).toBe("available");
});

test("a past time today in the configured timezone is state B", () => {
  const now = new Date("2026-10-26T05:00:00.000Z");
  expect(isReservationTimePastToday("2026-10-26", "12:30", rules.TIME_ZONE, now)).toBe(true);
  expect(getReservationTimeState({
    date: "2026-10-26",
    time: "12:30",
    partySize: 2,
    rules,
    now,
    seatsLeft: 20
  })).toBe("outside_hours");
});

test("non-slot times use the availability window starting at the preceding half-hour", () => {
  expect(reservationSlotStart("18:45", rules)).toBe("18:30");
});

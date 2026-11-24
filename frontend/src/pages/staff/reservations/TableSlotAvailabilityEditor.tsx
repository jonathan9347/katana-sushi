import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../../../lib/api";
import { todayManilaDateKey } from "../../../lib/dateTime";
import { fetchReservationRules } from "../../../lib/reservationRules";

type SlotCapacity = {
  service_date: string;
  slot_start: string;
  slot_end: string;
  total_table_capacity: number;
  walk_in_pax: number;
  booked_pax: number;
  available_pax: number;
};

function slotTimes(openingTime: string, closingTime: string, duration: number) {
  const [openingHour, openingMinute] = openingTime.split(":").map(Number);
  const [closingHour, closingMinute] = closingTime.split(":").map(Number);
  const opening = openingHour * 60 + openingMinute;
  const closing = closingHour * 60 + closingMinute;
  const result: string[] = [];
  for (let minute = opening; minute <= closing; minute += duration) {
    result.push(`${String(Math.floor(minute / 60)).padStart(2, "0")}:${String(minute % 60).padStart(2, "0")}`);
  }
  const lastSlotStart = opening + Math.floor((closing - opening) / duration) * duration;
  if (!result.includes(`${String(Math.floor(lastSlotStart / 60)).padStart(2, "0")}:${String(lastSlotStart % 60).padStart(2, "0")}`)) {
    result.push(`${String(Math.floor(lastSlotStart / 60)).padStart(2, "0")}:${String(lastSlotStart % 60).padStart(2, "0")}`);
  }
  return result;
}

function formatTime(time: string) {
  const [hour, minute] = time.split(":").map(Number);
  return `${hour % 12 || 12}:${String(minute).padStart(2, "0")} ${hour >= 12 ? "PM" : "AM"}`;
}

export default function TableSlotAvailabilityEditor() {
  const [date, setDate] = useState(todayManilaDateKey());
  const [time, setTime] = useState("12:00");
  const [walkInPax, setWalkInPax] = useState("0");
  const [notice, setNotice] = useState("");
  const queryClient = useQueryClient();
  const rulesQuery = useQuery({
    queryKey: ["reservation-rules"],
    queryFn: fetchReservationRules,
    retry: 1
  });
  const rules = rulesQuery.data?.settings;
  const times = useMemo(
    () => rules
      ? slotTimes(rules.OPENING_TIME, rules.LAST_BOOKING_TIME, rules.SLOT_DURATION_MINUTES ?? 120)
      : ["12:00"],
    [rules]
  );
  const capacityQuery = useQuery({
    queryKey: ["staff-reservation-slot-capacity", date, time],
    queryFn: async () => (await api.get<SlotCapacity>("/api/staff/reservation-slot-capacity", {
      params: { date, time }
    })).data,
    enabled: Boolean(date && time),
    retry: 1
  });

  useEffect(() => {
    if (capacityQuery.data) {
      setWalkInPax(String(capacityQuery.data.walk_in_pax));
    }
  }, [capacityQuery.data]);

  const saveMutation = useMutation({
    mutationFn: async () => (await api.put<SlotCapacity>("/api/staff/reservation-slot-capacity", {
      date,
      time,
      walk_in_pax: Number(walkInPax)
    })).data,
    onSuccess: async (summary) => {
      setNotice("Walk-in guest count saved.");
      setWalkInPax(String(summary.walk_in_pax));
      await queryClient.invalidateQueries({ queryKey: ["staff-reservation-slot-capacity", date, time] });
      await queryClient.invalidateQueries({ queryKey: ["staff-reservations-all"] });
    },
    onError: () => setNotice("Unable to save this slot's walk-in guest count.")
  });

  return (
    <section className="mx-4 rounded-xl border border-slate-200 bg-white p-4 shadow-sm sm:mx-5" aria-label="Reservation slot availability">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="font-black text-slate-950">Table availability</h2>
          <p className="mt-1 max-w-3xl text-sm text-slate-600">
            Record walk-in guests for a date and fixed two-hour slot. Their seats reduce online availability; online reservations are also capped at 20 guests per slot.
          </p>
        </div>
        <div className="grid gap-3 sm:grid-cols-3">
          <label className="grid gap-1 text-xs font-semibold text-slate-600">
            Date
            <input className="h-10 rounded-md border border-slate-300 px-3 text-sm text-slate-900" type="date" min={todayManilaDateKey()} value={date} onChange={(event) => setDate(event.target.value)} />
          </label>
          <label className="grid gap-1 text-xs font-semibold text-slate-600">
            Two-hour slot
            <select className="h-10 rounded-md border border-slate-300 bg-white px-3 text-sm text-slate-900" value={time} onChange={(event) => setTime(event.target.value)}>
              {times.map((slotTime) => <option key={slotTime} value={slotTime}>{formatTime(slotTime)} start</option>)}
            </select>
          </label>
          <label className="grid gap-1 text-xs font-semibold text-slate-600">
            Walk-in guests
            <input
              className="h-10 rounded-md border border-slate-300 px-3 text-sm text-slate-900"
              type="number"
              min="0"
              max="1000"
              step="1"
              value={walkInPax}
              onChange={(event) => {
                setWalkInPax(event.target.value);
                setNotice("");
              }}
              aria-label="Walk-in guests for the selected slot"
            />
          </label>
        </div>
      </div>

      {capacityQuery.isLoading ? (
        <p className="mt-3 text-sm text-slate-500" role="status">Loading slot capacity...</p>
      ) : capacityQuery.isError ? (
        <p className="mt-3 text-sm text-red-700" role="alert">Unable to load slot capacity.</p>
      ) : capacityQuery.data ? (
        <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
          <p className="text-sm text-slate-700">
            Table seats: <strong>{capacityQuery.data.total_table_capacity}</strong>
            {" · "}Walk-ins: <strong>{capacityQuery.data.walk_in_pax}</strong>
            {" · "}Online reservations: <strong>{capacityQuery.data.booked_pax}</strong>
            {" · "}Online seats available: <strong>{capacityQuery.data.available_pax}</strong>
          </p>
          <button
            type="button"
            className="rounded-md bg-red-700 px-4 py-2 text-sm font-bold text-white disabled:opacity-50"
            onClick={() => saveMutation.mutate()}
            disabled={saveMutation.isPending || !/^\d+$/.test(walkInPax)}
          >
            {saveMutation.isPending ? "Saving..." : "Save walk-in count"}
          </button>
        </div>
      ) : null}
      {notice && <p className="mt-2 text-sm text-slate-600" role="status">{notice}</p>}
    </section>
  );
}

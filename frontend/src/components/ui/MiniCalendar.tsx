import { useMemo } from "react";
import { CalendarDays } from "lucide-react";
import { formatManilaDate, manilaDateKey, todayManilaDateKey } from "../../lib/dateTime";

type MiniCalendarProps = {
  month: Date;
  selectedDate: string;
  eventsByDate: Map<string, number>;
  onPreviousMonth: () => void;
  onNextMonth: () => void;
  onSelectDate: (dateKey: string) => void;
};

const dayLabels = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

export function MiniCalendar({ month, selectedDate, eventsByDate, onPreviousMonth, onNextMonth, onSelectDate }: MiniCalendarProps) {
  const days = useMemo(() => {
    const first = new Date(month.getFullYear(), month.getMonth(), 1);
    const start = new Date(first);
    start.setDate(first.getDate() - first.getDay());

    return Array.from({ length: 42 }, (_, index) => {
      const day = new Date(start);
      day.setDate(start.getDate() + index);
      return day;
    });
  }, [month]);

  const monthLabel = useMemo(
    () => month.toLocaleDateString("en-PH", { timeZone: "Asia/Manila", month: "long", year: "numeric" }),
    [month]
  );

  return (
    <div className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
      <div className="mb-4 flex items-center justify-between gap-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Date selector</p>
          <p className="text-lg font-black text-slate-950">{monthLabel}</p>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={onPreviousMonth} className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-100">
            Prev
          </button>
          <button onClick={onNextMonth} className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-100">
            Next
          </button>
        </div>
      </div>

      <div className="grid grid-cols-7 gap-2 text-center text-xs font-black uppercase text-slate-500">
        {dayLabels.map((label) => (
          <div key={label}>{label}</div>
        ))}
      </div>

      <div className="mt-2 grid grid-cols-7 gap-2">
        {days.map((day) => {
          const dateKey = manilaDateKey(day);
          const eventCount = eventsByDate.get(dateKey) ?? 0;
          const inMonth = day.getMonth() === month.getMonth();
          const selected = selectedDate === dateKey;
          const isToday = dateKey === todayManilaDateKey();

          return (
            <button
              key={dateKey}
              type="button"
              onClick={() => onSelectDate(dateKey)}
              className={`min-h-[85px] rounded-3xl border p-3 text-left transition ${
                selected ? "border-red-700 bg-red-50" : "border-slate-200 bg-white"
              } ${inMonth ? "text-slate-950" : "text-slate-400"}`}
            >
              <div className="flex items-center justify-between gap-2">
                <span className={`text-sm font-black ${isToday ? "text-red-700" : ""}`}>{day.getDate()}</span>
                {selected && <span className="rounded-full bg-red-700 px-2 py-0.5 text-[11px] font-bold text-white">Selected</span>}
              </div>
              {eventCount > 0 ? (
                <div className="mt-3 rounded-full bg-slate-950 px-2 py-1 text-[11px] font-bold text-white">
                  {eventCount} {eventCount === 1 ? "event" : "events"}
                </div>
              ) : (
                <div className="mt-3 flex items-center gap-1 text-[11px] text-slate-500">
                  <CalendarDays className="h-3.5 w-3.5" />
                  <span>No events</span>
                </div>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}

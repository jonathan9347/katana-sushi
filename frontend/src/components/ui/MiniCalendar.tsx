import { useMemo } from "react";
import { ChevronLeft, ChevronRight, X } from "lucide-react";
import { formatManilaDate, manilaDateKey, todayManilaDateKey } from "../../lib/dateTime";

type MiniCalendarProps = {
  month: Date;
  selectedDate: string;
  eventsByDate: Map<string, number>;
  lateEventsByDate?: Map<string, number>;
  framed?: boolean;
  onPreviousMonth: () => void;
  onNextMonth: () => void;
  onSelectDate: (dateKey: string) => void;
  onClose?: () => void;
};

const dayLabels = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

export function MiniCalendar({ month, selectedDate, eventsByDate, lateEventsByDate = new Map(), framed = true, onPreviousMonth, onNextMonth, onSelectDate, onClose }: MiniCalendarProps) {
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
    <div className={framed ? "overflow-hidden rounded-[24px] bg-white" : ""}>
      <header className="relative flex items-start justify-between overflow-hidden bg-gradient-to-r from-[#b3202a] to-[#7f1219] px-6 py-5 text-white">
        <span className="absolute -right-10 -top-14 h-44 w-44 rounded-full bg-white/10" aria-hidden="true" />
        <div className="relative">
          <h2 className="text-[22px] font-black">Reservation calendar</h2>
          <p className="mt-1 text-sm text-white/75">Pick a day to see its bookings</p>
        </div>
        <button type="button" aria-label="Close calendar" onClick={onClose} className="relative grid h-10 w-10 place-items-center rounded-full bg-white/10"><X className="h-5 w-5" /></button>
      </header>
      <div className="reservation-calendar-panel p-5">
        <div className="reservation-calendar-grid">
          <div className="mb-4 flex items-center justify-between">
          <p className="text-[26px] font-black text-[#1c2030]">{monthLabel}</p>
          <div className="flex gap-2">
            <button type="button" aria-label="Previous month" onClick={onPreviousMonth} className="grid h-10 w-10 place-items-center rounded-full border border-[#e6b9bb] bg-white text-[#9b1d20]"><ChevronLeft className="h-5 w-5" /></button>
            <button type="button" aria-label="Next month" onClick={onNextMonth} className="grid h-10 w-10 place-items-center rounded-full border border-[#e6b9bb] bg-white text-[#9b1d20]"><ChevronRight className="h-5 w-5" /></button>
          </div>
          </div>
          <div className="grid grid-cols-7 gap-[6px] text-center text-[11.5px] font-bold uppercase tracking-wider text-[#c62d30]/80">
          {dayLabels.map((label) => <div key={label}>{label}</div>)}
          </div>
          <div className="mt-2 grid grid-cols-7 gap-[6px]">
          {days.map((day, index) => {
          const dateKey = manilaDateKey(day);
          const eventCount = eventsByDate.get(dateKey) ?? 0;
          const inMonth = day.getMonth() === month.getMonth();
          const selected = selectedDate === dateKey;
          const isToday = dateKey === todayManilaDateKey();
          const isWeekend = day.getDay() === 0 || day.getDay() === 6;
          const isPast = dateKey < todayManilaDateKey();

          return (
            <button
              key={dateKey}
              type="button"
            aria-label={`${day.toLocaleDateString("en-US",{weekday:"long",month:"long",day:"numeric"})}, ${eventCount} ${eventCount === 1 ? "event" : "events"}`}
              onClick={() => onSelectDate(dateKey)}
            style={{ animation:`staff-cell-pop 220ms ease-out ${index*12}ms both` }}
            className={`reservation-calendar-cell relative p-2 text-left ${selected ? "selected" : ""} ${isWeekend ? "weekend" : ""} ${isPast ? "past" : ""} ${inMonth ? "" : "opacity-45"}`}
            >
            <span className="text-sm font-black">{day.getDate()}</span>
            {isToday && <span className="reservation-calendar-day-dot absolute right-2 top-2" />}
            {eventCount > 0 && <span className={`absolute bottom-2 left-2 right-2 truncate rounded-full px-1 py-1 text-center text-[10px] font-bold ${selected ? "bg-white text-[#9b1d20]" : "bg-gradient-to-r from-[#c62d30] to-[#8f161c] text-white"}`}>{eventCount} {eventCount === 1 ? "event" : "events"}</span>}
            </button>
          );
          })}
          </div>
          <div className="mt-4 flex gap-5 text-xs text-[#6a7185]">
          <span className="inline-flex items-center gap-2"><i className="h-3 w-3 rounded-sm bg-[#9b1d20]" />Selected</span>
          <span className="inline-flex items-center gap-2"><i className="h-3 w-3 rounded-sm border border-[#e6b9bb] bg-[#fbeaea]" />Has events</span>
          <span className="inline-flex items-center gap-2"><i className="h-2 w-2 rounded-full bg-[#c62d30]" />Today</span>
          </div>
        </div>
        <aside className="min-w-0">
          {(() => {
          const selected = new Date(`${selectedDate}T12:00:00+08:00`);
          const full = formatManilaDate(selected,{weekday:"long",month:"long",day:"numeric"});
          const count = eventsByDate.get(selectedDate) ?? 0;
          return <>
            <div className="relative min-h-[150px] overflow-hidden rounded-[20px] bg-gradient-to-br from-[#c62d30] to-[#7f1219] p-5 text-white">
              <span className="absolute -right-8 -bottom-12 h-36 w-36 rounded-full bg-white/10" />
              <p className="text-[56px] font-black leading-none">{selected.getDate()}</p>
              <p className="mt-2 text-lg font-bold">{selected.toLocaleDateString("en-US",{weekday:"long",timeZone:"Asia/Manila"})}</p>
              <p className="text-sm text-white/75">{full}{selectedDate === todayManilaDateKey() ? " · Today" : ""}</p>
            </div>
            <div className="mt-3 rounded-[16px] bg-white p-3 shadow-[0_1px_2px_rgba(60,20,25,.04)]">
              {count > 0 ? <p className="rounded-xl border border-[#f1ebeb] p-3 text-sm font-bold text-[#1c2030]">{count} {count===1?"booking":"bookings"} scheduled</p> : <p className="p-3 text-sm text-[#6a7185]">No events.</p>}
            </div>
          </>;
          })()}
        </aside>
      </div>
    </div>
  );
}

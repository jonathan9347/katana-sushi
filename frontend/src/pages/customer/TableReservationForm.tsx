import { FormEvent, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { CalendarCheck, Minus, Plus } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import BackToHome from "../../components/layout/BackToHome";
import { Dialog } from "../../components/ui/dialog";
import { api } from "../../lib/api";
import { getApiErrorMessage } from "../../lib/errors";
import { formatTime12, todayManilaDateKey } from "../../lib/dateTime";
import {
  fetchReservationRules,
  getServerNow,
  isValidReservationTime,
  manilaDateKeyAt
} from "../../lib/reservationRules";
import "./ReservationForm.css";

type SlotAvailability = {
  available_pax: number;
  walk_in_pax: number;
  booked_pax: number;
  total_table_capacity: number;
  checked_at: string;
};

type BookingResult = {
  booking_id: string;
  status: string;
  message: string;
};

export default function TableReservationForm() {
  const [date, setDate] = useState(todayManilaDateKey());
  const [time, setTime] = useState("");
  const [partySize, setPartySize] = useState(1);
  const [reservationType, setReservationType] = useState<"dine_in" | "unlimited">("dine_in");
  const [customerName, setCustomerName] = useState("");
  const [customerPhone, setCustomerPhone] = useState("");
  const [customerEmail, setCustomerEmail] = useState("");
  const [contactOpen, setContactOpen] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [message, setMessage] = useState("");
  const [booking, setBooking] = useState<BookingResult | null>(null);

  const rulesQuery = useQuery({
    queryKey: ["reservation-rules"],
    queryFn: fetchReservationRules,
    retry: 1,
    refetchInterval: 30_000
  });
  const rules = rulesQuery.data?.settings;
  const serverNow = rulesQuery.data ? getServerNow(rulesQuery.data) : new Date();
  const serverToday = rules ? manilaDateKeyAt(serverNow, rules.TIME_ZONE) : todayManilaDateKey();
  const timeIsValid = Boolean(rules && isValidReservationTime(date, time, rules, serverNow));
  const [hourText, minuteText] = time ? time.split(":") : ["", ""];
  const hour24 = Number(hourText || rules?.OPENING_TIME.split(":")[0] || 12);
  const displayHour = hour24 % 12 || 12;
  const period = hour24 >= 12 ? "PM" : "AM";

  const availabilityQuery = useQuery({
    queryKey: ["table-reservation-availability", date, time],
    queryFn: async () => (await api.get<SlotAvailability>(
      "/api/reservations/table-availability",
      { params: { date, time } }
    )).data,
    enabled: timeIsValid,
    retry: 1,
    staleTime: 10_000,
    refetchInterval: 30_000,
    refetchOnWindowFocus: true
  });
  const availability = availabilityQuery.data;
  const noSeats = Boolean(availability && partySize > availability.available_pax);
  const canContinue = timeIsValid &&
    availabilityQuery.isSuccess &&
    Boolean(availability) &&
    !noSeats &&
    !isSubmitting;
  const timeLabel = useMemo(() => time ? formatTime12(time) : "Choose a time", [time]);

  function setDigitalTime(hourValue: number, minuteValue: number, nextPeriod: "AM" | "PM") {
    const boundedHour = Math.max(1, Math.min(12, Math.floor(hourValue)));
    const boundedMinute = Math.max(0, Math.min(59, Math.floor(minuteValue)));
    const hour24Value = (boundedHour % 12) + (nextPeriod === "PM" ? 12 : 0);
    const candidate = `${String(hour24Value).padStart(2, "0")}:${String(boundedMinute).padStart(2, "0")}`;
    setTime(candidate);
  }

  function updateTimeSegment(value: string, segment: "hour" | "minute") {
    if (value === "") {
      setTime("");
      return;
    }
    const numeric = Number(value);
    if (!Number.isFinite(numeric)) return;
    setDigitalTime(
      segment === "hour" ? numeric : displayHour,
      segment === "minute" ? numeric : Number(minuteText || 0),
      period
    );
  }

  function openContactForm() {
    setMessage("");
    if (!rules) {
      setMessage("Reservation hours are unavailable. Please retry shortly.");
      return;
    }
    if (!timeIsValid) {
      setMessage("Choose a future date and time within restaurant hours.");
      return;
    }
    if (!availability || availabilityQuery.isError || availabilityQuery.isLoading) {
      setMessage("Confirming seat availability. Please try again shortly.");
      return;
    }
    if (partySize > availability.available_pax) {
      setMessage("There are not enough seats available for that party size. Choose another time or fewer guests.");
      return;
    }
    setContactOpen(true);
  }

  async function submitReservation(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (isSubmitting || !canContinue) return;
    setIsSubmitting(true);
    setMessage("");

    try {
      const latestAvailability = await api.get<SlotAvailability>(
        "/api/reservations/table-availability",
        { params: { date, time } }
      );
      if (partySize > latestAvailability.data.available_pax) {
        throw new Error("This time slot no longer has enough seats. Choose another time or fewer guests.");
      }
      const response = await api.post<BookingResult>("/api/reservations/table", {
        customer_name: customerName.trim(),
        customer_phone: customerPhone,
        customer_email: customerEmail.trim(),
        date,
        time,
        party_size: partySize,
        reservation_type: reservationType
      });
      setBooking(response.data);
      setContactOpen(false);
    } catch (error) {
      setMessage(getApiErrorMessage(error, "Unable to confirm your table reservation. Please try again."));
    } finally {
      setIsSubmitting(false);
    }
  }

  if (booking) {
    return (
      <main className="px-3 py-3">
        <div className="customer-shell mb-3">
          <BackToHome />
        </div>
        <section className="customer-shell max-w-2xl">
          <div className="customer-card overflow-hidden">
            <div className="border-b border-katana-border px-6 py-5">
              <h1 className="flex items-center gap-2 font-display text-2xl font-bold text-white">
                <CalendarCheck className="h-5 w-5 text-emerald-400" /> Table reservation confirmed
              </h1>
            </div>
            <div className="space-y-4 p-6 text-sm text-neutral-300">
              <p className="rounded-xl border border-emerald-500/20 bg-emerald-500/10 px-4 py-3 font-semibold text-emerald-300">
                Booking ID: {booking.booking_id}
              </p>
              <p>{date} · {timeLabel} · {partySize} guest{partySize === 1 ? "" : "s"}</p>
              <p>Dining mode: {reservationType === "unlimited" ? "Unlimited" : "Regular a la carte"}</p>
              <p>Pay at the restaurant after dining. Your bill will be settled through POS.</p>
              <p className="font-semibold text-emerald-300">Status: Confirmed</p>
              <div className="grid gap-3">
                <Link className="customer-btn-primary text-center" to={`/reservation/status?bookingId=${booking.booking_id}`}>
                  View Reservation Status
                </Link>
                <Link className="customer-btn-secondary text-center" to="/reserve">
                  Make Another Reservation
                </Link>
              </div>
            </div>
          </div>
        </section>
      </main>
    );
  }

  return (
    <main className="w-full px-3 py-3 md:px-4">
      <div className="mx-auto grid w-full max-w-[1600px] items-start gap-3 lg:grid-cols-[minmax(0,1fr)_400px]">
        <section className="min-w-0 lg:col-start-1 lg:row-start-1">
          <BackToHome className="mb-3" />
          <div className="customer-card space-y-5 p-5 sm:p-6">
            <div>
              <p className="customer-kicker">Table reservation</p>
              <h1 className="mt-1 font-display text-3xl font-bold text-white">Book a table</h1>
              <p className="mt-2 text-sm text-[var(--customer-muted)]">
                Choose a time and party size. Your table is confirmed automatically; no table or menu items need to be selected.
              </p>
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <label className="block">
                <span className="customer-label">Date *</span>
                <input
                  className="customer-input"
                  type="date"
                  min={serverToday}
                  value={date}
                  onChange={(event) => setDate(event.target.value)}
                  required
                  disabled={!rules}
                />
              </label>

              <fieldset className="min-w-0">
                <legend className="customer-label">Reservation time *</legend>
                {rules ? (
                  <>
                    <div className="reservation-time-picker mt-1" role="group" aria-label="Reservation time">
                      <input
                        className="reservation-time-segment"
                        type="number"
                        min={1}
                        max={12}
                        step={1}
                        aria-label="Hour"
                        value={time ? displayHour : ""}
                        placeholder="hh"
                        onChange={(event) => updateTimeSegment(event.target.value, "hour")}
                      />
                      <span className="reservation-time-separator" aria-hidden="true">:</span>
                      <input
                        className="reservation-time-segment reservation-time-minute"
                        type="number"
                        min={0}
                        max={59}
                        step={1}
                        aria-label="Minute"
                        value={minuteText}
                        placeholder="mm"
                        onChange={(event) => updateTimeSegment(event.target.value, "minute")}
                      />
                      <span className="reservation-time-period" aria-label="AM or PM">
                        {(["AM", "PM"] as const).map((value) => (
                          <button
                            key={value}
                            type="button"
                            aria-pressed={Boolean(time) && period === value}
                            className={Boolean(time) && period === value ? "is-selected" : ""}
                            onClick={() => setDigitalTime(displayHour, Number(minuteText || 0), value)}
                          >
                            {value}
                          </button>
                        ))}
                      </span>
                    </div>
                    <p className="mt-2 text-xs text-[var(--customer-muted)]">
                      Open {formatTime12(rules.OPENING_TIME)} to {formatTime12(rules.CLOSING_TIME)}.
                    </p>
                    {!timeIsValid && time && (
                      <p className="mt-1 text-xs text-katana-red" role="status">Choose a future time within restaurant hours.</p>
                    )}
                  </>
                ) : rulesQuery.isError ? (
                  <div className="mt-2 text-sm text-katana-red" role="alert">
                    Reservation hours could not be loaded.
                    <button type="button" className="ml-2 underline" onClick={() => void rulesQuery.refetch()}>Retry</button>
                  </div>
                ) : (
                  <p className="mt-2 text-sm text-[var(--customer-muted)]" role="status">Loading reservation hours...</p>
                )}
              </fieldset>
            </div>

            <div>
              <span className="customer-label">Number of guests *</span>
              <div className="reservation-guest-stepper mt-1" aria-label="Number of guests">
                <button
                  type="button"
                  aria-label="Remove one guest"
                  onClick={() => setPartySize((value) => Math.max(1, value - 1))}
                  disabled={partySize <= 1}
                >
                  <Minus className="h-4 w-4" />
                </button>
                <span aria-live="polite">{partySize}</span>
                <button
                  type="button"
                  aria-label="Add one guest"
                  onClick={() => setPartySize((value) => Math.min(rules?.MAX_GUESTS ?? 20, value + 1))}
                  disabled={partySize >= (rules?.MAX_GUESTS ?? 20)}
                >
                  <Plus className="h-4 w-4" />
                </button>
              </div>
              <p className="mt-1 text-xs text-[var(--customer-muted)]">Maximum {rules?.MAX_GUESTS ?? 20} guests per booking.</p>
            </div>

            <fieldset>
              <legend className="customer-label">Dining mode *</legend>
              <div className="mt-2 grid gap-3 sm:grid-cols-2">
                {([
                  ["dine_in", "Regular a la carte"],
                  ["unlimited", "Unlimited"]
                ] as const).map(([value, label]) => (
                  <label
                    key={value}
                    className={`flex min-h-12 cursor-pointer items-center gap-3 rounded-xl border px-4 py-3 text-sm font-semibold ${
                      reservationType === value
                        ? "border-katana-red bg-katana-red/10 text-[var(--customer-text)]"
                        : "border-katana-border bg-[var(--customer-surface)] text-[var(--customer-muted)]"
                    }`}
                  >
                    <input
                      type="radio"
                      name="reservation-type"
                      value={value}
                      checked={reservationType === value}
                      onChange={() => setReservationType(value)}
                    />
                    {label}
                  </label>
                ))}
              </div>
            </fieldset>

            <div className="rounded-xl border border-katana-border bg-[var(--customer-surface-2)] p-4">
              <p className="font-semibold text-[var(--customer-text)]">Payment at the restaurant</p>
              <p className="mt-1 text-sm text-[var(--customer-muted)]">
                No payment is required to reserve a table. Complete payment through POS after dining.
              </p>
            </div>

            {message && <p className="rounded-xl border border-katana-red/30 bg-katana-red/10 px-4 py-3 text-sm text-katana-red" role="alert">{message}</p>}
          </div>
        </section>

        <aside className="min-w-0 lg:sticky lg:top-3 lg:col-start-2 lg:row-start-1">
          <div className="customer-card flex max-h-[calc(100vh-24px)] flex-col gap-4 overflow-y-auto p-5">
            <div>
              <p className="customer-kicker">Your booking</p>
              <h2 className="mt-1 font-display text-2xl font-bold text-white">Table reservation</h2>
            </div>
            <dl className="grid gap-3 border-y border-katana-border py-4 text-sm">
              <div className="flex justify-between gap-4">
                <dt className="text-[var(--customer-muted)]">Date</dt>
                <dd className="text-right font-semibold text-[var(--customer-text)]">{date || "Choose a date"}</dd>
              </div>
              <div className="flex justify-between gap-4">
                <dt className="text-[var(--customer-muted)]">Time</dt>
                <dd className="text-right font-semibold text-[var(--customer-text)]">{timeLabel}</dd>
              </div>
              <div className="flex justify-between gap-4">
                <dt className="text-[var(--customer-muted)]">Guests</dt>
                <dd className="text-right font-semibold text-[var(--customer-text)]">{partySize}</dd>
              </div>
              <div className="flex justify-between gap-4">
                <dt className="text-[var(--customer-muted)]">Dining mode</dt>
                <dd className="text-right font-semibold text-[var(--customer-text)]">
                  {reservationType === "unlimited" ? "Unlimited" : "Regular a la carte"}
                </dd>
              </div>
            </dl>

            <div className="min-h-12 text-sm" aria-live="polite">
              {!timeIsValid ? (
                <p className="text-[var(--customer-muted)]">Choose a valid future time to check seat availability.</p>
              ) : availabilityQuery.isLoading ? (
                <p className="text-[var(--customer-muted)]">Checking seat availability...</p>
              ) : availabilityQuery.isError ? (
                <p className="text-katana-red">Seat availability could not be checked. Please retry.</p>
              ) : availability ? (
                <p className={noSeats ? "font-semibold text-katana-red" : "font-semibold text-emerald-500"}>
                  {noSeats ? "Not enough seats available for this party." : "Seats are available for this time slot."}
                </p>
              ) : null}
            </div>

            <div className="reservation-checkout-submit mt-auto">
              <p>Confirmed automatically · Pay at the restaurant after dining.</p>
              <button
                type="button"
                className="customer-btn-primary"
                onClick={openContactForm}
                disabled={!canContinue}
              >
                Confirm booking
              </button>
            </div>
          </div>
        </aside>
      </div>

      <Dialog
        open={contactOpen}
        title="Contact details"
        onClose={() => setContactOpen(false)}
        panelClassName="max-w-lg"
      >
        <form className="grid gap-4" onSubmit={(event) => void submitReservation(event)}>
          <label className="block">
            <span className="customer-label">Full name *</span>
            <input
              className="customer-input"
              value={customerName}
              onChange={(event) => setCustomerName(event.target.value)}
              autoComplete="name"
              maxLength={120}
              required
            />
          </label>
          <label className="block">
            <span className="customer-label">Mobile number *</span>
            <input
              className="customer-input"
              type="tel"
              value={customerPhone}
              onChange={(event) => setCustomerPhone(event.target.value.replace(/\D/g, "").slice(0, 11))}
              autoComplete="tel"
              inputMode="numeric"
              maxLength={11}
              pattern="09[0-9]{9}"
              title="Enter an 11-digit mobile number starting with 09."
              required
            />
          </label>
          <label className="block">
            <span className="customer-label">Email address *</span>
            <input
              className="customer-input"
              type="email"
              value={customerEmail}
              onChange={(event) => setCustomerEmail(event.target.value)}
              autoComplete="email"
              maxLength={254}
              required
            />
          </label>
          <div className="rounded-xl border border-katana-border bg-[var(--customer-surface-2)] p-3 text-sm text-[var(--customer-muted)]">
            {date} · {timeLabel} · {partySize} guest{partySize === 1 ? "" : "s"} · {reservationType === "unlimited" ? "Unlimited" : "Regular a la carte"}
          </div>
          {message && <p className="rounded-xl border border-katana-red/30 bg-katana-red/10 px-4 py-3 text-sm text-katana-red" role="alert">{message}</p>}
          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <button type="button" className="customer-btn-secondary" onClick={() => setContactOpen(false)} disabled={isSubmitting}>Back</button>
            <button type="submit" className="customer-btn-primary" disabled={isSubmitting}>
              {isSubmitting ? "Confirming..." : "Confirm table reservation"}
            </button>
          </div>
        </form>
      </Dialog>
    </main>
  );
}

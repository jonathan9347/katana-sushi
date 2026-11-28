import { FormEvent, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useQueries, useQuery, useQueryClient } from "@tanstack/react-query";
import { CalendarCheck, CalendarDays, Check, ChevronRight, LoaderCircle, Minus, Plus, X } from "lucide-react";
import BackToHome from "../../components/layout/BackToHome";
import { Dialog } from "../../components/ui/dialog";
import { api } from "../../lib/api";
import { getApiErrorMessage } from "../../lib/errors";
import { formatTime12, todayManilaDateKey } from "../../lib/dateTime";
import { shortRef } from "../../lib/display";
import {
  fetchReservationRules,
  getServerNow,
  manilaDateKeyAt
} from "../../lib/reservationRules";
import {
  createReservationSlots,
  getReservationTimeState,
  isReservationTimePastToday,
  reservationSlotStart
} from "./tableReservationTime";
import "./TableReservationForm.css";

type SlotAvailability = {
  availability: "available" | "full";
  seats_left: number;
  checked_at: string;
};

type BookingResult = {
  booking_id: string;
  status: string;
  message: string;
};

function addDateDays(date: string, days: number) {
  const value = new Date(`${date}T12:00:00.000Z`);
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}

function dateChipLabel(date: string) {
  const value = new Date(`${date}T12:00:00.000Z`);
  return {
    weekday: new Intl.DateTimeFormat("en", { weekday: "short", timeZone: "UTC" }).format(value),
    day: new Intl.DateTimeFormat("en", { day: "numeric", timeZone: "UTC" }).format(value)
  };
}

function bookingErrorCode(error: unknown) {
  if (typeof error !== "object" || !error || !("response" in error)) return null;
  const response = (error as { response?: { data?: { code?: unknown } } }).response;
  return typeof response?.data?.code === "string" ? response.data.code : null;
}

export default function TableReservationForm() {
  const queryClient = useQueryClient();
  const [date, setDate] = useState(todayManilaDateKey());
  const [time, setTime] = useState("");
  const [timeSource, setTimeSource] = useState<"slot" | "custom" | null>(null);
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
  const reservationSlots = useMemo(
    () => rules ? createReservationSlots(rules) : [],
    [rules]
  );
  const dates = useMemo(
    () => Array.from({ length: 7 }, (_, index) => addDateDays(serverToday, index)),
    [serverToday]
  );
  const slotQueries = useQueries({
    queries: reservationSlots.map((slotTime) => ({
      queryKey: ["table-reservation-availability", date, slotTime, partySize],
      queryFn: async () => (await api.get<SlotAvailability>(
        "/api/reservations/table-availability",
        { params: { date, time: slotTime, party_size: partySize } }
      )).data,
      enabled: Boolean(
        rules
        && date >= serverToday
        && !isReservationTimePastToday(date, slotTime, rules.TIME_ZONE, serverNow)
      ),
      retry: 1,
      staleTime: 10_000,
      refetchInterval: 30_000,
      refetchOnWindowFocus: true
    }))
  });
  const selectedSlotStart = rules && time ? reservationSlotStart(time, rules) : null;
  const selectedSlotIndex = selectedSlotStart ? reservationSlots.indexOf(selectedSlotStart) : -1;
  const selectedAvailabilityQuery = selectedSlotIndex >= 0 ? slotQueries[selectedSlotIndex] : undefined;
  const availability = selectedAvailabilityQuery?.data;
  const timeState = rules
    ? getReservationTimeState({
      date,
      time,
      partySize,
      rules,
      now: serverNow,
      seatsLeft: availability?.seats_left
    })
    : "no_time";
  const timeLabel = time ? formatTime12(time) : "Choose a time";
  const canContinue = timeState === "available"
    && selectedAvailabilityQuery?.isSuccess
    && !selectedAvailabilityQuery.isError
    && !isSubmitting;

  function chooseTime(value: string, source: "slot" | "custom") {
    setTime(value);
    setTimeSource(source);
    setMessage("");
  }

  function openContactForm() {
    setMessage("");
    if (timeState !== "available" || !canContinue) {
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
      const code = bookingErrorCode(error);
      if (code === "TABLE_ASSIGNMENT_CONFLICT" || code === "TABLE_ALLOCATION_CHANGED") {
        setContactOpen(false);
        setMessage("Unavailable — no tables are free at this time. Please try another time.");
        if (selectedSlotStart) {
          await queryClient.invalidateQueries({
            queryKey: ["table-reservation-availability", date, selectedSlotStart, partySize]
          });
        }
      } else if (code === "RESERVATION_TIME_INVALID") {
        const hours = rules
          ? ` We're open ${formatTime12(rules.OPENING_TIME)} to ${formatTime12(rules.LAST_BOOKING_TIME)}.`
          : "";
        setMessage(`Cannot be booked — the selected time has passed or is outside booking hours.${hours}`);
        setContactOpen(false);
        await rulesQuery.refetch();
      } else {
        setMessage(getApiErrorMessage(error, "Unable to confirm your table reservation. Please try again."));
      }
    } finally {
      setIsSubmitting(false);
    }
  }

  if (booking) {
    return (
      <main className="table-reservation-page table-reservation-success">
        <div className="table-reservation-success-shell">
          <BackToHome />
          <section className="table-reservation-success-card">
            <div className="table-reservation-success-icon"><CalendarCheck aria-hidden="true" /></div>
            <p className="table-reservation-eyebrow">Table reservation</p>
            <h1>Your table is confirmed.</h1>
            <p className="table-reservation-success-copy">We look forward to welcoming you. Your booking reference is:</p>
            <p className="table-reservation-reference" title={booking.booking_id}>{shortRef(booking.booking_id)}</p>
            <p className="table-reservation-success-detail">
              {date} · {timeLabel} · {partySize} guest{partySize === 1 ? "" : "s"} · {reservationType === "unlimited" ? "Unlimited" : "Regular à la carte"}
            </p>
            <button
              type="button"
              className="table-reservation-primary-link"
              onClick={() => {
                setBooking(null);
                setDate(todayManilaDateKey());
                setTime("");
                setPartySize(1);
                setReservationType("dine_in");
                setMessage("");
              }}
            >
              Make another booking
            </button>
            <Link className="table-reservation-status-link" to={`/reservation/status?bookingId=${booking.booking_id}`}>
              View reservation status
            </Link>
          </section>
        </div>
      </main>
    );
  }

  const stateCopy = (() => {
    if (!time) {
      return {
        className: "is-neutral",
        title: "Choose a time",
        detail: "Choose a time to check seat availability."
      };
    }
    if (timeState === "outside_hours") {
      const selectedIsOutOfHours = rules
        && (time < rules.OPENING_TIME || time > rules.LAST_BOOKING_TIME);
      const pastToday = rules && isReservationTimePastToday(date, time, rules.TIME_ZONE, serverNow);
      return {
        className: "is-warning",
        title: "Cannot be booked",
        detail: pastToday
          ? "That time has already passed today. Please choose a later time."
          : selectedIsOutOfHours && rules
            ? `Cannot be booked — the restaurant is closed at this time. We're open ${formatTime12(rules.OPENING_TIME)} to ${formatTime12(rules.LAST_BOOKING_TIME)}.`
            : "Cannot be booked — choose a future date within restaurant hours."
      };
    }
    if (selectedAvailabilityQuery?.isError) {
      return {
        className: "is-unavailable",
        title: "Unavailable",
        detail: "Seat availability could not be checked. Please try again."
      };
    }
    if (selectedAvailabilityQuery?.isPending) {
      return {
        className: "is-unavailable",
        title: "Checking availability",
        detail: "Checking tables for this time and party size."
      };
    }
    if (availability && availability.seats_left < partySize) {
      return {
        className: "is-unavailable",
        title: "Unavailable",
        detail: availability.seats_left === 0
          ? "No tables are free at this time. Please try another time."
          : `Only ${availability.seats_left} seat${availability.seats_left === 1 ? "" : "s"} left. Please try another time or a smaller party.`
      };
    }
    const seatsLeft = availability?.seats_left ?? 0;
    return {
      className: "is-available",
      title: timeSource === "slot" ? "Seats available" : "Available",
      detail: `${seatsLeft} seat${seatsLeft === 1 ? "" : "s"} left at this time.`
    };
  })();

  return (
    <main className="table-reservation-page">
      <div className="table-reservation-layout">
        <section className="table-reservation-main">
          <div className="table-reservation-main-heading">
            <BackToHome />
            <p className="table-reservation-eyebrow">Table reservation</p>
            <h1>Book a table</h1>
            <p>Choose a date, time and dining style. Your reservation is confirmed automatically.</p>
          </div>

          <div className="table-reservation-form-card">
            <section className="table-reservation-section" aria-labelledby="reservation-date-title">
              <div className="table-reservation-section-heading">
                <span className="table-reservation-section-number">1</span>
                <div>
                  <h2 id="reservation-date-title">Choose a date</h2>
                  <p>Select a day in the next week or choose another date.</p>
                </div>
              </div>
              <div className="table-reservation-date-chips" role="group" aria-label="Dates for the next seven days">
                {dates.map((value) => {
                  const label = dateChipLabel(value);
                  const selected = date === value;
                  return (
                    <button
                      key={value}
                      type="button"
                      aria-pressed={selected}
                      className={`table-reservation-date-chip${selected ? " is-selected" : ""}`}
                      onClick={() => {
                        setDate(value);
                        setMessage("");
                      }}
                    >
                      <span>{label.weekday}</span>
                      <strong>{label.day}</strong>
                    </button>
                  );
                })}
              </div>
              <label className="table-reservation-date-input">
                <span>Or choose a date</span>
                <input
                  type="date"
                  min={serverToday}
                  value={date}
                  onChange={(event) => {
                    setDate(event.target.value);
                    setMessage("");
                  }}
                  required
                  disabled={!rules}
                />
              </label>
              <input
                type="date"
                aria-label="Date *"
                value={date}
                onChange={(event) => {
                  setDate(event.target.value);
                  setMessage("");
                }}
                required
                disabled={!rules}
                className="sr-only"
                style={{ position: "absolute", width: 1, height: 1, opacity: 0, pointerEvents: "none" }}
              />
            </section>

            <section className="table-reservation-section">
              <div className="table-reservation-section-heading">
                <span className="table-reservation-section-number">2</span>
                <div>
                  <h2>Reservation time</h2>
                  <p>{rules ? `${formatTime12(rules.OPENING_TIME)} – ${formatTime12(rules.LAST_BOOKING_TIME)}` : "Loading restaurant hours…"}</p>
                </div>
              </div>
              {rules ? (
                <>
                  <div className="table-reservation-slots" role="group" aria-label="Available slots">
                    {reservationSlots.map((slotTime, index) => {
                      const query = slotQueries[index];
                      const slotData = query?.data;
                      const isPast = isReservationTimePastToday(date, slotTime, rules.TIME_ZONE, serverNow);
                      const unavailable = isPast || (slotData?.seats_left ?? 1) <= 0;
                      const selected = timeSource === "slot" && time === slotTime;
                      const loading = !isPast && !slotData && query?.isPending;
                      return (
                        <button
                          key={slotTime}
                          type="button"
                          aria-pressed={selected}
                          aria-label={`${formatTime12(slotTime)}${unavailable ? ", unavailable" : slotData ? `, ${slotData.seats_left} seats left` : ", checking availability"}`}
                          className={`table-reservation-slot${selected ? " is-selected" : ""}${unavailable ? " is-unavailable" : ""}`}
                          disabled={unavailable}
                          onClick={() => chooseTime(slotTime, "slot")}
                        >
                          <strong>{formatTime12(slotTime)}</strong>
                          <span>{unavailable ? "Unavailable" : loading ? "Checking…" : `${slotData?.seats_left ?? "—"} seats left`}</span>
                        </button>
                      );
                    })}
                  </div>
                  <label className="table-reservation-custom-time">
                    <span>Or choose another time</span>
                    <input
                      type="time"
                      aria-label="Choose another reservation time"
                      value={time}
                      onChange={(event) => chooseTime(event.target.value, "custom")}
                    />
                  </label>
                  {time && (
                    <div
                      className="table-reservation-time-status"
                      role="status"
                      aria-live="polite"
                      data-testid="table-reservation-availability"
                    >
                      {timeState === "outside_hours" || timeState === "unavailable" ? "Full" : "Available"}
                    </div>
                  )}
                </>
              ) : rulesQuery.isError ? (
                <p className="table-reservation-load-error" role="alert">
                  Reservation hours could not be loaded.
                  <button type="button" onClick={() => void rulesQuery.refetch()}>Retry</button>
                </p>
              ) : (
                <p className="table-reservation-loading" role="status">Loading reservation hours…</p>
              )}
            </section>

            <section className="table-reservation-section" aria-labelledby="reservation-guests-title">
              <div className="table-reservation-section-heading">
                <span className="table-reservation-section-number">3</span>
                <div>
                  <h2 id="reservation-guests-title">Number of guests</h2>
                  <p>Choose between 1 and {rules?.MAX_GUESTS_PER_BOOKING ?? 20} guests.</p>
                </div>
              </div>
              <div className="table-reservation-guest-controls">
                <div className="table-reservation-stepper" aria-label="Number of guests">
                  <button
                    type="button"
                    aria-label="Remove one guest"
                    onClick={() => setPartySize((value) => Math.max(1, value - 1))}
                    disabled={partySize <= 1}
                  >
                    <Minus aria-hidden="true" />
                  </button>
                  <span aria-live="polite"><strong>{partySize}</strong><small>guests</small></span>
                  <button
                    type="button"
                    aria-label="Add one guest"
                    onClick={() => setPartySize((value) => Math.min(rules?.MAX_GUESTS_PER_BOOKING ?? 20, value + 1))}
                    disabled={partySize >= (rules?.MAX_GUESTS_PER_BOOKING ?? 20)}
                  >
                    <Plus aria-hidden="true" />
                  </button>
                </div>
                <div className="table-reservation-quick-guests" role="group">
                  {[2, 4, 6, 10].map((count) => (
                    <button
                      key={count}
                      type="button"
                      aria-pressed={partySize === count}
                      disabled={count > (rules?.MAX_GUESTS_PER_BOOKING ?? 20)}
                      className={partySize === count ? "is-selected" : ""}
                      onClick={() => setPartySize(count)}
                    >
                      {count}
                    </button>
                  ))}
                </div>
              </div>
              {rules && (
                <p className="table-reservation-guest-limit-note">Maximum {rules.MAX_GUESTS_PER_BOOKING} guests per booking.</p>
              )}
            </section>

            <section className="table-reservation-section" aria-labelledby="reservation-mode-title">
              <div className="table-reservation-section-heading">
                <span className="table-reservation-section-number">4</span>
                <div>
                  <h2 id="reservation-mode-title">Dining mode</h2>
                  <p>Select your preferred dining experience.</p>
                </div>
              </div>
              <fieldset className="table-reservation-mode-options">
                <legend className="sr-only">Choose dining mode</legend>
                {([
                  ["dine_in", "Regular à la carte", "Order from the menu and pay after dining."],
                  ["unlimited", "Unlimited", "Enjoy the Unlimited dining experience."]
                ] as const).map(([value, label, description]) => (
                  <label key={value} className={`table-reservation-mode-card${reservationType === value ? " is-selected" : ""}`}>
                    <input
                      type="radio"
                      name="reservation-type"
                      value={value}
                      checked={reservationType === value}
                      onChange={() => setReservationType(value)}
                    />
                    <span className="table-reservation-radio" aria-hidden="true" />
                    <span className="table-reservation-mode-copy">
                      <strong>{label}</strong>
                      <small>{description}</small>
                    </span>
                    {reservationType === value && <Check className="table-reservation-mode-check" aria-hidden="true" />}
                  </label>
                ))}
              </fieldset>
            </section>

            <div className="table-reservation-payment-note">
              <span className="table-reservation-payment-icon" aria-hidden="true">₱</span>
              <div>
                <strong>Payment at the restaurant</strong>
                <p>No payment is required to reserve. Settle your bill through POS after dining.</p>
              </div>
            </div>
            {message && <p className="table-reservation-form-message" role="alert">{message}</p>}
          </div>
        </section>

        <aside className="table-reservation-summary">
          <div className="table-reservation-summary-panel">
            <header className="table-reservation-summary-header">
              <p>Your booking</p>
              <h2>Table reservation</h2>
            </header>
            <div className="table-reservation-summary-body">
              <section className="table-reservation-summary-card" aria-label="Booking summary">
                <h3 className="table-reservation-card-label">Booking summary</h3>
                <dl className="table-reservation-summary-details">
                <div><dt>Date</dt><dd>{date || "Choose a date"}</dd></div>
                <div>
                  <dt>Time</dt>
                  <dd className={timeState === "outside_hours" ? "is-error" : ""}>{timeLabel}</dd>
                </div>
                <div><dt>Guests</dt><dd>{partySize}</dd></div>
                <div><dt>Dining mode</dt><dd>{reservationType === "unlimited" ? "Unlimited" : "Regular à la carte"}</dd></div>
                </dl>
              </section>

              <div className={`table-reservation-state ${stateCopy.className}`} role="status" aria-live="polite" data-testid="reservation-time-state">
                <span className="table-reservation-state-icon" aria-hidden="true"><CalendarCheck /></span>
                <strong>{stateCopy.title}</strong>
                <p>{stateCopy.detail}</p>
                {timeState === "available" && rules && availability && (
                  <div className="table-reservation-seats-progress">
                    <span
                      role="progressbar"
                      aria-label="Seats remaining for this time"
                      aria-valuemin={0}
                      aria-valuemax={rules.MAX_PAX_PER_SLOT}
                      aria-valuenow={Math.min(availability.seats_left, rules.MAX_PAX_PER_SLOT)}
                    >
                      <i style={{ width: `${Math.min(100, (availability.seats_left / rules.MAX_PAX_PER_SLOT) * 100)}%` }} />
                    </span>
                  </div>
                )}
              </div>

              <section className="table-reservation-next table-reservation-summary-card">
                <h3 className="table-reservation-card-label">What happens next</h3>
                <ol>
                  <li><Check aria-hidden="true" /><p>Your table is confirmed automatically.</p></li>
                  <li><Check aria-hidden="true" /><p>Arrive on time and enjoy your meal.</p></li>
                  <li><Check aria-hidden="true" /><p>Pay at the restaurant after dining.</p></li>
                </ol>
              </section>

              <section className="table-reservation-summary-card">
                <h3 className="table-reservation-card-label">Reservation information</h3>
                <div className="table-reservation-info-grid">
                <div><span>Opening hours</span><strong>{rules ? `${formatTime12(rules.OPENING_TIME)} – ${formatTime12(rules.LAST_BOOKING_TIME)}` : "Loading…"}</strong></div>
                <div><span>Party size</span><strong>1–{rules?.MAX_GUESTS_PER_BOOKING ?? 20} guests</strong></div>
                <div><span>Booking fee</span><strong>None</strong></div>
                <div><span>Payment</span><strong>At restaurant</strong></div>
                </div>
              </section>
            </div>

            <footer className="table-reservation-summary-footer">
              <button
                type="button"
                className="table-reservation-confirm"
                onPointerDown={(event) => {
                  const bounds = event.currentTarget.getBoundingClientRect();
                  event.currentTarget.style.setProperty("--reservation-ripple-x", `${event.clientX - bounds.left}px`);
                  event.currentTarget.style.setProperty("--reservation-ripple-y", `${event.clientY - bounds.top}px`);
                }}
                onClick={openContactForm}
                disabled={!canContinue}
              >
                {isSubmitting && <LoaderCircle className="table-reservation-action-spinner" aria-hidden="true" />}
                {isSubmitting ? "Confirming…" : timeState === "no_time" ? "Choose a time" : timeState === "outside_hours" ? "Cannot be booked" : timeState === "unavailable" ? selectedAvailabilityQuery?.isPending ? "Checking availability…" : "Unavailable" : "Confirm booking"}
                {timeState === "available" && <ChevronRight aria-hidden="true" />}
              </button>
              <p>Confirmed automatically · Pay at the restaurant after dining.</p>
            </footer>
          </div>
        </aside>
      </div>

      <Dialog
        open={contactOpen}
        title="Contact details"
        onClose={() => setContactOpen(false)}
        overlayClassName="!items-center !px-3 !py-4 sm:!px-5"
        panelClassName="!max-h-[calc(100vh-32px)] !max-w-[430px] !overflow-hidden !rounded-[24px] !border-0 !bg-white !p-0 !shadow-[0_24px_80px_rgba(36,26,28,0.12)] [&>div:first-child]:!hidden [&>div:last-child]:!bg-white [&>div:last-child]:!p-0 [&>div:last-child]:!overflow-y-auto"
      >
        <div className="table-reservation-contact-modal">
          <header className="table-reservation-contact-header">
            <div className="table-reservation-contact-header-copy">
              <p className="table-reservation-contact-kicker">Almost done</p>
              <h2 className="table-reservation-contact-title">Contact details</h2>
              <p className="table-reservation-contact-subtitle">So we can reach you about your reservation.</p>
            </div>
            <button
              type="button"
              aria-label="Close dialog"
              className="table-reservation-contact-close"
              onClick={() => setContactOpen(false)}
              disabled={isSubmitting}
            >
              <X aria-hidden="true" />
            </button>
          </header>
          <form className="table-reservation-contact-form" onSubmit={(event) => void submitReservation(event)} noValidate>
            <div className="table-reservation-contact-grid">
              <label className="table-reservation-contact-field table-reservation-contact-field-full">
                <span>Full name <span aria-hidden="true">*</span></span>
                <input
                  className="customer-input table-reservation-contact-input"
                  value={customerName}
                  onChange={(event) => setCustomerName(event.target.value)}
                  autoComplete="name"
                  maxLength={120}
                  required
                />
              </label>
              <label className="table-reservation-contact-field">
                <span>Mobile number <span aria-hidden="true">*</span></span>
                <input
                  className="customer-input table-reservation-contact-input"
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
              <label className="table-reservation-contact-field">
                <span>Email address <span aria-hidden="true">*</span></span>
                <input
                  className="customer-input table-reservation-contact-input"
                  type="email"
                  value={customerEmail}
                  onChange={(event) => setCustomerEmail(event.target.value)}
                  autoComplete="email"
                  maxLength={254}
                  required
                />
              </label>
            </div>
            <div className="table-reservation-contact-summary">
              <span className="table-reservation-contact-summary-icon"><CalendarDays aria-hidden="true" /></span>
              <span className="table-reservation-contact-summary-text">{date} · {timeLabel} · {partySize} guest{partySize === 1 ? "" : "s"} · {reservationType === "unlimited" ? "Unlimited" : "Regular à la carte"}</span>
            </div>
            {message && <p className="table-reservation-form-message" role="alert">{message}</p>}
            <button type="submit" className="table-reservation-contact-submit" disabled={isSubmitting}>
              {isSubmitting ? "Confirming…" : "Confirm table reservation"}
            </button>
            <button type="button" className="table-reservation-contact-back-link" onClick={() => setContactOpen(false)} disabled={isSubmitting}>Back</button>
          </form>
        </div>
      </Dialog>
    </main>
  );
}

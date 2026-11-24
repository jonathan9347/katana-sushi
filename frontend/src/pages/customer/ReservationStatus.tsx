import { FormEvent, useEffect, useState } from "react";
import { Link, useLocation, useNavigate, useSearchParams } from "react-router-dom";
import { CalendarPlus, Check, CheckCircle2, Clock3, CreditCard, LoaderCircle, Search, XCircle } from "lucide-react";
import BackToHome from "../../components/layout/BackToHome";
import { api } from "../../lib/api";
import { formatManilaDate, formatManilaDateTime, formatTime12, manilaDateKey, todayManilaDateKey } from "../../lib/dateTime";
import { formatCateringEventType } from "../../lib/reservationDetails";
import { formatCateringPackageSnapshots } from "../../lib/cateringPackageSnapshot";
import { getApiErrorMessage } from "../../lib/errors";
import {
  createPaymentIntent,
  formatPayMongoMethods,
  paymentPagePath,
  usePaymentConfig,
  verifyPayment
} from "../../lib/payment";

type StatusResult = {
  status: string;
  date?: string;
  time?: string;
  event_type?: string | null;
  event_type_other?: string | null;
  party_size?: number;
  package_total?: number;
  mobilization_fee?: number;
  total_price?: number | null;
  payment_plan?: string;
  downpayment_status?: string;
  initial_payment_due?: number;
  downpayment_amount?: number;
  net_paid?: number;
  remaining_balance?: number;
  payment_status?: string;
  ready_at?: string | null;
  pickup_time?: string | null;
  full_payment_paid?: boolean;
  remaining_paid_at_venue?: boolean;
  special_requests?: string | null;
  rejected_reason?: string | null;
  alternative_suggestions?: string | null;
  package_name?: string | null;
  package_snapshot?: unknown;
  venue_type?: string | null;
  order_items?: Array<{ name: string; quantity: number; unit_price: number; total_price: number }>;
  is_takeout?: boolean;
  is_catering?: boolean;
};

export default function ReservationStatus() {
  const location = useLocation();
  const [searchParams] = useSearchParams();
  const [bookingId, setBookingId] = useState(searchParams.get("bookingId") ?? "");
  const [phone, setPhone] = useState(() => {
    const state: unknown = location.state;
    return typeof state === "object"
      && state !== null
      && "pickupPhone" in state
      && typeof state.pickupPhone === "string"
      ? state.pickupPhone
      : "";
  });
  const [result, setResult] = useState<StatusResult | null>(null);
  const [message, setMessage] = useState("");
  const navigate = useNavigate();
  const paymentConfigQuery = usePaymentConfig();
  const hostedCheckout = paymentConfigQuery.data?.hostedCheckout === true;
  const paymentMethod = hostedCheckout ? "paymongo" as const : "cash" as const;
  const [isPaying, setIsPaying] = useState(false);

  const statusIcon =
    result?.status === "completed" || (result?.is_takeout && result.status === "released") ? (
      <Check className="h-6 w-6 text-green-500" strokeWidth={3} />
    ) : result?.status === "approved" || result?.status === "confirmed" ? (
      <CheckCircle2 className="h-6 w-6 text-emerald-400" />
    ) : ["rejected", "declined", "cancelled", "canceled", "expired", "no_show", "no-show"].includes(result?.status ?? "") ? (
      <XCircle className="h-6 w-6 text-katana-red" />
    ) : (
      <Clock3 className="h-6 w-6 text-amber-400" />
    );

  async function checkStatus(event?: FormEvent<HTMLFormElement>) {
    event?.preventDefault();
    setMessage("");
    setResult(null);

    if (!bookingId.trim()) {
      setMessage("Enter a booking ID.");
      return;
    }

    try {
      const bookingKey = bookingId.trim();
      if (bookingKey.toUpperCase().startsWith("KTO-")) {
        if (!phone) {
          setMessage("Enter the phone number used for this pickup order.");
          return;
        }
        const response = await api.get<{
          order: {
            status: string;
            payment_plan: "pay_now" | "pay_at_pickup";
            payment_status: string;
            ready_at: string | null;
            pickup_time?: string | null;
            total: number;
            items: NonNullable<StatusResult["order_items"]>;
          };
        }>(`/api/takeout/orders/${encodeURIComponent(bookingKey)}`, { params: { phone } });
        setResult({
          status: response.data.order.status,
          payment_plan: response.data.order.payment_plan,
          payment_status: response.data.order.payment_status,
          ready_at: response.data.order.ready_at,
          pickup_time: response.data.order.pickup_time,
          total_price: response.data.order.total,
          order_items: response.data.order.items,
          is_takeout: true
        });
        return;
      }
      const isCatering = bookingKey.toUpperCase().startsWith("CAT-");
      const endpoint = isCatering
        ? `/api/catering/reservations/status/${bookingKey}`
        : `/api/reservations/status/${bookingKey}`;
      const response = await api.get<StatusResult>(endpoint);
      setResult(isCatering ? { ...response.data, is_catering: true } : response.data);
    } catch {
      setMessage("Booking not found.");
    }
  }

  async function payCateringBalance(stage: "initial" | "balance") {
    if (!result?.is_catering) {
      return;
    }
    const reference = bookingId.trim();
    const amount = stage === "initial"
      ? Number(result.initial_payment_due ?? 0)
      : Number(result.remaining_balance ?? 0);
    if (!reference || !Number.isFinite(amount) || amount <= 0) {
      setMessage("There is no payment due for this booking.");
      return;
    }
    if (stage === "balance" && (!result.date || manilaDateKey(result.date) <= todayManilaDateKey())) {
      setMessage("The remaining catering balance must be paid before the event date.");
      return;
    }

    setIsPaying(true);
    setMessage("");
    try {
      const purpose = stage === "initial"
        ? result.payment_plan === "full_payment" ? "full_payment" : "downpayment"
        : "balance";

      if (hostedCheckout) {
        // PayMongo: the server sets the amount, reuses an open payment, and records the payment itself.
        const checkout = await createPaymentIntent({
          amount,
          paymentMethod: "paymongo",
          bookingId: reference,
          reservationType: "catering",
          purpose
        });
        if (checkout.alreadyPaid) {
          await checkStatus();
          return;
        }
        if (!checkout.success || !checkout.referenceId) {
          throw new Error(checkout.message || "Unable to open the payment page.");
        }
        navigate(paymentPagePath(checkout.referenceId));
        return;
      }

      const intent = await createPaymentIntent({
        amount,
        paymentMethod,
        bookingId: reference,
        reservationType: "catering",
        purpose,
        idempotencyKey: stage === "initial"
          ? `customer:${reference}:${purpose}:${paymentMethod}:${amount.toFixed(2)}`
          : `customer:${reference}:balance:${paymentMethod}:${amount.toFixed(2)}`,
        description: stage === "initial"
          ? `${purpose === "full_payment" ? "Package payment" : "Package downpayment"} for catering ${reference}`
          : `Remaining balance for catering ${reference}`
      });
      if (!intent.success) {
        throw new Error(intent.message || "Unable to start payment.");
      }
      const verification = await verifyPayment({
        referenceId: intent.referenceId,
        bookingId: reference,
        gatewayData: { amount, paymentMethod, purpose, reservationType: "catering" }
      });
      if (!verification.success || verification.status !== "paid") {
        throw new Error(verification.message || "Payment verification failed.");
      }
      if (stage === "initial") {
        await api.post(`/api/catering/reservations/${encodeURIComponent(reference)}/record-initial-payment`, {
          payment_transaction_id: verification.transactionId,
          payment_method: paymentMethod
        });
      } else {
        await api.post(`/api/catering/reservations/${encodeURIComponent(reference)}/pay-remaining`, {
          payment_transaction_id: verification.transactionId,
          payment_method: paymentMethod
        });
      }
      await checkStatus();
    } catch (error) {
      setMessage(getApiErrorMessage(error, "Payment could not be completed. Refresh the booking status and retry."));
    } finally {
      setIsPaying(false);
    }
  }

  useEffect(() => {
    if (bookingId) {
      void checkStatus();
    }
  }, []);

  const statusTone = result
    ? result.is_takeout
      ? result.status === "released" || result.status === "completed" || result.status === "ready"
        ? "green"
        : result.status === "pending_approval"
          ? "amber"
          : "green"
      : result.is_catering
        ? result.status === "pending_approval" ? "amber" : "green"
        : result.status === "confirmed" ? "green" : "amber"
    : "amber";

  const statusTitle = result
    ? result.is_takeout
      ? result.status === "released" || result.status === "completed"
        ? "Completed"
        : result.status === "ready"
          ? "Ready for pickup"
          : result.status === "pending_approval"
            ? "Waiting for approval"
            : result.status === "approved"
              ? "Approved"
              : result.status === "confirmed"
                ? "Confirmed"
                : "Status"
      : result.is_catering
        ? result.status === "pending_approval"
          ? "Waiting for approval"
          : result.status === "approved"
            ? "Approved"
            : result.status === "confirmed"
              ? "Table confirmed"
              : "Status"
        : result.status === "confirmed"
          ? "Table confirmed"
          : "Pending approval"
    : "Status";

  const statusMessage = result
    ? result.is_takeout
      ? result.status === "pending_approval"
        ? "We received your order. Staff will confirm it soon."
        : result.status === "ready" || result.status === "released" || result.status === "completed"
          ? "Your order is ready for pickup."
          : "Your order is being processed."
      : result.is_catering
        ? result.status === "pending_approval"
          ? "We received your 50% payment. Staff is reviewing your request."
          : "Your event request is confirmed."
        : result.status === "confirmed"
          ? "Your table is reserved."
          : "We received your request."
    : "";

  const progressSteps = result
    ? result.is_takeout
      ? ["Received", "Approved", "Ready", "Picked up"]
      : result.is_catering
        ? ["Request sent", "In review", "Approved", "Event day"]
        : ["Requested", "Confirmed", "Dined"]
    : [];

  const currentStepIndex = result
    ? result.is_takeout
      ? result.status === "pending_approval"
        ? 0
        : result.status === "approved"
          ? 1
          : result.status === "ready"
            ? 2
            : result.status === "released" || result.status === "completed"
              ? 3
              : 0
      : result.is_catering
        ? result.status === "pending_approval"
          ? 1
          : result.status === "approved"
            ? 2
            : result.status === "confirmed"
              ? 2
              : 0
        : result.status === "confirmed"
          ? 1
          : 0
    : 0;

  type DetailPair = {
    label: string;
    value: string;
    fullWidth?: boolean;
    isTag?: boolean;
  };

  type PaymentRow = {
    label: string;
    value: string;
    strong?: boolean;
    red?: boolean;
  };

  const detailPairs: DetailPair[] = result
    ? result.is_takeout
      ? [
          { label: "Ordered items", value: result.order_items?.length ? `${result.order_items.length} item${result.order_items.length === 1 ? "" : "s"}` : "—" },
          { label: "Total to pay", value: result.total_price != null ? `₱${result.total_price.toFixed(2)}` : "—" },
          { label: "Payment", value: result.payment_status ?? result.payment_plan ?? "Pay at pickup", isTag: Boolean(result.payment_status) || Boolean(result.payment_plan) }
        ]
      : result.is_catering
        ? [
            { label: "Event type", value: result.event_type ? formatCateringEventType(result.event_type, result.event_type_other) : "—" },
            { label: "Date & time", value: result.date && result.time ? `${formatManilaDate(result.date)} · ${formatTime12(result.time)}` : "—" },
            { label: "Package", value: result.package_name ?? "—", fullWidth: true }
          ]
        : [
            { label: "Date", value: result.date ? formatManilaDate(result.date) : "—" },
            { label: "Time", value: result.time ? formatTime12(result.time) : "—" },
            { label: "Party size", value: result.party_size != null ? `${result.party_size} guest${result.party_size === 1 ? "" : "s"}` : "—" },
            { label: "Payment", value: result.payment_status ?? result.payment_plan ?? "Pay at restaurant" }
          ]
    : [];

  const paymentRows: PaymentRow[] = result
    ? result.is_takeout
      ? [
          { label: "Item total", value: result.total_price != null ? `₱${result.total_price.toFixed(2)}` : "—" },
          { label: "Total to pay at pickup", value: result.total_price != null ? `₱${result.total_price.toFixed(2)}` : "—", strong: true }
        ]
      : result.is_catering
        ? [
            { label: "Package total", value: result.package_total != null ? `₱${result.package_total.toFixed(2)}` : "—" },
            { label: "Paid so far", value: result.net_paid != null ? `₱${result.net_paid.toFixed(2)}` : "—" },
            { label: "Balance due", value: result.remaining_balance != null ? `₱${result.remaining_balance.toFixed(2)}` : "—", strong: true, red: true }
          ]
        : []
    : [];

  const todayKey = todayManilaDateKey();
  const onlinePayment = hostedCheckout && result?.is_catering
    ? result.status === "pending_approval" && result.downpayment_status !== "paid" && Number(result.initial_payment_due ?? 0) > 0
      ? { stage: "initial" as const, amount: Number(result.initial_payment_due), label: result.payment_plan === "full_payment" ? "Pay package in full" : "Pay 50% downpayment" }
      : ["approved", "confirmed"].includes(result.status) &&
          Number(result.remaining_balance ?? 0) > 0 &&
          Boolean(result.date) &&
          manilaDateKey(result.date as string) > todayKey
        ? { stage: "balance" as const, amount: Number(result.remaining_balance), label: "Pay remaining balance" }
        : null
    : null;

  const venueDetails = result && result.is_catering
    ? [
        result.venue_type ? ["Venue address", result.venue_type] : null,
        result.total_price != null ? ["Approved total", `₱${result.total_price.toFixed(2)}`] : null,
        result.payment_plan ? ["Payment choice", result.payment_plan === "full_payment" ? "100% of package total" : "50% of package total"] : null,
        result.full_payment_paid !== undefined ? ["Full payment status", result.full_payment_paid ? "Paid" : "Not yet paid"] : null,
        result.package_name ? ["Package details", result.package_name] : null,
        result.special_requests ? ["Special requests", result.special_requests] : null,
        result.rejected_reason ? ["Reason", result.rejected_reason] : null
      ].filter(Boolean) as Array<[string, string]>
    : [];

  return (
    <main className="min-h-screen bg-[#f5f2f1] px-3 py-6 text-[#241a1c] md:px-4">
      <div className="customer-shell mb-4">
        <BackToHome />
      </div>
      <section className="customer-shell mx-auto max-w-[1180px]">
        <div className="mx-auto grid max-w-[1200px] gap-6 lg:grid-cols-3">
          <article className="mx-auto w-full max-w-[400px] overflow-hidden rounded-[22px] border border-[#ead9da] bg-white shadow-[0_18px_40px_rgba(36,26,28,0.08)]">
            <div className="border-b border-[#f0e3e4] px-5 py-5">
              <p className="text-[10px] font-extrabold uppercase tracking-[0.28em] text-[#b3262f]">Reservation</p>
              <h1 className="mt-2 text-[22px] font-extrabold tracking-[-0.04em] text-[#241a1c]">Check Booking Status</h1>
            </div>
            <form onSubmit={checkStatus} className="space-y-4 p-5">
              <label className="block">
                <span className="mb-2 block text-[11.5px] font-bold text-[#241a1c]">Booking ID</span>
                <input className="h-10 w-full rounded-[12px] border border-[#ead9da] bg-[#fdf5f5] px-3 text-[13px] text-[#241a1c] outline-none transition focus:border-[#b3262f] focus:ring-2 focus:ring-[#b3262f]/10 uppercase" value={bookingId} onChange={(event) => setBookingId(event.target.value)} placeholder="KTN-20260604-0001 or KTO-..." />
              </label>
              {bookingId.trim().toUpperCase().startsWith("KTO-") && (
                <label className="block">
                  <span className="mb-2 block text-[11.5px] font-bold text-[#241a1c]">Phone number used for pickup</span>
                  <input className="h-10 w-full rounded-[12px] border border-[#ead9da] bg-[#fdf5f5] px-3 text-[13px] text-[#241a1c] outline-none transition focus:border-[#b3262f] focus:ring-2 focus:ring-[#b3262f]/10" inputMode="numeric" maxLength={11} value={phone} onChange={(event) => setPhone(event.target.value.replace(/\D/g, "").slice(0, 11))} />
                </label>
              )}
              <button className="flex w-full items-center justify-center gap-2 rounded-[12px] bg-[#b3262f] px-4 py-3 text-[11px] font-extrabold uppercase tracking-[0.18em] text-white shadow-[0_10px_18px_rgba(179,38,47,0.18)] transition hover:bg-[#9f2029]" type="submit">
                <Search className="h-4 w-4" />
                Check status
              </button>
              {message && <p className="rounded-xl border border-[#f0c7c9] bg-[#fff5f5] px-3 py-2 text-sm font-medium text-[#b3262f]">{message}</p>}
            </form>

            {result && (
              <div className="border-t border-[#f0e3e4] p-5">
                <div aria-live="polite" className="flex items-center gap-3">
                  <div className={`flex h-9 w-9 items-center justify-center rounded-full ${statusTone === "amber" ? "bg-[#fff6e0] text-[#9a6200]" : "bg-[#e8f6ee] text-[#1f7a4d]"}`}>
                    {statusIcon}
                  </div>
                  <div className="min-w-0">
                    <p className="text-[10px] font-extrabold uppercase tracking-[0.22em] text-[#8d7a7d]">Status</p>
                    <p className="mt-1 text-lg font-extrabold text-[#241a1c]">{statusTitle}</p>
                  </div>
                </div>

                <p className={`mt-4 rounded-xl border px-3 py-2 text-sm ${statusTone === "amber" ? "border-[#f0d9a5] bg-[#fffaf0] text-[#7e5410]" : "border-[#bfe5cc] bg-[#f2faf5] text-[#1c6840]"}`} role="status">
                  {statusMessage}
                </p>

                {progressSteps.length > 0 && (
                  <div className="mt-5">
                    <div className="flex items-center gap-2">
                      {progressSteps.map((step, index) => {
                        const isComplete = index < currentStepIndex;
                        const isCurrent = index === currentStepIndex;
                        const isUpcoming = index > currentStepIndex;

                        return (
                          <div key={step} className="flex min-w-0 flex-1 items-center gap-2">
                            <div className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full border text-[8px] font-bold ${
                              isComplete
                                ? "border-[#b3262f] bg-[#b3262f] text-white"
                                : isCurrent
                                  ? "border-[#b3262f] bg-white text-[#b3262f]"
                                  : "border-[#e2d7d8] bg-[#f5f1f1] text-[#bdb0b1]"
                            }`}>
                              {isComplete ? <Check className="h-3 w-3" strokeWidth={3} /> : index + 1}
                            </div>
                            {index < progressSteps.length - 1 && (
                              <div className={`h-px flex-1 ${isComplete ? "bg-[#b3262f]" : isCurrent ? "bg-[#ead9da]" : "bg-[#ead9da]"}`} />
                            )}
                          </div>
                        );
                      })}
                    </div>
                    <div className="mt-2 flex items-start justify-between gap-2 text-[10px] font-semibold uppercase tracking-[0.08em] text-[#8d7a7d]">
                      {progressSteps.map((step, index) => (
                        <span key={`${step}-${index}`} className={index === currentStepIndex ? "text-[#241a1c]" : ""}>{step}</span>
                      ))}
                    </div>
                  </div>
                )}

                <div className="mt-5 grid grid-cols-2 gap-3">
                  {detailPairs.map((detail) => (
                    <div
                      key={detail.label}
                      className={`rounded-xl border border-[#f0e3e4] bg-[#fdf5f5] px-3 py-2 ${detail.fullWidth ? "col-span-2" : ""}`}
                    >
                      <p className="text-[10px] font-bold uppercase tracking-[0.12em] text-[#8d7a7d]">{detail.label}</p>
                      <div className="mt-1 flex items-center justify-between gap-2 text-[12px] font-bold text-[#241a1c]">
                        <span className="min-w-0 break-words">{detail.value}</span>
                        {detail.isTag && (
                          <span className="shrink-0 rounded-full border border-[#cfead9] bg-[#f0faf5] px-2 py-0.5 text-[9px] font-extrabold uppercase tracking-[0.08em] text-[#1f7a4d]">
                            {detail.value.includes("paid") || detail.value.toLowerCase().includes("paid") ? "Paid" : "Unpaid"}
                          </span>
                        )}
                      </div>
                    </div>
                  ))}
                </div>

                {paymentRows.length > 0 && (
                  <div className="mt-5 overflow-hidden rounded-[14px] border border-[#f0e3e4] bg-[#fff8f8]">
                    {paymentRows.map((row, index) => (
                      <div
                        key={row.label}
                        className={`flex items-center justify-between gap-3 px-3 py-2.5 text-[12px] ${index !== paymentRows.length - 1 ? "border-b border-[#f0e3e4]" : ""}`}
                      >
                        <span className="text-[#8d7a7d]">{row.label}</span>
                        <span className={`${row.strong ? "font-extrabold" : "font-semibold"} ${row.red ? "text-[#b3262f]" : "text-[#241a1c]"}`}>
                          {row.value}
                        </span>
                      </div>
                    ))}
                  </div>
                )}

                {onlinePayment && (
                  <div className="mt-4 rounded-[14px] border border-[#ead9da] bg-white p-3">
                    <button
                      type="button"
                      className="flex w-full items-center justify-center gap-2 rounded-[12px] bg-[#b3262f] px-4 py-3 text-[11px] font-extrabold uppercase tracking-[0.14em] text-white shadow-[0_10px_18px_rgba(179,38,47,0.18)] transition hover:bg-[#9f2029] disabled:cursor-wait disabled:opacity-70"
                      onClick={() => void payCateringBalance(onlinePayment.stage)}
                      disabled={isPaying}
                    >
                      {isPaying ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <CreditCard className="h-4 w-4" />}
                      {isPaying ? "Opening payment..." : `${onlinePayment.label} · ₱${onlinePayment.amount.toFixed(2)}`}
                    </button>
                    <p className="mt-2 text-center text-[11px] text-[#8d7a7d]">
                      {formatPayMongoMethods(paymentConfigQuery.data?.methods ?? []) || "QR Ph, card, GCash, or Maya"} via PayMongo
                      {paymentConfigQuery.data?.testMode ? " · test mode" : ""}
                    </p>
                  </div>
                )}

                {result.is_catering && venueDetails.length > 0 && (
                  <details className="mt-4 rounded-xl border border-[#ead9da] bg-[#fdf5f5]">
                    <summary className="cursor-pointer list-none px-3 py-2.5 text-[11px] font-extrabold uppercase tracking-[0.12em] text-[#241a1c]">
                      Venue and more details
                    </summary>
                    <div className="border-t border-[#ead9da] px-3 py-3 text-[12px] text-[#241a1c]">
                      <div className="space-y-2">
                        {venueDetails.map(([label, value]) => (
                          <div key={label} className="flex items-start justify-between gap-3">
                            <span className="text-[#8d7a7d]">{label}</span>
                            <span className="max-w-[58%] text-right font-semibold break-words">{value}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  </details>
                )}

                <Link className="mt-6 inline-flex w-full items-center justify-center gap-2 rounded-full border border-[#b3262f] bg-transparent px-4 py-2.5 text-[11px] font-extrabold uppercase tracking-[0.14em] text-[#b3262f] transition hover:bg-[#fff5f5]" to="/reserve">
                  <CalendarPlus className="h-4 w-4" />
                  Make another reservation
                </Link>
              </div>
            )}
          </article>
        </div>
      </section>
    </main>
  );
}

import { FormEvent, useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { CalendarPlus, Check, CheckCircle2, Clock3, Search, XCircle } from "lucide-react";
import BackToHome from "../../components/layout/BackToHome";
import { api } from "../../lib/api";
import { formatManilaDate, formatTime12, manilaDateKey, todayManilaDateKey } from "../../lib/dateTime";
import { formatCateringEventType } from "../../lib/reservationDetails";
import { formatCateringPackageSnapshots } from "../../lib/cateringPackageSnapshot";
import { getApiErrorMessage } from "../../lib/errors";
import { createPaymentIntent, verifyPayment } from "../../lib/payment";

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
  const [searchParams] = useSearchParams();
  const [bookingId, setBookingId] = useState(searchParams.get("bookingId") ?? "");
  const [phone, setPhone] = useState("");
  const [result, setResult] = useState<StatusResult | null>(null);
  const [message, setMessage] = useState("");
  const paymentMethod = "cash" as const;
  const [isPaying, setIsPaying] = useState(false);

  const statusIcon =
    result?.status === "completed" || (result?.is_takeout && result.status === "released") ? (
      <Check className="h-6 w-6 text-green-500" strokeWidth={3} />
    ) : result?.status === "approved" || result?.status === "confirmed" ? (
      <CheckCircle2 className="h-6 w-6 text-emerald-400" />
    ) : ["rejected", "cancelled", "canceled", "expired", "no_show", "no-show"].includes(result?.status ?? "") ? (
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
            total: number;
            items: NonNullable<StatusResult["order_items"]>;
          };
        }>(`/api/takeout/orders/${encodeURIComponent(bookingKey)}`, { params: { phone } });
        setResult({
          status: response.data.order.status,
          payment_plan: response.data.order.payment_plan,
          payment_status: response.data.order.payment_status,
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

  return (
    <main className="px-4 pt-3 pb-8 md:pb-10">
      <div className="customer-shell mb-4">
        <BackToHome />
      </div>
      <section className="customer-shell max-w-2xl">
        <div className="customer-card overflow-hidden">
          <div className="border-b border-katana-border px-6 py-5">
            <p className="customer-kicker">Reservation</p>
            <h1 className="mt-2 font-display text-3xl font-bold text-white">Check Booking Status</h1>
          </div>
          <form onSubmit={checkStatus} className="space-y-4 p-6">
            <label className="block">
              <span className="customer-label">Booking ID</span>
              <input className="customer-input uppercase" value={bookingId} onChange={(event) => setBookingId(event.target.value)} placeholder="KTN-20260604-0001 or KTO-..." />
            </label>
            {bookingId.trim().toUpperCase().startsWith("KTO-") && (
              <label className="block">
                <span className="customer-label">Phone number used for pickup</span>
                <input className="customer-input" inputMode="numeric" maxLength={11} value={phone} onChange={(event) => setPhone(event.target.value.replace(/\D/g, "").slice(0, 11))} />
              </label>
            )}
            <button className="customer-btn-primary flex w-full gap-2" type="submit">
              <Search className="h-4 w-4" /> Check Status
            </button>
            {message && <p className="rounded-xl border border-katana-red/30 bg-katana-red/10 px-4 py-3 text-sm text-katana-red">{message}</p>}
          </form>

          {result && (
            <div className="border-t border-katana-border p-6">
              <div className="flex items-center gap-3">
                {statusIcon}
                <div>
                  <p className="text-xs font-bold uppercase tracking-[0.18em] text-katana-muted">Status</p>
                  <p className="font-display text-2xl font-bold capitalize text-white">
                    {result.is_takeout && result.status === "released" ? "completed" : result.status.replace(/_/g, " ")}
                  </p>
                </div>
              </div>
              {result.is_takeout && result.status === "ready" && (
                <p className="mt-4 rounded-xl border border-emerald-400/50 bg-emerald-500/15 px-4 py-3 font-bold text-[var(--customer-text)]" role="status">
                  Your order is ready for pickup.
                </p>
              )}
              {result.is_takeout && result.status === "pending_approval" && (
              <p className="mt-4 rounded-xl border border-amber-400/50 bg-amber-500/10 px-4 py-3 font-semibold text-[var(--customer-text)]" role="status">
                Your pickup order was received and is waiting for staff approval.
              </p>
              )}
              <div className="mt-6 space-y-2 text-sm text-neutral-300">
                {result.date && <p>Date: {formatManilaDate(result.date)}</p>}
                {result.time && <p>Time: {formatTime12(result.time)}</p>}
                {result.event_type && <p>Event type: {formatCateringEventType(result.event_type, result.event_type_other)}</p>}
                {result.party_size !== undefined && !result.is_catering && <p>Party size: {result.party_size}</p>}
                {result.order_items?.map((item, index) => (
                  <p key={`${item.name}-${index}`}>{item.quantity} × {item.name} — ₱{item.total_price.toFixed(2)}</p>
                ))}
                {result.is_catering && result.package_total != null && <p>Package total: ₱{result.package_total.toFixed(2)}</p>}
                {result.is_catering && Number(result.mobilization_fee ?? 0) > 0 && (
                  <p>Mobilization fee: ₱{Number(result.mobilization_fee).toFixed(2)}</p>
                )}
                {result.total_price != null && <p>{result.is_catering ? "Approved total" : "Total"}: ₱{result.total_price.toFixed(2)}</p>}
                {result.payment_plan && <p>Payment choice: {
                  result.is_catering
                    ? result.payment_plan === "full_payment" ? "100% of package total" : "50% of package total"
                    : result.payment_plan === "full_payment" ? "Pay in full" :
                    result.payment_plan === "pay_at_venue" ? "Pay at the restaurant" :
                        result.payment_plan === "pay_now" ? "Pay online in full" :
                        result.payment_plan === "pay_at_pickup" ? "Pay at pickup" :
                          "Previous payment arrangement"
                }</p>}
                {result.total_price != null && result.net_paid !== undefined
                  ? <p>Payment collected: ₱{result.net_paid.toFixed(2)}</p>
                  : result.total_price != null && result.downpayment_amount !== undefined
                    ? <p>Payment collected: ₱{result.downpayment_amount.toFixed(2)}</p>
                    : null}
                {result.payment_status && <p>Payment status: {result.payment_status}</p>}
                {result.total_price != null && result.remaining_balance !== undefined && <p>Amount due: ₱{result.remaining_balance.toFixed(2)}</p>}
                {result.full_payment_paid !== undefined && <p>{result.is_catering ? "All approved charges paid" : "Full payment completed"}: {result.full_payment_paid ? "Yes" : "No"}</p>}
                {result.special_requests && <p>Special requests: {result.special_requests}</p>}
                {result.package_name && <p>Package: {result.package_name}</p>}
                {formatCateringPackageSnapshots(result.package_snapshot).map((line) => <p key={line}>{line}</p>)}
                {result.venue_type && <p>Venue address: {result.venue_type}</p>}
                {result.rejected_reason && <p className="text-katana-red">Reason: {result.rejected_reason}</p>}
                {result.alternative_suggestions && <p>Suggestion: {result.alternative_suggestions}</p>}
              </div>
              {result.is_catering && result.status === "pending_approval" && Number(result.initial_payment_due ?? 0) > 0 && (
                <section className="mt-6 space-y-3 rounded-xl border border-amber-400/30 bg-amber-400/10 p-4">
                  <p className="text-sm font-semibold text-[var(--customer-text)]">
                    Pay {result.payment_plan === "full_payment" ? "100%" : "50%"} of the package total to complete your request. Staff will review it afterward.
                  </p>
                  <p className="text-sm text-[var(--customer-text)]">Payment method: Cash (fake gateway)</p>
                  <button
                    className="customer-btn-primary w-full"
                    type="button"
                    disabled={isPaying}
                    onClick={() => void payCateringBalance("initial")}
                  >
                    {isPaying ? "Processing payment..." : `Pay package amount ₱${Number(result.initial_payment_due).toFixed(2)}`}
                  </button>
                </section>
              )}
              {result.is_catering && result.status === "pending_approval" && result.downpayment_status === "paid" && (
                <p className="mt-6 rounded-xl border border-amber-400/30 bg-amber-400/10 px-4 py-3 text-sm font-semibold text-[var(--customer-text)]">
                  Your initial package payment was received. The request is waiting for staff approval.
                </p>
              )}
              {result.is_catering && result.status === "confirmed" && Number(result.remaining_balance ?? 0) > 0 && (
                <section className="mt-6 space-y-3 rounded-xl border border-amber-400/30 bg-amber-400/10 p-4">
                  <p className="text-sm font-semibold text-[var(--customer-text)]">
                    Remaining balance, including any staff-added fee: ₱{Number(result.remaining_balance).toFixed(2)}. Pay before the event date.
                  </p>
                  {result.date && manilaDateKey(result.date) > todayManilaDateKey() ? (
                    <>
                      <p className="text-sm text-[var(--customer-text)]">Payment method: Cash (fake gateway)</p>
                      <button
                        className="customer-btn-primary w-full"
                        type="button"
                        disabled={isPaying}
                        onClick={() => void payCateringBalance("balance")}
                      >
                        {isPaying ? "Processing payment..." : `Pay remaining balance ₱${Number(result.remaining_balance).toFixed(2)}`}
                      </button>
                    </>
                  ) : (
                    <p className="text-sm text-[var(--customer-text)]">Online balance payment is no longer available on or after the event date.</p>
                  )}
                </section>
              )}
              <Link className="customer-btn-secondary mt-6 inline-flex gap-2" to="/reserve">
                <CalendarPlus className="h-4 w-4" /> Make Another Reservation
              </Link>
            </div>
          )}
        </div>
      </section>
    </main>
  );
}

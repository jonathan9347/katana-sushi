import { useEffect, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import axios from "axios";
import { CheckCircle2, Clock3, LoaderCircle, RefreshCw, ShieldCheck, XCircle } from "lucide-react";
import BackToHome from "../../components/layout/BackToHome";
import { clearCustomerPaymentAttempt, getPaymentStatus, type PaymentStatusResponse } from "../../lib/payment";

const POLL_INTERVAL_MS = 3000;
const MAX_POLL_MS = 3 * 60 * 1000;

const pesoFormatter = new Intl.NumberFormat("en-PH", { style: "currency", currency: "PHP" });

function purposeLabel(purpose?: PaymentStatusResponse["purpose"]) {
  if (purpose === "full_payment") return "Full package payment";
  if (purpose === "balance") return "Remaining balance";
  return "50% downpayment";
}

export default function PaymentReturn() {
  const [searchParams] = useSearchParams();
  const reference = searchParams.get("reference")?.trim() ?? "";
  const cancelled = searchParams.get("cancelled") === "1";
  const startedAt = useRef(Date.now());
  const [timedOut, setTimedOut] = useState(false);

  const statusQuery = useQuery({
    queryKey: ["payment-return-status", reference],
    queryFn: () => getPaymentStatus(reference),
    enabled: Boolean(reference),
    retry: (failureCount, error) =>
      !(axios.isAxiosError(error) && error.response?.status === 404) && failureCount < 3,
    refetchInterval: (query) => {
      const status = query.state.data?.status;
      const stillOpen = !status || status === "pending" || status === "created";
      if (!stillOpen || cancelled || Date.now() - startedAt.current > MAX_POLL_MS) {
        return false;
      }
      return POLL_INTERVAL_MS;
    },
    refetchIntervalInBackground: false
  });

  const payment = statusQuery.data;
  const isPaid = payment?.status === "paid";
  const isClosed = payment?.status === "expired" || payment?.status === "failed" || payment?.status === "cancelled";
  const isOpen = !isPaid && !isClosed;

  useEffect(() => {
    if (isPaid && payment?.reservationType === "catering") {
      clearCustomerPaymentAttempt("catering", payment.bookingId);
    }
  }, [isPaid, payment?.bookingId, payment?.reservationType]);

  useEffect(() => {
    if (!isOpen || cancelled) {
      return;
    }
    const remaining = MAX_POLL_MS - (Date.now() - startedAt.current);
    const timer = window.setTimeout(() => setTimedOut(true), Math.max(remaining, 0));
    return () => window.clearTimeout(timer);
  }, [isOpen, cancelled]);

  function checkAgain() {
    startedAt.current = Date.now();
    setTimedOut(false);
    void statusQuery.refetch();
  }

  const bookingStatusLink = payment?.bookingId
    ? `/reservation/status?bookingId=${encodeURIComponent(payment.bookingId)}`
    : "/reservation/status";
  const notFound = axios.isAxiosError(statusQuery.error) && statusQuery.error.response?.status === 404;

  let tone: "success" | "waiting" | "problem" = "waiting";
  let icon = <LoaderCircle className="h-7 w-7 animate-spin" aria-hidden="true" />;
  let title = "Confirming your payment";
  let body = "Hold on while we confirm your payment with PayMongo. This usually takes a few seconds.";

  if (!reference || notFound) {
    tone = "problem";
    icon = <XCircle className="h-7 w-7" aria-hidden="true" />;
    title = "Payment not found";
    body = "We couldn't find this payment. Check your booking status to see what is still due.";
  } else if (isPaid) {
    tone = "success";
    icon = <CheckCircle2 className="h-7 w-7" aria-hidden="true" />;
    title = "Payment received";
    body = payment?.purpose === "balance"
      ? "Your remaining balance is paid. See you at your event!"
      : "Your catering request is now with our staff for review. We'll contact you to confirm the details.";
  } else if (isClosed) {
    tone = "problem";
    icon = <XCircle className="h-7 w-7" aria-hidden="true" />;
    title = "Payment session ended";
    body = "This checkout is no longer active and nothing was charged. Start the payment again from your booking status page.";
  } else if (cancelled) {
    tone = "problem";
    icon = <XCircle className="h-7 w-7" aria-hidden="true" />;
    title = "Payment not completed";
    body = "You left the PayMongo page before paying. Your booking is saved; you can finish the payment from your booking status page.";
  } else if (statusQuery.isError) {
    tone = "problem";
    icon = <XCircle className="h-7 w-7" aria-hidden="true" />;
    title = "We couldn't check your payment";
    body = "Your connection or our server had a problem. If you paid, it will still be recorded. Try checking again.";
  } else if (timedOut) {
    icon = <Clock3 className="h-7 w-7" aria-hidden="true" />;
    title = "Still waiting for confirmation";
    body = "PayMongo hasn't confirmed this payment yet. If you already paid, it will appear on your booking shortly.";
  }

  const toneClasses = {
    success: "bg-emerald-500/15 text-emerald-500",
    waiting: "bg-amber-500/15 text-amber-500",
    problem: "bg-red-500/15 text-red-500"
  }[tone];

  return (
    <main className="px-4 pt-3 pb-8 md:pb-10">
      <div className="customer-shell mb-4">
        <BackToHome />
      </div>
      <section className="customer-shell max-w-lg" aria-live="polite">
        <div className="customer-card overflow-hidden">
          <div className="flex flex-col items-center gap-3 px-6 pt-8 pb-6 text-center">
            <span className={`flex h-14 w-14 items-center justify-center rounded-full ${toneClasses}`}>{icon}</span>
            <h1 className="font-display text-2xl font-bold text-[var(--customer-text)]">{title}</h1>
            <p className="text-sm text-[var(--customer-muted)]">{body}</p>
          </div>

          {payment && (
            <dl className="mx-6 mb-6 space-y-2 rounded-xl border border-[var(--customer-border)] px-4 py-3 text-sm">
              <div className="flex justify-between gap-4">
                <dt className="text-[var(--customer-muted)]">Booking</dt>
                <dd className="font-semibold text-[var(--customer-text)]">{payment.bookingId}</dd>
              </div>
              <div className="flex justify-between gap-4">
                <dt className="text-[var(--customer-muted)]">Payment</dt>
                <dd className="text-[var(--customer-text)]">{purposeLabel(payment.purpose)}</dd>
              </div>
              <div className="flex justify-between gap-4">
                <dt className="text-[var(--customer-muted)]">Amount</dt>
                <dd className="font-semibold text-[var(--customer-text)]">{pesoFormatter.format(payment.amount)}</dd>
              </div>
              {isPaid && payment.transactionId && (
                <div className="flex justify-between gap-4">
                  <dt className="text-[var(--customer-muted)]">PayMongo reference</dt>
                  <dd className="break-all text-right font-mono text-xs text-[var(--customer-text)]">{payment.transactionId}</dd>
                </div>
              )}
            </dl>
          )}

          <div className="grid gap-3 px-6 pb-6">
            <Link className="customer-btn-primary text-center" to={bookingStatusLink}>
              {isPaid ? "View booking status" : "Go to booking status"}
            </Link>
            {isOpen && reference && !notFound && (timedOut || statusQuery.isError || cancelled) && (
              <button type="button" className="customer-btn-secondary inline-flex items-center justify-center gap-2" onClick={checkAgain}>
                <RefreshCw className="h-4 w-4" aria-hidden="true" /> Check payment again
              </button>
            )}
          </div>

          <p className="flex items-center justify-center gap-2 border-t border-[var(--customer-border)] px-6 py-3 text-xs text-[var(--customer-muted)]">
            <ShieldCheck className="h-4 w-4 text-emerald-500" aria-hidden="true" />
            Payments are processed securely by PayMongo.
          </p>
        </div>
      </section>
    </main>
  );
}

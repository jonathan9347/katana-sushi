import { FormEvent, ReactNode, useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import axios from "axios";
import {
  ArrowLeft,
  CreditCard,
  Download,
  LoaderCircle,
  QrCode,
  ShieldCheck,
  Smartphone,
  Wallet,
  XCircle
} from "lucide-react";
import { getApiErrorMessage } from "../../lib/errors";
import {
  createCardPaymentMethod,
  getPaymentBilling,
  getPaymentStatus,
  paymentReturnUrl,
  redirectToPaymentProvider,
  startOnlinePayment,
  usePaymentConfig,
  type PaymentChannel,
  type PaymentNextAction,
  type PaymentStatusResponse
} from "../../lib/payment";

const MERCHANT_NAME = "Katana Sushi Catering";
const POLL_INTERVAL_MS = 3000;

const pesoFormatter = new Intl.NumberFormat("en-PH", { style: "currency", currency: "PHP" });
const cardInputClass =
  "h-11 w-full rounded-lg border border-[#d1d5db] bg-white px-3 text-[15px] font-normal text-[#111827] outline-none transition focus:border-[#c0392b] focus:ring-2 focus:ring-[#c0392b]/15";

const CHANNELS: Array<{ id: PaymentChannel; title: string; subtitle: string; icon: ReactNode }> = [
  { id: "qrph", title: "QR Ph", subtitle: "Scan with any bank or e-wallet app", icon: <QrCode className="h-5 w-5" aria-hidden="true" /> },
  { id: "card", title: "Card", subtitle: "Visa or Mastercard", icon: <CreditCard className="h-5 w-5" aria-hidden="true" /> },
  { id: "gcash", title: "GCash", subtitle: "Pay in the GCash app or website", icon: <Wallet className="h-5 w-5" aria-hidden="true" /> },
  { id: "paymaya", title: "Maya", subtitle: "Pay in the Maya app or website", icon: <Smartphone className="h-5 w-5" aria-hidden="true" /> }
];

function purposeLabel(purpose?: PaymentStatusResponse["purpose"]) {
  if (purpose === "full_payment") return "Full package payment";
  if (purpose === "balance") return "Remaining balance";
  return "50% downpayment";
}

function formatCountdown(milliseconds: number) {
  const totalSeconds = Math.max(Math.floor(milliseconds / 1000), 0);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${seconds.toString().padStart(2, "0")}`;
}

function parseExpiry(value: string) {
  const match = value.replace(/\s/g, "").match(/^(\d{1,2})\/?(\d{2}|\d{4})$/);
  if (!match) return null;
  const month = Number(match[1]);
  const year = match[2].length === 2 ? 2000 + Number(match[2]) : Number(match[2]);
  return month >= 1 && month <= 12 ? { month, year } : null;
}

export default function PaymentPage() {
  const { reference = "" } = useParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const configQuery = usePaymentConfig();
  const [channel, setChannel] = useState<PaymentChannel | null>(null);
  const [card, setCard] = useState({ name: "", number: "", expiry: "", cvc: "" });
  const [isPaying, setIsPaying] = useState(false);
  const [error, setError] = useState("");
  const [activeAction, setActiveAction] = useState<PaymentNextAction | null>(null);
  const [now, setNow] = useState(Date.now());

  const statusQuery = useQuery({
    queryKey: ["payment-page-status", reference],
    queryFn: () => getPaymentStatus(reference),
    enabled: Boolean(reference),
    retry: (failureCount, queryError) =>
      !(axios.isAxiosError(queryError) && queryError.response?.status === 404) && failureCount < 3,
    refetchInterval: (query) => {
      const status = query.state.data?.status;
      return activeAction?.type === "qr" && (status === "pending" || status === "created") ? POLL_INTERVAL_MS : false;
    }
  });

  const payment = statusQuery.data;
  const isOpen = payment?.status === "pending" || payment?.status === "created";
  const availableChannels = useMemo(() => {
    const allowed = configQuery.data?.methods ?? [];
    return CHANNELS.filter((option) => allowed.includes(option.id));
  }, [configQuery.data?.methods]);

  // Reopening the page while a QR code is still valid shows it again.
  useEffect(() => {
    if (!activeAction && payment?.nextAction?.type === "qr") {
      setActiveAction(payment.nextAction);
    }
  }, [payment?.nextAction, activeAction]);

  useEffect(() => {
    if (payment?.status === "paid") {
      navigate(`/payment/return?reference=${encodeURIComponent(reference)}`, { replace: true });
    }
  }, [payment?.status, reference, navigate]);

  useEffect(() => {
    if (activeAction?.type !== "qr") return;
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [activeAction]);

  const qrRemainingMs = activeAction?.type === "qr" && activeAction.expiresAt
    ? new Date(activeAction.expiresAt).getTime() - now
    : null;
  const qrExpired = qrRemainingMs !== null && qrRemainingMs <= 0;
  const bookingStatusLink = payment?.bookingId
    ? `/reservation/status?bookingId=${encodeURIComponent(payment.bookingId)}`
    : "/reservation/status";

  async function pay(event?: FormEvent) {
    event?.preventDefault();
    if (!channel || !payment || isPaying) return;
    setError("");
    setIsPaying(true);

    try {
      let paymentMethodId: string | undefined;
      if (channel === "card") {
        const publicKey = configQuery.data?.publicKey;
        const expiry = parseExpiry(card.expiry);
        const number = card.number.replace(/\D/g, "");
        if (!publicKey) throw new Error("Card payments are not available right now.");
        if (number.length < 13 || number.length > 19) throw new Error("Enter a valid card number.");
        if (!expiry) throw new Error("Enter the expiry date as MM/YY.");
        if (!/^\d{3,4}$/.test(card.cvc)) throw new Error("Enter the 3 or 4 digit security code.");
        const billing = await getPaymentBilling(reference);
        if (!billing.email) throw new Error("This booking has no email address for card payments. Choose another method.");
        paymentMethodId = await createCardPaymentMethod(
          publicKey,
          { name: card.name.trim(), number, expMonth: expiry.month, expYear: expiry.year, cvc: card.cvc },
          { name: billing.name ?? card.name.trim(), email: billing.email }
        );
      }

      const result = await startOnlinePayment(reference, {
        channel,
        paymentMethodId,
        returnUrl: paymentReturnUrl()
      });

      if (result.status === "paid") {
        navigate(`/payment/return?reference=${encodeURIComponent(reference)}`, { replace: true });
        return;
      }
      if (result.status === "action_required" && result.nextAction?.type === "redirect") {
        redirectToPaymentProvider(result.nextAction.url);
        return;
      }
      if (result.status === "action_required" && result.nextAction?.type === "qr") {
        setActiveAction(result.nextAction);
        setNow(Date.now());
        await queryClient.invalidateQueries({ queryKey: ["payment-page-status", reference] });
        return;
      }
      if (result.status === "failed") {
        throw new Error(result.message || "The payment did not go through. Please try another method.");
      }
      await queryClient.invalidateQueries({ queryKey: ["payment-page-status", reference] });
    } catch (payError) {
      setError(getApiErrorMessage(payError, "The payment could not be started. Please try again."));
    } finally {
      setIsPaying(false);
    }
  }

  function useAnotherMethod() {
    setActiveAction(null);
    setChannel(null);
    setError("");
  }

  function saveQrCode() {
    if (activeAction?.type !== "qr") return;
    const link = document.createElement("a");
    link.href = activeAction.imageUrl;
    link.download = `katana-sushi-${payment?.bookingId ?? "payment"}-qrph.png`;
    link.click();
  }

  const notFound = !reference || (axios.isAxiosError(statusQuery.error) && statusQuery.error.response?.status === 404);
  const isLoading = statusQuery.isLoading || configQuery.isLoading;
  const amount = payment ? pesoFormatter.format(payment.amount) : "";

  return (
    <main className="min-h-screen bg-[#f4f4f6] px-3 py-6 md:px-6 md:py-10">
      <section className="mx-auto w-full max-w-[1100px] overflow-hidden rounded-[22px] border border-[#e6e6ea] bg-white shadow-[0_18px_44px_rgba(17,24,39,0.08)]">
        {/* text-[#ffffff], not text-white: the customer theme repaints any "text-white" class. */}
        <header className="flex flex-wrap items-center justify-between gap-x-4 gap-y-3 bg-[#111827] px-5 py-4 text-[#ffffff] md:px-8">
          <div className="flex min-w-[15rem] flex-1 items-center gap-3">
            <Link
              to={bookingStatusLink}
              aria-label="Back to booking status"
              className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-white/10 text-[#ffffff] transition hover:bg-white/20"
            >
              <ArrowLeft className="h-5 w-5" aria-hidden="true" />
            </Link>
            <img src="/images/katana-logo.jpg" alt="" className="h-10 w-10 shrink-0 rounded-xl object-cover" />
            <span className="truncate text-lg font-bold text-[#ffffff]">{MERCHANT_NAME}</span>
          </div>
          {payment && (
            <div className="ml-auto shrink-0 text-right">
              <p className="text-xs text-[#ffffff]/70">Reference number</p>
              <p className="text-sm font-extrabold tracking-wide text-[#ffffff] md:text-base">{payment.bookingId}</p>
            </div>
          )}
        </header>

        {isLoading ? (
          <div className="flex items-center justify-center gap-3 px-6 py-24 text-sm text-[#4b5563]">
            <LoaderCircle className="h-5 w-5 animate-spin" aria-hidden="true" /> Loading payment…
          </div>
        ) : notFound || !payment ? (
          <ClosedNotice
            title="Payment not found"
            body="We couldn't find this payment. Check your booking status to see what is still due."
            link={bookingStatusLink}
          />
        ) : !isOpen ? (
          <ClosedNotice
            title="This payment session has ended"
            body="Nothing more will be charged on this session. Start the payment again from your booking status page."
            link={bookingStatusLink}
          />
        ) : (
          <div className="grid gap-6 p-5 md:p-8 lg:grid-cols-[minmax(0,1fr)_minmax(0,560px)] lg:gap-10">
            <div className="min-w-0">
              <h1 className="text-lg font-bold leading-snug text-[#111827] md:text-xl">
                {MERCHANT_NAME.toUpperCase()} {payment.bookingId} — {purposeLabel(payment.purpose)}
              </h1>
              <p className="mt-3 font-sans text-4xl font-extrabold tracking-tight text-[#c0392b] md:text-5xl">{amount}</p>
              {configQuery.data?.testMode && (
                <p className="mt-2 inline-block rounded-full bg-amber-100 px-3 py-1 text-xs font-bold uppercase tracking-wide text-amber-800">
                  Test mode · no real charge
                </p>
              )}
              <dl className="mt-6 space-y-3 border-t border-dashed border-[#e5e7eb] pt-5 text-[15px]">
                <div className="flex justify-between gap-4 text-[#4b5563]">
                  <dt>Subtotal</dt>
                  <dd className="text-[#111827]">{amount}</dd>
                </div>
                <div className="flex justify-between gap-4 text-[#4b5563]">
                  <dt>Fees</dt>
                  <dd className="text-[#111827]">Free</dd>
                </div>
                <div className="flex justify-between gap-4 border-t border-dashed border-[#e5e7eb] pt-4 text-[17px] font-bold text-[#111827]">
                  <dt>Total due</dt>
                  <dd>{amount}</dd>
                </div>
              </dl>
            </div>

            <div className="rounded-[18px] border border-[#e5e7eb] p-5 md:p-6">
              {activeAction?.type === "qr" ? (
                <div className="flex flex-col items-center text-center" aria-live="polite">
                  <h2 className="text-xl font-bold text-[#111827]">Scan to pay</h2>
                  <p className="mt-1 text-sm text-[#4b5563]">Open your bank or e-wallet app and scan this QR Ph code.</p>
                  <img
                    src={activeAction.imageUrl}
                    alt="QR Ph code for this payment"
                    className={`mt-5 h-64 w-64 rounded-lg border border-[#e5e7eb] object-contain ${qrExpired ? "opacity-30" : ""}`}
                  />
                  {qrExpired ? (
                    <p className="mt-4 text-sm font-semibold text-[#c0392b]">This QR code has expired. Choose a method to get a new one.</p>
                  ) : (
                    <>
                      <p className="mt-4 flex items-center gap-2 text-[15px] text-[#111827]">
                        <LoaderCircle className="h-4 w-4 animate-spin" aria-hidden="true" /> Waiting for your payment…
                      </p>
                      {qrRemainingMs !== null && (
                        <p className="mt-1 text-xs text-[#6b7280]">Expires in {formatCountdown(qrRemainingMs)}</p>
                      )}
                    </>
                  )}
                  <div className="mt-5 flex flex-wrap justify-center gap-3">
                    <button
                      type="button"
                      onClick={saveQrCode}
                      disabled={qrExpired}
                      className="inline-flex items-center gap-2 rounded-xl border border-[#d1d5db] px-4 py-2.5 text-sm font-semibold text-[#111827] transition hover:bg-[#f9fafb] disabled:opacity-50"
                    >
                      <Download className="h-4 w-4" aria-hidden="true" /> Save QR code
                    </button>
                    <button
                      type="button"
                      onClick={useAnotherMethod}
                      className="rounded-xl border border-[#d1d5db] px-4 py-2.5 text-sm font-semibold text-[#111827] transition hover:bg-[#f9fafb]"
                    >
                      Use another method
                    </button>
                  </div>
                  {configQuery.data?.testMode && activeAction.testUrl && !qrExpired && (
                    <a
                      href={activeAction.testUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="mt-4 text-xs font-semibold text-[#c0392b] underline underline-offset-2"
                    >
                      Test mode: simulate scanning this code
                    </a>
                  )}
                </div>
              ) : (
                <form onSubmit={pay} noValidate>
                  <h2 className="text-xl font-bold text-[#111827]">Payment method</h2>
                  {payment.lastError && !error && (
                    <p className="mt-3 rounded-xl border border-[#f5c2c0] bg-[#fdf2f2] px-3 py-2 text-sm text-[#b42318]" role="status">
                      Your last attempt didn't go through: {payment.lastError} Please try again or choose another method.
                    </p>
                  )}
                  <fieldset className="mt-4 space-y-3">
                    <legend className="sr-only">Choose how to pay</legend>
                    {availableChannels.map((option) => {
                      const selected = channel === option.id;
                      return (
                        <label
                          key={option.id}
                          className={`flex cursor-pointer items-center gap-4 rounded-xl border px-4 py-3.5 transition ${
                            selected ? "border-[#c0392b] bg-[#fdf3f2] shadow-[inset_0_0_0_1px_#c0392b]" : "border-[#e5e7eb] hover:border-[#c9cdd4]"
                          }`}
                        >
                          <input
                            type="radio"
                            name="payment-channel"
                            value={option.id}
                            checked={selected}
                            onChange={() => { setChannel(option.id); setError(""); }}
                            className="h-5 w-5 accent-[#c0392b]"
                          />
                          <span className="text-[#374151]">{option.icon}</span>
                          <span className="min-w-0">
                            <span className="block font-semibold text-[#111827]">{option.title}</span>
                            <span className="block text-sm text-[#6b7280]">{option.subtitle}</span>
                          </span>
                        </label>
                      );
                    })}
                  </fieldset>

                  {channel === "card" && (
                    <div className="mt-4 grid gap-3 rounded-xl border border-[#e5e7eb] bg-[#fafafa] p-4">
                      <CardField label="Name on card">
                        <input
                          className={cardInputClass}
                          autoComplete="cc-name"
                          value={card.name}
                          onChange={(event) => setCard((current) => ({ ...current, name: event.target.value }))}
                        />
                      </CardField>
                      <CardField label="Card number">
                        <input
                          className={cardInputClass}
                          inputMode="numeric"
                          autoComplete="cc-number"
                          placeholder="1234 5678 9012 3456"
                          value={card.number}
                          onChange={(event) => setCard((current) => ({
                            ...current,
                            number: event.target.value.replace(/[^\d]/g, "").slice(0, 19).replace(/(\d{4})(?=\d)/g, "$1 ")
                          }))}
                        />
                      </CardField>
                      <div className="grid grid-cols-2 gap-3">
                        <CardField label="Expiry (MM/YY)">
                          <input
                            className={cardInputClass}
                            inputMode="numeric"
                            autoComplete="cc-exp"
                            placeholder="MM/YY"
                            value={card.expiry}
                            onChange={(event) => {
                              const digits = event.target.value.replace(/\D/g, "").slice(0, 4);
                              setCard((current) => ({ ...current, expiry: digits.length > 2 ? `${digits.slice(0, 2)}/${digits.slice(2)}` : digits }));
                            }}
                          />
                        </CardField>
                        <CardField label="Security code">
                          <input
                            className={cardInputClass}
                            inputMode="numeric"
                            autoComplete="cc-csc"
                            placeholder="CVC"
                            value={card.cvc}
                            onChange={(event) => setCard((current) => ({ ...current, cvc: event.target.value.replace(/\D/g, "").slice(0, 4) }))}
                          />
                        </CardField>
                      </div>
                      <p className="text-xs text-[#6b7280]">Your card details go directly to PayMongo and are never stored by Katana Sushi.</p>
                    </div>
                  )}

                  {error && (
                    <p className="mt-4 rounded-xl border border-[#f5c2c0] bg-[#fdf2f2] px-3 py-2 text-sm text-[#b42318]" role="alert">
                      {error}
                    </p>
                  )}

                  <button
                    type="submit"
                    disabled={!channel || isPaying || configQuery.data?.available === false}
                    className="mt-5 flex w-full items-center justify-center gap-2 rounded-xl bg-[#c0392b] px-4 py-3.5 text-base font-bold text-[#ffffff] transition hover:bg-[#a93226] disabled:cursor-not-allowed disabled:bg-[#e3a19b]"
                  >
                    {isPaying && <LoaderCircle className="h-5 w-5 animate-spin" aria-hidden="true" />}
                    {isPaying ? "Processing…" : `Pay ${amount}`}
                  </button>
                </form>
              )}

              <p className="mt-5 flex items-start gap-2 border-t border-[#f0f0f2] pt-4 text-[13px] leading-snug text-[#4b5563]">
                <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" aria-hidden="true" />
                <span>
                  Payments are processed securely by PayMongo. By completing your purchase, you agree to PayMongo's{" "}
                  <a className="font-semibold underline" href="https://www.paymongo.com/privacy" target="_blank" rel="noopener noreferrer">
                    Privacy Policy
                  </a>.
                </span>
              </p>
            </div>
          </div>
        )}
      </section>
    </main>
  );
}

function CardField({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="grid gap-1 text-sm font-semibold text-[#374151]">
      {label}
      {children}
    </label>
  );
}

function ClosedNotice({ title, body, link }: { title: string; body: string; link: string }) {
  return (
    <div className="flex flex-col items-center gap-3 px-6 py-16 text-center">
      <span className="flex h-14 w-14 items-center justify-center rounded-full bg-red-50 text-[#c0392b]">
        <XCircle className="h-7 w-7" aria-hidden="true" />
      </span>
      <h1 className="text-xl font-bold text-[#111827]">{title}</h1>
      <p className="max-w-md text-sm text-[#4b5563]">{body}</p>
      <Link
        to={link}
        className="mt-2 rounded-xl bg-[#c0392b] px-5 py-3 text-sm font-bold text-[#ffffff] transition hover:bg-[#a93226]"
      >
        Go to booking status
      </Link>
    </div>
  );
}

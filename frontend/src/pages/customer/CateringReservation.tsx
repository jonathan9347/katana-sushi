import { FormEvent, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { Banknote, Landmark, Send, ShieldCheck, Smartphone } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { api } from "../../lib/api";
import { getApiErrorMessage } from "../../lib/errors";
import { createPaymentIntent, verifyPayment, buildReservationReference, type PaymentMethod } from "../../lib/payment";
import { todayManilaDateKey } from "../../lib/dateTime";

type CateringPackage = {
  id: string;
  stationType?: string;
  name: string;
  description: string | null;
  pricePerPerson: number;
  minPax: number;
  maxPax: number;
  items: {
    pricingType?: "flat" | "range" | "quote";
    flatPrice?: number;
    minPrice?: number;
    maxPrice?: number;
    inclusions?: Array<string | { name: string; description?: string }>;
  } | null;
  imageUrl: string | null;
};

type SuccessState = {
  reservationId: string;
  downpaymentAmount: number;
  remainingBalance: number;
  paymentMethod: string;
};

function money(value: number) {
  return new Intl.NumberFormat("en-PH", { style: "currency", currency: "PHP", minimumFractionDigits: 2 }).format(value);
}

const stations = [
  { id: "sushi_station", name: "Sushi Station", summary: "Maki, sushi, and nigiri selections", image: "/images/cateringf.jpg" },
  { id: "sashimi_bar", name: "Sashimi Bar", summary: "Whole tuna sashimi service", image: "/images/catering-banner.jpg" },
  { id: "tempura_live", name: "Tempura Live", summary: "Live tempura station", image: "/images/unli-dining.jpg" }
];

function today() {
  return todayManilaDateKey();
}

function getStationType(item: CateringPackage) {
  if (item.stationType) {
    return item.stationType;
  }

  if (item.id.includes("sashimi")) {
    return "sashimi_bar";
  }

  if (item.id.includes("tempura")) {
    return "tempura_live";
  }

  return "sushi_station";
}

function getPackagePrice(item?: CateringPackage) {
  if (!item?.items) {
    return 0;
  }

  if (item.items.pricingType === "flat") {
    return item.items.flatPrice ?? 0;
  }

  if (item.items.pricingType === "range") {
    return item.items.minPrice ?? 0;
  }

  return 0;
}

function getPackagePriceLabel(item: CateringPackage) {
  if (item.items?.pricingType === "flat") {
    return money(item.items.flatPrice ?? 0);
  }

  if (item.items?.pricingType === "range") {
    return `${money(item.items.minPrice ?? 0)}-${money(item.items.maxPrice ?? 0)}`;
  }

  return "Custom quote";
}

export default function CateringReservation() {
  const [step, setStep] = useState(1);
  const [form, setForm] = useState<{
    event_date: string;
    venue_address: string;
    station_types: string[];
    package_id: string;
    customer_name: string;
    customer_phone: string;
    customer_email: string;
    special_requests: string;
    payment_method: PaymentMethod;
    payment_plan: "initial_only" | "full_payment";
    acknowledged: boolean;
  }>({
    event_date: today(),
    venue_address: "",
    station_types: ["sushi_station"],
    package_id: "",
    customer_name: "",
    customer_phone: "",
    customer_email: "",
    special_requests: "",
    payment_method: "cash",
    payment_plan: "initial_only",
    acknowledged: false
  });
  const [notice, setNotice] = useState("");
  const [paymentNotice, setPaymentNotice] = useState("");
  const [isProcessingPayment, setIsProcessingPayment] = useState(false);
  const [success, setSuccess] = useState<SuccessState | null>(null);

  const packagesQuery = useQuery({
    queryKey: ["catering-packages"],
    queryFn: async () => (await api.get<{ packages: CateringPackage[] }>("/api/catering/packages")).data.packages,
    retry: 1
  });

  const packages = packagesQuery.data ?? [];
  const stationPackages = packages.filter((item) => form.station_types.includes(getStationType(item)));
  const selectedPackage = stationPackages.find((item) => item.id === form.package_id) ?? stationPackages[0];

  useEffect(() => {
    if (stationPackages.length > 0 && !stationPackages.some((item) => item.id === form.package_id)) {
      setField("package_id", stationPackages[0].id);
    }
  }, [stationPackages, form.package_id]);

  useEffect(() => {
    window.scrollTo({ top: 0, behavior: "smooth" });
  }, [step]);
  const headcountNumber = selectedPackage?.minPax ?? 10;
  const subtotal = getPackagePrice(selectedPackage);
  const tax = Number((subtotal * 0.12).toFixed(2));
  const totalPrice = Number((subtotal + tax).toFixed(2));
  const isFullPayment = form.payment_plan === "full_payment";
  const paymentAmount = Number((isFullPayment ? totalPrice : Number((totalPrice * 0.5).toFixed(2))).toFixed(2));
  const remaining = Number((totalPrice - paymentAmount).toFixed(2));
  const [summaryOpen, setSummaryOpen] = useState(false);
  const stationCount = form.station_types.length;
  const subtotalTotal = Number((subtotal * stationCount).toFixed(2));
  const taxTotal = Number((subtotalTotal * 0.12).toFixed(2));
  const totalPriceTotal = Number((subtotalTotal + taxTotal).toFixed(2));
  const paymentAmountTotal = Number((isFullPayment ? totalPriceTotal : Number((totalPriceTotal * 0.5).toFixed(2))).toFixed(2));
  const remainingTotal = Number((totalPriceTotal - paymentAmountTotal).toFixed(2));

  function setField(field: keyof typeof form, value: any) {
    setForm((current) => ({ ...current, [field]: value }));
  }

  function canProceedToStep2() {
    return (
      form.customer_name.trim().length > 0 &&
      /^09\d{9}$/.test(form.customer_phone) &&
      form.customer_email.trim().length > 0 &&
      form.event_date >= today() &&
      form.venue_address.trim().length >= 5
    );
  }

  function canProceedToStep3() {
    return Boolean(selectedPackage) && form.station_types.length > 0;
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setNotice("");
    setPaymentNotice("");
    setIsProcessingPayment(true);

    if (!/^09\d{9}$/.test(form.customer_phone)) {
      setNotice("Enter a valid Philippine mobile number starting with 09.");
      setIsProcessingPayment(false);
      return;
    }

    if (!form.acknowledged) {
      setNotice("Please acknowledge that payment is required to confirm this reservation.");
      setIsProcessingPayment(false);
      return;
    }

    if (!selectedPackage) {
      setNotice("Please select a catering package.");
      setIsProcessingPayment(false);
      return;
    }

    try {
      const reservationReference = buildReservationReference("CAT");
      const paymentIntent = await createPaymentIntent({
        amount: paymentAmountTotal,
        paymentMethod: form.payment_method,
        bookingId: reservationReference,
        reservationType: "catering",
        description: `Catering reservation deposit for ${selectedPackage?.name ?? "selected package"}`
      });

      if (!paymentIntent.success) {
        throw new Error(paymentIntent.message || "Unable to start payment.");
      }

      const verification = await verifyPayment({
        referenceId: paymentIntent.referenceId,
        bookingId: reservationReference,
        gatewayData: {
          amount: paymentAmountTotal,
          paymentMethod: form.payment_method,
          paymentPlan: form.payment_plan,
          reservationType: "catering"
        }
      });

      if (!verification.success || verification.status !== "paid") {
        throw new Error(verification.message || "Payment verification failed.");
      }

      const response = await api.post<{ reservation_id: string; downpayment_amount: number; remaining_balance: number; payment_method: string }>(
        "/api/catering/reservations",
        {
          customer_name: form.customer_name,
          customer_phone: form.customer_phone,
          customer_email: form.customer_email,
          event_date: form.event_date,
          headcount: headcountNumber,
          venue_address: form.venue_address,
          package_id: selectedPackage.id,
          payment_method: form.payment_method,
          payment_plan: form.payment_plan,
          payment_transaction_id: verification.transactionId,
          reservation_id: reservationReference,
          special_requests: form.special_requests || undefined
        }
      );

      setSuccess({
        reservationId: response.data.reservation_id,
        downpaymentAmount: response.data.downpayment_amount,
        remainingBalance: response.data.remaining_balance,
        paymentMethod: response.data.payment_method
      });
      setPaymentNotice(paymentIntent.instructions ?? "Payment completed with fake gateway.");
    } catch (error) {
      setNotice(getApiErrorMessage(error, "Unable to create catering reservation. Please verify your details and try again."));
    } finally {
      setIsProcessingPayment(false);
    }
  }

  if (success) {
    return (
      <main className="px-4 py-8 md:py-10">
        <section className="customer-shell max-w-lg">
          <div className="customer-card overflow-hidden">
            <div className="border-b border-katana-border px-6 py-5">
              <h1 className="flex items-center gap-2 font-display text-2xl font-bold text-white">
                <ShieldCheck className="h-5 w-5 text-emerald-400" /> Catering Reservation Sent
              </h1>
            </div>
            <div className="space-y-5 p-6 text-sm text-neutral-300">
              <p className="rounded-xl border border-emerald-500/20 bg-emerald-500/10 px-4 py-3 font-semibold text-emerald-300">Reservation ID: {success.reservationId}</p>
              <p>Downpayment paid: <span className="font-semibold text-emerald-300">{money(success.downpaymentAmount)}</span></p>
              <p>Remaining balance: <span className="font-semibold text-white">{money(success.remainingBalance)}</span></p>
              <p>Payment method: <span className="font-semibold text-white">{success.paymentMethod.toUpperCase()}</span></p>
              <p>Your reservation is now pending staff approval. You can check the status using the reservation ID.</p>
              <div className="grid gap-3">
                <Link className="customer-btn-primary text-center" to={`/reservation/status?bookingId=${success.reservationId}`}>
                  View Reservation Status
                </Link>
                <Link className="customer-btn-secondary text-center" to="/">
                  Back to Home
                </Link>
              </div>
            </div>
          </div>
        </section>
      </main>
    );
  }

  return (
    <main className="px-0 py-0 md:px-4 md:py-10">
      <section className="mx-auto flex min-h-[calc(100vh-4rem)] w-full items-start justify-center md:max-w-6xl md:items-center md:px-6">
        <div className="w-full md:max-w-4xl">
          <form onSubmit={handleSubmit} className="overflow-hidden border-0 bg-transparent shadow-none md:rounded-2xl md:border md:border-katana-border md:bg-katana-surface/90 md:shadow-card md:backdrop-blur">
            <div className="border-b border-katana-border px-4 py-5 md:px-6">
              <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
                <div>
                  <p className="customer-kicker">Step {step} of 3</p>
                  <h2 className="mt-2 font-display text-xl font-bold text-white md:text-2xl">
                    {step === 1 ? "Basic Information" : step === 2 ? "Package or Station" : "Payment"}
                  </h2>
                </div>
                <div className="rounded-full border border-katana-border bg-katana-elevated px-4 py-2 text-sm font-semibold text-neutral-300">
                  Catering reservation
                </div>
              </div>
              <div className="mt-6">
                <div className="flex items-center justify-center gap-0 md:gap-4 md:grid md:grid-cols-3">
                  {[
                    { label: "Information", active: step >= 1 },
                    { label: "Package", active: step >= 2 },
                    { label: "Payment", active: step >= 3 }
                  ].map((item, index) => (
                    <div key={item.label} className="flex items-center gap-0 md:gap-3">
                      <div className="flex flex-col items-center">
                        <div className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-full border text-sm font-bold md:h-9 md:w-9 ${item.active ? "border-katana-red bg-katana-red text-white" : "border-katana-border bg-katana-elevated text-neutral-400"}`}>
                          {index + 1}
                        </div>
                      </div>
                      <span className={`hidden text-sm font-semibold md:block ${item.active ? "text-white" : "text-neutral-400"}`}>{item.label}</span>
                      {index < 2 && <span className={`w-8 h-px bg-katana-border md:flex-1 md:block md:w-auto md:h-px`} />}
                    </div>
                  ))}
                </div>
              </div>
            </div>
            <div className="space-y-4 px-3 py-5 md:space-y-5 md:p-6">
            {step === 1 && (
            <div className="grid gap-4 sm:grid-cols-2">
              <label className="block">
                <span className="customer-label">Event Date *</span>
                <input className="customer-input" type="date" min={today()} value={form.event_date} onChange={(event) => setField("event_date", event.target.value)} required />
              </label>
              <label className="block">
                <span className="customer-label">Your Name *</span>
                <input className="customer-input" value={form.customer_name} onChange={(event) => setField("customer_name", event.target.value)} required />
              </label>
              <label className="block">
                <span className="customer-label">Phone *</span>
                <input className="customer-input" inputMode="tel" placeholder="09123456789" value={form.customer_phone} onChange={(event) => setField("customer_phone", event.target.value)} required />
              </label>
              <label className="block">
                <span className="customer-label">Email *</span>
                <input className="customer-input" type="email" value={form.customer_email} onChange={(event) => setField("customer_email", event.target.value)} required />
              </label>
              <label className="block sm:col-span-2">
                <span className="customer-label">Venue Address *</span>
                <textarea className="min-h-24 customer-input" placeholder="Complete event venue address" value={form.venue_address} onChange={(event) => setField("venue_address", event.target.value)} required />
              </label>
              <label className="block sm:col-span-2">
                <span className="customer-label">Special Requests</span>
                <textarea className="min-h-24 customer-input" value={form.special_requests} onChange={(event) => setField("special_requests", event.target.value)} />
              </label>
            </div>
            )}

            {step === 2 && (
            <>
            <div>
              <h3 className="text-xs font-bold uppercase tracking-[0.18em] text-katana-muted">Choose a station</h3>
              <div className="mt-3 grid grid-cols-1 gap-3 md:grid-cols-3 md:gap-2 md:mt-4">
                {stations.map((station) => {
                  const isSelected = form.station_types.includes(station.id);

                  return (
                    <button
                      type="button"
                      key={station.id}
                      onClick={() => {
                        if (isSelected) {
                          setField("station_types", form.station_types.filter((s) => s !== station.id));
                        } else {
                          setField("station_types", [...form.station_types, station.id]);
                        }
                      }}
                      className={`flex items-center gap-3 min-h-20 rounded-2xl border p-3 text-left transition ${isSelected ? "border-katana-red bg-katana-red/10 shadow-sm" : "border-katana-border bg-katana-elevated hover:border-katana-red/40"}`}
                    >
                      {station.image ? (
                        <img src={station.image} alt={station.name} className="h-14 w-14 rounded-lg object-cover" />
                      ) : (
                        <div className="h-14 w-14 rounded-lg bg-katana-elevated" />
                      )}
                      <div>
                        <p className="text-sm font-bold text-white md:text-base">{station.name}</p>
                        <p className="mt-1 text-xs text-neutral-300 md:text-sm">{station.summary}</p>
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>

            <div>
              <h3 className="text-xs font-bold uppercase tracking-[0.18em] text-katana-muted">Choose an option</h3>
              <div className="mt-3 grid gap-2 sm:grid-cols-2 md:mt-4">
                {stationPackages.map((item) => (
                  <button
                    type="button"
                    key={item.id}
                    onClick={() => setField("package_id", item.id)}
                    className={`rounded-2xl border p-3 text-left transition ${selectedPackage?.id === item.id ? "border-katana-red bg-katana-red/10 shadow-sm" : "border-katana-border bg-katana-elevated hover:border-katana-red/40"}`}
                  >
                    <div className="flex items-center justify-between gap-3">
                      <div>
                        <p className="text-sm font-bold text-white md:text-base">{item.description ?? item.name}</p>
                        <p className="mt-1 text-xs uppercase tracking-wide text-katana-muted">{item.minPax}-{item.maxPax} pax</p>
                      </div>
                      <p className="text-right text-sm font-bold text-katana-red">{getPackagePriceLabel(item)}</p>
                    </div>
                  </button>
                ))}
                {stationPackages.length === 0 && (
                  <p className="rounded-2xl border border-katana-border bg-katana-elevated p-4 text-sm text-neutral-300">Loading station options...</p>
                )}
              </div>
            </div>
            {form.station_types.includes("sushi_station") && selectedPackage?.items?.inclusions?.length ? (
              <details className="rounded-xl border border-katana-border bg-katana-elevated text-sm text-neutral-300">
                <summary className="cursor-pointer px-4 py-3 font-bold text-white">Sushi station products</summary>
                <div className="grid gap-2 border-t border-katana-border px-4 py-3 sm:grid-cols-2">
                  {selectedPackage.items.inclusions.map((inclusion) => (
                    <p key={typeof inclusion === "string" ? inclusion : inclusion.name}>
                      {typeof inclusion === "string" ? inclusion : inclusion.name}
                    </p>
                  ))}
                </div>
              </details>
            ) : null}
            </>
            )}

            {step === 3 && (
            <>
            <div className="rounded-xl border border-katana-border bg-katana-elevated p-5">
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-bold uppercase tracking-wide text-white">Booking summary</h3>
                <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-neutral-300">
                  <span className="rounded-full border border-katana-border bg-katana-surface px-3 py-1 text-neutral-200">{isFullPayment ? "Full payment" : "50% initial"}</span>
                </div>
              </div>
              <div className="mt-4 space-y-3 text-sm text-neutral-300">
                <div className="flex items-center justify-between">
                  <span>Station</span>
                  <span className="font-semibold text-white">{form.station_types.map((id) => stations.find((s) => s.id === id)?.name).filter(Boolean).join(", ") || "-"}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span>Option</span>
                  <span className="font-semibold text-white">{selectedPackage?.description ?? selectedPackage?.name ?? "-"}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span>Headcount</span>
                  <span>{headcountNumber} pax</span>
                </div>
                <div className="flex items-center justify-between">
                    <span>Subtotal</span>
                    <span>{money(subtotalTotal)}</span>
                </div>
                  <div className="flex items-center justify-between">
                    <span>Tax (12%)</span>
                    <span>{money(taxTotal)}</span>
                </div>
                  <div className="flex items-center justify-between text-base font-bold text-white">
                    <span>Total</span>
                    <span>{money(totalPriceTotal)}</span>
                </div>
                  <div className="flex items-center justify-between text-sm text-neutral-300">
                    <span>{isFullPayment ? "Amount now" : "Downpayment (50%)"}</span>
                    <span>{money(paymentAmountTotal)}</span>
                </div>
                  <div className="flex items-center justify-between text-sm text-neutral-300">
                    <span>{isFullPayment ? "Remaining balance" : "Remaining balance"}</span>
                    <span>{money(remainingTotal)}</span>
                </div>
              </div>
            </div>

            <div className="rounded-xl border border-katana-border bg-katana-elevated p-5">
              <h3 className="text-sm font-bold uppercase tracking-wide text-white">Payment option</h3>
              <div className="mt-4 grid gap-3 sm:grid-cols-2">
                <button
                  type="button"
                  onClick={() => setField("payment_plan", "initial_only")}
                  className={`rounded-2xl border px-4 py-4 text-left text-sm font-bold ${form.payment_plan === "initial_only" ? "border-katana-red bg-katana-red/15 text-white" : "border-katana-border bg-katana-surface text-neutral-300"}`}
                >
                      <p className="font-semibold">50% initial</p>
                      <p className="mt-2 text-sm text-neutral-300">Pay {money(paymentAmountTotal)} now. Remaining {money(remainingTotal)} due at event.</p>
                </button>
                <button
                  type="button"
                  onClick={() => setField("payment_plan", "full_payment")}
                  className={`rounded-2xl border px-4 py-4 text-left text-sm font-bold ${form.payment_plan === "full_payment" ? "border-katana-red bg-katana-red/15 text-white" : "border-katana-border bg-katana-surface text-neutral-300"}`}
                >
                  <p className="font-semibold">100% full</p>
                  <p className="mt-2 text-sm text-neutral-300">Pay {money(paymentAmountTotal)} now and owe nothing later.</p>
                </button>
              </div>
            </div>

            <div className="rounded-xl border border-katana-border bg-katana-elevated p-5">
              <h3 className="text-sm font-bold uppercase tracking-wide text-white">Payment method</h3>
              <div className="mt-4 grid gap-3 sm:grid-cols-3">
                {([
                  { id: "cash", label: "Cash", icon: <Banknote className="h-4 w-4" />, disabled: false },
                  { id: "gcash", label: "GCash", icon: <Smartphone className="h-4 w-4" />, disabled: true },
                  { id: "bank_transfer", label: "BPI", icon: <Landmark className="h-4 w-4" />, disabled: true }
                ] as const).map((option) => (
                  <button
                    type="button"
                    key={option.id}
                    onClick={() => !option.disabled && setField("payment_method", option.id)}
                    disabled={option.disabled}
                    className={`flex min-h-[74px] flex-col items-center justify-center gap-1 rounded-2xl border px-4 py-3 text-sm font-bold ${
                      form.payment_method === option.id
                        ? "border-katana-red bg-katana-red text-white"
                        : option.disabled
                          ? "cursor-not-allowed border-katana-border bg-katana-surface text-neutral-500 opacity-70"
                          : "border-katana-border bg-katana-elevated text-neutral-300"
                    }`}
                  >
                    <span className="flex items-center gap-2">{option.icon}{option.label}</span>
                    {option.disabled && <span className="text-[11px] font-semibold uppercase tracking-wide text-neutral-500">Coming soon</span>}
                  </button>
                ))}
              </div>
            </div>

            <label className="flex items-start gap-3 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm font-semibold text-amber-900">
              <input
                checked={form.acknowledged}
                className="mt-1 h-4 w-4 accent-red-700"
                type="checkbox"
                onChange={(event) => setField("acknowledged", event.target.checked)}
              />
              I agree that payment is required to confirm this catering reservation.
            </label>

            <button
              className="customer-btn-primary flex w-full gap-2 disabled:cursor-not-allowed disabled:opacity-70"
              disabled={isProcessingPayment}
            >
              <Send className="h-4 w-4" /> {isProcessingPayment ? "Processing payment..." : `Pay ${money(paymentAmountTotal)}`}
            </button>
            {paymentNotice && <p className="rounded-md bg-emerald-50 px-3 py-2 text-sm font-medium text-emerald-700">{paymentNotice}</p>}
            </>
            )}

            <div className="flex flex-col gap-3 sm:flex-row sm:justify-between">
              <button
                type="button"
                onClick={() => setStep((current) => Math.max(1, current - 1))}
                className="customer-btn-secondary"
                disabled={step === 1}
              >
                Back
              </button>
              {step < 3 ? (
                <button
                  type="button"
                  onClick={() => {
                    if (step === 1 && !canProceedToStep2()) {
                      setNotice("Please complete your basic information and venue address before continuing.");
                      return;
                    }

                    if (step === 2 && !canProceedToStep3()) {
                      setNotice("Please select a catering package.");
                      return;
                    }

                    setNotice("");
                    setStep((current) => current + 1);
                  }}
                  className="customer-btn-primary"
                >
                  Next
                </button>
              ) : null}
            </div>
            {notice && <p className="rounded-md bg-red-50 px-3 py-2 text-sm font-medium text-katana-red">{notice}</p>}
          </div>
        </form>
      </div>

        {/* Floating collapsible summary card */}
        <div className="fixed bottom-4 left-4 right-4 z-40 md:right-6 md:left-auto md:w-96 md:bottom-6">
          <div className="mx-auto md:ml-auto">
            <div className={`rounded-xl border border-katana-border bg-katana-elevated shadow-lg transition-all ${summaryOpen ? "max-h-[36rem]" : "max-h-14 overflow-hidden"}`}>
              <div className="flex items-center justify-between px-4 py-3">
                <div>
                  <p className="text-sm font-semibold text-white">Your package summary</p>
                  <p className="text-xs text-neutral-300">{stationCount} station{stationCount > 1 ? "s" : ""} selected • {selectedPackage?.description ?? selectedPackage?.name ?? "No option"}</p>
                </div>
                <div className="flex items-center gap-3">
                  <div className="text-right">
                    <div className="text-sm font-bold text-white">{money(paymentAmountTotal)}</div>
                    <div className="text-xs text-neutral-300">{isFullPayment ? "Pay now" : "Downpayment"}</div>
                  </div>
                  <button type="button" onClick={() => setSummaryOpen((s) => !s)} className="rounded-full border border-katana-border bg-katana-surface px-3 py-2 text-sm font-semibold">
                    {summaryOpen ? "Close" : "View"}
                  </button>
                </div>
              </div>
              {summaryOpen ? (
                <div className="border-t border-katana-border px-4 py-4">
                  <div className="space-y-3 text-sm text-neutral-300">
                    <div className="flex items-center justify-between">
                      <span>Stations</span>
                      <span className="font-semibold text-white">{form.station_types.map((id) => stations.find((s) => s.id === id)?.name).filter(Boolean).join(", ") || "-"}</span>
                    </div>
                    <div className="flex items-center justify-between">
                      <span>Option</span>
                      <span className="font-semibold text-white">{selectedPackage?.description ?? selectedPackage?.name ?? "-"}</span>
                    </div>
                    <div className="flex items-center justify-between">
                      <span>Subtotal</span>
                      <span>{money(subtotalTotal)}</span>
                    </div>
                    <div className="flex items-center justify-between">
                      <span>Tax (12%)</span>
                      <span>{money(taxTotal)}</span>
                    </div>
                    <div className="flex items-center justify-between text-base font-bold text-white">
                      <span>Total</span>
                      <span>{money(totalPriceTotal)}</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <button type="button" onClick={() => { setStep(3); setSummaryOpen(false); }} className="customer-btn-primary w-full">Proceed to payment</button>
                    </div>
                  </div>
                </div>
              ) : null}
            </div>
          </div>
        </div>
      </section>
    </main>
  );
}

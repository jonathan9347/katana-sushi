import { FormEvent, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { Banknote, CheckCircle2, Landmark, Send, ShieldCheck, Smartphone } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { Dialog } from "../../components/ui/dialog";
import BackToHome from "../../components/layout/BackToHome";
import { api, resolveImageUrl } from "../../lib/api";
import { getApiErrorMessage } from "../../lib/errors";
import {
  clearCustomerPaymentAttempt,
  getOrCreateCustomerPaymentAttempt,
  type PaymentMethod
} from "../../lib/payment";
import { isFutureManilaReservationTime, todayManilaDateKey } from "../../lib/dateTime";
import { defaultSystemSettings, fetchSystemSettings } from "../../lib/systemSettings";

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
    pricingModel?: "tier" | "per_unit" | "fixed" | "quote";
    flatPrice?: number;
    fixedPrice?: number;
    minPrice?: number;
    maxPrice?: number;
    pricePerUnit?: number;
    pricePerKg?: number;
    unit?: string;
    minimum?: number;
    step?: number;
    maximum?: number;
    minKg?: number;
    stepKg?: number;
    maxKg?: number;
    fixedPax?: number;
    inclusions?: Array<string | { name: string; description?: string }>;
    galleryImages?: string[];
  } | null;
  imageUrl: string | null;
};

type SuccessState = {
  reservationId: string;
  packageTotal: number;
  initialPaymentDue: number;
  paymentPlan: "downpayment" | "full_payment";
};

function money(value: number) {
  return new Intl.NumberFormat("en-PH", { style: "currency", currency: "PHP", minimumFractionDigits: 2 }).format(value);
}

function today() {
  return todayManilaDateKey();
}

function earliestEventDate() {
  const minimum = new Date(`${today()}T00:00:00.000Z`);
  minimum.setUTCDate(minimum.getUTCDate() + 1);
  return minimum.toISOString().slice(0, 10);
}

function getStationType(item: CateringPackage) {
  const stationType = item.stationType?.trim().toLowerCase();
  const packageIdentity = `${item.id} ${item.name}`.toLowerCase();

  if (stationType && stationType !== "sashimi_bar" && stationType !== "sashimi") {
    return stationType;
  }

  if (
    packageIdentity.includes("whole_tuna") ||
    packageIdentity.includes("whole tuna") ||
    item.id.includes("sashimi_20") ||
    item.id.includes("sashimi_30")
  ) {
    return "whole_tuna";
  }

  if (
    (stationType === "sashimi_bar" || stationType === "sashimi" || item.id.includes("sashimi")) &&
    isPerUnitPackage(item)
  ) {
    const hasTuna = /\btuna\b/.test(packageIdentity);
    const hasSalmon = /\bsalmon\b/.test(packageIdentity);
    if (hasTuna !== hasSalmon) {
      return hasTuna ? "tuna_add_on" : "salmon_add_on";
    }
  }

  const packageDetails = `${packageIdentity} ${item.description ?? ""}`.toLowerCase();
  if (packageDetails.includes("tempura")) {
    return "tempura_live";
  }

  return stationType ?? "sushi_station";
}

function isPerUnitPackage(item?: CateringPackage) {
  return Boolean(
    item?.items?.pricingModel === "per_unit" ||
    item?.items?.pricingType === "range" ||
    item?.items?.pricePerUnit !== undefined ||
    item?.items?.pricePerKg !== undefined
  );
}

function getStationName(id: string) {
  const names: Record<string, string> = {
    sushi_station: "Sushi Station",
    whole_tuna: "Whole Tuna (standalone)",
    tuna_add_on: "Tuna Add-on",
    salmon_add_on: "Salmon Add-on",
    tempura_live: "Tempura (50 pax)"
  };
  return names[id] ?? id.split(/[_\s-]+/).map((part) => `${part.charAt(0).toUpperCase()}${part.slice(1)}`).join(" ");
}

function getPackagePrice(item?: CateringPackage, quantity?: number) {
  if (!item?.items) {
    return 0;
  }

  if (item.items.pricingModel === "per_unit" || item.items.pricingType === "range") {
    const rate = item.items.pricePerUnit ?? item.items.pricePerKg ?? 0;
    return rate * (quantity ?? 0);
  }

  if (item.items.pricingModel === "fixed" || item.items.pricingType === "flat") {
    return item.items.fixedPrice ?? item.items.flatPrice ?? 0;
  }

  return item.items.flatPrice ?? item.items.minPrice ?? 0;
}

function getPackagePriceLabel(item: CateringPackage) {
  if (item.items?.pricingModel === "per_unit" || item.items?.pricingType === "range") {
    return `${money(item.items.pricePerUnit ?? item.items.pricePerKg ?? 0)}/${item.items.unit ?? "kg"}`;
  }

  if (item.items?.pricingModel === "fixed") {
    const pax = item.items.fixedPax;
    return `Fixed package${pax ? ` - ${pax} pax` : ""} - ${money(item.items.fixedPrice ?? item.items.flatPrice ?? 0)}`;
  }

  if (item.items?.pricingType === "flat" || item.items?.pricingModel === "tier") {
    return money(item.items.flatPrice ?? item.items.fixedPrice ?? item.items.minPrice ?? 0);
  }

  return "Custom quote";
}

function getStationPriceLabel(options: CateringPackage[], selectedPackage?: CateringPackage) {
  const perUnitOptions = options.filter((item) =>
    item.items?.pricingModel === "per_unit" || item.items?.pricingType === "range"
  );
  if (perUnitOptions.length > 0) {
    const startingPrices = perUnitOptions.map((item) => {
      const rate = item.items?.pricePerUnit ?? item.items?.pricePerKg ?? 0;
      const minimum = item.items?.minimum ?? item.items?.minKg ?? 0;
      return rate * minimum;
    });
    return `From ${money(Math.min(...startingPrices))}`;
  }

  if (selectedPackage) {
    return getPackagePriceLabel(selectedPackage);
  }

  const prices = options.flatMap((item) => {
    if (item.items?.pricingModel === "fixed" && item.items.fixedPrice !== undefined) {
      return [item.items.fixedPrice];
    }
    if ((item.items?.pricingType === "flat" || item.items?.pricingModel === "tier") && item.items.flatPrice !== undefined) {
      return [item.items.flatPrice];
    }
    if (item.items?.pricingType === "range" && item.items.minPrice !== undefined) {
      return [item.items.minPrice];
    }
    return [];
  });
  const hasQuoteOption = options.some((item) => item.items?.pricingType === "quote");

  if (prices.length > 0) {
    const label = `From ${money(Math.min(...prices))}`;
    return hasQuoteOption ? `${label} · custom quote available` : label;
  }

  return "Custom quote";
}

function getPackageImages(item: CateringPackage) {
  const galleryImages = (item.items?.galleryImages ?? [])
    .map((image) => resolveImageUrl(image))
    .filter((image): image is string => Boolean(image))
    .slice(0, 3);

  if (galleryImages.length > 0) {
    return galleryImages;
  }

  const fallbackImage = resolveImageUrl(item.imageUrl);
  return fallbackImage ? [fallbackImage] : [];
}

export default function CateringReservation() {
  const [form, setForm] = useState<{
    event_date: string;
    event_time: string;
    venue_address: string;
    station_types: string[];
    package_by_station: { [stationId: string]: string };
    package_quantities: Record<string, string>;
    customer_name: string;
    customer_phone: string;
    customer_email: string;
    event_type: string;
    event_type_other: string;
    payment_method: PaymentMethod;
    payment_plan: "" | "downpayment" | "full_payment";
    acknowledged: boolean;
  }>({
    event_date: earliestEventDate(),
    event_time: "",
    venue_address: "",
    station_types: [],
    package_by_station: {},
    package_quantities: {},
    customer_name: "",
    customer_phone: "",
    customer_email: "",
    event_type: "",
    event_type_other: "",
    payment_method: "cash",
    payment_plan: "",
    acknowledged: false
  });
  const [notice, setNotice] = useState("");
  const [isProcessingPayment, setIsProcessingPayment] = useState(false);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [mobileSummaryOpen, setMobileSummaryOpen] = useState(false);
  const [success, setSuccess] = useState<SuccessState | null>(null);
  const paymentInFlightRef = useRef(false);

  const packagesQuery = useQuery({
    queryKey: ["catering-packages"],
    queryFn: async () => (await api.get<{ packages: CateringPackage[] }>("/api/catering/packages")).data.packages,
    retry: 1
  });

  const { data: systemSettingsData } = useQuery({
    queryKey: ["system-settings"],
    queryFn: fetchSystemSettings,
    retry: 1
  });

  const systemSettings = systemSettingsData ?? defaultSystemSettings;
  const packages = packagesQuery.data ?? [];
  const stations = useMemo(() => {
    const stationTypes = Array.from(new Set(packages.map(getStationType)));
    return stationTypes.map((id) => ({
      id,
      name: getStationName(id)
    }));
  }, [packages]);
  const packagesByStation = useMemo(() => {
    const map: { [k: string]: CateringPackage[] } = {};
    stations.forEach((s) => {
      map[s.id] = packages.filter((item) => getStationType(item) === s.id);
    });
    return map;
  }, [packages, stations]);

  const selectedPackageByStation: { [k: string]: CateringPackage | undefined } = {};
  stations.forEach((s) => {
    const pkgId = form.package_by_station[s.id];
    selectedPackageByStation[s.id] = (packagesByStation[s.id] ?? []).find((p) => p.id === pkgId);
  });

  const selectedPackages = form.station_types
    .map((stationId) => selectedPackageByStation[stationId])
    .filter((item): item is CateringPackage => Boolean(item));
  const selectedBasePackages = selectedPackages.filter((item) =>
    ["sushi_station", "tempura_live"].includes(getStationType(item))
  );
  const headcountNumber = selectedBasePackages.length > 0
    ? Math.max(
      systemSettings.minimum_catering_pax,
      ...form.station_types.map((stationId) => {
        const selectedPackage = selectedPackageByStation[stationId];
        return selectedPackage && ["sushi_station", "tempura_live"].includes(getStationType(selectedPackage))
          ? getStationType(selectedPackage) === "tempura_live"
            ? selectedPackage.items?.fixedPax ?? selectedPackage.minPax
            : selectedPackage.minPax
          : 0;
      })
    )
    : null;
  const subtotal = useMemo(() => {
    return stations.reduce((sum, s) => {
      if (!form.station_types.includes(s.id)) return sum;
      const pkg = selectedPackageByStation[s.id];
      const quantity = pkg && isPerUnitPackage(pkg)
        ? Number(form.package_quantities[pkg.id]) || undefined
        : undefined;
      return sum + getPackagePrice(pkg, quantity);
    }, 0);
  }, [form.station_types, packagesByStation, form.package_by_station, form.package_quantities]);
  const hasQuoteOnlyOptions = selectedPackages.some((item) => item?.items?.pricingType === "quote");
  const hasPricedOptions = selectedPackages.some((item) => item?.items?.pricingType !== "quote");
  const isZeroQuoteOnlyReservation = hasQuoteOnlyOptions;
  const isFullPayment = form.payment_plan === "full_payment";
  const isDownpayment = form.payment_plan === "downpayment";
  const subtotalTotal = Number(subtotal.toFixed(2));
  const totalPriceTotal = subtotalTotal;
  const paymentAmountTotal = isZeroQuoteOnlyReservation
    ? 0
    : isFullPayment
      ? totalPriceTotal
      : isDownpayment
        ? Number((totalPriceTotal * 0.5).toFixed(2))
        : 0;
  const remainingTotal = Number((totalPriceTotal - paymentAmountTotal).toFixed(2));

  function setField(field: keyof typeof form, value: any) {
    setForm((current) => ({ ...current, [field]: value }));
  }

  function getBookingDetailsError() {
    if (form.event_date < earliestEventDate()) {
      return "Catering events must be booked at least one day in advance.";
    }
    if (!isFutureManilaReservationTime(form.event_date, form.event_time)) {
      return "Choose a future event date and time.";
    }

    if (!form.event_type) {
      return "Choose an event type.";
    }

    if (form.event_type === "Others" && !form.event_type_other.trim()) {
      return "Please specify the event type.";
    }

    if (form.event_type === "Others" && /[<>]/.test(form.event_type_other)) {
      return "Event type must be plain text.";
    }

    if (form.station_types.length === 0) {
      return "Choose at least one catering station.";
    }

    if (form.station_types.some((stationId) => !selectedPackageByStation[stationId])) {
      return "Choose an option for each selected station.";
    }

    const selectedStationTypes = selectedPackages.map((item) => item ? getStationType(item) : "");
    if (selectedStationTypes.includes("whole_tuna") && selectedStationTypes.length !== 1) {
      return "Whole Tuna can only be booked by itself.";
    }
    const hasBasePackage = selectedStationTypes.some((id) => id === "sushi_station" || id === "tempura_live");
    if (
      selectedStationTypes.some((id) => id === "tuna_add_on" || id === "salmon_add_on") &&
      !hasBasePackage
    ) {
      return "Tuna and Salmon add-ons must be added to a station package.";
    }
    for (const item of selectedPackages) {
      if (!item || !isPerUnitPackage(item)) continue;
      const quantity = Number(form.package_quantities[item.id]);
      const minimum = item.items?.minimum ?? item.items?.minKg;
      const maximum = item.items?.maximum ?? item.items?.maxKg;
      const step = item.items?.step ?? item.items?.stepKg ?? 1;
      if (
        !Number.isInteger(quantity) ||
        typeof minimum !== "number" ||
        !Number.isFinite(step) ||
        step <= 0 ||
        quantity < minimum ||
        (typeof maximum === "number" && quantity > maximum) ||
        Math.abs((quantity - minimum) / step - Math.round((quantity - minimum) / step)) > 1e-9
      ) {
        return `Enter a valid ${item.items?.unit ?? "kg"} quantity for ${item.name}.`;
      }
    }

    if (hasQuoteOnlyOptions || !hasPricedOptions || totalPriceTotal <= 0) {
      return "Choose priced catering options to submit a reservation. Custom quotes are handled through catering inquiries.";
    }

    if (!form.payment_plan) {
      return "Choose a payment option.";
    }

    if (!form.acknowledged) {
      return "Please confirm that you understand staff approval is required.";
    }

    return null;
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (paymentInFlightRef.current) {
      return;
    }

    paymentInFlightRef.current = true;
    setNotice("");
    setIsProcessingPayment(true);

    if (!/^09\d{9}$/.test(form.customer_phone)) {
      setNotice("Enter a valid Philippine mobile number starting with 09.");
      setIsProcessingPayment(false);
      paymentInFlightRef.current = false;
      return;
    }

    const bookingDetailsError = getBookingDetailsError();
    if (bookingDetailsError) {
      setNotice(bookingDetailsError);
      setIsProcessingPayment(false);
      paymentInFlightRef.current = false;
      return;
    }

    try {
      const bookingPayload = {
        customer_name: form.customer_name,
        customer_phone: form.customer_phone,
        customer_email: form.customer_email,
        event_date: form.event_date,
        event_time: form.event_time,
        event_type_other: form.event_type === "Others" ? form.event_type_other.trim() : null,
        package_quantities: Object.fromEntries(
          selectedPackages
            .filter((item): item is CateringPackage => Boolean(item) && isPerUnitPackage(item))
            .map((item) => [item.id, Number(form.package_quantities[item.id])])
        ),
        headcount: headcountNumber,
        venue_address: form.venue_address,
        package_id: form.package_by_station[form.station_types[0]] ?? "",
        package_ids: form.station_types.map((stationId) => form.package_by_station[stationId]).filter(Boolean),
        payment_method: form.payment_method,
        payment_plan: form.payment_plan,
        event_type: form.event_type
      };
      const attempt = await getOrCreateCustomerPaymentAttempt(
        "catering",
        bookingPayload,
        undefined,
        form.payment_plan
      );

      const response = await api.post<{
        reservation_id: string;
        paid_amount: number;
        remaining_balance: number;
        package_total: number;
        initial_payment_due: number;
        payment_plan: "downpayment" | "full_payment";
      }>(
        "/api/catering/reservations",
        {
          ...bookingPayload,
          reservation_id: attempt.bookingId
        }
      );

      clearCustomerPaymentAttempt("catering", attempt.bookingId);
      setSuccess({
        reservationId: response.data.reservation_id,
        packageTotal: response.data.package_total,
        initialPaymentDue: response.data.initial_payment_due,
        paymentPlan: response.data.payment_plan
      });
      setDetailsOpen(false);
    } catch (error) {
      setNotice(getApiErrorMessage(error, "Unable to create catering reservation. Please verify your details and try again."));
    } finally {
      paymentInFlightRef.current = false;
      setIsProcessingPayment(false);
    }
  }

  if (success) {
    return (
      <main className="px-4 pt-3 pb-8 md:pb-10">
        <div className="customer-shell mb-4">
          <BackToHome />
        </div>
        <section className="customer-shell max-w-lg">
          <div className="customer-card overflow-hidden">
            <div className="border-b border-katana-border px-6 py-5">
              <h1 className="flex items-center gap-2 font-display text-2xl font-bold text-white">
                <ShieldCheck className="h-5 w-5 text-emerald-400" /> Catering Reservation Sent
              </h1>
            </div>
            <div className="space-y-5 p-6 text-sm text-katana-muted">
              <p className="rounded-xl border border-emerald-500/20 bg-emerald-500/10 px-4 py-3 font-semibold text-emerald-600 dark:text-emerald-300">Reservation ID: {success.reservationId}</p>
              <p>Package total: <span className="font-semibold text-white">{money(success.packageTotal)}</span></p>
              <p>Initial payment due ({success.paymentPlan === "full_payment" ? "full package total" : "50% of package total"}): <span className="font-semibold text-white">{money(success.initialPaymentDue)}</span></p>
              <p>Pay the selected package amount before staff approval. Staff may add a mobilization fee after reviewing the request; any remaining package balance and added fee must be paid before the event.</p>
              <div className="grid gap-3">
                <Link className="customer-btn-primary text-center" to={`/reservation/status?bookingId=${success.reservationId}`}>
                  Continue to Payment
                </Link>
              </div>
            </div>
          </div>
        </section>
      </main>
    );
  }

  return (
    <main className="w-full px-4 pt-3 pb-24 md:px-6 md:pb-4 lg:px-3 lg:pb-3">
      <section className="w-full">
        <div className="w-full">
          <form className="w-full">
            <div className="grid w-full items-start gap-6 lg:grid-cols-[minmax(0,1fr)_400px] lg:gap-3">
            <div>
            <BackToHome className="mb-3" />
            <div className="space-y-6">
            <p className="text-sm text-neutral-300">Choose one or more stations. One option per station.</p>

            <section className="space-y-3">
              <h3 className="text-xs font-bold uppercase tracking-[0.18em] text-katana-muted">Choose your stations</h3>
              <div className="mt-3 grid grid-cols-1 gap-3 md:grid-cols-1 md:gap-4 md:mt-4">
                {packagesQuery.isPending && <p className="text-sm text-neutral-300" role="status">Loading catering stations...</p>}
                {packagesQuery.isError && (
                  <div className="text-sm text-katana-red" role="alert">
                    <p>Catering stations could not be loaded.</p>
                    <button type="button" className="mt-1 underline" onClick={() => void packagesQuery.refetch()}>Retry</button>
                  </div>
                )}
                {packagesQuery.isSuccess && stations.length === 0 && (
                  <p className="text-sm text-neutral-300" role="status">No catering stations are currently available.</p>
                )}
                {packagesQuery.isSuccess && stations.map((station) => {
                  const isSelected = form.station_types.includes(station.id);
                  const selectedPkg = selectedPackageByStation[station.id];
                  const options = packagesByStation[station.id] ?? [];
                  const optionCards = options.map((item) => {
                    const images = getPackageImages(item);
                    const optionSelected = selectedPkg?.id === item.id;
                    const isQuantityPackage = isPerUnitPackage(item);
                    const quantityValue = form.package_quantities[item.id] ?? "";
                    const quantity = Number(quantityValue);
                    const hasQuantity = quantityValue !== "" && Number.isFinite(quantity);
                    const minQuantity = item.items?.minimum ?? item.items?.minKg ?? 1;
                    const quantityStep = item.items?.step ?? item.items?.stepKg ?? 1;
                    const maxQuantity = item.items?.maximum ?? item.items?.maxKg;

                    return (
                      <div
                        key={item.id}
                        className={`group overflow-hidden rounded-2xl border text-left transition ${
                          optionSelected ? "border-katana-red bg-katana-red/10 shadow-sm" : "border-katana-border bg-katana-surface hover:border-katana-red/50"
                        }`}
                      >
                        <button
                          type="button"
                          aria-pressed={optionSelected}
                          onClick={() => {
                            setForm((current) => ({
                              ...current,
                              package_by_station: { ...current.package_by_station, [station.id]: item.id },
                              package_quantities: isQuantityPackage
                                ? {
                                  ...current.package_quantities,
                                  [item.id]: current.package_by_station[station.id] !== item.id || !current.package_quantities[item.id]
                                    ? String(minQuantity)
                                    : current.package_quantities[item.id]
                                }
                                : current.package_quantities
                            }));
                          }}
                          className="block w-full text-left"
                        >
                          <div className="grid grid-cols-3 gap-1">
                            {[0, 1, 2].map((index) => {
                              const imageSrc = images[index];
                              return (
                                <div key={index} className="relative aspect-[4/3] overflow-hidden bg-katana-elevated">
                                  {imageSrc ? (
                                    <img
                                      src={imageSrc}
                                      alt={`${item.description ?? item.name} photo ${index + 1}`}
                                      className="h-full w-full object-cover transition duration-300 group-hover:scale-105"
                                      loading="lazy"
                                      decoding="async"
                                    />
                                  ) : (
                                    <div className="flex h-full w-full items-center justify-center text-[9px] font-bold uppercase tracking-wide text-katana-muted">
                                      Photo {index + 1}
                                    </div>
                                  )}
                                  {optionSelected && index === 2 && (
                                    <span className="absolute right-2 top-2 inline-flex h-7 w-7 items-center justify-center rounded-full bg-katana-red text-white shadow-lg">
                                      <CheckCircle2 className="h-4 w-4" />
                                    </span>
                                  )}
                                </div>
                              );
                            })}
                          </div>
                          <div className="grid min-h-[116px] gap-3 p-4">
                            <div className="min-w-0">
                              <p className="break-words text-sm font-bold text-white md:text-base">{item.description ?? item.name}</p>
                              <p className="mt-1 text-xs uppercase tracking-wide text-katana-muted">
                                {isQuantityPackage
                                  ? `${minQuantity}-${maxQuantity ?? "∞"} ${item.items?.unit ?? "kg"}`
                                  : item.items?.pricingModel === "fixed"
                                    ? `${item.items.fixedPax ?? item.minPax} pax`
                                    : `${item.minPax}-${item.maxPax} pax`}
                              </p>
                            </div>
                            <p className="self-end text-sm font-bold text-katana-red">
                              {getPackagePriceLabel(item)}
                            </p>
                          </div>
                        </button>
                        {optionSelected && isQuantityPackage && (
                          <label className="grid gap-2 border-t border-katana-border p-4">
                            <span className="customer-label">Exact {item.name} quantity ({item.items?.unit ?? "kg"}) *</span>
                            <div className="flex items-center gap-2">
                              <button
                                type="button"
                                aria-label={`Decrease ${item.name} quantity`}
                                disabled={!hasQuantity || quantity <= minQuantity}
                                className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-katana-border bg-katana-surface text-lg font-bold text-white transition hover:border-katana-red disabled:cursor-not-allowed disabled:opacity-40"
                                onClick={() => setForm((current) => ({
                                  ...current,
                                  package_quantities: {
                                    ...current.package_quantities,
                                    [item.id]: String(Math.max(minQuantity, quantity - quantityStep))
                                  }
                                }))}
                              >
                                -
                              </button>
                              <input
                                className="customer-input text-center"
                                type="number"
                                min={minQuantity}
                                max={maxQuantity}
                                step={quantityStep}
                                inputMode="numeric"
                                value={quantityValue}
                                onChange={(event) => {
                                  const value = event.target.value;
                                  const parsedQuantity = Number(value);
                                  setForm((current) => ({
                                    ...current,
                                    package_quantities: {
                                      ...current.package_quantities,
                                      [item.id]: value && maxQuantity !== undefined && Number.isFinite(parsedQuantity)
                                        ? String(Math.min(parsedQuantity, maxQuantity))
                                        : value
                                    }
                                  }));
                                }}
                                required
                              />
                              <button
                                type="button"
                                aria-label={`Increase ${item.name} quantity`}
                                disabled={hasQuantity && maxQuantity !== undefined && quantity >= maxQuantity}
                                className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-katana-border bg-katana-surface text-lg font-bold text-white transition hover:border-katana-red disabled:cursor-not-allowed disabled:opacity-40"
                                onClick={() => {
                                  const currentQuantity = hasQuantity ? quantity : minQuantity - quantityStep;
                                  setForm((current) => ({
                                    ...current,
                                    package_quantities: {
                                      ...current.package_quantities,
                                      [item.id]: String(Math.min(maxQuantity ?? Number.POSITIVE_INFINITY, currentQuantity + quantityStep))
                                    }
                                  }));
                                }}
                              >
                                +
                              </button>
                            </div>
                            <span className="text-xs text-katana-muted">
                              {money(item.items?.pricePerUnit ?? item.items?.pricePerKg ?? 0)} per {item.items?.unit ?? "kg"}
                            </span>
                          </label>
                        )}
                      </div>
                    );
                  });

                  return (
                    <div
                      key={station.id}
                      className={`rounded-xl border p-4 transition-colors ${
                        isSelected ? "border-katana-red bg-katana-red/10 shadow-sm" : "border-katana-border bg-katana-elevated hover:border-katana-red/40"
                      }`}
                    >
                      <label className="flex cursor-pointer items-start gap-3">
                        <input
                          type="checkbox"
                          checked={isSelected}
                          className="mt-1 h-5 w-5 shrink-0 accent-katana-red"
                          onChange={() => {
                            setForm((current) => {
                              const nextSelectedStations = isSelected
                                ? current.station_types.filter((selectedStation) => selectedStation !== station.id)
                                : [...current.station_types, station.id];
                              const nextPackages = { ...current.package_by_station };
                              if (!isSelected && options.length === 1) {
                                nextPackages[station.id] = options[0].id;
                              }
                              const nextQuantities = { ...current.package_quantities };
                              if (
                                !isSelected &&
                                options.length === 1 &&
                                isPerUnitPackage(options[0]) &&
                                !nextQuantities[options[0].id]
                              ) {
                                nextQuantities[options[0].id] = String(
                                  options[0].items?.minimum ?? options[0].items?.minKg ?? 1
                                );
                              }
                              return {
                                ...current,
                                station_types: nextSelectedStations,
                                package_by_station: nextPackages,
                                package_quantities: nextQuantities
                              };
                            });
                          }}
                        />
                        <div className="min-w-0 flex-1">
                          <div className="flex flex-wrap items-start justify-between gap-3">
                            <div className="min-w-0">
                              <p className="text-sm font-bold text-white md:text-base">{station.name}</p>
                              <p className="mt-1 text-xs text-neutral-300 md:text-sm">
                                {options.length} {options.length === 1 ? "package option" : "package options"} available
                              </p>
                            </div>
                            <div className="shrink-0 text-left sm:text-right">
                              <p className="text-sm font-semibold text-katana-red">{getStationPriceLabel(options, selectedPkg)}</p>
                            </div>
                          </div>
                        </div>
                      </label>
                      {isSelected && options.length === 1 && <div className="mt-3 grid grid-cols-1 gap-3">{optionCards}</div>}
                      {isSelected && options.length > 1 && (
                        <details className="mt-3 w-full rounded-lg" open>
                          <summary className="cursor-pointer text-sm font-semibold text-white">Choose an option</summary>
                          <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">{optionCards}</div>
                        </details>
                      )}
                      {isSelected && options.length === 0 && (
                        <p className="mt-3 rounded-2xl border border-katana-border bg-katana-elevated p-4 text-sm text-neutral-300">No options are available for this station.</p>
                      )}

                          {isSelected && station.id === "sushi_station" && selectedPkg?.items?.inclusions?.length ? (
                            <details className="mt-3 rounded-xl border border-katana-border bg-katana-elevated text-sm text-neutral-300">
                              <summary className="cursor-pointer px-4 py-3 font-bold text-white">Sushi station products</summary>
                              <div className="grid gap-2 border-t border-katana-border px-4 py-3 sm:grid-cols-2">
                                {selectedPkg.items.inclusions.map((inclusion) => (
                                  <p key={typeof inclusion === "string" ? inclusion : inclusion.name}>
                                    {typeof inclusion === "string" ? inclusion : inclusion.name}
                                  </p>
                                ))}
                              </div>
                            </details>
                          ) : null}
                        </div>
                  );
                })}
              </div>
            </section>
            </div>
            </div>
            {mobileSummaryOpen && (
              <button
                type="button"
                aria-label="Close catering details"
                className="fixed inset-0 z-40 bg-black/55 lg:hidden"
                onClick={() => setMobileSummaryOpen(false)}
              />
            )}
            <aside
              id="catering-mobile-details"
              className={`${mobileSummaryOpen
                ? "fixed inset-x-0 bottom-0 z-50 flex max-h-[85dvh] flex-col overflow-y-auto overscroll-contain rounded-t-2xl border border-katana-border bg-[var(--customer-surface)] p-4 pb-[max(1rem,env(safe-area-inset-bottom))] shadow-2xl"
                : "hidden"} catering-booking-panel space-y-3 lg:space-y-0 lg:gap-3 lg:sticky lg:top-3 lg:h-[calc(100dvh-1.5rem)] lg:max-h-[calc(100dvh-1.5rem)] lg:overflow-hidden lg:overscroll-contain lg:rounded-none lg:border-0 lg:bg-transparent lg:p-0 lg:shadow-none lg:flex lg:flex-col`}
            >
            <div className="flex items-center justify-between gap-2">
              <h2 className="text-sm font-bold text-[var(--customer-text)]">Event and booking details</h2>
              <span className="hidden text-right text-xs font-semibold text-neutral-300 sm:block">{form.station_types.length} stations · {money(totalPriceTotal)}</span>
              <button type="button" className="customer-btn-secondary px-3 py-2 text-xs lg:hidden" onClick={() => setMobileSummaryOpen(false)}>Close</button>
            </div>
            <section className="catering-booking-details rounded-xl border border-katana-border bg-katana-elevated p-4">
              <div className="catering-booking-event-fields space-y-3">
                <section className="border-b border-katana-border pb-2">
                  <div className="grid gap-2 sm:grid-cols-2">
                    <label className="block">
                      <span className="customer-label">Event Date *</span>
                      <input className="customer-input py-2.5" type="date" min={earliestEventDate()} value={form.event_date} onChange={(event) => setField("event_date", event.target.value)} required />
                    </label>
                    <label className="block">
                      <span className="customer-label">Event Time *</span>
                      <input className="customer-input py-2.5" type="time" value={form.event_time} onChange={(event) => setField("event_time", event.target.value)} required />
                    </label>
                    <label className="block sm:col-span-2">
                      <span className="customer-label">Type of Event *</span>
                      <select className="customer-input py-2.5" value={form.event_type} onChange={(event) => setField("event_type", event.target.value)} required>
                        <option value="">Select event type</option>
                        <option value="Wedding">Wedding</option>
                        <option value="Birthday">Birthday</option>
                        <option value="Corporate Event">Corporate Event</option>
                        <option value="Private Party">Private Party</option>
                        <option value="Graduation">Graduation</option>
                        <option value="Others">Others</option>
                      </select>
                    </label>
                    {form.event_type === "Others" && (
                      <label className="block sm:col-span-2">
                        <span className="customer-label">Please specify *</span>
                        <input
                          className="customer-input py-2.5"
                          maxLength={60}
                          value={form.event_type_other}
                          onChange={(event) => setField("event_type_other", event.target.value)}
                          required
                        />
                      </label>
                    )}
                  </div>
                </section>
              </div>
            </section>
            <div className="catering-booking-checkout space-y-3 lg:min-h-0 lg:flex lg:flex-col lg:space-y-0 lg:gap-3 lg:shrink lg:border-t lg:border-katana-border lg:bg-[var(--customer-surface)] lg:pt-2">
              {isZeroQuoteOnlyReservation && (
                <p className="rounded-lg border border-amber-300/30 bg-amber-300/10 px-3 py-2 text-sm font-semibold text-amber-100">
                  This option needs a custom quote. Select priced packages here or send a catering inquiry.
                </p>
              )}
              <div className="catering-booking-cart max-h-28 space-y-2 overflow-y-auto overscroll-contain border-b border-katana-border pb-2 text-sm text-neutral-300">
                {form.station_types.length === 0 && <p className="text-neutral-400">Select a station to begin your order.</p>}
                {form.station_types.map((id) => {
                  const option = selectedPackageByStation[id];
                  const stationName = stations.find((station) => station.id === id)?.name ?? id;

                  if (!option) {
                    return (
                      <div key={id} className="grid grid-cols-[minmax(0,1fr)_auto] items-start gap-3">
                        <span className="break-words">{stationName}</span>
                        <span className="text-right text-neutral-400">Choose an option</span>
                      </div>
                    );
                  }

                  const isQuantityPackage = isPerUnitPackage(option);
                  const quantityValue = form.package_quantities[option.id] ?? "";
                  const quantity = isQuantityPackage ? Number(quantityValue) || 0 : undefined;
                  const needsQuantity = isQuantityPackage && !quantityValue;
                  const lineTotal = getPackagePrice(option, quantity);

                  return (
                    <div key={id} className="grid grid-cols-[minmax(0,1fr)_auto] items-start gap-3">
                      <span className="break-words">{option.description ?? option.name}{isQuantityPackage && quantityValue ? ` · ${quantityValue} ${option.items?.unit ?? "kg"}` : ""}</span>
                      <span className="text-right font-semibold text-white">
                        {option.items?.pricingType === "quote"
                          ? "Custom quote"
                          : needsQuantity
                            ? "Set quantity"
                            : money(lineTotal)}
                      </span>
                    </div>
                  );
                })}
                <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3">
                  <span>Headcount</span>
                  <span className="text-right">{headcountNumber === null ? "Not applicable" : `${headcountNumber} pax`}</span>
                </div>
              </div>
              <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-2 border-b border-katana-border pb-2 text-sm text-neutral-300">
                <span>Total · {
                  isZeroQuoteOnlyReservation
                    ? "Custom quote required"
                    : !form.payment_plan
                      ? "Choose payment option"
                      : isFullPayment ? "100% of package total" : "50% of package total"
                }</span>
                <span className="text-right font-bold text-white">{money(totalPriceTotal)}</span>
              </div>
              <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-2 text-xs text-neutral-300">
                <span>{isZeroQuoteOnlyReservation ? "Select a priced package" : "Initial payment after submission"}</span>
                <span className="text-right font-semibold text-white">{money(paymentAmountTotal)}</span>
              </div>
              {!isZeroQuoteOnlyReservation && (
                <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-2 text-xs text-neutral-300">
                  <span>Package balance due later, before added fees</span>
                  <span className="text-right">{money(remainingTotal)}</span>
                </div>
              )}
              <section>
                <h3 className="text-xs font-bold uppercase tracking-wide text-white">Payment option</h3>
                {isZeroQuoteOnlyReservation ? (
                  <p className="mt-1 text-xs text-neutral-300">Custom-quote options must be arranged through a catering inquiry.</p>
                ) : !hasPricedOptions ? (
                  <p className="mt-1 text-xs text-neutral-300">Select a priced option to see payment choices.</p>
                ) : (
                  <div className="catering-booking-payment-options mt-2 space-y-1.5" role="radiogroup" aria-label="Catering payment plan">
                    <label className="grid cursor-pointer grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-2 rounded-lg border border-katana-border bg-katana-surface px-2.5 py-2 text-xs text-white transition hover:border-katana-red/50 has-[:checked]:border-katana-red has-[:checked]:bg-katana-red/10">
                      <input
                        type="radio"
                        name="catering-payment-plan"
                        value="downpayment"
                        checked={isDownpayment}
                        onChange={() => setField("payment_plan", "downpayment")}
                        className="h-4 w-4 accent-katana-red"
                      />
                      <span className="font-semibold">Pay 50% of package total</span>
                      <span className="text-right font-bold">{money(Number((totalPriceTotal * 0.5).toFixed(2)))}</span>
                    </label>
                    <label className="grid cursor-pointer grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-2 rounded-lg border border-katana-border bg-katana-surface px-2.5 py-2 text-xs text-white transition hover:border-katana-red/50 has-[:checked]:border-katana-red has-[:checked]:bg-katana-red/10">
                      <input
                        type="radio"
                        name="catering-payment-plan"
                        value="full_payment"
                        checked={isFullPayment}
                        onChange={() => setField("payment_plan", "full_payment")}
                        className="h-4 w-4 accent-katana-red"
                      />
                      <span className="font-semibold">Pay 100% of package total</span>
                      <span className="text-right font-bold">{money(totalPriceTotal)}</span>
                    </label>
                  </div>
                )}
              </section>
              {paymentAmountTotal > 0 && (
                <section>
                  <h3 className="text-xs font-bold uppercase tracking-wide text-white">Payment method</h3>
                  <div className="mt-2 grid grid-cols-3 gap-2">
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
                        className={`flex min-h-[40px] flex-col items-center justify-center gap-0.5 rounded-lg border px-2 py-1 text-xs font-bold ${
                          form.payment_method === option.id
                            ? "border-katana-red bg-katana-red text-white"
                            : option.disabled
                              ? "cursor-not-allowed border-katana-border bg-katana-surface text-neutral-500 opacity-70"
                              : "border-katana-border bg-katana-elevated text-neutral-300"
                        }`}
                      >
                        <span className="flex items-center gap-1">{option.icon}{option.label}</span>
                        {option.disabled && <span className="text-[9px] font-semibold uppercase tracking-wide text-neutral-500">Coming soon</span>}
                      </button>
                    ))}
                  </div>
                </section>
              )}
            </div>
            <div className="catering-booking-actions sticky bottom-0 z-10 space-y-2 bg-[var(--customer-surface)] px-2 pb-2 pt-3 shadow-[0_-8px_16px_rgba(0,0,0,0.12)] lg:static lg:flex lg:flex-col lg:space-y-0 lg:gap-2 lg:shrink-0 lg:bg-transparent lg:px-0 lg:pb-0 lg:pt-0 lg:shadow-none">
            <label className="catering-booking-ack flex items-start gap-3 rounded-xl border border-katana-border bg-katana-surface p-4 text-sm font-semibold text-white">
              <input
                checked={form.acknowledged}
                className="mt-1 h-4 w-4 accent-katana-red"
                type="checkbox"
                onChange={(event) => setField("acknowledged", event.target.checked)}
              />
              I understand this reservation is pending staff approval.
            </label>

            <button
              type="button"
              aria-haspopup="dialog"
              onClick={() => {
                const bookingDetailsError = getBookingDetailsError();
                if (bookingDetailsError) {
                  setNotice(bookingDetailsError);
                  return;
                }
                setNotice("");
                setMobileSummaryOpen(false);
                setDetailsOpen(true);
              }}
              className="customer-btn-primary flex w-full gap-2 disabled:cursor-not-allowed disabled:opacity-70"
              disabled={isProcessingPayment}
            >
              <Send className="h-4 w-4" /> {
                isProcessingPayment
                  ? "Submitting..."
                  : "Review request"
              }
            </button>
            <p className="text-center text-xs text-katana-muted">
              {isZeroQuoteOnlyReservation
                ? "Choose priced packages to continue with an online reservation."
                : `Submit the request, then pay ${money(paymentAmountTotal)} of the package total. Staff may add a mobilization fee for the remaining balance.`}
            </p>
            {notice && <p className="rounded-md bg-red-50 px-3 py-2 text-sm font-medium text-katana-red" role="alert">{notice}</p>}
            </div>
            </aside>
            <div className="fixed inset-x-0 bottom-0 z-30 border-t border-[color:var(--customer-border)] bg-[var(--customer-surface)]/95 px-4 py-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] shadow-[0_-8px_24px_rgba(0,0,0,0.12)] backdrop-blur lg:hidden">
              <div className="flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-[10px] font-bold uppercase tracking-wider text-[var(--customer-muted)]">Estimated total</p>
                  <p className="truncate text-base font-bold text-[var(--customer-text)]">{money(totalPriceTotal)}</p>
                </div>
                <button
                  type="button"
                  className="customer-btn-primary shrink-0 px-4 py-3 text-xs"
                  onClick={() => setMobileSummaryOpen(true)}
                  aria-expanded={mobileSummaryOpen}
                  aria-controls="catering-mobile-details"
                >
                  Review details
                </button>
              </div>
            </div>
          </div>
        </form>
        <Dialog
          open={detailsOpen}
          title="Your contact details"
          onClose={() => !isProcessingPayment && setDetailsOpen(false)}
          overlayClassName="items-end !px-0 !py-0 sm:items-center sm:!px-4 sm:!py-4"
          panelClassName="h-[100dvh] max-h-[100dvh] max-w-none rounded-none border border-[color:var(--customer-border)] !bg-[var(--customer-surface)] !text-[var(--customer-text)] sm:h-auto sm:max-h-[90vh] sm:max-w-xl sm:rounded-lg [&>div:first-child]:!border-[color:var(--customer-border)] [&>div:first-child]:!bg-[var(--customer-surface)] [&>div:first-child>h2]:!text-[var(--customer-text)] [&>div:last-child]:!bg-[var(--customer-surface)] [&>div:last-child]:!text-[var(--customer-text)]"
        >
          <form className="grid gap-4" onSubmit={handleSubmit}>
            <p className="rounded-lg border border-[color:var(--customer-border)] bg-[var(--customer-surface-2)] p-3 text-sm text-[var(--customer-muted)]">
              {form.event_date || "Choose an event date"} · {form.event_time || "Choose an event time"} · {form.event_type || "Choose event type"}
            </p>
            <label className="grid gap-1 text-sm font-semibold text-[var(--customer-text)]">
              Your name *
              <input
                className="customer-input"
                autoComplete="name"
                maxLength={120}
                value={form.customer_name}
                onChange={(event) => setField("customer_name", event.target.value)}
                required
              />
            </label>
            <label className="grid gap-1 text-sm font-semibold text-[var(--customer-text)]">
              Phone number *
              <input
                className="customer-input"
                type="tel"
                inputMode="numeric"
                autoComplete="tel"
                pattern="09[0-9]{9}"
                maxLength={11}
                placeholder="09123456789"
                value={form.customer_phone}
                onChange={(event) => setField("customer_phone", event.target.value.replace(/\D/g, "").slice(0, 11))}
                required
              />
            </label>
            <label className="grid gap-1 text-sm font-semibold text-[var(--customer-text)]">
              Email *
              <input
                className="customer-input"
                type="email"
                autoComplete="email"
                maxLength={254}
                value={form.customer_email}
                onChange={(event) => setField("customer_email", event.target.value)}
                required
              />
            </label>
            <label className="grid gap-1 text-sm font-semibold text-[var(--customer-text)]">
              Venue address *
              <textarea
                className="min-h-24 customer-input"
                autoComplete="street-address"
                minLength={5}
                maxLength={500}
                placeholder="Complete event venue address"
                value={form.venue_address}
                onChange={(event) => setField("venue_address", event.target.value)}
                required
              />
            </label>
            <div className="rounded-lg border border-[color:var(--customer-border)] bg-[var(--customer-surface-2)] p-3 text-sm text-[var(--customer-muted)]">
              <p className="font-bold text-[var(--customer-text)]">{form.station_types.map((id) => stations.find((station) => station.id === id)?.name).filter(Boolean).join(", ") || "No station selected"}</p>
              <p className="mt-1">Total: {money(totalPriceTotal)}</p>
              <p className="mt-1">
                {isZeroQuoteOnlyReservation
                  ? "A custom quote is required."
                  : paymentAmountTotal > 0
                    ? `${isFullPayment ? "100% of package total" : "50% of package total"} due after submitting: ${money(paymentAmountTotal)}`
                    : "Select an option to calculate payment."}
              </p>
              {!isZeroQuoteOnlyReservation && <p className="mt-1">Remaining package balance before any staff-added fee: {money(remainingTotal)}</p>}
            </div>
            {notice && <p className="rounded-md bg-red-50 px-3 py-2 text-sm font-medium text-red-800" role="alert">{notice}</p>}
            <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
              <button
                type="button"
                className="customer-btn-secondary"
                onClick={() => setDetailsOpen(false)}
                disabled={isProcessingPayment}
              >
                Back
              </button>
              <button
                type="submit"
                className="customer-btn-primary"
                disabled={isProcessingPayment}
              >
                {isProcessingPayment
                  ? "Submitting..."
                  : isZeroQuoteOnlyReservation
                    ? "Select priced packages"
                    : paymentAmountTotal > 0
                      ? "Submit request and continue"
                      : "Choose a payment option"}
              </button>
            </div>
          </form>
        </Dialog>
        </div>
      </section>
    </main>
  );
}

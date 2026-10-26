import { FormEvent, ReactNode, useEffect, useId, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { Banknote, Check, CheckCircle2, Landmark, Send, ShieldCheck, Smartphone, X } from "lucide-react";
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

type CateringModalProps = {
  title: string;
  onClose: () => void;
  children: ReactNode;
};

function CateringModal({ title, onClose, children }: CateringModalProps) {
  const titleId = useId();
  const dialogRef = useRef<HTMLDivElement>(null);
  const onCloseRef = useRef(onClose);

  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;

    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    const getFocusableElements = () => Array.from(
      dialog.querySelectorAll<HTMLElement>(
        'button:not([disabled]), input:not([disabled]), [href], select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
      )
    );

    getFocusableElements()[0]?.focus();
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onCloseRef.current();
        return;
      }
      if (event.key !== "Tab") return;

      const focusableElements = getFocusableElements();
      const first = focusableElements[0];
      const last = focusableElements[focusableElements.length - 1];
      if (!first || !last) {
        event.preventDefault();
      } else if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };

    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("keydown", handleKeyDown);
      document.body.style.overflow = previousOverflow;
      previousFocus?.focus();
    };
  }, []);

  return (
    <div
      className="fixed inset-0 z-[70] flex items-center justify-center bg-black/60 px-4 py-6"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="flex max-h-[90dvh] w-full max-w-2xl flex-col overflow-hidden rounded-2xl border border-[var(--customer-border)] bg-[var(--customer-surface)] text-[var(--customer-text)] shadow-2xl"
      >
        <header className="flex shrink-0 items-center justify-between border-b border-[var(--customer-border)] px-5 py-4">
          <h2 id={titleId} className="text-lg font-bold">{title}</h2>
          <button
            type="button"
            aria-label="Close dialog"
            onClick={onClose}
            className="rounded-lg p-2 text-[var(--customer-muted)] transition hover:bg-[var(--customer-surface-2)] hover:text-[var(--customer-text)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-katana-red"
          >
            <X className="h-5 w-5" />
          </button>
        </header>
        {children}
      </div>
    </div>
  );
}

const EMPTY_CATERING_PACKAGES: CateringPackage[] = [];

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
  const stationType = item.stationType?.trim().toLowerCase().replace(/[\s-]+/g, "_");
  const packageIdentity = `${item.id} ${item.name} ${item.description ?? ""}`.toLowerCase();

  if (stationType === "sashimi_bar" || stationType === "sashimi") {
    const minimum = item.items?.minimum ?? item.items?.minKg;
    const maximum = item.items?.maximum ?? item.items?.maxKg;
    const isWholeTuna = packageIdentity.includes("whole tuna") ||
      item.id.toLowerCase().includes("whole_tuna") ||
      (minimum === 20 && maximum === 40);
    if (isWholeTuna) {
      return "whole_tuna";
    }
    if (isPerUnitPackage(item)) {
      const hasTuna = /\btuna\b/.test(packageIdentity);
      const hasSalmon = /\bsalmon\b/.test(packageIdentity);
      if (hasTuna !== hasSalmon) {
        return hasTuna ? "tuna_add_on" : "salmon_add_on";
      }
    }
    return "sashimi_bar";
  }

  if (stationType) {
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

  if (item.id.toLowerCase().includes("sashimi") && isPerUnitPackage(item)) {
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
    sashimi_bar: "Sashimi Bar",
    whole_tuna: "Sashimi Bar",
    tuna_add_on: "Tuna by kilo",
    salmon_add_on: "Salmon by kilo",
    tempura_live: "Tempura Live"
  };
  return names[id] ?? id.split(/[_\s-]+/).map((part) => `${part.charAt(0).toUpperCase()}${part.slice(1)}`).join(" ");
}

function getMinimumQuantity(item: CateringPackage) {
  return ["tuna_add_on", "salmon_add_on"].includes(getStationType(item))
    ? 2
    : item.items?.minimum ?? item.items?.minKg ?? 1;
}

function getPackageDescription(item: CateringPackage) {
  const stationType = getStationType(item);
  if (stationType === "tuna_add_on" || stationType === "salmon_add_on") {
    const maximum = item.items?.maximum ?? item.items?.maxKg ?? 40;
    const rate = item.items?.pricePerUnit ?? item.items?.pricePerKg ?? 0;
    return `${item.name} add-on, 1-${maximum} kg at ${money(rate)}/kg.`;
  }
  if (stationType === "whole_tuna") {
    return "Whole tuna sold by weight, 20-40 kg at PHP 1,200/kg. Booked as a standalone item.";
  }
  return item.description ?? item.name;
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
    const rate = item.items.pricePerUnit ?? item.items.pricePerKg ?? 0;
    return `From ${money(rate * getMinimumQuantity(item))} · ${money(rate)}/${item.items.unit ?? "kg"}`;
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
      const minimum = getMinimumQuantity(item);
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
  const [cateringModal, setCateringModal] = useState<"inclusions" | "addons" | null>(null);
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
  const packages = packagesQuery.data ?? EMPTY_CATERING_PACKAGES;
  const catalogStations = useMemo(() => {
    const stationTypes = Array.from(new Set(packages.map(getStationType)));
    return stationTypes.map((id) => ({
      id,
      name: getStationName(id)
    }));
  }, [packages]);
  const stations = useMemo(() => catalogStations.filter((station) =>
    !["tuna_add_on", "salmon_add_on", "sashimi_bar"].includes(station.id)
  ), [catalogStations]);
  const addOnStations = useMemo(() => catalogStations.filter((station) =>
    ["tuna_add_on", "salmon_add_on"].includes(station.id)
  ), [catalogStations]);
  const allStations = useMemo(() => [...stations, ...addOnStations], [stations, addOnStations]);
  const packagesByStation = useMemo(() => {
    const map: { [k: string]: CateringPackage[] } = {};
    allStations.forEach((s) => {
      map[s.id] = packages.filter((item) => getStationType(item) === s.id);
    });
    return map;
  }, [packages, allStations]);

  const selectedPackageByStation: { [k: string]: CateringPackage | undefined } = {};
  allStations.forEach((s) => {
    const pkgId = form.package_by_station[s.id];
    selectedPackageByStation[s.id] = (packagesByStation[s.id] ?? []).find((p) => p.id === pkgId);
  });

  const selectedPackages = form.station_types
    .map((stationId) => selectedPackageByStation[stationId])
    .filter((item): item is CateringPackage => Boolean(item));
  const selectedBasePackages = selectedPackages.filter((item) =>
    ["sushi_station", "tempura_live"].includes(getStationType(item))
  );
  const selectedStationCount = selectedPackages.filter((item) =>
    !["tuna_add_on", "salmon_add_on"].includes(getStationType(item))
  ).length;
  const hasEligibleAddonStation = selectedBasePackages.length > 0;
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
    return allStations.reduce((sum, s) => {
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
  const addonSubtotalTotal = Number(selectedPackages
    .filter((item) => ["tuna_add_on", "salmon_add_on"].includes(getStationType(item)))
    .reduce((sum, item) => {
      const quantity = Number(form.package_quantities[item.id]) || 0;
      return sum + getPackagePrice(item, quantity);
    }, 0).toFixed(2));
  const packageSubtotalTotal = Number((totalPriceTotal - addonSubtotalTotal).toFixed(2));
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

  function toggleAddon(stationId: string, selected: boolean) {
    const packageOption = packagesByStation[stationId]?.[0];
    if (!packageOption) return;

    setForm((current) => {
      const stationTypes = selected
        ? Array.from(new Set([...current.station_types, stationId]))
        : current.station_types.filter((id) => id !== stationId);
      const packageByStation = { ...current.package_by_station };
      const packageQuantities = { ...current.package_quantities };

      if (selected) {
        packageByStation[stationId] = packageOption.id;
        if (!packageQuantities[packageOption.id] || Number(packageQuantities[packageOption.id]) < getMinimumQuantity(packageOption)) {
          packageQuantities[packageOption.id] = String(getMinimumQuantity(packageOption));
        }
      } else {
        delete packageByStation[stationId];
      }

      return {
        ...current,
        station_types: stationTypes,
        package_by_station: packageByStation,
        package_quantities: packageQuantities
      };
    });
  }

  const addonSelectionSummary = selectedPackages
    .filter((item) => ["tuna_add_on", "salmon_add_on"].includes(getStationType(item)))
    .map((item) => `${getStationType(item) === "tuna_add_on" ? "tuna" : "salmon"} ${form.package_quantities[item.id] ?? getMinimumQuantity(item)} kg`)
    .join(", ");

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
      const minimum = getMinimumQuantity(item);
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
            <div className="grid w-full items-start gap-6 min-[900px]:grid-cols-[minmax(0,1fr)_400px] min-[900px]:gap-3">
            <div>
            <BackToHome className="mb-3" />
            <div className="space-y-6">
            <p className="text-sm text-neutral-300">Pick a package size under each station, then add Tuna or Salmon by the kilo if you like.</p>

            <section className="space-y-6" aria-label="Catering stations and add-ons">
              {packagesQuery.isPending && <p className="text-sm text-neutral-300" role="status">Loading catering stations...</p>}
              {packagesQuery.isError && (
                <div className="text-sm text-katana-red" role="alert">
                  <p>Catering stations could not be loaded.</p>
                  <button type="button" className="mt-1 underline" onClick={() => void packagesQuery.refetch()}>Retry</button>
                </div>
              )}
              {packagesQuery.isSuccess && (
                <div className="space-y-8">
                  {stations.map((station) => {
                    const options = packagesByStation[station.id] ?? [];
                    const selectedPackage = selectedPackageByStation[station.id];
                    const inclusions = options.find((option) => option.items?.inclusions?.length)?.items?.inclusions ?? [];
                    const subtitle = station.id === "sushi_station"
                      ? `${options.length} package options`
                      : station.id === "whole_tuna"
                        ? "Whole Tuna option only"
                        : `Fixed package${options[0]?.items?.fixedPax ? ` · ${options[0].items.fixedPax} pax` : ""}`;

                    return (
                      <section key={station.id} aria-label={station.name}>
                        <div className="flex items-center justify-between gap-3 border-b-2 border-katana-red pb-2">
                          <div>
                            <h2 className="text-xl font-bold text-[var(--customer-text)]">{station.name}</h2>
                            <p className="mt-1 text-sm text-[var(--customer-muted)]">{subtitle}</p>
                          </div>
                          {station.id === "sushi_station" && inclusions.length > 0 && (
                            <button
                              type="button"
                              onClick={() => setCateringModal("inclusions")}
                              className="shrink-0 rounded-full border border-katana-red px-4 py-2 text-sm font-semibold text-katana-red transition hover:bg-katana-red hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-katana-red"
                            >
                              View inclusions
                            </button>
                          )}
                        </div>
                        {options.length === 0 ? (
                          <p className="mt-3 text-sm text-[var(--customer-muted)]">No package options are currently available.</p>
                        ) : (
                          <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
                            {options.map((item) => {
                              const images = getPackageImages(item);
                              const optionSelected = selectedPackage?.id === item.id;
                              const isQuantityPackage = isPerUnitPackage(item);
                              const quantityValue = form.package_quantities[item.id] ?? "";
                              const quantity = Number(quantityValue);
                              const hasQuantity = quantityValue !== "" && Number.isFinite(quantity);
                              const minimum = getMinimumQuantity(item);
                              const maximum = item.items?.maximum ?? item.items?.maxKg;
                              const step = item.items?.step ?? item.items?.stepKg ?? 1;
                              const title = station.id === "sushi_station"
                                ? `${item.minPax}–${item.maxPax} pax`
                                : station.id === "whole_tuna"
                                  ? "Whole Tuna"
                                  : item.description ?? item.name;
                              const paxLabel = station.id === "whole_tuna"
                                ? `${minimum}-${maximum ?? 40} kg`
                                : item.items?.fixedPax
                                  ? `Fixed ${item.items.fixedPax} pax`
                                  : `${item.minPax}–${item.maxPax} pax`;

                              return (
                                <div
                                  key={item.id}
                                  className={`relative overflow-hidden rounded-2xl border bg-[var(--customer-surface)] transition ${
                                    optionSelected ? "border-katana-red ring-1 ring-katana-red" : "border-[var(--customer-border)] hover:border-katana-red/60"
                                  }`}
                                >
                                  <button
                                    type="button"
                                    aria-pressed={optionSelected}
                                    aria-label={`${title}, ${paxLabel}, ${getPackagePriceLabel(item)}`}
                                    onClick={() => setForm((current) => {
                                      const currentlySelected = current.package_by_station[station.id] === item.id &&
                                        current.station_types.includes(station.id);
                                      const stationTypes = currentlySelected
                                        ? current.station_types.filter((id) => id !== station.id)
                                        : Array.from(new Set([...current.station_types, station.id]));
                                      const packageByStation = { ...current.package_by_station };
                                      if (currentlySelected) {
                                        delete packageByStation[station.id];
                                      } else {
                                        packageByStation[station.id] = item.id;
                                      }
                                      const quantities = { ...current.package_quantities };
                                      if (!currentlySelected && isQuantityPackage && !quantities[item.id]) {
                                        quantities[item.id] = String(minimum);
                                      }
                                      return {
                                        ...current,
                                        station_types: stationTypes,
                                        package_by_station: packageByStation,
                                        package_quantities: quantities
                                      };
                                    })}
                                    className="group block w-full rounded-2xl text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-katana-red"
                                  >
                                    <div className="relative grid h-24 grid-cols-3 place-items-center gap-2 bg-katana-red/10 p-3">
                                      {images.length > 0 ? images.slice(0, 2).map((image, index) => (
                                        <img
                                          key={image}
                                          src={image}
                                          alt=""
                                          className="h-full max-w-full rounded-lg object-cover"
                                          loading="lazy"
                                          decoding="async"
                                        />
                                      )) : (
                                        <span className="col-span-3 text-xs font-semibold uppercase tracking-wide text-[var(--customer-muted)]">
                                          {station.name}
                                        </span>
                                      )}
                                      {optionSelected && (
                                        <span className="absolute right-3 top-3 inline-flex h-7 w-7 items-center justify-center rounded-full bg-katana-red text-white">
                                          <Check className="h-4 w-4" aria-hidden="true" />
                                        </span>
                                      )}
                                    </div>
                                    <div className="grid min-h-28 content-between gap-2 p-4">
                                      <div>
                                        <p className="text-base font-bold text-[var(--customer-text)]">{title}</p>
                                        <p className="mt-1 text-xs uppercase tracking-wide text-[var(--customer-muted)]">{paxLabel}</p>
                                      </div>
                                      <p className="text-sm font-bold text-katana-red">{getPackagePriceLabel(item)}</p>
                                    </div>
                                  </button>
                                  {optionSelected && isQuantityPackage && (
                                    <div className="grid gap-2 border-t border-[var(--customer-border)] p-3">
                                      <span className="text-xs font-semibold text-[var(--customer-muted)]">Quantity ({item.items?.unit ?? "kg"})</span>
                                      <div className="flex items-center gap-2">
                                        <button
                                          type="button"
                                          aria-label={`Decrease ${item.name} quantity`}
                                          disabled={!hasQuantity || quantity <= minimum}
                                          onClick={() => setForm((current) => ({
                                            ...current,
                                            package_quantities: {
                                              ...current.package_quantities,
                                              [item.id]: String(Math.max(minimum, quantity - step))
                                            }
                                          }))}
                                          className="h-10 w-10 rounded-lg border border-[var(--customer-border)] text-lg font-bold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-katana-red disabled:opacity-40"
                                        >−</button>
                                        <input
                                          className="customer-input h-10 py-1 text-center"
                                          type="number"
                                          min={minimum}
                                          max={maximum}
                                          step={step}
                                          inputMode="numeric"
                                          aria-label={`${item.name} quantity`}
                                          value={quantityValue}
                                          onChange={(event) => {
                                            const value = event.target.value;
                                            const parsed = Number(value);
                                            setForm((current) => ({
                                              ...current,
                                              package_quantities: {
                                                ...current.package_quantities,
                                                [item.id]: value && Number.isFinite(parsed) && maximum !== undefined
                                                  ? String(Math.min(parsed, maximum))
                                                  : value
                                              }
                                            }));
                                          }}
                                          onBlur={() => {
                                            if (!quantityValue) return;
                                            const bounded = Math.max(minimum, Math.min(maximum ?? Number.POSITIVE_INFINITY, Number(quantityValue)));
                                            setForm((current) => ({
                                              ...current,
                                              package_quantities: { ...current.package_quantities, [item.id]: String(bounded) }
                                            }));
                                          }}
                                        />
                                        <button
                                          type="button"
                                          aria-label={`Increase ${item.name} quantity`}
                                          disabled={hasQuantity && maximum !== undefined && quantity >= maximum}
                                          onClick={() => setForm((current) => ({
                                            ...current,
                                            package_quantities: {
                                              ...current.package_quantities,
                                              [item.id]: String(Math.min(maximum ?? Number.POSITIVE_INFINITY, (hasQuantity ? quantity : minimum - step) + step))
                                            }
                                          }))}
                                          className="h-10 w-10 rounded-lg border border-[var(--customer-border)] text-lg font-bold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-katana-red disabled:opacity-40"
                                        >+</button>
                                      </div>
                                    </div>
                                  )}
                                </div>
                              );
                            })}
                          </div>
                        )}
                      </section>
                    );
                  })}

                  <div className="flex flex-wrap items-center justify-between gap-4 rounded-2xl border border-dashed border-katana-red/60 bg-katana-red/5 p-4">
                    <div>
                      <h2 className="font-bold text-[var(--customer-text)]">Add-ons</h2>
                      <p className="mt-1 text-sm text-[var(--customer-muted)]">
                        {addonSelectionSummary || "Tuna and Salmon by the kilo. Needs a Sushi Station or Tempura Live package."}
                      </p>
                      {!hasEligibleAddonStation && (
                        <p className="mt-1 text-xs text-katana-red">Select Sushi Station or Tempura Live to add Tuna or Salmon.</p>
                      )}
                    </div>
                    <button
                      type="button"
                      disabled={!hasEligibleAddonStation || addOnStations.length === 0}
                      onClick={() => setCateringModal("addons")}
                      className="customer-btn-primary shrink-0 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      Add-ons
                    </button>
                  </div>
                </div>
              )}
            </section>
            </div>
            </div>
            <aside
              id="catering-mobile-details"
              className="catering-booking-panel flex flex-col overflow-visible rounded-2xl border border-[var(--customer-border)] bg-[var(--customer-surface)] min-[900px]:sticky min-[900px]:top-3 min-[900px]:h-[calc(100dvh-1.5rem)] min-[900px]:overflow-hidden"
            >
              <header className="shrink-0 bg-katana-red px-5 py-4 text-white">
                <h2 className="text-lg font-bold">Event and booking details</h2>
                <p className="mt-1 text-sm font-medium">{selectedStationCount} {selectedStationCount === 1 ? "station" : "stations"} · {money(totalPriceTotal)}</p>
              </header>
              <div className="catering-booking-body flex-1 space-y-5 p-4 min-[900px]:min-h-0 min-[900px]:overflow-y-auto min-[900px]:overscroll-contain">
                <section className="catering-booking-event-fields space-y-3">
                  <h3 className="text-sm font-bold text-[var(--customer-text)]">Event</h3>
                  <div className="grid gap-3 sm:grid-cols-2">
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
                        <input className="customer-input py-2.5" maxLength={60} value={form.event_type_other} onChange={(event) => setField("event_type_other", event.target.value)} required />
                      </label>
                    )}
                  </div>
                </section>

                <section className="space-y-3 border-t border-[var(--customer-border)] pt-4">
                  <h3 className="text-sm font-bold text-[var(--customer-text)]">Your order</h3>
                  {selectedPackages.length === 0 ? (
                    <p className="rounded-xl bg-[var(--customer-surface-2)] p-3 text-sm text-[var(--customer-muted)]">Select a station package to begin your order.</p>
                  ) : (
                    <div className="space-y-3">
                      {selectedPackages.map((item) => {
                        const type = getStationType(item);
                        const isAddon = type === "tuna_add_on" || type === "salmon_add_on";
                        const quantity = Number(form.package_quantities[item.id]) || 0;
                        const rate = item.items?.pricePerUnit ?? item.items?.pricePerKg ?? 0;
                        const linePrice = getPackagePrice(item, isPerUnitPackage(item) ? quantity : undefined);
                        const title = isAddon
                          ? `${item.name} add-on`
                          : type === "whole_tuna"
                            ? "Whole Tuna"
                            : allStations.find((station) => station.id === type)?.name ?? item.name;
                        const detail = isAddon
                          ? `${quantity} kg × ${money(rate)}/kg`
                          : type === "whole_tuna"
                            ? `${quantity} kg × ${money(rate)}/kg`
                            : item.items?.fixedPax
                              ? `${item.items.fixedPax} pax`
                              : item.description ?? `${item.minPax}–${item.maxPax} pax`;

                        return (
                          <div key={item.id} className="flex items-start justify-between gap-3 border-b border-[var(--customer-border)] pb-3 text-sm">
                            <div className="min-w-0">
                              <p className="font-semibold text-[var(--customer-text)]">{title}</p>
                              <p className="mt-0.5 text-xs text-[var(--customer-muted)]">{detail}</p>
                            </div>
                            <span className="shrink-0 font-bold text-[var(--customer-text)]">{money(linePrice)}</span>
                          </div>
                        );
                      })}
                      <div className="flex items-center justify-between gap-3 text-sm">
                        <span className="text-[var(--customer-muted)]">Headcount</span>
                        <span className="font-bold">{headcountNumber === null ? "Not applicable" : `${headcountNumber} pax`}</span>
                      </div>
                    </div>
                  )}
                </section>

                {isZeroQuoteOnlyReservation && (
                  <p className="rounded-lg border border-amber-300/30 bg-amber-300/10 px-3 py-2 text-sm font-semibold text-amber-100">
                    This option needs a custom quote. Select priced packages here or send a catering inquiry.
                  </p>
                )}

                <section className="border-t border-[var(--customer-border)] pt-4">
                  <h3 className="text-sm font-bold text-[var(--customer-text)]">Payment option</h3>
                  {isZeroQuoteOnlyReservation ? (
                    <p className="mt-2 text-xs text-[var(--customer-muted)]">Custom-quote options must be arranged through a catering inquiry.</p>
                  ) : !hasPricedOptions ? (
                    <p className="mt-2 text-xs text-[var(--customer-muted)]">Select a priced option to see payment choices.</p>
                  ) : (
                    <div className="mt-2 grid grid-cols-2 gap-2" role="group" aria-label="Catering payment plan">
                      {([
                        { value: "downpayment", title: "Pay 50% now", subtitle: "Balance due later", amount: Number((totalPriceTotal * 0.5).toFixed(2)), selected: isDownpayment },
                        { value: "full_payment", title: "Pay in full", subtitle: "No balance later", amount: totalPriceTotal, selected: isFullPayment }
                      ] as const).map((option) => (
                        <button
                          key={option.value}
                          type="button"
                          aria-pressed={option.selected}
                          onClick={() => setField("payment_plan", option.value)}
                          className={`rounded-xl border p-3 text-left transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-katana-red ${
                            option.selected ? "border-katana-red bg-katana-red/10" : "border-[var(--customer-border)] hover:border-katana-red/60"
                          }`}
                        >
                          <span className="block text-sm font-bold">{option.title}</span>
                          <span className="mt-1 block text-xs text-[var(--customer-muted)]">{option.subtitle}</span>
                          <span className="mt-2 block text-sm font-bold text-katana-red">{money(option.amount)}</span>
                        </button>
                      ))}
                    </div>
                  )}
                </section>

                {paymentAmountTotal > 0 && (
                  <section className="border-t border-[var(--customer-border)] pt-4">
                    <h3 className="text-sm font-bold text-[var(--customer-text)]">Payment method</h3>
                    <div className="mt-2 grid grid-cols-3 gap-2">
                      {([
                        { id: "cash", label: "Cash", icon: <Banknote className="h-4 w-4" />, disabled: false },
                        { id: "gcash", label: "GCash", icon: <Smartphone className="h-4 w-4" />, disabled: true },
                        { id: "bank_transfer", label: "BPI", icon: <Landmark className="h-4 w-4" />, disabled: true }
                      ] as const).map((option) => (
                        <button
                          type="button"
                          key={option.id}
                          aria-pressed={form.payment_method === option.id}
                          onClick={() => !option.disabled && setField("payment_method", option.id)}
                          disabled={option.disabled}
                          className={`flex min-h-[42px] flex-col items-center justify-center gap-0.5 rounded-lg border px-2 py-1 text-xs font-bold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-katana-red ${
                            form.payment_method === option.id
                              ? "border-katana-red bg-katana-red text-white"
                              : option.disabled
                                ? "cursor-not-allowed border-[var(--customer-border)] bg-[var(--customer-surface-2)] text-[var(--customer-muted)]"
                                : "border-[var(--customer-border)] text-[var(--customer-muted)]"
                          }`}
                        >
                          <span className="flex items-center gap-1">{option.icon}{option.label}</span>
                          {option.disabled && <span className="text-[9px] uppercase tracking-wide">Coming soon</span>}
                        </button>
                      ))}
                    </div>
                  </section>
                )}

                <section className="space-y-2 border-t border-[var(--customer-border)] pt-4 text-sm">
                  <h3 className="font-bold text-[var(--customer-text)]">Price breakdown</h3>
                  <div className="flex justify-between gap-3 text-[var(--customer-muted)]"><span>Package subtotal</span><span>{money(packageSubtotalTotal)}</span></div>
                  <div className="flex justify-between gap-3 text-[var(--customer-muted)]"><span>Add-ons</span><span>{money(addonSubtotalTotal)}</span></div>
                  <div className="flex justify-between gap-3 text-[var(--customer-muted)]"><span>Initial payment after submission</span><span>{money(paymentAmountTotal)}</span></div>
                  {!isZeroQuoteOnlyReservation && (
                    <div className="flex justify-between gap-3 text-[var(--customer-muted)]"><span>Balance due later before added fees</span><span>{money(remainingTotal)}</span></div>
                  )}
                  <div className="flex justify-between gap-3 border-t border-[var(--customer-border)] pt-2 text-base font-bold">
                    <span>Total</span><span>{money(totalPriceTotal)}</span>
                  </div>
                </section>
              </div>
              <footer className="catering-booking-actions shrink-0 space-y-2 border-t border-[var(--customer-border)] bg-[var(--customer-surface)] p-4">
                <label className="catering-booking-ack flex items-start gap-3 rounded-xl border border-[var(--customer-border)] bg-[var(--customer-surface-2)] p-3 text-sm font-semibold">
                  <input checked={form.acknowledged} className="mt-1 h-4 w-4 accent-katana-red" type="checkbox" onChange={(event) => setField("acknowledged", event.target.checked)} />
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
                    setDetailsOpen(true);
                  }}
                  className="customer-btn-primary flex w-full gap-2 disabled:cursor-not-allowed disabled:opacity-50"
                  disabled={selectedStationCount === 0 || !form.acknowledged || isProcessingPayment}
                >
                  <Send className="h-4 w-4" /> {isProcessingPayment ? "Submitting..." : "Review request"}
                </button>
                <p className="text-center text-xs text-[var(--customer-muted)]">
                  Staff may add a mobilization fee for the remaining balance.
                </p>
                {notice && <p className="rounded-md bg-red-50 px-3 py-2 text-sm font-medium text-katana-red" role="alert">{notice}</p>}
              </footer>
            </aside>
          </div>
        </form>
        {cateringModal === "inclusions" && (
          <CateringModal title="Sushi Station inclusions" onClose={() => setCateringModal(null)}>
            <div className="min-h-0 overflow-y-auto p-5">
              {(() => {
                const inclusions = packagesByStation.sushi_station
                  ?.find((item) => item.items?.inclusions?.length)
                  ?.items?.inclusions ?? [];
                return inclusions.length > 0 ? (
                  <ul className="grid gap-3 text-sm text-[var(--customer-text)] sm:grid-cols-2">
                    {inclusions.map((inclusion) => (
                      <li key={typeof inclusion === "string" ? inclusion : inclusion.name} className="flex items-start gap-2">
                        <Check className="mt-0.5 h-4 w-4 shrink-0 text-katana-red" aria-hidden="true" />
                        <span>{typeof inclusion === "string" ? inclusion : inclusion.name}</span>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="text-sm text-[var(--customer-muted)]">Inclusion details are not available for this station.</p>
                );
              })()}
              <div className="mt-6 flex justify-end border-t border-[var(--customer-border)] pt-4">
                <button type="button" className="customer-btn-primary px-6 py-2.5" onClick={() => setCateringModal(null)}>Close</button>
              </div>
            </div>
          </CateringModal>
        )}
        {cateringModal === "addons" && (
          <CateringModal title="Add-ons" onClose={() => setCateringModal(null)}>
            <div className="flex min-h-0 flex-1 flex-col">
              <div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-5">
                {!hasEligibleAddonStation ? (
                  <p className="rounded-xl border border-katana-red/40 bg-katana-red/10 p-4 text-sm">
                    Add-ons require a Sushi Station or Tempura Live package.
                  </p>
                ) : addOnStations.length === 0 ? (
                  <p className="text-sm text-[var(--customer-muted)]">No add-ons are currently available.</p>
                ) : addOnStations.map((station) => {
                  const item = packagesByStation[station.id]?.[0];
                  if (!item) return null;
                  const selected = form.station_types.includes(station.id);
                  const minimum = getMinimumQuantity(item);
                  const maximum = item.items?.maximum ?? item.items?.maxKg ?? 40;
                  const step = item.items?.step ?? item.items?.stepKg ?? 1;
                  const quantityValue = form.package_quantities[item.id] ?? String(minimum);
                  const quantity = Number(quantityValue) || minimum;
                  const rate = item.items?.pricePerUnit ?? item.items?.pricePerKg ?? 0;

                  return (
                    <section
                      key={station.id}
                      className={`rounded-xl border p-4 transition ${selected ? "border-katana-red bg-katana-red/10" : "border-[var(--customer-border)]"}`}
                    >
                      <div className="flex items-start justify-between gap-4">
                        <label className="flex min-w-0 cursor-pointer items-start gap-3">
                          <input
                            type="checkbox"
                            checked={selected}
                            onChange={(event) => toggleAddon(station.id, event.target.checked)}
                            className="mt-1 h-4 w-4 accent-katana-red focus-visible:ring-2 focus-visible:ring-katana-red"
                          />
                          <span>
                            <span className="block font-bold">{station.name === "Tuna by kilo" ? "Tuna" : "Salmon"}</span>
                            <span className="mt-1 block text-xs text-[var(--customer-muted)]">{minimum}–{maximum} kg</span>
                          </span>
                        </label>
                        <span className="shrink-0 text-sm font-bold text-katana-red">{money(rate)}/kg</span>
                      </div>
                      {selected && (
                        <div className="mt-4 flex flex-wrap items-center gap-2 pl-7">
                          <button
                            type="button"
                            aria-label={`Decrease ${item.name} add-on quantity`}
                            disabled={quantity <= minimum}
                            onClick={() => setForm((current) => ({
                              ...current,
                              package_quantities: { ...current.package_quantities, [item.id]: String(Math.max(minimum, quantity - step)) }
                            }))}
                            className="h-10 w-10 rounded-lg border border-[var(--customer-border)] text-lg font-bold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-katana-red disabled:opacity-40"
                          >−</button>
                          <input
                            type="number"
                            min={minimum}
                            max={maximum}
                            step={step}
                            inputMode="numeric"
                            aria-label={`${item.name} add-on quantity`}
                            value={quantityValue}
                            onChange={(event) => {
                              const value = event.target.value;
                              const parsed = Number(value);
                              setForm((current) => ({
                                ...current,
                                package_quantities: {
                                  ...current.package_quantities,
                                  [item.id]: value && Number.isFinite(parsed) ? String(Math.min(parsed, maximum)) : value
                                }
                              }));
                            }}
                            onBlur={() => {
                              if (!quantityValue) return;
                              const bounded = Math.max(minimum, Math.min(maximum, Number(quantityValue)));
                              setForm((current) => ({
                                ...current,
                                package_quantities: { ...current.package_quantities, [item.id]: String(bounded) }
                              }));
                            }}
                            className="customer-input h-10 w-24 py-1 text-center"
                          />
                          <button
                            type="button"
                            aria-label={`Increase ${item.name} add-on quantity`}
                            disabled={quantity >= maximum}
                            onClick={() => setForm((current) => ({
                              ...current,
                              package_quantities: { ...current.package_quantities, [item.id]: String(Math.min(maximum, quantity + step)) }
                            }))}
                            className="h-10 w-10 rounded-lg border border-[var(--customer-border)] text-lg font-bold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-katana-red disabled:opacity-40"
                          >+</button>
                          <span className="ml-1 text-sm text-[var(--customer-muted)]">{quantity} kg · {money(quantity * rate)}</span>
                        </div>
                      )}
                    </section>
                  );
                })}
              </div>
              <footer className="flex shrink-0 items-center justify-between gap-4 border-t border-[var(--customer-border)] p-5">
                <span className="font-bold">{money(addonSubtotalTotal)}</span>
                <button type="button" className="customer-btn-primary px-6 py-2.5" onClick={() => setCateringModal(null)}>Done</button>
              </footer>
            </div>
          </CateringModal>
        )}
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
              <p className="font-bold text-[var(--customer-text)]">{form.station_types.map((id) => allStations.find((station) => station.id === id)?.name).filter(Boolean).join(", ") || "No station selected"}</p>
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

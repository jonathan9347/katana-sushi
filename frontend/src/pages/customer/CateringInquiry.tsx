import { FormEvent, useMemo, useState } from "react";
import { PartyPopper, Send } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { api } from "../../lib/api";
import { todayManilaDateKey } from "../../lib/dateTime";
import BackToHome from "../../components/layout/BackToHome";

type CateringPackage = {
  id: string;
  stationType: string | null;
  name: string;
  description: string | null;
  minPax: number;
  maxPax: number;
  items: {
    pricingType?: "flat" | "range" | "quote";
    pricingModel?: "tier" | "per_unit" | "fixed" | "quote";
    flatPrice?: number;
    fixedPrice?: number;
    minPrice?: number;
    pricePerUnit?: number;
    pricePerKg?: number;
    unit?: string;
    minimum?: number;
    minKg?: number;
    step?: number;
    stepKg?: number;
    maximum?: number;
    maxKg?: number;
    fixedPax?: number;
    inclusions?: string[];
    galleryImages?: string[];
  } | null;
};

const stationLabels: Record<string, string> = {
  sushi_station: "Sushi Station",
  sashimi_bar: "Sashimi Bar",
  tempura_live: "Tempura Live"
};

function today() {
  return todayManilaDateKey();
}

function money(value: number) {
  return `PHP ${value.toLocaleString()}`;
}

function getOptionPrice(option: CateringPackage | undefined, quantityKg: number) {
  if (!option?.items || option.items.pricingType === "quote" || option.items.pricingModel === "quote") {
    return 0;
  }
  if (option.items.pricingModel === "per_unit" || option.items.pricingType === "range") {
    return (option.items.pricePerUnit ?? option.items.pricePerKg ?? 0) * quantityKg;
  }
  return option.items.fixedPrice ?? option.items.flatPrice ?? option.items.minPrice ?? 0;
}

export default function CateringInquiry() {
  const [form, setForm] = useState({
    event_date: today(),
    venue_address: "",
    package_type: "sushi_station",
    selected_package_id: "",
    sashimi_quantity_kg: "2",
    customer_name: "",
    customer_phone: "",
    customer_email: "",
    message: ""
  });
  const [notice, setNotice] = useState("");
  const [inquiryId, setInquiryId] = useState("");

  function setField(field: keyof typeof form, value: string) {
    setForm((current) => ({ ...current, [field]: value }));
  }

  const packagesQuery = useQuery({
    queryKey: ["catering-packages"],
    queryFn: async () => (await api.get<{ packages: CateringPackage[] }>("/api/catering/packages")).data.packages,
    retry: 1
  });
  const packages = packagesQuery.data ?? [];
  const stationTypes = useMemo(
    () => Array.from(new Set(packages.map((item) => item.stationType).filter((type): type is string => Boolean(type)))),
    [packages]
  );
  const stationOptions = packages.filter((item) => item.stationType === form.package_type);
  const selectedPackage =
    stationOptions.find((item) => item.id === form.selected_package_id) ?? stationOptions[0];
  const selectedStationName = stationLabels[form.package_type] ?? form.package_type;
  const quantityKg = Number(form.sashimi_quantity_kg) || 0;
  const estimatedPrice = getOptionPrice(selectedPackage, quantityKg);
  const selectedOptionText = selectedPackage
    ? form.package_type === "sashimi_bar"
      ? `${selectedPackage.name} - ${form.sashimi_quantity_kg} kg - ${money(estimatedPrice)}`
      : selectedPackage.items?.pricingModel === "fixed"
        ? `${selectedPackage.description ?? selectedPackage.name} - ${selectedPackage.items.fixedPax ?? selectedPackage.minPax} pax - ${money(estimatedPrice)}`
        : `${selectedPackage.description ?? selectedPackage.name} - ${money(estimatedPrice)}`
    : "No option selected";
  const minimumKg = selectedPackage?.items?.minimum ?? selectedPackage?.items?.minKg ?? 1;
  const stepKg = selectedPackage?.items?.step ?? selectedPackage?.items?.stepKg ?? 1;
  const maximumKg = selectedPackage?.items?.maximum ?? selectedPackage?.items?.maxKg;
  const derivedHeadcount = form.package_type === "sushi_station"
    ? selectedPackage?.minPax ?? null
    : form.package_type === "tempura_live"
      ? selectedPackage?.items?.fixedPax ?? selectedPackage?.minPax ?? null
      : null;

  function selectStation(stationType: string) {
    const options = packages.filter((item) => item.stationType === stationType);
    const nextPackage = options.length === 1
      ? options[0]
      : options.find((item) => item.id === form.selected_package_id) ?? options[0];
    setForm((current) => ({
      ...current,
      package_type: stationType,
      selected_package_id: nextPackage?.id ?? "",
      sashimi_quantity_kg: stationType === "sashimi_bar"
        ? String(nextPackage?.items?.minimum ?? nextPackage?.items?.minKg ?? 1)
        : current.sashimi_quantity_kg
    }));
  }

  function selectPackage(packageId: string) {
    const option = stationOptions.find((item) => item.id === packageId);
    setForm((current) => ({
      ...current,
      selected_package_id: packageId,
      sashimi_quantity_kg: form.package_type === "sashimi_bar"
        ? String(option?.items?.minimum ?? option?.items?.minKg ?? 1)
        : current.sashimi_quantity_kg
    }));
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setNotice("");

    if (!/^09\d{9}$/.test(form.customer_phone)) {
      setNotice("Use a valid Philippine mobile number starting with 09.");
      return;
    }

    try {
      const stationMessage = `Selected station: ${selectedStationName}. Option: ${selectedOptionText}.`;
      const response = await api.post<{ inquiry_id: string }>("/api/catering/inquiry", {
        customer_name: form.customer_name,
        customer_phone: form.customer_phone,
        customer_email: form.customer_email,
        event_date: form.event_date,
        venue_address: form.venue_address,
        headcount: derivedHeadcount,
        package_type: form.package_type || null,
        message: form.message ? `${stationMessage}\n\n${form.message}` : stationMessage
      });
      setInquiryId(response.data.inquiry_id);
    } catch {
      setNotice("Catering inquiry failed. Please check the details and try again.");
    }
  }

  if (inquiryId) {
    return (
      <main className="px-4 pt-3 pb-8 md:pb-10">
        <div className="customer-shell mb-4">
          <BackToHome />
        </div>
        <section className="mx-auto w-full max-w-md customer-card p-5 shadow-sm">
          <h1 className="text-xl font-bold text-slate-950">Inquiry Sent</h1>
          <p className="mt-3 rounded-md bg-emerald-50 px-3 py-2 text-sm font-semibold text-emerald-800">Inquiry ID: {inquiryId}</p>
          <p className="mt-4 text-sm text-slate-700">Our event team will contact you soon with the final quote and payment options.</p>
        </section>
      </main>
    );
  }

  return (
    <main className="px-3 pt-3 pb-4 md:px-4 md:pb-10">
      <div className="customer-shell mb-4">
        <BackToHome />
      </div>
      <section className="mx-auto grid max-w-6xl gap-4 lg:grid-cols-[0.75fr_1.25fr]">
        <div
          className="min-h-44 rounded-lg bg-cover bg-center p-4 text-white shadow-sm lg:min-h-full lg:p-6"
          style={{ backgroundImage: "linear-gradient(rgba(15,23,42,0.25), rgba(15,23,42,0.76)), url('/images/catering-banner.jpg')" }}
        >
          <div className="mt-10 lg:mt-72">
            <PartyPopper className="h-7 w-7 lg:h-9 lg:w-9" />
            <h1 className="mt-2 text-2xl font-black lg:text-3xl">Catering Inquiry</h1>
            <p className="mt-2 max-w-md text-sm font-medium text-slate-100">
              Plan your special event with sushi station, sashimi bar, or live tempura.
            </p>
          </div>
        </div>
        <form onSubmit={handleSubmit} className="w-full customer-card shadow-sm">
          <div className="border-b border-slate-200 px-4 py-3 md:px-5">
            <h2 className="text-xl font-bold text-slate-950 md:text-2xl">Inquiry Form</h2>
          </div>
          <div className="space-y-3 p-4 md:p-5">
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="block">
              <span className="mb-1 block text-sm font-semibold text-slate-700">Event Date *</span>
              <input className="customer-input" type="date" min={today()} value={form.event_date} onChange={(event) => setField("event_date", event.target.value)} required />
            </label>
            <label className="block">
              <span className="mb-1 block text-sm font-semibold text-slate-700">Venue Address *</span>
              <textarea className="min-h-24 customer-input" placeholder="Complete event venue address" value={form.venue_address} onChange={(event) => setField("venue_address", event.target.value)} required />
            </label>
          </div>

          <div>
            <p className="mb-2 text-xs font-bold uppercase tracking-wide text-slate-500">Station Interest</p>
            <div className="grid grid-cols-3 gap-2">
              {packagesQuery.isPending && <p className="col-span-3 text-sm text-slate-500" role="status">Loading stations...</p>}
              {packagesQuery.isError && (
                <div className="col-span-3 text-sm text-red-700" role="alert">
                  <p>Stations could not be loaded.</p>
                  <button type="button" className="mt-1 underline" onClick={() => void packagesQuery.refetch()}>Retry</button>
                </div>
              )}
              {stationTypes.map((stationType) => (
                <button
                  key={stationType}
                  type="button"
                  onClick={() => selectStation(stationType)}
                  className={`min-h-20 rounded-md border p-2 text-left transition ${form.package_type === stationType ? "border-red-700 bg-red-50" : "border-slate-200 bg-white"}`}
                >
                  <span className="block text-sm font-black text-slate-950">{stationLabels[stationType] ?? stationType}</span>
                  <span className="mt-1 block text-xs font-medium text-slate-500">
                    {packages.filter((item) => item.stationType === stationType).length} option(s) available
                  </span>
                </button>
              ))}
            </div>
          </div>

          <div className="rounded-md border border-slate-200 bg-slate-50 p-3 text-sm text-slate-700">
            <div className="flex items-center justify-between gap-3">
              <p className="font-bold text-slate-950">{selectedStationName}</p>
              {estimatedPrice > 0 && <p className="font-black text-red-700">{money(estimatedPrice)}</p>}
            </div>

            {stationOptions.length > 1 && form.package_type !== "sashimi_bar" && (
              <div className="mt-3 space-y-3">
                <label className="block">
                  <span className="mb-1 block text-xs font-bold uppercase tracking-wide text-slate-500">Pax option</span>
                  <select className="customer-input" value={selectedPackage?.id ?? ""} onChange={(event) => selectPackage(event.target.value)}>
                    {stationOptions.map((option) => (
                      <option key={option.id} value={option.id}>
                        {option.description ?? option.name} - {money(getOptionPrice(option, 0))}
                      </option>
                    ))}
                  </select>
                </label>
                <details className="rounded-md border border-slate-200 bg-white">
                  <summary className="cursor-pointer px-3 py-2 text-sm font-bold text-slate-950">Sushi station products</summary>
                  <ul className="grid gap-2 border-t border-slate-200 p-3 sm:grid-cols-2">
                    {(selectedPackage?.items?.inclusions ?? []).map((item) => (
                      <li key={item}>
                        <p className="font-bold text-slate-950">{item}</p>
                      </li>
                    ))}
                  </ul>
                </details>
              </div>
            )}

            {form.package_type === "sashimi_bar" && (
              <div className="mt-3 grid gap-3">
                <label className="block">
                  <span className="mb-1 block text-xs font-bold uppercase tracking-wide text-slate-500">Sashimi option</span>
                  <select className="customer-input" value={selectedPackage?.id ?? ""} onChange={(event) => selectPackage(event.target.value)}>
                    {stationOptions.map((option) => (
                      <option key={option.id} value={option.id}>{option.name} - {money(option.items?.pricePerUnit ?? option.items?.pricePerKg ?? 0)}/{option.items?.unit ?? "kg"}</option>
                    ))}
                  </select>
                </label>
                <label className="block">
                  <span className="mb-1 block text-xs font-bold uppercase tracking-wide text-slate-500">Quantity (kg)</span>
                  <input
                    className="customer-input"
                    type="number"
                    min={minimumKg}
                    max={maximumKg}
                    step={stepKg}
                    inputMode="numeric"
                    value={form.sashimi_quantity_kg}
                    onChange={(event) => {
                      const value = event.target.value;
                      const quantity = Number(value);
                      setField(
                        "sashimi_quantity_kg",
                        value && maximumKg !== undefined && Number.isFinite(quantity)
                          ? String(Math.min(quantity, maximumKg))
                          : value
                      );
                    }}
                    required
                  />
                </label>
              </div>
            )}

            {stationOptions.length === 1 && selectedPackage && form.package_type !== "sashimi_bar" && (
              <div className="mt-3 rounded-md border border-slate-200 bg-white p-3">
                <p className="font-bold text-slate-950">{selectedPackage.description ?? selectedPackage.name}</p>
                <p className="mt-1 text-sm">{getOptionPrice(selectedPackage, 0) > 0
                  ? `Fixed package - ${selectedPackage.items?.fixedPax ?? selectedPackage.minPax} pax - ${money(estimatedPrice)}`
                  : "Package selected automatically"}
                </p>
              </div>
            )}

            {selectedPackage && estimatedPrice > 0 && (
              <div className="mt-3 grid gap-1">
                <p>{selectedOptionText}</p>
              </div>
            )}
          </div>
          <label className="block">
            <span className="mb-1 block text-sm font-semibold text-slate-700">Your Name *</span>
            <input className="customer-input" value={form.customer_name} onChange={(event) => setField("customer_name", event.target.value)} required />
          </label>
          <label className="block">
            <span className="mb-1 block text-sm font-semibold text-slate-700">Phone *</span>
            <input className="customer-input" inputMode="tel" value={form.customer_phone} onChange={(event) => setField("customer_phone", event.target.value)} required />
          </label>
          <label className="block">
            <span className="mb-1 block text-sm font-semibold text-slate-700">Email *</span>
            <input className="customer-input" type="email" value={form.customer_email} onChange={(event) => setField("customer_email", event.target.value)} required />
          </label>
          <label className="block">
            <span className="mb-1 block text-sm font-semibold text-slate-700">Message / Special Requests</span>
            <textarea className="min-h-24 customer-input" value={form.message} onChange={(event) => setField("message", event.target.value)} />
          </label>
          <section className="rounded-md border border-slate-200 bg-white p-4 text-sm text-slate-700 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-200">
            <h3 className="font-bold uppercase text-slate-950 dark:text-slate-50">Catering Reservation Rules</h3>

            <ul className="mt-3 list-disc space-y-2 pl-5">
              <li>Reservations are subject to confirmation by our event team.</li>
              <li>Minimum reservation is for 10 pax.</li>
              <li>Reserved guests are charged based on the reserved headcount.</li>
              <li>Dining time is limited to 1 hour and 30 minutes upon serving of food.</li>
              <li>Please arrive on time to avoid delays.</li>
              <li>Reservations delayed by more than 15 minutes may be released to the next guest.</li>
            </ul>
          </section>
          <button
            className="flex w-full items-center justify-center gap-2 customer-btn-primary"
            disabled={packagesQuery.isPending || packagesQuery.isError || !selectedPackage}
          >
            <Send className="h-4 w-4" /> Submit Inquiry
          </button>
          {notice && <p className="rounded-md bg-red-50 px-3 py-2 text-sm font-medium text-red-700">{notice}</p>}
          </div>
        </form>
      </section>
    </main>
  );
}

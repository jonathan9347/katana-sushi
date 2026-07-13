import { FormEvent, useState } from "react";
import { Link } from "react-router-dom";
import { ArrowLeft, PartyPopper, Send } from "lucide-react";
import { api } from "../../lib/api";
import { todayManilaDateKey } from "../../lib/dateTime";

const sushiInclusions = [
  "California Maki",
  "Mango Roll",
  "Volcano Roll",
  "Tori Teriyaki Roll",
  "Salmon Cheese Maki",
  "Futo California",
  "Tamago Sushi",
  "Kani Sushi",
  "Salmon Nigiri"
];

const sushiOptions = [
  { id: "sushi_50_60", label: "50-60 pax", minCount: 50, price: 6000 },
  { id: "sushi_75_85", label: "75-85 pax", minCount: 75, price: 9000 },
  { id: "sushi_100_120", label: "100-120 pax", minCount: 100, price: 12000 },
  { id: "sushi_150_170", label: "150-170 pax", minCount: 150, price: 17500 },
  { id: "sushi_200_220", label: "200-220 pax", minCount: 200, price: 23000 }
];

const sashimiOptions = [
  { id: "sashimi_20_29", label: "20-29kg whole tuna", minCount: 20, priceLabel: "PHP 15,000-PHP 21,750", minPrice: 15000 },
  { id: "sashimi_30_40", label: "30-40kg whole tuna", minCount: 30, priceLabel: "PHP 22,500-PHP 30,000", minPrice: 22500 }
];

const stations = [
  { id: "sushi_station", name: "Sushi Station", summary: "Maki, sushi, and nigiri" },
  { id: "sashimi_bar", name: "Sashimi Bar", summary: "Whole tuna service" },
  { id: "tempura_live", name: "Tempura Live", summary: "Live station quote" }
];

function today() {
  return todayManilaDateKey();
}

function money(value: number) {
  return `PHP ${value.toLocaleString()}`;
}

export default function CateringInquiry() {
  const [form, setForm] = useState({
    event_date: today(),
    venue_address: "",
    package_type: "sushi_station",
    sushi_option: sushiOptions[0].id,
    sashimi_option: sashimiOptions[0].id,
    customer_name: "",
    customer_phone: "",
    customer_email: "",
    message: "",
    downpayment_acknowledged: false
  });
  const [notice, setNotice] = useState("");
  const [inquiryId, setInquiryId] = useState("");

  function setField(field: keyof typeof form, value: string) {
    setForm((current) => ({ ...current, [field]: value }));
  }

  const selectedStation = stations.find((item) => item.id === form.package_type) ?? stations[0];
  const selectedSushiOption = sushiOptions.find((item) => item.id === form.sushi_option) ?? sushiOptions[0];
  const selectedSashimiOption = sashimiOptions.find((item) => item.id === form.sashimi_option) ?? sashimiOptions[0];
  const selectedOptionText =
    form.package_type === "sushi_station"
      ? `${selectedSushiOption.label} - ${money(selectedSushiOption.price)}`
      : form.package_type === "sashimi_bar"
        ? `${selectedSashimiOption.label} - ${selectedSashimiOption.priceLabel}`
        : "Live tempura station - custom quote";
  const estimatedPrice =
    form.package_type === "sushi_station"
      ? selectedSushiOption.price
      : form.package_type === "sashimi_bar"
        ? selectedSashimiOption.minPrice
        : 0;
  const downpayment = estimatedPrice * 0.5;
  const derivedHeadcount =
    form.package_type === "sushi_station"
      ? selectedSushiOption.minCount
      : form.package_type === "sashimi_bar"
        ? selectedSashimiOption.minCount
        : 10;

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setNotice("");

    if (!/^09\d{9}$/.test(form.customer_phone)) {
      setNotice("Use a valid Philippine mobile number starting with 09.");
      return;
    }

    if (!form.downpayment_acknowledged) {
      setNotice("Please acknowledge the 50% downpayment requirement.");
      return;
    }

    try {
      const stationMessage = `Selected station: ${selectedStation.name}. Option: ${selectedOptionText}.`;
      const response = await api.post<{ inquiry_id: string }>("/api/catering/inquiry", {
        ...form,
        headcount: derivedHeadcount,
        package_type: form.package_type || null,
        message: form.message ? `${stationMessage}\n\n${form.message}` : stationMessage,
        downpayment_acknowledged: form.downpayment_acknowledged
      });
      setInquiryId(response.data.inquiry_id);
    } catch {
      setNotice("Catering inquiry failed. Please check the details and try again.");
    }
  }

  if (inquiryId) {
    return (
      <main className="px-4 py-8 md:py-10">
        <section className="mx-auto w-full max-w-md customer-card p-5 shadow-sm">
          <h1 className="text-xl font-bold text-slate-950">Inquiry Sent</h1>
          <p className="mt-3 rounded-md bg-emerald-50 px-3 py-2 text-sm font-semibold text-emerald-800">Inquiry ID: {inquiryId}</p>
          <p className="mt-4 text-sm text-slate-700">Our event team will contact you soon with the final quote and 50% downpayment instructions.</p>
          <Link className="mt-5 block rounded-md bg-red-700 px-4 py-3 text-center font-semibold text-white" to="/">
            Back to Home
          </Link>
        </section>
      </main>
    );
  }

  return (
    <main className="px-3 py-4 md:px-4 md:py-10">
      <section className="mx-auto grid max-w-6xl gap-4 lg:grid-cols-[0.75fr_1.25fr]">
        <div
          className="min-h-44 rounded-lg bg-cover bg-center p-4 text-white shadow-sm lg:min-h-full lg:p-6"
          style={{ backgroundImage: "linear-gradient(rgba(15,23,42,0.25), rgba(15,23,42,0.76)), url('/images/catering-banner.jpg')" }}
        >
          <Link to="/" className="inline-flex items-center gap-2 rounded-md bg-white/15 px-3 py-2 text-sm font-bold backdrop-blur">
            <ArrowLeft className="h-4 w-4" /> Back
          </Link>
          <div className="mt-10 lg:mt-72">
            <PartyPopper className="h-7 w-7 lg:h-9 lg:w-9" />
            <h1 className="mt-2 text-2xl font-black lg:text-3xl">Catering Inquiry</h1>
            <p className="mt-2 max-w-md text-sm font-medium text-slate-100">
              Plan your special event with sushi station, sashimi bar, or tempura live.
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
              {stations.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => setField("package_type", item.id)}
                  className={`min-h-20 rounded-md border p-2 text-left transition ${form.package_type === item.id ? "border-red-700 bg-red-50" : "border-slate-200 bg-white"}`}
                >
                  <span className="block text-sm font-black text-slate-950">{item.name}</span>
                  <span className="mt-1 block text-xs font-medium text-slate-500">{item.summary}</span>
                </button>
              ))}
            </div>
          </div>

          <div className="rounded-md border border-slate-200 bg-slate-50 p-3 text-sm text-slate-700">
            <div className="flex items-center justify-between gap-3">
              <p className="font-bold text-slate-950">{selectedStation.name}</p>
              {estimatedPrice > 0 && <p className="font-black text-red-700">{money(estimatedPrice)}{form.package_type === "sashimi_bar" ? "+" : ""}</p>}
            </div>

            {form.package_type === "sushi_station" && (
              <div className="mt-3 space-y-3">
                <label className="block">
                  <span className="mb-1 block text-xs font-bold uppercase tracking-wide text-slate-500">Pax option</span>
                  <select className="customer-input" value={form.sushi_option} onChange={(event) => setField("sushi_option", event.target.value)}>
                    {sushiOptions.map((option) => (
                      <option key={option.id} value={option.id}>{money(option.price)} - {option.label}</option>
                    ))}
                  </select>
                </label>
                <details className="rounded-md border border-slate-200 bg-white">
                  <summary className="cursor-pointer px-3 py-2 text-sm font-bold text-slate-950">Sushi station products</summary>
                  <ul className="grid gap-2 border-t border-slate-200 p-3 sm:grid-cols-2">
                    {sushiInclusions.map((item) => (
                      <li key={item}>
                        <p className="font-bold text-slate-950">{item}</p>
                      </li>
                    ))}
                  </ul>
                </details>
              </div>
            )}

            {form.package_type === "sashimi_bar" && (
              <label className="mt-3 block">
                <span className="mb-1 block text-xs font-bold uppercase tracking-wide text-slate-500">Whole tuna option</span>
                <select className="customer-input" value={form.sashimi_option} onChange={(event) => setField("sashimi_option", event.target.value)}>
                  {sashimiOptions.map((option) => (
                    <option key={option.id} value={option.id}>{option.priceLabel} - {option.label}</option>
                  ))}
                </select>
              </label>
            )}

            {form.package_type === "tempura_live" && (
              <p className="mt-2">Live tempura station pricing will be quoted by the event team.</p>
            )}

            {estimatedPrice > 0 && (
              <div className="mt-3 grid gap-1">
                <p>{selectedOptionText}</p>
                <p className="font-semibold text-red-700">50% downpayment: {money(downpayment)}{form.package_type === "sashimi_bar" ? " minimum" : ""}</p>
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
              <li>50% downpayment is required to confirm your reservation.</li>
              <li>Minimum reservation is for 10 pax.</li>
              <li>Reserved guests are charged based on the reserved headcount.</li>
              <li>Dining time is limited to 1 hour and 30 minutes upon serving of food.</li>
              <li>Please arrive on time to avoid delays.</li>
              <li>Reservations delayed by more than 15 minutes may be released to the next guest.</li>
            </ul>
          </section>
          <label className="flex items-start gap-3 rounded-md border border-amber-200 bg-amber-50 p-3 text-sm font-semibold text-amber-900">
            <input
              checked={form.downpayment_acknowledged}
              className="mt-1 h-4 w-4 accent-red-700"
              type="checkbox"
              onChange={(event) => setForm((current) => ({ ...current, downpayment_acknowledged: event.target.checked }))}
            />
            I understand that 50% downpayment is required to confirm this reservation.
          </label>
          <button className="flex w-full items-center justify-center gap-2 customer-btn-primary">
            <Send className="h-4 w-4" /> Submit Inquiry
          </button>
          {notice && <p className="rounded-md bg-red-50 px-3 py-2 text-sm font-medium text-red-700">{notice}</p>}
          </div>
        </form>
      </section>
    </main>
  );
}

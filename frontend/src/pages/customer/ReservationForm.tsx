import { FormEvent, useEffect, useMemo, useRef, useState } from "react";

import { Link } from "react-router-dom";
import { Banknote, CalendarCheck, Check, ChevronDown, Landmark, ShoppingCart, Smartphone } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { api, resolveImageUrl } from "../../lib/api";
import { getApiErrorMessage } from "../../lib/errors";
import { createPaymentIntent, verifyPayment, buildReservationReference, type PaymentMethod } from "../../lib/payment";
import { formatTime12, timeOptions, todayManilaDateKey } from "../../lib/dateTime";

type Product = {
  id: string;
  name: string;
  category: string;
  price: string | number;
  description?: string | null;
  image_url?: string | null;
  imageUrl?: string | null;
  image?: string | null;
  thumbnail?: string | null;
  is_available?: boolean;
};

type CartItem = {
  product_id: string;
  name: string;
  quantity: number;
  price: number;
};

type UnlimitedSettings = {
  id: string;
  price_per_person: number;
  time_limit_minutes: number;
  leftover_charge_percent: number;
};

type ReservationSuccess = {
  bookingId: string;
  downpaymentAmount: number;
  remainingBalance: number;
  paymentMethod: string;
};

const fallbackProducts: Product[] = [
  { id: "california", name: "California Maki", category: "Classic Roll", price: 290, description: "Crabstick, cucumber, mango" },
  { id: "mango", name: "Mango Roll", category: "Classic Roll", price: 220, description: "Crabstick, mango, sesame" },
  { id: "volcano", name: "Volcano Roll", category: "Special Roll", price: 220, description: "Crab, mango, cucumber" },
  { id: "tuna", name: "Tuna Mayo Roll", category: "Classic Roll", price: 220, description: "Tuna mayo, cucumber" },
  { id: "crunchy", name: "Crunchy Roll", category: "Fried Roll", price: 240, description: "Crisp tempura flakes" },
  { id: "salmon-nigiri", name: "Salmon Nigiri", category: "Nigiri", price: 170, description: "Fresh salmon over sushi rice" },
  { id: "iced-tea", name: "House Iced Tea", category: "Beverage", price: 90, description: "Cold brewed tea" }
];

function today() {
  return todayManilaDateKey();
}

function money(value: number) {
  return new Intl.NumberFormat("en-PH", { style: "currency", currency: "PHP", minimumFractionDigits: 2 }).format(value);
}

function categorySectionId(category: string) {
  return `reservation-menu-${category.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "") || "other"}`;
}

function getProductImageUrl(product: Product) {
  return resolveImageUrl(product.image_url ?? product.imageUrl ?? product.image ?? product.thumbnail);
}

export default function ReservationForm() {
  const [step, setStep] = useState(1);
  const [form, setForm] = useState({
    date: today(),
    time: "19:00",
    party_size: "4",
    customer_name: "",
    customer_phone: "",
    customer_email: "",
    special_requests: ""
  });
  const [reservationType, setReservationType] = useState<"dine_in" | "unlimited">("dine_in");

  // Customer-facing: only Dine-in / Unlimited. Keep layout readable in dark theme.
  const [cartItems, setCartItems] = useState<CartItem[]>([]);
  const [isMobileCartOpen, setIsMobileCartOpen] = useState(false);
  const [activeMenuCategory, setActiveMenuCategory] = useState("");
  const [selectedUnlimitedProductQuantities, setSelectedUnlimitedProductQuantities] = useState<Record<string, number>>({});

  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>("cash");
  const [paymentPlan, setPaymentPlan] = useState<"initial_only" | "full_payment">("initial_only");
  const [acknowledged, setAcknowledged] = useState(false);
  const [message, setMessage] = useState("");
  const [paymentNotice, setPaymentNotice] = useState("");
  const [isProcessingPayment, setIsProcessingPayment] = useState(false);
  const [success, setSuccess] = useState<ReservationSuccess | null>(null);
  const mobileCategoryTabsRef = useRef<HTMLDivElement | null>(null);

  const { data: productsData } = useQuery({
    queryKey: ["customer-menu-products"],
    queryFn: async () => (await api.get<{ products: Product[] }>("/api/products")).data.products,
    retry: 1
  });

  const { data: unlimitedSettingsData } = useQuery({
    queryKey: ["unlimited-settings"],
    queryFn: async () => (await api.get<{ settings: UnlimitedSettings }>("/api/unlimited/settings")).data.settings,
    retry: 1
  });

  const products = productsData?.length ? productsData : fallbackProducts;
  const productGroups = useMemo(() => {
    const groups = new Map<string, Product[]>();

    products.forEach((product) => {
      const category = product.category || "Other";
      groups.set(category, [...(groups.get(category) ?? []), product]);
    });

    return Array.from(groups.entries()).map(([category, items]) => ({
      category,
      products: items
    }));
  }, [products]);
  const unlimitedProducts = useMemo(() => {
    return products.filter((product) => {
      if (product.is_available === false) {
        return false;
      }

      const category = product.category.toLowerCase();
      const name = product.name.toLowerCase();
      const isBeverage = category.includes("beverage") || category.includes("drink");

      return !isBeverage || name.includes("iced tea");
    });
  }, [products]);
  const unlimitedProductGroups = useMemo(() => {
    const groups = new Map<string, Product[]>();

    unlimitedProducts.forEach((product) => {
      const category = product.category || "Other";
      groups.set(category, [...(groups.get(category) ?? []), product]);
    });

    return Array.from(groups.entries()).map(([category, items]) => ({
      category,
      products: items
    }));
  }, [unlimitedProducts]);
  const selectedUnlimitedProducts = useMemo(() => {
    return unlimitedProducts
      .filter((product) => (selectedUnlimitedProductQuantities[product.id] ?? 0) > 0)
      .map((product) => ({
        product_id: product.id,
        name: product.name,
        quantity: selectedUnlimitedProductQuantities[product.id] ?? 0,
        price: Number(product.price)
      }));
  }, [selectedUnlimitedProductQuantities, unlimitedProducts]);

  const selectedUnlimitedCount = useMemo(() => Object.values(selectedUnlimitedProductQuantities).reduce((a, b) => a + (b || 0), 0), [selectedUnlimitedProductQuantities]);

  const addProduct = (product: Product) => {
    if (!product.id || product.is_available === false) {
      return;
    }

    setCartItems((current) => {
      const existing = current.find((item) => item.product_id === product.id);
      if (existing) {
        return current.map((item) =>
          item.product_id === product.id ? { ...item, quantity: item.quantity + 1 } : item
        );
      }

      return [
        ...current,
        { product_id: product.id, name: product.name, quantity: 1, price: Number(product.price) }
      ];
    });
  };

  const updateCartQuantity = (productId: string, quantity: number) => {
    setCartItems((current) =>
      current
        .map((item) =>
          item.product_id === productId ? { ...item, quantity: Math.max(0, quantity) } : item
        )
        .filter((item) => item.quantity > 0)
    );
  };

  const removeCartItem = (productId: string) => {
    setCartItems((current) => current.filter((item) => item.product_id !== productId));
  };

  const toggleUnlimitedProduct = (productId: string) => {
    setSelectedUnlimitedProductQuantities((current) => {
      const exists = (current[productId] ?? 0) > 0;
      if (exists) {
        const next = { ...current };
        delete next[productId];
        return next;
      }

      return { ...current, [productId]: 1 };
    });
  };

  const updateUnlimitedQuantity = (productId: string, delta: number) => {
    setSelectedUnlimitedProductQuantities((current) => {
      const currentQty = current[productId] ?? 0;
      const nextQty = Math.max(0, currentQty + delta);
      if (nextQty === 0) {
        const next = { ...current };
        delete next[productId];
        return next;
      }

      return { ...current, [productId]: nextQty };
    });
  };

  const subtotal = useMemo(() => {
    if (reservationType === "unlimited") {
      const pricePerPerson = unlimitedSettingsData?.price_per_person ?? 599;
      return pricePerPerson * Number(form.party_size || 0);
    }

    return cartItems.reduce((sum, item) => sum + item.price * item.quantity, 0);
  }, [reservationType, unlimitedSettingsData, cartItems, form.party_size]);

  const tax = Number((subtotal * 0.12).toFixed(2));
  const totalPrice = Number((subtotal + tax).toFixed(2));
  const downpayment = Number((totalPrice * 0.5).toFixed(2));
  const remaining = Number((totalPrice - downpayment).toFixed(2));
  const cartItemCount = useMemo(() => cartItems.reduce((sum, item) => sum + item.quantity, 0), [cartItems]);
  const isFullPayment = paymentPlan === "full_payment";
  const paymentAmount = Number((isFullPayment ? totalPrice : downpayment).toFixed(2));

  const isValidPhone = useMemo(() => /^09\d{9}$/.test(form.customer_phone), [form.customer_phone]);

  function setField(field: keyof typeof form, value: string) {
    setForm((current) => ({ ...current, [field]: value }));
  }

  useEffect(() => {
    window.scrollTo({ top: 0, behavior: "smooth" });
  }, [step]);

  useEffect(() => {
    if (productGroups.length === 0) {
      setActiveMenuCategory("");
      return;
    }

    setActiveMenuCategory((current) =>
      productGroups.some((group) => group.category === current) ? current : productGroups[0].category
    );
  }, [productGroups]);

  useEffect(() => {
    if (step !== 2 || reservationType !== "dine_in" || productGroups.length === 0) {
      return;
    }

    function updateActiveCategory() {
      const marker = window.innerWidth >= 768 ? 170 : 126;
      let activeCategory = productGroups[0]?.category ?? "";

      productGroups.forEach((group) => {
        const section = document.getElementById(categorySectionId(group.category));
        if (!section) {
          return;
        }

        const rect = section.getBoundingClientRect();
        if (rect.top <= marker && rect.bottom > marker) {
          activeCategory = group.category;
        } else if (rect.top <= marker) {
          activeCategory = group.category;
        }
      });

      setActiveMenuCategory(activeCategory);
    }

    updateActiveCategory();
    window.addEventListener("scroll", updateActiveCategory, { passive: true });
    window.addEventListener("resize", updateActiveCategory);

    return () => {
      window.removeEventListener("scroll", updateActiveCategory);
      window.removeEventListener("resize", updateActiveCategory);
    };
  }, [step, reservationType, productGroups]);

  useEffect(() => {
    if (step !== 2 || reservationType !== "dine_in" || !activeMenuCategory || window.innerWidth >= 768) {
      return;
    }

    const tabsContainer = mobileCategoryTabsRef.current;
    const activeTab = tabsContainer?.querySelector<HTMLButtonElement>(
      `[data-category-tab="${categorySectionId(activeMenuCategory)}"]`
    );

    if (!tabsContainer || !activeTab) {
      return;
    }

    const nextScrollLeft = activeTab.offsetLeft - tabsContainer.clientWidth / 2 + activeTab.clientWidth / 2;
    tabsContainer.scrollTo({ left: Math.max(0, nextScrollLeft), behavior: "smooth" });
  }, [activeMenuCategory, step, reservationType]);

  function canProceedToStep2() {
    return (
      form.customer_name.trim().length > 0 &&
      isValidPhone &&
      form.customer_email.trim().length > 0 &&
      form.date >= today()
    );
  }

  function canProceedToStep3() {
    if (reservationType === "unlimited") {
      return Boolean(unlimitedSettingsData) && selectedUnlimitedCount > 0;
    }

    return cartItems.length > 0;
  }

  function goBackStep() {
    setStep((current) => Math.max(1, current - 1));
  }

  function goNextStep() {
    if (step === 1 && !canProceedToStep2()) {
      setMessage("Please complete your basic information before continuing.");
      return;
    }

    if (step === 2 && !canProceedToStep3()) {
      setMessage(reservationType === "unlimited" ? "Select at least one unlimited product before continuing." : "Add at least one item to your cart before continuing.");
      return;
    }

    setMessage("");
    setStep((current) => current + 1);
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setMessage("");
    setPaymentNotice("");
    setIsProcessingPayment(true);

    if (!acknowledged) {
      setMessage("Please agree to the reservation rules before paying.");
      setIsProcessingPayment(false);
      return;
    }

    try {
      const reservationReference = buildReservationReference(reservationType === "unlimited" ? "KTN-UNL" : "KTN-DINE");
      const paymentIntent = await createPaymentIntent({
        amount: paymentAmount,
        paymentMethod,
        bookingId: reservationReference,
        reservationType: "dine_in",
        description: `Reservation payment for ${reservationType === "unlimited" ? "Unlimited plan" : "Dine-in"}`
      });

      if (!paymentIntent.success) {
        throw new Error(paymentIntent.message || "Unable to start payment.");
      }

      const verification = await verifyPayment({
        referenceId: paymentIntent.referenceId,
        bookingId: reservationReference,
        gatewayData: {
          amount: paymentAmount,
          paymentMethod,
          paymentPlan,
          reservationType: "dine_in"
        }
      });

      if (!verification.success || verification.status !== "paid") {
        throw new Error(verification.message || "Payment verification failed.");
      }

      const response = await api.post<{ booking_id: string; downpayment_amount: number; remaining_balance: number }>('/api/reservations/dine-in', {
        customer_name: form.customer_name,
        customer_phone: form.customer_phone,
        customer_email: form.customer_email,
        date: form.date,
        time: form.time,
        party_size: Number(form.party_size),
        reservation_type: reservationType,
        selected_products: reservationType === "dine_in" ? cartItems : selectedUnlimitedProducts,
        unlimited_package_id: reservationType === "unlimited" ? unlimitedSettingsData?.id : undefined,
        payment_plan: paymentPlan,
        payment_method: paymentMethod,
        payment_transaction_id: verification.transactionId,
        booking_id: reservationReference,
        special_requests: form.special_requests
      });

      setSuccess({
        bookingId: response.data.booking_id,
        downpaymentAmount: response.data.downpayment_amount,
        remainingBalance: response.data.remaining_balance,
        paymentMethod
      });
      setPaymentNotice(paymentIntent.instructions ?? "Payment completed with fake gateway.");
    } catch (error) {
      setMessage(getApiErrorMessage(error, "Payment failed. Please try again or choose another payment method."));
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
                <CalendarCheck className="h-5 w-5 text-emerald-400" /> Reservation Confirmed
              </h1>
            </div>
            <div className="space-y-5 p-6 text-sm text-neutral-300">
              <p className="rounded-xl border border-emerald-500/20 bg-emerald-500/10 px-4 py-3 font-semibold text-emerald-300">Booking ID: {success.bookingId}</p>
              <p>{paymentPlan === "full_payment" ? "Full payment" : "Downpayment"}: <span className="font-semibold text-emerald-300">{money(success.downpaymentAmount)} PAID</span></p>
              {paymentPlan === "initial_only" ? (
                <p>Remaining balance: <span className="font-semibold text-white">{money(success.remainingBalance)}</span> (pay at restaurant)</p>
              ) : (
                <p className="font-semibold text-white">No remaining balance due.</p>
              )}
              <p>Status: <span className="font-semibold text-amber-300">PENDING APPROVAL</span></p>
              <p>We will confirm your reservation within 24 hours.</p>
              <div className="grid gap-3">
                <Link className="customer-btn-primary text-center" to={`/reservation/status?bookingId=${success.bookingId}`}>
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
      <section className="mx-auto flex min-h-[calc(100vh-4rem)] w-full items-start justify-center md:max-w-7xl md:items-center md:px-6">
        <div className="w-full md:max-w-7xl">
          <section className="overflow-visible border-0 bg-transparent shadow-none md:rounded-2xl md:border md:border-katana-border md:bg-katana-surface/90 md:shadow-card md:backdrop-blur">
            <div className="border-b border-katana-border px-4 py-5 md:px-6">
              <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
                <div>
                  <p className="customer-kicker">Step {step} of 3</p>
                  <h1 className="mt-2 font-display text-2xl font-bold text-white">{step === 1 ? "Basic Information" : step === 2 ? "Select Your Order" : "Payment"}</h1>
                </div>
                <div className="rounded-full border border-katana-border bg-katana-elevated px-4 py-2 text-sm font-semibold text-neutral-300">
                  {reservationType === "dine_in" ? "Regular / À la carte" : "Unlimited plan"}
                </div>
              </div>
              <div className="mt-6">
                <div className="flex items-center justify-center gap-0 md:gap-4 md:grid md:grid-cols-3">
                  {[
                    { label: "Information", active: step >= 1 },
                    { label: "Order", active: step >= 2 },
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

            <form onSubmit={handleSubmit} className="space-y-6 px-3 py-5 pb-28 md:p-6 md:pb-36">
              {step === 1 && (
                <div className="grid gap-4 lg:grid-cols-2">
                  <label className="block">
                    <span className="customer-label">Date *</span>
                    <input className="customer-input" type="date" min={today()} value={form.date} onChange={(event) => setField("date", event.target.value)} required />
                  </label>
                  <label className="block">
                    <span className="customer-label">Time *</span>
                    <select className="customer-input" value={form.time} onChange={(event) => setField("time", event.target.value)} required>
                      {timeOptions.map((time) => (
                        <option key={time} value={time}>{formatTime12(time)}</option>
                      ))}
                    </select>
                  </label>
                  <label className="block">
                    <span className="customer-label">Number of Guests *</span>
                    <select className="customer-input" value={form.party_size} onChange={(event) => setField("party_size", event.target.value)} required>
                      {Array.from({ length: 12 }, (_, index) => index + 1).map((count) => (
                        <option key={count} value={count}>{count} people</option>
                      ))}
                    </select>
                  </label>
                  <label className="block">
                    <span className="customer-label">Your Name *</span>
                    <input className="customer-input" value={form.customer_name} onChange={(event) => setField("customer_name", event.target.value)} required />
                  </label>
                  <label className="block">
                    <span className="customer-label">Phone Number *</span>
                    <input className="customer-input" inputMode="tel" placeholder="09123456789" value={form.customer_phone} onChange={(event) => setField("customer_phone", event.target.value)} required />
                  </label>
                  <label className="block">
                    <span className="customer-label">Email *</span>
                    <input className="customer-input" type="email" value={form.customer_email} onChange={(event) => setField("customer_email", event.target.value)} required />
                  </label>
                  <label className="lg:col-span-2 block">
                    <span className="customer-label">Special Requests</span>
                    <textarea className="min-h-24 customer-input" value={form.special_requests} onChange={(event) => setField("special_requests", event.target.value)} />
                  </label>
                </div>
              )}

              {step === 2 && (
                <div>
                  <div className="mb-6 flex gap-3">
                    <button type="button" onClick={() => setReservationType("dine_in")} className={`rounded-xl border px-4 py-3 text-sm font-bold ${reservationType === "dine_in" ? "border-katana-red bg-katana-red text-white" : "border-katana-border bg-katana-elevated text-[var(--customer-text)]"}`}>
                      Regular Order
                    </button>
                    <button type="button" onClick={() => setReservationType("unlimited")} className={`rounded-xl border px-4 py-3 text-sm font-bold ${reservationType === "unlimited" ? "border-katana-red bg-katana-red text-white" : "border-katana-border bg-katana-elevated text-neutral-300"}`}>
                      Unlimited Eat-All-You-Can
                    </button>
                  </div>

                  {reservationType === "dine_in" ? (
                    <div className="grid gap-5 md:grid-cols-[220px_minmax(0,1fr)]">
                      <nav className="hidden md:block md:sticky md:top-24 md:self-start">
                        <div className="rounded-xl border border-katana-border bg-katana-elevated p-3">
                          <p className="px-2 pb-3 text-xs font-bold uppercase tracking-[0.18em] text-katana-muted">Categories</p>
                          <div className="grid gap-2">
                            {productGroups.map((group) => (
                              <button
                                key={group.category}
                                type="button"
                                onClick={() => {
                                  setActiveMenuCategory(group.category);
                                  document.getElementById(categorySectionId(group.category))?.scrollIntoView({ behavior: "smooth", block: "start" });
                                }}
                                className={`flex items-center justify-between rounded-lg border px-3 py-3 text-left text-xs font-bold uppercase transition ${
                                  activeMenuCategory === group.category
                                    ? "border-katana-red bg-katana-red text-white"
                                    : "border-katana-border bg-katana-surface text-neutral-300 hover:border-katana-red hover:text-white"
                                }`}
                              >
                                <span>{group.category}</span>
                                <span className="text-[11px] opacity-70">{group.products.length}</span>
                              </button>
                            ))}
                          </div>
                        </div>
                      </nav>
                      <div className="min-w-0">
                        <div className="mb-4 flex items-center justify-between rounded-lg border border-katana-border bg-katana-elevated p-4">
                          <div>
                            <p className="text-sm font-bold uppercase text-white">Regular order</p>
                            <p className="text-xs text-neutral-400">{products.length} menu products grouped by category.</p>
                          </div>
                          <span className="rounded-full border border-katana-border bg-katana-surface px-3 py-1 text-xs font-semibold text-neutral-200">{cartItems.length} item{cartItems.length === 1 ? "" : "s"}</span>
                        </div>
                        <div className="sticky top-0 z-30 -mx-3 mb-5 border-b border-katana-border bg-katana-black/95 px-3 pb-3 pt-2 backdrop-blur md:hidden">
                          <div ref={mobileCategoryTabsRef} className="overflow-x-auto pb-2">
                            <div className="flex min-w-max gap-2">
                              {productGroups.map((group) => (
                                <button
                                  key={group.category}
                                  type="button"
                                  data-category-tab={categorySectionId(group.category)}
                                  onClick={() => {
                                    setActiveMenuCategory(group.category);
                                    document.getElementById(categorySectionId(group.category))?.scrollIntoView({ behavior: "smooth", block: "start" });
                                  }}
                                  className={`rounded-full border px-4 py-2 text-xs font-bold uppercase transition hover:border-katana-red hover:bg-katana-red hover:text-white md:border-katana-border md:bg-katana-surface md:text-neutral-300 ${
                                    activeMenuCategory === group.category
                                      ? "border-katana-red bg-katana-red text-white"
                                      : "border-katana-border bg-katana-surface text-neutral-300"
                                  }`}
                                >
                                  {group.category}
                                </button>
                              ))}
                            </div>
                          </div>
                        </div>

                        <div className="space-y-6">
                          {productGroups.map((group) => (
                            <section key={group.category} id={categorySectionId(group.category)} className="scroll-mt-28 md:scroll-mt-24">
                              <div className="mb-3 flex items-center justify-between gap-3">
                                <h3 className="text-xs font-black uppercase tracking-[0.16em] text-neutral-300">{group.category}</h3>
                                <span className="h-px flex-1 bg-katana-border" />
                                <span className="text-xs font-semibold text-neutral-500">{group.products.length}</span>
                              </div>
                              <div className="space-y-3 md:grid md:grid-cols-2 md:gap-4 md:space-y-0 lg:grid-cols-3 xl:grid-cols-4">
                                {group.products.map((product) => {
                                  const disabled = product.is_available === false;
                                  const imageSrc = getProductImageUrl(product);

                                  return (
                                    <article key={product.id} className={`grid h-[160px] grid-cols-[104px_minmax(0,1fr)] overflow-hidden rounded-lg border sm:h-[132px] sm:grid-cols-[112px_minmax(0,1fr)] md:flex md:h-[320px] md:flex-col md:rounded-xl ${disabled ? "border-katana-border bg-katana-surface opacity-60" : "border-katana-border bg-katana-elevated"}`}>
                                      <div className="h-[160px] w-[104px] bg-katana-surface sm:h-[132px] sm:w-[112px] md:h-40 md:w-full">
                                        {imageSrc ? (
                                          <img src={imageSrc} alt={product.name} className="h-full w-full object-cover" />
                                        ) : (
                                          <div className="flex h-full items-center justify-center px-3 text-center text-xs font-bold uppercase tracking-[0.14em] text-katana-red">
                                            No image
                                          </div>
                                        )}
                                      </div>
                                      <div className="flex min-h-0 min-w-0 flex-col justify-between gap-2 p-3 md:flex-1 md:p-4">
                                        <div className="min-w-0">
                                          <h4 className="line-clamp-2 text-sm font-bold leading-snug text-white sm:text-base">{product.name}</h4>
                                          <p className="mt-1 line-clamp-1 text-xs leading-snug text-neutral-400 sm:line-clamp-2 sm:text-sm md:line-clamp-2">{product.description ?? "House specialty"}</p>
                                          <p className="mt-2 text-sm font-black text-katana-red">{money(Number(product.price))}</p>
                                        </div>
                                        <button
                                          type="button"
                                          onClick={() => addProduct(product)}
                                          disabled={disabled}
                                          className={`h-9 w-full shrink-0 rounded-md px-2 text-xs font-bold leading-none ${disabled ? "cursor-not-allowed bg-neutral-800 text-neutral-500" : "bg-red-700 text-white hover:bg-red-800"}`}
                                        >
                                          {disabled ? "Unavailable" : "Add to cart"}
                                        </button>
                                      </div>
                                    </article>
                                  );
                                })}
                              </div>
                            </section>
                          ))}
                        </div>
                      </div>

                      <div className="fixed bottom-[76px] left-0 right-0 z-50 px-3 md:hidden">
                        {isMobileCartOpen && (
                          <div className="mb-2 max-h-[52vh] overflow-y-auto rounded-2xl border border-katana-border bg-katana-elevated p-4 shadow-card">
                            <div className="mb-3 flex items-center justify-between gap-3">
                              <h2 className="text-sm font-bold uppercase text-white">Your Cart</h2>
                              <p className="text-sm font-black text-katana-red">{money(subtotal)}</p>
                            </div>
                            {cartItems.length === 0 ? (
                              <p className="text-sm text-neutral-300">Add at least one menu item to continue.</p>
                            ) : (
                              <div className="space-y-3">
                                {cartItems.map((item) => (
                                  <div key={item.product_id} className="rounded-lg border border-katana-border bg-katana-surface p-3 shadow-sm">
                                    <div className="flex items-center justify-between gap-3">
                                      <div className="min-w-0">
                                        <p className="line-clamp-2 font-bold text-white">{item.name}</p>
                                        <p className="text-sm text-neutral-300">{money(item.price * item.quantity)}</p>
                                      </div>
                                      <div className="flex shrink-0 items-center gap-2">
                                        <button type="button" className="flex h-8 w-8 items-center justify-center rounded-full border border-katana-border text-sm font-bold text-neutral-200" onClick={() => updateCartQuantity(item.product_id, item.quantity - 1)}>-</button>
                                        <span className="w-6 text-center text-sm font-bold text-white">{item.quantity}</span>
                                        <button type="button" className="flex h-8 w-8 items-center justify-center rounded-full border border-katana-border text-sm font-bold text-neutral-200" onClick={() => updateCartQuantity(item.product_id, item.quantity + 1)}>+</button>
                                      </div>
                                    </div>
                                    <button type="button" onClick={() => removeCartItem(item.product_id)} className="mt-3 text-xs font-semibold text-katana-red underline">Remove</button>
                                  </div>
                                ))}
                              </div>
                            )}
                            <div className="mt-4 grid grid-cols-2 gap-3 border-t border-katana-border pt-4">
                              <button
                                type="button"
                                onClick={goBackStep}
                                className="rounded-md border border-slate-300 bg-white px-4 py-3 text-sm font-bold text-slate-800"
                              >
                                Back
                              </button>
                              <button
                                type="button"
                                onClick={goNextStep}
                                className="rounded-md bg-red-700 px-4 py-3 text-sm font-bold text-white hover:bg-red-800"
                              >
                                Next
                              </button>
                            </div>
                          </div>
                        )}
                        <button
                          type="button"
                          onClick={() => setIsMobileCartOpen((current) => !current)}
                          className="flex min-h-14 w-full items-center justify-between rounded-2xl border border-katana-border bg-katana-surface px-4 py-3 text-left shadow-card"
                        >
                          <span className="flex items-center gap-3">
                            <span className="flex h-9 w-9 items-center justify-center rounded-full bg-katana-red text-white">
                              <ShoppingCart className="h-4 w-4" />
                            </span>
                            <span>
                              <span className="block text-sm font-bold uppercase text-white">Your Cart</span>
                              <span className="block text-xs font-semibold text-neutral-400">{cartItemCount} item{cartItemCount === 1 ? "" : "s"}</span>
                            </span>
                          </span>
                          <span className="flex items-center gap-3">
                            <span className="text-sm font-black text-katana-red">{money(subtotal)}</span>
                            <ChevronDown className={`h-4 w-4 text-neutral-300 transition ${isMobileCartOpen ? "rotate-180" : ""}`} />
                          </span>
                        </button>
                      </div>
                      <div className="fixed bottom-6 left-1/2 z-50 hidden w-[min(960px,calc(100vw-3rem))] -translate-x-1/2 md:block">
                        {isMobileCartOpen && (
                          <div className="mb-3 max-h-[42vh] overflow-y-auto rounded-2xl border border-katana-border bg-katana-elevated p-5 shadow-card">
                            <div className="mb-4 flex items-center justify-between gap-4">
                              <div>
                                <h2 className="text-sm font-bold uppercase text-white">Your Cart</h2>
                                <p className="mt-1 text-xs text-neutral-400">{cartItemCount} item{cartItemCount === 1 ? "" : "s"} selected</p>
                              </div>
                              <p className="text-lg font-black text-katana-red">{money(subtotal)}</p>
                            </div>
                            {cartItems.length === 0 ? (
                              <p className="text-sm text-neutral-300">Add at least one menu item to continue.</p>
                            ) : (
                              <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
                                {cartItems.map((item) => (
                                  <div key={item.product_id} className="rounded-lg border border-katana-border bg-katana-surface p-3 shadow-sm">
                                    <div className="flex items-start justify-between gap-3">
                                      <div className="min-w-0">
                                        <p className="line-clamp-2 font-bold text-white">{item.name}</p>
                                        <p className="mt-1 text-sm text-neutral-300">{money(item.price * item.quantity)}</p>
                                      </div>
                                      <div className="flex shrink-0 items-center gap-2">
                                        <button type="button" className="flex h-8 w-8 items-center justify-center rounded-full border border-katana-border text-sm font-bold text-neutral-200" onClick={() => updateCartQuantity(item.product_id, item.quantity - 1)}>-</button>
                                        <span className="w-6 text-center text-sm font-bold text-white">{item.quantity}</span>
                                        <button type="button" className="flex h-8 w-8 items-center justify-center rounded-full border border-katana-border text-sm font-bold text-neutral-200" onClick={() => updateCartQuantity(item.product_id, item.quantity + 1)}>+</button>
                                      </div>
                                    </div>
                                    <button type="button" onClick={() => removeCartItem(item.product_id)} className="mt-3 text-xs font-semibold text-katana-red underline">Remove</button>
                                  </div>
                                ))}
                              </div>
                            )}
                            <div className="mt-5 flex justify-end gap-3 border-t border-katana-border pt-4">
                              <button
                                type="button"
                                onClick={goBackStep}
                                className="rounded-md border border-slate-300 bg-white px-5 py-3 text-sm font-bold text-slate-800"
                              >
                                Back
                              </button>
                              <button
                                type="button"
                                onClick={goNextStep}
                                className="rounded-md bg-red-700 px-5 py-3 text-sm font-bold text-white hover:bg-red-800"
                              >
                                Next
                              </button>
                            </div>
                          </div>
                        )}
                        <button
                          type="button"
                          onClick={() => setIsMobileCartOpen((current) => !current)}
                          className="flex min-h-16 w-full items-center justify-between rounded-2xl border border-katana-border bg-katana-surface px-5 py-4 text-left shadow-card"
                        >
                          <span className="flex items-center gap-3">
                            <span className="flex h-10 w-10 items-center justify-center rounded-full bg-katana-red text-white">
                              <ShoppingCart className="h-5 w-5" />
                            </span>
                            <span>
                              <span className="block text-sm font-bold uppercase text-white">Your Cart</span>
                              <span className="block text-xs font-semibold text-neutral-400">{cartItemCount} item{cartItemCount === 1 ? "" : "s"} in reservation</span>
                            </span>
                          </span>
                          <span className="flex items-center gap-4">
                            <span className="text-base font-black text-katana-red">{money(subtotal)}</span>
                            <ChevronDown className={`h-5 w-5 text-neutral-300 transition ${isMobileCartOpen ? "rotate-180" : ""}`} />
                          </span>
                        </button>
                      </div>
                    </div>
                  ) : (
                    <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_300px]">
                      <div className="min-w-0">
                        <div className="mb-4 grid gap-2 sm:grid-cols-3">
                          <div className="rounded-lg border border-katana-border bg-katana-elevated p-4">
                            <p className="text-xs font-semibold uppercase text-neutral-400">Unlimited</p>
                            <p className="mt-1 text-lg font-black text-white">Eat-All-You-Can</p>
                          </div>
                          <div className="rounded-lg border border-katana-border bg-katana-elevated p-4">
                            <p className="text-xs font-semibold uppercase text-neutral-400">Price per person</p>
                            <p className="mt-1 text-lg font-bold text-katana-red">{money(unlimitedSettingsData?.price_per_person ?? 599)}</p>
                          </div>
                          <div className="rounded-lg border border-katana-border bg-katana-elevated p-4">
                            <p className="text-xs font-semibold uppercase text-neutral-400">Selected</p>
                            <p className="mt-1 text-lg font-bold text-white">{selectedUnlimitedCount} item{selectedUnlimitedCount === 1 ? "" : "s"}</p>
                          </div>
                        </div>

                        <div className="space-y-5">
                          {unlimitedProductGroups.map((group) => (
                            <section key={group.category}>
                              <div className="mb-2 flex items-center justify-between gap-3">
                                <h3 className="text-xs font-black uppercase tracking-[0.16em] text-neutral-300">{group.category}</h3>
                                <span className="h-px flex-1 bg-katana-border" />
                                <span className="text-xs font-semibold text-neutral-500">{group.products.length}</span>
                              </div>
                              <div className="grid grid-cols-2 gap-2 md:grid-cols-3 xl:grid-cols-4">
                                {group.products.map((product) => {
                                  const selected = (selectedUnlimitedProductQuantities[product.id] ?? 0) > 0;
                                  const imageSrc = getProductImageUrl(product);

                                  return (
                                    <button
                                      key={product.id}
                                      type="button"
                                      onClick={() => toggleUnlimitedProduct(product.id)}
                                      className={`flex min-h-[94px] flex-col justify-between rounded-lg border p-0 text-left transition ${selected ? "border-katana-red bg-katana-red/15" : "border-katana-border bg-katana-elevated hover:border-neutral-500"}`}
                                    >
                                      {imageSrc ? (
                                        <div className="h-28 w-full overflow-hidden rounded-t-lg bg-katana-surface">
                                          <img src={imageSrc} alt={product.name} className="h-full w-full object-contain" />
                                        </div>
                                      ) : null}

                                      <div className="flex items-center justify-between gap-3 p-3">
                                        <div className="min-w-0">
                                          <div className="line-clamp-2 text-sm font-bold leading-snug text-white">{product.name}</div>
                                          <div className="mt-1 text-xs text-neutral-400">{product.description ?? "Included in unlimited"}</div>
                                        </div>

                                        <div className="flex items-center gap-2">
                                          <button
                                            type="button"
                                            onClick={(e) => { e.stopPropagation(); updateUnlimitedQuantity(product.id, -1); }}
                                            className="h-8 w-8 rounded-md border border-katana-border bg-katana-surface text-white"
                                          >
                                            -
                                          </button>
                                          <span className="min-w-[28px] text-center font-semibold text-white">{selectedUnlimitedProductQuantities[product.id] ?? 0}</span>
                                          <button
                                            type="button"
                                            onClick={(e) => { e.stopPropagation(); updateUnlimitedQuantity(product.id, 1); }}
                                            className="h-8 w-8 rounded-md border border-katana-border bg-katana-red text-white"
                                          >
                                            +
                                          </button>
                                        </div>
                                      </div>
                                    </button>
                                  );
                                })}
                              </div>
                            </section>
                          ))}
                        </div>
                      </div>

                      <aside className="rounded-xl border border-katana-border bg-katana-elevated p-4 xl:sticky xl:top-24 xl:self-start">
                        <h2 className="text-sm font-bold uppercase text-white">Unlimited Package</h2>
                        <div className="mt-4 space-y-3 text-sm text-[var(--customer-text)]">
                          <p>{form.party_size} guests · Iced Tea only for beverages</p>
                          {selectedUnlimitedCount === 0 ? (
                            <p>Select at least one product to continue.</p>
                          ) : (
                            <div className="space-y-2">
                              {selectedUnlimitedProducts.map((item) => (
                                <div key={item.product_id} className="flex items-center justify-between rounded-lg border border-katana-border bg-katana-surface px-3 py-2 font-semibold text-white">
                                  <div className="min-w-0">
                                    <div className="truncate">{item.name}</div>
                                    <div className="text-xs text-neutral-400">{money(item.price)} each</div>
                                  </div>
                                  <div className="flex items-center gap-2">
                                    <button type="button" onClick={() => updateUnlimitedQuantity(item.product_id, -1)} className="h-7 w-7 rounded-md border border-katana-border bg-katana-surface text-white">-</button>
                                    <span className="w-6 text-center font-bold text-white">{item.quantity}</span>
                                    <button type="button" onClick={() => updateUnlimitedQuantity(item.product_id, 1)} className="h-7 w-7 rounded-md border border-katana-border bg-katana-red text-white">+</button>
                                  </div>
                                </div>
                              ))}
                            </div>
                          )}
                        </div>
                        <div className="mt-4 rounded-lg border border-katana-border bg-katana-surface p-3">
                          <p className="text-xs font-semibold uppercase text-neutral-300">Rules</p>
                          <ul className="mt-2 space-y-1 text-xs text-neutral-300">
                            <li>90 minutes dining time.</li>
                            <li>No leftovers; extra charges apply.</li>
                            <li>One table, same package for all guests.</li>
                          </ul>
                        </div>
                      </aside>
                    </div>
                  )}
                </div>
              )}

              {step === 3 && (
                <div className="grid gap-6 lg:grid-cols-[1.2fr_0.8fr]">
                  <div>
                      <div className="rounded-lg border border-katana-border bg-katana-elevated p-5">
                      <h2 className="text-sm font-bold uppercase text-white">Order Summary</h2>

                      <div className="mt-4 space-y-3 text-sm text-neutral-300">
                        {reservationType === "dine_in" ? (
                          cartItems.map((item) => (
                            <div key={item.product_id} className="flex items-center justify-between">
                              <p>{item.quantity}x {item.name}</p>
                              <p>{money(item.price * item.quantity)}</p>
                            </div>
                          ))
                        ) : (
                          <div className="space-y-2">
                            <p className="font-semibold">Unlimited dining package</p>
                            <p>{form.party_size} pax × {money(unlimitedSettingsData?.price_per_person ?? 599)}</p>
                            <div className="pt-2 text-xs text-neutral-400">
                              <p className="font-semibold uppercase text-neutral-300">Selected products</p>
                              <p className="mt-1">{selectedUnlimitedProducts.map((item) => item.name).join(", ")}</p>
                            </div>
                          </div>
                        )}
                        <div className="border-t border-katana-border pt-3">
                          <div className="flex items-center justify-between text-sm text-neutral-300">
                            <p>Subtotal</p>
                            <p>{money(subtotal)}</p>
                          </div>
                          <div className="flex items-center justify-between text-sm text-neutral-300">
                            <p>Tax (12%)</p>
                            <p>{money(tax)}</p>
                          </div>
                          <div className="mt-3 flex items-center justify-between text-base font-bold text-white">
                            <p>Total</p>
                            <p>{money(totalPrice)}</p>
                          </div>
                          <div className="mt-3 flex items-center justify-between text-sm text-neutral-300">
                            <p>Downpayment (50%)</p>
                            <p>{money(downpayment)}</p>
                          </div>
                          <div className="flex items-center justify-between text-sm text-neutral-300">
                            <p>Remaining balance</p>
                            <p>{money(remaining)}</p>
                          </div>
                        </div>
                      </div>
                    </div>

                    <div className="mt-6 rounded-lg border border-katana-border bg-katana-elevated p-5">
                      <p className="text-sm font-bold uppercase text-white">Payment option</p>

                      <div className="mt-4 grid gap-3 sm:grid-cols-2">
                        <button
                          type="button"
                          onClick={() => setPaymentPlan("initial_only")}
                          className={`rounded-2xl border px-4 py-4 text-left text-sm font-bold ${paymentPlan === "initial_only" ? "border-katana-red bg-katana-red/15 text-white" : "border-katana-border bg-katana-surface text-neutral-300"}`}
                        >
                          <p className="font-semibold">50% INITIAL</p>
                          <p className="mt-2 text-sm text-neutral-300">Pay {money(downpayment)} now. Remaining {money(remaining)} due at restaurant.</p>
                        </button>
                        <button
                          type="button"
                          onClick={() => setPaymentPlan("full_payment")}
                          className={`rounded-2xl border px-4 py-4 text-left text-sm font-bold ${paymentPlan === "full_payment" ? "border-katana-red bg-katana-red/15 text-white" : "border-katana-border bg-katana-surface text-neutral-300"}`}
                        >
                          <p className="font-semibold">100% FULL</p>
                          <p className="mt-2 text-sm text-neutral-300">Pay {money(totalPrice)} now and owe nothing at the restaurant.</p>
                        </button>
                      </div>
                    </div>

                    <div className="mt-6 rounded-lg border border-katana-border bg-katana-elevated p-5">
                      <p className="text-sm font-bold uppercase text-white">Select Payment Method</p>

                      <div className="mt-4 grid gap-3 sm:grid-cols-3">
                        {([
                          { id: "cash", label: "Cash", icon: <Banknote className="h-4 w-4" />, disabled: false },
                          { id: "gcash", label: "GCash", icon: <Smartphone className="h-4 w-4" />, disabled: true },
                          { id: "bank_transfer", label: "BPI", icon: <Landmark className="h-4 w-4" />, disabled: true }
                        ] as const).map((option) => (
                          <button
                            key={option.id}
                            type="button"
                            onClick={() => !option.disabled && setPaymentMethod(option.id)}
                            disabled={option.disabled}
                            className={`flex min-h-[74px] flex-col items-center justify-center gap-1 rounded-2xl border px-4 py-3 text-sm font-bold ${
                              paymentMethod === option.id
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

                    <label className="mt-6 flex items-start gap-3 rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm font-semibold text-amber-900">
                      <input
                        checked={acknowledged}
                        className="mt-1 h-4 w-4 accent-red-700"
                        type="checkbox"
                        onChange={(event) => setAcknowledged(event.target.checked)}
                      />
                      I agree that payment is required to confirm this reservation.
                    </label>

                    <section className="mt-4 rounded-lg border border-katana-border bg-katana-elevated p-4 text-sm text-neutral-300">
                      <p className="font-bold uppercase text-white">Reservation Rules & Guidelines</p>
                      <ul className="mt-3 list-disc space-y-2 pl-5">
                        <li>Payment is required to confirm your reservation.</li>
                        <li>Reserved guests are charged based on the reserved headcount.</li>
                        <li>Dining time is limited to 1 hour and 30 minutes upon serving of food.</li>
                        <li>Please arrive on time to avoid delays.</li>
                        <li>Reservations delayed by more than 15 minutes may be released to the next guest.</li>
                      </ul>
                    </section>
                  </div>

                  <aside className="rounded-xl border border-katana-border bg-katana-elevated p-5">
                    <p className="text-sm font-bold uppercase text-white">Booking Overview</p>
                    <div className="mt-4 space-y-3 text-sm text-neutral-300">
                      <div className="rounded-lg border border-katana-border bg-katana-surface p-4 shadow-sm">

                        <p className="font-semibold text-white">{reservationType === "dine_in" ? "Regular Order" : "Unlimited"}</p>
                        <p className="mt-2">{form.party_size} guests · {formatTime12(form.time)} · {form.date}</p>
                      </div>
                      <div className="rounded-lg border border-katana-border bg-katana-surface p-4 shadow-sm">
                        <p className="font-semibold text-white">Payment</p>

                        <p className="mt-2">{isFullPayment ? "Amount paid now" : "Amount due now"}: {money(paymentAmount)}</p>
                        <p>{isFullPayment ? "Remaining balance" : "Remaining balance"}: {money(isFullPayment ? 0 : remaining)}</p>
                        <p className="mt-2 text-xs text-neutral-400">{isFullPayment ? "No remaining balance is due at the restaurant." : "Final payment due in person after your meal."}</p>
                      </div>
                    </div>
                  </aside>
                </div>
              )}

              <div className={`mt-6 flex-col gap-3 sm:flex-row sm:justify-between ${step === 2 && reservationType === "dine_in" ? "hidden" : "flex"}`}>
                <button
                  type="button"
                  onClick={goBackStep}
                  className="rounded-md border border-slate-300 bg-white px-4 py-3 text-sm font-bold text-slate-800"
                  disabled={step === 1}
                >
                  Back
                </button>
                {step < 3 ? (
                  <button
                    type="button"
                    onClick={goNextStep}
                    className="rounded-md bg-red-700 px-4 py-3 text-sm font-bold text-white hover:bg-red-800"
                  >
                    Next
                  </button>
                ) : (
                  <button
                    type="submit"
                    className="rounded-md bg-red-700 px-4 py-3 text-sm font-bold text-white hover:bg-red-800"
                  >
                    Pay {money(paymentAmount)}
                  </button>
                )}
              </div>

              {message && <p className="mt-4 rounded-md bg-red-50 px-3 py-2 text-sm font-medium text-katana-red">{message}</p>}
            </form>
          </section>
        </div>
      </section>
    </main>
  );
}

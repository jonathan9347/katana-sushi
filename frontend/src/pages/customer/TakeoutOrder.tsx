import { FormEvent, useEffect, useMemo, useRef, useState } from "react";
import { Clock3, Copy, MapPin, Phone, Search, ShoppingBag, X } from "lucide-react";
import { Link } from "react-router-dom";
import BackToHome from "../../components/layout/BackToHome";
import { api, resolveImageUrl } from "../../lib/api";
import { formatTime12 } from "../../lib/dateTime";
import { fetchReservationRules, type ReservationRulesResponse } from "../../lib/reservationRules";
import "./ReservationForm.css";

const PICKUP_PREP_TIME = "About 25 min";
const PICKUP_INFO = {
  streetAddress: "[Add restaurant street address]",
  phoneNumber: "[Add restaurant phone number]"
};

type TakeoutProduct = {
  id: string;
  name: string;
  category: string;
  price: number;
  description?: string | null;
  image_url?: string | null;
  available_stock: number;
  is_available: boolean;
};

type TakeoutOrderSummary = {
  order_number: string;
  status: string;
  payment_plan: "pay_now" | "pay_at_pickup";
  payment_status: string;
  ready_at?: string | null;
  pickup_time?: string | null;
  subtotal: number;
  total: number;
  items: Array<{ name: string; quantity: number; unit_price: number; total_price: number }>;
  payment_expires_at?: string | null;
};

type CheckoutResponse = {
  order: TakeoutOrderSummary;
  payment: null;
};

type CartLine = { product: TakeoutProduct; quantity: number };

function categorySectionId(category: string) {
  return `takeout-menu-${category.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "") || "other"}`;
}

function formatMoney(value: number) {
  return new Intl.NumberFormat("en-PH", {
    style: "currency",
    currency: "PHP",
    maximumFractionDigits: 2
  }).format(value);
}

function isValidPickupTime(value: string) {
  return /^([01]\d|2[0-3]):([0-5]\d)$/.test(value) && value >= "13:00" && value <= "21:00";
}

function pickupDateTime(value: string) {
  const [hour, minute] = value.split(":").map(Number);
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Manila", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date());
  const part = (name: string) => parts.find((entry) => entry.type === name)?.value ?? "";
  return new Date(`${part("year")}-${part("month")}-${part("day")}T${value}:00+08:00`).toISOString();
}

function formatPickupDate(value: string) {
  return new Intl.DateTimeFormat("en-PH", {
    weekday: "long", hour: "numeric", minute: "2-digit", timeZone: "Asia/Manila"
  }).format(new Date(value));
}

function getErrorMessage(error: unknown) {
  if (
    typeof error === "object" &&
    error !== null &&
    "response" in error
  ) {
    const response = (error as { response?: { data?: { message?: string } } }).response;
    if (response?.data?.message) return response.data.message;
  }
  return error instanceof Error ? error.message : "Unable to complete pickup checkout.";
}

function getCheckoutKey(signature: string) {
  const storageKey = "katana:takeout-checkout";
  try {
    const saved = sessionStorage.getItem(storageKey);
    if (saved) {
      const parsed = JSON.parse(saved) as { signature?: unknown; key?: unknown };
      if (parsed.signature === signature && typeof parsed.key === "string") return parsed.key;
    }
  } catch {
    sessionStorage.removeItem(storageKey);
  }
  const key = window.crypto.randomUUID();
  sessionStorage.setItem(storageKey, JSON.stringify({ signature, key }));
  return key;
}

export default function TakeoutOrder() {
  const [products, setProducts] = useState<TakeoutProduct[]>([]);
  const [quantities, setQuantities] = useState<Record<string, number>>({});
  const [customerName, setCustomerName] = useState("");
  const [customerPhone, setCustomerPhone] = useState("");
  const [menuSearch, setMenuSearch] = useState("");
  const [contactDialogOpen, setContactDialogOpen] = useState(false);
  const [contactErrors, setContactErrors] = useState<{ name?: string; phone?: string }>({});
  const [checkoutError, setCheckoutError] = useState("");
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [reservationRules, setReservationRules] = useState<ReservationRulesResponse | null>(null);
  const [reservationHoursError, setReservationHoursError] = useState("");
  const [pickupScrollActive, setPickupScrollActive] = useState(false);
  const [pickupTime, setPickupTime] = useState("");
  const [pickupTimeError, setPickupTimeError] = useState("");
  const [successOrder, setSuccessOrder] = useState<{ order: TakeoutOrderSummary; phone: string } | null>(null);
  const [referenceCopied, setReferenceCopied] = useState(false);
  const successDialogRef = useRef<HTMLElement | null>(null);
  const confirmButtonRef = useRef<HTMLButtonElement | null>(null);
  const pickupScrollTimer = useRef<number | null>(null);

  useEffect(() => {
    let active = true;
    api.get<{ products: TakeoutProduct[] }>("/api/takeout/catalog")
      .then(({ data }) => {
        if (active) setProducts(data.products);
      })
      .catch((error: unknown) => {
        if (active) setMessage(getErrorMessage(error));
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    let active = true;
    fetchReservationRules()
      .then((rules) => {
        if (active) setReservationRules(rules);
      })
      .catch((error: unknown) => {
        if (!active) return;
        setReservationHoursError(getErrorMessage(error));
      });
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    if (!contactDialogOpen) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setContactDialogOpen(false);
    };
    document.addEventListener("keydown", closeOnEscape);
    return () => document.removeEventListener("keydown", closeOnEscape);
  }, [contactDialogOpen]);

  useEffect(() => {
    if (!successOrder) return;
    successDialogRef.current?.focus();
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") closeSuccess();
    };
    document.addEventListener("keydown", closeOnEscape);
    return () => document.removeEventListener("keydown", closeOnEscape);
  }, [successOrder]);

  useEffect(() => () => {
    if (pickupScrollTimer.current !== null) {
      window.clearTimeout(pickupScrollTimer.current);
    }
  }, []);

  const cart = useMemo(
    () => products
      .filter((product) => (quantities[product.id] ?? 0) > 0)
      .map((product) => ({ product, quantity: quantities[product.id] ?? 0 })),
    [products, quantities]
  );
  const productGroups = useMemo(() => {
    const groups = new Map<string, TakeoutProduct[]>();
    for (const product of products) {
      const category = product.category || "Other";
      groups.set(category, [...(groups.get(category) ?? []), product]);
    }
    return Array.from(groups, ([category, groupProducts]) => ({ category, products: groupProducts }));
  }, [products]);
  const filteredProductGroups = useMemo(() => {
    const search = menuSearch.trim().toLocaleLowerCase();
    if (!search) return productGroups;
    return productGroups
      .map((group) => ({
        ...group,
        products: group.products.filter((product) =>
          `${product.name} ${product.description ?? ""} ${group.category}`.toLocaleLowerCase().includes(search)
        )
      }))
      .filter((group) => group.products.length > 0);
  }, [menuSearch, productGroups]);
  const cartItemCount = cart.reduce((count, line) => count + line.quantity, 0);
  const total = cart.reduce((sum, line) => sum + line.product.price * line.quantity, 0);

  function adjustQuantity(productId: string, amount: number) {
    setQuantities((current) => {
      const product = products.find((entry) => entry.id === productId);
      const availableStock = product ? Math.max(0, Math.floor(product.available_stock)) : 0;
      const next = Math.max(0, Math.min(100, availableStock, (current[productId] ?? 0) + amount));
      return { ...current, [productId]: next };
    });
  }

  function handlePickupScroll() {
    setPickupScrollActive(true);
    if (pickupScrollTimer.current !== null) {
      window.clearTimeout(pickupScrollTimer.current);
    }
    pickupScrollTimer.current = window.setTimeout(() => {
      setPickupScrollActive(false);
      pickupScrollTimer.current = null;
    }, 700);
  }

  function openContactDialog() {
    if (cart.length === 0 || !pickupTime || submitting) return;
    confirmButtonRef.current = document.activeElement instanceof HTMLButtonElement ? document.activeElement : null;
    setContactErrors({});
    setCheckoutError("");
    setContactDialogOpen(true);
  }

  async function submitOrder(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setContactErrors({});
    setCheckoutError("");
    if (cart.length === 0 || !pickupTime) {
      setContactDialogOpen(false);
      return;
    }
    const name = customerName.trim();
    const errors: { name?: string; phone?: string } = {};
    if (!name) errors.name = "Enter your name.";
    if (!/^09\d{9}$/.test(customerPhone)) errors.phone = "Enter a valid 11-digit mobile number starting with 09.";
    if (Object.keys(errors).length > 0) {
      setContactErrors(errors);
      return;
    }
    setSubmitting(true);
    const items = cart.map(({ product, quantity }) => ({ product_id: product.id, quantity }));
    const signature = JSON.stringify({
      customer_name: name,
      customer_phone: customerPhone,
      payment_plan: "pay_at_pickup",
      pickup_time: pickupDateTime(pickupTime),
      items
    });

    try {
      const response = await api.post<CheckoutResponse>("/api/takeout/orders", {
        customer_name: name,
        customer_phone: customerPhone,
        payment_plan: "pay_at_pickup",
        pickup_time: pickupDateTime(pickupTime),
        idempotency_key: getCheckoutKey(signature),
        items
      });
      sessionStorage.removeItem("katana:takeout-checkout");
      setContactDialogOpen(false);
      setSuccessOrder({ order: response.data.order, phone: customerPhone });
    } catch (error) {
      setCheckoutError(getErrorMessage(error));
    } finally {
      setSubmitting(false);
    }
  }

  function selectPickupTime(value: string) {
    if (!isValidPickupTime(value)) {
      setPickupTime("");
      setPickupTimeError("Pickup time must be between 1:00 PM and 9:00 PM.");
      return;
    }
    setPickupTime(value);
    setPickupTimeError("");
  }

  function closeSuccess() {
    setSuccessOrder(null);
    window.requestAnimationFrame(() => confirmButtonRef.current?.focus());
  }

  async function copyReference(reference: string) {
    await navigator.clipboard.writeText(reference);
    setReferenceCopied(true);
    window.setTimeout(() => setReferenceCopied(false), 1800);
  }

  return (
    <main className="customer-pickup-page w-full px-4 pt-3 pb-4 md:px-6 md:pb-6 lg:px-3 lg:pt-4 lg:pb-3">
      <h1 className="sr-only">Order for pickup</h1>
      <section className="customer-reservation-form grid w-full items-start gap-6 lg:grid-cols-[minmax(0,1fr)_400px] lg:gap-3">
            <div className="min-w-0 lg:col-start-1 lg:row-start-1">
              <BackToHome className="mb-3" />
              <div className="space-y-4">
                <div className="flex min-w-0 flex-col gap-3 sm:flex-row sm:items-center">
                  <div className="min-w-0">
                    <p className="customer-kicker">Pickup order</p>
                    <h2 className="mt-1 font-display text-2xl font-bold text-[var(--customer-text)]">Choose your menu</h2>
                  </div>
                  <label className="relative block min-w-0 flex-1">
                    <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-katana-muted" aria-hidden="true" />
                    <input
                      className="customer-input pl-10"
                      type="search"
                      value={menuSearch}
                      onChange={(event) => setMenuSearch(event.target.value)}
                      placeholder="Search menu items"
                      aria-label="Search pickup menu items"
                    />
                  </label>
                </div>

                <section className="min-w-0" aria-label="Choose pickup menu items">
                  <nav aria-label="Pickup menu categories" className="mb-5 flex min-w-0 gap-2 overflow-x-auto pb-2">
                    <button
                      type="button"
                      onClick={() => document.getElementById("takeout-products-top")?.scrollIntoView({ behavior: "smooth", block: "start" })}
                      className="shrink-0 rounded-full border border-katana-red bg-katana-red px-4 py-2 text-xs font-bold uppercase text-white"
                    >
                      All
                    </button>
                    {filteredProductGroups.map((group) => (
                      <button
                        key={group.category}
                        type="button"
                        onClick={() => document.getElementById(categorySectionId(group.category))?.scrollIntoView({ behavior: "smooth", block: "start" })}
                        className="flex shrink-0 items-center gap-2 rounded-full border border-katana-border bg-katana-surface px-4 py-2 text-xs font-bold uppercase text-[var(--customer-text)] hover:border-katana-red"
                      >
                        {group.category}<span className="text-[10px] opacity-70">{group.products.length}</span>
                      </button>
                    ))}
                  </nav>
                  <div id="takeout-products-top" />
                  {loading ? (
                    <p className="rounded-lg border border-katana-border bg-katana-surface p-5 text-sm text-katana-muted" role="status">Loading the current menu...</p>
                  ) : message && products.length === 0 ? (
                    <div className="rounded-lg border border-katana-red/30 bg-katana-red/10 p-5 text-sm text-[var(--customer-text)]" role="alert">
                      <p>The pickup menu could not be loaded. {message}</p>
                      <button type="button" className="mt-3 font-bold text-[var(--customer-text)] underline" onClick={() => window.location.reload()}>Retry</button>
                    </div>
                  ) : products.length === 0 ? (
                    <p className="rounded-lg border border-katana-border bg-katana-surface p-5 text-sm text-katana-muted">No pickup items are currently available.</p>
                  ) : filteredProductGroups.length === 0 ? (
                    <p className="rounded-lg border border-katana-border bg-katana-surface p-5 text-sm text-katana-muted">No menu items match that search.</p>
                  ) : (
                    <div className="space-y-6">
                      {filteredProductGroups.map((group, groupIndex) => (
                        <section key={group.category} id={categorySectionId(group.category)}>
                          <div className="mb-3 flex items-center justify-between gap-3">
                            <h3 className="text-xs font-black uppercase tracking-[0.16em] text-[var(--customer-muted)]">{group.category}</h3>
                            <span className="h-px flex-1 bg-katana-border" />
                            <span className="text-xs font-semibold text-katana-muted">{group.products.length}</span>
                          </div>
                          <div className="customer-menu-product-grid grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-3 xl:grid-cols-4">
                            {group.products.map((product, index) => {
                              const availableStock = Math.max(0, Math.floor(product.available_stock));
                              const disabled = !product.is_available || availableStock === 0;
                              const image = resolveImageUrl(product.image_url);
                              const quantity = quantities[product.id] ?? 0;
                              const eagerImage = groupIndex === 0 && index < 6;
                              return (
                                <article key={product.id} className={`customer-menu-product-card group ${disabled ? "is-unavailable" : ""} ${quantity > 0 ? "is-selected" : ""}`}>
                                  <div className="customer-menu-product-art">
                                    {image ? (
                                      <img src={image} alt={product.name} loading={eagerImage ? "eager" : "lazy"} fetchPriority={eagerImage ? "high" : "auto"} decoding="async" />
                                    ) : <span className="text-6xl" aria-hidden="true">🍣</span>}
                                  </div>
                                  <div className="customer-menu-product-panel">
                                    <h4 className="customer-menu-product-name line-clamp-2 font-display text-sm font-bold leading-tight sm:text-base">{product.name}</h4>
                                    <span className="customer-menu-price-badge text-sm">{formatMoney(product.price)}</span>
                                    <p className="customer-menu-product-description line-clamp-2 min-h-8 text-[11px] leading-relaxed sm:text-xs">{product.description ?? "House specialty"}</p>
                                    <span className={`customer-menu-product-status ${disabled ? "is-unavailable" : "is-available"}`}>
                                      {disabled ? "Not available" : `${availableStock} available`}
                                    </span>
                                    {quantity > 0 ? (
                                      <div className="customer-menu-quantity-control" aria-label={`Quantity of ${product.name}`}>
                                        <button type="button" aria-label={`Remove one ${product.name}`} onClick={() => adjustQuantity(product.id, -1)}>−</button>
                                        <span aria-live="polite">{quantity}</span>
                                        <button type="button" aria-label={`Add one ${product.name}`} disabled={disabled || quantity >= Math.min(100, availableStock)} onClick={() => adjustQuantity(product.id, 1)}>+</button>
                                      </div>
                                    ) : (
                                      <button type="button" onClick={() => adjustQuantity(product.id, 1)} disabled={disabled} className="customer-menu-order-button">
                                        {disabled ? "Not available" : "Add to cart"}
                                      </button>
                                    )}
                                  </div>
                                </article>
                              );
                            })}
                          </div>
                        </section>
                      ))}
                    </div>
                  )}
                </section>
              </div>
            </div>

            <aside
              className="customer-pickup-cart rounded-2xl border border-katana-border bg-[var(--customer-surface)] p-4 text-[var(--customer-text)] shadow-xl lg:col-start-2 lg:row-start-1"
              aria-label="Your pickup order"
            >
              <div className="customer-pickup-cart-header">
                <h2>Your pickup order</h2>
                <span>{cartItemCount} {cartItemCount === 1 ? "item" : "items"}</span>
              </div>
              <div
                className="customer-pickup-cart-scroll"
                data-scroll-active={pickupScrollActive}
                onScroll={handlePickupScroll}
              >
                {cart.length === 0 ? (
                  <>
                    <section className="customer-pickup-empty-state">
                      <span className="customer-pickup-empty-icon"><ShoppingBag aria-hidden="true" /></span>
                      <h3>Nothing here yet</h3>
                      <p>Add rolls, nigiri or bowls from the menu to start your pickup order.</p>
                    </section>
                    <PickupLocation
                      openingHours={reservationRules
                        ? `${formatTime12(reservationRules.settings.OPENING_TIME)} – ${formatTime12(reservationRules.settings.CLOSING_TIME)}`
                        : null}
                      hoursError={reservationHoursError}
                    />
                    <PickupTimeCard value={pickupTime} error={pickupTimeError} onChange={selectPickupTime} />
                  </>
                ) : (
                  <>
                    <div className="customer-pickup-items" aria-label="Pickup order items">
                      {cart.map(({ product, quantity }) => (
                        <article key={product.id} className="customer-pickup-item">
                          <div className="customer-pickup-item-main">
                            <p>{product.name}</p>
                            <small>{formatMoney(product.price)} each</small>
                          </div>
                          <div className="customer-pickup-item-quantity" aria-label={`Quantity of ${product.name}`}>
                            <button type="button" aria-label={`Remove one ${product.name}`} onClick={() => adjustQuantity(product.id, -1)}>−</button>
                            <span>{quantity}</span>
                            <button type="button" aria-label={`Add one ${product.name}`} disabled={quantity >= Math.min(100, product.available_stock)} onClick={() => adjustQuantity(product.id, 1)}>+</button>
                          </div>
                          <strong className="customer-pickup-item-total">{formatMoney(product.price * quantity)}</strong>
                        </article>
                      ))}
                    </div>
                    <div className="customer-pickup-info-grid">
                      <div><span>Prep time</span><strong>{PICKUP_PREP_TIME}</strong></div>
                      <div><span>Pick up at</span><strong>Katana counter</strong></div>
                    </div>
                    <PickupLocation
                      openingHours={reservationRules
                        ? `${formatTime12(reservationRules.settings.OPENING_TIME)} – ${formatTime12(reservationRules.settings.CLOSING_TIME)}`
                        : null}
                      hoursError={reservationHoursError}
                    />
                    <PickupTimeCard value={pickupTime} error={pickupTimeError} onChange={selectPickupTime} />
                    <p className="customer-pickup-note">
                      No payment is needed now. Please wait for staff approval before preparation begins.
                    </p>
                  </>
                )}
              </div>
              <div className="customer-pickup-cart-footer">
                <div className="customer-pickup-subtotal"><span>Subtotal</span><strong>{formatMoney(total)}</strong></div>
                <div className="customer-pickup-total"><span>Total to pay at counter</span><strong>{formatMoney(total)}</strong></div>
                <button
                  type="button"
                  className="customer-btn-primary w-full"
                  ref={confirmButtonRef}
                  disabled={submitting || cart.length === 0 || !pickupTime}
                  onClick={openContactDialog}
                >
                  {pickupTime ? "Confirm pickup order" : "Choose a pickup time"}
                </button>
                <p>You will be asked for your contact details next.</p>
                {message && <p className="reservation-checkout-alert" role="alert">{message}</p>}
              </div>
            </aside>
          </section>
      {contactDialogOpen && <div
        className="customer-pickup-dialog-backdrop"
        onMouseDown={(event) => {
          if (event.target === event.currentTarget) setContactDialogOpen(false);
        }}
      >
        <section
          className="customer-pickup-dialog"
          role="dialog"
          aria-modal="true"
          aria-labelledby="pickup-contact-title"
          aria-describedby="pickup-contact-description"
        >
          <header className="customer-pickup-dialog-header">
            <div>
              <p>Almost done</p>
              <h2 id="pickup-contact-title">Contact details</h2>
              <span id="pickup-contact-description">So we can call you when your order is ready.</span>
            </div>
            <button type="button" aria-label="Close dialog" onClick={() => setContactDialogOpen(false)}>
              <X aria-hidden="true" />
            </button>
          </header>
          <form className="customer-pickup-contact-form" noValidate onSubmit={submitOrder}>
            <label>
              <span>Name</span>
              <input
                autoFocus
                autoComplete="name"
                maxLength={120}
                value={customerName}
                aria-invalid={Boolean(contactErrors.name)}
                aria-describedby={contactErrors.name ? "pickup-name-error" : undefined}
                onChange={(event) => {
                  setCustomerName(event.target.value);
                  setContactErrors((current) => ({ ...current, name: undefined }));
                }}
              />
              {contactErrors.name && <small id="pickup-name-error" role="alert">{contactErrors.name}</small>}
            </label>
            <label>
              <span>Phone number</span>
              <input
                type="tel"
                inputMode="numeric"
                autoComplete="tel"
                maxLength={11}
                placeholder="09XX XXX XXXX"
                value={customerPhone}
                aria-invalid={Boolean(contactErrors.phone)}
                aria-describedby={contactErrors.phone ? "pickup-phone-error" : undefined}
                onChange={(event) => {
                  setCustomerPhone(event.target.value.replace(/\D/g, "").slice(0, 11));
                  setContactErrors((current) => ({ ...current, phone: undefined }));
                }}
              />
              {contactErrors.phone && <small id="pickup-phone-error" role="alert">{contactErrors.phone}</small>}
            </label>
            <div className="customer-pickup-dialog-summary">
              <span>{cartItemCount} {cartItemCount === 1 ? "item" : "items"}, pay at counter</span>
              <strong>{formatMoney(total)}</strong>
            </div>
            <p className="customer-pickup-contact-time">Pickup time: <strong>{formatTime12(pickupTime)}</strong></p>
            {checkoutError && <p className="reservation-checkout-alert" role="alert">{checkoutError}</p>}
            <button type="submit" className="customer-btn-primary w-full" disabled={submitting || cart.length === 0}>
              {submitting ? "Sending..." : "Send pickup order"}
            </button>
            <button type="button" className="customer-pickup-back-link" onClick={() => setContactDialogOpen(false)}>
              Back to order
            </button>
          </form>
        </section>
      </div>}
      {successOrder && <div className="customer-pickup-success-backdrop" onMouseDown={(event) => {
        if (event.target === event.currentTarget) closeSuccess();
      }}>
        <section className="customer-pickup-success" role="dialog" aria-modal="true" aria-labelledby="pickup-success-title" tabIndex={-1} ref={successDialogRef}>
          <button type="button" className="customer-pickup-success-close" aria-label="Close dialog" onClick={closeSuccess}><X aria-hidden="true" /></button>
          <div className="customer-pickup-success-icon"><Clock3 aria-hidden="true" /></div>
          <p className="customer-pickup-success-eyebrow">Pickup order</p>
          <h2 id="pickup-success-title">Your pickup order is sent.</h2>
          <p className="customer-pickup-success-copy">Staff will review it shortly. Your order is not confirmed until it is approved.</p>
          <div className="customer-pickup-reference-chip">
            <strong>{successOrder.order.order_number}</strong>
            <button type="button" onClick={() => void copyReference(successOrder.order.order_number)}><Copy aria-hidden="true" /> Copy</button>
          </div>
          {referenceCopied && <p className="customer-pickup-copy-message" role="status">Reference copied</p>}
          <span className="customer-pickup-status-pill">Pending approval</span>
          <div className="customer-pickup-success-details">
            <PickupDetail label="Pickup time" value={formatPickupDate(successOrder.order.pickup_time ?? pickupDateTime(pickupTime))} />
            <div className="customer-pickup-success-detail"><span>Items</span><strong>{successOrder.order.items.map((item) => `${item.quantity} × ${item.name}`).join(", ")}</strong></div>
            <PickupDetail label="Total" value={formatMoney(successOrder.order.total)} />
            <PickupDetail label="Payment" value={`${successOrder.order.payment_plan === "pay_at_pickup" ? "Pay at pickup" : successOrder.order.payment_plan} · ${successOrder.order.payment_status}`} />
          </div>
          <button type="button" className="customer-pickup-success-primary" onClick={() => {
            setQuantities({});
            setPickupTime("");
            setPickupTimeError("");
            setSuccessOrder(null);
            window.requestAnimationFrame(() => confirmButtonRef.current?.focus());
          }}>Make another order</button>
          <Link className="customer-pickup-success-link" to={`/reservation/status?bookingId=${encodeURIComponent(successOrder.order.order_number)}`} state={{ pickupPhone: successOrder.phone }} onClick={() => setSuccessOrder(null)}>See order status →</Link>
        </section>
      </div>}
    </main>
  );
}

function PickupLocation({
  openingHours,
  hoursError
}: {
  openingHours: string | null;
  hoursError: string;
}) {
  return (
    <section className="customer-pickup-location" aria-label="Pickup location">
      <p className="customer-pickup-section-label">Pickup location</p>
      <div className="customer-pickup-location-address">
        <span><MapPin aria-hidden="true" /></span>
        <div><strong>Katana Sushi, front counter</strong><small>{PICKUP_INFO.streetAddress}</small></div>
      </div>
      <div className="customer-pickup-location-row">
        <span>Open today</span>
        {openingHours
          ? <strong>{openingHours}</strong>
          : hoursError
            ? <strong role="alert">Hours unavailable</strong>
            : <strong>Loading hours...</strong>}
      </div>
      {hoursError && <p className="customer-pickup-hours-error" role="alert">Could not load opening hours: {hoursError}</p>}
      <div className="customer-pickup-location-row">
        <span><Phone aria-hidden="true" />Call the restaurant</span>
        <strong>{PICKUP_INFO.phoneNumber}</strong>
      </div>
    </section>
  );
}

function PickupTimeCard({ value, error, onChange }: { value: string; error: string; onChange: (value: string) => void }) {
  const slots = Array.from({ length: 17 }, (_, index) => {
    const minutes = 13 * 60 + index * 30;
    return `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;
  });
  return (
    <section className="customer-pickup-time" aria-label="Pickup time">
      <div className="customer-pickup-time-heading"><p className="customer-pickup-section-label">Pickup time</p><strong>{value ? formatTime12(value) : "Required"}</strong></div>
      <div className="customer-pickup-time-grid" aria-label="Choose a pickup time">
        {slots.map((slot) => <button type="button" key={slot} aria-pressed={value === slot} className={value === slot ? "is-selected" : ""} onClick={() => onChange(slot)}>{formatTime12(slot)}</button>)}
      </div>
      <label className="customer-pickup-custom-time"><span>Or choose another time</span><input type="time" min="13:00" max="21:00" step={900} value={value} onChange={(event) => onChange(event.target.value)} /></label>
      <small className="customer-pickup-time-help">Pickup is available from 1:00 PM until 9:00 PM.</small>
      {error && <small className="customer-pickup-time-error" role="alert">{error}</small>}
    </section>
  );
}

function PickupDetail({ label, value }: { label: string; value: string }) {
  return <div className="customer-pickup-success-detail"><span>{label}</span><strong>{value}</strong></div>;
}


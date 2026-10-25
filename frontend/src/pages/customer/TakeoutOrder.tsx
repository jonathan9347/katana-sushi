import { FormEvent, useEffect, useMemo, useState } from "react";
import { ChevronDown, Search, ShoppingCart } from "lucide-react";
import { Link } from "react-router-dom";
import BackToHome from "../../components/layout/BackToHome";
import { api, resolveImageUrl } from "../../lib/api";
import { formatManilaDateTime } from "../../lib/dateTime";
import "./ReservationForm.css";

type TakeoutProduct = {
  id: string;
  name: string;
  category: string;
  price: number;
  description?: string | null;
  image_url?: string | null;
  is_available: boolean;
};

type TakeoutOrderSummary = {
  order_number: string;
  status: string;
  payment_plan: "pay_now" | "pay_at_pickup";
  payment_status: string;
  ready_at?: string | null;
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

function takeoutStatusLabel(status: string) {
  if (status === "pending_approval") return "Awaiting staff approval";
  if (status === "declined") return "Declined";
  if (status === "completed" || status === "released") return "Completed";
  return status.replace(/_/g, " ");
}

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
  const [mobileCartOpen, setMobileCartOpen] = useState(false);
  const [order, setOrder] = useState<TakeoutOrderSummary | null>(null);
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);

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
    if (!order || !customerPhone || ["released", "completed", "declined", "cancelled", "expired"].includes(order.status)) return;
    let active = true;
    const poll = async () => {
      try {
        const response = await api.get<{ order: TakeoutOrderSummary }>(
          `/api/takeout/orders/${encodeURIComponent(order.order_number)}`,
          { params: { phone: customerPhone } }
        );
        if (active) setOrder(response.data.order);
      } catch (error) {
        if (active) setMessage(`Status refresh failed: ${getErrorMessage(error)}`);
      }
    };
    const timer = window.setInterval(() => void poll(), 5000);
    return () => {
      active = false;
      window.clearInterval(timer);
    };
  }, [order?.order_number, order?.status, customerPhone]);

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
      const next = Math.max(0, Math.min(100, (current[productId] ?? 0) + amount));
      return { ...current, [productId]: next };
    });
  }

  async function submitOrder(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setMessage("");
    if (cart.length === 0) {
      setMessage("Add at least one available item to your cart.");
      return;
    }
    setSubmitting(true);
    const items = cart.map(({ product, quantity }) => ({ product_id: product.id, quantity }));
    const signature = JSON.stringify({
      customer_name: customerName.trim(),
      customer_phone: customerPhone,
      payment_plan: "pay_at_pickup",
      items
    });

    try {
      const response = await api.post<CheckoutResponse>("/api/takeout/orders", {
        customer_name: customerName.trim(),
        customer_phone: customerPhone,
        payment_plan: "pay_at_pickup",
        idempotency_key: getCheckoutKey(signature),
        items
      });
      const createdOrder = response.data.order;
      setOrder(createdOrder);
      sessionStorage.removeItem("katana:takeout-checkout");
      setMessage("Your pickup order was received and is awaiting staff approval. Pay in cash at the counter.");
    } catch (error) {
      setMessage(getErrorMessage(error));
    } finally {
      setSubmitting(false);
    }
  }

  async function cancelOrder() {
    if (!order) return;
    setMessage("");
    try {
      await api.post(`/api/takeout/orders/${encodeURIComponent(order.order_number)}/cancel`, {
        phone: customerPhone
      });
      setOrder({ ...order, status: "cancelled" });
      setMessage("Your pickup order has been cancelled.");
    } catch (error) {
      setMessage(getErrorMessage(error));
    }
  }

  return (
    <main className="w-full px-4 pt-3 pb-4 md:px-6 md:pb-6 lg:px-3 lg:pb-3">
      <h1 className="sr-only">Order for pickup</h1>
      {order ? (
        <section className="customer-reservation-form mx-auto max-w-3xl rounded-2xl border border-katana-border bg-[var(--customer-surface)] p-5 text-[var(--customer-text)] shadow-xl sm:p-7" aria-live="polite">
          <BackToHome className="mb-5" />
          <p className="customer-kicker">Pickup order</p>
          <h2 className="mt-2 font-display text-2xl font-bold">{order.order_number}</h2>
          {order.status === "ready" && (
            <p className="mt-4 rounded-xl border border-emerald-400/50 bg-emerald-500/15 px-4 py-3 font-bold text-[var(--customer-text)]" role="status">
              Your order is ready for pickup.
              {order.ready_at ? ` Pickup Time: ${formatManilaDateTime(order.ready_at, { hour: "numeric", minute: "2-digit" })}.` : ""}
            </p>
          )}
          <p className="mt-3 text-sm capitalize text-[var(--customer-muted)]">Status: {takeoutStatusLabel(order.status)}</p>
          {order.status === "pending_approval" && (
            <p className="mt-4 rounded-xl border border-amber-400/50 bg-amber-500/10 px-4 py-3 font-semibold text-[var(--customer-text)]" role="status">
              Your order was received and is waiting for staff to approve it.
            </p>
          )}
          <p className="mt-1 text-sm text-[var(--customer-muted)]">Payment: pay in cash at the counter.</p>
          <div className="reservation-panel-sections mt-5">
            <section className="reservation-panel-section" aria-label="Pickup order summary">
              <div className="reservation-order-items">
                {order.items.map((item, index) => (
                  <div key={`${item.name}-${index}`} className="reservation-order-item">
                    <div className="reservation-order-item-info"><p>{item.name} × {item.quantity}</p></div>
                    <p className="reservation-order-item-price">{formatMoney(item.total_price)}</p>
                  </div>
                ))}
                <div className="reservation-order-totals">
                  <div className="reservation-order-total"><span>Total</span><strong>{formatMoney(order.total)}</strong></div>
                </div>
              </div>
            </section>
          </div>
          {order.payment_plan === "pay_at_pickup" && ["pending_approval", "confirmed", "preparing", "ready"].includes(order.status) && (
            <button type="button" onClick={() => void cancelOrder()} className="customer-btn-secondary mt-5">
              Cancel order
            </button>
          )}
          <div className="mt-5 flex flex-wrap gap-3">
            <Link to={`/reservation/status?bookingId=${encodeURIComponent(order.order_number)}`} className="customer-btn-primary">
              Check pickup status
            </Link>
            <p className="self-center text-xs text-[var(--customer-muted)]">Status refreshes automatically while this page is open.</p>
          </div>
          {message && <p className="reservation-checkout-alert mt-4" role="status">{message}</p>}
        </section>
      ) : (
        <>
          <section className="customer-reservation-form grid w-full items-start gap-6 pb-28 lg:grid-cols-[minmax(0,1fr)_400px] lg:gap-3 lg:pb-0">
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
                              const disabled = !product.is_available;
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
                                    <span className={`customer-menu-product-status ${disabled ? "is-unavailable" : "is-available"}`}>{disabled ? "Not available" : "Available"}</span>
                                    {quantity > 0 ? (
                                      <div className="customer-menu-quantity-control" aria-label={`Quantity of ${product.name}`}>
                                        <button type="button" aria-label={`Remove one ${product.name}`} onClick={() => adjustQuantity(product.id, -1)}>−</button>
                                        <span aria-live="polite">{quantity}</span>
                                        <button type="button" aria-label={`Add one ${product.name}`} disabled={disabled || quantity >= 100} onClick={() => adjustQuantity(product.id, 1)}>+</button>
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

            <form
              id="takeout-checkout-form"
              className="reservation-checkout-aside rounded-2xl border border-katana-border bg-[var(--customer-surface)] p-3 text-[var(--customer-text)] shadow-xl"
              onSubmit={submitOrder}
            >
              <section id="takeout-contact-details" className="reservation-panel-section" aria-label="Contact details">
                <h2 className="customer-label mb-2">Contact details</h2>
                <div className="grid gap-3">
                  <label className="grid gap-1 text-sm font-semibold text-[var(--customer-text)]">
                    Name *
                    <input
                      className="customer-input"
                      autoComplete="name"
                      maxLength={120}
                      value={customerName}
                      onChange={(event) => setCustomerName(event.target.value)}
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
                      pattern="[0-9]{1,11}"
                      maxLength={11}
                      value={customerPhone}
                      onChange={(event) => setCustomerPhone(event.target.value.replace(/\D/g, "").slice(0, 11))}
                      required
                    />
                  </label>
                </div>
              </section>
              <h2 className="reservation-panel-title mt-4">Your pickup order</h2>
              <div className="reservation-panel-sections">
                <section className="reservation-panel-section" aria-label="Pickup order items">
                  <div className="reservation-order-items">
                    {cart.length === 0 ? (
                      <p className="reservation-empty-summary">Your order is empty. Add an available menu item to continue.</p>
                    ) : cart.map(({ product, quantity }) => (
                      <div key={product.id} className="reservation-order-item">
                        <div className="reservation-order-item-info"><p>{product.name} × {quantity}</p></div>
                        <p className="reservation-order-item-price">{formatMoney(product.price * quantity)}</p>
                      </div>
                    ))}
                  </div>
                  <div className="reservation-order-totals">
                    <div className="reservation-order-total"><span>Total</span><strong>{formatMoney(total)}</strong></div>
                  </div>
                </section>
              </div>
              <div className="reservation-checkout-submit">
                <button type="submit" className="customer-btn-primary w-full" disabled={submitting || cart.length === 0}>
                  {submitting ? "Submitting..." : "Confirm pickup order"}
                </button>
              </div>
              {message && <p className="reservation-checkout-alert mt-3" role="alert">{message}</p>}
            </form>
          </section>

          <div className="reservation-mobile-cart">
            {mobileCartOpen && (
              <button type="button" className="reservation-mobile-cart-backdrop" aria-label="Close cart" onClick={() => setMobileCartOpen(false)} />
            )}
            <section id="takeout-mobile-cart" className="reservation-mobile-cart-sheet" aria-label="Pickup cart" hidden={!mobileCartOpen}>
              <div className="reservation-mobile-cart-heading">
                <div><h2>Your pickup order</h2><p>{cartItemCount} selected item{cartItemCount === 1 ? "" : "s"}</p></div>
                <div className="reservation-mobile-cart-total"><strong>{formatMoney(total)}</strong><button type="button" onClick={() => setMobileCartOpen(false)}>Close</button></div>
              </div>
              {cart.length === 0 ? <p className="reservation-mobile-cart-empty">Add an available menu item to continue.</p> : (
                <div className="reservation-mobile-cart-items">
                  {cart.map(({ product, quantity }) => (
                    <article key={product.id} className="reservation-mobile-cart-item">
                      <div className="reservation-mobile-cart-item-main">
                        <div className="reservation-mobile-cart-item-copy"><p>{product.name}</p><span>{formatMoney(product.price * quantity)}</span></div>
                        <div className="reservation-mobile-cart-quantity" aria-label={`Quantity of ${product.name}`}>
                          <button type="button" aria-label={`Remove one ${product.name}`} onClick={() => adjustQuantity(product.id, -1)}>−</button>
                          <span aria-live="polite">{quantity}</span>
                          <button type="button" aria-label={`Add one ${product.name}`} disabled={quantity >= 100} onClick={() => adjustQuantity(product.id, 1)}>+</button>
                        </div>
                      </div>
                      <button type="button" className="reservation-mobile-cart-remove" onClick={() => adjustQuantity(product.id, -quantity)}>Remove</button>
                    </article>
                  ))}
                </div>
              )}
              <button
                type="button"
                className="customer-btn-primary mt-3 w-full"
                disabled={cart.length === 0}
                onClick={() => {
                  setMobileCartOpen(false);
                  document.getElementById("takeout-contact-details")?.scrollIntoView({ behavior: "smooth", block: "start" });
                }}
              >
                Continue to checkout
              </button>
            </section>
            <button type="button" className="reservation-mobile-cart-toggle" onClick={() => setMobileCartOpen((open) => !open)} aria-expanded={mobileCartOpen} aria-controls="takeout-mobile-cart">
              <span className="reservation-mobile-cart-toggle-copy"><ShoppingCart aria-hidden="true" /><span><strong>Your Cart</strong><small>{cartItemCount} item{cartItemCount === 1 ? "" : "s"}</small></span></span>
              <span className="reservation-mobile-cart-toggle-total"><strong>{formatMoney(total)}</strong><ChevronDown className={mobileCartOpen ? "is-open" : ""} aria-hidden="true" /></span>
            </button>
          </div>

        </>
      )}
    </main>
  );
}

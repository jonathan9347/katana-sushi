import { FormEvent, useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import axios from "axios";
import { CalendarCheck, Check, ChevronDown, Search, ShoppingCart } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { api, resolveBackendImageUrl, resolveImageUrl } from "../../lib/api";
import BackToHome from "../../components/layout/BackToHome";
import { getApiErrorMessage } from "../../lib/errors";
import { Dialog } from "../../components/ui/dialog";
import {
  clearCustomerPaymentAttempt,
  createPaymentIntent,
  getOrCreateCustomerPaymentAttempt,
  getPaymentStatus,
  getSavedCustomerPaymentAttempt,
  saveCustomerPaymentIntentReference,
  verifyPayment,
  type PaymentMethod
} from "../../lib/payment";
import { formatManilaDateTime, formatTime12, todayManilaDateKey } from "../../lib/dateTime";
import {
  clampReservationTime,
  fetchReservationRules,
  getServerNow,
  isValidReservationTime,
  manilaDateKeyAt,
  minutesToTime,
  nextAllowedTime,
  timeToMinutes
} from "../../lib/reservationRules";
import { defaultSystemSettings, fetchSystemSettings } from "../../lib/systemSettings";
import "./ReservationForm.css";

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

type ProductAvailability = {
  product_id: string;
  available: boolean;
  can_add: boolean;
  maximum_quantity: number;
};

type CartItem = {
  product_id: string;
  name: string;
  quantity: number;
  price: number;
};

type MobileCartEntry = {
  product_id: string;
  name: string;
  quantity: number;
  lineTotal?: number;
  canIncrease: boolean;
};

type MobileCartSheetProps = {
  open: boolean;
  title: string;
  itemCount: number;
  total: number;
  items: MobileCartEntry[];
  onToggle: () => void;
  onClose: () => void;
  onDecrease: (productId: string) => void;
  onIncrease: (productId: string) => void;
  onRemove: (productId: string) => void;
};

function MobileCartSheet({
  open,
  title,
  itemCount,
  total,
  items,
  onToggle,
  onClose,
  onDecrease,
  onIncrease,
  onRemove
}: MobileCartSheetProps) {
  return (
    <>
      {open && (
        <button
          type="button"
          className="reservation-mobile-cart-backdrop"
          aria-label="Close cart"
          onClick={onClose}
        />
      )}
      <div className="reservation-mobile-cart">
        <section
          id="reservation-mobile-cart-sheet"
          className="reservation-mobile-cart-sheet"
          aria-label={title}
          hidden={!open}
        >
          <div className="reservation-mobile-cart-heading">
            <div>
              <h2>{title}</h2>
              <p>{itemCount} selected item{itemCount === 1 ? "" : "s"}</p>
            </div>
            <div className="reservation-mobile-cart-total">
              <strong>{money(total)}</strong>
              <button type="button" onClick={onClose} aria-label="Close cart">Close</button>
            </div>
          </div>
          {items.length === 0 ? (
            <p className="reservation-mobile-cart-empty">Add an available menu item to continue.</p>
          ) : (
            <div className="reservation-mobile-cart-items">
              {items.map((item) => (
                <article key={item.product_id} className="reservation-mobile-cart-item">
                  <div className="reservation-mobile-cart-item-main">
                    <div className="reservation-mobile-cart-item-copy">
                      <p>{item.name}</p>
                      <span>{item.lineTotal === undefined ? "Included in package" : money(item.lineTotal)}</span>
                    </div>
                    <div className="reservation-mobile-cart-quantity" aria-label={`Quantity of ${item.name}`}>
                      <button type="button" aria-label={`Remove one ${item.name}`} onClick={() => onDecrease(item.product_id)}>−</button>
                      <span aria-live="polite">{item.quantity}</span>
                      <button type="button" aria-label={`Add one ${item.name}`} onClick={() => onIncrease(item.product_id)} disabled={!item.canIncrease}>+</button>
                    </div>
                  </div>
                  <button type="button" className="reservation-mobile-cart-remove" onClick={() => onRemove(item.product_id)}>Remove</button>
                </article>
              ))}
            </div>
          )}
        </section>
        <button
          type="button"
          className="reservation-mobile-cart-toggle"
          onClick={onToggle}
          aria-expanded={open}
          aria-controls="reservation-mobile-cart-sheet"
        >
          <span className="reservation-mobile-cart-toggle-copy">
            <ShoppingCart aria-hidden="true" />
            <span>
              <strong>Your Cart</strong>
              <small>{itemCount} item{itemCount === 1 ? "" : "s"}</small>
            </span>
          </span>
          <span className="reservation-mobile-cart-toggle-total">
            <strong>{money(total)}</strong>
            <ChevronDown className={open ? "is-open" : ""} aria-hidden="true" />
          </span>
        </button>
      </div>
    </>
  );
}

type UnlimitedSettings = {
  id: string;
  price_per_person: number;
  time_limit_minutes: number;
  leftover_charge_percent: number;
};

type ReservationSuccess = {
  bookingId: string;
  paidAmount: number;
  remainingBalance: number;
  paymentPlan: "full_payment" | "pay_at_venue";
};

const PRODUCT_IMAGE_QUERY_OPTIONS = {
  staleTime: 5 * 60 * 1000,
  gcTime: 30 * 60 * 1000,
  refetchOnMount: false,
  refetchOnWindowFocus: false
};

function today() {
  return todayManilaDateKey();
}

function formatReservationDate(date: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return "Choose a date";
  const [year, month, day] = date.split("-").map(Number);
  return new Intl.DateTimeFormat("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    timeZone: "UTC"
  }).format(new Date(Date.UTC(year, month - 1, day)));
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

function fallbackToBackendImage(element: HTMLImageElement, product: Product) {
  const backendImageUrl = resolveBackendImageUrl(product.image_url ?? product.imageUrl ?? product.image ?? product.thumbnail);

  if (backendImageUrl && element.src !== backendImageUrl) {
    element.src = backendImageUrl;
  }
}

export default function ReservationForm() {
  const [form, setForm] = useState({
    date: today(),
    time: "",
    party_size: "1",
    customer_name: "",
    customer_phone: "",
    customer_email: ""
  });
  const [reservationType, setReservationType] = useState<"dine_in" | "unlimited">("dine_in");

  // Customer-facing: only Dine-in / Unlimited. Keep layout readable in dark theme.
  const [cartItems, setCartItems] = useState<CartItem[]>([]);
  const [cartHydrated, setCartHydrated] = useState(false);
  const [isMobileCartOpen, setIsMobileCartOpen] = useState(false);
  const [activeMenuCategory, setActiveMenuCategory] = useState("All");
  const [menuSearch, setMenuSearch] = useState("");
  const [selectedUnlimitedProductQuantities, setSelectedUnlimitedProductQuantities] = useState<Record<string, number>>({});

  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>("cash");
  const [paymentPlan, setPaymentPlan] = useState<"full_payment" | "pay_at_venue">("pay_at_venue");
  const [acknowledged, setAcknowledged] = useState(false);
  const [message, setMessage] = useState("");
  const [paymentNotice, setPaymentNotice] = useState("");
  const [isProcessingPayment, setIsProcessingPayment] = useState(false);
  const [success, setSuccess] = useState<ReservationSuccess | null>(null);
  const [bookingDetailsOpen, setBookingDetailsOpen] = useState(true);
  const [reservationRulesOpen, setReservationRulesOpen] = useState(false);
  const [validationTarget, setValidationTarget] = useState<"booking" | "menu" | "availability" | "rules" | null>(null);
  const [bookingTimeNotice, setBookingTimeNotice] = useState("");
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [clockTick, setClockTick] = useState(0);
  const paymentInFlightRef = useRef(false);
  const categoryTabsRef = useRef<HTMLDivElement | null>(null);
  const initializedDateRef = useRef(false);
  const previousReservationTimeValidRef = useRef<boolean | null>(null);

  const reservationRulesQuery = useQuery({
    queryKey: ["reservation-rules"],
    queryFn: fetchReservationRules,
    retry: 1,
    refetchInterval: 30_000
  });
  const reservationRulesData = reservationRulesQuery.data;
  const reservationRules = reservationRulesData?.settings;
  const serverNow = reservationRulesData ? getServerNow(reservationRulesData) : new Date();
  const serverToday = reservationRules ? manilaDateKeyAt(serverNow, reservationRules.TIME_ZONE) : today();

  useEffect(() => {
    const timer = window.setInterval(() => setClockTick((tick) => tick + 1), 15_000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    if (!reservationRules || initializedDateRef.current) {
      return;
    }
    initializedDateRef.current = true;
    const todayDate = manilaDateKeyAt(serverNow, reservationRules.TIME_ZONE);
    setForm((current) => ({
      ...current,
      date: todayDate,
      time: ""
    }));
  }, [reservationRules, reservationRulesData, clockTick]);

  useEffect(() => {
    let cancelled = false;
    let attempt: ReturnType<typeof getSavedCustomerPaymentAttempt>;

    try {
      attempt = getSavedCustomerPaymentAttempt("dine_in");
    } catch {
      setPaymentNotice("Payment recovery is unavailable in this browser session. Keep this tab open while paying.");
      return;
    }

    if (!attempt?.referenceId) {
      return;
    }

    getPaymentStatus(attempt.referenceId)
      .then(async (status) => {
        if (cancelled) {
          return;
        }

        if (status.status === "paid") {
          try {
            const booking = await api.get<{
              downpayment_amount: number;
              remaining_balance: number;
              payment_plan: "full_payment" | "pay_at_venue";
              net_paid: number;
            }>(`/api/reservations/status/${encodeURIComponent(attempt.bookingId)}`);
            if (cancelled) {
              return;
            }
            clearCustomerPaymentAttempt("dine_in", attempt.bookingId);
            setSuccess({
              bookingId: attempt.bookingId,
              paidAmount: Number(booking.data.net_paid),
              remainingBalance: Number(booking.data.remaining_balance),
              paymentPlan: booking.data.payment_plan
            });
            return;
          } catch (error) {
            if (!axios.isAxiosError(error) || error.response?.status !== 404) {
              throw error;
            }
          }

          setPaymentNotice("A completed payment was found. Re-enter the same reservation details and select Pay to finish your booking.");
        } else if (status.status === "created" || status.status === "pending") {
          setPaymentNotice("A payment is still in progress. Re-enter the same reservation details and select Pay to continue.");
        } else {
          clearCustomerPaymentAttempt("dine_in", attempt?.bookingId);
          setPaymentNotice("The previous payment attempt ended. You can start a new payment.");
        }
      })
      .catch(() => {
        if (!cancelled) {
          setPaymentNotice("Could not check the previous payment status. Reconnect and try again before starting another payment.");
        }
      });

    return () => {
      cancelled = true;
    };
  }, []);

  const {
    data: productsData,
    isLoading: productsLoading,
    isError: productsError,
    refetch: refetchProducts
  } = useQuery({
    queryKey: ["customer-menu-products"],
    queryFn: async () => (await api.get<{ products: Product[] }>("/api/products")).data.products,
    retry: 1,
    ...PRODUCT_IMAGE_QUERY_OPTIONS,
    refetchInterval: 15_000,
    refetchOnWindowFocus: true
  });

  const { data: unlimitedSettingsData } = useQuery({
    queryKey: ["unlimited-settings"],
    queryFn: async () => (await api.get<{ settings: UnlimitedSettings }>("/api/unlimited/settings")).data.settings,
    retry: 1
  });

  const {
    data: unlimitedProductIdsData,
    isLoading: unlimitedProductsLoading,
    isError: unlimitedProductsError,
    refetch: refetchUnlimitedProducts
  } = useQuery({
    queryKey: ["customer-unlimited-products"],
    queryFn: async () => (await api.get<{ productIds: string[] }>("/api/unlimited/products")).data.productIds,
    retry: 1
  });

  const { data: systemSettingsData } = useQuery({
    queryKey: ["system-settings"],
    queryFn: fetchSystemSettings,
    retry: 1
  });

  const systemSettings = systemSettingsData ?? defaultSystemSettings;
  const products = productsData ?? [];
  const selectedProductsForAvailability = useMemo(
    () => reservationType === "unlimited"
      ? Object.entries(selectedUnlimitedProductQuantities)
          .filter(([, quantity]) => quantity > 0)
          .map(([product_id, quantity]) => ({ product_id, quantity }))
      : cartItems.map(({ product_id, quantity }) => ({ product_id, quantity })),
    [reservationType, selectedUnlimitedProductQuantities, cartItems]
  );
  const availabilityQuery = useQuery({
    queryKey: ["reservation-product-availability", selectedProductsForAvailability],
    queryFn: async () => (await api.post<{ availability: ProductAvailability[]; checked_at: string }>(
      "/api/reservations/dine-in/availability",
      { selected_products: selectedProductsForAvailability }
    )).data,
    retry: 1,
    staleTime: 10_000,
    refetchInterval: 15_000,
    refetchOnWindowFocus: true
  });
  const availabilityByProduct = useMemo(
    () => new Map((availabilityQuery.data?.availability ?? []).map((item) => [item.product_id, item])),
    [availabilityQuery.data]
  );
  const reservationTimeValid = Boolean(reservationRules && isValidReservationTime(
    form.date,
    form.time,
    reservationRules,
    serverNow
  ));
  const [hourText, minuteText] = form.time ? form.time.split(":") : ["", ""];
  const hour24 = Number(hourText || reservationRules?.OPENING_TIME.split(":")[0] || 12);
  const displayHour = hour24 % 12 || 12;
  const period = hour24 >= 12 ? "PM" : "AM";
  const productImageUrls = useMemo(() => {
    return Array.from(
      new Set(products.map((product) => getProductImageUrl(product)).filter((url): url is string => Boolean(url)))
    );
  }, [products]);
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
  const filteredProductGroups = useMemo(() => {
    const query = menuSearch.trim().toLowerCase();
    if (!query) return productGroups;
    return productGroups
      .map((group) => ({
        ...group,
        products: group.products.filter((product) =>
          `${product.name} ${product.description ?? ""} ${group.category}`.toLowerCase().includes(query)
        )
      }))
      .filter((group) => group.products.length > 0);
  }, [menuSearch, productGroups]);
  const unlimitedProducts = useMemo(() => {
    const includedIds = new Set(unlimitedProductIdsData ?? []);
    return products.filter((product) => includedIds.has(product.id));
  }, [products, unlimitedProductIdsData]);
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
  const filteredUnlimitedProductGroups = useMemo(() => {
    const query = menuSearch.trim().toLowerCase();
    if (!query) return unlimitedProductGroups;
    return unlimitedProductGroups
      .map((group) => ({
        ...group,
        products: group.products.filter((product) =>
          `${product.name} ${product.description ?? ""} ${group.category}`.toLowerCase().includes(query)
        )
      }))
      .filter((group) => group.products.length > 0);
  }, [menuSearch, unlimitedProductGroups]);
  const visibleProductGroups = reservationType === "dine_in"
    ? filteredProductGroups
    : filteredUnlimitedProductGroups;
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

  useEffect(() => {
    productImageUrls.forEach((url) => {
      const image = new Image();
      image.decoding = "async";
      image.src = url;
    });
  }, [productImageUrls]);

  useEffect(() => {
    let saved: string | null;
    try {
      saved = localStorage.getItem("katana-customer-dine-in-cart");
    } catch (error) {
      if (error instanceof DOMException) {
        setPaymentNotice("This browser does not allow saving your cart. Your current cart will remain available until you leave this page.");
        setCartHydrated(true);
        return;
      }
      throw error;
    }

    if (!saved) {
      setCartHydrated(true);
      return;
    }
    try {
      const parsed: unknown = JSON.parse(saved);
      if (typeof parsed === "object" && parsed !== null) {
        const record = parsed as {
          cartItems?: unknown;
          selectedUnlimitedProductQuantities?: unknown;
          reservationType?: unknown;
        };
        if (Array.isArray(record.cartItems)) {
          setCartItems(record.cartItems.filter((item): item is CartItem =>
            typeof item === "object" && item !== null &&
            typeof (item as CartItem).product_id === "string" &&
            typeof (item as CartItem).name === "string" &&
            Number.isInteger((item as CartItem).quantity) &&
            Number((item as CartItem).quantity) > 0 &&
            Number.isFinite((item as CartItem).price)
          ));
        }
        if (typeof record.selectedUnlimitedProductQuantities === "object" && record.selectedUnlimitedProductQuantities !== null) {
          const quantities = Object.fromEntries(
            Object.entries(record.selectedUnlimitedProductQuantities)
              .filter((entry): entry is [string, number] =>
                typeof entry[0] === "string" && Number.isInteger(entry[1]) && Number(entry[1]) > 0
              )
          );
          setSelectedUnlimitedProductQuantities(quantities);
        }
        if (record.reservationType === "dine_in" || record.reservationType === "unlimited") {
          setReservationType(record.reservationType);
        }
      }
    } catch (error) {
      if (error instanceof SyntaxError) {
        setMessage("The saved cart could not be read and has been cleared.");
      } else {
        throw error;
      }
    } finally {
      setCartHydrated(true);
    }
  }, []);

  useEffect(() => {
    if (!cartHydrated) return;
    try {
      localStorage.setItem("katana-customer-dine-in-cart", JSON.stringify({
        cartItems,
        selectedUnlimitedProductQuantities,
        reservationType
      }));
    } catch (error) {
      if (error instanceof DOMException) {
        setPaymentNotice("This browser cannot save your cart across page refreshes.");
        return;
      }
      throw error;
    }
  }, [cartHydrated, cartItems, selectedUnlimitedProductQuantities, reservationType]);

  useEffect(() => {
    if (!cartHydrated || !productsData) return;
    const currentProducts = new Map(productsData.map((product) => [product.id, product]));
    setCartItems((current) => {
      let changed = false;
      const updated = current.map((item) => {
        const product = currentProducts.get(item.product_id);
        if (!product) return item;
        const price = Number(product.price);
        if (item.name === product.name && item.price === price) return item;
        changed = true;
        return { ...item, name: product.name, price };
      });
      return changed ? updated : current;
    });
  }, [cartHydrated, productsData]);

  const productQuantityAvailable = (product: Product) =>
    Math.max(0, Math.floor(availabilityByProduct.get(product.id)?.maximum_quantity ?? 0));
  const canIncreaseCartItem = (item: CartItem) =>
    item.quantity < (availabilityByProduct.get(item.product_id)?.maximum_quantity ?? 0);

  const addProduct = (product: Product) => {
    if (!product.id || product.is_available === false || !availabilityByProduct.get(product.id)?.can_add) {
      return;
    }

    setValidationTarget(null);
    setCartItems((current) => {
      const existing = current.find((item) => item.product_id === product.id);
      if (existing) {
        if (existing.quantity >= productQuantityAvailable(product)) {
          return current;
        }
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
    setValidationTarget(null);
    const product = products.find((item) => item.id === productId);
    const nextQuantity = Math.min(
      product ? productQuantityAvailable(product) : 0,
      Math.max(0, quantity)
    );

    setCartItems((current) =>
      current
        .map((item) =>
          item.product_id === productId ? { ...item, quantity: nextQuantity } : item
        )
        .filter((item) => item.quantity > 0)
    );
  };

  const removeCartItem = (productId: string) => {
    setValidationTarget(null);
    setCartItems((current) => current.filter((item) => item.product_id !== productId));
  };

  const toggleUnlimitedProduct = (productId: string) => {
    setValidationTarget(null);
    setSelectedUnlimitedProductQuantities((current) => {
      const exists = (current[productId] ?? 0) > 0;
      if (exists) {
        const next = { ...current };
        delete next[productId];
        return next;
      }

      const product = unlimitedProducts.find((item) => item.id === productId);
      if (!product || product.is_available === false || productQuantityAvailable(product) <= 0) {
        return current;
      }

      return { ...current, [productId]: 1 };
    });
  };

  const updateUnlimitedQuantity = (productId: string, delta: number) => {
    setValidationTarget(null);
    setSelectedUnlimitedProductQuantities((current) => {
      const currentQty = current[productId] ?? 0;
      const product = unlimitedProducts.find((item) => item.id === productId);
      const requestedQty = Math.max(0, currentQty + delta);
      const nextQty = Math.min(product ? productQuantityAvailable(product) : 0, requestedQty);
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

  const totalPrice = Number(subtotal.toFixed(2));
  const cartItemCount = useMemo(() => cartItems.reduce((sum, item) => sum + item.quantity, 0), [cartItems]);
  const mobileCartItems: MobileCartEntry[] = reservationType === "unlimited"
    ? selectedUnlimitedProducts.map((item) => ({
        product_id: item.product_id,
        name: item.name,
        quantity: item.quantity,
        canIncrease: item.quantity < (availabilityByProduct.get(item.product_id)?.maximum_quantity ?? 0)
      }))
    : cartItems.map((item) => ({
        product_id: item.product_id,
        name: item.name,
        quantity: item.quantity,
        lineTotal: item.price * item.quantity,
        canIncrease: item.quantity < (availabilityByProduct.get(item.product_id)?.maximum_quantity ?? 0)
      }));
  const isFullPayment = paymentPlan === "full_payment";
  const paymentAmount = isFullPayment ? totalPrice : 0;
  const unavailableSelectedItems = (reservationType === "dine_in" ? cartItems : selectedUnlimitedProducts)
    .filter((item) => (availabilityByProduct.get(item.product_id)?.maximum_quantity ?? 0) < item.quantity);
  const menuDataUnavailable = productsLoading || productsError || !cartHydrated ||
    (reservationType === "unlimited" && (!unlimitedProductIdsData || unlimitedProductsLoading || unlimitedProductsError));
  const noSelectedItems = (reservationType === "dine_in" && cartItems.length === 0) ||
    (reservationType === "unlimited" && selectedUnlimitedCount === 0);
  const availabilityUnavailable = availabilityQuery.isLoading || availabilityQuery.isError || !availabilityQuery.data;
  const canContinueToDetails = Boolean(reservationRules && reservationTimeValid) &&
    !menuDataUnavailable && !availabilityUnavailable && unavailableSelectedItems.length === 0 &&
    !noSelectedItems && acknowledged && !isProcessingPayment;
  const continueHelp = isProcessingPayment
    ? "Processing your reservation..."
    : !reservationRules
      ? "Booking rules are unavailable. Please try again shortly."
      : !reservationTimeValid
        ? "Choose a valid date and time."
        : menuDataUnavailable
          ? "Check current menu availability before continuing."
          : availabilityQuery.isError
            ? "Current availability could not be checked. Please retry."
            : availabilityQuery.isLoading || !availabilityQuery.data
              ? "Checking current menu availability..."
              : unavailableSelectedItems.length > 0
                ? "Adjust unavailable items before continuing."
                : noSelectedItems
                  ? reservationType === "dine_in"
                    ? "Add a menu item to continue."
                    : "Select an included Unlimited item to continue."
                  : !acknowledged
                    ? "Agree to the reservation rules to continue."
                    : `Availability is current as of ${formatManilaDateTime(availabilityQuery.data.checked_at)}. Your booking is confirmed only after staff approval.`;

  useEffect(() => {
    if (validationTarget === "availability" && !availabilityQuery.isLoading && !availabilityQuery.isError && unavailableSelectedItems.length === 0) {
      setValidationTarget(null);
    }
  }, [availabilityQuery.data, availabilityQuery.isError, availabilityQuery.isLoading, validationTarget, unavailableSelectedItems.length]);

  function focusContinueIssue(target: "booking" | "menu" | "availability" | "rules") {
    setValidationTarget(target);
    window.requestAnimationFrame(() => {
      const targetId = target === "booking"
        ? "reservation-booking-card"
        : target === "menu"
          ? "reservation-products-top"
          : target === "availability"
            ? unavailableSelectedItems.length > 0
              ? "reservation-unavailable-items"
              : "reservation-availability-status"
            : "reservation-acknowledgement";
      const element = document.getElementById(targetId);
      element?.scrollIntoView({ behavior: "auto", block: "center" });
      if (target === "booking") {
        document.querySelector<HTMLInputElement>("#reservation-details-fields input[type='date']")?.focus({ preventScroll: true });
      } else if (target === "rules") {
        document.getElementById("reservation-acknowledgement")?.focus({ preventScroll: true });
      }
    });
  }

  function handleContinueToDetails() {
    if (isProcessingPayment) return;
    setMessage("");

    if (!reservationRules || !reservationTimeValid) {
      setBookingDetailsOpen(true);
      focusContinueIssue("booking");
      return;
    }

    if (productsLoading || productsError || !cartHydrated ||
      (reservationType === "unlimited" && (!unlimitedProductIdsData || unlimitedProductsLoading || unlimitedProductsError))) {
      focusContinueIssue("menu");
      return;
    }

    if (availabilityQuery.isLoading || availabilityQuery.isError || unavailableSelectedItems.length > 0) {
      focusContinueIssue("availability");
      return;
    }

    if ((reservationType === "dine_in" && cartItems.length === 0) ||
      (reservationType === "unlimited" && selectedUnlimitedCount === 0)) {
      focusContinueIssue("menu");
      return;
    }

    if (!acknowledged) {
      setReservationRulesOpen(true);
      focusContinueIssue("rules");
      return;
    }

    setValidationTarget(null);
    setDetailsOpen(true);
  }

  const isValidPhone = useMemo(() => /^09\d{9}$/.test(form.customer_phone), [form.customer_phone]);

  function setField(field: keyof typeof form, value: string) {
    setForm((current) => ({ ...current, [field]: value }));
    if (field === "date" || field === "time") {
      setValidationTarget(null);
    }
  }

  function setDigitalTime(hour: number, minute: number, selectedPeriod: "AM" | "PM") {
    if (!reservationRules) return;
    const normalizedHour = Math.max(1, Math.min(12, Math.floor(hour)));
    const normalizedMinute = Math.max(0, Math.min(59, Math.floor(minute)));
    const hourOfDay = (normalizedHour % 12) + (selectedPeriod === "PM" ? 12 : 0);
    const candidate = minutesToTime(hourOfDay * 60 + normalizedMinute);
    setField("time", clampReservationTime(form.date, candidate, reservationRules, serverNow));
  }

  useEffect(() => {
    if (!reservationRules) return;
    if (!reservationTimeValid) {
      if (previousReservationTimeValidRef.current !== false) {
        setBookingDetailsOpen(true);
      }
      previousReservationTimeValidRef.current = false;
      const scheduledTime = Date.parse(`${form.date}T${form.time}:00+08:00`);
      setBookingTimeNotice(
        form.date && form.time && Number.isFinite(scheduledTime) && scheduledTime <= serverNow.getTime()
          ? "The selected time has passed. Choose a new time."
          : ""
      );
      return;
    }
    if (previousReservationTimeValidRef.current !== true) {
      setBookingDetailsOpen(false);
    }
    previousReservationTimeValidRef.current = true;
    setBookingTimeNotice("");
    setValidationTarget((current) => current === "booking" ? null : current);
  }, [reservationRules, reservationTimeValid, form.date, form.time, reservationRulesData]);

  useEffect(() => {
    if (visibleProductGroups.length === 0) {
      setActiveMenuCategory("All");
      return;
    }

    setActiveMenuCategory((current) =>
      current === "All" || visibleProductGroups.some((group) => group.category === current)
        ? current
        : visibleProductGroups[0].category
    );
  }, [visibleProductGroups]);

  useEffect(() => {
    if (visibleProductGroups.length === 0) {
      return;
    }

    function updateActiveCategory() {
      const marker = window.innerWidth >= 768 ? 170 : 126;
      let activeCategory = "All";

      visibleProductGroups.forEach((group) => {
        const section = document.getElementById(categorySectionId(group.category));
        if (!section) {
          return;
        }

        const rect = section.getBoundingClientRect();
        if (rect.top <= marker) {
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
  }, [visibleProductGroups]);

  useEffect(() => {
    if (!activeMenuCategory) {
      return;
    }

    const tabsContainer = categoryTabsRef.current;
    const activeTab = tabsContainer?.querySelector<HTMLButtonElement>(
      `[data-category-tab="${categorySectionId(activeMenuCategory)}"]`
    );

    if (!tabsContainer || !activeTab) {
      return;
    }

    const nextScrollLeft = activeTab.offsetLeft - tabsContainer.clientWidth / 2 + activeTab.clientWidth / 2;
    tabsContainer.scrollTo({ left: Math.max(0, nextScrollLeft), behavior: "smooth" });
  }, [activeMenuCategory, reservationType]);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (paymentInFlightRef.current) {
      return;
    }

    paymentInFlightRef.current = true;
    setMessage("");
    setPaymentNotice("");
    setIsProcessingPayment(true);

    if (!acknowledged) {
      setMessage("Please agree to the reservation rules before submitting.");
      setIsProcessingPayment(false);
      paymentInFlightRef.current = false;
      return;
    }

    if (
      !form.customer_name.trim() ||
      !isValidPhone ||
      !form.customer_email.trim() ||
      !reservationRules ||
      !reservationTimeValid ||
      Number(form.party_size) < 1 ||
      Number(form.party_size) > reservationRules.MAX_GUESTS_PER_BOOKING
    ) {
      setMessage("Check the guest details and choose a valid future date and time within opening hours.");
      setIsProcessingPayment(false);
      paymentInFlightRef.current = false;
      return;
    }

    if (reservationType === "unlimited" && (!unlimitedSettingsData || selectedUnlimitedCount === 0)) {
      setMessage("Select at least one available product from the Unlimited menu.");
      setIsProcessingPayment(false);
      paymentInFlightRef.current = false;
      return;
    }

    if (reservationType === "dine_in" && cartItems.length === 0) {
      setMessage("Add at least one available menu item before submitting.");
      setIsProcessingPayment(false);
      paymentInFlightRef.current = false;
      return;
    }

    try {
      const rulesResult = await reservationRulesQuery.refetch();
      if (rulesResult.isError || !rulesResult.data) {
        throw new Error("Reservation rules could not be refreshed. Please retry.");
      }
      const refreshedServerNow = getServerNow(rulesResult.data);
      if (!isValidReservationTime(form.date, form.time, rulesResult.data.settings, refreshedServerNow)) {
        throw new Error("That reservation time is no longer available. Choose a future time within the opening hours.");
      }

      const availabilityResult = await availabilityQuery.refetch();
      if (availabilityResult.isError || !availabilityResult.data) {
        throw new Error("Current menu availability could not be checked. Please retry.");
      }
      const requestedProducts = reservationType === "dine_in" ? cartItems : selectedUnlimitedProducts;
      const latestAvailability = new Map(
        availabilityResult.data.availability.map((item) => [item.product_id, item])
      );
      const unavailableSelection = requestedProducts.find((item) =>
        (latestAvailability.get(item.product_id)?.maximum_quantity ?? 0) < item.quantity
      );
      if (unavailableSelection) {
        throw new Error(`${unavailableSelection.name} is no longer available in that quantity. Update your menu selection and try again.`);
      }

      const bookingPayload = {
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
        payment_method: isFullPayment ? paymentMethod : null
      };
      let reservationReference: string | undefined;
      let paymentInstructions: string | undefined;
      let transactionId: string | undefined;

      if (isFullPayment) {
        const attempt = await getOrCreateCustomerPaymentAttempt(
          "dine_in",
          { bookingPayload, paymentAmount },
          reservationType === "unlimited" ? "KTN-UNL" : "KTN-DINE",
          "full_payment"
        );
        reservationReference = attempt.bookingId;
        const paymentIntent = await createPaymentIntent({
          amount: paymentAmount,
          paymentMethod,
          bookingId: reservationReference,
          reservationType: "dine_in",
          purpose: "full_payment",
          idempotencyKey: attempt.idempotencyKey,
          description: `Full reservation payment for ${reservationType === "unlimited" ? "Unlimited plan" : "Dine-in"}`
        });

        if (!paymentIntent.success) {
          throw new Error(paymentIntent.message || "Unable to start payment.");
        }

        saveCustomerPaymentIntentReference("dine_in", reservationReference, paymentIntent.referenceId);
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
          if (verification.status === "failed") {
            clearCustomerPaymentAttempt("dine_in", reservationReference);
          }
          throw new Error(verification.message || "Payment verification failed.");
        }
        transactionId = verification.transactionId;
        paymentInstructions = paymentIntent.instructions;
      }

      const response = await api.post<{
        booking_id: string;
        paid_amount: number;
        remaining_balance: number;
        payment_plan: "full_payment" | "pay_at_venue";
      }>('/api/reservations/dine-in', {
        ...bookingPayload,
        ...(transactionId ? { payment_transaction_id: transactionId } : {}),
        ...(reservationReference ? { booking_id: reservationReference } : {})
      });

      if (reservationReference) {
        clearCustomerPaymentAttempt("dine_in", reservationReference);
      }
      setSuccess({
        bookingId: response.data.booking_id,
        paidAmount: response.data.paid_amount,
        remainingBalance: response.data.remaining_balance,
        paymentPlan: response.data.payment_plan
      });
      setDetailsOpen(false);
      if (paymentInstructions) {
        setPaymentNotice(paymentInstructions);
      }
    } catch (error) {
      setMessage(getApiErrorMessage(error, "Payment failed. Please try again or choose another payment method."));
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
                <CalendarCheck className="h-5 w-5 text-emerald-400" /> Reservation request received
              </h1>
            </div>
            <div className="space-y-5 p-6 text-sm text-neutral-300">
              <p className="rounded-xl border border-emerald-500/20 bg-emerald-500/10 px-4 py-3 font-semibold text-emerald-300">Booking ID: {success.bookingId}</p>
              {success.paymentPlan === "full_payment" ? (
                <p>Paid in full: <span className="font-semibold text-emerald-300">{money(success.paidAmount)} paid</span></p>
              ) : (
                <>
                  <p>No payment was collected. Pay the full amount at the restaurant.</p>
                  <p>Amount due at the restaurant: <span className="font-semibold text-white">{money(success.remainingBalance)}</span></p>
                </>
              )}
              <p>Status: <span className="font-semibold text-amber-300">PENDING APPROVAL</span></p>
              <p>We will confirm your reservation within 24 hours.</p>
              <div className="grid gap-3">
                <Link className="customer-btn-primary text-center" to={`/reservation/status?bookingId=${success.bookingId}`}>
                  View Reservation Status
                </Link>
              </div>
            </div>
          </div>
        </section>
      </main>
    );
  }

  return (
    <main className="w-full px-4 pt-3 pb-4 md:px-6 md:pb-6 lg:px-3 lg:pb-3">
      <h1 className="sr-only">Reserve a table</h1>
      <form
        id="customer-reservation-form"
        onSubmit={(event) => event.preventDefault()}
        className="customer-reservation-form grid w-full items-start gap-6 pb-28 lg:grid-cols-[minmax(0,1fr)_400px] lg:gap-3 lg:pb-0"
      >
        <div className="min-w-0 lg:col-start-1 lg:row-start-1">
          <BackToHome className="mb-3" />
          <div className="space-y-6">
          <div className="flex min-w-0 flex-col gap-3 sm:flex-row sm:items-center">
            <div className="flex shrink-0 flex-wrap gap-2">
              <button type="button" onClick={() => setReservationType("dine_in")} aria-pressed={reservationType === "dine_in"} className={`rounded-xl border px-4 py-3 text-sm font-bold ${reservationType === "dine_in" ? "border-katana-red bg-katana-red text-white" : "border-katana-border bg-katana-surface text-[var(--customer-text)]"}`}>
                Regular a la carte
              </button>
              <button type="button" onClick={() => setReservationType("unlimited")} aria-pressed={reservationType === "unlimited"} className={`rounded-xl border px-4 py-3 text-sm font-bold ${reservationType === "unlimited" ? "border-katana-red bg-katana-red text-white" : "border-katana-border bg-katana-surface text-neutral-300"}`}>
                Unlimited Eat-All-You-Can
              </button>
            </div>
            <label className="relative block min-w-0 flex-1">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-katana-muted" aria-hidden="true" />
              <input
                className="customer-input pl-10"
                type="search"
                value={menuSearch}
                onChange={(event) => setMenuSearch(event.target.value)}
                placeholder="Search menu items"
                aria-label="Search menu items"
              />
            </label>
          </div>
          <section className={`min-w-0 ${validationTarget === "menu" ? "is-validation-highlight" : ""}`} aria-label="Choose menu items">
            <nav ref={categoryTabsRef} aria-label="Menu categories" className="mb-5 flex min-w-0 gap-2 overflow-x-auto pb-2">
              <button
                type="button"
                data-category-tab={categorySectionId("All")}
                aria-pressed={activeMenuCategory === "All"}
                onClick={() => {
                  setActiveMenuCategory("All");
                  document.getElementById("reservation-products-top")?.scrollIntoView({ behavior: "auto", block: "start" });
                }}
                className={`shrink-0 rounded-full border px-4 py-2 text-xs font-bold uppercase transition ${
                  activeMenuCategory === "All"
                    ? "border-katana-red bg-katana-red text-white"
                    : "border-katana-border bg-katana-surface text-neutral-300 hover:border-katana-red hover:text-white"
                }`}
              >
                All
              </button>
              {visibleProductGroups.map((group) => (
                <button
                  key={group.category}
                  type="button"
                  data-category-tab={categorySectionId(group.category)}
                  aria-pressed={activeMenuCategory === group.category}
                  onClick={() => {
                    setActiveMenuCategory(group.category);
                    document.getElementById(categorySectionId(group.category))?.scrollIntoView({ behavior: "auto", block: "start" });
                  }}
                  className={`flex shrink-0 items-center gap-2 rounded-full border px-4 py-2 text-xs font-bold uppercase transition ${
                    activeMenuCategory === group.category
                      ? "border-katana-red bg-katana-red text-white"
                      : "border-katana-border bg-katana-surface text-neutral-300 hover:border-katana-red hover:text-white"
                  }`}
                >
                  {group.category}
                  <span className="text-[10px] opacity-70">{group.products.length}</span>
                </button>
              ))}
            </nav>
            <div id="reservation-products-top" />
                  <p className="mb-4 rounded-lg border border-amber-300/30 bg-amber-500/10 px-4 py-3 text-sm text-amber-100">
                    Availability shown is current. Your booking is confirmed only after staff approval.
                  </p>
                  {availabilityQuery.isError ? (
                    <div id="reservation-availability-status" className={`mb-4 rounded-lg border border-katana-red/30 bg-katana-red/10 px-4 py-3 text-sm text-[var(--customer-text)] ${validationTarget === "availability" ? "is-validation-highlight" : ""}`} role="alert">
                      <p>Current stock availability could not be checked. Retry before selecting or submitting items.</p>
                      <button type="button" className="mt-2 font-bold text-white underline" onClick={() => void availabilityQuery.refetch()}>Retry availability check</button>
                    </div>
                  ) : availabilityQuery.data ? (
                    <p className="mb-4 text-xs text-katana-muted">
                      Availability checked {formatManilaDateTime(availabilityQuery.data.checked_at)}.
                    </p>
                  ) : (
                    <p id="reservation-availability-status" className={`mb-4 text-xs text-katana-muted ${validationTarget === "availability" ? "is-validation-highlight" : ""}`} role="status">Checking current availability...</p>
                  )}
                  {unavailableSelectedItems.length > 0 && (
                    <p id="reservation-unavailable-items" className={`mb-4 rounded-lg border border-amber-300/30 bg-amber-500/10 px-4 py-3 text-sm text-amber-100 ${validationTarget === "availability" ? "is-validation-highlight" : ""}`} role="alert">
                      Availability changed for {unavailableSelectedItems.map((item) => item.name).join(", ")}. Remove or reduce those items before submitting.
                    </p>
                  )}
                  {productsLoading ? (
                    <p className="rounded-lg border border-katana-border bg-katana-surface p-5 text-sm text-katana-muted" role="status">Loading the current menu...</p>
                  ) : productsError ? (
                    <div className="rounded-lg border border-katana-red/30 bg-katana-red/10 p-5 text-sm text-[var(--customer-text)]" role="alert">
                      <p>The menu could not be loaded. Check your connection and try again.</p>
                      <button type="button" className="mt-3 font-bold text-white underline" onClick={() => void refetchProducts()}>Retry</button>
                    </div>
                  ) : products.length === 0 ? (
                    <p className="rounded-lg border border-katana-border bg-katana-surface p-5 text-sm text-katana-muted">No menu products are currently available.</p>
                  ) : reservationType === "dine_in" && filteredProductGroups.length === 0 ? (
                    <p className="rounded-lg border border-katana-border bg-katana-surface p-5 text-sm text-katana-muted">No menu items match that search.</p>
                  ) : reservationType === "unlimited" && unlimitedProductsLoading ? (
                    <p className="rounded-lg border border-katana-border bg-katana-surface p-5 text-sm text-katana-muted" role="status">Loading the Unlimited menu...</p>
                  ) : reservationType === "unlimited" && unlimitedProductsError ? (
                    <div className="rounded-lg border border-katana-red/30 bg-katana-red/10 p-5 text-sm text-[var(--customer-text)]" role="alert">
                      <p>The Unlimited menu could not be loaded. Check your connection and try again.</p>
                      <button type="button" className="mt-3 font-bold text-white underline" onClick={() => void refetchUnlimitedProducts()}>Retry</button>
                    </div>
                  ) : reservationType === "unlimited" && unlimitedProducts.length === 0 ? (
                    <p className="rounded-lg border border-katana-border bg-katana-surface p-5 text-sm text-katana-muted">No included Unlimited menu items are currently available.</p>
                  ) : reservationType === "unlimited" && filteredUnlimitedProductGroups.length === 0 ? (
                    <p className="rounded-lg border border-katana-border bg-katana-surface p-5 text-sm text-katana-muted">No Unlimited items match that search.</p>
                  ) : reservationType === "dine_in" ? (
                    <div className="min-w-0">
                      <div className="min-w-0">
                        <div className="space-y-6">
                          {filteredProductGroups.map((group, groupIndex) => (
                            <section key={group.category} id={categorySectionId(group.category)}>
                              <div className="mb-3 flex items-center justify-between gap-3">
                                <h3 className="text-xs font-black uppercase tracking-[0.16em] text-neutral-300">{group.category}</h3>
                                <span className="h-px flex-1 bg-katana-border" />
                                <span className="text-xs font-semibold text-neutral-500">{group.products.length}</span>
                              </div>
                              <div className="customer-menu-product-grid grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-3 xl:grid-cols-4">
                                {group.products.map((product, index) => {
                                  const disabled = product.is_available === false || !availabilityByProduct.get(product.id)?.can_add;
                                  const imageSrc = getProductImageUrl(product);
                                  const eagerImage = groupIndex === 0 && index < 6;
                                  const cartItem = cartItems.find((item) => item.product_id === product.id);
                                  const quantity = cartItem?.quantity ?? 0;

                                  return (
                                    <article key={product.id} className={`customer-menu-product-card group ${disabled ? "is-unavailable" : ""}`}>
                                      <div className="customer-menu-product-art">
                                        {imageSrc ? (
                                          <img src={imageSrc} alt={product.name} loading={eagerImage ? "eager" : "lazy"} fetchPriority={eagerImage ? "high" : "auto"} decoding="async" onError={(event) => fallbackToBackendImage(event.currentTarget, product)} />
                                        ) : (
                                          <span className="text-6xl" aria-hidden="true">🍣</span>
                                        )}
                                      </div>
                                      <div className="customer-menu-product-panel">
                                        <h4 className="customer-menu-product-name line-clamp-2 font-display text-sm font-bold leading-tight sm:text-base">{product.name}</h4>
                                        <span className="customer-menu-price-badge text-sm">{money(Number(product.price))}</span>
                                        <p className="customer-menu-product-description line-clamp-2 min-h-8 text-[11px] leading-relaxed sm:text-xs">{product.description ?? "House specialty"}</p>
                                        <span className={`customer-menu-product-status ${disabled ? "is-unavailable" : "is-available"}`}>
                                          {disabled ? "Not available" : "Available"}
                                        </span>
                                        {quantity > 0 ? (
                                          <div className="customer-menu-quantity-control" aria-label={`Quantity of ${product.name}`}>
                                            <button type="button" aria-label={`Remove one ${product.name}`} onClick={() => updateCartQuantity(product.id, quantity - 1)}>−</button>
                                            <span aria-live="polite">{quantity}</span>
                                            <button type="button" aria-label={`Add one ${product.name}`} onClick={() => addProduct(product)} disabled={!cartItem || !canIncreaseCartItem(cartItem)}>+</button>
                                          </div>
                                        ) : (
                                          <button
                                            type="button"
                                            onClick={() => addProduct(product)}
                                            disabled={disabled}
                                            className="customer-menu-order-button"
                                          >
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
                          {filteredUnlimitedProductGroups.map((group, groupIndex) => (
                            <section key={group.category} id={categorySectionId(group.category)}>
                              <div className="mb-2 flex items-center justify-between gap-3">
                                <h3 className="text-xs font-black uppercase tracking-[0.16em] text-neutral-300">{group.category}</h3>
                                <span className="h-px flex-1 bg-katana-border" />
                                <span className="text-xs font-semibold text-neutral-500">{group.products.length}</span>
                              </div>
                              <div className="grid grid-cols-2 gap-2 md:grid-cols-3 xl:grid-cols-4">
                                {group.products.map((product, index) => {
                                  const selected = (selectedUnlimitedProductQuantities[product.id] ?? 0) > 0;
                                  const disabled = product.is_available === false || !availabilityByProduct.get(product.id)?.can_add;
                                  const imageSrc = getProductImageUrl(product);
                                  const eagerImage = groupIndex === 0 && index < 6;
                                  const quantity = selectedUnlimitedProductQuantities[product.id] ?? 0;
                                  const canIncrease = quantity < productQuantityAvailable(product);

                                  return (
                                    <article
                                      key={product.id}
                                      className={`customer-menu-product-card customer-menu-unlimited-card ${selected ? "is-selected" : ""} ${disabled ? "is-unavailable" : ""}`}
                                    >
                                      <button
                                        type="button"
                                        onClick={() => toggleUnlimitedProduct(product.id)}
                                        disabled={disabled}
                                        aria-pressed={selected}
                                        className="customer-menu-unlimited-select"
                                      >
                                        <div className="customer-menu-product-art">
                                          {imageSrc ? (
                                            <img src={imageSrc} alt={product.name} loading={eagerImage ? "eager" : "lazy"} fetchPriority={eagerImage ? "high" : "auto"} decoding="async" onError={(event) => fallbackToBackendImage(event.currentTarget, product)} />
                                          ) : (
                                            <span className="text-6xl" aria-hidden="true">🍣</span>
                                          )}
                                        </div>
                                        <div className="customer-menu-unlimited-copy">
                                          <span className="customer-menu-product-name line-clamp-2">{product.name}</span>
                                          <span className="customer-menu-product-description line-clamp-2">{product.description ?? "Included in unlimited"}</span>
                                          <span className={`customer-menu-product-status ${disabled ? "is-unavailable" : "is-available"}`}>
                                            {disabled ? "Not available" : "Available"}
                                          </span>
                                        </div>
                                      </button>
                                      <div className="customer-menu-unlimited-controls">
                                        <button
                                          type="button"
                                          aria-label={`Remove one ${product.name}`}
                                          onClick={() => updateUnlimitedQuantity(product.id, -1)}
                                          disabled={quantity === 0}
                                        >
                                          −
                                        </button>
                                        <span aria-live="polite">{quantity}</span>
                                        <button
                                          type="button"
                                          aria-label={`Add one ${product.name}`}
                                          onClick={() => updateUnlimitedQuantity(product.id, 1)}
                                          disabled={disabled || !canIncrease}
                                        >
                                          +
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
                            <li>{systemSettings.reservation_duration_minutes} minutes dining time.</li>
                            <li>No leftovers; extra charges apply.</li>
                            <li>One table, same package for all guests.</li>
                          </ul>
                        </div>
                      </aside>
                    </div>
                  )}
              </section>
              <MobileCartSheet
                open={isMobileCartOpen}
                title={reservationType === "unlimited" ? "Selected Unlimited items" : "Your cart"}
                itemCount={reservationType === "unlimited" ? selectedUnlimitedCount : cartItemCount}
                total={subtotal}
                items={mobileCartItems}
                onToggle={() => setIsMobileCartOpen((current) => !current)}
                onClose={() => setIsMobileCartOpen(false)}
                onDecrease={(productId) => reservationType === "unlimited"
                  ? updateUnlimitedQuantity(productId, -1)
                  : updateCartQuantity(productId, (cartItems.find((item) => item.product_id === productId)?.quantity ?? 0) - 1)}
                onIncrease={(productId) => reservationType === "unlimited"
                  ? updateUnlimitedQuantity(productId, 1)
                  : updateCartQuantity(productId, (cartItems.find((item) => item.product_id === productId)?.quantity ?? 0) + 1)}
                onRemove={(productId) => reservationType === "unlimited"
                  ? updateUnlimitedQuantity(productId, -(selectedUnlimitedProductQuantities[productId] ?? 0))
                  : removeCartItem(productId)}
              />
          </div>
        </div>

              <aside className="reservation-checkout-aside rounded-xl border border-katana-border bg-katana-elevated px-4 py-3 lg:col-start-2 lg:row-start-1">
                  <h2 id="reservation-details-heading" className="reservation-panel-title">Your booking</h2>
                  <section id="reservation-booking-card" className={`reservation-booking-card ${bookingDetailsOpen || !reservationTimeValid ? "is-active" : ""} ${validationTarget === "booking" ? "is-validation-highlight" : ""}`} aria-label="Booking details">
                    <div className="reservation-booking-header">
                      <p>{formatReservationDate(form.date)} · {form.time ? formatTime12(form.time) : "Choose a time"} · {form.party_size} {Number(form.party_size) === 1 ? "guest" : "guests"}</p>
                      <button
                        type="button"
                        aria-expanded={bookingDetailsOpen}
                        aria-controls="reservation-details-fields"
                        aria-label={bookingDetailsOpen ? "Close booking details" : "Edit booking details"}
                        id="reservation-details-toggle"
                        onClick={() => setBookingDetailsOpen((open) => !open)}
                        className="reservation-booking-toggle"
                      >
                        {bookingDetailsOpen ? "Close" : "Edit"}
                        <ChevronDown className={bookingDetailsOpen ? "is-open" : ""} aria-hidden="true" />
                      </button>
                    </div>
                    {bookingTimeNotice && (
                      <p className="reservation-time-notice" role="alert">{bookingTimeNotice}</p>
                    )}
                    <div id="reservation-details-fields" hidden={!bookingDetailsOpen}>
                      {bookingDetailsOpen && (
                        <div className="reservation-booking-fields">
                          <div className="reservation-booking-fields-grid">
                          <label className="block">
                            <span className="customer-label">Date *</span>
                            <input className={`customer-input reservation-date-input ${validationTarget === "booking" ? "is-validation-highlight" : ""}`} type="date" min={serverToday} value={form.date} onChange={(event) => setField("date", event.target.value)} required disabled={!reservationRules} aria-invalid={!reservationTimeValid} />
                          </label>
                          <fieldset className={`reservation-time-field ${validationTarget === "booking" ? "is-validation-highlight" : ""}`} aria-invalid={!reservationTimeValid}>
                            <legend className="customer-label">Reservation time *</legend>
                            {reservationRules ? (
                              <>
                                <div className="reservation-time-picker" role="group" aria-label="Reservation time">
                                  <input className="reservation-time-segment" type="number" min={1} max={12} step={1} aria-label="Hour" value={form.time ? displayHour : ""} placeholder="hh" onChange={(event) => setDigitalTime(Number(event.target.value) || 1, Number(minuteText) || 0, period)} />
                                  <span className="reservation-time-separator" aria-hidden="true">:</span>
                                  <input className="reservation-time-segment reservation-time-minute" type="number" min={0} max={59} step={1} aria-label="Minute" value={minuteText} placeholder="mm" onChange={(event) => setDigitalTime(displayHour, Number(event.target.value) || 0, period)} />
                                  <span className="reservation-time-period" aria-label="AM or PM">
                                    {(["AM", "PM"] as const).map((item) => (
                                      <button key={item} type="button" aria-pressed={Boolean(form.time) && period === item} className={Boolean(form.time) && period === item ? "is-selected" : ""} onClick={() => setDigitalTime(displayHour, Number(minuteText) || 0, item)}>{item}</button>
                                    ))}
                                  </span>
                                </div>
                                <p className="reservation-time-hours-hint">
                                  Open {formatTime12(reservationRules.OPENING_TIME)} to {formatTime12(reservationRules.CLOSING_TIME)}.
                                </p>
                                {!reservationTimeValid && !bookingTimeNotice && (Boolean(form.time) || validationTarget === "booking") && (
                                  <p className="reservation-time-validation" role="status">
                                    {form.date === serverToday && !nextAllowedTime(form.date, reservationRules, serverNow)
                                      ? "No more bookings available today. Please choose another date."
                                      : "Choose a future time within the reservation hours."}
                                  </p>
                                )}
                              </>
                            ) : reservationRulesQuery.isError ? (
                              <div className="mt-2 text-sm text-katana-red" role="alert">
                                <p>Reservation hours could not be loaded. Please retry.</p>
                                <button type="button" className="mt-1 underline" onClick={() => void reservationRulesQuery.refetch()}>Retry</button>
                              </div>
                            ) : (
                              <p className="mt-2 text-sm text-katana-muted" role="status">Loading reservation hours...</p>
                            )}
                          </fieldset>
                          <div>
                            <span className="customer-label">Number of Guests *</span>
                            <div className="reservation-guest-stepper">
                              <button type="button" aria-label="Remove one guest" onClick={() => setField("party_size", String(Math.max(1, Number(form.party_size) - 1)))} disabled={Number(form.party_size) <= 1}>−</button>
                              <span aria-live="polite">{form.party_size} {Number(form.party_size) === 1 ? "guest" : "guests"}</span>
                              <button type="button" aria-label="Add one guest" onClick={() => setField("party_size", String(Math.min(reservationRules?.MAX_GUESTS_PER_BOOKING ?? 20, Number(form.party_size) + 1)))} disabled={Number(form.party_size) >= (reservationRules?.MAX_GUESTS_PER_BOOKING ?? 20)}>+</button>
                            </div>
                            {Number(form.party_size) >= (reservationRules?.MAX_GUESTS_PER_BOOKING ?? 20) && (
                              <p className="mt-2 text-xs text-katana-muted">For groups over 20, please use <Link className="underline" to="/catering">Catering</Link>.</p>
                            )}
                          </div>
                        </div>
                      </div>
                      )}
                    </div>
                  </section>
                  <div className="reservation-panel-sections">
                    <section className="reservation-panel-section" aria-label="Order summary">
                      <div className="reservation-order-items">
                        {reservationType === "dine_in" ? (
                          cartItems.length === 0 ? (
                            <p className="reservation-empty-summary">Your order is empty. Add an available menu item to continue.</p>
                          ) : (
                            cartItems.map((item) => (
                            <div key={item.product_id} className="reservation-order-item">
                              <div className="reservation-order-item-info">
                                <p>{item.name} × {item.quantity}</p>
                              </div>
                              <p className="reservation-order-item-price">{money(item.price * item.quantity)}</p>
                            </div>
                            ))
                          )
                        ) : (
                          <>
                            <div className="reservation-order-item">
                              <div className="reservation-order-item-info">
                                <p>Unlimited package × {form.party_size} {Number(form.party_size) === 1 ? "guest" : "guests"}</p>
                              </div>
                              <p className="reservation-order-item-price">{money(totalPrice)}</p>
                            </div>
                            <div className="reservation-selected-products">
                              {selectedUnlimitedProducts.length === 0 ? (
                                <span>Select at least one included menu item.</span>
                              ) : (
                                selectedUnlimitedProducts.map((item) => (
                                  <span key={item.product_id}>{item.name} × {item.quantity}</span>
                                ))
                              )}
                            </div>
                          </>
                        )}
                      </div>

                      {unavailableSelectedItems.length > 0 && (
                        <p id="reservation-unavailable-items" className={`reservation-checkout-alert ${validationTarget === "availability" ? "is-validation-highlight" : ""}`} role="alert">
                          Availability changed for {unavailableSelectedItems.map((item) => item.name).join(", ")}. Adjust your selection to continue.
                        </p>
                      )}
                      <div className="reservation-order-totals">
                        <div className="reservation-order-total"><span>Total</span><span>{money(totalPrice)}</span></div>
                      </div>
                    </section>

                    <section className="reservation-panel-section" aria-label="Payment options">
                      <div className="reservation-payment-options" role="radiogroup" aria-label="Payment options">
                        <label className={`reservation-payment-option ${paymentPlan === "full_payment" ? "is-selected" : ""}`}>
                          <input
                            type="radio"
                            name="reservation-payment-plan"
                            value="full_payment"
                            checked={paymentPlan === "full_payment"}
                            onChange={() => setPaymentPlan("full_payment")}
                          />
                          <span className="reservation-payment-option-title">Pay in full now</span>
                        </label>
                        <label className={`reservation-payment-option ${paymentPlan === "pay_at_venue" ? "is-selected" : ""}`}>
                          <input
                            type="radio"
                            name="reservation-payment-plan"
                            value="pay_at_venue"
                            checked={paymentPlan === "pay_at_venue"}
                            onChange={() => setPaymentPlan("pay_at_venue")}
                          />
                          <span className="reservation-payment-option-title">Pay at the restaurant when I arrive</span>
                        </label>
                      </div>
                      {isFullPayment && (
                        <p className="reservation-payment-method">Method: Cash (temporary)</p>
                      )}
                    </section>

                    <section className="reservation-panel-section" aria-label="Reservation rules">
                      <button
                        type="button"
                        className="reservation-rules-toggle"
                        aria-expanded={reservationRulesOpen}
                        aria-controls="reservation-rules-content"
                        onClick={() => setReservationRulesOpen((open) => !open)}
                      >
                        <span id="reservation-rules-heading" className="reservation-rules-title">Reservation rules</span>
                        <ChevronDown className={reservationRulesOpen ? "is-open" : ""} aria-hidden="true" />
                      </button>
                      <div id="reservation-rules-content" hidden={!reservationRulesOpen}>
                        <ul className="reservation-rules-list">
                          <li>Your request is not confirmed until staff approve it.</li>
                          <li>Approved bookings reserve the selected ingredients; pending requests do not.</li>
                          <li>Dining time is limited to {systemSettings.reservation_duration_minutes} minutes upon serving of food.</li>
                          {reservationRules && <li>Arriving {reservationRules.LATE_ALERT_MINUTES} minutes late alerts staff to contact you.</li>}
                          {reservationRules && <li>Reservations run {formatTime12(reservationRules.OPENING_TIME)} to {formatTime12(reservationRules.CLOSING_TIME)}.</li>}
                        </ul>
                      </div>
                      <label className={`reservation-acknowledgement ${validationTarget === "rules" ? "is-validation-highlight" : ""}`}>
                        <input
                          id="reservation-acknowledgement"
                          checked={acknowledged}
                          type="checkbox"
                          onChange={(event) => {
                            setAcknowledged(event.target.checked);
                            setValidationTarget(null);
                          }}
                        />
                        <span>I understand staff approval is required before my reservation is confirmed.</span>
                      </label>
                    </section>
                  </div>

              <div className="reservation-checkout-submit">
                <button
                  type="button"
                  disabled={!canContinueToDetails}
                  aria-describedby="reservation-continue-help"
                  onClick={handleContinueToDetails}
                  className="customer-btn-primary w-full"
                >
                  Confirm booking
                </button>
                <p id="reservation-continue-help" role="status">{continueHelp}</p>
              </div>
              {message && <p className="reservation-checkout-alert mt-4" role="alert">{message}</p>}
              {paymentNotice && <p className="reservation-payment-notice mt-4" role="status">{paymentNotice}</p>}
              </aside>
      </form>

      <Dialog
        open={detailsOpen}
        title="Your details"
        onClose={() => !isProcessingPayment && setDetailsOpen(false)}
        panelClassName="reservation-details-dialog-panel max-w-xl"
      >
        <form className="reservation-details-dialog-form grid gap-4" onSubmit={handleSubmit}>
          <p className="reservation-details-dialog-booking text-sm">
            {form.date} · {form.time ? formatTime12(form.time) : "Choose a time"} · {form.party_size} guest{Number(form.party_size) === 1 ? "" : "s"}
          </p>
          <label className="grid gap-1 text-sm font-semibold text-slate-700">
            Your name *
            <input className="customer-input" autoComplete="name" maxLength={120} value={form.customer_name} onChange={(event) => setField("customer_name", event.target.value)} required />
          </label>
          <label className="grid gap-1 text-sm font-semibold text-slate-700">
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
          <label className="grid gap-1 text-sm font-semibold text-slate-700">
            Email *
            <input className="customer-input" type="email" autoComplete="email" maxLength={254} value={form.customer_email} onChange={(event) => setField("customer_email", event.target.value)} required />
          </label>
          <div className="reservation-details-dialog-summary rounded-lg p-3 text-sm">
            <p className="font-bold">{reservationType === "unlimited" ? "Unlimited" : "Regular a la carte"}</p>
            <p className="mt-1">Total: {money(totalPrice)}</p>
            <p className="mt-1">{isFullPayment ? "Pay in full now · Cash (temporary)" : "Pay at the restaurant"}</p>
          </div>
          {message && <p className="rounded-md bg-red-50 px-3 py-2 text-sm font-medium text-red-800" role="alert">{message}</p>}
          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <button type="button" className="customer-btn-secondary" onClick={() => setDetailsOpen(false)} disabled={isProcessingPayment}>Back</button>
            <button type="submit" className="customer-btn-primary" disabled={isProcessingPayment || !reservationTimeValid || !acknowledged}>
              {isProcessingPayment ? (isFullPayment ? "Processing payment..." : "Submitting...") : isFullPayment ? `Pay ${money(totalPrice)} & confirm booking` : "Confirm booking"}
            </button>
          </div>
        </form>
      </Dialog>

    </main>
  );
}

import { Check, LoaderCircle, Minus, Plus, Search, ShoppingCart, Trash2, Utensils } from "lucide-react";
import type { ReactNode } from "react";
import { useEffect, useMemo, useState } from "react";
import { Button } from "../../../components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "../../../components/ui/card";
import { resolveImageUrl } from "../../../lib/api";
import { formatManilaDateTime } from "../../../lib/dateTime";
import type { CartItem, PosCartKey, PosProduct } from "./store";
import "./PosPage.css";

type CustomerType = "new_customer" | "existing_table" | "pickup_customer";
type ServiceType = "dine_in" | "takeout";
type CustomerPath = "dine_in_walk_in" | "reservation" | "takeout_walk_in" | "pickup" | "existing_table";
type OrderStage = "order" | "table" | "print";

type Props = {
  customerType: CustomerType;
  customerPath: CustomerPath;
  orderStage: OrderStage;
  onDineInWalkIn: () => void;
  onReservation: () => void;
  onTakeoutWalkIn: () => void;
  onPickup: () => void;
  onExistingTable: () => void;
  selectionContent?: ReactNode;
  actionInSelectionView?: boolean;
  cartSelectionStatus?: ReactNode;
  sessionControls?: ReactNode;
  selectionSummary?: string | null;
  currentOrderPath?: string[];
  onClearCurrentOrder?: () => void;
  customerService: ServiceType;
  cartKey: PosCartKey;
  orderType: "ala_carte" | "unlimited";
  onOrderTypeChange: (orderType: "ala_carte" | "unlimited") => void;
  headcount: number;
  onHeadcountChange: (headcount: number) => void;
  unlimitedPricePerPerson: number | null;
  activeUnlimitedPaxCount?: number | null;
  activeUnlimitedPricePerPerson?: number | null;
  unlimitedMenuActive: boolean;
  unlimitedMenuScope: string | null;
  products: PosProduct[];
  productsLoading: boolean;
  productsError: boolean;
  items: CartItem[];
  pickupOrder?: {
    order_number: string;
    customer_name: string;
    status: "preparing" | "ready" | "completed";
    pickup_time: string | null;
    total: number;
    items: Array<{ name: string; quantity: number; total_price: number }>;
  } | null;
  onAddItem: (product: PosProduct, diningOrderType?: CartItem["diningOrderType"]) => void;
  onRemoveItem: (productId: string, diningOrderType?: CartItem["diningOrderType"]) => void;
  onDecrementItem: (productId: string, diningOrderType?: CartItem["diningOrderType"]) => void;
  customerName: string;
  onCustomerNameChange: (name: string) => void;
  lastCommittedOrderNumber?: string | null;
  onReprintLastOrder?: () => void;
  actionLabel: string;
  actionDisabled: boolean;
  actionPending?: boolean;
  actionSucceeded?: boolean;
  onAction: () => void;
};

function money(value: number) {
  return `PHP ${value.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function getCartPrice(item: CartItem, cartKey: PosCartKey) {
  if (cartKey !== "takeout" && item.diningOrderType === "unlimited") return 0;
  return Number(item.product.price);
}

function canAddToCart(product: PosProduct, cartKey: PosCartKey) {
  if (product.is_available === false) return false;
  if (cartKey === "takeout") return true;
  return Boolean(
    product.cart_compatibility?.a_la_carte.allowed
    || product.cart_compatibility?.unlimited.allowed
  );
}

function getAddedItemOrderType(product: PosProduct, orderType: Props["orderType"], cartKey: PosCartKey) {
  if (cartKey === "takeout") return undefined;
  const aLaCarte = product.cart_compatibility?.a_la_carte;
  const unlimited = product.cart_compatibility?.unlimited;
  const unlimitedIsIncluded = unlimited?.allowed
    && (unlimited.classification === "included_in_unlimited" || unlimited.classification === "unlimited_only");
  if (orderType === "unlimited" && unlimitedIsIncluded) return "unlimited";
  if (aLaCarte?.allowed) return "ala_carte";
  if (unlimited?.allowed) return "unlimited";
  return undefined;
}

export default function PosOrderBuilder({
  customerType,
  customerPath,
  orderStage,
  onDineInWalkIn,
  onReservation,
  onTakeoutWalkIn,
  onPickup,
  onExistingTable,
  selectionContent,
  actionInSelectionView = false,
  cartSelectionStatus,
  sessionControls,
  selectionSummary = null,
  currentOrderPath = [],
  onClearCurrentOrder,
  customerService,
  cartKey,
  orderType,
  onOrderTypeChange,
  headcount,
  onHeadcountChange,
  unlimitedPricePerPerson,
  activeUnlimitedPaxCount = null,
  activeUnlimitedPricePerPerson = null,
  unlimitedMenuActive,
  unlimitedMenuScope,
  products,
  productsLoading,
  productsError,
  items,
  pickupOrder = null,
  onAddItem,
  onRemoveItem,
  onDecrementItem,
  customerName,
  onCustomerNameChange,
  lastCommittedOrderNumber = null,
  onReprintLastOrder,
  actionLabel,
  actionDisabled,
  actionPending = false,
  actionSucceeded = false,
  onAction
}: Props) {
  const [menuSearch, setMenuSearch] = useState("");
  const [selectedCategory, setSelectedCategory] = useState("All");
  const [showAllUnlimitedMenuItems, setShowAllUnlimitedMenuItems] = useState(false);
  const [showActionSuccess, setShowActionSuccess] = useState(false);
  const normalizedSearch = menuSearch.trim().toLocaleLowerCase();
  const menuProducts = useMemo(
    () => unlimitedMenuActive && !showAllUnlimitedMenuItems
      ? products.filter((product) => {
        const classification = product.cart_compatibility?.unlimited.classification;
        return product.cart_compatibility?.unlimited.allowed
          && (classification === "included_in_unlimited" || classification === "unlimited_only");
      })
      : products,
    [products, showAllUnlimitedMenuItems, unlimitedMenuActive]
  );
  const categories = useMemo(() => {
    const counts = new Map<string, number>();
    menuProducts.filter((product) => canAddToCart(product, cartKey)).forEach((product) => {
      counts.set(product.category, (counts.get(product.category) ?? 0) + 1);
    });
    return [{ name: "All", count: [...counts.values()].reduce((total, count) => total + count, 0) },
      ...[...counts].map(([name, count]) => ({ name, count }))];
  }, [cartKey, menuProducts]);
  const visibleProducts = menuProducts.filter((product) =>
    canAddToCart(product, cartKey)
    && (selectedCategory === "All" || product.category === selectedCategory)
    && (!normalizedSearch
      || product.name.toLocaleLowerCase().includes(normalizedSearch)
      || product.category.toLocaleLowerCase().includes(normalizedSearch))
  ).sort((left, right) => Number(left.available_stock === 0) - Number(right.available_stock === 0));
  const isPickup = customerType === "pickup_customer";
  const isDineIn = cartKey !== "takeout";
  const isSelectingExistingTable = customerType === "existing_table" && !selectionSummary;
  const itemSubtotal = items.reduce((sum, item) => sum + getCartPrice(item, cartKey) * item.quantity, 0);
  const hasUnlimitedItems = items.some((item) => item.diningOrderType === "unlimited");
  const packagePaxCount = activeUnlimitedPaxCount ?? headcount;
  const packagePricePerPerson = activeUnlimitedPricePerPerson ?? unlimitedPricePerPerson;
  const unlimitedPackageEstimate = isDineIn && packagePricePerPerson !== null
    ? Number(packagePricePerPerson) * packagePaxCount
    : null;
  const subtotal = isPickup ? pickupOrder?.total ?? 0 : itemSubtotal;
  const total = subtotal + (hasUnlimitedItems ? unlimitedPackageEstimate ?? 0 : 0);
  const cartCount = isPickup && pickupOrder
    ? pickupOrder.items.reduce((count, item) => count + item.quantity, 0)
    : items.reduce((count, item) => count + item.quantity, 0);

  useEffect(() => {
    if (!actionSucceeded) {
      setShowActionSuccess(false);
      return;
    }
    setShowActionSuccess(true);
    const timer = window.setTimeout(() => setShowActionSuccess(false), 650);
    return () => window.clearTimeout(timer);
  }, [actionSucceeded]);

  useEffect(() => {
    setShowAllUnlimitedMenuItems(false);
  }, [unlimitedMenuScope]);

  function addProduct(product: PosProduct, diningOrderType?: CartItem["diningOrderType"]) {
    onAddItem(product, diningOrderType);
  }

  return (
    <section
      className={`pos-order-builder grid gap-4${isSelectingExistingTable ? " is-existing-table-selection xl:grid-cols-1" : " xl:grid-cols-[minmax(0,1fr)_minmax(18rem,0.34fr)]"}`}
      aria-label="POS order builder"
    >
      <div className="min-w-0 space-y-4">
        <section aria-label="Customer type" className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
          <div className="pos-customer-paths" role="group" aria-label="Choose order path">
            {([
              ["dine_in_walk_in", "Dine-in walk-in", onDineInWalkIn],
              ["reservation", "Reservation", onReservation],
              ["takeout_walk_in", "Takeout", onTakeoutWalkIn],
              ["pickup", "Pickup", onPickup],
              ["existing_table", "Existing table", onExistingTable]
            ] as const).map(([path, label, onSelect]) => (
              <button
                key={path}
                type="button"
                className={`pos-customer-path${customerPath === path ? " is-active" : ""}`}
                aria-pressed={customerPath === path}
                onClick={onSelect}
              >
                {label}
              </button>
            ))}
          </div>
          {currentOrderPath.length > 0 && (
            <div role="region" aria-label="Current order" className="pos-current-path mt-3 flex flex-wrap items-center justify-between gap-3 px-1 py-1">
              <div className="flex min-w-0 flex-wrap items-center gap-1.5">
                <span className="mr-1 text-xs font-medium text-slate-500">Order path</span>
                {currentOrderPath.map((part, index) => (
                  <span key={`${part}-${index}`} className="inline-flex items-center gap-1.5">
                    {index > 0 && <span aria-hidden="true" className="text-slate-400">/</span>}
                    <span className="text-xs font-semibold text-slate-700">{part}</span>
                  </span>
                ))}
              </div>
              <Button type="button" size="sm" variant="outline" onClick={onClearCurrentOrder}>Clear order</Button>
            </div>
          )}
        </section>

        {isDineIn && (
          <nav className="pos-order-stage" aria-label="Order progress">
            {(["order", "table", "print"] as const).map((stage) => (
              <span key={stage} className={orderStage === stage ? "is-current" : ""} aria-current={orderStage === stage ? "step" : undefined}>
                {stage === "order" ? "Order" : stage === "table" ? "Table" : "Print"}
              </span>
            ))}
          </nav>
        )}

        {selectionContent ?? <Card className="pos-menu-card min-w-0">
          <CardHeader className="pos-menu-header gap-3">
            <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-center">
              <CardTitle>Menu</CardTitle>
              <div className="pos-menu-tools">
                <label className="relative block w-full sm:max-w-xs">
                  <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" aria-hidden="true" />
                  <input
                    type="search"
                    aria-label="Search menu products"
                    placeholder="Search menu..."
                    value={menuSearch}
                    onChange={(event) => setMenuSearch(event.target.value)}
                    className="h-11 w-full rounded-md border border-slate-300 bg-white pl-9 pr-3 text-sm text-slate-900 outline-none placeholder:text-slate-400 focus:border-red-700 focus:ring-2 focus:ring-red-100"
                  />
                </label>
              </div>
            </div>
            {unlimitedMenuActive && (
              <div className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-amber-200 bg-amber-50 px-3 py-2">
                <p className="text-sm font-semibold text-amber-950">
                  {showAllUnlimitedMenuItems ? "Showing all menu items" : "Showing Unlimited items only"}
                </p>
                <label className="flex cursor-pointer items-center gap-2 text-sm font-semibold text-amber-950">
                  <input
                    type="checkbox"
                    aria-label="Show all items"
                    checked={showAllUnlimitedMenuItems}
                    onChange={(event) => setShowAllUnlimitedMenuItems(event.target.checked)}
                  />
                  Show all items
                </label>
              </div>
            )}
            <div className="pos-category-filters" role="group" aria-label="Filter menu by category">
              {categories.map(({ name, count }) => (
                <button
                  type="button"
                  key={name}
                  className={`pos-category-chip${selectedCategory === name ? " is-active" : ""}`}
                  aria-pressed={selectedCategory === name}
                  onClick={() => setSelectedCategory(name)}
                >
                  {name}<span>{count}</span>
                </button>
              ))}
            </div>
          </CardHeader>
          <CardContent>
            {productsLoading && <p className="text-sm text-slate-500">Loading products...</p>}
            {productsError && <p role="alert" className="text-sm text-red-700">Unable to load products.</p>}
            {!productsLoading && !productsError && visibleProducts.length === 0 && (
              <p className="text-sm text-slate-500">
                {normalizedSearch
                  ? `No menu products match "${menuSearch.trim()}".`
                  : selectedCategory !== "All"
                    ? `No products are available in ${selectedCategory}.`
                    : "No products are currently available."}
              </p>
            )}
            <div className="pos-menu-grid grid gap-3">
              {visibleProducts.map((product) => {
                const cartQuantity = items.filter((item) => item.product.id === product.id).reduce((sum, item) => sum + item.quantity, 0);
                const availableStock = product.available_stock == null ? null : Math.floor(product.available_stock);
                const isSoldOut = availableStock === 0;
                const disabled = isPickup || product.is_available === false || isSoldOut
                  || (availableStock !== null && cartQuantity >= availableStock);
                const addedItemOrderType = getAddedItemOrderType(product, orderType, cartKey);
                const useUnlimitedPrice = isDineIn && addedItemOrderType === "unlimited";
                const price = useUnlimitedPrice ? 0 : Number(product.price);
                const imageUrl = resolveImageUrl(product.image_url);

                return (
                  <button
                    key={product.id}
                    className={`pos-menu-item${disabled ? " is-unavailable" : ""}`}
                    disabled={disabled}
                    type="button"
                    onClick={() => addProduct(product, addedItemOrderType)}
                  >
                    <span className="pos-menu-image" aria-hidden="true">
                      <Utensils />
                      {imageUrl ? (
                        <img
                          src={imageUrl}
                          alt=""
                          loading="lazy"
                          decoding="async"
                          onError={(event) => {
                            event.currentTarget.hidden = true;
                          }}
                        />
                      ) : null}
                      {cartQuantity > 0 && <span className="pos-menu-quantity">{cartQuantity}</span>}
                      {!disabled && <span className="pos-menu-add">+</span>}
                    </span>
                    <span className="pos-menu-copy">
                      <span className="pos-menu-name">{product.name}</span>
                      <span className="pos-menu-category">{product.category}</span>
                    </span>
                    <span className="pos-menu-meta">
                      <span className={`pos-stock-chip ${isSoldOut || product.is_available === false ? "is-out" : availableStock === null ? "is-unknown" : "is-available"}`}>
                        {product.is_available === false
                          ? `Unavailable · ${availableStock ?? "stock unknown"}`
                          : isSoldOut
                            ? "Out of stock · 0 available"
                            : availableStock === null ? "Stock not provided" : `${availableStock} available`}
                      </span>
                      <span className="pos-menu-price">{price === 0 ? "Included" : money(price)}</span>
                    </span>
                  </button>
                );
              })}
            </div>
          </CardContent>
        </Card>}
      </div>

      {!isSelectingExistingTable && <aside
        data-testid="pos-cart-panel"
        className="pos-order-panel min-w-0"
      >
        <Card className="pos-order-card flex h-full min-h-0 flex-col">
          <CardHeader className="pos-order-header">
            <div className="min-w-0">
              <CardTitle>{isPickup ? "Pickup order" : "Order"}</CardTitle>
              {selectionSummary && (
                <p className="pos-order-context" title={selectionSummary}>{selectionSummary}</p>
              )}
            </div>
            {lastCommittedOrderNumber && onReprintLastOrder && (
              <Button className="pos-reprint-action" size="sm" variant="ghost" onClick={onReprintLastOrder}>
                Reprint
              </Button>
            )}
            <span
              className="pos-cart-count"
              aria-label={`${cartCount} items in order`}
            >
              {cartCount}
            </span>
          </CardHeader>
          <CardContent className="pos-order-body flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto">
            {isDineIn && (
              <>
                <div aria-label="Order type" className="pos-order-type-toggle grid grid-cols-2 gap-2" role="group">
                  <span className={`pos-order-type-highlight${orderType === "unlimited" ? " is-unlimited" : ""}`} />
                  {([
                    ["ala_carte", "A la carte"],
                    ["unlimited", "Unlimited"]
                  ] as const).map(([value, label]) => (
                    <button
                      key={value}
                      aria-pressed={orderType === value}
                      className={`pos-order-type-option${orderType === value ? " is-selected" : ""}`}
                      onClick={() => onOrderTypeChange(value)}
                      type="button"
                    >
                      {label}
                    </button>
                  ))}
                </div>
                {orderType === "unlimited" && (
                  <>
                    <label className="pos-headcount-control grid gap-1 text-sm font-medium text-slate-700">
                      Unlimited headcount
                      <span className="pos-headcount-stepper">
                        <button
                          type="button"
                          aria-label="Decrease headcount"
                          disabled={activeUnlimitedPaxCount !== null || headcount <= 1}
                          onClick={() => onHeadcountChange(headcount - 1)}
                        ><Minus /></button>
                        <input
                          aria-label="Unlimited headcount"
                          type="number"
                          min={1}
                          max={100}
                          step={1}
                          value={headcount}
                          disabled={activeUnlimitedPaxCount !== null}
                          onChange={(event) => onHeadcountChange(Number(event.target.value))}
                        />
                        <button
                          type="button"
                          aria-label="Increase headcount"
                          disabled={activeUnlimitedPaxCount !== null || headcount >= 100}
                          onClick={() => onHeadcountChange(headcount + 1)}
                        ><Plus /></button>
                      </span>
                    </label>
                    <div className="rounded-md bg-amber-50 p-3 text-sm text-amber-950">
                      {unlimitedPackageEstimate === null
                        ? "Unlimited package pricing is unavailable."
                        : `Unlimited package: ${packagePaxCount} × ${money(Number(packagePricePerPerson))} = ${money(unlimitedPackageEstimate)}${activeUnlimitedPaxCount !== null ? " (active session)" : " (estimated; due at bill-out)"}`}
                    </div>
                  </>
                )}
              </>
            )}
            {customerType === "new_customer" && customerService === "takeout" && (
              <label className="grid gap-1 text-sm font-medium text-slate-700">
                Customer name
                <input
                  className="h-10 rounded-md border border-slate-300 px-3"
                  placeholder="Optional"
                  value={customerName}
                  onChange={(event) => onCustomerNameChange(event.target.value)}
                />
              </label>
            )}

            {isPickup ? (
              pickupOrder ? (
                <div className="grid gap-2">
                  <div className="rounded-md bg-slate-50 p-3 text-sm">
                    <p className="font-semibold">{pickupOrder.customer_name}</p>
                    <p>{pickupOrder.order_number} · {pickupOrder.status === "ready" ? "Ready for pickup" : "Preparing"}</p>
                    {pickupOrder.pickup_time && <p>Pickup Time: {formatManilaDateTime(pickupOrder.pickup_time, { hour: "numeric", minute: "2-digit" })}</p>}
                  </div>
                  {pickupOrder.items.map((item, index) => (
                    <div key={`${pickupOrder.order_number}-${index}`} className="flex justify-between gap-3 rounded-md border border-slate-200 p-3 text-sm">
                      <span>{item.quantity} × {item.name}</span>
                      <span className="font-semibold">{money(item.total_price)}</span>
                    </div>
                  ))}
                  <p className="text-xs text-slate-500">Pickup order items are read-only.</p>
                </div>
              ) : (
                <div className="grid min-h-32 place-items-center rounded-md border border-dashed border-slate-300 p-5 text-center text-sm text-slate-500">
                  Choose a pickup order to load its read-only items.
                </div>
              )
            ) : (
              <div className="pos-cart-lines grid max-h-[52vh] gap-2 overflow-y-auto pr-1">
                {items.length === 0 ? (
                    <div className="pos-cart-empty grid justify-items-center gap-2 rounded-md border border-dashed border-slate-300 p-6 text-center text-sm text-slate-500">
                    <ShoppingCart className="h-8 w-8" />
                    Cart is empty
                  </div>
                ) : items.map((item) => {
                  const unitPrice = getCartPrice(item, cartKey);
                  return (
                    <div key={`${item.product.id}-${item.diningOrderType ?? "default"}`} className="pos-cart-line rounded-md border border-slate-200 bg-white p-3">
                      <div className="flex items-start justify-between gap-3">
                        <div className="pos-cart-line-copy">
                        <p className="font-semibold text-slate-950">{item.quantity} × {item.product.name}</p>
                        <p className="pos-cart-line-price text-sm text-slate-500">
                            {item.diningOrderType === "unlimited"
                              ? "Unlimited included"
                            : <>
                                {item.diningOrderType === "ala_carte" && <span>A la carte · </span>}
                                <strong>{money(unitPrice)}</strong>
                              </>}
                          </p>
                        </div>
                        <Button size="sm" variant="ghost" aria-label={`Remove ${item.product.name}${item.diningOrderType ? ` ${item.diningOrderType}` : ""}`} onClick={() => onRemoveItem(item.product.id, item.diningOrderType)}>
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
                      <div className="mt-3 flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <Button size="sm" variant="outline" aria-label={`Decrease ${item.product.name}${item.diningOrderType ? ` ${item.diningOrderType}` : ""}`} onClick={() => onDecrementItem(item.product.id, item.diningOrderType)}>
                            <Minus className="h-4 w-4" />
                          </Button>
                          <span className="grid h-10 min-w-10 place-items-center rounded-md border border-slate-200 text-sm font-semibold">{item.quantity}</span>
                          <Button
                            size="sm"
                            variant="outline"
                            aria-label={`Increase ${item.product.name}${item.diningOrderType ? ` ${item.diningOrderType}` : ""}`}
                            disabled={item.product.available_stock != null && items.filter((cartItem) => cartItem.product.id === item.product.id).reduce((sum, cartItem) => sum + cartItem.quantity, 0) >= item.product.available_stock}
                            onClick={() => onAddItem(item.product, item.diningOrderType)}
                          >
                            <Plus className="h-4 w-4" />
                          </Button>
                        </div>
                        <p className="font-semibold text-slate-950">{money(unitPrice * item.quantity)}</p>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}

            {sessionControls}
            {cartSelectionStatus}

          </CardContent>
          <div className="pos-order-footer grid gap-2 border-t border-slate-200 pt-4 text-sm">
              <div className="flex items-center justify-between text-slate-600"><span>Subtotal</span><span>{money(subtotal)}</span></div>
              {hasUnlimitedItems && unlimitedPackageEstimate !== null && (
                <div className="flex items-center justify-between text-slate-600">
                  <span>Unlimited package · due at bill-out</span>
                  <span>{money(unlimitedPackageEstimate)}</span>
                </div>
              )}
              <div className="flex items-center justify-between text-lg font-semibold text-slate-950"><span>Total</span><span>{money(total)}</span></div>
              {!actionInSelectionView && (
                <Button
                  className={`pos-primary-action mt-2 min-h-12${actionPending ? " is-processing" : ""}${showActionSuccess ? " is-success" : ""}`}
                  disabled={actionDisabled || actionPending}
                  onClick={onAction}
                >
                  {actionPending
                    ? <><LoaderCircle className="pos-action-spinner" aria-hidden="true" />Processing…</>
                    : showActionSuccess
                      ? <><Check aria-hidden="true" />Done</>
                      : actionLabel}
                </Button>
              )}
          </div>
        </Card>
      </aside>}
    </section>
  );
}

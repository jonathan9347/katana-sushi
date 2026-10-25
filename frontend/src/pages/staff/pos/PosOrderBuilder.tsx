import { Minus, Plus, ShoppingCart, Trash2 } from "lucide-react";
import type { ReactNode } from "react";
import { Button } from "../../../components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "../../../components/ui/card";
import { Select } from "../../../components/ui/select";
import { formatManilaDateTime } from "../../../lib/dateTime";
import type { CartItem, PosCartKey, PosProduct } from "./store";

type CustomerType = "new_customer" | "existing_table" | "pickup_customer";
type ServiceType = "dine_in" | "takeout";

type Props = {
  customerType: CustomerType;
  onNewCustomer: () => void;
  onExistingTable: () => void;
  selectionContent?: ReactNode;
  sessionControls?: ReactNode;
  selectionSummary?: string | null;
  customerService: ServiceType;
  cartKey: PosCartKey;
  orderType: "ala_carte" | "unlimited";
  onOrderTypeChange: (orderType: "ala_carte" | "unlimited") => void;
  headcount: number;
  onHeadcountChange: (headcount: number) => void;
  unlimitedPricePerPerson: number | null;
  activeUnlimitedPaxCount?: number | null;
  activeUnlimitedPricePerPerson?: number | null;
  products: PosProduct[];
  productsLoading: boolean;
  productsError: boolean;
  category: string;
  onCategoryChange: (category: string) => void;
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
  onNewCustomer,
  onExistingTable,
  selectionContent,
  sessionControls,
  selectionSummary = null,
  customerService,
  cartKey,
  orderType,
  onOrderTypeChange,
  headcount,
  onHeadcountChange,
  unlimitedPricePerPerson,
  activeUnlimitedPaxCount = null,
  activeUnlimitedPricePerPerson = null,
  products,
  productsLoading,
  productsError,
  category,
  onCategoryChange,
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
  onAction
}: Props) {
  const categories = ["All", ...Array.from(new Set(products.map((product) => product.category))).sort()];
  const visibleProducts = products.filter((product) =>
    (category === "All" || product.category === category) && canAddToCart(product, cartKey)
  );
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

  return (
    <section
      className={`grid gap-4 ${isSelectingExistingTable ? "xl:grid-cols-1" : "xl:grid-cols-[minmax(0,1fr)_minmax(18rem,0.34fr)]"}`}
      aria-label="POS order builder"
    >
      <div className="min-w-0 space-y-4">
        <section aria-label="Customer type" className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
          <div className="flex flex-wrap gap-2">
            <Button className="min-h-12 px-5 font-bold" onClick={onNewCustomer}>New Customer</Button>
            <Button className="min-h-12 px-5 font-bold" variant="outline" onClick={onExistingTable}>Existing Table</Button>
          </div>
          {selectionSummary && <p className="mt-3 rounded bg-emerald-50 p-2 text-sm font-semibold text-emerald-900">{selectionSummary}</p>}
          <p className="mt-3 text-xs text-slate-500">
            {isPickup ? "Pickup selection is handled in a temporary order list." : "A la carte and Unlimited items can share one table cart."}
          </p>
        </section>

        {selectionContent ?? <Card className="min-w-0">
          <CardHeader className="gap-3">
            <div className="flex items-center justify-between gap-3">
              <CardTitle>Menu</CardTitle>
              <Select
                aria-label="Menu category"
                className="h-11 w-56"
                value={category}
                onChange={(event) => onCategoryChange(event.target.value)}
              >
                {categories.map((item) => <option key={item} value={item}>{item}</option>)}
              </Select>
            </div>
          </CardHeader>
          <CardContent>
            {productsLoading && <p className="text-sm text-slate-500">Loading products...</p>}
            {productsError && <p role="alert" className="text-sm text-red-700">Unable to load products.</p>}
            {!productsLoading && !productsError && visibleProducts.length === 0 && (
              <p className="text-sm text-slate-500">No products are available in this menu category.</p>
            )}
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4">
              {visibleProducts.map((product) => {
                const cartQuantity = items.filter((item) => item.product.id === product.id).reduce((sum, item) => sum + item.quantity, 0);
                const availableStock = product.available_stock == null ? null : Math.floor(product.available_stock);
                const isSoldOut = availableStock === 0;
                const disabled = isPickup || product.is_available === false || isSoldOut
                  || (availableStock !== null && cartQuantity >= availableStock);
                const addedItemOrderType = getAddedItemOrderType(product, orderType, cartKey);
                const useUnlimitedPrice = isDineIn && addedItemOrderType === "unlimited";
                const price = useUnlimitedPrice ? 0 : Number(product.price);

                return (
                  <button
                    key={product.id}
                    className="flex min-h-32 flex-col justify-between rounded-md border border-slate-200 bg-white p-4 text-left shadow-sm transition hover:border-red-200 hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-60"
                    disabled={disabled}
                    type="button"
                    onClick={() => onAddItem(product, addedItemOrderType)}
                  >
                    <span>
                      <span className="block text-base font-semibold text-slate-950">{product.name}</span>
                      <span className="mt-1 block text-xs font-medium uppercase text-slate-500">{product.category}</span>
                    </span>
                    <span className="mt-3 flex items-end justify-between gap-2">
                      <span className={`inline-flex rounded-full px-2.5 py-1 text-xs font-bold ${isSoldOut || product.is_available === false ? "bg-red-100 text-red-800" : "bg-emerald-100 text-emerald-800"}`}>
                        {product.is_available === false
                          ? `Unavailable · ${availableStock ?? "stock unknown"}`
                          : isSoldOut
                            ? "Out of stock · 0 available"
                            : availableStock === null ? "Stock not provided" : `${availableStock} available`}
                      </span>
                      <span className="text-lg font-semibold text-red-700">{price === 0 ? "Included" : money(price)}</span>
                    </span>
                  </button>
                );
              })}
            </div>
          </CardContent>
        </Card>}
      </div>

      {!isSelectingExistingTable && <aside className="min-w-0">
        <Card className="h-full">
          <CardHeader>
            <CardTitle>{isPickup ? "Pickup order" : "Order"}</CardTitle>
          </CardHeader>
          <CardContent className="grid h-full content-start gap-4">
            {isDineIn && (
              <>
                <div aria-label="Order type" className="grid grid-cols-2 gap-2" role="group">
                  {([
                    ["ala_carte", "A la carte"],
                    ["unlimited", "Unlimited"]
                  ] as const).map(([value, label]) => (
                    <button
                      key={value}
                      aria-pressed={orderType === value}
                      className={`rounded-md border px-3 py-2 text-sm font-bold ${orderType === value ? "border-slate-900 bg-slate-900 text-white" : "border-slate-300 bg-white text-slate-700"}`}
                      onClick={() => onOrderTypeChange(value)}
                      type="button"
                    >
                      {label}
                    </button>
                  ))}
                </div>
                <label className="grid gap-1 text-sm font-medium text-slate-700">
                  {orderType === "unlimited" ? "Unlimited headcount" : "Headcount"}
                  <input
                    aria-label={orderType === "unlimited" ? "Unlimited headcount" : "Headcount"}
                    className="h-10 rounded-md border border-slate-300 px-3"
                    type="number"
                    min={1}
                    max={100}
                    step={1}
                    value={headcount}
                    disabled={activeUnlimitedPaxCount !== null}
                    onChange={(event) => onHeadcountChange(Number(event.target.value))}
                  />
                </label>
                {orderType === "unlimited" && (
                  <div className="rounded-md bg-amber-50 p-3 text-sm text-amber-950">
                    {unlimitedPackageEstimate === null
                      ? "Unlimited package pricing is unavailable."
                      : `Unlimited package: ${packagePaxCount} × ${money(Number(packagePricePerPerson))} = ${money(unlimitedPackageEstimate)}${activeUnlimitedPaxCount !== null ? " (active session)" : " (estimated; due at bill-out)"}`}
                  </div>
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
              <div className="grid max-h-[52vh] gap-2 overflow-y-auto pr-1">
                {items.length === 0 ? (
                  <div className="grid justify-items-center gap-2 rounded-md border border-dashed border-slate-300 p-6 text-center text-sm text-slate-500">
                    <ShoppingCart className="h-8 w-8" />
                    Cart is empty
                  </div>
                ) : items.map((item) => {
                  const unitPrice = getCartPrice(item, cartKey);
                  return (
                    <div key={`${item.product.id}-${item.diningOrderType ?? "default"}`} className="rounded-md border border-slate-200 bg-white p-3">
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <p className="font-semibold text-slate-950">{item.quantity} × {item.product.name}</p>
                          <p className="text-sm text-slate-500">
                            {item.diningOrderType === "unlimited"
                              ? "Unlimited included"
                              : `${item.diningOrderType === "ala_carte" ? "A la carte · " : ""}${money(unitPrice)}`}
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

            <div className="mt-auto grid gap-2 border-t border-slate-200 pt-4 text-sm">
              <div className="flex items-center justify-between text-slate-600"><span>Subtotal</span><span>{money(subtotal)}</span></div>
              {hasUnlimitedItems && unlimitedPackageEstimate !== null && (
                <div className="flex items-center justify-between text-slate-600">
                  <span>Unlimited package · due at bill-out</span>
                  <span>{money(unlimitedPackageEstimate)}</span>
                </div>
              )}
              <div className="flex items-center justify-between text-lg font-semibold text-slate-950"><span>Total</span><span>{money(total)}</span></div>
              {lastCommittedOrderNumber && onReprintLastOrder && (
                <Button variant="outline" onClick={onReprintLastOrder}>
                  Reprint last order · {lastCommittedOrderNumber}
                </Button>
              )}
              <Button className="mt-2 min-h-12" disabled={actionDisabled} onClick={onAction}>{actionLabel}</Button>
            </div>
          </CardContent>
        </Card>
      </aside>}
    </section>
  );
}

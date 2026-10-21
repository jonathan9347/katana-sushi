import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { Minus, Plus, Printer, Settings, ShoppingCart, Trash2 } from "lucide-react";
import SectionNav, { SectionNavTab } from "../../../components/layout/SectionNav";
import PaymentModal from "./PaymentModal";
import { PosProduct, usePosCart } from "./store";
import { api } from "../../../lib/api";
import { defaultSystemSettings, fetchSystemSettings, type SystemSettings } from "../../../lib/systemSettings";
import { useToast } from "../../../hooks/useToast";
import { Button } from "../../../components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "../../../components/ui/card";
import { Select } from "../../../components/ui/select";
import DiningService from "./DiningService";

type PosTransaction = {
  id: string;
  transaction_number: string;
  customer_name?: string | null;
  transaction_type: string;
  subtotal: number;
  tax: number;
  total: number;
  payment_method: string;
  cash_received?: number | null;
  change_due?: number | null;
  created_at: string;
  items: Array<{
    quantity: number;
    unit_price: number;
    total_price: number;
    selling_product: {
      name: string;
    };
  }>;
};

type PickupOrder = {
  order_number: string;
  status: "ready" | "completed";
  payment_plan: "pay_now" | "pay_at_pickup";
  payment_status: string;
  payment_method: string | null;
  customer_name: string;
  created_at: string;
  total: number;
  items: Array<{ name: string; quantity: number; unit_price: number; total_price: number }>;
};

const posTabs: Array<SectionNavTab> = [
  { id: "new-sale", label: "Takeout Sale", icon: <ShoppingCart className="h-4 w-4" />, to: "/staff/pos", end: true },
  { id: "history", label: "Transaction History", icon: <Printer className="h-4 w-4" />, to: "/staff/pos/history" },
  { id: "settings", label: "Unlimited Settings", icon: <Settings className="h-4 w-4" />, to: "/staff/pos/unlimited-settings" }
];

function getStoredRole() {
  if (!localStorage.getItem("katana_token")) {
    return "staff";
  }

  return localStorage.getItem("katana_role")?.toLowerCase() ?? "staff";
}

function money(value: number) {
  return `PHP ${value.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function getApiErrorMessage(error: unknown, fallback: string) {
  if (typeof error === "object" && error && "response" in error) {
    const response = (error as { response?: { data?: { message?: string } } }).response;
    return response?.data?.message ?? fallback;
  }

  return fallback;
}

export default function PosPage() {
  const [customerType, setCustomerType] = useState<"new_customer" | "existing_table" | "pickup_customer">("new_customer");
  const [customerService, setCustomerService] = useState<"dine_in" | "takeout">("takeout");
  const [selectedDiningSessionId, setSelectedDiningSessionId] = useState("");
  const [hasUnconfirmedDiningDrafts, setHasUnconfirmedDiningDrafts] = useState(false);
  const [customerName, setCustomerName] = useState("");
  const [pickupSearch, setPickupSearch] = useState("");
  const [selectedPickupOrder, setSelectedPickupOrder] = useState<PickupOrder | null>(null);
  const [category, setCategory] = useState("All");
  const [paymentOpen, setPaymentOpen] = useState(false);
  const role = getStoredRole();
  const allowed = role === "admin" || role === "cashier";
  const { addItem, clearCart, decrementItem, items, removeItem } = usePosCart();
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const productsQuery = useQuery({
    queryKey: ["products"],
    queryFn: async () => {
      const response = await api.get<{ products: PosProduct[] }>("/api/products");
      return response.data.products;
    },
    refetchInterval: 15_000,
    enabled: allowed
  });

  const pickupOrdersQuery = useQuery({
    queryKey: ["pos", "pickup-orders", pickupSearch.trim()],
    queryFn: async () => {
      const response = await api.get<{ orders: PickupOrder[] }>("/api/pos/pickup-orders", {
        params: { name: pickupSearch.trim() }
      });
      return response.data.orders;
    },
    enabled: allowed && customerType === "pickup_customer" && pickupSearch.trim().length >= 2,
    staleTime: 5_000
  });

  const systemSettingsQuery = useQuery({
    queryKey: ["system-settings"],
    queryFn: fetchSystemSettings,
    enabled: allowed,
    retry: 1
  });

  const systemSettings = systemSettingsQuery.data ?? defaultSystemSettings;
  const isDineIn = customerType === "existing_table"
    || (customerType === "new_customer" && customerService === "dine_in");
  const isPickupCustomer = customerType === "pickup_customer";

  function confirmLeavingDineIn() {
    if (!hasUnconfirmedDiningDrafts) return true;
    const confirmed = window.confirm("Switching away will discard the unconfirmed dine-in order. Continue?");
    if (confirmed) setHasUnconfirmedDiningDrafts(false);
    return confirmed;
  }

  const totals = useMemo(() => {
    const subtotal = items.reduce((sum, item) => sum + Number(item.product.price) * item.quantity, 0);

    return {
      subtotal,
      total: Number(subtotal.toFixed(2))
    };
  }, [items]);

  const categories = useMemo(() => {
    const productCategories = new Set((productsQuery.data ?? []).map((product) => product.category));
    return ["All", ...Array.from(productCategories).sort()];
  }, [productsQuery.data]);

  const visibleProducts = useMemo(() => {
    return (productsQuery.data ?? []).filter((product) => category === "All" || product.category === category);
  }, [category, productsQuery.data]);

  const checkoutMutation = useMutation({
    mutationFn: async (payment: { paymentMethod: "cash" | "gcash" | "bank_transfer"; cashReceived?: number }) => {
      console.debug("Checkout submit", {
        itemCount: items.length,
        hasToken: Boolean(localStorage.getItem("katana_token"))
      });
      const response = await api.post<{ transaction: PosTransaction }>("/api/pos/transaction", {
        customerName,
        transactionType: "takeout",
        paymentMethod: payment.paymentMethod,
        cashReceived: payment.cashReceived,
        items: items.map((item) => ({
          productId: item.product.id,
          quantity: item.quantity,
          unitPrice: Number(item.product.price)
        }))
      });

      return response.data.transaction;
    },
    onSuccess: (transaction) => {
      setPaymentOpen(false);
      clearCart();
      setCustomerName("");
      queryClient.invalidateQueries({ queryKey: ["inventory"] });
      queryClient.invalidateQueries({ queryKey: ["products"] });
      queryClient.invalidateQueries({ queryKey: ["pos", "transactions"] });
      toast("Payment completed.");
      printReceipt(transaction, systemSettings);
    },
    onError: (error) => {
      console.error("Checkout failed", error);
      toast(getApiErrorMessage(error, "Unable to complete payment."));
    }
  });

  const pickupCompletionMutation = useMutation({
    mutationFn: async (payment: { paymentMethod?: "cash"; cashReceived?: number }) => {
      if (!selectedPickupOrder) {
        throw new Error("Select a ready pickup order first.");
      }
      const response = await api.post<{ order: PickupOrder }>(
        `/api/pos/pickup-orders/${encodeURIComponent(selectedPickupOrder.order_number)}/complete`,
        selectedPickupOrder.payment_status === "paid" ? {} : payment
      );
      return response.data.order;
    },
    onSuccess: () => {
      setPaymentOpen(false);
      setSelectedPickupOrder(null);
      setPickupSearch("");
      queryClient.invalidateQueries({ queryKey: ["pos", "pickup-orders"] });
      queryClient.invalidateQueries({ queryKey: ["inventory"] });
      toast("Pickup order completed and handed over.");
    },
    onError: (error) => {
      toast(getApiErrorMessage(error, "Unable to complete this pickup order."));
      queryClient.invalidateQueries({ queryKey: ["pos", "pickup-orders"] });
    }
  });

  function handleCheckout() {
    if (items.length === 0) {
      toast("Add at least one item before checkout.");
      return;
    }

    setPaymentOpen(true);
  }

  function handlePickupCheckout() {
    if (!selectedPickupOrder) return;
    if (selectedPickupOrder.payment_status === "paid") {
      pickupCompletionMutation.mutate({});
      return;
    }
    setPaymentOpen(true);
  }

  if (!allowed) {
    return (
      <main className="flex min-h-screen flex-col items-center justify-center gap-4 px-6 text-center">
        <h1 className="text-2xl font-semibold text-slate-950">POS access required</h1>
        <p className="max-w-md text-slate-600">Sign in with an admin or cashier account to use the POS.</p>
        <Link className="text-red-700 underline" to="/staff/login">
          Go to staff login
        </Link>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-slate-100 px-4 py-4 lg:pr-6">
      <div className="grid w-full gap-4">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm font-medium uppercase text-red-700">Point of Sale</p>
            <h1 className="text-3xl font-semibold text-slate-950">
              {customerType === "existing_table"
                ? "Existing table"
                : isPickupCustomer
                  ? "Pickup customer"
                  : customerService === "dine_in"
                    ? "Dine in"
                    : "Takeout Sale"}
            </h1>
          </div>
          <p className="text-sm text-slate-500">Signed in as {role}</p>
        </div>

        <section aria-label="Customer type" className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
          <h2 className="text-sm font-bold uppercase text-slate-600">Customer type</h2>
          <div aria-label="Customer type choices" className="mt-3 flex flex-wrap gap-2" role="group">
            <button
              aria-pressed={customerType === "new_customer"}
              className={`rounded-md border px-4 py-2 text-sm font-bold ${customerType === "new_customer" ? "border-red-800 bg-red-800 text-white" : "border-slate-300 bg-white text-slate-700"}`}
              onClick={() => {
                if (!confirmLeavingDineIn()) return;
                setCustomerType("new_customer");
                setCustomerService("takeout");
                setSelectedDiningSessionId("");
                setSelectedPickupOrder(null);
              }}
              type="button"
            >
              New customer
            </button>
            <button
              aria-pressed={customerType === "existing_table"}
              className={`rounded-md border px-4 py-2 text-sm font-bold ${customerType === "existing_table" ? "border-red-800 bg-red-800 text-white" : "border-slate-300 bg-white text-slate-700"}`}
              onClick={() => {
                if (!confirmLeavingDineIn()) return;
                setCustomerType("existing_table");
                setSelectedDiningSessionId("");
                setSelectedPickupOrder(null);
              }}
              type="button"
            >
              Existing table
            </button>
            <button
              aria-pressed={isPickupCustomer}
              className={`rounded-md border px-4 py-2 text-sm font-bold ${isPickupCustomer ? "border-red-800 bg-red-800 text-white" : "border-slate-300 bg-white text-slate-700"}`}
              onClick={() => {
                if (!confirmLeavingDineIn()) return;
                setCustomerType("pickup_customer");
                setSelectedDiningSessionId("");
              }}
              type="button"
            >
              Pickup customer
            </button>
          </div>
          {customerType === "new_customer" && <div aria-label="New customer service type" className="mt-3 flex flex-wrap items-center gap-2" role="group">
            <span className="text-sm font-medium text-slate-600">New customer service:</span>
            <button
              aria-pressed={customerService === "dine_in"}
              className={`rounded-md border px-4 py-2 text-sm font-bold ${customerService === "dine_in" ? "border-red-800 bg-red-800 text-white" : "border-slate-300 bg-white text-slate-700"}`}
              onClick={() => {
                if (!confirmLeavingDineIn()) return;
                setCustomerService("dine_in");
                setSelectedDiningSessionId("");
              }}
              type="button"
            >
              Dine in
            </button>
            <button
              aria-pressed={customerService === "takeout"}
              className={`rounded-md border px-4 py-2 text-sm font-bold ${customerService === "takeout" ? "border-slate-800 bg-slate-800 text-white" : "border-slate-300 bg-white text-slate-700"}`}
              onClick={() => {
                if (!confirmLeavingDineIn()) return;
                setCustomerService("takeout");
                setSelectedDiningSessionId("");
              }}
              type="button"
            >
              Takeout
            </button>
          </div>}
          <div className="mt-2 space-y-1 text-xs text-slate-500">
            {customerType === "new_customer" && <p id="existing-table-unavailable">Existing table opens the table board.</p>}
            {isPickupCustomer && <p>Search for a staff-approved, ready pickup order by customer name.</p>}
          </div>
        </section>

        {isDineIn ? (
          selectedDiningSessionId ? (
            <DiningService
              key={`dining-order-${selectedDiningSessionId}`}
              mode="service"
              embedded
              initialSessionId={selectedDiningSessionId}
              onSessionSelected={setSelectedDiningSessionId}
              onDraftStateChange={setHasUnconfirmedDiningDrafts}
              onBackToBoard={() => {
                if (!confirmLeavingDineIn()) return;
                setSelectedDiningSessionId("");
              }}
            />
          ) : (
            <DiningService
              key="dining-board"
              mode="board"
              embedded
              onSessionSelected={setSelectedDiningSessionId}
            />
          )
        ) : isPickupCustomer ? (
          <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(320px,0.8fr)]">
            <Card className="min-w-0">
              <CardHeader>
                <CardTitle>Find ready pickup orders</CardTitle>
              </CardHeader>
              <CardContent className="grid gap-4">
                <label className="grid gap-1 text-sm font-medium text-slate-700">
                  <span>Customer name</span>
                  <input
                    className="h-11 rounded-md border border-slate-300 px-3 text-sm outline-none focus:border-red-700 focus:ring-2 focus:ring-red-100"
                    autoComplete="off"
                    value={pickupSearch}
                    onChange={(event) => {
                      setPickupSearch(event.target.value);
                      setSelectedPickupOrder(null);
                    }}
                    placeholder="Enter at least 2 characters"
                  />
                </label>
                {pickupSearch.trim().length < 2 && (
                  <p className="text-sm text-slate-500">Enter at least 2 characters to search approved, ready pickup orders.</p>
                )}
                {pickupOrdersQuery.isLoading && <p className="text-sm text-slate-500">Searching pickup orders...</p>}
                {pickupOrdersQuery.isError && <p role="alert" className="text-sm text-red-700">Unable to search pickup orders. Please retry.</p>}
                {pickupSearch.trim().length >= 2 && pickupOrdersQuery.isSuccess && pickupOrdersQuery.data.length === 0 && (
                  <p className="text-sm text-slate-500">No ready pickup orders match that name.</p>
                )}
                <div className="grid gap-2">
                  {pickupOrdersQuery.data?.map((order) => (
                    <button
                      key={order.order_number}
                      type="button"
                      aria-pressed={selectedPickupOrder?.order_number === order.order_number}
                      onClick={() => setSelectedPickupOrder(order)}
                      className={`flex items-center justify-between gap-3 rounded-md border p-3 text-left ${selectedPickupOrder?.order_number === order.order_number ? "border-red-700 bg-red-50" : "border-slate-200 bg-white hover:bg-slate-50"}`}
                    >
                      <span>
                        <span className="block font-semibold text-slate-950">{order.customer_name}</span>
                        <span className="block text-xs text-slate-500">{order.order_number} · Ready</span>
                      </span>
                      <span className="text-sm font-bold text-slate-900">{money(order.total)}</span>
                    </button>
                  ))}
                </div>
              </CardContent>
            </Card>

            <Card className="min-w-0">
              <CardHeader>
                <CardTitle>Pickup checkout</CardTitle>
              </CardHeader>
              <CardContent className="grid content-start gap-4">
                {!selectedPickupOrder ? (
                  <p className="rounded-md border border-dashed border-slate-300 p-6 text-center text-sm text-slate-500">
                    Select a ready pickup order to load its cart.
                  </p>
                ) : (
                  <>
                    <div>
                      <p className="font-semibold text-slate-950">{selectedPickupOrder.customer_name}</p>
                      <p className="text-sm text-slate-500">{selectedPickupOrder.order_number}</p>
                      <p className="mt-2 text-sm font-semibold text-emerald-800">Ready for pickup</p>
                    </div>
                    <div className="grid gap-2">
                      {selectedPickupOrder.items.map((item, index) => (
                        <div key={`${selectedPickupOrder.order_number}-${index}`} className="flex justify-between gap-3 rounded-md border border-slate-200 p-3 text-sm">
                          <span>{item.quantity} × {item.name}</span>
                          <span className="font-semibold">{money(item.total_price)}</span>
                        </div>
                      ))}
                    </div>
                    <div className="grid gap-2 border-t border-slate-200 pt-4 text-sm">
                      <TotalLine label="Total" value={selectedPickupOrder.total} strong />
                      {selectedPickupOrder.payment_status === "paid" ? (
                        <>
                          <p className="text-sm text-emerald-800">
                            Already paid{selectedPickupOrder.payment_method ? ` · ${selectedPickupOrder.payment_method.replace(/_/g, " ")}` : ""}. No payment will be collected again.
                          </p>
                          <Button
                            className="mt-2 min-h-12"
                            disabled={pickupCompletionMutation.isPending}
                            onClick={handlePickupCheckout}
                          >
                            {pickupCompletionMutation.isPending ? "Completing..." : "Complete pickup"}
                          </Button>
                        </>
                      ) : (
                        <>
                          <p className="text-sm text-amber-800">Payment is due at pickup. Collect cash before handover.</p>
                          <Button
                            className="mt-2 min-h-12"
                            disabled={pickupCompletionMutation.isPending}
                            onClick={handlePickupCheckout}
                          >
                            Collect payment & complete
                          </Button>
                        </>
                      )}
                    </div>
                  </>
                )}
              </CardContent>
            </Card>
          </div>
        ) : (
        <div className="grid gap-4 lg:grid-cols-[220px_minmax(0,1fr)] lg:items-start">
          <aside className="lg:sticky lg:top-6">
            <SectionNav orientation="vertical" tabs={posTabs} />
          </aside>

          <section className="min-w-0">
            <div className="grid min-h-[calc(100vh-112px)] gap-4 xl:grid-cols-[7fr_3fr]">
              <>
          <Card className="min-w-0">
            <CardHeader className="gap-3">
              <div className="flex items-center justify-between gap-3">
                <CardTitle>Products</CardTitle>
                <Select className="h-11 w-56" value={category} onChange={(event) => setCategory(event.target.value)}>
                  {categories.map((item) => (
                    <option key={item} value={item}>
                      {item}
                    </option>
                  ))}
                </Select>
              </div>
            </CardHeader>
            <CardContent>
              {productsQuery.isLoading && <p className="text-sm text-slate-500">Loading products...</p>}
              {productsQuery.isError && <p className="text-sm text-red-700">Unable to load products.</p>}
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4">
                {visibleProducts.map((product) => {
                  const cartQuantity = items.find((item) => item.product.id === product.id)?.quantity ?? 0;
                  const availableStock = product.available_stock === null || product.available_stock === undefined
                    ? 0
                    : Math.floor(product.available_stock);
                  const isSoldOut = availableStock === 0;
                  const disabled = product.is_available === false || isSoldOut || cartQuantity >= availableStock;

                  return (
                    <button
                      key={product.id}
                      className="flex min-h-32 flex-col justify-between rounded-md border border-slate-200 bg-white p-4 text-left shadow-sm transition hover:border-red-200 hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-60"
                      disabled={disabled}
                      type="button"
                      onClick={() => addItem(product)}
                    >
                      <span>
                        <span className="block text-base font-semibold text-slate-950">{product.name}</span>
                        <span className="mt-1 block text-xs font-medium uppercase text-slate-500">{product.category}</span>
                      </span>
                      <span className="mt-3 flex items-end justify-between gap-2">
                        <span className={`inline-flex rounded-full px-2.5 py-1 text-xs font-bold ${isSoldOut || product.is_available === false ? "bg-red-100 text-red-800" : "bg-emerald-100 text-emerald-800"}`}>
                          {product.is_available === false
                            ? `Unavailable · ${availableStock} in stock`
                            : isSoldOut
                              ? "Out of stock · 0 available"
                              : `${availableStock} available`}
                        </span>
                        <span className="text-lg font-semibold text-red-700">{money(Number(product.price))}</span>
                      </span>
                    </button>
                  );
                })}
              </div>
            </CardContent>
          </Card>

          <Card className="min-w-0">
            <CardHeader>
              <CardTitle>Cart</CardTitle>
            </CardHeader>
            <CardContent className="grid h-full content-start gap-4">
              <div className="grid gap-3">
                <label className="grid gap-1 text-sm font-medium text-slate-700">
                  <span>Customer Name</span>
                  <input
                    className="h-11 rounded-md border border-slate-300 px-3 text-sm outline-none focus:border-red-700 focus:ring-2 focus:ring-red-100"
                    placeholder="Optional"
                    value={customerName}
                    onChange={(event) => setCustomerName(event.target.value)}
                  />
                </label>
              </div>

              <div className="grid max-h-[38vh] gap-2 overflow-y-auto pr-1">
                {items.length === 0 && (
                  <div className="grid justify-items-center gap-2 rounded-md border border-dashed border-slate-300 p-6 text-center text-sm text-slate-500">
                    <ShoppingCart className="h-8 w-8" />
                    Cart is empty
                  </div>
                )}
                {items.map((item) => {
                  const currentProduct = productsQuery.data?.find((product) => product.id === item.product.id) ?? item.product;

                  return (
                  <div key={item.product.id} className="rounded-md border border-slate-200 bg-white p-3">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <p className="font-semibold text-slate-950">{item.product.name}</p>
                        <p className="text-sm text-slate-500">{money(Number(item.product.price))}</p>
                      </div>
                      <Button size="sm" variant="ghost" onClick={() => removeItem(item.product.id)}>
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                    <div className="mt-3 flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <Button size="sm" variant="outline" onClick={() => decrementItem(item.product.id)}>
                          <Minus className="h-4 w-4" />
                        </Button>
                        <span className="grid h-11 min-w-11 place-items-center rounded-md border border-slate-200 text-sm font-semibold">
                          {item.quantity}
                        </span>
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={currentProduct.available_stock != null && item.quantity >= currentProduct.available_stock}
                          onClick={() => addItem(currentProduct)}
                        >
                          <Plus className="h-4 w-4" />
                        </Button>
                      </div>
                      <p className="font-semibold text-slate-950">{money(Number(item.product.price) * item.quantity)}</p>
                    </div>
                  </div>
                  );
                })}
              </div>

              <div className="mt-auto grid gap-2 border-t border-slate-200 pt-4 text-sm">
                <TotalLine label="Subtotal" value={totals.subtotal} />
                <TotalLine label="Total" value={totals.total} strong />
                <Button
                  className="mt-2 min-h-12"
                  disabled={items.length === 0 || checkoutMutation.isPending}
                  onClick={handleCheckout}
                >
                  Checkout
                </Button>
              </div>
            </CardContent>
          </Card>
          </>
            </div>
          </section>
        </div>
        )}
      </div>

      <PaymentModal
        open={paymentOpen}
        pending={isPickupCustomer ? pickupCompletionMutation.isPending : checkoutMutation.isPending}
        total={isPickupCustomer ? selectedPickupOrder?.total ?? 0 : totals.total}
        onClose={() => setPaymentOpen(false)}
        onConfirm={(payment) => {
          if (isPickupCustomer) {
            if (payment.paymentMethod !== "cash") return;
            pickupCompletionMutation.mutate({
              paymentMethod: "cash",
              cashReceived: payment.cashReceived
            });
          } else {
            checkoutMutation.mutate(payment);
          }
        }}
      />
    </main>
  );
}

function TotalLine({ label, value, strong = false }: { label: string; value: number; strong?: boolean }) {
  return (
    <div className={`flex items-center justify-between ${strong ? "text-lg font-semibold text-slate-950" : "text-slate-600"}`}>
      <span>{label}</span>
      <span>{money(value)}</span>
    </div>
  );
}

function printReceipt(transaction: PosTransaction, settings: SystemSettings) {
  const receipt = window.open("", "_blank", "width=380,height=640");

  if (!receipt) {
    window.print();
    return;
  }

  receipt.document.write(`
    <html>
      <head>
        <title>${transaction.transaction_number}</title>
        <style>
          body { font-family: Arial, sans-serif; margin: 16px; color: #111827; }
          @page { size: ${settings.receipt_paper_size === "A4" ? "A4" : settings.receipt_paper_size}; margin: 8mm; }
          h1 { font-size: 18px; margin: 0 0 4px; text-align: center; }
          p { margin: 4px 0; }
          table { border-collapse: collapse; width: 100%; margin-top: 12px; }
          td { padding: 4px 0; font-size: 12px; vertical-align: top; }
          .right { text-align: right; }
          .line { border-top: 1px dashed #94a3b8; margin: 12px 0; }
          .total { font-weight: 700; font-size: 14px; }
        </style>
      </head>
      <body>
        <h1>${settings.restaurant_name}</h1>
        <p>Transaction: ${transaction.transaction_number}</p>
        <p>Date: ${new Date(transaction.created_at).toLocaleString()}</p>
        <p>Payment: ${transaction.payment_method.toUpperCase()}</p>
        ${transaction.customer_name ? `<p>Customer: ${transaction.customer_name}</p>` : ""}
        <div class="line"></div>
        <table>
          ${transaction.items
            .map(
              (item) => `
                <tr>
                  <td>${item.quantity} x ${item.selling_product.name}</td>
                  <td class="right">${money(item.total_price)}</td>
                </tr>
              `
            )
            .join("")}
        </table>
        <div class="line"></div>
        <p class="right">Subtotal: ${money(transaction.subtotal)}</p>
        ${transaction.tax > 0 ? `<p class="right">Tax: ${money(transaction.tax)}</p>` : ""}
        <p class="right total">Total: ${money(transaction.total)}</p>
        ${
          transaction.payment_method === "cash"
            ? `<p class="right">Cash: ${money(Number(transaction.cash_received ?? 0))}</p><p class="right">Change: ${money(Number(transaction.change_due ?? 0))}</p>`
            : ""
        }
        <div class="line"></div>
        <p style="text-align:center">${settings.receipt_footer}</p>
        <script>
          window.onload = () => {
            window.print();
            window.onafterprint = () => window.close();
          };
        </script>
      </body>
    </html>
  `);
  receipt.document.close();
}

import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "../../../lib/api";

type FulfillmentStatus = "pending_payment" | "payment_failed" | "pending_approval" | "confirmed" | "preparing" | "ready" | "released" | "cancelled" | "expired";

type TakeoutOrder = {
  order_number: string;
  status: FulfillmentStatus;
  payment_plan: "pay_now" | "pay_at_pickup";
  payment_status: string;
  payment_method: string | null;
  payment_transaction_id: string | null;
  customer_name: string;
  customer_phone: string;
  created_at: string;
  total: number;
  items: Array<{ name: string; quantity: number; unit_price: number; total_price: number }>;
};

function money(value: number) {
  return new Intl.NumberFormat("en-PH", { style: "currency", currency: "PHP" }).format(value);
}

function orderError(error: unknown) {
  if (typeof error === "object" && error !== null && "response" in error) {
    const response = (error as { response?: { data?: { message?: string } } }).response;
    if (response?.data?.message) return response.data.message;
  }
  return error instanceof Error ? error.message : "Unable to load pickup orders.";
}

export default function TakeoutOrders() {
  const [orders, setOrders] = useState<TakeoutOrder[]>([]);
  const [errorMessage, setErrorMessage] = useState("");
  const [readyNotice, setReadyNotice] = useState("");
  const [loading, setLoading] = useState(true);
  const [updating, setUpdating] = useState<string | null>(null);
  const [pickupPaymentMethods, setPickupPaymentMethods] = useState<Record<string, string>>({});
  const previousStatuses = useRef<Map<string, FulfillmentStatus> | null>(null);

  const loadOrders = useCallback(async () => {
    try {
      const response = await api.get<{ orders: TakeoutOrder[] }>("/api/admin/takeout/orders");
      const nextOrders = response.data.orders;
      const previous = previousStatuses.current;
      if (previous) {
        const newlyReady = nextOrders
          .filter((order) => order.status === "ready" && previous.get(order.order_number) !== "ready")
          .map((order) => order.order_number);
        if (newlyReady.length > 0) {
          setReadyNotice(`${newlyReady.join(", ")} ${newlyReady.length === 1 ? "is" : "are"} ready for pickup.`);
        }
      }
      previousStatuses.current = new Map(nextOrders.map((order) => [order.order_number, order.status]));
      setOrders(nextOrders);
      setErrorMessage("");
    } catch (error) {
      setErrorMessage(orderError(error));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadOrders();
    const timer = window.setInterval(() => void loadOrders(), 15000);
    return () => window.clearInterval(timer);
  }, [loadOrders]);

  async function setStatus(order: TakeoutOrder, status: "confirmed" | "preparing" | "ready" | "released", paymentMethod?: string) {
    setUpdating(order.order_number);
    setErrorMessage("");
    try {
      await api.patch(
        `/api/admin/takeout/orders/${encodeURIComponent(order.order_number)}/status`,
        { status, payment_method: paymentMethod }
      );
      await loadOrders();
    } catch (error) {
      setErrorMessage(orderError(error));
    } finally {
      setUpdating(null);
    }
  }

  return (
    <main className="min-h-screen bg-slate-100 p-4 pb-24 text-slate-900 md:p-7 md:pb-8">
      <div className="mx-auto max-w-6xl">
        <header className="mb-6 flex flex-wrap items-end justify-between gap-3">
          <div>
            <p className="text-xs font-bold uppercase tracking-[0.2em] text-red-700">Pickup fulfillment</p>
            <h1 className="mt-1 text-3xl font-black">Takeout orders</h1>
          </div>
          <button type="button" onClick={() => void loadOrders()} className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-bold hover:bg-slate-50">
            Refresh
          </button>
        </header>

        {errorMessage && <p role="alert" className="mb-4 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800">{errorMessage}</p>}
        {readyNotice && (
          <div role="status" className="mb-4 flex items-center justify-between gap-3 rounded-lg border border-emerald-300 bg-emerald-50 p-3 text-sm font-bold text-emerald-900">
            <p>{readyNotice}</p>
            <button type="button" aria-label="Dismiss ready notification" onClick={() => setReadyNotice("")} className="rounded px-2 py-1 hover:bg-emerald-100">Dismiss</button>
          </div>
        )}
        {loading ? (
          <p className="rounded-xl bg-white p-6 text-slate-600">Loading pickup orders...</p>
        ) : orders.length === 0 ? (
          <p className="rounded-xl bg-white p-6 text-slate-600">No active pickup orders.</p>
        ) : (
          <div className="space-y-4">
            {orders.map((order) => (
              <article key={order.order_number} className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm sm:p-6">
                <div className="flex flex-wrap items-start justify-between gap-3 border-b border-slate-100 pb-4">
                  <div>
                    <h2 className="text-lg font-black">{order.order_number}</h2>
                    <p className="mt-1 text-sm text-slate-600">{order.customer_name} · {order.customer_phone}</p>
                    <p className="mt-1 text-xs text-slate-500">{new Date(order.created_at).toLocaleString()}</p>
                  </div>
                  <div className="text-right text-sm">
                    <p className="font-bold capitalize">{order.status === "pending_approval" ? "Awaiting approval" : order.status.replace(/_/g, " ")}</p>
                    <p className="mt-1 text-slate-600">Payment: {order.payment_status.replace(/_/g, " ")}</p>
                    <p className="text-slate-600">{order.payment_plan === "pay_now" ? order.payment_method ?? "Online" : "Pay at pickup"}</p>
                  </div>
                </div>
                {order.status === "ready" && (
                  <p className="mt-4 rounded-lg border border-emerald-300 bg-emerald-50 px-3 py-2 text-sm font-bold text-emerald-900" role="status">
                    Ready for pickup
                  </p>
                )}
                <div className="grid gap-2 py-4 sm:grid-cols-2">
                  {order.items.map((item, index) => (
                    <div key={`${item.name}-${index}`} className="flex justify-between gap-4 text-sm">
                      <span>{item.quantity} × {item.name}</span>
                      <span>{money(item.total_price)}</span>
                    </div>
                  ))}
                  <div className="flex justify-between border-t border-slate-100 pt-2 font-bold sm:col-span-2">
                    <span>Total</span><span>{money(order.total)}</span>
                  </div>
                </div>
                <div className="flex flex-wrap justify-end gap-2">
                  {order.status === "pending_approval" && (
                    <button
                      type="button"
                      disabled={updating === order.order_number || (order.payment_plan === "pay_now" && order.payment_status !== "paid")}
                      onClick={() => void setStatus(order, "confirmed")}
                      className="rounded-lg bg-green-700 px-4 py-2 text-sm font-bold text-white disabled:opacity-50"
                    >
                      {order.payment_plan === "pay_now" && order.payment_status !== "paid"
                        ? "Awaiting payment"
                        : "Approve order"}
                    </button>
                  )}
                  {order.status === "confirmed" && (
                    <button type="button" disabled={updating === order.order_number} onClick={() => void setStatus(order, "preparing")} className="rounded-lg bg-amber-100 px-4 py-2 text-sm font-bold text-amber-900 disabled:opacity-50">
                      Start preparing
                    </button>
                  )}
                  {order.status === "preparing" && (
                    <button type="button" disabled={updating === order.order_number} onClick={() => void setStatus(order, "ready")} className="rounded-lg bg-blue-100 px-4 py-2 text-sm font-bold text-blue-900 disabled:opacity-50">
                      Mark ready
                    </button>
                  )}
                  {order.status === "ready" && (
                    <>
                      {order.payment_plan === "pay_at_pickup" && order.payment_status !== "paid" && (
                        <select
                          aria-label={`Payment method for ${order.order_number}`}
                          value={pickupPaymentMethods[order.order_number] ?? ""}
                          onChange={(event) => setPickupPaymentMethods((current) => ({
                            ...current,
                            [order.order_number]: event.target.value
                          }))}
                          className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm"
                        >
                          <option value="">Record pickup payment...</option>
                          <option value="cash">Cash</option>
                          <option value="gcash">GCash</option>
                          <option value="bank_transfer">Bank transfer</option>
                        </select>
                      )}
                      <button
                        type="button"
                        disabled={
                          updating === order.order_number ||
                          (order.payment_plan === "pay_at_pickup" &&
                            order.payment_status !== "paid" &&
                            !pickupPaymentMethods[order.order_number])
                        }
                        onClick={() => void setStatus(
                          order,
                          "released",
                          pickupPaymentMethods[order.order_number]
                        )}
                        className="rounded-lg bg-green-700 px-4 py-2 text-sm font-bold text-white disabled:opacity-50"
                      >
                        Hand to customer
                      </button>
                    </>
                  )}
                </div>
              </article>
            ))}
          </div>
        )}
      </div>
    </main>
  );
}

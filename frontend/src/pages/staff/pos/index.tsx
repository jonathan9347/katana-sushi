import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { Minus, Plus, Printer, Settings, ShoppingCart, Trash2 } from "lucide-react";
import SectionNav, { SectionNavTab } from "../../../components/layout/SectionNav";
import PaymentModal from "./PaymentModal";
import StartUnlimitedModal from "./StartUnlimitedModal";
import UnlimitedSession from "./UnlimitedSession";
import { PosProduct, usePosCart } from "./store";
import { api } from "../../../lib/api";
import { useToast } from "../../../hooks/useToast";
import { Button } from "../../../components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "../../../components/ui/card";
import { Select } from "../../../components/ui/select";

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

const posTabs: Array<SectionNavTab> = [
  { id: "new-sale", label: "New Sale", icon: <ShoppingCart className="h-4 w-4" />, to: "/staff/pos", end: true },
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
  const [customerName, setCustomerName] = useState("");
  const [transactionType, setTransactionType] = useState<"dine_in" | "takeout">("dine_in");
  const [category, setCategory] = useState("All");
  const [paymentOpen, setPaymentOpen] = useState(false);
  const [startUnlimitedOpen, setStartUnlimitedOpen] = useState(false);
  const [unlimitedSessionId, setUnlimitedSessionId] = useState<string | null>(null);
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
    enabled: allowed
  });

  const unlimitedSettingsQuery = useQuery({
    queryKey: ["admin", "unlimited", "settings"],
    queryFn: async () => {
      const response = await api.get<{ settings: { price_per_person: number } }>("/api/admin/unlimited/settings");
      return response.data.settings;
    },
    enabled: allowed
  });

  const totals = useMemo(() => {
    const subtotal = items.reduce((sum, item) => sum + Number(item.product.price) * item.quantity, 0);
    const tax = subtotal * 0.12;

    return {
      subtotal,
      tax,
      total: subtotal + tax
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
        hasToken: Boolean(localStorage.getItem("katana_token")),
        transactionType
      });
      const response = await api.post<{ transaction: PosTransaction }>("/api/pos/transaction", {
        customerName,
        transactionType,
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
      printReceipt(transaction);
    },
    onError: (error) => {
      console.error("Checkout failed", error);
      toast(getApiErrorMessage(error, "Unable to complete payment."));
    }
  });

  const startUnlimitedMutation = useMutation({
    mutationFn: async (payload: { paxCount: number }) => {
      console.debug("Start unlimited submit", {
        hasToken: Boolean(localStorage.getItem("katana_token")),
        paxCount: payload.paxCount
      });
      const response = await api.post<{ session: { id: string } }>("/api/pos/unlimited/start", payload);
      return response.data.session;
    },
    onSuccess: (session) => {
      setStartUnlimitedOpen(false);
      setUnlimitedSessionId(session.id);
      toast("Unlimited session started.");
    },
    onError: (error) => {
      console.error("Start unlimited failed", error);
      toast(getApiErrorMessage(error, "Unable to start unlimited session."));
    }
  });

  function handleCheckout() {
    if (items.length === 0) {
      toast("Add at least one item before checkout.");
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
    <main className="min-h-screen bg-slate-100 px-4 py-4">
      <div className="mx-auto grid max-w-[1180px] gap-4">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm font-medium uppercase text-red-700">Staff</p>
            <h1 className="text-3xl font-semibold text-slate-950">Point of Sale</h1>
          </div>
          <p className="text-sm text-slate-500">Signed in as {role}</p>
        </div>

        <SectionNav tabs={posTabs} />

        <div className="grid min-h-[calc(100vh-112px)] grid-cols-[7fr_3fr] gap-4">
          {unlimitedSessionId ? (
            <div className="col-span-2">
              <UnlimitedSession sessionId={unlimitedSessionId} onExit={() => setUnlimitedSessionId(null)} />
            </div>
          ) : (
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
              <div className="grid grid-cols-3 gap-3">
                {visibleProducts.map((product) => (
                  <button
                    key={product.id}
                    className="flex min-h-32 flex-col justify-between rounded-md border border-slate-200 bg-white p-4 text-left shadow-sm transition hover:border-red-200 hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-50"
                    disabled={product.is_available === false}
                    type="button"
                    onClick={() => addItem(product)}
                  >
                    <span>
                      <span className="block text-base font-semibold text-slate-950">{product.name}</span>
                      <span className="mt-1 block text-xs font-medium uppercase text-slate-500">{product.category}</span>
                    </span>
                    <span className="text-lg font-semibold text-red-700">{money(Number(product.price))}</span>
                  </button>
                ))}
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
                <label className="grid gap-1 text-sm font-medium text-slate-700">
                  <span>Order Type</span>
                  <Select className="h-11" value={transactionType} onChange={(event) => setTransactionType(event.target.value as "dine_in" | "takeout")}>
                    <option value="dine_in">Dine-in</option>
                    <option value="takeout">Takeout</option>
                  </Select>
                </label>
                <Button type="button" variant="outline" onClick={() => setStartUnlimitedOpen(true)}>
                  Start Unlimited
                </Button>
              </div>

              <div className="grid max-h-[38vh] gap-2 overflow-y-auto pr-1">
                {items.length === 0 && (
                  <div className="grid justify-items-center gap-2 rounded-md border border-dashed border-slate-300 p-6 text-center text-sm text-slate-500">
                    <ShoppingCart className="h-8 w-8" />
                    Cart is empty
                  </div>
                )}
                {items.map((item) => (
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
                        <Button size="sm" variant="outline" onClick={() => addItem(item.product)}>
                          <Plus className="h-4 w-4" />
                        </Button>
                      </div>
                      <p className="font-semibold text-slate-950">{money(Number(item.product.price) * item.quantity)}</p>
                    </div>
                  </div>
                ))}
              </div>

              <div className="mt-auto grid gap-2 border-t border-slate-200 pt-4 text-sm">
                <TotalLine label="Subtotal" value={totals.subtotal} />
                <TotalLine label="Tax (12%)" value={totals.tax} />
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
          )}
        </div>
      </div>

      <PaymentModal
        open={paymentOpen}
        pending={checkoutMutation.isPending}
        total={totals.total}
        onClose={() => setPaymentOpen(false)}
        onConfirm={(payment) => checkoutMutation.mutate(payment)}
      />
      <StartUnlimitedModal
        open={startUnlimitedOpen}
        pending={startUnlimitedMutation.isPending}
        pricePerPerson={unlimitedSettingsQuery.data?.price_per_person ?? 599}
        onClose={() => setStartUnlimitedOpen(false)}
        onStart={(payload) => startUnlimitedMutation.mutate(payload)}
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

function printReceipt(transaction: PosTransaction) {
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
        <h1>Katana Sushi</h1>
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
        <p class="right">Tax: ${money(transaction.tax)}</p>
        <p class="right total">Total: ${money(transaction.total)}</p>
        ${
          transaction.payment_method === "cash"
            ? `<p class="right">Cash: ${money(Number(transaction.cash_received ?? 0))}</p><p class="right">Change: ${money(Number(transaction.change_due ?? 0))}</p>`
            : ""
        }
        <div class="line"></div>
        <p style="text-align:center">Thank you.</p>
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

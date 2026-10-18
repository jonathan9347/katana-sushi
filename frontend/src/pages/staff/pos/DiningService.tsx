import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ChefHat, Printer, ShoppingCart, Table2 } from "lucide-react";
import { Link } from "react-router-dom";
import SectionNav, { SectionNavTab } from "../../../components/layout/SectionNav";
import { Dialog } from "../../../components/ui/dialog";
import { api } from "../../../lib/api";
import { useToast } from "../../../hooks/useToast";

type Guest = {
  id: string;
  guest_number: number;
  discount_type: "none" | "senior" | "pwd";
};

type TicketItem = {
  id: string;
  name_snapshot: string;
  quantity: number;
  guest: Guest;
};

type KitchenOrder = {
  id: string;
  order_number: string;
  order_type: "ala_carte" | "unlimited";
  status: "reserved" | "prepared" | "ready" | "released" | "cancelled";
  created_at: string;
  dining_session: { table: { table_number: number } };
  items: TicketItem[];
};

type UnlimitedSession = {
  id: string;
  pax_count: number;
  price_per_pax: number;
  status: string;
  ends_at: string;
  first_round_at: string | null;
  extensions: Array<{ minutes: number; created_at: string }>;
};

type DiningSession = {
  id: string;
  status: string;
  table_id: string;
  table: { id: string; table_number: number; capacity: number };
  guests: Guest[];
  orders: KitchenOrder[];
  unlimited_sessions: UnlimitedSession[];
};

type DiningTable = {
  id: string;
  table_number: number;
  capacity: number;
  status: string;
  linked_to_table_id: string | null;
  unavailable_reason: string | null;
  active_session: { id: string; guests: Array<{ id: string }> } | null;
};

type PosProduct = {
  id: string;
  name: string;
  category: string;
  price: string | number;
  is_available: boolean;
  available_stock?: number | null;
};

type CheckoutPreview = {
  session_id: string;
  table_number: number;
  guest_count: number;
  a_la_carte_lines: Array<{ name: string; guest_number: number; quantity: number; unit_price: number; total_price: number }>;
  unlimited_lines: Array<{ name: string; quantity: number; unit_price: number; total_price: number }>;
  leftover_lines: Array<{ name: string; quantity: number; total: number }>;
  subtotal: number;
  unlimited_amount: number;
  leftover_amount: number;
  discounted_guest_count: number;
  per_guest_share: number;
  discount_amount: number;
  total: number;
};

type CheckoutTransaction = {
  transaction_number: string;
  subtotal: number;
  tax: number;
  unlimited_amount: number;
  leftover_amount: number;
  discount_amount: number;
  guest_count: number;
  discount_guest_count: number;
  total: number;
  payment_method: string;
  cash_received: number | null;
  change_due: number | null;
  created_at: string;
  items: Array<{ quantity: number; unit_price: number; total_price: number; selling_product: { name: string } }>;
  charges: Array<{ name_snapshot: string; quantity: number; unit_price: number; total_price: number }>;
  dining_session: { table: { table_number: number } };
};

type Props = { mode?: "service" | "kitchen" };
type DraftItem = { productId: string; guestNumber: number; quantity: number };
type DiningAction = { method: "post" | "patch"; url: string; body?: unknown };
type DiningActionResult = { transaction?: CheckoutTransaction; replayed?: boolean };

const posTabs: SectionNavTab[] = [
  { id: "sale", label: "Takeout Sale", icon: <ShoppingCart className="h-4 w-4" />, to: "/staff/pos", end: true },
  { id: "dining", label: "Table Service", icon: <Table2 className="h-4 w-4" />, to: "/staff/pos/dining" },
  { id: "kitchen", label: "Kitchen Tickets", icon: <ChefHat className="h-4 w-4" />, to: "/staff/kitchen" }
];

function money(value: number) {
  return `PHP ${Number(value).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function formatTime(value: string) {
  return new Date(value).toLocaleString();
}

function normalizeTableStatus(status: string) {
  return status.trim().toLowerCase();
}

function escapeHtml(value: string) {
  return value.replace(/[&<>"']/g, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    "\"": "&quot;",
    "'": "&#39;"
  })[character] ?? character);
}

function errorMessage(error: unknown) {
  if (typeof error === "object" && error && "response" in error) {
    const response = (error as { response?: { data?: { message?: string } } }).response;
    return response?.data?.message ?? "The request could not be completed.";
  }
  return "The request could not be completed.";
}

export default function DiningService({ mode = "service" }: Props) {
  const role = (localStorage.getItem("katana_role") ?? "").toLowerCase();
  const isAdmin = role === "admin";
  const kitchenOnly = mode === "kitchen";
  const [selectedSessionId, setSelectedSessionId] = useState("");
  const [newSessionTableId, setNewSessionTableId] = useState("");
  const [guestCount, setGuestCount] = useState(1);
  const [orderType, setOrderType] = useState<"ala_carte" | "unlimited">("ala_carte");
  const [productId, setProductId] = useState("");
  const [guestNumber, setGuestNumber] = useState(1);
  const [quantity, setQuantity] = useState(1);
  const [draftItems, setDraftItems] = useState<DraftItem[]>([]);
  const [draftKey, setDraftKey] = useState(() => crypto.randomUUID());
  const [packageCovers, setPackageCovers] = useState(1);
  const [leftoverProductId, setLeftoverProductId] = useState("");
  const [leftoverQuantity, setLeftoverQuantity] = useState(0);
  const [transferTableId, setTransferTableId] = useState("");
  const [cashReceived, setCashReceived] = useState("");
  const [paymentMethod, setPaymentMethod] = useState<"cash" | "gcash" | "bank_transfer">("cash");
  const [showCheckout, setShowCheckout] = useState(false);
  const [manageTablesOpen, setManageTablesOpen] = useState(false);
  const [newTableCapacity, setNewTableCapacity] = useState("2");
  const [seatDrafts, setSeatDrafts] = useState<Record<string, string>>({});
  const [tableReasons, setTableReasons] = useState<Record<string, string>>({});
  const [linkTargets, setLinkTargets] = useState<Record<string, string>>({});
  const [completedTransaction, setCompletedTransaction] = useState<CheckoutTransaction | null>(null);
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const tablesQuery = useQuery({
    queryKey: ["pos", "dining", "tables"],
    queryFn: async () => (await api.get<{ tables: DiningTable[] }>("/api/pos/dining/tables")).data.tables,
    enabled: !kitchenOnly,
    refetchInterval: 15000
  });
  const sessionsQuery = useQuery({
    queryKey: ["pos", "dining", "sessions"],
    queryFn: async () => (await api.get<{ sessions: DiningSession[] }>("/api/pos/dining/sessions")).data.sessions,
    enabled: !kitchenOnly,
    refetchInterval: 10000
  });
  const kitchenQuery = useQuery({
    queryKey: ["pos", "kitchen", "orders"],
    queryFn: async () => (await api.get<{ orders: KitchenOrder[] }>("/api/pos/kitchen/orders")).data.orders,
    refetchInterval: 10000
  });
  const productsQuery = useQuery({
    queryKey: ["products"],
    queryFn: async () => (await api.get<{ products: PosProduct[] }>("/api/products")).data.products,
    enabled: !kitchenOnly
  });
  const unlimitedProductsQuery = useQuery({
    queryKey: ["pos", "unlimited", "products"],
    queryFn: async () => (await api.get<{ products: PosProduct[] }>("/api/pos/unlimited/included-products")).data.products,
    enabled: !kitchenOnly && orderType === "unlimited"
  });
  const unlimitedSettingsQuery = useQuery({
    queryKey: ["admin", "unlimited", "settings"],
    queryFn: async () =>
      (await api.get<{ settings: { price_per_person: number } }>("/api/admin/unlimited/settings")).data.settings,
    enabled: !kitchenOnly
  });
  const session = sessionsQuery.data?.find((item) => item.id === selectedSessionId) ?? null;
  const activeUnlimited = session?.unlimited_sessions.find((item) => item.status === "active") ?? null;
  const coveredGuests = orderType === "unlimited" && activeUnlimited
    ? session?.guests.filter((guest) => guest.guest_number <= activeUnlimited.pax_count) ?? []
    : session?.guests ?? [];
  const availableTables = (tablesQuery.data ?? []).filter((table) =>
    !table.active_session &&
    !table.linked_to_table_id &&
    normalizeTableStatus(table.status) === "available"
  );
  const seatedTables = (tablesQuery.data ?? []).filter((table) =>
    Boolean(table.active_session?.guests.length) &&
    !table.linked_to_table_id &&
    normalizeTableStatus(table.status) === "occupied"
  );
  const availableProducts = useMemo(
    () => (orderType === "unlimited" ? unlimitedProductsQuery.data : productsQuery.data) ?? [],
    [orderType, productsQuery.data, unlimitedProductsQuery.data]
  );
  const productsById = useMemo(
    () => new Map([...(productsQuery.data ?? []), ...(unlimitedProductsQuery.data ?? [])].map((item) => [item.id, item])),
    [productsQuery.data, unlimitedProductsQuery.data]
  );

  const refreshQueries = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ["pos", "dining", "tables"], exact: true }),
      queryClient.invalidateQueries({ queryKey: ["pos", "dining", "sessions"], exact: true }),
      queryClient.invalidateQueries({ queryKey: ["pos", "kitchen", "orders"], exact: true }),
      queryClient.invalidateQueries({ queryKey: ["inventory"] }),
      queryClient.invalidateQueries({ queryKey: ["products"] })
    ]);
  };
  const runMutation = useMutation({
    mutationFn: async (action: DiningAction): Promise<DiningActionResult> => {
      if (action.method === "post") {
        return (await api.post<{
          transaction?: CheckoutTransaction;
          replayed?: boolean;
        }>(action.url, action.body)).data;
      }
      await api.patch(action.url, action.body);
      return {};
    },
    onSuccess: async (result, action) => {
      await refreshQueries();
      if (action.url.endsWith("/checkout")) {
        if (result.transaction) setCompletedTransaction(result.transaction);
        setSelectedSessionId("");
        setShowCheckout(false);
        setCashReceived("");
      }
    },
    onError: (error) => toast(errorMessage(error))
  });
  const checkoutPreviewQuery = useQuery({
    queryKey: ["pos", "dining", "checkout-preview", selectedSessionId],
    queryFn: async () =>
      (await api.get<CheckoutPreview>(`/api/pos/dining/sessions/${selectedSessionId}/checkout-preview`)).data,
    enabled: !kitchenOnly && Boolean(selectedSessionId) && showCheckout,
    refetchInterval: 10000,
    retry: false
  });

  const sendTicket = useMutation({
    mutationFn: async () => {
      if (!session || draftItems.length === 0) throw new Error("Add at least one item before sending the ticket.");
      return (await api.post(`/api/pos/dining/sessions/${session.id}/orders`, {
        idempotencyKey: draftKey,
        orderType,
        unlimitedSessionId: orderType === "unlimited" ? activeUnlimited?.id : undefined,
        items: draftItems
      })).data;
    },
    onSuccess: async () => {
      setDraftItems([]);
      setDraftKey(crypto.randomUUID());
      await refreshQueries();
      toast("Kitchen ticket sent and ingredients reserved.");
    },
    onError: (error) => toast(errorMessage(error))
  });
  const currentOrderMutation = useMutation({
    mutationFn: async (input: { orderId: string; status: "prepared" | "ready" | "released" | "cancelled" }) =>
      (await api.patch(`/api/pos/kitchen/orders/${input.orderId}/status`, { status: input.status })).data,
    onSuccess: async (_data, input) => {
      await refreshQueries();
      if (input.status === "released") toast("Ticket released; ingredient stock was deducted.");
      if (input.status === "cancelled") toast("Reserved ingredients were released.");
    },
    onError: (error) => toast(errorMessage(error))
  });

  const currentOrders = kitchenQuery.data ?? [];

  function runAction(method: "post" | "patch", url: string, body?: unknown) {
    runMutation.mutate({ method, url, body });
  }

  function addDraftItem() {
    if (!productId || !guestNumber || quantity < 1) {
      toast("Choose a product, guest number, and quantity.");
      return;
    }
    setDraftItems((items) => [...items, { productId, guestNumber, quantity }]);
    setProductId("");
    setQuantity(1);
  }

  function printTicket(order: KitchenOrder) {
    const ticket = window.open("", "_blank", "width=420,height=600");
    if (!ticket) {
      window.print();
      return;
    }
    ticket.document.write(`
      <html><head><title>${order.order_number}</title>
        <style>body{font:16px Arial,sans-serif;margin:20px}h1{font-size:20px}li{margin:10px 0}</style>
      </head><body>
        <h1>Table ${order.dining_session.table.table_number}</h1>
        <p>${order.order_type === "unlimited" ? "UNLIMITED" : "A LA CARTE"} · ${escapeHtml(order.order_number)}</p>
        <p>${formatTime(order.created_at)}</p><hr />
        <ul>${order.items.map((item) => `<li>Guest ${item.guest.guest_number}: ${item.quantity} × ${escapeHtml(item.name_snapshot)}</li>`).join("")}</ul>
        <script>window.print();window.close();</script>
      </body></html>
    `);
    ticket.document.close();
  }

  if (kitchenOnly) {
    return (
      <main className="min-h-screen bg-slate-100 px-4 py-5 lg:pr-6">
        <div className="mx-auto max-w-7xl space-y-5">
          <header>
            <p className="text-sm font-bold uppercase text-red-700">Dine-in operations</p>
            <h1 className="text-3xl font-black text-slate-950">Kitchen tickets</h1>
          </header>
          <SectionNav orientation="horizontal" tabs={posTabs} />
          {kitchenQuery.isError && <p className="rounded bg-red-50 p-3 text-sm text-red-800">Unable to load kitchen tickets.</p>}
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {currentOrders.map((order) => (
              <article key={order.id} className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <p className="text-xs font-bold uppercase text-red-700">{order.order_type === "unlimited" ? "Unlimited" : "A la carte"}</p>
                    <h2 className="text-xl font-black">Table {order.dining_session.table.table_number}</h2>
                    <p className="text-xs text-slate-500">{order.order_number} · {formatTime(order.created_at)}</p>
                  </div>
                  <button className="rounded border p-2 text-slate-700 hover:bg-slate-50" onClick={() => printTicket(order)} aria-label="Print kitchen ticket">
                    <Printer className="h-4 w-4" />
                  </button>
                </div>
                <ul className="my-4 divide-y divide-slate-100">
                  {order.items.map((item) => (
                    <li key={item.id} className="py-2 text-sm font-semibold">
                      Guest {item.guest.guest_number} · {item.quantity} × {item.name_snapshot}
                    </li>
                  ))}
                </ul>
                <p className="mb-3 text-sm font-bold uppercase text-slate-600">Status: {order.status}</p>
                <div className="flex flex-wrap gap-2">
                  {order.status === "reserved" && (
                    <>
                      <ActionButton disabled={currentOrderMutation.isPending} onClick={() => currentOrderMutation.mutate({ orderId: order.id, status: "prepared" })}>Prepared</ActionButton>
                      <ActionButton tone="muted" disabled={currentOrderMutation.isPending} onClick={() => currentOrderMutation.mutate({ orderId: order.id, status: "cancelled" })}>Cancel ticket</ActionButton>
                    </>
                  )}
                  {order.status === "prepared" && <ActionButton disabled={currentOrderMutation.isPending} onClick={() => currentOrderMutation.mutate({ orderId: order.id, status: "ready" })}>Ready</ActionButton>}
                  {order.status === "ready" && <ActionButton disabled={currentOrderMutation.isPending} onClick={() => currentOrderMutation.mutate({ orderId: order.id, status: "released" })}>Release / serve</ActionButton>}
                </div>
              </article>
            ))}
            {!kitchenQuery.isLoading && currentOrders.length === 0 && <p className="rounded-xl border border-dashed p-8 text-center text-slate-500 md:col-span-2 xl:col-span-3">No open kitchen tickets.</p>}
          </div>
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-slate-100 px-4 py-5 lg:pr-6">
      <div className="mx-auto max-w-7xl space-y-5">
        <header className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <p className="text-sm font-bold uppercase text-red-700">Point of sale</p>
            <h1 className="text-3xl font-black text-slate-950">Table service</h1>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <p className="text-sm text-slate-500">Kitchen deductions happen only when an order is released.</p>
            <ActionButton tone="muted" onClick={() => setManageTablesOpen(true)}>Manage tables</ActionButton>
          </div>
        </header>
        <SectionNav orientation="horizontal" tabs={posTabs} />
        {(tablesQuery.isError || sessionsQuery.isError) && <p className="rounded bg-red-50 p-3 text-sm text-red-800">Unable to load dining tables or sessions.</p>}
        {completedTransaction && (
          <section className="rounded-xl border border-emerald-200 bg-emerald-50 p-4 shadow-sm">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <p className="text-sm font-bold uppercase text-emerald-800">Checkout complete</p>
                <h2 className="text-lg font-black text-slate-950">Table {completedTransaction.dining_session.table.table_number}</h2>
                <p className="text-sm text-slate-700">
                  {completedTransaction.transaction_number} · {formatTime(completedTransaction.created_at)} · paid {money(completedTransaction.total)}
                </p>
              </div>
              <div className="flex gap-2">
                <ActionButton tone="muted" onClick={() => printCheckoutReceipt(completedTransaction)}>Print receipt</ActionButton>
                <ActionButton tone="muted" onClick={() => setCompletedTransaction(null)}>Dismiss</ActionButton>
              </div>
            </div>
          </section>
        )}

        <div className="grid gap-5 xl:grid-cols-[0.85fr_1.4fr]">
          <section className="space-y-5">
            <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
              <h2 className="mb-3 text-lg font-bold">Open table session</h2>
              <div className="grid gap-3 sm:grid-cols-[1fr_110px_auto]">
                <label className="grid gap-1 text-sm font-medium text-slate-700">
                  Table
                  <select className="h-10 rounded border border-slate-300 px-2" value={newSessionTableId} onChange={(event) => setNewSessionTableId(event.target.value)}>
                    <option value="">Choose table</option>
                    {availableTables.map((table) => <option key={table.id} value={table.id}>Table {table.table_number} · {table.capacity} seats</option>)}
                  </select>
                </label>
                <label className="grid gap-1 text-sm font-medium text-slate-700">
                  Guests
                  <input className="h-10 rounded border border-slate-300 px-2" type="number" min={1} max={100} value={guestCount} onChange={(event) => setGuestCount(Number(event.target.value))} />
                </label>
                <button
                  className="mt-auto h-10 rounded bg-red-700 px-4 font-bold text-white disabled:opacity-50"
                  disabled={runMutation.isPending || !newSessionTableId}
                  onClick={() => {
                    const table = availableTables.find((item) => item.id === newSessionTableId);
                    if (!table) return toast("Choose an available table.");
                    if (guestCount > table.capacity) return toast(`Table ${table.table_number} seats up to ${table.capacity} guests.`);
                    runAction("post", "/api/pos/dining/sessions", { tableId: table.id, guestCount });
                    setNewSessionTableId("");
                  }}
                >
                  Start session
                </button>
              </div>
              {availableTables.length === 0 && <p className="mt-2 text-xs text-slate-500">No available tables at the moment.</p>}
            </section>

            <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
              <h2 className="mb-3 text-lg font-bold">Active tables</h2>
              <div className="grid gap-2">
                {(sessionsQuery.data ?? []).map((item) => (
                  <button
                    key={item.id}
                    className={`rounded-lg border p-3 text-left ${selectedSessionId === item.id ? "border-red-700 bg-red-50" : "border-slate-200 hover:bg-slate-50"}`}
                    onClick={() => {
                      setSelectedSessionId(item.id);
                      setGuestNumber(1);
                      setDraftItems([]);
                      setShowCheckout(false);
                    }}
                  >
                    <span className="font-bold">Table {item.table.table_number}</span>
                    <span className="ml-2 text-sm text-slate-600">{item.guests.length} guests · {item.orders.filter((order) => order.status !== "released" && order.status !== "cancelled").length} open tickets</span>
                  </button>
                ))}
                {!sessionsQuery.isLoading && (sessionsQuery.data ?? []).length === 0 && <p className="text-sm text-slate-500">No active table sessions.</p>}
              </div>
            </section>

            <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
              <h2 className="mb-2 text-lg font-bold">Kitchen queue</h2>
              <p className="mb-3 text-sm text-slate-500">{currentOrders.length} tickets waiting for preparation, readiness, or release.</p>
              <Link to="/staff/kitchen" className="inline-flex items-center gap-2 rounded border border-slate-300 px-3 py-2 text-sm font-bold text-slate-700 hover:bg-slate-50">
                <ChefHat className="h-4 w-4" /> Open kitchen board
              </Link>
            </section>
          </section>

          <section className="space-y-5">
            {!session ? (
              <section className="grid min-h-64 place-items-center rounded-xl border border-dashed border-slate-300 bg-white p-6 text-center text-slate-500">
                Select an active table to assign guest numbers, send kitchen tickets, and check out.
              </section>
            ) : (
              <>
                <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <p className="text-sm font-bold uppercase text-red-700">Active dining session</p>
                      <h2 className="text-2xl font-black">Table {session.table.table_number}</h2>
                      <p className="text-sm text-slate-500">{session.guests.length} guests · session {session.id.slice(-8)}</p>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <select
                        className="h-10 max-w-48 rounded border border-slate-300 px-2 text-sm"
                        value={transferTableId}
                        onChange={(event) => setTransferTableId(event.target.value)}
                      >
                        <option value="">Transfer table...</option>
                        {availableTables.filter((item) => item.id !== session.table_id).map((item) => (
                          <option key={item.id} value={item.id}>Table {item.table_number} · {item.capacity} seats</option>
                        ))}
                      </select>
                      <ActionButton
                        tone="muted"
                        disabled={!transferTableId || runMutation.isPending}
                        onClick={() => {
                          const destination = availableTables.find((item) => item.id === transferTableId);
                          if (destination && session.guests.length > destination.capacity) {
                            toast(`Table ${destination.table_number} seats up to ${destination.capacity} guests.`);
                            return;
                          }
                          runAction("patch", `/api/pos/dining/sessions/${session.id}/table`, { tableId: transferTableId });
                          setTransferTableId("");
                        }}
                      >
                        Transfer
                      </ActionButton>
                    </div>
                  </div>
                  <div className="mt-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                    {session.guests.map((guest) => (
                      <label key={guest.id} className="grid gap-1 rounded border border-slate-200 p-2 text-sm">
                        <span className="font-bold">Guest {guest.guest_number}</span>
                        <select
                          className="h-9 rounded border border-slate-300 px-2"
                          value={guest.discount_type}
                          onChange={(event) => runAction("patch", `/api/pos/dining/sessions/${session.id}/guests/${guest.id}`, { discountType: event.target.value })}
                        >
                          <option value="none">No discount</option>
                          <option value="senior">Senior</option>
                          <option value="pwd">PWD</option>
                        </select>
                      </label>
                    ))}
                  </div>
                </section>

                <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
                  <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
                    <h2 className="text-lg font-bold">Create kitchen ticket</h2>
                    <select className="h-10 rounded border border-slate-300 px-2" value={orderType} onChange={(event) => {
                      setOrderType(event.target.value as "ala_carte" | "unlimited");
                      setProductId("");
                      setGuestNumber(1);
                    }}>
                      <option value="ala_carte">A la carte</option>
                      <option value="unlimited">Unlimited package</option>
                    </select>
                  </div>
                  {orderType === "unlimited" && (
                    <div className="mb-3 flex flex-wrap items-end gap-2">
                      {activeUnlimited ? (
                        <div className="flex flex-wrap items-center gap-2 rounded bg-amber-50 p-2 text-sm">
                          <span>
                            {activeUnlimited.pax_count} covers × {money(Number(activeUnlimited.price_per_pax))} ·
                            {activeUnlimited.first_round_at ? ` ends ${formatTime(activeUnlimited.ends_at)}` : " timer starts when first ticket is served"}
                          </span>
                          {isAdmin && <ActionButton tone="muted" disabled={runMutation.isPending} onClick={() => runAction("post", `/api/pos/dining/unlimited-sessions/${activeUnlimited.id}/extend`)}>Approve +30 min</ActionButton>}
                          <select className="h-9 rounded border border-slate-300 px-2" value={leftoverProductId} onChange={(event) => setLeftoverProductId(event.target.value)}>
                            <option value="">Leftover item (optional)</option>
                            {(unlimitedProductsQuery.data ?? []).map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
                          </select>
                          <input className="h-9 w-20 rounded border border-slate-300 px-2" type="number" min={0} value={leftoverQuantity} onChange={(event) => setLeftoverQuantity(Number(event.target.value))} />
                          <ActionButton tone="muted" disabled={runMutation.isPending} onClick={() => {
                            const leftovers = leftoverProductId && leftoverQuantity > 0
                              ? [{ productId: leftoverProductId, quantity: leftoverQuantity }]
                              : [];
                            runAction("post", `/api/pos/dining/unlimited-sessions/${activeUnlimited.id}/end`, { leftovers });
                          }}>End Unlimited</ActionButton>
                        </div>
                      ) : (
                        <>
                          <label className="grid gap-1 text-sm">Covered guests
                            <select className="h-10 rounded border border-slate-300 px-2" value={packageCovers} onChange={(event) => setPackageCovers(Number(event.target.value))}>
                              {session.guests.map((guest) => <option key={guest.id} value={guest.guest_number}>{guest.guest_number} cover{guest.guest_number === 1 ? "" : "s"} · {money(Number(unlimitedSettingsQuery.data?.price_per_person ?? 0) * guest.guest_number)}</option>)}
                            </select>
                          </label>
                          {unlimitedSettingsQuery.isError && <p className="text-sm text-red-700">Unlimited pricing could not be loaded.</p>}
                          <ActionButton disabled={runMutation.isPending} onClick={() => runAction("post", `/api/pos/dining/sessions/${session.id}/unlimited-sessions`, { paxCount: packageCovers })}>Start Unlimited</ActionButton>
                        </>
                      )}
                    </div>
                  )}
                  {orderType === "unlimited" && !activeUnlimited && <p className="mb-3 text-sm text-amber-800">Start a package before sending an Unlimited ticket. Guests 1 through the selected cover count are covered.</p>}
                  <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_130px_100px_auto]">
                    <label className="grid gap-1 text-sm font-medium text-slate-700">
                      Product
                      <select className="h-10 min-w-0 rounded border border-slate-300 px-2" value={productId} onChange={(event) => setProductId(event.target.value)}>
                        <option value="">Select product</option>
                        {availableProducts.filter((item) => item.is_available).map((item) => (
                          <option key={item.id} value={item.id}>{item.name} · {orderType === "ala_carte" ? money(Number(item.price)) : "Included"}</option>
                        ))}
                      </select>
                    </label>
                    <label className="grid gap-1 text-sm font-medium text-slate-700">
                      Guest
                      <select className="h-10 rounded border border-slate-300 px-2" value={guestNumber} onChange={(event) => setGuestNumber(Number(event.target.value))}>
                        {coveredGuests.map((guest) => <option key={guest.id} value={guest.guest_number}>Guest {guest.guest_number}</option>)}
                      </select>
                    </label>
                    <label className="grid gap-1 text-sm font-medium text-slate-700">
                      Qty
                      <input className="h-10 rounded border border-slate-300 px-2" type="number" min={1} value={quantity} onChange={(event) => setQuantity(Number(event.target.value))} />
                    </label>
                    <button className="mt-auto h-10 rounded border border-slate-300 px-3 font-bold hover:bg-slate-50" onClick={addDraftItem}>Add item</button>
                  </div>
                  {draftItems.length > 0 && (
                    <div className="mt-4 rounded-lg bg-slate-50 p-3">
                      <ul className="space-y-2 text-sm">
                        {draftItems.map((item, index) => (
                          <li key={`${item.productId}-${index}`} className="flex items-center justify-between gap-2">
                            <span>Guest {item.guestNumber} · {item.quantity} × {productsById.get(item.productId)?.name ?? item.productId}</span>
                            <button className="text-red-700 underline" onClick={() => setDraftItems((items) => items.filter((_, itemIndex) => itemIndex !== index))}>Remove</button>
                          </li>
                        ))}
                      </ul>
                      <ActionButton
                        className="mt-3"
                        disabled={sendTicket.isPending || (orderType === "unlimited" && !activeUnlimited)}
                        onClick={() => sendTicket.mutate()}
                      >
                        {sendTicket.isPending ? "Sending..." : "Send ticket"}
                      </ActionButton>
                    </div>
                  )}
                </section>

                {showCheckout ? (
                  <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
                    <div className="flex items-center justify-between gap-2">
                      <h2 className="text-lg font-bold">Table bill</h2>
                      <button className="text-sm font-semibold text-slate-600 underline" onClick={() => setShowCheckout(false)}>Close</button>
                    </div>
                    {checkoutPreviewQuery.isLoading && <p className="py-4 text-sm text-slate-500">Checking kitchen and package status...</p>}
                    {checkoutPreviewQuery.isError && <p className="py-3 text-sm text-red-700">{errorMessage(checkoutPreviewQuery.error)}</p>}
                    {checkoutPreviewQuery.data && <CheckoutBill
                      preview={checkoutPreviewQuery.data}
                      cashReceived={cashReceived}
                      onCashReceived={setCashReceived}
                      paymentMethod={paymentMethod}
                      onPaymentMethod={setPaymentMethod}
                      pending={runMutation.isPending}
                      onPay={() => runAction("post", `/api/pos/dining/sessions/${session.id}/checkout`, {
                        paymentMethod,
                        cashReceived: paymentMethod === "cash" ? Number(cashReceived || 0) : undefined
                      })}
                    />}
                  </section>
                ) : (
                  <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
                    <p className="text-sm text-slate-600">Checkout after all kitchen tickets are released or cancelled and all Unlimited packages are ended.</p>
                    <ActionButton disabled={runMutation.isPending} onClick={() => setShowCheckout(true)}>Review bill</ActionButton>
                  </div>
                )}
              </>
            )}
          </section>
        </div>
        <Dialog
          open={manageTablesOpen}
          title="Manage tables"
          onClose={() => setManageTablesOpen(false)}
          panelClassName="max-w-4xl"
        >
          <div className="space-y-5">
            {isAdmin && (
              <form
                className="flex flex-wrap items-end gap-3 rounded-lg border border-slate-200 p-3"
                onSubmit={(event) => {
                  event.preventDefault();
                  runAction("post", "/api/pos/dining/tables", { capacity: Number(newTableCapacity) });
                }}
              >
                <label className="grid gap-1 text-sm font-semibold text-slate-700">
                  New table seats
                  <input
                    className="h-10 w-28 rounded border border-slate-300 px-3"
                    type="number"
                    min={1}
                    max={100}
                    value={newTableCapacity}
                    onChange={(event) => setNewTableCapacity(event.target.value)}
                  />
                </label>
                <ActionButton type="submit" disabled={runMutation.isPending || !newTableCapacity}>Add table</ActionButton>
                <p className="text-xs text-slate-500">The next unused table number is assigned automatically; archived numbers are never reused.</p>
              </form>
            )}

            <div className="space-y-3">
              {(tablesQuery.data ?? []).map((table) => {
                const status = normalizeTableStatus(table.status);
                const linkTarget = (tablesQuery.data ?? []).find((candidate) => candidate.id === table.linked_to_table_id);
                const hasSession = Boolean(table.active_session);
                const linked = Boolean(table.linked_to_table_id);
                const reason = tableReasons[table.id] ?? table.unavailable_reason ?? "";
                const linkTargetId = linkTargets[table.id] ?? "";
                const canEditSeats = isAdmin && !hasSession && status !== "occupied" && !linked;
                const canChangeAvailability = !hasSession && status !== "occupied" && !linked && (status === "available" || status === "unavailable");

                return (
                  <article key={table.id} className="space-y-3 rounded-lg border border-slate-200 p-3">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div>
                        <h3 className="font-bold text-slate-900">Table {table.table_number} · {table.capacity} seats</h3>
                        <p className="text-xs font-semibold uppercase text-slate-500">{status}</p>
                      </div>
                      {linked && (
                        <p className="text-sm text-amber-800">
                          Linked to Table {linkTarget?.table_number ?? "—"}; it becomes available at that table's checkout.
                        </p>
                      )}
                      {status === "occupied" && <p className="text-sm text-slate-600">Occupied tables are released at checkout.</p>}
                    </div>

                    <div className="flex flex-wrap items-end gap-2">
                      {isAdmin && (
                        <>
                          <label className="grid gap-1 text-xs font-semibold text-slate-600">
                            Seats
                            <input
                              className="h-9 w-24 rounded border border-slate-300 px-2 text-sm"
                              type="number"
                              min={1}
                              max={100}
                              disabled={!canEditSeats}
                              value={seatDrafts[table.id] ?? String(table.capacity)}
                              onChange={(event) => setSeatDrafts((current) => ({ ...current, [table.id]: event.target.value }))}
                            />
                          </label>
                          <ActionButton
                            tone="muted"
                            disabled={!canEditSeats || runMutation.isPending || Number(seatDrafts[table.id] ?? table.capacity) === table.capacity}
                            onClick={() => runAction("patch", `/api/pos/dining/tables/${table.id}/seats`, {
                              capacity: Number(seatDrafts[table.id] ?? table.capacity)
                            })}
                          >
                            Save seats
                          </ActionButton>
                        </>
                      )}

                      {canChangeAvailability && (
                        <>
                          <label className="grid min-w-48 flex-1 gap-1 text-xs font-semibold text-slate-600">
                            Reason (optional)
                            <input
                              className="h-9 rounded border border-slate-300 px-2 text-sm"
                              maxLength={120}
                              placeholder="For example, broken"
                              value={reason}
                              onChange={(event) => setTableReasons((current) => ({ ...current, [table.id]: event.target.value }))}
                            />
                          </label>
                          <label className="grid min-w-52 gap-1 text-xs font-semibold text-slate-600">
                            Link to existing table (seated customer)
                            <select
                              className="h-9 rounded border border-slate-300 px-2 text-sm"
                              value={linkTargetId}
                              onChange={(event) => setLinkTargets((current) => ({ ...current, [table.id]: event.target.value }))}
                            >
                              <option value="">No link</option>
                              {seatedTables.filter((candidate) => candidate.id !== table.id).map((candidate) => (
                                <option key={candidate.id} value={candidate.id}>
                                  Table {candidate.table_number} · {candidate.active_session?.guests.length ?? 0} guests
                                </option>
                              ))}
                            </select>
                          </label>
                          {status === "available" && (
                            <ActionButton
                              tone="muted"
                              disabled={runMutation.isPending}
                              onClick={() => runAction("patch", `/api/pos/dining/tables/${table.id}/availability`, {
                                status: "unavailable",
                                reason,
                                linkToTableId: linkTargetId || null
                              })}
                            >
                              {linkTargetId ? "Mark unavailable & link" : "Mark unavailable"}
                            </ActionButton>
                          )}
                          {status === "unavailable" && (
                            <>
                              <ActionButton
                                tone="muted"
                                disabled={runMutation.isPending}
                                onClick={() => runAction("patch", `/api/pos/dining/tables/${table.id}/availability`, {
                                  status: "available"
                                })}
                              >
                                Mark available
                              </ActionButton>
                              {linkTargetId && (
                                <ActionButton
                                  tone="muted"
                                  disabled={runMutation.isPending}
                                  onClick={() => runAction("patch", `/api/pos/dining/tables/${table.id}/availability`, {
                                    status: "unavailable",
                                    reason,
                                    linkToTableId: linkTargetId
                                  })}
                                >
                                  Link to seated table
                                </ActionButton>
                              )}
                            </>
                          )}
                        </>
                      )}

                      {isAdmin && (
                        <ActionButton
                          tone="muted"
                          disabled={hasSession || status === "occupied" || linked || runMutation.isPending}
                          onClick={() => {
                            if (window.confirm(`Archive Table ${table.table_number}? It will disappear from the POS board, but its history will remain.`)) {
                              runAction("post", `/api/pos/dining/tables/${table.id}/archive`);
                            }
                          }}
                        >
                          Archive
                        </ActionButton>
                      )}
                    </div>
                    {table.unavailable_reason && !tableReasons[table.id] && (
                      <p className="text-xs text-slate-500">Current note: {table.unavailable_reason}</p>
                    )}
                  </article>
                );
              })}
              {!tablesQuery.isLoading && (tablesQuery.data ?? []).length === 0 && (
                <p className="rounded border border-dashed border-slate-300 p-5 text-center text-sm text-slate-500">No live tables.</p>
              )}
            </div>
          </div>
        </Dialog>
      </div>
    </main>
  );
}

function CheckoutBill({
  preview,
  cashReceived,
  onCashReceived,
  paymentMethod,
  onPaymentMethod,
  pending,
  onPay
}: {
  preview: CheckoutPreview;
  cashReceived: string;
  onCashReceived: (value: string) => void;
  paymentMethod: "cash" | "gcash" | "bank_transfer";
  onPaymentMethod: (value: "cash" | "gcash" | "bank_transfer") => void;
  pending: boolean;
  onPay: () => void;
}) {
  return (
    <div className="mt-3 space-y-2 text-sm">
      {preview.a_la_carte_lines.map((line, index) => (
        <BillLine key={`ala-${index}`} label={`Guest ${line.guest_number} · ${line.quantity} × ${line.name}`} amount={line.total_price} />
      ))}
      {preview.unlimited_lines.map((line, index) => (
        <BillLine key={`unlimited-${index}`} label={`${line.name} · ${line.quantity} covers × ${money(line.unit_price)}`} amount={line.total_price} />
      ))}
      {preview.leftover_lines.map((line, index) => <BillLine key={`leftover-${index}`} label={`${line.name} · ${line.quantity}`} amount={line.total} />)}
      <div className="border-t border-dashed border-slate-300 pt-2">
        <BillLine label="Subtotal (tax not applied)" amount={preview.subtotal} />
        <BillLine label={`${preview.discounted_guest_count} discounted guest(s) × ${money(preview.per_guest_share)} per-guest share`} amount={-preview.discount_amount} />
        <BillLine label="Amount due" amount={preview.total} strong />
      </div>
      <label className="grid gap-1 pt-2 font-semibold">
        Payment method
        <select className="h-10 rounded border border-slate-300 px-3" value={paymentMethod} onChange={(event) => onPaymentMethod(event.target.value as "cash" | "gcash" | "bank_transfer")}>
          <option value="cash">Cash</option>
          <option value="gcash">GCash</option>
          <option value="bank_transfer">Bank transfer</option>
        </select>
      </label>
      {paymentMethod === "cash" && (
        <label className="grid gap-1 font-semibold">
          Cash received
          <input className="h-10 rounded border border-slate-300 px-3" type="number" min={preview.total} step="0.01" value={cashReceived} onChange={(event) => onCashReceived(event.target.value)} />
        </label>
      )}
      <ActionButton disabled={pending || (paymentMethod === "cash" && Number(cashReceived) < preview.total)} onClick={onPay}>Complete checkout</ActionButton>
    </div>
  );
}

function BillLine({ label, amount, strong = false }: { label: string; amount: number; strong?: boolean }) {
  return (
    <div className={`flex justify-between gap-3 ${strong ? "text-base font-black" : "text-slate-700"}`}>
      <span>{label}</span><span>{money(amount)}</span>
    </div>
  );
}

function printCheckoutReceipt(transaction: CheckoutTransaction) {
  const receipt = window.open("", "_blank", "width=420,height=700");
  if (!receipt) {
    window.alert("Allow pop-ups for this site to print the receipt.");
    return;
  }
  const lines = [
    ...transaction.items.map((item) =>
      `<tr><td>${item.quantity} × ${escapeHtml(item.selling_product.name)}</td><td class="right">${money(item.total_price)}</td></tr>`
    ),
    ...transaction.charges.map((charge) =>
      `<tr><td>${charge.quantity} × ${escapeHtml(charge.name_snapshot)}</td><td class="right">${money(charge.total_price)}</td></tr>`
    )
  ].join("");
  receipt.document.write(`
    <html><head><title>${escapeHtml(transaction.transaction_number)}</title>
      <style>
        body{font-family:Arial,sans-serif;margin:18px;color:#111827}
        h1{text-align:center;font-size:20px;margin:0 0 8px}
        p{margin:5px 0;font-size:12px}
        table{border-collapse:collapse;width:100%;margin:12px 0}
        td{padding:5px 0;font-size:12px;vertical-align:top}
        .right{text-align:right}
        .line{border-top:1px dashed #94a3b8;margin:10px 0}
        .total{font-weight:bold;font-size:15px}
      </style>
    </head><body>
      <h1>Katana Sushi</h1>
      <p>Table ${transaction.dining_session.table.table_number}</p>
      <p>Transaction: ${escapeHtml(transaction.transaction_number)}</p>
      <p>Date: ${escapeHtml(formatTime(transaction.created_at))}</p>
      <p>Payment: ${escapeHtml(transaction.payment_method.toUpperCase())}</p>
      <div class="line"></div>
      <table>${lines}</table>
      <div class="line"></div>
      <p class="right">Subtotal: ${money(transaction.subtotal)}</p>
      ${transaction.tax > 0 ? `<p class="right">Tax: ${money(transaction.tax)}</p>` : ""}
      ${transaction.discount_amount > 0 ? `<p class="right">${transaction.discount_guest_count} discounted guest(s) × ${money(transaction.guest_count ? transaction.subtotal / transaction.guest_count : 0)} per-guest share: −${money(transaction.discount_amount)}</p>` : ""}
      <p class="right total">Total: ${money(transaction.total)}</p>
      ${transaction.cash_received === null ? "" : `<p class="right">Cash received: ${money(transaction.cash_received)}</p>`}
      ${transaction.change_due === null ? "" : `<p class="right">Change: ${money(transaction.change_due)}</p>`}
      <p style="text-align:center;margin-top:18px">Thank you!</p>
      <script>window.print();</script>
    </body></html>
  `);
  receipt.document.close();
}

function ActionButton({
  children,
  onClick,
  type = "button",
  disabled = false,
  tone = "primary",
  className = ""
}: {
  children: React.ReactNode;
  onClick?: () => void;
  type?: "button" | "submit";
  disabled?: boolean;
  tone?: "primary" | "muted";
  className?: string;
}) {
  const toneClass = tone === "primary" ? "bg-red-700 text-white hover:bg-red-800" : "border border-slate-300 bg-white text-slate-800 hover:bg-slate-50";
  return (
    <button type={type} className={`min-h-10 rounded px-3 text-sm font-bold disabled:cursor-not-allowed disabled:opacity-50 ${toneClass} ${className}`} disabled={disabled} onClick={onClick}>
      {children}
    </button>
  );
}

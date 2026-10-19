import { useMemo, useRef, useState } from "react";
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
  guest: Guest | null;
};

type KitchenOrder = {
  id: string;
  order_number: string;
  order_type: "ala_carte" | "unlimited";
  status: "committed" | "reserved" | "prepared" | "ready" | "released" | "cancelled";
  created_at: string;
  dining_session: { table: { table_number: number } };
  items: TicketItem[];
};

type CommittedDiningOrder = {
  id: string;
  order_number: string;
  table_number_snapshot: number | null;
  created_at: string;
  items: Array<{
    id: string;
    name_snapshot: string;
    quantity: number;
    unit_price: number | string;
    total_price: number | string;
  }>;
};

type ReviewedOrder = {
  sessionId: string;
  tableNumber: number;
  idempotencyKey: string;
  items: Array<{
    productId: string;
    name: string;
    quantity: number;
    expectedUnitPrice: number;
  }>;
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

type UpcomingReservation = {
  id: string;
  time: string;
  customer_name: string;
  party_size: number;
  table_numbers: number[];
  temporary_table_numbers: number[];
  state: "upcoming" | "arrived" | "late";
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
  table_number_snapshot: number | null;
  items: Array<{ quantity: number; unit_price: number; total_price: number; name_snapshot: string | null; selling_product: { name: string } }>;
  charges: Array<{ name_snapshot: string; quantity: number; unit_price: number; total_price: number }>;
  dining_session: { table: { table_number: number } };
};

type Props = { mode?: "service" | "kitchen" };
type DraftItem = { productId: string; quantity: number };
type CommitOrderInput = { review: ReviewedOrder; printWindow: Window | null };
type DiningAction = { method: "post" | "patch"; url: string; body?: unknown };
type DiningActionResult = {
  transaction?: CheckoutTransaction;
  replayed?: boolean;
  session?: { id: string };
};

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

function printDiningOrderSlip(
  target: Window,
  order: CommittedDiningOrder,
  isReprint = false
) {
  const lines = order.items.map((item) => `
    <tr>
      <td>${escapeHtml(item.name_snapshot)}</td>
      <td class="number">${item.quantity}</td>
      <td class="number">${money(Number(item.unit_price))}</td>
      <td class="number">${money(Number(item.total_price))}</td>
    </tr>`).join("");
  target.document.open();
  target.document.write(`<!doctype html>
    <html>
      <head>
        <meta charset="utf-8">
        <title>Order ${escapeHtml(order.order_number)}</title>
        <style>
          body { font: 14px Arial, sans-serif; margin: 24px; color: #111; }
          h1 { font-size: 20px; margin: 0 0 8px; }
          p { margin: 4px 0 16px; }
          table { border-collapse: collapse; width: 100%; }
          th, td { border-bottom: 1px solid #bbb; padding: 7px 4px; text-align: left; }
          .number { text-align: right; white-space: nowrap; }
          .reprint { border: 2px solid #111; font-weight: bold; padding: 8px; text-align: center; }
          .total { font-weight: bold; }
        </style>
      </head>
      <body>
        ${isReprint ? '<p class="reprint">REPRINT</p>' : ""}
        <h1>Order ${escapeHtml(order.order_number)}</h1>
        <p>Table ${order.table_number_snapshot ?? "—"} · ${escapeHtml(formatTime(order.created_at))}</p>
        <table>
          <thead><tr><th>Item</th><th class="number">Qty</th><th class="number">Price</th><th class="number">Total</th></tr></thead>
          <tbody>${lines}</tbody>
          <tfoot><tr class="total"><td colspan="3">Total</td><td class="number">${money(order.items.reduce((sum, item) => sum + Number(item.total_price), 0))}</td></tr></tfoot>
        </table>
      </body>
    </html>`);
  target.document.close();
  target.focus();
  target.print();
}

function errorMessage(error: unknown) {
  if (typeof error === "object" && error && "response" in error) {
    const response = (error as { response?: { data?: { message?: string } } }).response;
    return response?.data?.message ?? "The request could not be completed.";
  }
  return "The request could not be completed.";
}

function errorCode(error: unknown) {
  if (typeof error === "object" && error && "response" in error) {
    const response = (error as { response?: { data?: { code?: string } } }).response;
    return response?.data?.code;
  }
  return undefined;
}

export default function DiningService({ mode = "service" }: Props) {
  const role = (localStorage.getItem("katana_role") ?? "").toLowerCase();
  const isAdmin = role === "admin";
  const kitchenOnly = mode === "kitchen";
  const [selectedSessionId, setSelectedSessionId] = useState("");
  const [orderType, setOrderType] = useState<"ala_carte" | "unlimited">("ala_carte");
  const [productId, setProductId] = useState("");
  const [quantity, setQuantity] = useState(1);
  const [draftItems, setDraftItems] = useState<DraftItem[]>([]);
  const [draftKey, setDraftKey] = useState(() => crypto.randomUUID());
  const [orderReview, setOrderReview] = useState<ReviewedOrder | null>(null);
  const [lastCommittedOrder, setLastCommittedOrder] = useState<CommittedDiningOrder | null>(null);
  const [printError, setPrintError] = useState("");
  const confirmClickLocked = useRef(false);
  const [packageCovers, setPackageCovers] = useState(1);
  const [leftoverProductId, setLeftoverProductId] = useState("");
  const [leftoverQuantity, setLeftoverQuantity] = useState(0);
  const [cashReceived, setCashReceived] = useState("");
  const [paymentMethod, setPaymentMethod] = useState<"cash" | "gcash" | "bank_transfer">("cash");
  const [showCheckout, setShowCheckout] = useState(false);
  const [manageTablesOpen, setManageTablesOpen] = useState(false);
  const [newTableCapacity, setNewTableCapacity] = useState("2");
  const [seatDrafts, setSeatDrafts] = useState<Record<string, string>>({});
  const [tableReasons, setTableReasons] = useState<Record<string, string>>({});
  const [linkTargets, setLinkTargets] = useState<Record<string, string>>({});
  const [temporaryTableReservationId, setTemporaryTableReservationId] = useState<string | null>(null);
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
  const upcomingReservationsQuery = useQuery({
    queryKey: ["pos", "dining", "upcoming-reservations"],
    queryFn: async () => (await api.get<{ reservations: UpcomingReservation[] }>(
      "/api/pos/dining/upcoming-reservations"
    )).data.reservations,
    enabled: !kitchenOnly,
    refetchInterval: 15000,
    refetchOnWindowFocus: true
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
  const seatedTables = (tablesQuery.data ?? []).filter((table) =>
    Boolean(table.active_session?.guests.length) &&
    !table.linked_to_table_id &&
    normalizeTableStatus(table.status) === "occupied"
  );
  const orderedReservations = [...(upcomingReservationsQuery.data ?? [])].sort((left, right) => {
    const priority = (state: UpcomingReservation["state"]) =>
      state === "arrived" || state === "late" ? 0 : 1;
    return priority(left.state) - priority(right.state) || left.time.localeCompare(right.time);
  });
  const reservationsByTableNumber = new Map<number, UpcomingReservation>();
  for (const reservation of orderedReservations) {
    for (const tableNumber of [...reservation.table_numbers, ...reservation.temporary_table_numbers]) {
      reservationsByTableNumber.set(tableNumber, reservation);
    }
  }
  const activeUnlimitedTableIds = new Set((sessionsQuery.data ?? [])
    .filter((item) => item.unlimited_sessions.some((unlimited) =>
      unlimited.status === "active" &&
      Boolean(unlimited.first_round_at) &&
      new Date(unlimited.ends_at).getTime() > Date.now()
    ))
    .map((item) => item.table_id));
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
      queryClient.invalidateQueries({ queryKey: ["pos", "dining", "upcoming-reservations"], exact: true }),
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
          session?: { id: string };
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
        resetDraftForSessionChange();
        setShowCheckout(false);
        setCashReceived("");
      }
      if (result.session && (
        action.url === "/api/pos/dining/sessions" ||
        action.url.endsWith("/seat") ||
        action.url.endsWith("/temporary-table")
      )) {
        setSelectedSessionId(result.session.id);
        resetDraftForSessionChange();
        setTemporaryTableReservationId(null);
        setShowCheckout(false);
      }
    },
    onError: (error, action) => {
      if (action.url.endsWith("/seat") && errorCode(error) === "RESERVATION_TABLE_UNAVAILABLE") {
        setTemporaryTableReservationId(action.url.split("/")[5] ?? null);
        toast("An assigned table is busy or unavailable. Add a temporary table for this reservation.");
        return;
      }
      toast(errorMessage(error));
    }
  });
  const checkoutPreviewQuery = useQuery({
    queryKey: ["pos", "dining", "checkout-preview", selectedSessionId],
    queryFn: async () =>
      (await api.get<CheckoutPreview>(`/api/pos/dining/sessions/${selectedSessionId}/checkout-preview`)).data,
    enabled: !kitchenOnly && Boolean(selectedSessionId) && showCheckout,
    refetchInterval: 10000,
    retry: false
  });

  const commitOrder = useMutation({
    mutationFn: async ({ review }: CommitOrderInput) => (
      await api.post<{ order: CommittedDiningOrder; replayed: boolean }>(
        `/api/pos/dining/sessions/${review.sessionId}/orders`,
        {
          idempotencyKey: review.idempotencyKey,
          orderType: "ala_carte",
          items: review.items.map(({ productId, quantity, expectedUnitPrice }) => ({
            productId,
            quantity,
            expectedUnitPrice
          }))
        }
      )
    ).data,
    onSuccess: async (result, input) => {
      setLastCommittedOrder(result.order);
      setDraftItems([]);
      setDraftKey(crypto.randomUUID());
      setOrderReview(null);
      setPrintError("");
      confirmClickLocked.current = false;
      if (input.printWindow) {
        try {
          printDiningOrderSlip(input.printWindow, result.order);
        } catch {
          input.printWindow.close();
          setPrintError("The order was saved, but the print window failed. Use Reprint to try again.");
          toast("The order was saved, but printing failed. Use Reprint to try again.");
        }
      } else {
        setPrintError("The order was saved, but the print window was blocked. Use Reprint to try again.");
        toast("The order was saved, but the print window was blocked. Use Reprint to try again.");
      }
      await refreshQueries();
    },
    onError: async (error, input) => {
      input.printWindow?.close();
      confirmClickLocked.current = false;
      if (errorCode(error) === "PRODUCT_PRICE_CHANGED") {
        setOrderReview(null);
        await queryClient.invalidateQueries({ queryKey: ["products"], exact: true });
      }
      toast(errorMessage(error));
    }
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
  const orderControlsDisabled = commitOrder.isPending || runMutation.isPending;

  function runAction(method: "post" | "patch", url: string, body?: unknown) {
    const startsSession = method === "post" && (
      url === "/api/pos/dining/sessions" ||
      url.endsWith("/seat") ||
      url.endsWith("/temporary-table")
    );
    if (startsSession) {
      if (commitOrder.isPending) {
        toast("Wait for the current order to finish before seating another table.");
        return;
      }
      if (draftItems.length > 0 && !window.confirm("Starting another table session will discard this unconfirmed cart. Continue?")) {
        return;
      }
    }
    runMutation.mutate({ method, url, body });
  }

  function resetDraftForSessionChange() {
    setDraftItems([]);
    setDraftKey(crypto.randomUUID());
    setOrderReview(null);
    setProductId("");
    setQuantity(1);
    setOrderType("ala_carte");
  }

  function addDraftItem() {
    if (!productId || !Number.isInteger(quantity) || quantity < 1) {
      toast("Choose a product and a whole-number quantity.");
      return;
    }
    setDraftItems((items) => [...items, { productId, quantity }]);
    setOrderReview(null);
    setShowCheckout(false);
    setProductId("");
    setQuantity(1);
  }

  function reviewDraftOrder() {
    if (!session || draftItems.length === 0) {
      toast("Add at least one item before reviewing the order.");
      return;
    }
    const items: ReviewedOrder["items"] = [];
    for (const item of draftItems) {
      const product = productsById.get(item.productId);
      const price = Number(product?.price);
      if (!product || !product.is_available || !Number.isFinite(price) || price < 0) {
        toast("A selected product is no longer available or has an invalid price. Review the cart again.");
        return;
      }
      items.push({
        productId: item.productId,
        name: product.name,
        quantity: item.quantity,
        expectedUnitPrice: Number(price.toFixed(2))
      });
    }
    setOrderReview({
      sessionId: session.id,
      tableNumber: session.table.table_number,
      idempotencyKey: draftKey,
      items
    });
  }

  function confirmAndPrint() {
    if (!orderReview || confirmClickLocked.current || commitOrder.isPending) return;
    confirmClickLocked.current = true;
    setPrintError("");
    const printWindow = window.open("", "_blank", "width=520,height=700");
    commitOrder.mutate({ review: orderReview, printWindow });
  }

  function reprintLastOrder() {
    if (!lastCommittedOrder) return;
    const printWindow = window.open("", "_blank", "width=520,height=700");
    if (!printWindow) {
      setPrintError("The reprint window was blocked. Allow pop-ups and try Reprint again.");
      toast("The reprint window was blocked. Allow pop-ups and try Reprint again.");
      return;
    }
    try {
      printDiningOrderSlip(printWindow, lastCommittedOrder, true);
      setPrintError("");
    } catch {
      printWindow.close();
      setPrintError("The order is still saved, but reprinting failed. Try Reprint again.");
      toast("The order is still saved, but reprinting failed. Try Reprint again.");
    }
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
        <ul>${order.items.map((item) => {
          const guestLabel = item.guest ? `Guest ${item.guest.guest_number}: ` : "";
          return `<li>${guestLabel}${item.quantity} × ${escapeHtml(item.name_snapshot)}</li>`;
        }).join("")}</ul>
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
                      {item.guest ? `Guest ${item.guest.guest_number} · ` : ""}{item.quantity} × {item.name_snapshot}
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
            <p className="text-sm text-slate-500">New dine-in orders deduct stock at Confirm &amp; Print; legacy kitchen tickets deduct when released.</p>
            <ActionButton tone="muted" onClick={() => setManageTablesOpen(true)}>Manage tables</ActionButton>
          </div>
        </header>
        <SectionNav orientation="horizontal" tabs={posTabs} />
        {(tablesQuery.isError || sessionsQuery.isError || upcomingReservationsQuery.isError) && <p className="rounded bg-red-50 p-3 text-sm text-red-800">Unable to load dining tables, sessions, or upcoming reservations.</p>}
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
              <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                <h2 className="text-lg font-bold">Upcoming reservations</h2>
                <span className="text-xs text-slate-500">Today · select a reservation to seat</span>
              </div>
              {upcomingReservationsQuery.isLoading ? (
                <p className="text-sm text-slate-500">Loading reservations...</p>
              ) : (upcomingReservationsQuery.data ?? []).length === 0 ? (
                <p className="text-sm text-slate-500">No upcoming reservations today.</p>
              ) : (
                <ul className="divide-y divide-slate-100">
                  {orderedReservations.map((reservation) => (
                    <li key={reservation.id} className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 py-3 first:pt-0 last:pb-0">
                      <div className="min-w-0">
                        <p className="font-semibold text-slate-900">
                          {reservation.time} · {reservation.customer_name}
                        </p>
                        <p className="text-sm text-slate-600">
                          {reservation.party_size} guests
                          {reservation.table_numbers.length > 0 && ` · Table${reservation.table_numbers.length === 1 ? "" : "s"} ${reservation.table_numbers.join(", ")}`}
                          {reservation.temporary_table_numbers.length > 0 && ` · Temp ${reservation.temporary_table_numbers.join(", ")}`}
                        </p>
                      </div>
                      <div className="flex items-center gap-2">
                        <span className={`rounded-full px-2.5 py-1 text-xs font-bold ${
                          reservation.state === "late"
                            ? "bg-red-100 text-red-800"
                            : reservation.state === "arrived"
                              ? "bg-emerald-100 text-emerald-800"
                              : "bg-slate-100 text-slate-700"
                        }`}>
                          {reservation.state === "late" ? "Late" : reservation.state === "arrived" ? "Arrived" : "Upcoming"}
                        </span>
                        {reservation.state !== "arrived" && (
                          <ActionButton
                            disabled={runMutation.isPending || commitOrder.isPending}
                            onClick={() => {
                              if (window.confirm(`Seat ${reservation.customer_name} at the assigned table${reservation.table_numbers.length === 1 ? "" : "s"}?`)) {
                                runAction("post", `/api/pos/dining/reservations/${reservation.id}/seat`, {});
                              }
                            }}
                          >
                            Seat
                          </ActionButton>
                        )}
                      </div>
                      {temporaryTableReservationId === reservation.id && (
                        <div className="w-full rounded-lg bg-amber-50 p-3 text-sm text-amber-900">
                          An assigned table is busy or unavailable. Add a temporary table for this reservation.
                          <button
                            className="ml-3 rounded bg-amber-800 px-3 py-1.5 font-bold text-white hover:bg-amber-900 disabled:opacity-50"
                            disabled={runMutation.isPending || commitOrder.isPending}
                            onClick={() => {
                              if (window.confirm(`Add a temporary table for ${reservation.customer_name} (${reservation.party_size} guests)?`)) {
                                runAction("post", `/api/pos/dining/reservations/${reservation.id}/temporary-table`, {});
                              }
                            }}
                          >
                            Add temporary table
                          </button>
                        </div>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </section>

            <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
              <h2 className="mb-3 text-lg font-bold">Active tables</h2>
              <div className="grid gap-2">
                {(sessionsQuery.data ?? []).map((item) => (
                  <button
                    key={item.id}
                    className={`rounded-lg border p-3 text-left ${selectedSessionId === item.id ? "border-red-700 bg-red-50" : "border-slate-200 hover:bg-slate-50"}`}
                    disabled={runMutation.isPending || commitOrder.isPending}
                    onClick={() => {
                      if (
                        item.id !== selectedSessionId &&
                        draftItems.length > 0 &&
                        !window.confirm("Switching tables will discard this unconfirmed cart. Continue?")
                      ) {
                        return;
                      }
                      if (item.id !== selectedSessionId) resetDraftForSessionChange();
                      setSelectedSessionId(item.id);
                      setShowCheckout(false);
                    }}
                  >
                    <span className="font-bold">Table {item.table.table_number}</span>
                    <span className="ml-2 text-sm text-slate-600">{item.guests.length} guests · {item.orders.filter((order) => ["reserved", "prepared", "ready"].includes(order.status)).length} open tickets</span>
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
            <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
              <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
                <div>
                  <h2 className="text-lg font-bold">Table board</h2>
                  <p className="text-xs text-slate-500">Choose a free table for a walk-in. Reservations hold their assigned tables.</p>
                </div>
                <div className="flex flex-wrap gap-2 text-xs font-semibold">
                  <span className="rounded bg-emerald-100 px-2 py-1 text-emerald-900">Free</span>
                  <span className="rounded bg-red-100 px-2 py-1 text-red-900">Occupied</span>
                  <span className="rounded bg-amber-100 px-2 py-1 text-amber-900">Reserved / held</span>
                  <span className="rounded bg-slate-200 px-2 py-1 text-slate-800">Unavailable</span>
                </div>
              </div>
              <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                {(tablesQuery.data ?? []).map((table) => {
                  const status = normalizeTableStatus(table.status);
                  const linkedTable = (tablesQuery.data ?? []).find((candidate) => candidate.id === table.linked_to_table_id);
                  const reservation = reservationsByTableNumber.get(table.table_number);
                  const isHeld = Boolean(reservation && ["upcoming", "late"].includes(reservation.state));
                  const isOccupied = Boolean(table.active_session) || status === "occupied";
                  const state = table.linked_to_table_id || (status !== "available" && status !== "occupied")
                    ? "unavailable"
                    : isOccupied
                      ? "occupied"
                      : isHeld
                        ? "reserved"
                        : "free";
                  const stateStyle = state === "free"
                    ? "border-emerald-300 bg-emerald-50 text-emerald-950"
                    : state === "occupied"
                      ? "border-red-300 bg-red-50 text-red-950"
                      : state === "reserved"
                        ? "border-amber-300 bg-amber-50 text-amber-950"
                        : "border-slate-300 bg-slate-100 text-slate-800";
                  const stateLabel = state === "reserved"
                    ? "Reserved / held"
                    : state === "free"
                      ? "Free"
                      : state === "occupied"
                        ? "Occupied"
                        : table.linked_to_table_id
                          ? `Unavailable · linked to Table ${linkedTable?.table_number ?? "—"}`
                          : "Unavailable";

                  return (
                    <article key={table.id} className={`rounded-lg border p-3 ${stateStyle}`}>
                      <div className="flex items-start justify-between gap-2">
                        <div>
                          <h3 className="font-bold">
                            Table {table.table_number}
                            {reservation?.temporary_table_numbers.includes(table.table_number) && (
                              <span className="ml-2 rounded bg-slate-800 px-1.5 py-0.5 text-xs text-white">Temp</span>
                            )}
                          </h3>
                          <p className="text-sm">{table.capacity} seats · {stateLabel}</p>
                          {reservation && (
                            <p className="mt-1 text-xs">
                              {reservation.customer_name} · {reservation.time} · {reservation.state === "late" ? "Late" : reservation.state === "arrived" ? "Arrived" : "Upcoming"}
                            </p>
                          )}
                        </div>
                        {activeUnlimitedTableIds.has(table.id) && (
                          <span className="whitespace-nowrap rounded bg-violet-800 px-2 py-1 text-xs font-bold text-white">Unlimited running</span>
                        )}
                      </div>
                      {state === "free" && (
                        <button
                          className="mt-3 rounded bg-emerald-800 px-3 py-1.5 text-sm font-bold text-white hover:bg-emerald-900 disabled:opacity-50"
                          disabled={runMutation.isPending || commitOrder.isPending}
                          onClick={() => runAction("post", "/api/pos/dining/sessions", { tableId: table.id })}
                        >
                          Seat walk-in
                        </button>
                      )}
                    </article>
                  );
                })}
                {!tablesQuery.isLoading && (tablesQuery.data ?? []).length === 0 && (
                  <p className="rounded border border-dashed p-5 text-sm text-slate-500 sm:col-span-2 xl:col-span-3">No active tables are configured.</p>
                )}
              </div>
            </section>
            {!session ? (
              <section className="grid min-h-64 place-items-center rounded-xl border border-dashed border-slate-300 bg-white p-6 text-center text-slate-500">
                Select an active table to prepare and confirm an a-la-carte order or check out.
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
                    <h2 className="text-lg font-bold">Dine-in order</h2>
                    <select className="h-10 rounded border border-slate-300 px-2" value={orderType} disabled={orderControlsDisabled} onChange={(event) => {
                      setOrderType(event.target.value as "ala_carte" | "unlimited");
                      setProductId("");
                      setOrderReview(null);
                    }}>
                      <option value="ala_carte">A la carte</option>
                      <option value="unlimited">Unlimited session</option>
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
                  {orderType === "ala_carte" && productsQuery.isError && (
                    <p role="alert" className="mb-3 text-sm text-red-700">Current product prices could not be loaded. Reload products before preparing this order.</p>
                  )}
                  {orderType === "unlimited" ? (
                    <p className="rounded bg-amber-50 p-3 text-sm text-amber-900">
                      Unlimited item ordering is not available yet. Existing package controls above are unchanged.
                    </p>
                  ) : (
                    <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_120px_auto]">
                      <label className="grid gap-1 text-sm font-medium text-slate-700">
                        Product
                        <select className="h-10 min-w-0 rounded border border-slate-300 px-2" value={productId} disabled={orderControlsDisabled} onChange={(event) => setProductId(event.target.value)}>
                          <option value="">Select product</option>
                          {availableProducts.filter((item) => item.is_available).map((item) => (
                            <option key={item.id} value={item.id}>{item.name} · {money(Number(item.price))}</option>
                          ))}
                        </select>
                      </label>
                      <label className="grid gap-1 text-sm font-medium text-slate-700">
                        Qty
                        <input className="h-10 rounded border border-slate-300 px-2" type="number" min={1} step={1} value={quantity} disabled={orderControlsDisabled} onChange={(event) => setQuantity(Number(event.target.value))} />
                      </label>
                      <button className="mt-auto h-10 rounded border border-slate-300 px-3 font-bold hover:bg-slate-50 disabled:opacity-50" disabled={orderControlsDisabled} onClick={addDraftItem}>Add item</button>
                    </div>
                  )}
                  {draftItems.length > 0 && orderType === "ala_carte" && (
                    <div className="mt-4 rounded-lg bg-slate-50 p-3">
                      <ul className="space-y-2 text-sm">
                        {draftItems.map((item, index) => (
                          <li key={`${item.productId}-${index}`} className="flex items-center justify-between gap-2">
                            <span>
                              {item.quantity} × {productsById.get(item.productId)?.name ?? item.productId}
                              {productsById.get(item.productId) && ` · ${money(Number(productsById.get(item.productId)?.price))} each`}
                            </span>
                            <button className="text-red-700 underline disabled:opacity-50" disabled={orderControlsDisabled} onClick={() => {
                              setDraftItems((items) => items.filter((_, itemIndex) => itemIndex !== index));
                              setOrderReview(null);
                            }}>Remove</button>
                          </li>
                        ))}
                      </ul>
                      <ActionButton
                        className="mt-3"
                        disabled={orderControlsDisabled}
                        onClick={reviewDraftOrder}
                      >
                        Review order
                      </ActionButton>
                    </div>
                  )}
                  {orderReview && orderType === "ala_carte" && (
                    <section aria-label="Order confirmation" className="mt-4 rounded-lg border-2 border-slate-300 bg-white p-4" data-testid="order-review">
                      <h3 className="text-lg font-bold">Confirm order · Table {orderReview.tableNumber}</h3>
                      <p className="mb-3 text-sm text-slate-600">Check the complete item and price list. Stock is deducted once when you confirm and print.</p>
                      <ul className="divide-y divide-slate-200">
                        {orderReview.items.map((item, index) => (
                          <li key={`${item.productId}-${index}`} className="flex justify-between gap-3 py-2 text-sm">
                            <span>{item.quantity} × {item.name} at {money(item.expectedUnitPrice)}</span>
                            <span className="font-semibold">{money(item.quantity * item.expectedUnitPrice)}</span>
                          </li>
                        ))}
                      </ul>
                      <p className="mt-3 text-right font-bold">
                        Total: {money(orderReview.items.reduce((sum, item) => sum + item.quantity * item.expectedUnitPrice, 0))}
                      </p>
                      <div className="mt-3 flex flex-wrap gap-2">
                        <ActionButton tone="muted" disabled={orderControlsDisabled} onClick={() => setOrderReview(null)}>Edit cart</ActionButton>
                        <ActionButton disabled={orderControlsDisabled} onClick={confirmAndPrint}>
                          {commitOrder.isPending ? "Committing..." : "Confirm & Print"}
                        </ActionButton>
                      </div>
                    </section>
                  )}
                  {lastCommittedOrder && (
                    <section aria-label="Last committed order" className="mt-4 rounded-lg border border-emerald-300 bg-emerald-50 p-3">
                      <p className="font-semibold">
                        Saved order {lastCommittedOrder.order_number} · Table {lastCommittedOrder.table_number_snapshot ?? "—"}
                      </p>
                      {printError && <p role="alert" className="mt-1 text-sm text-amber-900">{printError}</p>}
                      <ActionButton className="mt-2" tone="muted" onClick={reprintLastOrder}>Reprint</ActionButton>
                    </section>
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
                    <p className="text-sm text-slate-600">Legacy kitchen tickets must be released or cancelled. Committed orders are included automatically; end all Unlimited packages before checkout.</p>
                    <div className="flex flex-col items-end gap-1">
                      {draftItems.length > 0 && <p className="text-xs text-amber-800">Confirm or remove the draft cart before checkout.</p>}
                      <ActionButton disabled={runMutation.isPending || draftItems.length > 0} onClick={() => setShowCheckout(true)}>Review bill</ActionButton>
                    </div>
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
      `<tr><td>${item.quantity} × ${escapeHtml(item.name_snapshot ?? item.selling_product.name)}</td><td class="right">${money(item.total_price)}</td></tr>`
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
      <p>Table ${transaction.table_number_snapshot ?? transaction.dining_session.table.table_number}</p>
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

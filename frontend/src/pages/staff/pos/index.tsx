import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { Minus, Plus, Printer, Settings, ShoppingCart, Trash2 } from "lucide-react";
import PaymentModal from "./PaymentModal";
import { PosCartKey, PosProduct, usePosCart } from "./store";
import { api } from "../../../lib/api";
import { defaultSystemSettings, fetchSystemSettings, type SystemSettings } from "../../../lib/systemSettings";
import { useToast } from "../../../hooks/useToast";
import { formatManilaDateTime } from "../../../lib/dateTime";
import { Button } from "../../../components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "../../../components/ui/card";
import { Select } from "../../../components/ui/select";
import { Dialog } from "../../../components/ui/dialog";
import DiningService, {
  LAST_COMMITTED_ORDER_STORAGE_KEY,
  printDiningOrderSlip,
  type CommittedDiningOrder
} from "./DiningService";
import UnlimitedTimer from "../../../components/pos/UnlimitedTimer";
import PosOrderBuilder from "./PosOrderBuilder";
import PosHeader from "./PosHeader";
import SectionNav, { SectionNavTab } from "../../../components/layout/SectionNav";

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
  status: "preparing" | "ready" | "completed";
  payment_plan: "pay_now" | "pay_at_pickup";
  payment_status: string;
  payment_method: string | null;
  customer_name: string;
  created_at: string;
  pickup_time: string | null;
  total: number;
  items: Array<{ name: string; quantity: number; unit_price: number; total_price: number }>;
};

type PosUnlimitedSession = {
  id: string;
  pax_count: number;
  price_per_pax: number;
  status: string;
  ends_at: string;
  first_round_at: string | null;
  extensions: Array<{ minutes: number; created_at: string }>;
};

type PosDiningSession = {
  id: string;
  status: string;
  table: { table_number: number };
  guests: Array<{ id: string }>;
  orders: Array<{ status: string }>;
  unlimited_sessions: PosUnlimitedSession[];
};

type DiningCheckoutPreview = {
  session_id: string;
  table_number: number;
  guest_count: number;
  subtotal: number;
  discount_base_snapshot: number;
  discount_rate_snapshot: number;
  discounted_guest_count: number;
  discount_amount: number;
  total: number;
};

type UnlimitedPricingSettings = {
  price_per_person: number;
  extension_minutes: number;
};

type SelectionView = "menu" | "table-board" | "reservation-list" | "pickup-list";
type DialogStep = "service" | "entry" | null;

const posTabs: Array<SectionNavTab> = [
  { id: "history", label: "Transaction History", to: "/staff/pos/history" },
  { id: "settings", label: "Unli Settings", icon: <Settings className="h-4 w-4" />, to: "/staff/pos/unlimited-settings" }
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
  const [dineInEntryType, setDineInEntryType] = useState<"walk_in" | "reservation">("walk_in");
  const [selectionView, setSelectionView] = useState<SelectionView>("menu");
  const [dialogStep, setDialogStep] = useState<DialogStep>(null);
  const [tableBoardPurpose, setTableBoardPurpose] = useState<"walk_in" | "existing_table">("walk_in");
  const [selectedTable, setSelectedTable] = useState<{ id: string; number: number } | null>(null);
  const [selectedReservation, setSelectedReservation] = useState<{ id: string; name: string; time: string; tableNumbers: number[] } | null>(null);
  const [selectedDiningSessionId, setSelectedDiningSessionId] = useState("");
  const [customerName, setCustomerName] = useState("");
  const [pickupSearch, setPickupSearch] = useState("");
  const [selectedPickupOrder, setSelectedPickupOrder] = useState<PickupOrder | null>(null);
  const [lastCommittedOrderId, setLastCommittedOrderId] = useState(
    () => localStorage.getItem(LAST_COMMITTED_ORDER_STORAGE_KEY)
  );
  const [category, setCategory] = useState("All");
  const [paymentOpen, setPaymentOpen] = useState(false);
  const [billOutOpen, setBillOutOpen] = useState(false);
  const [billOutGuestCount, setBillOutGuestCount] = useState("1");
  const [billOutSeniorPwdCount, setBillOutSeniorPwdCount] = useState("0");
  const [billOutPaymentMethod, setBillOutPaymentMethod] = useState<"cash" | "gcash" | "bank_transfer">("cash");
  const [billOutCashReceived, setBillOutCashReceived] = useState("");
  const [extendingUnlimited, setExtendingUnlimited] = useState(false);
  const [showLastTableSessionTools, setShowLastTableSessionTools] = useState(false);
  const role = getStoredRole();
  const allowed = role === "admin" || role === "cashier";
  const carts = usePosCart((state) => state.carts);
  const orderType = usePosCart((state) => state.dineOrderType);
  const headcount = usePosCart((state) => state.dineHeadcount);
  const addItemTo = usePosCart((state) => state.addItemTo);
  const clearCartFor = usePosCart((state) => state.clearCartFor);
  const decrementItemFrom = usePosCart((state) => state.decrementItemFrom);
  const removeItemFrom = usePosCart((state) => state.removeItemFrom);
  const selectCart = usePosCart((state) => state.selectCart);
  const setDineOrderType = usePosCart((state) => state.setDineOrderType);
  const setDineHeadcount = usePosCart((state) => state.setDineHeadcount);
  const draftKeys = usePosCart((state) => state.draftKeys);
  const rotateDraftKey = usePosCart((state) => state.rotateDraftKey);
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const legacyWorkflowRef = useRef<HTMLElement>(null);

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
        params: { search: pickupSearch.trim() }
      });
      return response.data.orders;
    },
    enabled: allowed && selectionView === "pickup-list" && pickupSearch.trim().length >= 2,
    staleTime: 5_000
  });

  const lastCommittedOrderQuery = useQuery({
    queryKey: ["pos", "dining", "committed-order", lastCommittedOrderId],
    queryFn: async () => {
      if (!lastCommittedOrderId) return null;
      const response = await api.get<{ order: CommittedDiningOrder }>(
        `/api/pos/dining/orders/${lastCommittedOrderId}`
      );
      return response.data.order;
    },
    enabled: allowed && Boolean(lastCommittedOrderId),
    retry: 1
  });

  const diningSessionsQuery = useQuery({
    queryKey: ["pos", "dining", "sessions"],
    queryFn: async () => (await api.get<{ sessions: PosDiningSession[] }>("/api/pos/dining/sessions")).data.sessions,
    enabled: allowed && Boolean(selectedDiningSessionId || lastCommittedOrderQuery.data?.dining_session_id),
    refetchInterval: 10_000
  });

  const systemSettingsQuery = useQuery({
    queryKey: ["system-settings"],
    queryFn: fetchSystemSettings,
    enabled: allowed,
    retry: 1
  });

  const unlimitedSettingsQuery = useQuery({
    queryKey: ["admin", "unlimited", "settings"],
    queryFn: async () => {
      const response = await api.get<{ settings: UnlimitedPricingSettings }>("/api/admin/unlimited/settings");
      return response.data.settings;
    },
    enabled: allowed,
    retry: 1
  });

  const systemSettings = systemSettingsQuery.data ?? defaultSystemSettings;
  const isDineIn = customerType === "existing_table"
    || (customerType === "new_customer" && customerService === "dine_in");
  const isPickupCustomer = customerType === "pickup_customer";
  const tableSessionToolsId = selectedDiningSessionId || lastCommittedOrderQuery.data?.dining_session_id || "";
  const activeSession = diningSessionsQuery.data?.find(
    (session) => session.id === tableSessionToolsId && session.status === "active"
  ) ?? null;
  const activeUnlimitedSession = activeSession?.unlimited_sessions.find((session) => session.status === "active") ?? null;
  const cartKey: PosCartKey = isDineIn
    ? "dine_in_ala_carte"
    : "takeout";
  const items = carts[cartKey];
  const hasUnlimitedItems = items.some((item) => item.diningOrderType === "unlimited");
  const takeoutItems = carts.takeout;

  useEffect(() => {
    selectCart(cartKey);
  }, [cartKey, selectCart]);

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

  function addItem(product: PosProduct) {
    const compatibility = product.cart_compatibility;
    const cartItemType = isDineIn
      && orderType === "unlimited"
      && compatibility?.unlimited.allowed
      && (compatibility.unlimited.classification === "included_in_unlimited"
        || compatibility.unlimited.classification === "unlimited_only")
      ? "unlimited"
      : isDineIn ? "ala_carte" : undefined;
    addItemTo(cartKey, product, 1, cartItemType);
  }

  function removeItem(productId: string, diningOrderType?: "ala_carte" | "unlimited") {
    removeItemFrom(cartKey, productId, diningOrderType);
  }

  function decrementItem(productId: string, diningOrderType?: "ala_carte" | "unlimited") {
    decrementItemFrom(cartKey, productId, diningOrderType);
  }

  const checkoutMutation = useMutation({
    mutationFn: async (payment: { paymentMethod: "cash" | "gcash" | "bank_transfer"; cashReceived?: number }) => {
      console.debug("Checkout submit", {
        itemCount: takeoutItems.length,
        hasToken: Boolean(localStorage.getItem("katana_token"))
      });
      const response = await api.post<{ transaction: PosTransaction }>("/api/pos/transaction", {
        customerName,
        transactionType: "takeout",
        paymentMethod: payment.paymentMethod,
        cashReceived: payment.cashReceived,
        items: takeoutItems.map((item) => ({
          productId: item.product.id,
          quantity: item.quantity,
          unitPrice: Number(item.product.price)
        }))
      });

      return response.data.transaction;
    },
    onSuccess: (transaction) => {
      setPaymentOpen(false);
      clearCartFor("takeout");
      setCustomerName("");
      setSelectionView("menu");
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

  const startUnlimitedSessionMutation = useMutation({
    mutationFn: async (input: { sessionId: string; paxCount: number }) => {
      const response = await api.post<{ unlimited_session: PosUnlimitedSession }>(
        `/api/pos/dining/sessions/${input.sessionId}/unlimited-sessions`,
        { paxCount: input.paxCount }
      );
      return response.data.unlimited_session;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["pos", "dining", "sessions"] });
      toast("Unlimited session started.");
    },
    onError: (error) => toast(getApiErrorMessage(error, "Unable to start the Unlimited session."))
  });

  const extendUnlimitedSessionMutation = useMutation({
    mutationFn: async (unlimitedSessionId: string) => {
      const response = await api.post<{ extension: { minutes: number }; session: PosUnlimitedSession }>(
        `/api/pos/dining/unlimited-sessions/${unlimitedSessionId}/extend`
      );
      return response.data;
    },
    onSuccess: ({ extension }) => {
      queryClient.invalidateQueries({ queryKey: ["pos", "dining", "sessions"] });
      toast(`Unlimited session extended by ${extension.minutes} minutes at no fee.`);
    },
    onError: (error) => toast(getApiErrorMessage(error, "Unable to extend the Unlimited session."))
  });

  const billOutPreviewQuery = useQuery({
    queryKey: ["pos", "dining", "checkout-preview", tableSessionToolsId, billOutGuestCount, billOutSeniorPwdCount],
    queryFn: async () => {
      const response = await api.get<DiningCheckoutPreview>(
        `/api/pos/dining/sessions/${tableSessionToolsId}/checkout-preview`,
        { params: { guestCount: Number(billOutGuestCount), seniorPwdCount: Number(billOutSeniorPwdCount) } }
      );
      return response.data;
    },
    enabled: billOutOpen
      && Boolean(activeSession)
      && Number.isInteger(Number(billOutGuestCount))
      && Number(billOutGuestCount) > 0
      && Number.isInteger(Number(billOutSeniorPwdCount))
      && Number(billOutSeniorPwdCount) >= 0
      && Number(billOutSeniorPwdCount) <= Number(billOutGuestCount)
  });

  const billOutMutation = useMutation({
    mutationFn: async () => {
      if (!activeSession) throw new Error("The active table session is no longer available.");
      const response = await api.post<{ transaction: PosTransaction; replayed: boolean }>(
        `/api/pos/dining/sessions/${activeSession.id}/checkout`,
        {
          guestCount: Number(billOutGuestCount),
          seniorPwdCount: Number(billOutSeniorPwdCount),
          paymentMethod: billOutPaymentMethod,
          ...(billOutPaymentMethod === "cash" ? { cashReceived: Number(billOutCashReceived) } : {})
        }
      );
      return response.data;
    },
    onSuccess: ({ transaction }) => {
      setBillOutOpen(false);
      setSelectedDiningSessionId("");
      queryClient.invalidateQueries({ queryKey: ["pos", "dining", "sessions"] });
      queryClient.invalidateQueries({ queryKey: ["pos", "dining", "tables"] });
      queryClient.invalidateQueries({ queryKey: ["pos", "transactions"] });
      queryClient.invalidateQueries({ queryKey: ["inventory"] });
      toast("Table bill completed and table released.");
      printReceipt(transaction, systemSettings);
    },
    onError: (error) => toast(getApiErrorMessage(error, "Unable to complete the table bill."))
  });

  const pickupCompletionMutation = useMutation({
    mutationFn: async (payment: { paymentMethod?: "cash"; cashReceived?: number }) => {
      if (!selectedPickupOrder) {
        throw new Error("Select a preparing or ready pickup order first.");
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
      setSelectionView("menu");
      queryClient.invalidateQueries({ queryKey: ["pos", "pickup-orders"] });
      queryClient.invalidateQueries({ queryKey: ["inventory"] });
      toast("Pickup order completed and handed over.");
    },
    onError: (error) => {
      toast(getApiErrorMessage(error, "Unable to complete this pickup order."));
      queryClient.invalidateQueries({ queryKey: ["pos", "pickup-orders"] });
    }
  });

  const dineInConfirmationMutation = useMutation({
    mutationFn: async (input: {
      selection:
        | { type: "session"; sessionId: string }
        | { type: "table"; tableId: string }
        | { type: "reservation"; reservationId: string };
      printWindow: Window;
    }) => {
      const response = await api.post<{ order: CommittedDiningOrder; replayed: boolean }>(
        "/api/pos/dining/confirm-order",
        {
          selection: input.selection,
          idempotencyKey: draftKeys[cartKey],
          orderType: hasUnlimitedItems ? "unlimited" : "ala_carte",
          ...(hasUnlimitedItems ? { paxCount: headcount } : {}),
          items: items.map((item) => {
            const itemOrderType = item.diningOrderType ?? "ala_carte";
            return {
              productId: item.product.id,
              quantity: item.quantity,
              orderType: itemOrderType,
              expectedUnitPrice: itemOrderType === "unlimited" ? 0 : Number(item.product.price)
            };
          })
        }
      );
      return { ...response.data, printWindow: input.printWindow };
    },
    onSuccess: ({ order, printWindow }) => {
      localStorage.setItem(LAST_COMMITTED_ORDER_STORAGE_KEY, order.id);
      setLastCommittedOrderId(order.id);
      queryClient.setQueryData(["pos", "dining", "committed-order", order.id], order);
      clearCartFor(cartKey);
      rotateDraftKey(cartKey);
      setSelectedTable(null);
      setSelectedReservation(null);
      setSelectedDiningSessionId("");
      setSelectionView("menu");
      setCustomerType("new_customer");
      setCustomerService("takeout");
      queryClient.invalidateQueries({ queryKey: ["pos", "dining", "tables"] });
      queryClient.invalidateQueries({ queryKey: ["pos", "dining", "sessions"] });
      queryClient.invalidateQueries({ queryKey: ["pos", "dining", "upcoming-reservations"] });
      queryClient.invalidateQueries({ queryKey: ["pos", "kitchen", "orders"] });
      queryClient.invalidateQueries({ queryKey: ["inventory"] });
      queryClient.invalidateQueries({ queryKey: ["products"] });
      try {
        printDiningOrderSlip(printWindow, order);
        toast("Order confirmed and sent to print.");
      } catch (error) {
        printWindow.close();
        console.error("Dine-in order printing failed", error);
        toast(`Order ${order.order_number} was saved, but printing failed. Please retry the print.`);
      }
    },
    onError: (error, input) => {
      input.printWindow.close();
      toast(getApiErrorMessage(error, "Unable to confirm this dine-in order."));
    }
  });

  function handleCheckout() {
    if (takeoutItems.length === 0) {
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

  function handleReprintLastOrder() {
    const order = lastCommittedOrderQuery.data;
    if (!order) {
      toast("The saved order is not available to reprint.");
      return;
    }
    const printWindow = window.open("", "_blank", "width=420,height=640");
    if (!printWindow) {
      toast("Allow pop-ups for this site before reprinting the order.");
      return;
    }
    try {
      printDiningOrderSlip(printWindow, order, true);
    } catch (error) {
      printWindow.close();
      console.error("Dine-in order reprinting failed", error);
      toast("The order is saved, but the reprint window failed.");
    }
  }

  function beginNewCustomer() {
    setCustomerType("new_customer");
    setSelectedDiningSessionId("");
    setSelectedTable(null);
    setSelectedReservation(null);
    setSelectedPickupOrder(null);
    setDialogStep("service");
  }

  function chooseCustomerService(nextService: "dine_in" | "takeout") {
    setCustomerService(nextService);
    setDialogStep("entry");
  }

  function chooseCustomerEntry(entry: "walk_in" | "reservation" | "pickup") {
    setDialogStep(null);
    setSelectedDiningSessionId("");
    if (customerService === "dine_in") {
      setCustomerType("new_customer");
      if (entry === "reservation") {
        setDineInEntryType("reservation");
      } else {
        setDineInEntryType("walk_in");
        setTableBoardPurpose("walk_in");
        setSelectedTable(null);
        setSelectedReservation(null);
      }
      setSelectionView("menu");
      return;
    }

    setCustomerType(entry === "pickup" ? "pickup_customer" : "new_customer");
    setSelectedPickupOrder(null);
    setPickupSearch("");
    setSelectionView(entry === "pickup" ? "pickup-list" : "menu");
  }

  function beginExistingTable() {
    setCustomerType("existing_table");
    setCustomerService("dine_in");
    setTableBoardPurpose("existing_table");
    setSelectedTable(null);
    setSelectedReservation(null);
    setSelectedPickupOrder(null);
    setSelectedDiningSessionId("");
    setSelectionView("menu");
  }

  function selectTable(selection: { tableId: string; tableNumber: number; sessionId: string | null }) {
    setSelectedTable({ id: selection.tableId, number: selection.tableNumber });
    setSelectedDiningSessionId(selection.sessionId ?? "");
    setSelectionView("menu");
  }

  function selectReservation(reservation: { id: string; customer_name: string; time: string; table_numbers: number[] }) {
    setSelectedReservation({
      id: reservation.id,
      name: reservation.customer_name,
      time: reservation.time,
      tableNumbers: reservation.table_numbers
    });
    setSelectedDiningSessionId("");
    setSelectionView("menu");
  }

  function selectPickupOrder(order: PickupOrder) {
    setSelectedPickupOrder(order);
    setSelectionView("menu");
  }

  function selectDineOrderType(nextType: "ala_carte" | "unlimited") {
    setDineOrderType(nextType);
    selectCart("dine_in_ala_carte");
  }

  function handlePrimaryAction() {
    if (isPickupCustomer) {
      if (selectedPickupOrder) handlePickupCheckout();
      return;
    }
    if (isDineIn) {
      if (!selectedTable && !selectedReservation) {
        setSelectionView(dineInEntryType === "reservation" ? "reservation-list" : "table-board");
      } else {
        if (items.length === 0 || dineInConfirmationMutation.isPending) return;
        const printWindow = window.open("", "_blank", "width=420,height=640");
        if (!printWindow) {
          toast("Allow pop-ups for this site before confirming and printing the order.");
          return;
        }
        const selection = selectedReservation
          ? { type: "reservation" as const, reservationId: selectedReservation.id }
          : selectedDiningSessionId
            ? { type: "session" as const, sessionId: selectedDiningSessionId }
            : { type: "table" as const, tableId: selectedTable!.id };
        dineInConfirmationMutation.mutate({ selection, printWindow });
      }
      return;
    }
    handleCheckout();
  }

  const selectionContent = selectionView === "table-board" ? (
    <DiningService
      key={`table-board-${tableBoardPurpose}`}
      mode="board"
      boardPurpose={tableBoardPurpose}
      embedded
      onBackToBoard={() => setSelectionView("menu")}
      onTableSelected={selectTable}
    />
  ) : selectionView === "reservation-list" ? (
    <DiningService
      key="reservation-picker"
      mode="reservation-picker"
      embedded
      onBackToBoard={() => setSelectionView("menu")}
      onReservationSelected={selectReservation}
    />
  ) : selectionView === "pickup-list" ? (
    <section aria-label="Pickup order list" className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
      <div className="mb-4 flex items-center justify-between gap-3">
        <div>
          <h2 className="text-xl font-bold">Pickup Orders</h2>
          <p className="text-sm text-slate-600">Approved Preparing and Ready orders are listed here.</p>
        </div>
        <Button variant="outline" onClick={() => setSelectionView("menu")}>Back to menu</Button>
      </div>
      <label className="mb-4 grid max-w-xl gap-1 text-sm font-medium text-slate-700">
        <span>Search by Order ID or customer name</span>
        <input
          className="h-11 rounded-md border border-slate-300 px-3 text-sm"
          autoComplete="off"
          value={pickupSearch}
          onChange={(event) => setPickupSearch(event.target.value)}
          placeholder="Enter at least 2 characters"
        />
      </label>
      {pickupSearch.trim().length < 2 && <p className="text-sm text-slate-500">Enter at least 2 characters of the order ID.</p>}
      {pickupOrdersQuery.isLoading && <p className="text-sm text-slate-500">Searching pickup orders...</p>}
      {pickupOrdersQuery.isError && <p role="alert" className="text-sm text-red-700">Unable to search pickup orders. Please retry.</p>}
      {pickupSearch.trim().length >= 2 && pickupOrdersQuery.isSuccess && pickupOrdersQuery.data.length === 0 && (
        <p className="text-sm text-slate-500">No Preparing or Ready orders match that order ID or customer name.</p>
      )}
      <div className="grid gap-2">
        {pickupOrdersQuery.data?.map((order) => (
          <button
            key={order.order_number}
            type="button"
            className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-slate-200 p-4 text-left hover:bg-slate-50"
            onClick={() => selectPickupOrder(order)}
          >
            <span>
              <span className="block font-semibold">{order.order_number} · {order.customer_name}</span>
              <span className="text-sm text-slate-600">{order.status === "ready" ? "Ready" : "Preparing"}</span>
            </span>
            <span className="font-semibold">{money(order.total)}</span>
          </button>
        ))}
      </div>
    </section>
  ) : null;

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
        <PosHeader />
        <p className="text-sm text-slate-500">Signed in as {role}</p>

        <PosOrderBuilder
          customerType={customerType}
          onNewCustomer={beginNewCustomer}
          onExistingTable={beginExistingTable}
          selectionContent={selectionContent}
          sessionControls={activeSession ? (
            <section aria-label="Active table session controls" className="grid gap-3 rounded-md border border-slate-200 bg-slate-50 p-3">
              <div>
                <p className="font-semibold text-slate-900">Table {activeSession.table.table_number} session</p>
                <p className="text-xs text-slate-600">{activeSession.guests.length} recorded guests</p>
              </div>
              {activeUnlimitedSession ? (
                <>
                  <UnlimitedTimer
                    firstRoundAt={activeUnlimitedSession.first_round_at}
                    endsAt={activeUnlimitedSession.ends_at}
                  />
                  <p className="text-sm font-semibold text-slate-800">
                    Unlimited package: {activeUnlimitedSession.pax_count} × {money(Number(activeUnlimitedSession.price_per_pax))}
                  </p>
                  <Button
                    variant="outline"
                    disabled={
                      extendUnlimitedSessionMutation.isPending
                      || unlimitedSettingsQuery.isLoading
                      || unlimitedSettingsQuery.isError
                      || !unlimitedSettingsQuery.data?.extension_minutes
                    }
                    onClick={() => {
                      const minutes = unlimitedSettingsQuery.data?.extension_minutes;
                      if (minutes && window.confirm(`Extend this Unlimited session by ${minutes} minutes? There is no fee.`)) {
                        extendUnlimitedSessionMutation.mutate(activeUnlimitedSession.id);
                      }
                    }}
                  >
                    {extendUnlimitedSessionMutation.isPending ? "Extending..." : "Extend Session"}
                  </Button>
                  <p className="text-xs text-slate-600">
                    {unlimitedSettingsQuery.isError
                      ? "Unable to load the configured extension duration."
                      : `Adds ${unlimitedSettingsQuery.data?.extension_minutes ?? "—"} minutes · no fee`}
                  </p>
                </>
              ) : isDineIn && orderType === "unlimited" ? (
                <Button
                  variant="outline"
                  disabled={
                    startUnlimitedSessionMutation.isPending
                    || unlimitedSettingsQuery.isLoading
                    || unlimitedSettingsQuery.isError
                    || !unlimitedSettingsQuery.data
                    || !Number.isInteger(headcount)
                    || headcount < 1
                    || headcount > 100
                  }
                  onClick={() => startUnlimitedSessionMutation.mutate({
                    sessionId: activeSession.id,
                    paxCount: headcount
                  })}
                >
                  {startUnlimitedSessionMutation.isPending ? "Starting session..." : "Start Unlimited Session"}
                </Button>
              ) : null}
              <Button
                variant="outline"
                disabled={
                  billOutMutation.isPending
                  || carts.dine_in_ala_carte.length > 0
                  || carts.dine_in_unlimited.length > 0
                }
                onClick={() => {
                  setBillOutGuestCount(String(Math.max(activeSession.guests.length, headcount, 1)));
                  setBillOutSeniorPwdCount("0");
                  setBillOutCashReceived("");
                  setBillOutOpen(true);
                }}
              >
                Bill out table
              </Button>
              {(carts.dine_in_ala_carte.length > 0 || carts.dine_in_unlimited.length > 0) && (
                <p className="text-xs text-slate-600">Commit or clear the dine-in cart before billing out.</p>
              )}
            </section>
          ) : null}
          selectionSummary={selectedTable
            ? `Table ${selectedTable.number} selected`
            : selectedReservation
              ? `${selectedReservation.name} · ${selectedReservation.time} selected`
              : null}
          customerService={customerService}
          cartKey={cartKey}
          orderType={orderType}
          onOrderTypeChange={selectDineOrderType}
          headcount={headcount}
          onHeadcountChange={setDineHeadcount}
          products={productsQuery.data ?? []}
          productsLoading={productsQuery.isLoading}
          productsError={productsQuery.isError}
          category={category}
          onCategoryChange={setCategory}
          items={isPickupCustomer ? [] : items}
          pickupOrder={selectedPickupOrder}
          unlimitedPricePerPerson={unlimitedSettingsQuery.data?.price_per_person ?? null}
          activeUnlimitedPaxCount={activeUnlimitedSession?.pax_count ?? null}
          activeUnlimitedPricePerPerson={activeUnlimitedSession?.price_per_pax ?? null}
          onAddItem={(product, itemOrderType) => {
            if (!isPickupCustomer) {
              if (itemOrderType) addItemTo(cartKey, product, 1, itemOrderType);
              else addItem(product);
            }
          }}
          onRemoveItem={(productId) => removeItemFrom(cartKey, productId)}
          onDecrementItem={(productId) => decrementItemFrom(cartKey, productId)}
          customerName={customerName}
          onCustomerNameChange={setCustomerName}
          lastCommittedOrderNumber={isPickupCustomer ? null : lastCommittedOrderQuery.data?.order_number}
          onReprintLastOrder={handleReprintLastOrder}
          actionLabel={isPickupCustomer
            ? "Checkout"
            : isDineIn
              ? (selectedTable || selectedReservation) ? "Confirm & Print" : "Proceed"
              : "Checkout"}
          actionDisabled={isPickupCustomer
            ? !selectedPickupOrder || pickupCompletionMutation.isPending
            : isDineIn
              ? Boolean(selectedTable || selectedReservation) && items.length === 0
                || dineInConfirmationMutation.isPending
                || (hasUnlimitedItems && (
                  !Number.isInteger(headcount)
                  || headcount < 1
                  || headcount > 100
                  || unlimitedSettingsQuery.isError
                  || !unlimitedSettingsQuery.data
                ))
              : items.length === 0 || checkoutMutation.isPending}
          onAction={handlePrimaryAction}
        />

        {tableSessionToolsId ? (
          <section className="grid gap-3">
            <Button
              className="justify-self-start"
              variant="outline"
              onClick={() => setShowLastTableSessionTools((isOpen) => !isOpen)}
            >
              {showLastTableSessionTools ? "Close" : "Open"} table session tools
            </Button>
            {showLastTableSessionTools && (
              <DiningService
                key={`last-committed-session-${tableSessionToolsId}`}
                mode="service"
                embedded
                initialSessionId={tableSessionToolsId}
              />
            )}
          </section>
        ) : null}

        {false && selectionView === "menu" && isDineIn && selectedDiningSessionId ? (
          <section ref={legacyWorkflowRef} aria-label="Temporary legacy dine-in workflow" className="space-y-3 rounded-lg border border-amber-300 bg-amber-50 p-3">
            <p role="note" className="text-sm font-semibold text-amber-950">
              Temporary legacy dine-in workflow. These existing table actions remain only until the transactional order-first steps replace them.
            </p>
          {selectedDiningSessionId ? (
            <DiningService
              key={`dining-order-${selectedDiningSessionId}`}
              mode="service"
              embedded
              initialSessionId={selectedDiningSessionId}
              onSessionSelected={setSelectedDiningSessionId}
              onBackToBoard={() => {
                setSelectedDiningSessionId("");
                setTableBoardPurpose("existing_table");
                setSelectionView("table-board");
              }}
            />
          ) : (
            <DiningService
              key="dining-board"
              mode="board"
              embedded
              onSessionSelected={setSelectedDiningSessionId}
            />
          )}
          </section>
        ) : isPickupCustomer ? (
          <section ref={legacyWorkflowRef} aria-label="Temporary legacy pickup fulfillment" className="hidden">
          <p role="note" className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm font-semibold text-amber-950">
            Temporary legacy pickup search and checkout panel; it remains until the pickup prompt is moved into the shared layout.
          </p>
          <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(320px,0.8fr)]">
            <Card className="min-w-0">
              <CardHeader>
                <CardTitle>Find pickup orders</CardTitle>
              </CardHeader>
              <CardContent className="grid gap-4">
                <label className="grid gap-1 text-sm font-medium text-slate-700">
                  <span>Order ID</span>
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
                  <p className="text-sm text-slate-500">Enter at least 2 characters of the order ID or customer name. Preparing and Ready orders are available.</p>
                )}
                {pickupOrdersQuery.isLoading && <p className="text-sm text-slate-500">Searching pickup orders...</p>}
                {pickupOrdersQuery.isError && <p role="alert" className="text-sm text-red-700">Unable to search pickup orders. Please retry.</p>}
                {pickupSearch.trim().length >= 2 && pickupOrdersQuery.isSuccess && pickupOrdersQuery.data.length === 0 && (
                  <p className="text-sm text-slate-500">No preparing or ready pickup orders match that ID.</p>
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
                        <span className="block font-semibold text-slate-950">{order.order_number}</span>
                        <span className="block text-xs capitalize text-slate-500">{order.status}</span>
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
                    Select a preparing or ready pickup order to load its cart.
                  </p>
                ) : (
                  <>
                    <div>
                      <p className="font-semibold text-slate-950">{selectedPickupOrder.customer_name}</p>
                      <p className="text-sm text-slate-500">{selectedPickupOrder.order_number}</p>
                      <p className={`mt-2 text-sm font-semibold ${selectedPickupOrder.status === "ready" ? "text-emerald-800" : "text-amber-800"}`}>
                        {selectedPickupOrder.status === "ready" ? "Ready for pickup" : "Preparing"}
                      </p>
                      {selectedPickupOrder.pickup_time ? (
                        <p className="text-sm text-slate-600">
                          Pickup Time: {formatManilaDateTime(selectedPickupOrder.pickup_time, { hour: "numeric", minute: "2-digit" })}
                        </p>
                      ) : null}
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
                        </>
                      ) : (
                        <>
                          <p className="text-sm text-amber-800">Payment is due at pickup. Collect cash before handover.</p>
                        </>
                      )}
                      <p className="text-xs text-slate-500">Use the single action button in the order panel to complete pickup.</p>
                    </div>
                  </>
                )}
              </CardContent>
            </Card>
          </div>
          </section>
        ) : (
        <div className="hidden">
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
        </div>
        )}
      </div>

      <Dialog
        open={dialogStep === "service"}
        title="New Customer"
        onClose={() => setDialogStep(null)}
      >
        <div className="grid gap-3 sm:grid-cols-2">
          <Button className="min-h-14 text-base font-bold" onClick={() => chooseCustomerService("dine_in")}>Dine-in</Button>
          <Button className="min-h-14 text-base font-bold" variant="outline" onClick={() => chooseCustomerService("takeout")}>Take-out</Button>
        </div>
      </Dialog>
      <Dialog
        open={dialogStep === "entry"}
        title={customerService === "dine_in" ? "Dine-in" : "Take-out"}
        onClose={() => setDialogStep(null)}
      >
        <div className="grid gap-3 sm:grid-cols-2">
          <Button className="min-h-14 text-base font-bold" onClick={() => chooseCustomerEntry("walk_in")}>Walk-in</Button>
          {customerService === "dine_in" ? (
            <Button className="min-h-14 text-base font-bold" variant="outline" onClick={() => chooseCustomerEntry("reservation")}>Reservation</Button>
          ) : (
            <Button className="min-h-14 text-base font-bold" variant="outline" onClick={() => chooseCustomerEntry("pickup")}>Pickup</Button>
          )}
        </div>
      </Dialog>
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
      <Dialog
        open={billOutOpen}
        title={`Bill out Table ${activeSession?.table.table_number ?? ""}`}
        onClose={() => setBillOutOpen(false)}
        panelClassName="max-w-xl"
      >
        <div className="grid gap-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="grid gap-1 text-sm font-medium text-slate-700">
              Total guests
              <input
                aria-label="Bill-out guest count"
                className="h-10 rounded-md border border-slate-300 px-3"
                type="number"
                min={1}
                max={1000}
                value={billOutGuestCount}
                onChange={(event) => setBillOutGuestCount(event.target.value)}
              />
            </label>
            <label className="grid gap-1 text-sm font-medium text-slate-700">
              Senior/PWD guests
              <input
                aria-label="Senior/PWD guest count"
                className="h-10 rounded-md border border-slate-300 px-3"
                type="number"
                min={0}
                max={1000}
                value={billOutSeniorPwdCount}
                onChange={(event) => setBillOutSeniorPwdCount(event.target.value)}
              />
            </label>
          </div>
          {billOutPreviewQuery.isLoading && <p className="text-sm text-slate-500">Calculating bill...</p>}
          {billOutPreviewQuery.isError && <p role="alert" className="text-sm text-red-700">Unable to calculate the bill. Check the guest counts and retry.</p>}
          {billOutPreviewQuery.data && (
            <div className="grid gap-2 rounded-md bg-slate-50 p-3 text-sm">
              <TotalLine label="Subtotal" value={billOutPreviewQuery.data.subtotal} />
              <TotalLine
                label={`Senior/PWD discount (${billOutPreviewQuery.data.discounted_guest_count} guests × ${billOutPreviewQuery.data.discount_rate_snapshot * 100}% of ${money(billOutPreviewQuery.data.discount_base_snapshot)} a-la-carte total)`}
                value={-billOutPreviewQuery.data.discount_amount}
              />
              <TotalLine label="Amount due" value={billOutPreviewQuery.data.total} strong />
            </div>
          )}
          <label className="grid gap-1 text-sm font-medium text-slate-700">
            Payment method
            <Select
              value={billOutPaymentMethod}
              onChange={(event) => setBillOutPaymentMethod(event.target.value as typeof billOutPaymentMethod)}
            >
              <option value="cash">Cash</option>
              <option value="gcash">GCash</option>
              <option value="bank_transfer">Bank transfer</option>
            </Select>
          </label>
          {billOutPaymentMethod === "cash" && (
            <label className="grid gap-1 text-sm font-medium text-slate-700">
              Cash received
              <input
                aria-label="Bill-out cash received"
                className="h-10 rounded-md border border-slate-300 px-3"
                type="number"
                min={0}
                step="0.01"
                value={billOutCashReceived}
                onChange={(event) => setBillOutCashReceived(event.target.value)}
              />
            </label>
          )}
          <Button
            disabled={
              billOutMutation.isPending
              || !billOutPreviewQuery.data
              || (billOutPaymentMethod === "cash"
                && Number(billOutCashReceived) < (billOutPreviewQuery.data?.total ?? Number.POSITIVE_INFINITY))
            }
            onClick={() => billOutMutation.mutate()}
          >
            {billOutMutation.isPending ? "Completing bill..." : "Confirm bill out"}
          </Button>
        </div>
      </Dialog>
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

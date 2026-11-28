import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { Banknote, Landmark, LoaderCircle, Printer, Smartphone } from "lucide-react";
import PaymentModal, { SeniorPwdDiscountFields } from "./PaymentModal";
import { PosCartKey, PosProduct, usePosCart } from "./store";
import { api } from "../../../lib/api";
import { defaultSystemSettings, fetchSystemSettings, type SystemSettings } from "../../../lib/systemSettings";
import { useToast } from "../../../hooks/useToast";
import { formatDateTime, shortRef } from "../../../lib/display";
import { getPrintProfile } from "../../../print/printConfig";
import { renderBillSlip, renderPaidReceipt } from "../../../print/receiptTemplates";
import { Button } from "../../../components/ui/button";
import { Dialog } from "../../../components/ui/dialog";
import DiningService, {
  LAST_COMMITTED_ORDER_STORAGE_KEY,
  printDiningOrderSlip,
  type CommittedDiningOrder
} from "./DiningService";
import { printPlainLines, printReceiptDocument } from "./printLayout";
import UnlimitedTimer from "../../../components/pos/UnlimitedTimer";
import PosOrderBuilder from "./PosOrderBuilder";
import PosHeader from "./PosHeader";
import NewCustomerFlowModal, {
  type NewCustomerPickupOrder,
  type NewCustomerReservation,
  type NewCustomerSelection
} from "./NewCustomerFlowModal";
import "./PosPage.css";

type PosTransaction = {
  id: string;
  transaction_number: string;
  customer_name?: string | null;
  transaction_type: string;
  subtotal: number;
  tax: number;
  discount_amount?: number;
  discount_base_snapshot?: number | null;
  discount_rate_snapshot?: number | null;
  guest_count?: number | null;
  discount_guest_count?: number | null;
  total: number;
  payment_method: string;
  cash_received?: number | null;
  change_due?: number | null;
  created_at: string;
  charges?: Array<{
    quantity: number;
    unit_price: number;
    total_price: number;
    name_snapshot: string;
  }>;
  items: Array<{
    quantity: number;
    unit_price: number;
    total_price: number;
    selling_product: {
      name: string;
    };
  }>;
};

type PickupReceiptTransaction = PosTransaction;

type PickupOrder = NewCustomerPickupOrder;

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
  orders: Array<{
    status: string;
    items: Array<{ total_price: number | string }>;
  }>;
  unlimited_sessions: PosUnlimitedSession[];
};

type DiningCheckoutPreview = {
  session_id: string;
  table_number: number;
  guest_count: number;
  a_la_carte_lines: Array<{ name: string; quantity: number; unit_price: number; total_price: number }>;
  unlimited_order_lines: Array<{ name: string; quantity: number; unit_price: number; total_price: number }>;
  unlimited_lines: Array<{ name: string; quantity: number; unit_price: number; total_price: number }>;
  leftover_lines: Array<{ name: string; quantity: number; total: number }>;
  subtotal: number;
  unlimited_amount: number;
  leftover_amount: number;
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

type SelectionView = "menu" | "table-board" | "reservation-list";

function getStoredRole() {
  if (!localStorage.getItem("katana_token")) {
    return "staff";
  }

  return localStorage.getItem("katana_role")?.toLowerCase() ?? "staff";
}

function money(value: number) {
  return `PHP ${value.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function currentCashierName() {
  try {
    const user = JSON.parse(localStorage.getItem("katana_user") ?? "{}") as { name?: unknown };
    return typeof user.name === "string" && user.name.trim() ? user.name.trim() : "Cashier";
  } catch {
    return "Cashier";
  }
}

function sumOrderLines(items: Array<{ total_price: number | string }>) {
  return items.reduce((sum, item) => sum + Number(item.total_price), 0);
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
  const [newCustomerFlowOpen, setNewCustomerFlowOpen] = useState(false);
  const [newCustomerFlowMode, setNewCustomerFlowMode] = useState<"reservation" | "pickup" | null>(null);
  const [currentOrderPath, setCurrentOrderPath] = useState<string[]>([]);
  const [tableBoardPurpose, setTableBoardPurpose] = useState<"walk_in" | "existing_table" | "reservation">("walk_in");
  const [selectedTable, setSelectedTable] = useState<{
    id: string;
    number: number;
    tableIds: string[];
    tableNumbers: number[];
  } | null>(null);
  const [selectedReservation, setSelectedReservation] = useState<{
    id: string;
    name: string;
    time: string;
    partySize: number;
    tableNumbers: number[];
  } | null>(null);
  const [reservationTableSelection, setReservationTableSelection] = useState<
    Array<{ tableId: string; tableNumber: number; capacity: number }>
  >([]);
  const [selectedDiningSessionId, setSelectedDiningSessionId] = useState("");
  const [customerName, setCustomerName] = useState("");
  const [selectedPickupOrder, setSelectedPickupOrder] = useState<PickupOrder | null>(null);
  const [lastPickupReceipt, setLastPickupReceipt] = useState<PickupReceiptTransaction | null>(null);
  const [lastCommittedOrderId, setLastCommittedOrderId] = useState(
    () => localStorage.getItem(LAST_COMMITTED_ORDER_STORAGE_KEY)
  );
  const [paymentOpen, setPaymentOpen] = useState(false);
  const [billOutOpen, setBillOutOpen] = useState(false);
  const [billOutStep, setBillOutStep] = useState<"bill" | "payment">("bill");
  const [billOutGuestCount, setBillOutGuestCount] = useState("1");
  const [billOutSeniorPwdCount, setBillOutSeniorPwdCount] = useState("0");
  const [billOutPaymentMethod, setBillOutPaymentMethod] = useState<"cash" | "gcash" | "bank_transfer">("cash");
  const [billOutCashReceived, setBillOutCashReceived] = useState("");
  const [billOutApplyDiscount, setBillOutApplyDiscount] = useState(false);
  const [billOutMismatchWarning, setBillOutMismatchWarning] = useState("");
  const [orderPrintWarning, setOrderPrintWarning] = useState("");
  const [unlimitedGuestDialogOpen, setUnlimitedGuestDialogOpen] = useState(false);
  const [unlimitedGuestCountInput, setUnlimitedGuestCountInput] = useState("");
  const [unlimitedGuestsConfirmed, setUnlimitedGuestsConfirmed] = useState(false);
  const [pendingUnlimitedProduct, setPendingUnlimitedProduct] = useState<PosProduct | null>(null);
  const [unlimitedGuestCountError, setUnlimitedGuestCountError] = useState("");
  const [extendingUnlimited, setExtendingUnlimited] = useState(false);
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

  const productsQuery = useQuery({
    queryKey: ["products"],
    queryFn: async () => {
      const response = await api.get<{ products: PosProduct[] }>("/api/products");
      return response.data.products;
    },
    refetchInterval: 15_000,
    enabled: allowed
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
  const customerPath = isPickupCustomer
    ? "pickup"
    : customerType === "existing_table"
      ? "existing_table"
      : customerService === "dine_in"
        ? dineInEntryType === "reservation" ? "reservation" : "dine_in_walk_in"
        : "takeout_walk_in";
  const tableSessionToolsId = selectedDiningSessionId || lastCommittedOrderQuery.data?.dining_session_id || "";
  const activeSession = customerType === "existing_table"
    ? diningSessionsQuery.data?.find(
        (session) => session.id === tableSessionToolsId && session.status === "active"
      ) ?? null
    : null;
  const activeUnlimitedSession = activeSession?.unlimited_sessions.find((session) => session.status === "active") ?? null;
  const cartKey: PosCartKey = isDineIn
    ? "dine_in_ala_carte"
    : "takeout";
  const items = carts[cartKey];
  const hasUnlimitedItems = items.some((item) => item.diningOrderType === "unlimited");
  const unlimitedMenuActive = isDineIn && (hasUnlimitedItems || Boolean(activeUnlimitedSession));
  const unlimitedMenuScope = activeUnlimitedSession
    ? `session:${activeUnlimitedSession.id}`
    : hasUnlimitedItems ? `cart:${draftKeys[cartKey]}` : null;
  const selectedReservationSeats = reservationTableSelection.reduce((total, table) => total + table.capacity, 0);
  const reservationTablesReady = reservationTableSelection.length > 0
    && Boolean(selectedReservation)
    && selectedReservationSeats >= (selectedReservation?.partySize ?? 0);
  const takeoutItems = carts.takeout;
  const orderStage = !isDineIn
    ? "order"
    : selectionView === "table-board" || selectionView === "reservation-list"
      ? "table"
      : items.length > 0 && !selectedTable
        ? "table"
        : items.length > 0 && selectedTable
          ? "print"
          : "order";

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
    mutationFn: async (input: {
      paymentMethod: "cash" | "gcash" | "bank_transfer";
      cashReceived?: number;
      applyDiscount: boolean;
      guestCount: number;
      seniorPwdCount: number;
    }) => {
      console.debug("Checkout submit", {
        itemCount: takeoutItems.length,
        hasToken: Boolean(localStorage.getItem("katana_token"))
      });
      const response = await api.post<{ transaction: PosTransaction }>("/api/pos/transaction", {
        customerName,
        transactionType: "takeout",
        paymentMethod: input.paymentMethod,
        cashReceived: input.cashReceived,
        applyDiscount: input.applyDiscount,
        guestCount: input.guestCount,
        seniorPwdCount: input.seniorPwdCount,
        items: takeoutItems.map((item) => ({
          productId: item.product.id,
          quantity: item.quantity,
          unitPrice: Number(item.product.price)
        }))
      });

      return response.data.transaction;
    },
    onSuccess: (transaction) => {
      printReceipt(transaction, systemSettings, (error) => {
        console.error("Takeout receipt printing failed", error);
        toast("Payment completed, but the receipt could not be printed. Check the printer and retry from transaction history.");
      });
      setPaymentOpen(false);
      clearCurrentOrderPath();
      queryClient.invalidateQueries({ queryKey: ["inventory"] });
      queryClient.invalidateQueries({ queryKey: ["products"] });
      queryClient.invalidateQueries({ queryKey: ["pos", "transactions"] });
      toast("Payment completed.");
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

  const endUnlimitedSessionMutation = useMutation({
    mutationFn: async (unlimitedSessionId: string) => {
      const response = await api.post(
        `/api/pos/dining/unlimited-sessions/${unlimitedSessionId}/end`,
        { leftovers: [] }
      );
      return response.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["pos", "dining", "sessions"] });
      queryClient.invalidateQueries({ queryKey: ["pos", "dining", "tables"] });
      queryClient.invalidateQueries({ queryKey: ["pos", "dining", "upcoming-reservations"] });
      toast("Unlimited session ended.");
    },
    onError: (error) => toast(getApiErrorMessage(error, "Unable to end the Unlimited session."))
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
  const billOutHasDiscountableItems = (billOutPreviewQuery.data?.discount_base_snapshot ?? 0) > 0;

  const billOutMutation = useMutation({
    mutationFn: async (input: { billSlipTotal: number }) => {
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
      return { ...response.data, billSlipTotal: input.billSlipTotal };
    },
    onSuccess: ({ transaction, billSlipTotal }) => {
      printReceipt(transaction, systemSettings, (error) => {
        console.error("Bill-out receipt printing failed", error);
        toast("The table bill was completed, but the receipt could not be printed.");
      });
      setBillOutOpen(false);
      setBillOutStep("bill");
      clearCurrentOrderPath();
      setSelectedDiningSessionId("");
      queryClient.invalidateQueries({ queryKey: ["pos", "dining", "sessions"] });
      queryClient.invalidateQueries({ queryKey: ["pos", "dining", "tables"] });
      queryClient.invalidateQueries({ queryKey: ["pos", "dining", "upcoming-reservations"] });
      queryClient.invalidateQueries({ queryKey: ["pos", "transactions"] });
      queryClient.invalidateQueries({ queryKey: ["inventory"] });
      toast("Table bill completed and table released.");
      if (Math.round(Number(transaction.total) * 100) !== Math.round(billSlipTotal * 100)) {
        setBillOutMismatchWarning(
          `Bill slip total ${money(billSlipTotal)} differs from charged total ${money(Number(transaction.total))} on ${shortRef(transaction.transaction_number)}.`
        );
      } else {
        setBillOutMismatchWarning("");
      }
    },
    onError: (error) => {
      toast(getApiErrorMessage(error, "Unable to complete the table bill."));
    }
  });

  const pickupCompletionMutation = useMutation({
    mutationFn: async (input: {
      payment: {
        paymentMethod?: "cash";
        cashReceived?: number;
        applyDiscount?: boolean;
        guestCount?: number;
        seniorPwdCount?: number;
      };
      shouldPrint: boolean;
    }) => {
      if (!selectedPickupOrder) {
        throw new Error("Select a preparing or ready pickup order first.");
      }
      const response = await api.post<{ order: PickupOrder; transaction: PickupReceiptTransaction }>(
        `/api/pos/pickup-orders/${encodeURIComponent(selectedPickupOrder.order_number)}/complete`,
        selectedPickupOrder.payment_status === "paid" ? {} : input.payment
      );
      return { ...response.data, shouldPrint: input.shouldPrint };
    },
    onSuccess: ({ transaction, shouldPrint }) => {
      if (shouldPrint) {
        printReceipt(transaction, systemSettings, (error) => {
          console.error("Pickup receipt printing failed", error);
          toast("Pickup order completed, but the receipt could not be printed. Use Print Receipt to retry.");
        });
        toast("Pickup order completed. Receipt sent to print.");
      } else {
        toast("Pickup order completed. Use Print Receipt to print the receipt.");
      }
      setPaymentOpen(false);
      setSelectedPickupOrder(null);
      setSelectionView("menu");
      setLastPickupReceipt(transaction);
      queryClient.invalidateQueries({ queryKey: ["pos", "pickup-orders"] });
      queryClient.invalidateQueries({ queryKey: ["inventory"] });
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
        | { type: "reservation"; reservationId: string; tableIds: string[] };
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
      return response.data;
    },
    onSuccess: async ({ order }) => {
      localStorage.setItem(LAST_COMMITTED_ORDER_STORAGE_KEY, order.id);
      setLastCommittedOrderId(order.id);
      queryClient.setQueryData(["pos", "dining", "committed-order", order.id], order);
      clearCartFor(cartKey);
      rotateDraftKey(cartKey);
      setSelectedDiningSessionId(order.dining_session_id);
      setSelectedReservation(null);
      setSelectionView("menu");
      setCustomerType("existing_table");
      setCustomerService("dine_in");
      queryClient.invalidateQueries({ queryKey: ["pos", "dining", "tables"] });
      queryClient.invalidateQueries({ queryKey: ["pos", "dining", "sessions"] });
      queryClient.invalidateQueries({ queryKey: ["pos", "dining", "upcoming-reservations"] });
      queryClient.invalidateQueries({ queryKey: ["pos", "kitchen", "orders"] });
      queryClient.invalidateQueries({ queryKey: ["inventory"] });
      queryClient.invalidateQueries({ queryKey: ["products"] });
      let tableTotal: number | null = null;
      try {
        const response = await api.get<{ sessions: PosDiningSession[] }>("/api/pos/dining/sessions");
        const committedSession = response.data.sessions.find((session) => session.id === order.dining_session_id);
        if (committedSession) {
          tableTotal = committedSession.orders
            .filter((savedOrder) => savedOrder.status === "committed")
            .reduce((sum, savedOrder) => sum + sumOrderLines(savedOrder.items), 0);
        }
        queryClient.setQueryData(["pos", "dining", "sessions"], response.data.sessions);
        setOrderPrintWarning("");
      } catch (error) {
        console.error("Unable to load saved table orders for the order slip", error);
        setOrderPrintWarning("The order was saved, but its table total could not be loaded from saved session lines.");
      }
      try {
        const printStarted = printDiningOrderSlip(order, false, {
          cashierName: currentCashierName(),
          orderType: hasUnlimitedItems ? "UNLIMITED" : "A LA CARTE",
          tableTotal,
          paperSize: systemSettings.receipt_paper_size,
          onError: (error) => {
            console.error("Dine-in order printing failed", error);
            toast(`Order ${shortRef(order.order_number)} was saved, but printing failed. Please retry the print.`);
          }
        });
        if (printStarted) toast("Order confirmed and sent to print.");
      } catch (error) {
        console.error("Dine-in order printing failed", error);
        toast(`Order ${shortRef(order.order_number)} was saved, but printing failed. Please retry the print.`);
      }
    },
    onError: (error) => {
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

  function handlePrintTestSlip() {
    const ruler = "12345678901234567890123456789012";
    const edgeLine = `|${"-".repeat(30)}|`;
    try {
      printPlainLines("Printer test slip", [
        "PRINTER TEST SLIP",
        "Paper width: " + systemSettings.receipt_paper_size,
        "Printable area: 48 mm",
        ruler,
        edgeLine,
        edgeLine,
        "",
        "ORDER SLIP - NOT A RECEIPT",
        "Table: 4",
        "Order: DEMO-ORDER-001",
        `Date: ${formatDateTime(new Date("2026-11-25T13:00:00+08:00"))}`,
        "Cashier: Demo Cashier",
        "1 x Sample Roll",
        "Amount: PHP 250.00",
        "This order total: PHP 250.00",
        "Table total so far: PHP 500.00",
        "",
        "BILL SLIP - NOT A RECEIPT",
        "Table: 4",
        "A LA CARTE ITEMS",
        "1 x Sample Roll",
        "A la carte subtotal: PHP 250.00",
        "UNLIMITED PACKAGES",
        "2 heads x PHP 500.00",
        "Unlimited subtotal: PHP 1,000.00",
        "ADD-ONS: PHP 100.00",
        "LEFTOVER FEES: PHP 50.00",
        "Senior/PWD: -PHP 50.00",
        "TOTAL TO PAY: PHP 1,350.00",
        "",
        "SAMPLE SUSHI",
        "RECEIPT",
        "PAID",
        "Receipt no: DEMO-RECEIPT-001",
        `Date: ${formatDateTime(new Date("2026-11-25T13:00:00+08:00"))}`,
        "1 x Sample Roll: PHP 250.00",
        "TOTAL PAID: PHP 250.00",
        "Payment: CASH",
        "Amount received: PHP 300.00",
        "Change: PHP 50.00",
        "Thank you!"
      ], systemSettings.receipt_paper_size, undefined, (error) => {
        console.error("Printer test slip failed", error);
        toast("The printer test slip could not be prepared.");
      });
    } catch (error) {
      console.error("Printer test slip failed", error);
      toast("The printer test slip could not be prepared.");
    }
  }

  function handlePrintBillSlip() {
    const preview = billOutPreviewQuery.data;
    if (!activeSession || !preview || billOutPreviewQuery.isFetching || billOutMutation.isPending) return;

    try {
      const started = printBillSlip(preview, systemSettings.receipt_paper_size, () => {
        setBillOutStep("payment");
      }, (error) => {
        console.error("Bill slip printing failed", error);
        toast("The bill slip could not be printed. Checkout has not started.");
      });
      if (!started) toast("This bill is already being printed.");
    } catch (error) {
      console.error("Bill slip printing failed", error);
      toast("The bill slip could not be printed. Checkout has not started.");
    }
  }

  function handleBillOutConfirm() {
    const preview = billOutPreviewQuery.data;
    if (!activeSession || !preview || billOutStep !== "payment" || billOutMutation.isPending) return;

    billOutMutation.mutate({ billSlipTotal: preview.total });
  }

  function handlePickupCheckout() {
    if (!selectedPickupOrder) return;
    if (selectedPickupOrder.payment_status === "paid") {
      pickupCompletionMutation.mutate({ payment: {}, shouldPrint: true });
      return;
    }
    setPaymentOpen(true);
  }

  async function handleReprintLastOrder() {
    const order = lastCommittedOrderQuery.data;
    if (!order) {
      toast("The saved order is not available to reprint.");
      return;
    }
    let tableTotal: number | null = null;
    try {
      const response = await api.get<{ sessions: PosDiningSession[] }>("/api/pos/dining/sessions");
      const session = response.data.sessions.find((item) => item.id === order.dining_session_id);
      if (session) {
        tableTotal = session.orders
          .filter((savedOrder) => savedOrder.status === "committed")
          .reduce((sum, savedOrder) => sum + sumOrderLines(savedOrder.items), 0);
      }
      queryClient.setQueryData(["pos", "dining", "sessions"], response.data.sessions);
      setOrderPrintWarning("");
    } catch (error) {
      console.error("Unable to load saved table orders for reprint", error);
      setOrderPrintWarning("Reprint is available, but the active table total could not be loaded from saved session lines.");
    }

    try {
      const started = printDiningOrderSlip(order, true, {
        cashierName: currentCashierName(),
        tableTotal,
        paperSize: systemSettings.receipt_paper_size,
        onError: (error) => {
          console.error("Dine-in order reprinting failed", error);
          toast("The order is saved, but printing failed.");
        }
      });
      if (!started) toast("This order is already being printed.");
    } catch (error) {
      console.error("Dine-in order reprinting failed", error);
      toast("The order is saved, but the receipt could not be prepared for printing.");
    }
  }

  function beginDineInWalkIn() {
    chooseCustomerService("dine_in");
    chooseCustomerEntry("walk_in", "dine_in");
    setCurrentOrderPath(["Dine-in", "Walk-in"]);
  }

  function beginTakeoutWalkIn() {
    chooseCustomerService("takeout");
    chooseCustomerEntry("walk_in", "takeout");
    setCurrentOrderPath(["Take-out", "Walk-in"]);
  }

  function beginReservationSelection() {
    setNewCustomerFlowMode("reservation");
    setNewCustomerFlowOpen(true);
  }

  function beginPickupSelection() {
    setNewCustomerFlowMode("pickup");
    setNewCustomerFlowOpen(true);
  }

  function chooseCustomerService(nextService: "dine_in" | "takeout") {
    setCustomerService(nextService);
  }

  function chooseCustomerEntry(entry: "walk_in" | "reservation" | "pickup", service = customerService) {
    setSelectedDiningSessionId("");
    if (service === "dine_in") {
      setCustomerType("new_customer");
      if (entry === "reservation") {
        setDineInEntryType("reservation");
        setTableBoardPurpose("reservation");
        setSelectedTable(null);
        setSelectedReservation(null);
      } else {
        setDineInEntryType("walk_in");
        setTableBoardPurpose("walk_in");
        setSelectedTable(null);
        setSelectedReservation(null);
      }
      setUnlimitedGuestsConfirmed(false);
      setPendingUnlimitedProduct(null);
      setSelectionView("menu");
      return;
    }

    setCustomerType(entry === "pickup" ? "pickup_customer" : "new_customer");
    setSelectedPickupOrder(null);
    setSelectionView("menu");
  }

  function startNewCustomerOrdering(selection: NewCustomerSelection) {
    chooseCustomerService(selection.service);
    chooseCustomerEntry(selection.entry, selection.service);
    setCurrentOrderPath(selection.path);
    if (selection.reservation) {
      selectReservation(selection.reservation);
    }
    if (selection.pickupOrder) {
      selectPickupOrder(selection.pickupOrder);
    }
  }

  function clearCurrentOrderPath() {
    setCustomerType("new_customer");
    setCustomerService("takeout");
    setDineInEntryType("walk_in");
    setSelectionView("menu");
    setTableBoardPurpose("walk_in");
    setSelectedDiningSessionId("");
    setSelectedTable(null);
    setSelectedReservation(null);
    setReservationTableSelection([]);
    setSelectedPickupOrder(null);
    setCurrentOrderPath([]);
    setUnlimitedGuestsConfirmed(false);
    setPendingUnlimitedProduct(null);
    setCustomerName("");
    setDineOrderType("ala_carte");
    setDineHeadcount(1);
    clearCartFor("takeout");
    clearCartFor("dine_in_ala_carte");
    clearCartFor("dine_in_unlimited");
    selectCart("takeout");
  }

  function beginExistingTable() {
    setCurrentOrderPath([]);
    setCustomerType("existing_table");
    setCustomerService("dine_in");
    setTableBoardPurpose("existing_table");
    setSelectedTable(null);
    setSelectedReservation(null);
    setSelectedPickupOrder(null);
    setSelectedDiningSessionId("");
    setUnlimitedGuestsConfirmed(false);
    setPendingUnlimitedProduct(null);
    setSelectionView("table-board");
  }

  function selectTable(selection: { tableId: string; tableNumber: number; sessionId: string | null }) {
    setSelectedTable({
      id: selection.tableId,
      number: selection.tableNumber,
      tableIds: [selection.tableId],
      tableNumbers: [selection.tableNumber]
    });
    setSelectedDiningSessionId(selection.sessionId ?? "");
    setSelectedReservation(null);
    setSelectionView("menu");
  }

  function selectReservation(reservation: { id: string; customer_name: string; time: string; party_size: number; table_numbers: number[] }) {
    setSelectedReservation({
      id: reservation.id,
      name: reservation.customer_name,
      time: reservation.time,
      partySize: reservation.party_size,
      tableNumbers: reservation.table_numbers
    });
    setTableBoardPurpose("reservation");
    setSelectedTable(null);
    setReservationTableSelection([]);
    setSelectedDiningSessionId("");
    setSelectionView("table-board");
  }

  function selectReservationTables(selection: Array<{ tableId: string; tableNumber: number; capacity: number }>) {
    if (selection.length === 0) return;
    setSelectedTable({
      id: selection[0].tableId,
      number: selection[0].tableNumber,
      tableIds: selection.map(({ tableId }) => tableId),
      tableNumbers: selection.map(({ tableNumber }) => tableNumber)
    });
    setSelectedDiningSessionId("");
    setReservationTableSelection(selection);
    setSelectionView("menu");
  }

  function selectPickupOrder(order: PickupOrder) {
    setSelectedPickupOrder(order);
    setSelectionView("menu");
  }

  function selectDineOrderType(nextType: "ala_carte" | "unlimited") {
    if (nextType === "unlimited") {
      setPendingUnlimitedProduct(null);
      setUnlimitedGuestCountInput("");
      setUnlimitedGuestCountError("");
      setUnlimitedGuestDialogOpen(true);
      return;
    }
    setDineOrderType(nextType);
    selectCart("dine_in_ala_carte");
  }

  function addOrderBuilderItem(product: PosProduct, diningOrderType?: "ala_carte" | "unlimited") {
    if (diningOrderType === "unlimited" && !unlimitedGuestsConfirmed) {
      setPendingUnlimitedProduct(product);
      setUnlimitedGuestCountInput("");
      setUnlimitedGuestCountError("");
      setUnlimitedGuestDialogOpen(true);
      return;
    }
    if (diningOrderType) addItemTo(cartKey, product, 1, diningOrderType);
    else addItem(product);
  }

  function confirmUnlimitedGuestCount() {
    const guests = Number(unlimitedGuestCountInput);
    if (!Number.isInteger(guests) || guests < 1 || guests > 100) {
      setUnlimitedGuestCountError("Enter a whole number of guests from 1 to 100.");
      return;
    }
    setDineHeadcount(guests);
    setDineOrderType("unlimited");
    selectCart("dine_in_ala_carte");
    setUnlimitedGuestsConfirmed(true);
    if (pendingUnlimitedProduct) {
      addItemTo(cartKey, pendingUnlimitedProduct, 1, "unlimited");
      setPendingUnlimitedProduct(null);
    }
    setUnlimitedGuestDialogOpen(false);
  }

  function handlePrimaryAction() {
    if (isPickupCustomer) {
      if (selectedPickupOrder) handlePickupCheckout();
      return;
    }
    if (isDineIn) {
      if (!selectedTable) {
        if (selectedReservation) {
          if (reservationTablesReady) {
            selectReservationTables(reservationTableSelection);
          }
          return;
        }
        setSelectionView(selectedReservation
          ? "table-board"
          : dineInEntryType === "reservation" ? "reservation-list" : "table-board");
      } else {
        if (items.length === 0 || dineInConfirmationMutation.isPending) return;
        const selection = selectedReservation
          ? {
              type: "reservation" as const,
              reservationId: selectedReservation.id,
              tableIds: selectedTable?.tableIds ?? []
            }
          : selectedDiningSessionId
            ? { type: "session" as const, sessionId: selectedDiningSessionId }
            : { type: "table" as const, tableId: selectedTable!.id };
        dineInConfirmationMutation.mutate({ selection });
      }
      return;
    }
    handleCheckout();
  }

  const actionLabel = isPickupCustomer
    ? "Checkout"
    : customerType === "existing_table"
      ? "Print order"
      : isDineIn
        ? selectedTable ? "Confirm & Print" : selectedReservation ? "Select table/s" : "Proceed"
        : "Checkout";
  const actionDisabled = isPickupCustomer
    ? !selectedPickupOrder || pickupCompletionMutation.isPending
    : isDineIn
      ? Boolean(selectedReservation) && !selectedTable
        ? !reservationTablesReady
        : (Boolean(selectedTable) && items.length === 0)
          || dineInConfirmationMutation.isPending
          || (hasUnlimitedItems && (
            !Number.isInteger(headcount)
            || headcount < 1
            || headcount > 100
            || !unlimitedGuestsConfirmed
            || unlimitedSettingsQuery.isError
            || !unlimitedSettingsQuery.data
          ))
      : items.length === 0 || checkoutMutation.isPending;

  const selectionContent = selectionView === "table-board" ? (
    <DiningService
      key={`table-board-${tableBoardPurpose}-${selectedReservation?.id ?? ""}`}
      mode="board"
      boardPurpose={tableBoardPurpose}
      selectedReservationId={selectedReservation?.id ?? null}
      reservationPartySize={selectedReservation?.partySize ?? 0}
      embedded
      onBackToBoard={() => {
        if (tableBoardPurpose === "reservation") {
          setSelectedReservation(null);
          setSelectedTable(null);
          setReservationTableSelection([]);
          setSelectionView("reservation-list");
          return;
        }
        if (tableBoardPurpose === "existing_table") {
          setCustomerType("new_customer");
          setCustomerService("takeout");
          setSelectionView("menu");
          return;
        }
        setSelectionView("menu");
      }}
      onTableSelected={selectTable}
      onReservationTableSelectionChange={setReservationTableSelection}
      boardActionLabel={tableBoardPurpose === "reservation" ? actionLabel : undefined}
      boardActionDisabled={actionDisabled}
      onBoardAction={tableBoardPurpose === "reservation" ? handlePrimaryAction : undefined}
    />
  ) : selectionView === "reservation-list" ? (
    <DiningService
      key="reservation-picker"
      mode="reservation-picker"
      embedded
      onBackToBoard={() => setSelectionView("menu")}
      onReservationSelected={selectReservation}
    />
  ) : null;

  if (!allowed) {
    return (
      <main className="flex min-h-screen flex-col items-center justify-center gap-4 px-6 text-center">
        <h1 className="text-2xl font-semibold text-slate-950">POS access required</h1>
        <p className="max-w-md text-slate-600">Sign in with an admin or cashier account to use the POS.</p>
        <Link className="text-red-700 underline" to="/staff/login">
          Sign in
        </Link>
      </main>
    );
  }

  return (
    <main className="pos-page min-h-screen bg-slate-100 px-4 py-4 lg:pr-6">
      <div className="pos-page-content grid w-full gap-4">
        {orderPrintWarning && <p role="alert" className="rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">{orderPrintWarning}</p>}
        {billOutMismatchWarning && <p role="alert" className="rounded-md border border-red-300 bg-red-50 p-3 text-sm font-semibold text-red-900">{billOutMismatchWarning}</p>}
        {lastPickupReceipt && (
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-emerald-200 bg-emerald-50 px-4 py-3">
            <p className="text-sm font-medium text-emerald-900">
              Pickup order {shortRef(lastPickupReceipt.transaction_number)} completed.
            </p>
            <Button
              type="button"
              variant="outline"
              onClick={() => printReceipt(lastPickupReceipt, systemSettings, (error) => {
                console.error("Pickup receipt reprinting failed", error);
                toast("The pickup receipt could not be prepared for printing.");
              })}
            >
              <Printer className="mr-2 h-4 w-4" /> Print Receipt
            </Button>
          </div>
        )}

        <PosOrderBuilder
          customerType={customerType}
          customerPath={customerPath}
          orderStage={orderStage}
          onDineInWalkIn={beginDineInWalkIn}
          onReservation={beginReservationSelection}
          onTakeoutWalkIn={beginTakeoutWalkIn}
          onPickup={beginPickupSelection}
          onExistingTable={beginExistingTable}
          workspaceHeader={<PosHeader onPrintTestSlip={handlePrintTestSlip} />}
          selectionContent={selectionContent}
          actionInSelectionView={selectionView === "table-board"}
          cartSelectionStatus={selectedReservation && !selectedTable ? (
            <div className="rounded-md border border-slate-200 bg-slate-50 p-3 text-sm">
              <p className="font-semibold text-slate-900">{selectedReservation.name}</p>
              <p className="text-slate-600">
                Selected seats: {selectedReservationSeats} / {selectedReservation.partySize}
              </p>
              {reservationTableSelection.length > 0 && (
                <p className="text-slate-600">
                  Selected table{reservationTableSelection.length === 1 ? "" : "s"}: {reservationTableSelection.map(({ tableNumber }) => tableNumber).join(", ")}
                </p>
              )}
            </div>
          ) : null}
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
                  <Button
                    variant="outline"
                    disabled={endUnlimitedSessionMutation.isPending}
                    onClick={() => {
                      if (window.confirm("End the Unlimited session now?")) {
                        endUnlimitedSessionMutation.mutate(activeUnlimitedSession.id);
                      }
                    }}
                  >
                    {endUnlimitedSessionMutation.isPending ? "Ending session..." : "End Session"}
                  </Button>
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
                  setBillOutGuestCount(String(Math.max(
                    activeSession.guests.length,
                    activeUnlimitedSession?.pax_count ?? 0,
                    headcount,
                    1
                  )));
                  setBillOutStep("bill");
                  setBillOutSeniorPwdCount("0");
                  setBillOutCashReceived("");
                  setBillOutApplyDiscount(false);
                  setBillOutOpen(true);
                }}
              >
                Print Bill
              </Button>
              {(carts.dine_in_ala_carte.length > 0 || carts.dine_in_unlimited.length > 0) && (
                <p className="text-xs text-slate-600">Commit or clear the dine-in cart before billing out.</p>
              )}
            </section>
          ) : null}
          selectionSummary={selectedTable
            ? selectedReservation
              ? `${selectedReservation.name} · ${selectedReservation.time} · Table${selectedTable.tableNumbers.length === 1 ? "" : "s"} ${selectedTable.tableNumbers.join(", ")} selected`
              : `Table ${selectedTable.number} selected`
            : selectedReservation
              ? `${selectedReservation.name} · ${selectedReservation.time} · ${selectedReservation.partySize} guests · choose table(s)`
              : null}
          currentOrderPath={currentOrderPath}
          onClearCurrentOrder={clearCurrentOrderPath}
          customerService={customerService}
          cartKey={cartKey}
          orderType={orderType}
          onOrderTypeChange={selectDineOrderType}
          headcount={headcount}
          onHeadcountChange={setDineHeadcount}
          products={productsQuery.data ?? []}
          productsLoading={productsQuery.isLoading}
          productsError={productsQuery.isError}
          items={isPickupCustomer ? [] : items}
          pickupOrder={selectedPickupOrder}
          unlimitedPricePerPerson={unlimitedSettingsQuery.data?.price_per_person ?? null}
          activeUnlimitedPaxCount={activeUnlimitedSession?.pax_count ?? null}
          activeUnlimitedPricePerPerson={activeUnlimitedSession?.price_per_pax ?? null}
          unlimitedMenuActive={unlimitedMenuActive}
          unlimitedMenuScope={unlimitedMenuScope}
          onAddItem={(product, itemOrderType) => {
            if (!isPickupCustomer) addOrderBuilderItem(product, itemOrderType);
          }}
          onRemoveItem={(productId, itemOrderType) => removeItemFrom(cartKey, productId, itemOrderType)}
          onDecrementItem={(productId, itemOrderType) => decrementItemFrom(cartKey, productId, itemOrderType)}
          customerName={customerName}
          onCustomerNameChange={setCustomerName}
          lastCommittedOrderNumber={isPickupCustomer ? null : lastCommittedOrderQuery.data?.order_number}
          onReprintLastOrder={handleReprintLastOrder}
          actionLabel={actionLabel}
          actionDisabled={actionDisabled}
          actionPending={pickupCompletionMutation.isPending || dineInConfirmationMutation.isPending || checkoutMutation.isPending}
          actionSucceeded={pickupCompletionMutation.isSuccess || dineInConfirmationMutation.isSuccess || checkoutMutation.isSuccess}
          onAction={handlePrimaryAction}
        />

      </div>

      <NewCustomerFlowModal
        open={newCustomerFlowOpen}
        initialMode={newCustomerFlowMode}
        onClose={() => setNewCustomerFlowOpen(false)}
        onStartOrdering={startNewCustomerOrdering}
      />
      <Dialog
        open={unlimitedGuestDialogOpen}
        title="Unlimited guest count"
        onClose={() => {
          setUnlimitedGuestDialogOpen(false);
          setPendingUnlimitedProduct(null);
          setUnlimitedGuestCountError("");
        }}
      >
        <form
          className="grid gap-4"
          onSubmit={(event) => {
            event.preventDefault();
            confirmUnlimitedGuestCount();
          }}
        >
          <p className="text-sm text-slate-600">
            Enter the number of guests for the Unlimited package before adding Unlimited items.
          </p>
          <label className="grid gap-1 text-sm font-medium text-slate-700">
            Number of guests
            <input
              autoFocus
              aria-label="Unlimited guest count"
              className="h-11 rounded-md border border-slate-300 px-3"
              type="number"
              min={1}
              max={100}
              step={1}
              required
              value={unlimitedGuestCountInput}
              onChange={(event) => {
                setUnlimitedGuestCountInput(event.target.value);
                setUnlimitedGuestCountError("");
              }}
            />
          </label>
          {unlimitedGuestCountError && <p role="alert" className="text-sm text-red-700">{unlimitedGuestCountError}</p>}
          <div className="flex justify-end gap-2">
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                setUnlimitedGuestDialogOpen(false);
                setPendingUnlimitedProduct(null);
                setUnlimitedGuestCountError("");
              }}
            >
              Cancel
            </Button>
            <Button type="submit">Continue</Button>
          </div>
        </form>
      </Dialog>
      <PaymentModal
        open={paymentOpen}
        pending={isPickupCustomer ? pickupCompletionMutation.isPending : checkoutMutation.isPending}
        total={isPickupCustomer ? selectedPickupOrder?.total ?? 0 : totals.total}
        tableName={activeSession?.table.table_number ? String(activeSession.table.table_number) : null}
        previewRequest={isPickupCustomer && selectedPickupOrder
          ? {
            url: `/api/pos/pickup-orders/${encodeURIComponent(selectedPickupOrder.order_number)}/complete`,
            body: {}
          }
          : {
            url: "/api/pos/transaction",
            body: {
              customerName,
              transactionType: "takeout",
              paymentMethod: "cash",
              items: takeoutItems.map((item) => ({
                productId: item.product.id,
                quantity: item.quantity,
                unitPrice: Number(item.product.price)
              }))
            }
          }}
        onClose={() => setPaymentOpen(false)}
        onConfirm={(payment) => {
          if (isPickupCustomer) {
            if (payment.paymentMethod !== "cash") return;
            pickupCompletionMutation.mutate({
              payment: {
                paymentMethod: "cash",
                cashReceived: payment.cashReceived,
                applyDiscount: payment.applyDiscount,
                guestCount: payment.guestCount,
                seniorPwdCount: payment.seniorPwdCount
              },
              shouldPrint: true
            });
          } else {
            checkoutMutation.mutate(payment);
          }
        }}
      />
      <Dialog
        open={billOutOpen}
        title={`${billOutStep === "bill" ? "Print Bill" : "Checkout"} Table ${activeSession?.table.table_number ?? ""}`}
        onClose={() => {
          setBillOutOpen(false);
          setBillOutStep("bill");
        }}
        panelClassName="max-w-xl"
      >
        <div className="grid gap-4">
          {billOutStep === "bill" && billOutHasDiscountableItems && (
            <SeniorPwdDiscountFields
              applyDiscount={billOutApplyDiscount}
              guestCount={billOutGuestCount}
              seniorPwdCount={billOutSeniorPwdCount}
              onApply={() => setBillOutApplyDiscount(true)}
              onGuestCountChange={setBillOutGuestCount}
              onSeniorPwdCountChange={setBillOutSeniorPwdCount}
              guestCountLabel="Total guests"
              guestCountAriaLabel="Bill-out guest count"
            />
          )}
          {billOutPreviewQuery.isLoading && <p className="text-sm text-slate-500">Calculating bill...</p>}
          {billOutPreviewQuery.isError && <p role="alert" className="text-sm text-red-700">Unable to calculate the bill. Check the guest counts and retry.</p>}
          {billOutPreviewQuery.data && (
            <div className="grid gap-2 rounded-md bg-slate-50 p-3 text-sm">
              <TotalLine label="Subtotal" value={billOutPreviewQuery.data.subtotal} />
              {billOutApplyDiscount && (
                <TotalLine
                  label={`Senior/PWD discount (${billOutPreviewQuery.data.discounted_guest_count} guests × ${billOutPreviewQuery.data.discount_rate_snapshot * 100}% of ${money(billOutPreviewQuery.data.discount_base_snapshot)} a-la-carte total)`}
                  value={-billOutPreviewQuery.data.discount_amount}
                />
              )}
              <TotalLine label="Amount due" value={billOutPreviewQuery.data.total} strong />
            </div>
          )}
          {billOutStep === "payment" && (
            <>
              <div className="grid gap-2">
                <p className="text-sm font-semibold uppercase text-slate-500">Payment method</p>
                <div aria-label="Bill-out payment method" className="grid grid-cols-3 gap-2" role="group">
                  {([
                    ["cash", "Cash", <Banknote key="cash-icon" className="h-5 w-5" />],
                    ["gcash", "GCash", <Smartphone key="gcash-icon" className="h-5 w-5" />],
                    ["bank_transfer", "BPI", <Landmark key="bpi-icon" className="h-5 w-5" />]
                  ] as const).map(([value, label, icon]) => (
                    <button
                      key={value}
                      type="button"
                      aria-pressed={billOutPaymentMethod === value}
                      className={`flex min-h-16 items-center justify-center gap-2 rounded-md border p-3 text-sm font-semibold transition ${
                        billOutPaymentMethod === value
                          ? "border-red-700 bg-red-50 text-red-800"
                          : "border-slate-300 bg-white text-slate-900 hover:bg-slate-50"
                      }`}
                      onClick={() => setBillOutPaymentMethod(value)}
                    >
                      {icon}
                      {label}
                    </button>
                  ))}
                </div>
              </div>
              {billOutPaymentMethod === "cash" && (
                <label className="grid gap-1 text-sm font-medium text-slate-700">
                  Cash received
                  <input
                    aria-label="Bill-out cash received"
                    autoFocus
                    className="h-11 rounded-md border border-slate-300 px-3"
                    type="number"
                    min={billOutPreviewQuery.data?.total ?? 0}
                    step="0.01"
                    value={billOutCashReceived}
                    onChange={(event) => setBillOutCashReceived(event.target.value)}
                    onKeyDown={(event) => {
                      if (
                        event.key === "Enter"
                        && billOutStep === "payment"
                        && !billOutMutation.isPending
                        && billOutPreviewQuery.data
                        && Number(billOutCashReceived) >= billOutPreviewQuery.data.total
                      ) {
                        event.preventDefault();
                        handleBillOutConfirm();
                      }
                    }}
                  />
                  <span className="flex flex-wrap gap-2" role="group" aria-label="Quick cash amounts">
                    {([
                      ["Exact", billOutPreviewQuery.data?.total ?? 0],
                      ["PHP 100", 100],
                      ["PHP 500", 500],
                      ["PHP 1,000", 1000]
                    ] as const)
                      .filter((option, index, options) =>
                        options.findIndex((candidate) => candidate[1] === option[1]) === index
                      )
                      .map(([label, amount]) => (
                      <Button
                        key={label}
                        className="min-h-11"
                        type="button"
                        variant="outline"
                        disabled={amount < (billOutPreviewQuery.data?.total ?? Number.POSITIVE_INFINITY)}
                        onClick={() => setBillOutCashReceived(amount.toFixed(2))}
                      >
                        {label}
                      </Button>
                    ))}
                  </span>
                  {billOutPreviewQuery.data && (
                    <span className="text-sm font-semibold text-slate-700">
                      Change: {money(Math.max(
                        Number(billOutCashReceived) - billOutPreviewQuery.data.total,
                        0
                      ))}
                    </span>
                  )}
                </label>
              )}
            </>
          )}
          {billOutStep === "payment" && (
            <p className="text-sm text-slate-600">The unpaid bill has been printed. Complete payment to print the paid receipt.</p>
          )}
          <Button
            className="pos-primary-action"
            disabled={billOutStep === "bill"
              ? !billOutPreviewQuery.data || billOutPreviewQuery.isFetching
              : billOutMutation.isPending
                || !billOutPreviewQuery.data
                || (billOutPaymentMethod === "cash"
                  && Number(billOutCashReceived) < (billOutPreviewQuery.data?.total ?? Number.POSITIVE_INFINITY))}
            onClick={billOutStep === "bill" ? handlePrintBillSlip : handleBillOutConfirm}
          >
            {billOutStep === "bill"
              ? "Print Bill"
              : billOutMutation.isPending
                ? <><LoaderCircle className="pos-action-spinner mr-2 inline h-4 w-4" aria-hidden="true" />Completing payment...</>
                : "Complete Payment"}
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

function printBillSlip(
  preview: DiningCheckoutPreview,
  paperSize: string,
  afterPrint: () => void,
  onError: (error: unknown) => void
) {
  return printReceiptDocument({
    key: `bill:${preview.session_id}`,
    title: `Bill slip, table ${preview.table_number}`,
    content: renderBillSlip(preview, { profile: getPrintProfile(paperSize) }),
    paperSize,
    onAfterPrint: afterPrint,
    onError
  });
}

function printReceipt(
  transaction: PosTransaction,
  settings: SystemSettings,
  onError: (error: unknown) => void
) {
  try {
    const profile = getPrintProfile(settings.receipt_paper_size);
    return printReceiptDocument({
      key: `paid:${transaction.transaction_number}`,
      title: `Receipt ${transaction.transaction_number}`,
      content: renderPaidReceipt(transaction, { footer: settings.receipt_footer, profile }),
      paperSize: settings.receipt_paper_size,
      onError
    });
  } catch (error) {
    onError(error);
    return false;
  }
}

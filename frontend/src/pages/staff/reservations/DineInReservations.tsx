import { useEffect, useMemo, useRef, useState } from "react";
import { Fragment } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useSearchParams } from "react-router-dom";
import { CalendarDays, Clock3, ImageIcon, List, RefreshCw, Search, WalletCards, X } from "lucide-react";
import { Dialog } from "../../../components/ui/dialog";
import { BookingDetailsDrawer } from "../../../components/ui/BookingDetailsDrawer";
import { ReservationDetailsModal } from "../../../components/ui/ReservationDetailsModal";
import type { ReservationReceiptData } from "../../../components/ui/ReservationReceipt";
import { MiniCalendar } from "../../../components/ui/MiniCalendar";
import { Button } from "../../../components/ui/button";
import { api } from "../../../lib/api";
import { getApiErrorMessage } from "../../../lib/errors";
import { formatManilaDate, formatManilaDateTime, formatTime12, manilaDateKey, todayManilaDateKey } from "../../../lib/dateTime";
import "../../../styles/staff-redesign.css";

type ReservationView = "tables" | "catering" | "pickup";

type StaffReservation = {
  id: string;
  type: "dine_in" | "catering";
  reference: string;
  customer_name: string;
  date: string;
  time: string;
  guests: number;
  status: string;
  late_alert?: boolean;
  reservation_type?: string;
  table_numbers: number[];
  package_name?: string | null;
};

type PickupOrder = {
  order_number: string;
  status: "pending_payment" | "payment_failed" | "pending_approval" | "confirmed" | "preparing" | "ready" | "released" | "completed" | "declined" | "cancelled" | "expired";
  payment_plan: "pay_now" | "pay_at_pickup";
  payment_status: string;
  payment_method: string | null;
  customer_name: string;
  created_at: string;
  ready_at: string | null;
  total: number;
  items: Array<{ name: string; quantity: number; total_price: number }>;
};

type CateringPaymentRecord = {
  id: string;
  reservation_id: string;
  customer_name: string;
  customer_phone?: string | null;
  customer_email?: string | null;
  confirmed_date: string;
  event_time?: string | null;
  package_total?: number;
  mobilization_fee?: number;
  total_price: number;
  payment_plan?: string;
  downpayment_amount?: number;
  downpayment_status?: string;
  remaining_balance?: number;
  final_payment_status?: string;
  payment_status?: string;
  status: string;
  headcount: number;
  payment_history?: Array<{ id: string; payment_stage: string; method: string; amount: number; reference_number?: string | null }>;
  inquiry?: {
    venue_type?: string | null;
    event_type?: string | null;
    event_type_other?: string | null;
    message?: string | null;
  } | null;
  package?: { name?: string | null } | null;
  package_snapshot?: unknown;
  created_at?: string;
};

type ReservationDrawer =
  | { type: "table"; item: StaffReservation }
  | { type: "catering"; item: StaffReservation }
  | { type: "pickup"; item: PickupOrder };

const activeReservationStatuses = new Set([
  "pending",
  "pending_approval",
  "confirmed",
  "approved",
  "seated",
  "preparing",
  "in_progress",
  "pending_final_payment"
]);
const activePickupStatuses = new Set(["pending_payment", "payment_failed", "pending_approval", "confirmed", "preparing", "ready"]);
const allViews: Array<{ id: ReservationView; label: string }> = [
  { id: "tables", label: "Tables" },
  { id: "catering", label: "Catering" },
  { id: "pickup", label: "Pickup" }
];

function getPermittedViews(role: string) {
  if (role === "admin") return allViews;
  if (role === "receptionist") return allViews.filter(({ id }) => id === "tables" || id === "pickup");
  if (role === "event_coordinator") return allViews.filter(({ id }) => id === "catering");
  if (role === "cashier") return allViews.filter(({ id }) => id === "tables" || id === "pickup");
  if (role === "chef") return allViews.filter(({ id }) => id === "pickup");
  return [];
}

function formatStatus(status: string) {
  return status.replace(/_/g, " ");
}

function formatMoney(value: number) {
  return new Intl.NumberFormat("en-PH", { style: "currency", currency: "PHP" }).format(value);
}

function parseReservationDateTime(value: string | null | undefined) {
  if (!value || !value.trim()) {
    return { dateKey: "no-date", timeLabel: "—", shortDateLabel: "No date", timestamp: null };
  }

  const trimmed = value.trim();
  let parsed: Date | null = null;

  if (!Number.isNaN(Date.parse(trimmed))) {
    parsed = new Date(trimmed);
  }

  if (!parsed) {
    const match = trimmed.match(/^([A-Za-z]{3})\s+(\d{1,2}),\s*(\d{4}),\s*(\d{1,2}:\d{2}\s?[AP]M)$/i);
    if (match) {
      const monthMap: Record<string, number> = {
        Jan: 0, Feb: 1, Mar: 2, Apr: 3, May: 4, Jun: 5,
        Jul: 6, Aug: 7, Sep: 8, Oct: 9, Nov: 10, Dec: 11
      };
      const month = monthMap[match[1].charAt(0).toUpperCase() + match[1].slice(1).toLowerCase()];
      const day = Number(match[2]);
      const year = Number(match[3]);
      const timeText = match[4].trim();
      const [timePart, meridiem] = timeText.match(/^(\d{1,2}:\d{2})\s?([AP]M)$/i)?.slice(1) ?? ["12:00", "AM"];
      const [hoursText, minutesText] = timePart.split(":");
      let hours = Number(hoursText);
      if (meridiem.toUpperCase() === "PM" && hours < 12) hours += 12;
      if (meridiem.toUpperCase() === "AM" && hours === 12) hours = 0;
      const isoValue = `${year}-${String(month + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}T${String(hours).padStart(2, "0")}:${minutesText}:00+08:00`;
      parsed = new Date(isoValue);
    }
  }

  if (!parsed || Number.isNaN(parsed.getTime())) {
    return { dateKey: "no-date", timeLabel: "—", shortDateLabel: "No date", timestamp: null };
  }

  const manilaFormatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Manila",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  });
  const timeFormatter = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Manila",
    hour: "numeric",
    minute: "2-digit"
  });
  const shortDateFormatter = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Manila",
    weekday: "short",
    month: "short",
    day: "numeric"
  });

  const dateParts = manilaFormatter.formatToParts(parsed);
  const year = dateParts.find((part) => part.type === "year")?.value ?? "0000";
  const month = dateParts.find((part) => part.type === "month")?.value ?? "01";
  const day = dateParts.find((part) => part.type === "day")?.value ?? "01";

  return {
    dateKey: `${year}-${month}-${day}`,
    timeLabel: timeFormatter.format(parsed),
    shortDateLabel: shortDateFormatter.format(parsed),
    timestamp: parsed.getTime()
  };
}

function getDateGroupLabel(dateValue: string | Date | null | undefined) {
  if (!dateValue) {
    return "NO DATE";
  }

  const input = typeof dateValue === "string" ? dateValue.trim() : dateValue;
  if (!input) {
    return "NO DATE";
  }

  const rawDate = /^\d{4}-\d{2}-\d{2}$/.test(String(input))
    ? new Date(`${input}T00:00:00+08:00`)
    : new Date(input);

  if (!rawDate || Number.isNaN(rawDate.getTime())) {
    return "NO DATE";
  }

  const dateKey = manilaDateKey(rawDate);
  const normalized = new Date(`${dateKey}T00:00:00+08:00`);
  const today = new Date(`${todayManilaDateKey()}T00:00:00+08:00`);
  const dayDiff = Math.round((normalized.getTime() - today.getTime()) / 86400000);

  if (dayDiff === 0) {
    return `TODAY · ${normalized.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", timeZone: "Asia/Manila" }).toUpperCase()}`;
  }

  if (dayDiff === 1) {
    return `TOMORROW · ${normalized.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", timeZone: "Asia/Manila" }).toUpperCase()}`;
  }

  return normalized.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", timeZone: "Asia/Manila" }).toUpperCase();
}

function getStatusPillClass(status: string) {
  const value = status.toLowerCase();

  if (["pending", "pending_approval"].includes(value)) {
    return "bg-[#fff0d9] text-[#8a5200]";
  }

  if (["confirmed", "approved", "seated"].includes(value)) {
    return "bg-[#e3f1ea] text-[#1f6b49]";
  }

  if (["declined", "cancelled", "rejected"].includes(value)) {
    return "bg-[#fbe3e1] text-[#a82e27]";
  }

  return "bg-[#ecebf1] text-[#7b6f72]";
}

export default function DineInReservations() {
  const [searchParams, setSearchParams] = useSearchParams();
  const role = localStorage.getItem("katana_role")?.toLowerCase() ?? "";
  const permittedViews = getPermittedViews(role);
  const requestedView = searchParams.get("view");
  const currentView = permittedViews.some(({ id }) => id === requestedView)
    ? requestedView as ReservationView
    : permittedViews[0]?.id ?? "tables";
  const [calendarOpen, setCalendarOpen] = useState(false);
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const [calendarMonth, setCalendarMonth] = useState(() => new Date(`${todayManilaDateKey()}T00:00:00+08:00`));
  const [readyNotice, setReadyNotice] = useState("");
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<"all" | "needs_approval" | "confirmed" | "completed">("all");
  const [dateFilter, setDateFilter] = useState<"any" | "today" | "tomorrow" | "next7">("any");
  const [calendarMode, setCalendarMode] = useState<"list" | "calendar">("list");
  const [drawer, setDrawer] = useState<ReservationDrawer | null>(null);
  const [paymentReservation, setPaymentReservation] = useState<StaffReservation | null>(null);
  const [paymentReservationData, setPaymentReservationData] = useState<ReservationReceiptData | null>(null);
  const [cateringActionLoading, setCateringActionLoading] = useState(false);
  const previousPickupStatuses = useRef<Map<string, PickupOrder["status"]> | null>(null);
  const queryClient = useQueryClient();
  const canUpdatePickup = ["admin", "cashier", "chef"].includes(role);

  const reservationsQuery = useQuery<StaffReservation[]>({
    queryKey: ["staff-reservations-all"],
    queryFn: async () => {
      const response = await api.get<{ reservations: StaffReservation[] }>("/api/staff/reservations/overview");
      return response.data.reservations;
    },
    refetchInterval: 60_000
  });
  const pickupQuery = useQuery<PickupOrder[]>({
    queryKey: ["staff-reservation-pickup-orders"],
    queryFn: async () => {
      const response = await api.get<{ orders: PickupOrder[] }>("/api/staff/reservations/overview/pickup");
      return response.data.orders;
    },
    enabled: currentView === "pickup",
    refetchInterval: 15_000
  });
  const pickupStatusMutation = useMutation({
    mutationFn: async (input: { order: PickupOrder; status: "preparing" | "ready" | "declined" }) => {
      await api.patch(`/api/admin/takeout/orders/${encodeURIComponent(input.order.order_number)}/status`, {
        status: input.status
      });
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["staff-reservation-pickup-orders"] });
    }
  });

  const upcomingReservations = useMemo(() => {
    const today = todayManilaDateKey();
    return (reservationsQuery.data ?? [])
      .filter((reservation) =>
        activeReservationStatuses.has(reservation.status) &&
        manilaDateKey(reservation.date) >= today
      )
      .sort((first, second) =>
        manilaDateKey(first.date).localeCompare(manilaDateKey(second.date)) ||
        first.time.localeCompare(second.time) ||
        first.reference.localeCompare(second.reference)
      );
  }, [reservationsQuery.data]);
  const tableReservations = upcomingReservations.filter((reservation) => reservation.type === "dine_in");
  const cateringReservations = upcomingReservations.filter((reservation) => reservation.type === "catering");
  const pickupOrders = (pickupQuery.data ?? [])
    .filter((order) => activePickupStatuses.has(order.status))
    .sort((first, second) => {
      const firstParsed = parseReservationDateTime(first.created_at);
      const secondParsed = parseReservationDateTime(second.created_at);
      const firstSortKey = firstParsed.dateKey === "no-date" ? "9999-12-31" : firstParsed.dateKey;
      const secondSortKey = secondParsed.dateKey === "no-date" ? "9999-12-31" : secondParsed.dateKey;
      return firstSortKey.localeCompare(secondSortKey)
        || ((firstParsed.timestamp ?? Number.MAX_SAFE_INTEGER) - (secondParsed.timestamp ?? Number.MAX_SAFE_INTEGER))
        || first.order_number.localeCompare(second.order_number);
    });
  useEffect(() => {
    if (!pickupQuery.data) return;
    const previous = previousPickupStatuses.current;
    if (previous) {
      const newlyReady = pickupQuery.data
        .filter((order) => order.status === "ready" && previous.get(order.order_number) !== "ready")
        .map((order) => order.order_number);
      if (newlyReady.length > 0) {
        setReadyNotice(`${newlyReady.join(", ")} ${newlyReady.length === 1 ? "is" : "are"} ready for pickup.`);
      }
    }
    previousPickupStatuses.current = new Map(pickupQuery.data.map((order) => [order.order_number, order.status]));
  }, [pickupQuery.data]);

  const eventsByDate = useMemo(() => {
    const events = new Map<string, number>();
    if (currentView === "tables") {
      tableReservations.forEach((reservation) => {
        const date = manilaDateKey(reservation.date);
        events.set(date, (events.get(date) ?? 0) + 1);
      });
    } else if (currentView === "catering") {
      cateringReservations.forEach((reservation) => {
        const date = manilaDateKey(reservation.date);
        events.set(date, (events.get(date) ?? 0) + 1);
      });
    } else {
      pickupOrders.forEach((order) => {
        const date = parseReservationDateTime(order.created_at).dateKey;
        if (date === "no-date") return;
        events.set(date, (events.get(date) ?? 0) + 1);
      });
    }
    return events;
  }, [currentView, tableReservations, cateringReservations, pickupOrders]);

  const todayKey = todayManilaDateKey();
  const tomorrowKey = manilaDateKey(new Date(new Date(`${todayKey}T00:00:00+08:00`).getTime() + 86400000));
  function matchesFilters(name: string, reference: string, status: string, date: string) {
    const normalized = search.trim().toLowerCase();
    const parsedDate = parseReservationDateTime(date);
    const day = parsedDate.dateKey === "no-date" ? "no-date" : parsedDate.dateKey;
    const matchesSearch = !normalized || `${name} ${reference}`.toLowerCase().includes(normalized);
    const matchesStatus = statusFilter === "all"
      || (statusFilter === "needs_approval" && ["pending", "pending_approval"].includes(status))
      || (statusFilter === "confirmed" && ["confirmed", "approved", "seated", "preparing", "in_progress"].includes(status))
      || (statusFilter === "completed" && ["completed", "released"].includes(status));
    const matchesDate = dateFilter === "any"
      || (dateFilter === "today" && day === todayKey)
      || (dateFilter === "tomorrow" && day === tomorrowKey)
      || (dateFilter === "next7" && day !== "no-date" && day >= todayKey && day <= manilaDateKey(new Date(new Date(`${todayKey}T00:00:00+08:00`).getTime() + 6 * 86400000)));
    return matchesSearch && matchesStatus && matchesDate && (!selectedDate || day === selectedDate);
  }
  const filteredTableReservations = tableReservations.filter((reservation) =>
    matchesFilters(reservation.customer_name, reservation.reference, reservation.status, reservation.date)
  );
  const filteredCateringReservations = cateringReservations.filter((reservation) =>
    matchesFilters(reservation.customer_name, reservation.reference, reservation.status, reservation.date)
  );
  const filteredPickupOrders = pickupOrders.filter((order) =>
    matchesFilters(order.customer_name, order.order_number, order.status, order.created_at)
  );

  function selectView(view: ReservationView) {
    setSearchParams(view === "tables" ? {} : { view }, { replace: true });
    setSelectedDate(null);
  }

  function selectCalendarDate(date: string) {
    setSelectedDate(date);
    setCalendarMode("list");
    setCalendarOpen(false);
  }

  function clearFilters() {
    setSearch("");
    setStatusFilter("all");
    setDateFilter("any");
    setSelectedDate(null);
  }

  function updatePickup(order: PickupOrder, status: "preparing" | "ready" | "declined") {
    pickupStatusMutation.mutate({ order, status });
  }

  async function updateCatering(status: "approve" | "decline" | "start-event" | "no-show" | "complete" | "cancel") {
    if (drawer?.type !== "catering") return;
    const reservation = drawer.item;
    let payload: Record<string, string | number> | undefined;
    if (status === "approve") {
      const input = window.prompt("Mobilization fee", "0");
      if (input === null) return;
      const fee = Number(input);
      if (!Number.isFinite(fee) || fee < 0) return;
      payload = { mobilization_fee: fee };
    } else if (status === "decline" || status === "no-show" || status === "cancel") {
      const reason = window.prompt(status === "decline" ? "Why is this request being declined?" : "Reason");
      if (!reason?.trim()) return;
      payload = { reason: reason.trim() };
    }

    setCateringActionLoading(true);
    try {
      await api.put(`/api/staff/catering/reservations/${reservation.id}/${status}`, payload);
      await reservationsQuery.refetch();
      setDrawer(null);
    } catch (error) {
      window.alert(getApiErrorMessage(error, "Unable to update the catering booking."));
    } finally {
      setCateringActionLoading(false);
    }
  }

  async function openCateringPayment(reservation: StaffReservation) {
    try {
      const response = await api.get<{ reservations: CateringPaymentRecord[] }>("/api/staff/catering/reservations");
      const record = response.data.reservations.find((item) => item.id === reservation.id);
      if (!record) throw new Error("The catering booking details could not be loaded.");
      setPaymentReservation(reservation);
      setPaymentReservationData({
        id: record.id,
        type: "catering",
        reference: record.reservation_id,
        reservation_id: record.reservation_id,
        booking_id: record.reservation_id,
        customer_name: record.customer_name,
        phone: record.customer_phone,
        email: record.customer_email,
        date: record.confirmed_date,
        event_date: record.confirmed_date,
        time: record.event_time ?? undefined,
        event_time: record.event_time,
        guests: record.headcount,
        headcount: record.headcount,
        total_price: record.total_price,
        package_total: record.package_total,
        mobilization_fee: record.mobilization_fee,
        status: record.status,
        payment_plan: record.payment_plan,
        downpayment_amount: record.downpayment_amount,
        downpayment_status: record.downpayment_status,
        remaining_balance: record.remaining_balance,
        payment_status: record.payment_status ?? record.final_payment_status,
        final_payment_status: record.final_payment_status,
        payment_history: record.payment_history ?? [],
        package_name: record.package?.name ?? null,
        package_snapshot: record.package_snapshot,
        special_requests: record.inquiry?.message ?? null,
        event_type: record.inquiry?.event_type ?? null,
        event_type_other: record.inquiry?.event_type_other ?? null,
        venue_type: record.inquiry?.venue_type ?? null,
        venue_address: record.inquiry?.venue_type ?? null,
        created_at: record.created_at,
        package_items: record.package_snapshot,
        activity: [],
        net_paid: record.total_price - (record.remaining_balance ?? 0)
      });
      setDrawer(null);
    } catch (error) {
      window.alert(getApiErrorMessage(error, "Unable to load payment details."));
    }
  }

  function normalizeStatus(status: string | null | undefined) {
    return (status ?? "").trim().toLowerCase();
  }

  function canPerformCateringAction(status: string | null | undefined, action: "approve" | "decline" | "start-event" | "no-show" | "complete" | "cancel") {
    const normalized = normalizeStatus(status);
    switch (action) {
      case "approve":
      case "decline":
        return ["pending", "pending_approval"].includes(normalized);
      case "start-event":
      case "no-show":
        return ["confirmed", "approved"].includes(normalized);
      case "complete":
        return ["in_progress", "preparing", "pending_final_payment"].includes(normalized);
      case "cancel":
        return ["pending", "pending_approval", "confirmed", "approved", "in_progress", "preparing", "pending_final_payment"].includes(normalized);
      default:
        return false;
    }
  }

  async function runCateringAction(
    action: "approve" | "decline" | "start-event" | "no-show" | "complete" | "cancel",
    request: () => Promise<unknown>,
    successMessage: string,
    failureMessage: string
  ) {
    if (!paymentReservationData) return;

    if (!canPerformCateringAction(paymentReservationData.status, action)) {
      console.warn(`Frontend status gate rejected action ${action} for status ${paymentReservationData.status}. Proceeding with server validation.`);
    }

    try {
      await request();
      console.log("SUCCESS TRIGGERED", { action, reservationId: paymentReservationData.id });
      await reservationsQuery.refetch();
      setDrawer(null);
      setPaymentReservation(null);
      setPaymentReservationData(null);
      console.log("CLOSING DRAWER", { action, reservationId: paymentReservationData.id });
      window.alert(successMessage);
    } catch (error) {
      const backendMessage = getApiErrorMessage(error, failureMessage);
      window.alert(backendMessage);
      console.error("Catering action failed", { action, reservationId: paymentReservationData.id, error });
    }
  }

  const cateringModalActions: Array<{ label: string; onClick: () => void; variant?: "default" | "outline" | "danger"; disabled?: boolean }> = paymentReservationData ? [
    ...(["pending", "pending_approval"].includes(normalizeStatus(paymentReservationData.status)) ? [
      {
        label: "Approve event",
        onClick: () => {
          const fee = window.prompt("Mobilization fee", "0");
          if (fee === null) return;
          const value = Number(fee);
          if (!Number.isFinite(value) || value < 0) {
            window.alert("Enter a valid mobilization fee.");
            return;
          }
          void runCateringAction(
            "approve",
            async () => {
              await api.put(`/api/staff/catering/reservations/${paymentReservationData.id}/approve`, {
                mobilization_fee: value,
                mobilizationFee: value,
                amount: value
              });
              const refreshed = (await api.get<{ reservations: CateringPaymentRecord[] }>("/api/staff/catering/reservations")).data.reservations.find((item) => item.id === paymentReservationData.id);
              if (refreshed) {
                setPaymentReservationData({
                  ...paymentReservationData,
                  id: refreshed.id,
                  reference: refreshed.reservation_id,
                  reservation_id: refreshed.reservation_id,
                  booking_id: refreshed.reservation_id,
                  customer_name: refreshed.customer_name,
                  phone: refreshed.customer_phone,
                  email: refreshed.customer_email,
                  date: refreshed.confirmed_date,
                  event_date: refreshed.confirmed_date,
                  time: refreshed.event_time ?? undefined,
                  event_time: refreshed.event_time,
                  guests: refreshed.headcount,
                  headcount: refreshed.headcount,
                  total_price: refreshed.total_price,
                  package_total: refreshed.package_total,
                  mobilization_fee: refreshed.mobilization_fee,
                  status: refreshed.status,
                  payment_plan: refreshed.payment_plan,
                  downpayment_amount: refreshed.downpayment_amount,
                  downpayment_status: refreshed.downpayment_status,
                  remaining_balance: refreshed.remaining_balance,
                  payment_status: refreshed.payment_status ?? refreshed.final_payment_status,
                  final_payment_status: refreshed.final_payment_status,
                  payment_history: refreshed.payment_history ?? [],
                  package_name: refreshed.package?.name ?? null,
                  package_snapshot: refreshed.package_snapshot,
                  special_requests: refreshed.inquiry?.message ?? null,
                  event_type: refreshed.inquiry?.event_type ?? null,
                  event_type_other: refreshed.inquiry?.event_type_other ?? null,
                  venue_type: refreshed.inquiry?.venue_type ?? null,
                  venue_address: refreshed.inquiry?.venue_type ?? null,
                  created_at: refreshed.created_at,
                  package_items: refreshed.package_snapshot,
                  net_paid: refreshed.total_price - (refreshed.remaining_balance ?? 0)
                });
              }
            },
            "Catering booking approved successfully.",
            "Unable to approve this catering booking. Please try again."
          );
        },
        variant: "default" as const
      },
      {
        label: "Decline request",
        onClick: () => {
          const reason = window.prompt("Why is this catering request being declined?");
          if (!reason?.trim()) return;
          void runCateringAction(
            "decline",
            async () => api.put(`/api/staff/catering/reservations/${paymentReservationData.id}/decline`, { reason: reason.trim() }),
            "Catering request declined successfully.",
            "Unable to decline this catering request. Please try again."
          );
        },
        variant: "outline" as const
      }
    ] : []),
    ...(["confirmed", "approved"].includes(normalizeStatus(paymentReservationData.status)) ? [
      {
        label: "Start event",
        onClick: () => {
          void runCateringAction(
            "start-event",
            async () => api.put(`/api/staff/catering/reservations/${paymentReservationData.id}/start-event`),
            "Catering event started successfully.",
            "Unable to start catering preparation. Please try again."
          );
        },
        variant: "outline" as const
      },
      {
        label: "Mark no-show",
        onClick: () => {
          const reason = window.prompt("Enter the reason for marking this catering booking as a no-show.");
          if (!reason?.trim()) return;
          void runCateringAction(
            "no-show",
            async () => api.put(`/api/staff/catering/reservations/${paymentReservationData.id}/no-show`, { reason: reason.trim() }),
            "Catering booking marked as no-show.",
            "Unable to mark the catering reservation as a no-show. Please try again."
          );
        },
        variant: "danger" as const
      }
    ] : []),
    ...(["in_progress", "preparing", "pending_final_payment"].includes(normalizeStatus(paymentReservationData.status)) ? [
      {
        label: "Complete event",
        onClick: () => {
          const reason = window.prompt("Enter a completion note (optional)");
          void runCateringAction(
            "complete",
            async () => api.put(`/api/staff/catering/reservations/${paymentReservationData.id}/complete`, reason && reason.trim() ? { reason: reason.trim() } : undefined),
            "Catering event marked as completed.",
            "Unable to complete the catering event. Please try again."
          );
        },
        variant: "danger" as const
      }
    ] : []),
    ...(["pending", "pending_approval", "confirmed", "approved", "in_progress", "preparing", "pending_final_payment"].includes(normalizeStatus(paymentReservationData.status)) ? [
      {
        label: "Cancel event",
        onClick: () => {
          const reason = window.prompt("Why is this event being cancelled?");
          if (!reason?.trim()) return;
          void runCateringAction(
            "cancel",
            async () => api.put(`/api/staff/catering/reservations/${paymentReservationData.id}/cancel`, { reason: reason.trim() }),
            "Catering reservation cancelled successfully.",
            "Unable to cancel the catering reservation. Please try again."
          );
        },
        variant: "danger" as const
      }
    ] : [])
  ] : [];

  return (
    <main className="staff-reservations-page min-h-screen p-4 sm:p-6 lg:p-8">
      <section className="w-full px-0">
        <header className="mb-4 flex flex-wrap items-center justify-between gap-4 rounded-xl border border-slate-200 bg-white px-5 py-4 shadow-sm">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-red-700">Reservations</p>
            <h1 className="mt-1 text-2xl font-black text-slate-950">Upcoming {currentView}</h1>
          </div>
          <div className="flex flex-wrap items-center justify-end gap-2">
            <label className="relative">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" aria-hidden="true" />
              <input aria-label="Search reservations" className="h-10 w-56 rounded-md border border-slate-300 pl-9 pr-3 text-sm outline-none focus:border-red-700 focus:ring-2 focus:ring-red-100" placeholder="Search customer or reference" value={search} onChange={(event) => setSearch(event.target.value)} />
            </label>
            <div className="flex rounded-[9px] bg-[#ecebf1] p-1" aria-label="Reservation view mode">
              <button type="button" className={`rounded-[7px] px-3 py-1.5 text-sm font-semibold transition ${calendarMode === "list" ? "bg-white text-[#1c1214] shadow-[0_1px_3px_rgba(0,0,0,0.13)]" : "text-slate-500"}`} aria-pressed={calendarMode === "list"} onClick={() => setCalendarMode("list")}><List className="mr-1 inline h-4 w-4" />List</button>
              <button type="button" className={`rounded-[7px] px-3 py-1.5 text-sm font-semibold transition ${calendarMode === "calendar" ? "bg-white text-[#1c1214] shadow-[0_1px_3px_rgba(0,0,0,0.13)]" : "text-slate-500"}`} aria-pressed={calendarMode === "calendar"} onClick={() => { setCalendarMode("calendar"); setCalendarOpen(true); }}><CalendarDays className="mr-1 inline h-4 w-4" />Calendar</button>
            </div>
            <Button type="button" variant="outline" aria-label="Refresh" className="w-11 !px-0" onClick={() => void (currentView === "pickup" ? pickupQuery.refetch() : reservationsQuery.refetch())}><RefreshCw className="h-4 w-4" /></Button>
            {role === "admin" && <Link to="/staff/catering/photos"><Button type="button" variant="outline"><ImageIcon className="mr-2 h-4 w-4 text-[#9b1d20]" />Catering menu photos</Button></Link>}
          </div>
        </header>

        <section className="mb-4 grid gap-3 sm:grid-cols-3" aria-label="Reservation attention">
          {[
            ["Waiting for approval", [...tableReservations, ...cateringReservations, ...pickupOrders].filter((item) => item.status === "pending" || item.status === "pending_approval").length, "needs_approval" as const],
            ["Bookings today", [...tableReservations, ...cateringReservations].filter((item) => manilaDateKey(item.date) === todayKey).length, "today" as const],
            ["Catering balance due", cateringReservations.length, "all" as const]
          ].map(([label, count, filter], index) => (
            <div key={label as string} role="link" tabIndex={0} className="rounded-lg border border-slate-200 bg-white p-4 text-left shadow-sm transition hover:-translate-y-0.5 hover:shadow-md" onClick={() => filter === "today" ? setDateFilter("today") : filter === "needs_approval" ? setStatusFilter("needs_approval") : selectView("catering")} onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); event.currentTarget.click(); } }}>
              <div className={`grid h-12 w-12 shrink-0 place-items-center rounded-[14px] ${index === 0 ? "bg-[#fdf1d9] text-[#9b6500]" : index === 1 ? "bg-[#edf3ff] text-[#4f72b8]" : "bg-[#fbeaea] text-[#9b1d20]"}`}>
                {index === 0 ? <Clock3 className="h-5 w-5" /> : index === 1 ? <CalendarDays className="h-5 w-5" /> : <WalletCards className="h-5 w-5" />}
              </div>
              <div>
                <p className={`text-[28px] font-black leading-none ${index === 0 ? "text-[#9b1d20]" : "text-[#1c2030]"}`}>{count as number}</p>
                <p className="mt-2 text-xs font-semibold text-[#6a7185]">{label as string}</p>
              </div>
            </div>
          ))}
        </section>

        <nav className="mb-4 flex flex-wrap gap-2 rounded-xl border border-slate-200 bg-white p-2 shadow-sm" aria-label="Reservation views">
          {permittedViews.map((view) => (
            <button key={view.id} type="button" className={`rounded-[8px] px-4 py-2 text-sm font-bold transition ${currentView === view.id ? "bg-[#a82e27] text-white shadow-sm" : "text-slate-600 hover:bg-red-50 hover:text-red-800"}`} aria-pressed={currentView === view.id} onClick={() => selectView(view.id)}>
              {view.label} <span className={`ml-1 rounded-full px-2 py-0.5 text-xs ${currentView === view.id ? "bg-white/20 text-white" : "bg-slate-100 text-slate-700"}`}>{view.id === "tables" ? tableReservations.length : view.id === "catering" ? cateringReservations.length : pickupOrders.length}</span>
            </button>
          ))}
        </nav>

        <div className="staff-reservation-filters mb-4">
          {([["all", "All"], ["needs_approval", "Needs approval"], ["confirmed", "Confirmed / Approved"], ["completed", "Completed"]] as const).map(([value, label]) => (
            <button key={value} type="button" aria-label={`Filter status: ${label === "Needs approval" ? "pending" : label === "Confirmed / Approved" ? "confirmed" : label}`} className={`staff-status-chip ${statusFilter === value ? "staff-status-selected" : ""}`} onClick={() => setStatusFilter(value)}><span aria-hidden="true">{label}</span></button>
          ))}
          {(["any", "today", "tomorrow", "next7"] as const).map((value) => (
            <button key={value} type="button" className={`staff-date-chip ${dateFilter === value ? "staff-date-selected" : ""}`} onClick={() => setDateFilter(value)}>{value === "any" ? "Any date" : value === "next7" ? "Next 7 days" : value[0].toUpperCase() + value.slice(1)}</button>
          ))}
          {(search || statusFilter !== "all" || dateFilter !== "any" || selectedDate) && <button type="button" className="ml-auto text-sm font-bold text-red-700" onClick={clearFilters}><X className="mr-1 inline h-4 w-4" />Clear filters</button>}
        </div>

        {selectedDate ? (
          <div className="mb-3 flex items-center justify-between gap-3 rounded-lg border border-slate-200 bg-white px-4 py-3">
            <p className="text-sm font-semibold text-slate-700">
              Showing {formatManilaDate(`${selectedDate}T12:00:00+08:00`, {
                weekday: "long",
                month: "long",
                day: "numeric",
                year: "numeric"
              })}
            </p>
            <Button type="button" size="sm" variant="outline" onClick={() => setSelectedDate(null)}>
              All upcoming
            </Button>
          </div>
        ) : null}

        <section className="staff-main-card" aria-label={`${allViews.find((view) => view.id === currentView)?.label} upcoming list`}>
          {currentView === "pickup" && readyNotice ? (
            <div role="status" className="flex items-center justify-between gap-3 border-b border-emerald-200 bg-emerald-50 px-5 py-3 text-sm font-bold text-emerald-900">
              <p>{readyNotice}</p>
              <button type="button" aria-label="Dismiss ready notification" onClick={() => setReadyNotice("")} className="rounded px-2 py-1 hover:bg-emerald-100">
                Dismiss
              </button>
            </div>
          ) : null}
          {currentView !== "pickup" && reservationsQuery.isLoading ? (
            <p className="p-5 text-sm text-slate-500" role="status">Loading reservations...</p>
          ) : currentView !== "pickup" && reservationsQuery.isError ? (
            <p className="p-5 text-sm text-red-700" role="alert">Unable to load reservations. Please refresh and try again.</p>
          ) : currentView === "pickup" && pickupQuery.isLoading ? (
            <p className="p-5 text-sm text-slate-500" role="status">Loading pickup orders...</p>
          ) : currentView === "pickup" && pickupQuery.isError ? (
            <p className="p-5 text-sm text-red-700" role="alert">Unable to load pickup orders. Please refresh and try again.</p>
          ) : currentView === "tables" ? (
            filteredTableReservations.length === 0 ? (
              <div className="staff-empty-state"><div className="staff-empty-icon"><CalendarDays className="h-7 w-7" /></div><strong>{selectedDate ? "No table reservations for this date." : "No upcoming table reservations."}</strong><span>No matching bookings are scheduled right now.</span></div>
            ) : (
              <ul className="grid gap-[10px]">
                {filteredTableReservations.map((reservation, index) => (
                  <Fragment key={reservation.id}>
                    {(index === 0 || manilaDateKey(filteredTableReservations[index - 1].date) !== manilaDateKey(reservation.date)) && (
                      <li className="flex items-center gap-[10px] px-1 pt-[8px] text-[13px] font-black uppercase tracking-[0.05em] text-[#4a4350]">
                        <span className={manilaDateKey(reservation.date) === todayKey ? "text-[#a82e27]" : ""}>{getDateGroupLabel(reservation.date)}</span>
                        <span className="rounded-full bg-[#ecebf1] px-[9px] py-[1px] text-[12px] font-bold text-[#7b6f72]">{filteredTableReservations.filter((entry) => manilaDateKey(entry.date) === manilaDateKey(reservation.date)).length}</span>
                        <span className="h-px flex-1 bg-[#e6e4ea]" />
                      </li>
                    )}
                    <li key={`${reservation.id}-card`} tabIndex={0} role="button" onClick={() => setDrawer({ type: "table", item: reservation })} onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") setDrawer({ type: "table", item: reservation }); }} className={`staff-reservation-row grid cursor-pointer gap-[18px] bg-white outline-none transition-all duration-200 ${reservation.status === "pending" ? "border-l-[4px] border-l-[#a82e27]" : ""}`} style={{ gridTemplateColumns: "112px minmax(0,1fr) auto", alignItems: "center" }}>
                      <div className="flex h-full items-center gap-4 border-r border-[#e6e4ea] pr-4">
                        <div className="min-w-0 text-left">
                          <p className="whitespace-nowrap text-[19px] font-extrabold leading-none text-[#1c1214]">{formatTime12(reservation.time)}</p>
                          <p className="mt-2 text-[12.5px] text-[#7b6f72]">{formatManilaDate(reservation.date, { weekday: "short", month: "short", day: "numeric" })}</p>
                        </div>
                      </div>
                      <div className="min-w-0">
                        <p className="text-[16px] font-extrabold text-[#1c1214]">{reservation.customer_name}</p>
                        <p className="mt-1 mb-2 text-[12.5px] tracking-[0.02em] text-[#7b6f72]">{reservation.reference}</p>
                        <div className="flex flex-wrap gap-[6px]">
                          <span className="rounded-[6px] bg-[#f4f4f8] px-[9px] py-[3px] text-[12.5px] font-semibold text-[#4a4350]">{reservation.guests} guest{reservation.guests === 1 ? "" : "s"}</span>
                          <span className="rounded-[6px] bg-[#f4f4f8] px-[9px] py-[3px] text-[12.5px] font-semibold text-[#4a4350]">Tables: {reservation.table_numbers.length > 0 ? reservation.table_numbers.join(", ") : "Not assigned"}</span>
                          {reservation.late_alert ? (<span role="status" aria-live="polite" className="rounded-[6px] bg-[#fff0d9] px-[9px] py-[3px] text-[12.5px] font-semibold text-[#8a5200]">Late arrival alert</span>) : null}
                        </div>
                      </div>
                      <div className="flex flex-col items-end gap-[8px]">
                        <span className={`inline-flex items-center rounded-full px-[12px] py-[5px] text-[12px] font-extrabold uppercase tracking-[0.03em] ${getStatusPillClass(reservation.status)}`}>
                          {formatStatus(reservation.status)}
                        </span>
                      </div>
                    </li>
                  </Fragment>
                ))}
              </ul>
            )
          ) : currentView === "catering" ? (
            <div>
              {filteredCateringReservations.length === 0 ? (
                <div className="staff-empty-state"><div className="staff-empty-icon"><CalendarDays className="h-7 w-7" /></div><strong>{selectedDate ? "No catering reservations for this date." : "No upcoming catering reservations."}</strong><span>No matching catering bookings are scheduled right now.</span></div>
              ) : (
                <ul className="grid gap-[10px]">
                  {filteredCateringReservations.map((reservation, index) => (
                    <Fragment key={reservation.id}>
                      {(index === 0 || manilaDateKey(filteredCateringReservations[index - 1].date) !== manilaDateKey(reservation.date)) && (
                        <li className="flex items-center gap-[10px] px-1 pt-[8px] text-[13px] font-black uppercase tracking-[0.05em] text-[#4a4350]">
                          <span className={manilaDateKey(reservation.date) === todayKey ? "text-[#a82e27]" : ""}>{getDateGroupLabel(reservation.date)}</span>
                          <span className="rounded-full bg-[#ecebf1] px-[9px] py-[1px] text-[12px] font-bold text-[#7b6f72]">{filteredCateringReservations.filter((entry) => manilaDateKey(entry.date) === manilaDateKey(reservation.date)).length}</span>
                          <span className="h-px flex-1 bg-[#e6e4ea]" />
                        </li>
                      )}
                      <li key={`${reservation.id}-card`} tabIndex={0} role="button" onClick={() => setDrawer({ type: "catering", item: reservation })} onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") setDrawer({ type: "catering", item: reservation }); }} className={`staff-reservation-row grid cursor-pointer gap-[18px] bg-white outline-none transition-all duration-200 ${reservation.status === "pending" || reservation.status === "pending_approval" ? "border-l-[4px] border-l-[#a82e27]" : ""}`} style={{ gridTemplateColumns: "112px minmax(0,1fr) auto", alignItems: "center" }}>
                        <div className="flex h-full items-center gap-4 border-r border-[#e6e4ea] pr-4">
                          <div className="min-w-0 text-left">
                            <p className="whitespace-nowrap text-[19px] font-extrabold leading-none text-[#1c1214]">{reservation.time ? formatTime12(reservation.time) : "Time TBD"}</p>
                            <p className="mt-2 text-[12.5px] text-[#7b6f72]">{formatManilaDate(reservation.date, { weekday: "short", month: "short", day: "numeric" })}</p>
                          </div>
                        </div>
                        <div className="min-w-0">
                          <p className="text-[16px] font-extrabold text-[#1c1214]">{reservation.customer_name}</p>
                          <p className="mt-1 mb-2 text-[12.5px] tracking-[0.02em] text-[#7b6f72]">{reservation.reference}</p>
                          <div className="flex flex-wrap gap-[6px]">
                            <span className="rounded-[6px] bg-[#f4f4f8] px-[9px] py-[3px] text-[12.5px] font-semibold text-[#4a4350]">{reservation.guests} guest{reservation.guests === 1 ? "" : "s"}</span>
                            {reservation.package_name ? <span className="rounded-[6px] bg-[#f4f4f8] px-[9px] py-[3px] text-[12.5px] font-semibold text-[#4a4350]">{reservation.package_name}</span> : null}
                          </div>
                        </div>
                        <div className="flex flex-col items-end gap-[8px]">
                          <span className={`inline-flex items-center rounded-full px-[12px] py-[5px] text-[12px] font-extrabold uppercase tracking-[0.03em] ${getStatusPillClass(reservation.status)}`}>
                            {formatStatus(reservation.status)}
                          </span>
                        </div>
                      </li>
                    </Fragment>
                  ))}
                </ul>
              )}
            </div>
          ) : filteredPickupOrders.length === 0 ? (
            <div className="staff-empty-state"><div className="staff-empty-icon"><WalletCards className="h-7 w-7" /></div><strong>{selectedDate ? "No pickup orders for this date." : "No active pickup orders."}</strong><span>No matching pickup orders need attention.</span></div>
          ) : (
            <ul className="grid gap-[10px] p-0">
              {filteredPickupOrders.map((order, index) => (
                <Fragment key={order.order_number}>
                  {(index === 0 || manilaDateKey(filteredPickupOrders[index - 1].created_at) !== manilaDateKey(order.created_at)) && (
                    <li className="flex items-center gap-[10px] px-5 pt-[8px] text-[13px] font-black uppercase tracking-[0.05em] text-[#4a4350]">
                      <span className={parseReservationDateTime(order.created_at).dateKey === todayKey ? "text-[#a82e27]" : ""}>{getDateGroupLabel(parseReservationDateTime(order.created_at).dateKey)}</span>
                      <span className="rounded-full bg-[#ecebf1] px-[9px] py-[1px] text-[12px] font-bold text-[#7b6f72]">{filteredPickupOrders.filter((entry) => parseReservationDateTime(entry.created_at).dateKey === parseReservationDateTime(order.created_at).dateKey).length}</span>
                      <span className="h-px flex-1 bg-[#e6e4ea]" />
                    </li>
                  )}
                  <li key={`${order.order_number}-card`} tabIndex={0} role="button" onClick={() => setDrawer({ type: "pickup", item: order })} onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") setDrawer({ type: "pickup", item: order }); }} className={`staff-reservation-row grid cursor-pointer gap-[18px] bg-white outline-none transition-all duration-200 ${order.status === "pending_payment" || order.status === "pending_approval" ? "border-l-[4px] border-l-[#a82e27]" : ""}`} style={{ gridTemplateColumns: "112px minmax(0,1fr) auto", alignItems: "center" }}>
                    <div className="flex h-full items-center gap-4 border-r border-[#e6e4ea] pr-4">
                      <div className="min-w-0 text-left">
                        <p className="whitespace-nowrap text-[19px] font-extrabold leading-none text-[#1c1214]">{parseReservationDateTime(order.created_at).timeLabel}</p>
                        <p className="mt-2 whitespace-nowrap text-[12.5px] text-[#7b6f72]">{parseReservationDateTime(order.created_at).shortDateLabel}</p>
                      </div>
                    </div>
                    <div className="min-w-0">
                      <p className="text-[16px] font-extrabold text-[#1c1214]">{order.customer_name}</p>
                      <p className="mt-1 mb-2 text-[12.5px] tracking-[0.02em] text-[#7b6f72]">{order.order_number}</p>
                      <div className="flex flex-wrap gap-[6px]">
                        {order.items.map((item, itemIndex) => (
                          <span key={`${order.order_number}-${itemIndex}`} className="rounded-[6px] bg-[#f4f4f8] px-[9px] py-[3px] text-[12.5px] font-semibold text-[#4a4350]">{item.name} ×{item.quantity}</span>
                        ))}
                        <span className="rounded-[6px] bg-[#f4f4f8] px-[9px] py-[3px] text-[12.5px] font-semibold text-[#4a4350]">Pay at counter</span>
                      </div>
                    </div>
                    <div className="flex flex-col items-end gap-[8px]">
                      <span className={`inline-flex items-center rounded-full px-[12px] py-[5px] text-[12px] font-extrabold uppercase tracking-[0.03em] ${getStatusPillClass(order.status)}`}>
                        {formatStatus(order.status)}
                      </span>
                      <div className="flex flex-wrap justify-end gap-[8px]">
                        {order.status === "ready" ? <>
                          <span className="self-center text-sm font-semibold text-emerald-800">Ready for pickup</span>
                          {order.ready_at ? <p className="text-right text-xs font-semibold text-emerald-800">Pickup Time: {formatManilaDateTime(order.ready_at, { hour: "numeric", minute: "2-digit" })}</p> : null}
                        </> : null}
                        {canUpdatePickup && order.status === "pending_approval" ? (
                          <>
                            <Button type="button" className="!bg-[#a82e27] !text-white !border-[#a82e27] !shadow-none" disabled={pickupStatusMutation.isPending} onClick={(event) => { event.stopPropagation(); updatePickup(order, "preparing"); }}>Approve</Button>
                            <Button type="button" variant="outline" className="!border-[#e0dde6] !bg-white !text-[#1c1214]" disabled={pickupStatusMutation.isPending} onClick={(event) => { event.stopPropagation(); updatePickup(order, "declined"); }}>Decline</Button>
                          </>
                        ) : null}
                        {canUpdatePickup && order.status === "confirmed" ? (
                          <Button type="button" variant="outline" className="!border-[#e0dde6] !bg-white !text-[#1c1214]" disabled={pickupStatusMutation.isPending} onClick={(event) => { event.stopPropagation(); updatePickup(order, "preparing"); }}>Start preparing</Button>
                        ) : null}
                        {canUpdatePickup && order.status === "preparing" ? (
                          <Button type="button" variant="outline" className="!border-[#e0dde6] !bg-white !text-[#1c1214]" disabled={pickupStatusMutation.isPending} onClick={(event) => { event.stopPropagation(); updatePickup(order, "ready"); }}>Mark ready</Button>
                        ) : null}
                      </div>
                      <p className="text-right text-[16px] font-extrabold text-[#1c1214]">{formatMoney(order.total)}</p>
                    </div>
                  </li>
                </Fragment>
              ))}
            </ul>
          )}
          {pickupStatusMutation.isError && currentView === "pickup" ? (
            <p className="border-t border-red-200 bg-red-50 px-5 py-3 text-sm text-red-800" role="alert">
              Unable to update pickup order: {getApiErrorMessage(pickupStatusMutation.error, "Please try again.")}
            </p>
          ) : null}
        </section>
      </section>

      <Dialog open={calendarOpen} title="Reservation calendar" onClose={() => setCalendarOpen(false)} panelClassName="reservation-calendar-dialog max-w-5xl" overlayClassName="!bg-[#1c203073] !backdrop-blur-[3px]">
        <MiniCalendar
          month={calendarMonth}
          selectedDate={selectedDate ?? todayManilaDateKey()}
          eventsByDate={eventsByDate}
          onPreviousMonth={() => setCalendarMonth((current) => new Date(current.getFullYear(), current.getMonth() - 1, 1))}
          onNextMonth={() => setCalendarMonth((current) => new Date(current.getFullYear(), current.getMonth() + 1, 1))}
          onSelectDate={selectCalendarDate}
          onClose={() => setCalendarOpen(false)}
        />
      </Dialog>
      <BookingDetailsDrawer
        open={Boolean(drawer)}
        title={drawer?.type === "table" ? "Table booking" : drawer?.type === "catering" ? "Catering booking" : "Pickup order"}
        typeLabel={drawer?.type === "table" ? "TABLE BOOKING" : drawer?.type === "catering" ? "CATERING BOOKING" : "PICKUP ORDER"}
        customerName={drawer ? drawer.type === "pickup" ? drawer.item.customer_name : drawer.item.customer_name : ""}
        status={drawer ? drawer.item.status : ""}
        onClose={() => setDrawer(null)}
        body={drawer?.type === "table" ? (
          <div className="grid gap-3 text-sm text-slate-700">
            <p><strong>Date:</strong> {formatManilaDate(drawer.item.date)}</p>
            <p><strong>Time:</strong> {formatTime12(drawer.item.time)}</p>
            <p><strong>Reference:</strong> {drawer.item.reference}</p>
            <p><strong>Guests:</strong> {drawer.item.guests}</p>
            <p><strong>Tables:</strong> {drawer.item.table_numbers.length ? drawer.item.table_numbers.join(", ") : "Not assigned"}</p>
          </div>
        ) : drawer?.type === "pickup" ? (
          <div className="grid gap-4 text-sm text-slate-700">
            <p><strong>Reference:</strong> {drawer.item.order_number}</p>
            <p><strong>Created:</strong> {formatManilaDateTime(drawer.item.created_at)}</p>
            <p><strong>Payment:</strong> Pay at counter</p>
            <ul className="grid gap-2 border-y border-slate-200 py-3">{drawer.item.items.map((item, index) => <li key={`${item.name}-${index}`} className="flex justify-between gap-3"><span>{item.name} ×{item.quantity}</span><strong>{formatMoney(item.total_price)}</strong></li>)}</ul>
            <p className="flex justify-between font-bold"><span>Total</span><span>{formatMoney(drawer.item.total)}</span></p>
          </div>
        ) : drawer?.type === "catering" ? (
          <div className="grid gap-3 text-sm text-slate-700">
            <p><strong>Date:</strong> {formatManilaDate(drawer.item.date)}</p>
            <p><strong>Time:</strong> {drawer.item.time ? formatTime12(drawer.item.time) : "Not provided"}</p>
            <p><strong>Reference:</strong> {drawer.item.reference}</p>
            <p><strong>Guests:</strong> {drawer.item.guests}</p>
            <p><strong>Package:</strong> {drawer.item.package_name ?? "Catering"}</p>
            <p><strong>Event type:</strong> {drawer.item.reservation_type ?? "Not specified"}</p>
            <p><strong>Location:</strong> {drawer.item.table_numbers.length ? drawer.item.table_numbers.join(", ") : "Venue details available in Catering Operations"}</p>
          </div>
        ) : null}
        helperText={drawer?.type === "catering" ? "Open actions to see the full reservation details, record payments, approve, decline or cancel this booking." : undefined}
        actions={drawer?.type === "catering" ? (
          <Button type="button" className="flex-1 !border-[#a82e27] !bg-[#a82e27] !text-white hover:!bg-[#7d1511]" onClick={() => void openCateringPayment(drawer.item)}>
            Open actions →
          </Button>
        ) : null}
      />
      <ReservationDetailsModal
        open={Boolean(paymentReservation)}
        title={paymentReservation ? paymentReservation.reference : "Event details"}
        reservation={paymentReservationData}
        actions={cateringModalActions}
        onClose={() => {
          setPaymentReservation(null);
          setPaymentReservationData(null);
        }}
        onPaymentRecorded={async () => {
          await reservationsQuery.refetch();
          if (!paymentReservation) return;
          const response = await api.get<{ reservations: CateringPaymentRecord[] }>("/api/staff/catering/reservations");
          const next = response.data.reservations.find((item) => item.id === paymentReservation.id);
          if (!next) return;
          setPaymentReservationData({
            id: next.id,
            type: "catering",
            reference: next.reservation_id,
            reservation_id: next.reservation_id,
            booking_id: next.reservation_id,
            customer_name: next.customer_name,
            phone: next.customer_phone,
            email: next.customer_email,
            date: next.confirmed_date,
            event_date: next.confirmed_date,
            time: next.event_time ?? undefined,
            event_time: next.event_time,
            guests: next.headcount,
            headcount: next.headcount,
            total_price: next.total_price,
            package_total: next.package_total,
            mobilization_fee: next.mobilization_fee,
            status: next.status,
            payment_plan: next.payment_plan,
            downpayment_amount: next.downpayment_amount,
            downpayment_status: next.downpayment_status,
            remaining_balance: next.remaining_balance,
            payment_status: next.payment_status ?? next.final_payment_status,
            final_payment_status: next.final_payment_status,
            payment_history: next.payment_history ?? [],
            package_name: next.package?.name ?? null,
            package_snapshot: next.package_snapshot,
            special_requests: next.inquiry?.message ?? null,
            event_type: next.inquiry?.event_type ?? null,
            event_type_other: next.inquiry?.event_type_other ?? null,
            venue_type: next.inquiry?.venue_type ?? null,
            venue_address: next.inquiry?.venue_type ?? null,
            created_at: next.created_at,
            package_items: next.package_snapshot,
            activity: [],
            net_paid: next.total_price - (next.remaining_balance ?? 0)
          });
        }}
      />
    </main>
  );
}

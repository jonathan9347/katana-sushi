import { useEffect, useRef, useState } from "react";
import {
  ArrowLeft,
  ArrowRight,
  CalendarDays,
  Check,
  Clock3,
  PackageCheck,
  ShoppingBag,
  Utensils,
  UserRound,
  X,
  type LucideIcon
} from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { api } from "../../../lib/api";
import { shortRef } from "../../../lib/display";
import "./NewCustomerFlowModal.css";

type Service = "dine_in" | "takeout";
type Entry = "walk_in" | "reservation" | "pickup";
type Step = "service" | "entry" | "reservations" | "pickup" | "done";

export type NewCustomerReservation = {
  id: string;
  time: string;
  customer_name: string;
  party_size: number;
  table_numbers: number[];
  temporary_table_numbers: number[];
  state: "upcoming" | "arrived" | "late";
};

export type NewCustomerPickupOrder = {
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

export type NewCustomerSelection = {
  service: Service;
  entry: Entry;
  reservation?: NewCustomerReservation;
  pickupOrder?: NewCustomerPickupOrder;
  path: string[];
};

type Option = {
  value: string;
  title: string;
  description: string;
  icon: LucideIcon;
  shortcut: string;
};

type FlowState = {
  step: Step;
  path: string[];
  service: Service | null;
  entry: Entry | null;
  reservation: NewCustomerReservation | null;
  pickupOrder: NewCustomerPickupOrder | null;
};

const initialFlow: FlowState = {
  step: "service",
  path: [],
  service: null,
  entry: null,
  reservation: null,
  pickupOrder: null
};

const stepConfig = {
  service: {
    title: "New Customer",
    subtitle: "How will this customer be dining today?",
    breadcrumb: "Choose service",
    options: [
      {
        value: "dine_in",
        title: "Dine-in",
        description: "Eat at the restaurant",
        icon: Utensils,
        shortcut: "1"
      },
      {
        value: "takeout",
        title: "Take-out",
        description: "Order to go",
        icon: ShoppingBag,
        shortcut: "2"
      }
    ] satisfies Option[]
  },
  entry: {
    title: (service: Service | null) => service === "dine_in" ? "Dine-in" : "Take-out",
    subtitle: "Choose how this order is starting.",
    breadcrumb: "Choose order type",
    options: {
      dine_in: [
        {
          value: "walk_in",
          title: "Walk-in",
          description: "Customer is here now",
          icon: UserRound,
          shortcut: "1"
        },
        {
          value: "reservation",
          title: "Reservation",
          description: "Link a booked table",
          icon: CalendarDays,
          shortcut: "2"
        }
      ],
      takeout: [
        {
          value: "walk_in",
          title: "Walk-in",
          description: "Order to go now",
          icon: UserRound,
          shortcut: "1"
        },
        {
          value: "pickup",
          title: "Pickup",
          description: "Pre-ordered, collected at the counter",
          icon: PackageCheck,
          shortcut: "2"
        }
      ]
    } satisfies Record<Service, Option[]>
  }
};

type Props = {
  open: boolean;
  onClose: () => void;
  onStartOrdering: (selection: NewCustomerSelection) => void;
  initialMode?: "reservation" | "pickup" | null;
};

function isEditableTarget(target: EventTarget | null) {
  return target instanceof HTMLElement
    && (target.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName));
}

function formatPickupTime(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Time not set";
  return new Intl.DateTimeFormat("en-PH", {
    timeZone: "Asia/Manila",
    hour: "numeric",
    minute: "2-digit"
  }).format(date);
}

export default function NewCustomerFlowModal({ open, onClose, onStartOrdering, initialMode = null }: Props) {
  const [flow, setFlow] = useState<FlowState>(initialFlow);
  const [direction, setDirection] = useState<"forward" | "back">("forward");
  const [selectedValue, setSelectedValue] = useState("");
  const [pickupSearch, setPickupSearch] = useState("");
  const dialogRef = useRef<HTMLDivElement>(null);
  const firstActionRef = useRef<HTMLElement | null>(null);
  const returnFocusRef = useRef<HTMLElement | null>(null);
  const selectionTimerRef = useRef<number | null>(null);

  const reservationsQuery = useQuery({
    queryKey: ["pos", "dining", "upcoming-reservations"],
    queryFn: async () => (await api.get<{ reservations: NewCustomerReservation[] }>(
      "/api/pos/dining/upcoming-reservations"
    )).data.reservations,
    enabled: open && flow.step === "reservations",
    retry: false,
    refetchOnWindowFocus: true
  });
  const pickupOrdersQuery = useQuery({
    queryKey: ["pos", "pickup-orders", pickupSearch.trim()],
    queryFn: async () => (await api.get<{ orders: NewCustomerPickupOrder[] }>("/api/pos/pickup-orders", {
      params: { search: pickupSearch.trim() }
    })).data.orders,
    enabled: open && flow.step === "pickup" && pickupSearch.trim().length >= 2,
    retry: false,
    staleTime: 5_000
  });

  const currentStepConfig = flow.step === "service"
    ? stepConfig.service
    : flow.step === "entry"
      ? {
          title: stepConfig.entry.title(flow.service),
          subtitle: stepConfig.entry.subtitle,
          breadcrumb: stepConfig.entry.breadcrumb,
          options: stepConfig.entry.options[flow.service ?? "dine_in"]
        }
      : null;
  const title = currentStepConfig?.title
    ?? (flow.step === "reservations" ? "Today's reservations"
      : flow.step === "pickup" ? "Select pickup order" : "Ready to order");
  const breadcrumb = currentStepConfig?.breadcrumb
    ?? (flow.step === "reservations" ? "Select reservation"
      : flow.step === "pickup" ? "Select pickup" : "Customer selected");
  const subtitle = currentStepConfig?.subtitle
    ?? (flow.step === "reservations" ? "Choose today's confirmed table booking."
      : flow.step === "pickup" ? "Find the pre-order waiting to be collected."
        : "Review the order path, then start ordering.");
  const progressIndex = flow.step === "service" ? 0
    : flow.step === "entry" ? 1
      : 2;
  const path = flow.path;

  useEffect(() => {
    if (!open) return;
    returnFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    setFlow(initialMode === "reservation"
      ? {
          ...initialFlow,
          step: "reservations",
          path: ["Dine-in", "Reservation"],
          service: "dine_in",
          entry: "reservation"
        }
      : initialMode === "pickup"
        ? {
            ...initialFlow,
            step: "pickup",
            path: ["Take-out", "Pickup"],
            service: "takeout",
            entry: "pickup"
          }
        : initialFlow);
    setDirection("forward");
    setSelectedValue("");
    setPickupSearch("");

    const focusFrame = window.requestAnimationFrame(() => firstActionRef.current?.focus());
    return () => {
      window.cancelAnimationFrame(focusFrame);
      if (selectionTimerRef.current !== null) window.clearTimeout(selectionTimerRef.current);
      selectionTimerRef.current = null;
      returnFocusRef.current?.focus();
    };
  }, [open, initialMode]);

  useEffect(() => {
    if (!open) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        close();
        return;
      }
      if (event.key === "Backspace" && !initialMode && !isEditableTarget(event.target) && flow.step !== "service") {
        event.preventDefault();
        goBack();
        return;
      }
      if ((event.key === "1" || event.key === "2") && !isEditableTarget(event.target)) {
        const options = currentStepConfig?.options;
        const selectedOption = options?.[Number(event.key) - 1];
        if (selectedOption) {
          event.preventDefault();
          selectOption(selectedOption);
        }
      }
      if (event.key === "Tab" && dialogRef.current) {
        const focusable = Array.from(dialogRef.current.querySelectorAll<HTMLElement>(
          'button:not([disabled]), input:not([disabled]), [href], [tabindex]:not([tabindex="-1"])'
        ));
        if (focusable.length === 0) return;
        const first = focusable[0];
        const last = focusable[focusable.length - 1];
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault();
          last.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first.focus();
        }
      }
    };
    document.addEventListener("keydown", handleKeyDown);

    return () => {
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [open, flow.step, currentStepConfig, initialMode]);

  useEffect(() => {
    if (!open) return;
    const focusFrame = window.requestAnimationFrame(() => firstActionRef.current?.focus());
    return () => window.cancelAnimationFrame(focusFrame);
  }, [flow.step, open]);

  function close() {
    if (selectionTimerRef.current !== null) window.clearTimeout(selectionTimerRef.current);
    selectionTimerRef.current = null;
    setSelectedValue("");
    onClose();
  }

  function goBack() {
    if (selectionTimerRef.current !== null) window.clearTimeout(selectionTimerRef.current);
    selectionTimerRef.current = null;
    setSelectedValue("");
    setDirection("back");
    setFlow((current) => {
      if (current.step === "done") {
        if (current.reservation) return { ...current, step: "reservations", reservation: null, path: current.path.slice(0, 2) };
        if (current.pickupOrder) return { ...current, step: "pickup", pickupOrder: null, path: current.path.slice(0, 2) };
        return { ...current, step: "entry", entry: null, path: current.path.slice(0, 1) };
      }
      if (current.step === "reservations" || current.step === "pickup") {
        return { ...current, step: "entry", entry: null, path: current.path.slice(0, 1) };
      }
      return { ...current, step: "service", service: null, path: [] };
    });
  }

  function selectOption(option: Option) {
    if (selectionTimerRef.current !== null) return;
    setSelectedValue(option.value);
    selectionTimerRef.current = window.setTimeout(() => {
      selectionTimerRef.current = null;
      setSelectedValue("");
      setDirection("forward");
      if (flow.step === "service") {
        const service = option.value as Service;
        setFlow({
          step: "entry",
          path: [service === "dine_in" ? "Dine-in" : "Take-out"],
          service,
          entry: null,
          reservation: null,
          pickupOrder: null
        });
        return;
      }
      if (flow.step !== "entry") return;
      const entry = option.value as Entry;
      const label = entry === "walk_in" ? "Walk-in" : entry === "reservation" ? "Reservation" : "Pickup";
      if (entry === "reservation") {
        setFlow((current) => ({ ...current, step: "reservations", entry, path: [...current.path, label] }));
      } else if (entry === "pickup") {
        setFlow((current) => ({ ...current, step: "pickup", entry, path: [...current.path, label] }));
      } else {
        setFlow((current) => ({ ...current, step: "done", entry, path: [...current.path, label] }));
      }
    }, 240);
  }

  function selectReservation(reservation: NewCustomerReservation) {
    if (selectionTimerRef.current !== null) return;
    setSelectedValue(reservation.id);
    selectionTimerRef.current = window.setTimeout(() => {
      selectionTimerRef.current = null;
      setSelectedValue("");
      setDirection("forward");
      const nextFlow: FlowState = {
        ...flow,
        step: "done",
        reservation,
        path: [...flow.path.slice(0, 2), `${reservation.customer_name} · ${reservation.time}`]
      };
      setFlow(nextFlow);
      if (initialMode) {
        onStartOrdering({
          service: "dine_in",
          entry: "reservation",
          reservation,
          path: nextFlow.path
        });
        onClose();
      }
    }, 240);
  }

  function selectPickupOrder(order: NewCustomerPickupOrder) {
    if (selectionTimerRef.current !== null) return;
    setSelectedValue(order.order_number);
    selectionTimerRef.current = window.setTimeout(() => {
      selectionTimerRef.current = null;
      setSelectedValue("");
      setDirection("forward");
      const nextFlow: FlowState = {
        ...flow,
        step: "done",
        pickupOrder: order,
        path: [...flow.path.slice(0, 2), `${order.customer_name} · ${order.order_number}`]
      };
      setFlow(nextFlow);
      if (initialMode) {
        onStartOrdering({
          service: "takeout",
          entry: "pickup",
          pickupOrder: order,
          path: nextFlow.path
        });
        onClose();
      }
    }, 240);
  }

  function startOrdering() {
    if (!flow.service || !flow.entry) return;
    onStartOrdering({
      service: flow.service,
      entry: flow.entry,
      ...(flow.reservation ? { reservation: flow.reservation } : {}),
      ...(flow.pickupOrder ? { pickupOrder: flow.pickupOrder } : {}),
      path
    });
    onClose();
  }

  if (!open) return null;

  const reservations = (reservationsQuery.data ?? []).filter((reservation) => reservation.state !== "arrived");
  const pickupOrders = pickupOrdersQuery.data ?? [];

  return (
    <div
      className="pos-new-customer-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) close();
      }}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="pos-new-customer-title"
        className="pos-new-customer-dialog"
      >
        <header className="pos-new-customer-header">
          <div className="pos-new-customer-header-content">
            <p className="pos-new-customer-breadcrumb">
              POS <span>/</span> {initialMode ? (initialMode === "reservation" ? "DINE-IN" : "TAKEOUT") : "NEW CUSTOMER"} <span>/</span> {breadcrumb}
            </p>
            <h2 id="pos-new-customer-title">{title}</h2>
            <p className="pos-new-customer-subtitle">{subtitle}</p>
          </div>
          <button
            ref={initialMode ? (node) => { firstActionRef.current = node; } : undefined}
            type="button"
            className="pos-new-customer-close"
            onClick={close}
            aria-label={initialMode ? "Close order picker" : "Close New Customer flow"}
          >
            <X aria-hidden="true" />
          </button>
        </header>

        {!initialMode && (
          <div className="pos-new-customer-progress" aria-label={`Step ${progressIndex + 1} of 3`}>
            {[0, 1, 2].map((step) => (
              <span key={step} className={step <= progressIndex ? "is-filled" : ""} />
            ))}
          </div>
        )}

        <div className={`pos-new-customer-content is-${direction}`} key={flow.step}>
          {flow.step === "service" || flow.step === "entry" ? (
            <div className="pos-new-customer-options" role="group" aria-label={title}>
              {currentStepConfig?.options.map((option, index) => {
                const Icon = option.icon;
                return (
                  <button
                    key={option.value}
                    ref={index === 0 ? (node) => { firstActionRef.current = node; } : undefined}
                    type="button"
                    className={`pos-new-customer-option${selectedValue === option.value ? " is-selected" : ""}`}
                    onClick={() => selectOption(option)}
                    onMouseDown={(event) => {
                      const bounds = event.currentTarget.getBoundingClientRect();
                      event.currentTarget.style.setProperty("--ripple-x", `${event.clientX - bounds.left}px`);
                      event.currentTarget.style.setProperty("--ripple-y", `${event.clientY - bounds.top}px`);
                    }}
                    aria-label={`${option.title}. ${option.description}. Press ${option.shortcut}`}
                  >
                    <span className="pos-new-customer-icon"><Icon aria-hidden="true" /></span>
                    <span className="pos-new-customer-option-copy">
                      <strong>{option.title}</strong>
                      <small>{option.description}</small>
                    </span>
                    <kbd>{option.shortcut}</kbd>
                    <span className="pos-new-customer-select-label">Select <ArrowRight aria-hidden="true" /></span>
                    <span className="pos-new-customer-ripple" aria-hidden="true" />
                  </button>
                );
              })}
            </div>
          ) : flow.step === "reservations" ? (
            <section className="pos-new-customer-list" aria-label="Today's reservation list">
              {reservationsQuery.isLoading ? (
                <p className="pos-new-customer-list-state" role="status">Loading reservations…</p>
              ) : reservationsQuery.isError ? (
                <div className="pos-new-customer-list-state is-error" role="alert">
                  <p>Unable to load today’s reservations.</p>
                  <button type="button" onClick={() => void reservationsQuery.refetch()}>Retry</button>
                </div>
              ) : reservations.length === 0 ? (
                <p className="pos-new-customer-list-state">No reservations for today</p>
              ) : (
                reservations.map((reservation, index) => (
                  <button
                    key={reservation.id}
                    ref={index === 0 ? (node) => { firstActionRef.current = node; } : undefined}
                    type="button"
                    className={`pos-new-customer-list-row${selectedValue === reservation.id ? " is-selected" : ""}`}
                    onClick={() => selectReservation(reservation)}
                  >
                    <span className="pos-new-customer-avatar">{reservation.customer_name.charAt(0).toUpperCase()}</span>
                    <span className="pos-new-customer-list-copy">
                      <strong>{reservation.customer_name}</strong>
                      <small>
                        {reservation.table_numbers.length ? `Table ${reservation.table_numbers.join(", ")}` : "Table to assign"}
                        {" · "}{reservation.party_size} guests
                      </small>
                    </span>
                    <span className="pos-new-customer-list-time"><Clock3 aria-hidden="true" />{reservation.time}</span>
                    <Check className="pos-new-customer-row-check" aria-hidden="true" />
                  </button>
                ))
              )}
            </section>
          ) : flow.step === "pickup" ? (
            <section className="pos-new-customer-list" aria-label="Pickup order list">
              <label className="pos-new-customer-search">
                <span>Search pickup orders</span>
                <input
                  ref={(node) => { firstActionRef.current = node; }}
                  type="search"
                  aria-label="Search pickup orders by customer or reference"
                  placeholder="Enter at least 2 characters"
                  value={pickupSearch}
                  onChange={(event) => setPickupSearch(event.target.value)}
                />
              </label>
              {pickupSearch.trim().length < 2 ? (
                <p className="pos-new-customer-list-state">Search by customer name or pickup reference.</p>
              ) : pickupOrdersQuery.isFetching ? (
                <p className="pos-new-customer-list-state" role="status">Loading pickup orders…</p>
              ) : pickupOrdersQuery.isError ? (
                <div className="pos-new-customer-list-state is-error" role="alert">
                  <p>Unable to load pickup orders.</p>
                  <button type="button" onClick={() => void pickupOrdersQuery.refetch()}>Retry</button>
                </div>
              ) : pickupOrders.length === 0 ? (
                <p className="pos-new-customer-list-state">No pickup orders found.</p>
              ) : (
                pickupOrders.map((order, index) => (
                  <button
                    key={order.order_number}
                    ref={index === 0 ? (node) => { firstActionRef.current = node; } : undefined}
                    type="button"
                    className={`pos-new-customer-list-row${selectedValue === order.order_number ? " is-selected" : ""}`}
                    onClick={() => selectPickupOrder(order)}
                  >
                    <span className="pos-new-customer-avatar">{order.customer_name.charAt(0).toUpperCase()}</span>
                    <span className="pos-new-customer-list-copy">
                      <strong>{order.customer_name}</strong>
                      <small title={order.order_number}>{order.items.length} item{order.items.length === 1 ? "" : "s"} · {shortRef(order.order_number)}</small>
                    </span>
                    <span className="pos-new-customer-list-time"><Clock3 aria-hidden="true" />{formatPickupTime(order.pickup_time ?? order.created_at)}</span>
                    <Check className="pos-new-customer-row-check" aria-hidden="true" />
                  </button>
                ))
              )}
            </section>
          ) : (
            <section className="pos-new-customer-done">
              <div className="pos-new-customer-success-mark"><Check aria-hidden="true" /></div>
              <p className="pos-new-customer-done-label">Customer path selected</p>
              <div className="pos-new-customer-chips" aria-label="Selected order path">
                {flow.path.map((part, index) => (
                  <span key={`${part}-${index}`}>
                    {index > 0 && <b aria-hidden="true">›</b>}
                    <strong>{part}</strong>
                  </span>
                ))}
              </div>
              <p className="pos-new-customer-done-copy">Your order will continue with the selected customer type.</p>
              <button type="button" ref={(node) => { firstActionRef.current = node; }} className="pos-new-customer-start" onClick={startOrdering}>
                Start ordering <ArrowRight aria-hidden="true" />
              </button>
            </section>
          )}
        </div>

        <footer className="pos-new-customer-footer">
          {initialMode ? (
            <span />
          ) : flow.step !== "service" ? (
            <button type="button" className="pos-new-customer-back" onClick={goBack}>
              <ArrowLeft aria-hidden="true" /> Back
            </button>
          ) : <span />}
          {initialMode
            ? <p>{initialMode === "reservation" ? "Choose a reservation to continue." : "Choose a pickup order to continue."}</p>
            : currentStepConfig && <p>Choose an option <kbd>1</kbd> or <kbd>2</kbd></p>}
          {!initialMode && flow.step !== "service" && <span className="pos-new-customer-escape-hint">Backspace to go back</span>}
        </footer>
      </div>
    </div>
  );
}

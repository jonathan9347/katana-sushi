import { formatCateringEventType, formatVenueType } from "../lib/reservationDetails";
import type { ReservationReceiptData } from "../components/ui/ReservationReceipt";
import type { CommittedDiningOrder } from "../pages/staff/pos/DiningService";
import { getPrintProfile, USE_DRAWN_LOGO, type PrintProfile } from "./printConfig";
import { formatCurrency, formatDate, formatDateTime, formatPaymentMethod, humanizeEnum, shortRef } from "./receiptFormatters";
import { RECEIPT_LOGO_DATA_URL } from "./receiptLogo";

type ReceiptItem = {
  quantity: number;
  name_snapshot?: string | null;
  selling_product?: { name?: string | null };
  total_price: number | string;
  notes?: string | null;
};

type PaidReceiptData = {
  transaction_number: string;
  customer_name?: string | null;
  created_at: string;
  payment_method: string;
  subtotal: number;
  tax: number;
  discount_amount?: number | null;
  discount_base_snapshot?: number | null;
  discount_rate_snapshot?: number | null;
  guest_count?: number | null;
  discount_guest_count?: number | null;
  total: number;
  cash_received?: number | null;
  change_due?: number | null;
  table_number_snapshot?: number | null;
  dining_session?: { table?: { table_number?: number | null } | null } | null;
  items: ReceiptItem[];
  charges?: Array<ReceiptItem & { name_snapshot: string }>;
};

export type BillSlipData = {
  table_number: number;
  a_la_carte_lines: Array<{ name: string; quantity: number; total_price: number }>;
  unlimited_order_lines: Array<{ name: string; quantity: number; total_price: number }>;
  unlimited_lines: Array<{ quantity: number; unit_price: number; total_price: number }>;
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

type TemplateOptions = {
  profile?: PrintProfile;
  printedAt?: string | Date;
};

function escapeHtml(value: unknown) {
  return String(value ?? "").replace(/[&<>"']/g, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    "\"": "&quot;",
    "'": "&#39;"
  })[character] ?? character);
}

function valueText(value: unknown) {
  return value === null || value === undefined ? "" : String(value).trim();
}

function logo(profile: PrintProfile) {
  if (USE_DRAWN_LOGO) {
    // This simplified drawing is a placeholder, not the official Katana Sushi logo.
    return `<svg class="logo" viewBox="0 0 220 96" role="img" aria-label="Katana Sushi logo"><path d="M10 12l70 54" stroke="#000" stroke-width="3" stroke-linecap="round"/><path d="M6 8l10 8" stroke="#000" stroke-width="5" stroke-linecap="round"/><path d="M146 6l-18 62M170 20l-34 40" stroke="#000" stroke-width="2.5" stroke-linecap="round"/><text x="52" y="54" font-family="Arial Black,Impact,sans-serif" font-weight="900" font-size="34" fill="#000" letter-spacing="1">KATANA</text><text x="84" y="76" font-family="Arial Black,Impact,sans-serif" font-weight="900" font-size="17" fill="#000" letter-spacing="2">SUSHI</text></svg>`;
  }

  return `<div class="logo-wrap"><img class="receipt-logo" src="${RECEIPT_LOGO_DATA_URL}" width="${profile.logoWidthPx}" alt="Katana Sushi"><span class="receipt-logo-fallback">KATANA SUSHI</span></div>`;
}

function header(title: string, withLogo: boolean, profile: PrintProfile, titleClass = "receipt-title") {
  return `<header class="receipt-header">${withLogo ? `${logo(profile)}<div class="brand-name">KATANA SUSHI</div>` : ""}<h1 class="${titleClass}">${escapeHtml(title)}</h1></header>`;
}

function inverseBlock(value: string, className = "") {
  return `<div class="inverse-block ${className}">${escapeHtml(value)}</div>`;
}

function divider(heavy = false) {
  return `<div class="${heavy ? "heavy-divider" : "divider"}"></div>`;
}

function section(title: string, content: string) {
  return `<section class="receipt-section"><h2 class="section-title">${escapeHtml(title)}</h2>${content}</section>`;
}

function labelValue(label: string, value: unknown, className = "") {
  const text = valueText(value);
  if (!text) return "";
  return `<div class="label-value ${className}"><span class="label">${escapeHtml(label)}</span><strong class="value">${escapeHtml(text)}</strong></div>`;
}

function row(label: string, value: unknown, strong = false, amount = false) {
  const text = valueText(value);
  if (!text) return "";
  return `<div class="receipt-row${strong ? " strong" : ""}"><span class="row-label">${escapeHtml(label)}</span><span class="row-value${amount ? " amount" : ""}">${escapeHtml(text)}</span></div>`;
}

function itemRow(quantity: number, name: string, amount: number | string, note?: string | null) {
  const itemName = valueText(name);
  if (!itemName) return "";
  const noteText = valueText(note);
  return `<div class="item-row"><strong class="item-quantity">${escapeHtml(quantity)}x</strong><span class="item-name">${escapeHtml(itemName)}${noteText ? `<small class="item-note">${escapeHtml(noteText)}</small>` : ""}</span><strong class="item-amount">${escapeHtml(formatCurrency(Number(amount)))}</strong></div>`;
}

function totalBlock(label: string, amount: number | string) {
  return `<div class="total-block"><strong class="total-label">${escapeHtml(label)}</strong><strong class="total-amount">${escapeHtml(formatCurrency(Number(amount)))}</strong></div>`;
}

function feedSpace() {
  return `<div class="receipt-feed" aria-hidden="true"></div>`;
}

function reservationPaymentStatus(data: ReservationReceiptData, totalPaid: number, remaining: number, total: number) {
  const rawStatus = (data.payment_status ?? data.final_payment_status ?? data.downpayment_status ?? "")
    .toLowerCase()
    .replace(/[\s-]+/g, "_");
  if (rawStatus.includes("fully_paid") || rawStatus === "paid" || rawStatus === "paid_in_full") return "FULLY PAID";
  if (rawStatus.includes("partial") || rawStatus === "pending_final_payment" || totalPaid > 0) return "PARTIALLY PAID";
  if (remaining <= 0 && total <= 0) return "FULLY PAID";
  return "UNPAID";
}

function reservationStatusLine(value: string | null | undefined) {
  const status = (value ?? "").trim().toLowerCase().replace(/[\s-]+/g, "_");
  const statuses: Record<string, string> = {
    pending: "Booking pending approval",
    pending_approval: "Booking pending approval",
    approved: "Booking approved",
    confirmed: "Booking approved",
    declined: "Booking declined",
    rejected: "Booking declined",
    cancelled: "Booking cancelled",
    canceled: "Booking cancelled"
  };
  const label = statuses[status] ?? humanizeEnum(value);
  return label ? (label.startsWith("Booking ") ? label : `Booking ${label.toLowerCase()}`) : "";
}

function paymentHistoryRows(data: ReservationReceiptData) {
  const payments = (data.payment_history ?? []).filter((payment) =>
    !["refund", "refund_downpayment", "cancellation"].includes(payment.payment_stage.toLowerCase())
  );
  return payments.map((payment) => {
    const stage = humanizeEnum(payment.payment_stage);
    const method = formatPaymentMethod(payment.method);
    const label = [stage, method].filter(Boolean).join(" · ");
    const reference = shortRef(payment.reference_number);
    return `<div class="payment-history-entry">${row(label, formatCurrency(Number(payment.amount)), false, true)}
      ${reference ? `<p class="payment-reference">Ref ${escapeHtml(reference)}</p>` : ""}
    </div>`;
  }).join("");
}

export function renderOrderSlip(
  order: CommittedDiningOrder,
  options: TemplateOptions & {
    cashierName?: string;
    tableTotal?: number | null;
    orderType?: string;
    isReprint?: boolean;
  } = {}
) {
  const profile = options.profile ?? getPrintProfile();
  const tableOrType = order.table_number_snapshot === null
    ? valueText(options.orderType) || "TAKEOUT"
    : `TABLE ${order.table_number_snapshot}`;
  const items = order.items.map((item) =>
    itemRow(item.quantity, item.name_snapshot, item.total_price, item.notes)
  ).join("");
  const orderTotal = order.items.reduce((sum, item) => sum + Number(item.total_price), 0);

  return `${header("ORDER SLIP", false, profile, "receipt-title order-title")}
    <div class="not-a-receipt">NOT A RECEIPT</div>
    ${inverseBlock(tableOrType, "table-block")}
    ${options.isReprint ? `<p class="reprint-label">REPRINT</p>` : ""}
    ${labelValue("ORDER NO.", order.order_number)}
    ${labelValue("DATE", formatDateTime(order.created_at))}
    ${labelValue("CASHIER", options.cashierName ?? "Cashier")}
    ${divider(true)}
    ${section("ITEMS", `${items}${divider()}`)}
    ${row("This order total", formatCurrency(orderTotal), false, true)}
    ${row("Table total so far", options.tableTotal == null ? "Unavailable" : formatCurrency(options.tableTotal), true, true)}
    ${divider(true)}
    <p class="receipt-thanks">End of order slip</p>
    ${feedSpace()}`;
}

export function renderBillSlip(preview: BillSlipData, options: TemplateOptions = {}) {
  const profile = options.profile ?? getPrintProfile();
  const groups = [
    preview.a_la_carte_lines.length > 0
      ? section("A LA CARTE ITEMS", `${preview.a_la_carte_lines.map((item) => itemRow(item.quantity, item.name, item.total_price)).join("")}${row("A la carte subtotal", formatCurrency(preview.a_la_carte_lines.reduce((sum, item) => sum + Number(item.total_price), 0)), false, true)}`)
      : "",
    preview.unlimited_order_lines.length > 0
      ? section("ADD-ONS", preview.unlimited_order_lines.map((item) => itemRow(item.quantity, item.name, item.total_price)).join(""))
      : "",
    preview.unlimited_lines.length > 0
      ? section("UNLIMITED", `${preview.unlimited_lines.map((item) => itemRow(item.quantity, "Unlimited package", item.total_price)).join("")}${row("Unlimited subtotal", formatCurrency(preview.unlimited_amount), false, true)}`)
      : "",
    preview.leftover_lines.length > 0
      ? section("LEFTOVER FEES", preview.leftover_lines.map((item) => itemRow(item.quantity, item.name, item.total)).join(""))
      : ""
  ].join("");
  const discount = preview.discount_amount > 0 && preview.discounted_guest_count > 0
    ? row(`Senior/PWD (${preview.discounted_guest_count} guests)`, `-${formatCurrency(preview.discount_amount)}`)
    : "";
  const date = formatDateTime(options.printedAt ?? new Date());

  return `${header("BILL SLIP", true, profile, "receipt-title order-title")}
    <div class="not-a-receipt">NOT A RECEIPT</div>
    ${labelValue("TABLE", preview.table_number)}
    ${labelValue("PRINTED", date)}
    ${divider(true)}
    ${groups}
    ${divider()}
    ${row("Subtotal", formatCurrency(preview.subtotal), false, true)}
    ${discount}
    ${divider(true)}
    ${totalBlock("TOTAL TO PAY", preview.total)}
    ${divider(true)}
    <p class="receipt-thanks">This is not an official receipt.</p>
    <p class="receipt-thanks">Ask for your paid receipt after payment.</p>
    ${feedSpace()}`;
}

export function renderPaidReceipt(
  transaction: PaidReceiptData,
  options: TemplateOptions & { footer?: string } = {}
) {
  const profile = options.profile ?? getPrintProfile();
  const items = transaction.items.map((item) =>
    itemRow(item.quantity, item.name_snapshot ?? item.selling_product?.name ?? "", item.total_price, item.notes)
  ).join("");
  const charges = (transaction.charges ?? []).map((charge) =>
    itemRow(charge.quantity, charge.name_snapshot, charge.total_price, charge.notes)
  ).join("");
  const tableNumber = transaction.table_number_snapshot ?? transaction.dining_session?.table?.table_number;
  const isCash = transaction.payment_method.toLowerCase() === "cash";
  const defaultFooter = "Thank you for dining with us!";
  const customFooter = valueText(options.footer);
  const footer = customFooter && customFooter !== defaultFooter ? `<p class="receipt-thanks">${escapeHtml(customFooter)}</p>` : "";
  const discountAmount = Number(transaction.discount_amount ?? 0);
  const discountDescription = transaction.discount_guest_count && transaction.guest_count
    ? `Senior/PWD discount (${transaction.discount_guest_count} of ${transaction.guest_count} guests)`
    : "Senior/PWD discount";

  return `${header("RECEIPT", true, profile)}
    ${inverseBlock("PAID", "paid-block")}
    ${labelValue("RECEIPT NO.", transaction.transaction_number)}
    ${labelValue("DATE", formatDateTime(transaction.created_at))}
    ${transaction.customer_name ? labelValue("CUSTOMER", transaction.customer_name) : ""}
    ${tableNumber == null ? "" : labelValue("TABLE", tableNumber)}
    ${divider(true)}
    ${section("ITEMS", `${items}${charges}${divider()}`)}
    ${row("Subtotal", formatCurrency(transaction.subtotal), false, true)}
    ${transaction.tax > 0 ? row("Tax", formatCurrency(transaction.tax), false, true) : ""}
    ${discountAmount > 0 ? row(discountDescription, `-${formatCurrency(discountAmount)}`, false, true) : ""}
    ${divider(true)}
    ${totalBlock("TOTAL PAID", transaction.total)}
    ${divider()}
    ${row("Payment", formatPaymentMethod(transaction.payment_method, true))}
    ${isCash ? row("Amount received", formatCurrency(Number(transaction.cash_received ?? transaction.total)), false, true) : ""}
    ${isCash ? row("Change", formatCurrency(Number(transaction.change_due ?? 0)), true, true) : ""}
    ${divider(true)}
    <p class="receipt-thanks strong-thanks">Thank you for dining with us!</p>
    <p class="receipt-thanks">Please come again.</p>
    ${footer}
    ${feedSpace()}`;
}

export function renderCateringReceipt(
  reservation: ReservationReceiptData,
  options: TemplateOptions & {
    totalPaid: number;
    remainingBalance: number;
    total: number;
  }
) {
  const profile = options.profile ?? getPrintProfile();
  const eventDate = reservation.event_date ?? reservation.date;
  const guestCount = reservation.guests ?? reservation.party_size ?? reservation.headcount;
  const eventType = reservation.event_type
    ? formatCateringEventType(reservation.event_type, reservation.event_type_other)
    : valueText(reservation.event_type_other);
  const venue = reservation.venue_address ?? (reservation.venue_type ? formatVenueType(reservation.venue_type) : "");
  const bookingId = reservation.reference ?? reservation.booking_id ?? reservation.reservation_id ?? reservation.id;
  const statusLine = reservationStatusLine(reservation.status ?? reservation.reservation_status);
  const customer = [
    labelValue("NAME", reservation.customer_name),
    labelValue("PHONE", reservation.phone ?? reservation.customer_phone),
    labelValue("EMAIL", reservation.email ?? reservation.customer_email)
  ].join("");
  const event = [
    labelValue("DATE", formatDate(eventDate)),
    guestCount === null || guestCount === undefined ? "" : labelValue("GUESTS", guestCount),
    labelValue("EVENT TYPE", eventType),
    labelValue("PACKAGE", reservation.package_name),
    labelValue("VENUE", venue)
  ].join("");
  const subtotal = reservation.subtotal ?? reservation.package_total;
  const charges = [
    subtotal === null || subtotal === undefined ? "" : row("Subtotal", formatCurrency(Number(subtotal)), false, true),
    reservation.tax === null || reservation.tax === undefined ? "" : row("Tax", formatCurrency(Number(reservation.tax)), false, true),
    row("Total", formatCurrency(options.total), true, true)
  ].join("");
  const payments = paymentHistoryRows(reservation);
  const paymentSection = `${payments}${row("Amount paid", formatCurrency(options.totalPaid), true)}`;

  return `${header("CATERING RECEIPT", true, profile)}
    ${inverseBlock(reservationPaymentStatus(reservation, options.totalPaid, options.remainingBalance, options.total), "status-block")}
    ${statusLine ? `<p class="booking-status">${escapeHtml(statusLine)}</p>` : ""}
    ${labelValue("BOOKING ID", bookingId)}
    ${labelValue("PRINTED", formatDateTime(options.printedAt ?? new Date()))}
    ${divider(true)}
    ${section("CUSTOMER", customer)}
    ${divider()}
    ${section("EVENT", event)}
    ${divider()}
    ${section("CHARGES", charges)}
    ${divider()}
    ${section("PAYMENTS", paymentSection)}
    ${divider(true)}
    ${totalBlock("REMAINING BALANCE", options.remainingBalance)}
    ${divider(true)}
    <p class="receipt-thanks strong-thanks">Thank you for choosing</p>
    <p class="receipt-thanks strong-thanks">Katana Sushi Catering!</p>
    ${feedSpace()}`;
}

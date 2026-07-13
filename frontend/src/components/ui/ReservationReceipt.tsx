import { Printer } from "lucide-react";
import type React from "react";
import { formatManilaDate, formatTime12 } from "../../lib/dateTime";
import { formatCurrencyPHP, formatPaymentPlan, formatStatus, formatVenueType } from "../../lib/reservationDetails";
import { Button } from "./button";

export type ReservationProduct = {
  product_id?: string;
  id?: string;
  name: string;
  quantity: number;
  price: number;
};

type IngredientLock = {
  id?: string;
  reserved_quantity: number;
  unit: string;
  is_released?: boolean;
  raw_material?: {
    id?: string;
    name: string;
  };
};

type PaymentHistoryItem = {
  id: string;
  payment_stage: string;
  method: string;
  amount: number;
  reference_number?: string | null;
  cash_received?: number | null;
  change_due?: number | null;
  source?: string | null;
  received_at?: string | Date | null;
};

export type ReservationReceiptData = {
  id?: string;
  type: "dine_in" | "catering";
  reference?: string | null;
  booking_id?: string | null;
  reservation_id?: string | null;
  customer_name?: string | null;
  phone?: string | null;
  email?: string | null;
  customer_phone?: string | null;
  customer_email?: string | null;
  date?: string | null;
  event_date?: string | null;
  time?: string | null;
  guests?: number | null;
  party_size?: number | null;
  headcount?: number | null;
  status?: string | null;
  reservation_status?: string | null;
  reservation_type?: "dine_in" | "unlimited" | string | null;
  selected_products?: ReservationProduct[];
  subtotal?: number | null;
  tax?: number | null;
  total_price?: number | null;
  payment_plan?: string | null;
  downpayment_amount?: number | null;
  remaining_balance?: number | null;
  payment_status?: string | null;
  final_payment_status?: string | null;
  downpayment_status?: string | null;
  payment_history?: PaymentHistoryItem[];
  package_name?: string | null;
  venue_type?: string | null;
  venue_address?: string | null;
  special_requests?: string | null;
  created_at?: string | null;
  confirmed_date?: string | null;
  package_items?: unknown;
  ingredient_locks?: IngredientLock[];
};

type ReservationReceiptProps = {
  reservation: ReservationReceiptData;
  actions?: React.ReactNode;
  paymentControls?: React.ReactNode;
  showPrintButton?: boolean;
  onClose?: () => void;
};

function money(value?: number | null) {
  return formatCurrencyPHP(value ?? undefined);
}

function numberValue(value?: number | null) {
  return Number(value ?? 0);
}

function formatDateTime(value?: string | null) {
  if (!value) return "N/A";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "N/A";
  return date.toLocaleString("en-PH", {
    year: "numeric",
    month: "long",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit"
  });
}

function getReference(reservation: ReservationReceiptData) {
  return reservation.reference ?? reservation.booking_id ?? reservation.reservation_id ?? "N/A";
}

function getStatus(reservation: ReservationReceiptData) {
  return reservation.status ?? reservation.reservation_status ?? "N/A";
}

function getReservationLabel(reservation: ReservationReceiptData) {
  if (reservation.type === "catering") return "Catering";
  return reservation.reservation_type === "unlimited" ? "Unlimited" : "Dine-in Ala Carte";
}

function getGuestCount(reservation: ReservationReceiptData) {
  return reservation.guests ?? reservation.party_size ?? reservation.headcount ?? 0;
}

function getPaymentStatus(reservation: ReservationReceiptData) {
  return reservation.payment_status ?? reservation.final_payment_status ?? reservation.downpayment_status ?? "N/A";
}

function formatPaymentMethod(method?: string | null) {
  if (method === "bank_transfer") return "BPI";
  if (method === "gcash") return "GCash";
  if (method === "cash") return "Cash";
  return method ?? "N/A";
}

function getPackageItems(packageItems: unknown): string[] {
  if (!packageItems || typeof packageItems !== "object") return [];
  const items = packageItems as { inclusions?: Array<string | { name?: string }> };
  return (items.inclusions ?? [])
    .map((item) => (typeof item === "string" ? item : item.name ?? ""))
    .filter(Boolean);
}

function getTotals(reservation: ReservationReceiptData) {
  const products = reservation.selected_products ?? [];
  const productSubtotal = products.reduce((sum, item) => sum + numberValue(item.price) * numberValue(item.quantity), 0);
  const total = numberValue(reservation.total_price);
  const subtotal = numberValue(reservation.subtotal) || productSubtotal || (total ? Number((total / 1.12).toFixed(2)) : 0);
  const tax = reservation.tax !== undefined && reservation.tax !== null ? numberValue(reservation.tax) : Number((subtotal * 0.12).toFixed(2));

  return {
    subtotal,
    tax,
    total: total || Number((subtotal + tax).toFixed(2))
  };
}

function DetailRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[130px_minmax(0,1fr)] gap-3 py-1 text-sm">
      <dt className="font-semibold uppercase tracking-wide text-slate-500">{label}</dt>
      <dd className="min-w-0 font-medium text-slate-950">{value || "N/A"}</dd>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="border-t border-dashed border-slate-300 py-4">
      <h3 className="mb-3 text-xs font-black uppercase tracking-[0.2em] text-slate-800">{title}</h3>
      {children}
    </section>
  );
}

export function ReservationReceipt({ reservation, actions, paymentControls, showPrintButton = true, onClose }: ReservationReceiptProps) {
  const products = reservation.selected_products ?? [];
  const packageItems = getPackageItems(reservation.package_items);
  const locks = reservation.ingredient_locks ?? [];
  const totals = getTotals(reservation);
  const isCatering = reservation.type === "catering";
  const isUnlimited = reservation.reservation_type === "unlimited";
  const eventDate = reservation.event_date ?? reservation.date;
  const guestCount = getGuestCount(reservation);
  const paymentStatus = getPaymentStatus(reservation);
  const paymentHistory = reservation.payment_history ?? [];
  const totalPaid = paymentHistory.length > 0
    ? paymentHistory.reduce((sum, payment) => sum + numberValue(payment.amount), 0)
    : numberValue(reservation.downpayment_amount);

  return (
    <div className="reservation-print-scope">
      <div className="receipt mx-auto max-w-3xl rounded-lg border border-slate-300 bg-white p-4 font-mono text-slate-950 shadow-sm sm:p-6">
        <header className="text-center">
          <p className="text-xl font-black tracking-[0.22em]">KATANA SUSHI</p>
          <p className="mt-1 text-xs uppercase tracking-[0.16em] text-slate-500">Authentic Japanese Sushi</p>
          <div className="my-4 border-t border-dashed border-slate-300" />
          <p className="text-sm font-black uppercase tracking-[0.2em]">Reservation Details</p>
        </header>

        <Section title="Booking Information">
          <dl>
            <DetailRow label="Booking ID" value={getReference(reservation)} />
            <DetailRow label="Type" value={getReservationLabel(reservation)} />
            <DetailRow label="Status" value={formatStatus(getStatus(reservation)).toUpperCase()} />
            <DetailRow label="Created" value={formatDateTime(reservation.created_at)} />
          </dl>
        </Section>

        <Section title="Customer Details">
          <dl>
            <DetailRow label="Name" value={reservation.customer_name} />
            <DetailRow label="Phone" value={reservation.phone ?? reservation.customer_phone} />
            <DetailRow label="Email" value={reservation.email ?? reservation.customer_email} />
          </dl>
        </Section>

        <Section title={isCatering ? "Event Details" : "Reservation Details"}>
          <dl>
            <DetailRow label={isCatering ? "Event Date" : "Date"} value={eventDate ? formatManilaDate(eventDate) : "N/A"} />
            {!isCatering && <DetailRow label="Time" value={reservation.time ? formatTime12(reservation.time) : "N/A"} />}
            <DetailRow label={isCatering ? "Headcount" : "Guests"} value={`${guestCount} ${isCatering ? "pax" : "people"}`} />
            {isCatering && <DetailRow label="Package" value={reservation.package_name} />}
            {isCatering && <DetailRow label="Venue" value={formatVenueType(reservation.venue_address ?? reservation.venue_type)} />}
          </dl>
        </Section>

        <Section title={isCatering ? "Package Details" : isUnlimited ? "Unlimited Package" : "Order Details"}>
          {isCatering ? (
            <div className="space-y-3 text-sm">
              <DetailRow label="Package" value={reservation.package_name} />
              <div>
                <p className="font-semibold uppercase tracking-wide text-slate-500">Included Items</p>
                {packageItems.length > 0 ? (
                  <ul className="mt-2 grid gap-1 sm:grid-cols-2">
                    {packageItems.map((item) => (
                      <li key={item} className="rounded border border-slate-200 px-2 py-1">{item}</li>
                    ))}
                  </ul>
                ) : (
                  <p className="mt-1 text-slate-600">No package inclusions recorded.</p>
                )}
              </div>
            </div>
          ) : products.length > 0 ? (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[520px] text-left text-sm">
                <thead className="border-b border-dashed border-slate-300 text-xs uppercase tracking-wide text-slate-500">
                  <tr>
                    <th className="py-2 pr-3">Item</th>
                    <th className="py-2 pr-3 text-right">Qty</th>
                    <th className="py-2 pr-3 text-right">Unit</th>
                    <th className="py-2 text-right">Total</th>
                  </tr>
                </thead>
                <tbody>
                  {products.map((item, index) => (
                    <tr key={item.product_id ?? item.id ?? `${item.name}-${index}`} className="border-b border-dashed border-slate-200">
                      <td className="py-2 pr-3 font-semibold">{item.name}</td>
                      <td className="py-2 pr-3 text-right">x{item.quantity}</td>
                      <td className="py-2 pr-3 text-right">{money(item.price)}</td>
                      <td className="py-2 text-right font-semibold">{money(numberValue(item.price) * numberValue(item.quantity))}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="text-sm text-slate-600">No ordered products recorded.</p>
          )}

          <div className="mt-4 space-y-1 border-t border-dashed border-slate-300 pt-3 text-sm">
            <div className="flex justify-between gap-4"><span>Subtotal</span><span>{money(totals.subtotal)}</span></div>
            <div className="flex justify-between gap-4"><span>Tax (12%)</span><span>{money(totals.tax)}</span></div>
            <div className="flex justify-between gap-4 text-base font-black"><span>Total</span><span>{money(totals.total)}</span></div>
          </div>
        </Section>

        <Section title="Payment Summary">
          <dl>
            <DetailRow label="Plan" value={formatPaymentPlan(reservation.payment_plan)} />
            <DetailRow label="Amount Paid" value={money(totalPaid)} />
            <DetailRow label="Remaining" value={money(reservation.remaining_balance)} />
            <DetailRow label="Status" value={numberValue(reservation.remaining_balance) <= 0 || paymentStatus === "paid" ? "FULLY PAID" : "PENDING"} />
          </dl>
          {paymentControls ? <div className="mt-4">{paymentControls}</div> : null}
          <div className="mt-4">
            <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">Payment History</p>
            {paymentHistory.length > 0 ? (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[520px] text-left text-sm">
                  <thead className="border-b border-dashed border-slate-300 text-xs uppercase tracking-wide text-slate-500">
                    <tr>
                      <th className="py-2 pr-3">Stage</th>
                      <th className="py-2 pr-3">Method</th>
                      <th className="py-2 pr-3">Reference</th>
                      <th className="py-2 text-right">Amount</th>
                    </tr>
                  </thead>
                  <tbody>
                    {paymentHistory.map((payment) => (
                      <tr key={payment.id} className="border-b border-dashed border-slate-200">
                        <td className="py-2 pr-3 font-semibold">{formatStatus(payment.payment_stage)}</td>
                        <td className="py-2 pr-3">{formatPaymentMethod(payment.method)}</td>
                        <td className="py-2 pr-3">{payment.reference_number ?? (payment.change_due ? `Change: ${money(payment.change_due)}` : "-")}</td>
                        <td className="py-2 text-right font-semibold">{money(payment.amount)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <p className="text-sm text-slate-600">No payments recorded.</p>
            )}
          </div>
        </Section>

        {isCatering && (
          <Section title="Ingredient Locks">
            <DetailRow label="Status" value={locks.some((lock) => !lock.is_released) ? "LOCKED" : locks.length > 0 ? "RELEASED" : "NOT LOCKED"} />
            {locks.length > 0 ? (
              <ul className="mt-2 grid gap-1 text-sm sm:grid-cols-2">
                {locks.map((lock, index) => (
                  <li key={lock.id ?? index} className="rounded border border-slate-200 px-2 py-1">
                    {lock.raw_material?.name ?? "Ingredient"}: {lock.reserved_quantity} {lock.unit}
                    {lock.is_released ? " (released)" : ""}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-slate-600">No ingredient locks recorded.</p>
            )}
          </Section>
        )}

        <Section title="Reservation Timeline">
          <ul className="space-y-2 text-sm">
            <li>Created: {formatDateTime(reservation.created_at)}</li>
            <li>Payment: {formatStatus(paymentStatus)}</li>
            <li>Current status: {formatStatus(getStatus(reservation))}</li>
            {reservation.confirmed_date && <li>Confirmed: {formatDateTime(reservation.confirmed_date)}</li>}
          </ul>
        </Section>

        {reservation.special_requests ? (
          <Section title="Notes">
            <p className="whitespace-pre-wrap text-sm">{reservation.special_requests}</p>
          </Section>
        ) : null}

        <div className="receipt-actions mt-5 flex flex-col gap-3 border-t border-dashed border-slate-300 pt-4 sm:flex-row sm:justify-end">
          {showPrintButton && (
            <Button type="button" variant="outline" onClick={() => window.print()}>
              <Printer className="h-4 w-4" /> Print Receipt
            </Button>
          )}
          {actions}
          {onClose && (
            <Button type="button" variant="outline" onClick={onClose}>
              Close
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}

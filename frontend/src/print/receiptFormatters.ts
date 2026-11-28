import { formatManilaDate, formatManilaDateTime } from "../lib/dateTime";
import { humanizeEnum as humanizeDisplayEnum } from "../lib/display";

export function formatCurrency(value: number) {
  if (!Number.isFinite(value)) return "";
  const absoluteValue = new Intl.NumberFormat("en-PH", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  }).format(Math.abs(value));
  return `${value < 0 ? "-" : ""}PHP ${absoluteValue}`;
}

export function formatDateTime(value: string | Date | null | undefined) {
  if (!value) return "";
  const date = formatManilaDateTime(value, { month: "short" });
  return date === "Invalid date" ? "" : date.replace(/, (\d{1,2}:)/, " · $1");
}

export function formatDate(value: string | Date | null | undefined) {
  if (!value) return "";
  const date = formatManilaDate(value, {
    weekday: "short",
    month: "short",
    day: "numeric",
    year: "numeric"
  });
  return date === "Invalid date" ? "" : date;
}

export function humanizeEnum(value: string | null | undefined) {
  const label = humanizeDisplayEnum(value);
  if (!label || label === "Not available") return "";
  return label.charAt(0).toUpperCase() + label.slice(1).toLowerCase();
}

export function shortRef(value: string | null | undefined) {
  const reference = value?.trim();
  return reference ? `…${reference.slice(-4)}` : "";
}

export function formatPaymentMethod(value: string | null | undefined, uppercase = false) {
  if (!value?.trim()) return "";
  const normalized = value.trim().toLowerCase();
  const labels: Record<string, string> = {
    cash: "Cash",
    gcash: "GCash",
    bank_transfer: "BPI",
    bpi: "BPI",
    paymongo: "PayMongo"
  };
  const label = labels[normalized] ?? humanizeEnum(value);
  return uppercase ? label.toUpperCase() : label;
}

import { humanizeEnum } from "./display";

export function formatStatus(status: string) {
  return humanizeEnum(status);
}

export function formatVenueType(venueType?: string | null) {
  return venueType ? humanizeEnum(venueType) : "N/A";
}

export function formatCateringEventType(eventType?: string | null, eventTypeOther?: string | null) {
  if (eventType === "Others") {
    return eventTypeOther?.trim() ? `Other — ${eventTypeOther.trim()}` : "Other";
  }

  return eventType ? humanizeEnum(eventType) : "N/A";
}

export function formatPaymentPlan(paymentPlan?: string | null) {
  return paymentPlan ? humanizeEnum(paymentPlan) : "N/A";
}

export function formatCurrencyPHP(value?: number) {
  if (value === undefined) return "N/A";
  return new Intl.NumberFormat("en-PH", { style: "currency", currency: "PHP" }).format(value);
}

export function formatStatus(status: string) {
  return status.replace(/_/g, " ");
}

export function formatVenueType(venueType?: string | null) {
  return venueType ?? "N/A";
}

export function formatPaymentPlan(paymentPlan?: string | null) {
  return paymentPlan?.replace(/_/g, " ") ?? "N/A";
}

export function formatCurrencyPHP(value?: number) {
  if (value === undefined) return "N/A";
  return new Intl.NumberFormat("en-PH", { style: "currency", currency: "PHP" }).format(value);
}

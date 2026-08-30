import { api } from "./api";

export type SystemSettings = {
  restaurant_name: string;
  timezone: string;
  currency: string;
  tax_rate_percent: number;
  receipt_paper_size: string;
  receipt_footer: string;
  max_party_size: number;
  reservation_duration_minutes: number;
  reservation_grace_period_minutes: number;
  minimum_catering_pax: number;
  default_downpayment_percent: number;
  auto_lock_catering_ingredients: boolean;
  release_catering_locks_on_completion: boolean;
  default_reorder_level: number;
  low_stock_threshold_percent: number;
  auto_reorder_enabled: boolean;
  email_notifications_enabled: boolean;
  sms_notifications_enabled: boolean;
  low_stock_alerts_enabled: boolean;
};

export const defaultSystemSettings: SystemSettings = {
  restaurant_name: "Katana Sushi",
  timezone: "Asia/Manila",
  currency: "PHP",
  tax_rate_percent: 12,
  receipt_paper_size: "80mm",
  receipt_footer: "Thank you for dining with us!",
  max_party_size: 30,
  reservation_duration_minutes: 90,
  reservation_grace_period_minutes: 15,
  minimum_catering_pax: 10,
  default_downpayment_percent: 50,
  auto_lock_catering_ingredients: true,
  release_catering_locks_on_completion: true,
  default_reorder_level: 10,
  low_stock_threshold_percent: 100,
  auto_reorder_enabled: false,
  email_notifications_enabled: true,
  sms_notifications_enabled: false,
  low_stock_alerts_enabled: true
};

export async function fetchSystemSettings() {
  const response = await api.get<{ settings: SystemSettings }>("/api/settings/system");
  return response.data.settings;
}

export async function saveSystemSettings(settings: SystemSettings) {
  const response = await api.put<{ settings: SystemSettings }>("/api/admin/settings/system", settings);
  return response.data.settings;
}

export function getTaxRate(settings?: Pick<SystemSettings, "tax_rate_percent"> | null) {
  return Number(settings?.tax_rate_percent ?? defaultSystemSettings.tax_rate_percent) / 100;
}

export function taxLabel(settings?: Pick<SystemSettings, "tax_rate_percent"> | null) {
  return `Tax (${Number(settings?.tax_rate_percent ?? defaultSystemSettings.tax_rate_percent).toLocaleString()}%)`;
}

export function getDownpaymentRate(settings?: Pick<SystemSettings, "default_downpayment_percent"> | null) {
  return Number(settings?.default_downpayment_percent ?? defaultSystemSettings.default_downpayment_percent) / 100;
}

export function downpaymentLabel(settings?: Pick<SystemSettings, "default_downpayment_percent"> | null) {
  return `Downpayment (${Number(settings?.default_downpayment_percent ?? defaultSystemSettings.default_downpayment_percent).toLocaleString()}%)`;
}

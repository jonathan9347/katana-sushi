import { useQuery } from "@tanstack/react-query";
import { api } from "./api";

export type PaymentMethod = "cash" | "gcash" | "bank_transfer" | "paymongo";
export type ReservationType = "dine_in" | "catering" | "takeout";

export type PaymentIntentRequest = {
  amount: number;
  paymentMethod: PaymentMethod;
  bookingId: string;
  reservationType: ReservationType;
  purpose?: "downpayment" | "full_payment" | "balance";
  idempotencyKey?: string;
  description?: string;
  successUrl?: string;
  failureUrl?: string;
};

export type PaymentIntentResponse = {
  success: boolean;
  qrCode?: string;
  paymentUrl?: string;
  referenceId: string;
  instructions?: string;
  expiresAt?: string;
  alreadyPaid?: boolean;
  message?: string;
};

export type PaymentConfig = {
  gateway: string;
  /** True when customers pay on PayMongo's hosted checkout page. */
  hostedCheckout: boolean;
  testMode: boolean;
  available: boolean;
  methods: string[];
  /** PayMongo publishable key; lets the browser send card details straight to PayMongo. */
  publicKey?: string | null;
};

export type PaymentChannel = "qrph" | "card" | "gcash" | "paymaya";

export type PaymentNextAction =
  | { type: "qr"; imageUrl: string; expiresAt?: string; testUrl?: string }
  | { type: "redirect"; url: string };

export type StartPaymentResponse = {
  referenceId?: string;
  status: "paid" | "action_required" | "pending" | "failed";
  nextAction?: PaymentNextAction;
  message?: string;
};

export type CardDetails = {
  name: string;
  number: string;
  expMonth: number;
  expYear: number;
  cvc: string;
};

export type PaymentVerifyRequest = {
  referenceId: string;
  bookingId: string;
  gatewayData?: unknown;
};

export type PaymentVerificationResponse = {
  success: boolean;
  status: "paid" | "pending" | "failed" | "refunded" | "expired";
  amount: number;
  transactionId: string;
  paidAt?: string;
  message?: string;
};

export type PaymentStatusResponse = {
  success: boolean;
  referenceId: string;
  bookingId: string;
  amount: number;
  paymentMethod: PaymentMethod;
  reservationType: ReservationType;
  purpose: "downpayment" | "full_payment" | "balance";
  status: "paid" | "created" | "pending" | "failed" | "expired" | "cancelled";
  transactionId?: string | null;
  paidAt?: string | null;
  expiresAt?: string | null;
  nextAction?: PaymentNextAction | null;
  lastError?: string | null;
  message?: string;
};

type CustomerPaymentAttempt = {
  fingerprint: string;
  bookingId: string;
  idempotencyKey: string;
  referenceId?: string;
};

type CustomerPaymentFlow = "dine_in" | "catering";

function paymentAttemptStorageKey(flow: CustomerPaymentFlow) {
  return `katana:pending-payment:${flow}`;
}

async function paymentAttemptFingerprint(value: unknown) {
  const serialized = JSON.stringify(value) ?? "undefined";
  const digest = await window.crypto.subtle.digest("SHA-256", new TextEncoder().encode(serialized));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function readPaymentAttempt(flow: CustomerPaymentFlow): CustomerPaymentAttempt | null {
  const stored = sessionStorage.getItem(paymentAttemptStorageKey(flow));
  if (!stored) {
    return null;
  }

  try {
    const parsed = JSON.parse(stored) as Partial<CustomerPaymentAttempt>;
    if (
      typeof parsed.fingerprint === "string" &&
      typeof parsed.bookingId === "string" &&
      typeof parsed.idempotencyKey === "string" &&
      (!parsed.referenceId || typeof parsed.referenceId === "string")
    ) {
      return {
        fingerprint: parsed.fingerprint,
        bookingId: parsed.bookingId,
        idempotencyKey: parsed.idempotencyKey,
        referenceId: parsed.referenceId
      };
    }
  } catch {
    sessionStorage.removeItem(paymentAttemptStorageKey(flow));
    return null;
  }

  sessionStorage.removeItem(paymentAttemptStorageKey(flow));
  return null;
}

function writePaymentAttempt(flow: CustomerPaymentFlow, attempt: CustomerPaymentAttempt) {
  sessionStorage.setItem(paymentAttemptStorageKey(flow), JSON.stringify(attempt));
}

export async function getOrCreateCustomerPaymentAttempt(
  flow: CustomerPaymentFlow,
  request: unknown,
  bookingPrefix?: string,
  idempotencyPurpose = "downpayment"
) {
  const fingerprint = await paymentAttemptFingerprint(request);
  const existing = readPaymentAttempt(flow);
  if (existing?.fingerprint === fingerprint) {
    return existing;
  }

  const bookingId = buildReservationReference(bookingPrefix ?? (flow === "dine_in" ? "KTN-DINE" : "CAT"));
  const attempt: CustomerPaymentAttempt = {
    fingerprint,
    bookingId,
    idempotencyKey: `customer:${bookingId}:${idempotencyPurpose}`
  };
  writePaymentAttempt(flow, attempt);
  return attempt;
}

export function saveCustomerPaymentIntentReference(
  flow: CustomerPaymentFlow,
  bookingId: string,
  referenceId: string
) {
  const attempt = readPaymentAttempt(flow);
  if (attempt?.bookingId !== bookingId) {
    return;
  }

  writePaymentAttempt(flow, { ...attempt, referenceId });
}

export function clearCustomerPaymentAttempt(flow: CustomerPaymentFlow, bookingId?: string) {
  const attempt = readPaymentAttempt(flow);
  if (bookingId && attempt?.bookingId !== bookingId) {
    return;
  }

  sessionStorage.removeItem(paymentAttemptStorageKey(flow));
}

export function getSavedCustomerPaymentAttempt(flow: CustomerPaymentFlow) {
  return readPaymentAttempt(flow);
}

export async function createPaymentIntent(params: PaymentIntentRequest) {
  const response = await api.post<PaymentIntentResponse>("/api/payments/create-intent", params);
  return response.data;
}

export async function verifyPayment(params: PaymentVerifyRequest) {
  const response = await api.post<PaymentVerificationResponse>("/api/payments/verify", params);
  return response.data;
}

export async function getPaymentConfig() {
  const response = await api.get<PaymentConfig>("/api/payments/config");
  return response.data;
}

export function usePaymentConfig() {
  return useQuery({
    queryKey: ["payment-config"],
    queryFn: getPaymentConfig,
    staleTime: 5 * 60 * 1000,
    retry: 1
  });
}

/** Katana's own payment page for an open PayMongo payment. */
export function paymentPagePath(referenceId: string) {
  return `/payment/${encodeURIComponent(referenceId)}`;
}

export async function startOnlinePayment(
  referenceId: string,
  body: { channel: PaymentChannel; paymentMethodId?: string; returnUrl: string }
) {
  const response = await api.post<StartPaymentResponse>(`/api/payments/${encodeURIComponent(referenceId)}/pay`, body);
  return response.data;
}

export async function getPaymentBilling(referenceId: string) {
  const response = await api.get<{ name: string | null; email: string | null }>(
    `/api/payments/${encodeURIComponent(referenceId)}/billing`
  );
  return response.data;
}

/**
 * Sends card details straight from the browser to PayMongo using the publishable
 * key. The card number never reaches Katana's server; only the pm_ id does.
 */
export async function createCardPaymentMethod(
  publicKey: string,
  card: CardDetails,
  billing: { name: string; email: string }
) {
  const response = await fetch("https://api.paymongo.com/v1/payment_methods", {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
      Authorization: `Basic ${window.btoa(`${publicKey}:`)}`
    },
    body: JSON.stringify({
      data: {
        attributes: {
          type: "card",
          details: {
            card_number: card.number,
            exp_month: card.expMonth,
            exp_year: card.expYear,
            cvc: card.cvc
          },
          billing: { name: card.name || billing.name, email: billing.email }
        }
      }
    })
  });
  const payload = await response.json().catch(() => null) as
    | { data?: { id?: string }; errors?: Array<{ detail?: string }> }
    | null;
  if (!response.ok || !payload?.data?.id) {
    throw new Error(payload?.errors?.[0]?.detail ?? "Your card could not be checked. Please review the details.");
  }
  return payload.data.id;
}

/** Leaves the site for a wallet or bank page PayMongo asked us to open. */
export function redirectToPaymentProvider(url: string) {
  const target = new URL(url);
  if (target.protocol !== "https:" || !target.hostname.endsWith("paymongo.com")) {
    throw new Error("Unexpected payment page. Please try again.");
  }
  window.location.assign(target.toString());
}

/** Where PayMongo sends the customer back after paying or cancelling. */
export function paymentReturnUrl() {
  return `${window.location.origin}/payment/return`;
}

export const PAYMONGO_METHOD_LABELS: Record<string, string> = {
  qrph: "QR Ph",
  card: "Card",
  gcash: "GCash",
  paymaya: "Maya",
  grab_pay: "GrabPay",
  billease: "BillEase",
  dob: "Online banking"
};

export function formatPayMongoMethods(methods: string[]) {
  return methods.map((method) => PAYMONGO_METHOD_LABELS[method] ?? method).join(", ");
}

export function formatPaymentMethodLabel(method?: string | null) {
  if (method === "bank_transfer") return "BPI";
  if (method === "gcash") return "GCash";
  if (method === "cash") return "Cash";
  if (method === "paymongo") return "PayMongo (online)";
  return method ?? "N/A";
}

export async function getPaymentStatus(referenceId: string) {
  const response = await api.get<PaymentStatusResponse>(`/api/payments/status/${encodeURIComponent(referenceId)}`);
  return response.data;
}

export function buildReservationReference(prefix: string) {
  return `${prefix}-${Date.now().toString(36).toUpperCase()}-${Math.random()
    .toString(36)
    .substring(2, 8)
    .toUpperCase()}`;
}

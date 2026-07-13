import { api } from "./api";

export type PaymentMethod = "cash" | "gcash" | "bank_transfer";
export type ReservationType = "dine_in" | "catering";

export type PaymentIntentRequest = {
  amount: number;
  paymentMethod: PaymentMethod;
  bookingId: string;
  reservationType: ReservationType;
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
  message?: string;
};

export type PaymentVerifyRequest = {
  referenceId: string;
  bookingId: string;
  gatewayData?: unknown;
};

export type PaymentVerificationResponse = {
  success: boolean;
  status: "paid" | "pending" | "failed" | "refunded";
  amount: number;
  transactionId: string;
  paidAt?: string;
  message?: string;
};

export async function createPaymentIntent(params: PaymentIntentRequest) {
  const response = await api.post<PaymentIntentResponse>("/api/payments/create-intent", params);
  return response.data;
}

export async function verifyPayment(params: PaymentVerifyRequest) {
  const response = await api.post<PaymentVerificationResponse>("/api/payments/verify", params);
  return response.data;
}

export function buildReservationReference(prefix: string) {
  return `${prefix}-${Date.now().toString(36).toUpperCase()}-${Math.random()
    .toString(36)
    .substring(2, 8)
    .toUpperCase()}`;
}

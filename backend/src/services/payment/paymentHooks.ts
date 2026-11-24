import type { StoredPaymentIntent } from "./paymentIntentStore";

export type PaymentPurpose = "downpayment" | "full_payment" | "balance";

export type PayableBookingCheck =
  | {
      ok: true;
      /** The amount due, computed by the server from the booking. */
      amount: number;
      lineItemName: string;
      description: string;
      customer?: { name?: string; email?: string; phone?: string };
    }
  | { ok: false; status: number; message: string };

type PaymentHooks = {
  /** Confirms a booking can take this payment now and returns the server-side amount due. */
  resolvePayableBooking?: (input: {
    bookingId: string;
    reservationType: "dine_in" | "catering" | "takeout";
    purpose: PaymentPurpose;
  }) => Promise<PayableBookingCheck>;
  /** Applies a confirmed hosted-checkout payment to its booking. Must be idempotent. */
  fulfillPayment?: (intent: StoredPaymentIntent & { transactionId: string }) => Promise<void>;
  /** Only redirect customers back to frontends we trust. */
  isAllowedReturnUrl?: (url: string) => boolean;
};

const hooks: PaymentHooks = {};

/**
 * The booking rules live in app.ts; registering them here lets the payment
 * service and webhook use them without a circular import.
 */
export function registerPaymentHooks(next: PaymentHooks) {
  Object.assign(hooks, next);
}

export function getPaymentHooks(): Readonly<PaymentHooks> {
  return hooks;
}

export type GatewayPaymentMethod = "cash" | "gcash" | "bank_transfer" | "paymongo";

/** Ways a customer can pay on Katana's own PayMongo payment page. */
export type OnlinePaymentChannel = "qrph" | "card" | "gcash" | "paymaya";

/** What the customer must do next after choosing a payment method. */
export type PaymentNextAction =
  | { type: "qr"; imageUrl: string; expiresAt?: string; testUrl?: string }
  | { type: "redirect"; url: string };

export interface StartPaymentInput {
  channel: OnlinePaymentChannel;
  /** Card payments: a payment method the browser created directly with PayMongo. */
  paymentMethodId?: string;
  billing?: { name?: string; email?: string; phone?: string };
  returnUrl: string;
}

export interface StartPaymentResult {
  status: "paid" | "action_required" | "pending" | "failed";
  nextAction?: PaymentNextAction;
  message?: string;
}

export interface PaymentGateway {
  readonly gatewayName: string;
  /** True when the customer completes payment on a page hosted by the provider (redirect + webhook). */
  readonly isHostedCheckout: boolean;
  /** True when no real money moves (fake gateway or provider test keys). */
  readonly isTestMode: boolean;

  createPaymentIntent(params: CreatePaymentIntentParams): Promise<PaymentIntentResult>;
  verifyPayment(params: VerifyPaymentParams): Promise<VerifyPaymentResult>;
  processRefund(params: RefundParams): Promise<RefundResult>;
  /** Returns the hosted checkout URL again while that checkout can still be paid. */
  resumePaymentIntent?(gatewayReference: string): Promise<{ paymentUrl: string } | null>;
  /** Stops a hosted checkout from accepting payment. */
  cancelPaymentIntent?(gatewayReference: string): Promise<void>;
  /** Attaches the customer's chosen payment method and returns what they must do next. */
  startPayment?(gatewayReference: string, input: StartPaymentInput): Promise<StartPaymentResult>;
}

export interface CreatePaymentIntentParams {
  amount: number;
  paymentMethod: GatewayPaymentMethod;
  bookingId: string;
  reservationType: "dine_in" | "catering" | "takeout";
  purpose?: "downpayment" | "full_payment" | "balance";
  idempotencyKey?: string;
  description?: string;
  /** Hosted checkout: where the provider sends the customer after paying. */
  successUrl?: string;
  /** Hosted checkout: where the provider sends the customer after cancelling. */
  failureUrl?: string;
  /** Hosted checkout: our reference, generated before the provider session exists. */
  referenceId?: string;
  lineItemName?: string;
  customer?: { name?: string; email?: string; phone?: string };
}

export interface PaymentIntentResult {
  success: boolean;
  qrCode?: string;
  paymentUrl?: string;
  referenceId: string;
  /** Provider-side identifier (for PayMongo, the checkout session id). */
  gatewayReference?: string;
  instructions?: string;
  expiresAt?: Date;
  alreadyPaid?: boolean;
  message?: string;
  httpStatus?: number;
}

export interface VerifyPaymentParams {
  referenceId: string;
  bookingId: string;
  gatewayReference?: string;
  gatewayData?: any;
}

export interface VerifyPaymentResult {
  success: boolean;
  status: "paid" | "pending" | "failed" | "refunded" | "expired";
  amount: number;
  transactionId: string;
  paidAt?: Date;
  /** Hosted checkout: the channel the customer used, e.g. gcash, card, qrph, paymaya. */
  paymentChannel?: string;
  /** Still pending: what the customer still has to do (for example, scan the QR code). */
  nextAction?: PaymentNextAction;
  /** Still pending: why the last attempt failed, if it did. */
  lastError?: string;
  message?: string;
}

export interface RefundParams {
  transactionId: string;
  amount: number;
  reason: string;
}

export interface RefundResult {
  success: boolean;
  refundId: string;
  message: string;
}

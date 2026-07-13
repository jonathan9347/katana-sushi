export interface PaymentGateway {
  readonly gatewayName: string;

  createPaymentIntent(params: CreatePaymentIntentParams): Promise<PaymentIntentResult>;
  verifyPayment(params: VerifyPaymentParams): Promise<VerifyPaymentResult>;
  processRefund(params: RefundParams): Promise<RefundResult>;
}

export interface CreatePaymentIntentParams {
  amount: number;
  paymentMethod: "cash" | "gcash" | "bank_transfer";
  bookingId: string;
  reservationType: "dine_in" | "catering";
  description?: string;
  successUrl?: string;
  failureUrl?: string;
}

export interface PaymentIntentResult {
  success: boolean;
  qrCode?: string;
  paymentUrl?: string;
  referenceId: string;
  instructions?: string;
  expiresAt?: Date;
}

export interface VerifyPaymentParams {
  referenceId: string;
  bookingId: string;
  gatewayData?: any;
}

export interface VerifyPaymentResult {
  success: boolean;
  status: "paid" | "pending" | "failed" | "refunded";
  amount: number;
  transactionId: string;
  paidAt?: Date;
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

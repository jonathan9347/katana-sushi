export type FakePaymentReservationType = "dine_in" | "catering";
export type FakePaymentPlan = "initial_only" | "full_payment";
export type FakePaymentMethod = "cash" | "gcash" | "bank_transfer";

export type FakePaymentParams = {
  amount: number;
  paymentMethod: FakePaymentMethod;
  bookingId: string;
  reservationType: FakePaymentReservationType;
  paymentPlan: FakePaymentPlan;
};

export type FakePaymentResult = {
  success: boolean;
  transactionId: string;
  message: string;
  timestamp: string;
  amount: number;
  paymentMethod: FakePaymentMethod;
  paymentPlan: FakePaymentPlan;
};

export class FakePaymentService {
  async processPayment(params: FakePaymentParams): Promise<FakePaymentResult> {
    console.log("[FAKE PAYMENT] Processing:", {
      amount: params.amount,
      method: params.paymentMethod,
      bookingId: params.bookingId,
      reservationType: params.reservationType,
      paymentPlan: params.paymentPlan
    });

    await this.delay(500);

    const transactionId = `FAKE_TXN_${Date.now()}_${Math.random().toString(36).substring(2, 10)}`;

    console.log(`[FAKE PAYMENT] SUCCESS: Transaction ID: ${transactionId}`);

    return {
      success: true,
      transactionId,
      message: "Payment successful (Demo Mode)",
      timestamp: new Date().toISOString(),
      amount: params.amount,
      paymentMethod: params.paymentMethod,
      paymentPlan: params.paymentPlan
    };
  }

  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}

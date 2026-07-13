import {
  CreatePaymentIntentParams,
  PaymentGateway,
  PaymentIntentResult,
  RefundParams,
  RefundResult,
  VerifyPaymentParams,
  VerifyPaymentResult
} from "../../interfaces/paymentGateway.interface";
import { FakePaymentService } from "../fakePayment.service";

export class FakePaymentGateway implements PaymentGateway {
  readonly gatewayName = "fake_gateway";
  private readonly fakePaymentService = new FakePaymentService();

  async createPaymentIntent(params: CreatePaymentIntentParams): Promise<PaymentIntentResult> {
    await this.delay(500);

    console.log("[FAKE GATEWAY] Creating payment intent:", {
      amount: params.amount,
      method: params.paymentMethod,
      bookingId: params.bookingId,
      reservationType: params.reservationType
    });

    const referenceId = `FAKE_REF_${Date.now()}_${Math.random().toString(36).substring(7)}`;

    if (params.paymentMethod === "gcash") {
      const qrText = encodeURIComponent(`TEST GCash QR\nPHP ${params.amount}\n${params.bookingId}`);

      return {
        success: true,
        qrCode: `https://placehold.co/400x400/DC2626/white?text=${qrText}`,
        referenceId,
        instructions: "TEST MODE: Scan this fake QR code or follow the instructions to complete your payment. No real charge will occur.",
        expiresAt: new Date(Date.now() + 5 * 60 * 1000)
      };
    }

    if (params.paymentMethod === "cash") {
      return {
        success: true,
        referenceId,
        instructions: "TEST MODE: Cash payment recorded. No real charge will occur.",
        expiresAt: new Date(Date.now() + 60 * 60 * 1000)
      };
    }

    const paymentUrlParams = new URLSearchParams({
      amount: String(params.amount),
      bookingId: params.bookingId,
      ref: referenceId
    });

    return {
      success: true,
      paymentUrl: `https://example.com/fake-payment?${paymentUrlParams.toString()}`,
      referenceId,
      instructions: "TEST MODE: This is a fake payment intent. No real charge will occur.",
      expiresAt: new Date(Date.now() + 60 * 60 * 1000)
    };
  }

  async verifyPayment(params: VerifyPaymentParams): Promise<VerifyPaymentResult> {
    console.log("[FAKE GATEWAY] Verifying payment:", {
      referenceId: params.referenceId,
      bookingId: params.bookingId
    });

    const paymentResult = await this.fakePaymentService.processPayment({
      amount: params.gatewayData?.amount ?? 0,
      paymentMethod: params.gatewayData?.paymentMethod ?? "cash",
      bookingId: params.bookingId,
      reservationType: params.gatewayData?.reservationType ?? "dine_in",
      paymentPlan: params.gatewayData?.paymentPlan ?? "initial_only"
    });

    return {
      success: paymentResult.success,
      status: "paid",
      amount: paymentResult.amount,
      transactionId: paymentResult.transactionId,
      paidAt: new Date(paymentResult.timestamp),
      message: paymentResult.message
    };
  }

  async processRefund(params: RefundParams): Promise<RefundResult> {
    await this.delay(200);
    console.log("[FAKE GATEWAY] Processing refund:", params);

    return {
      success: true,
      refundId: `FAKE_REFUND_${Date.now()}`,
      message: "Refund processed (TEST MODE)"
    };
  }

  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}

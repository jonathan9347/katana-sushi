import { PaymentGatewayFactory } from "./payment/paymentGateway.factory";
import { paymentIntentStore } from "./payment/paymentIntentStore";
import { CreatePaymentIntentParams, VerifyPaymentParams } from "../interfaces/paymentGateway.interface";

export class PaymentService {
  private gateway = PaymentGatewayFactory.getGateway();

  async createPaymentIntent(params: CreatePaymentIntentParams) {
    console.log(`[PaymentService] Creating payment intent via ${this.gateway.gatewayName}`);
    const result = await this.gateway.createPaymentIntent(params);

    if (result.success) {
      paymentIntentStore.save({
        referenceId: result.referenceId,
        bookingId: params.bookingId,
        amount: params.amount,
        paymentMethod: params.paymentMethod,
        reservationType: params.reservationType,
        status: "pending",
        createdAt: new Date()
      });
    }

    return result;
  }

  async verifyPayment(params: VerifyPaymentParams) {
    console.log(`[PaymentService] Verifying payment via ${this.gateway.gatewayName}`);

    const storedIntent = paymentIntentStore.get(params.referenceId);

    if (!storedIntent) {
      return {
        success: false,
        status: "failed" as const,
        amount: 0,
        transactionId: "",
        message: "Payment session expired or not found. Please start payment again."
      };
    }

    if (storedIntent.bookingId !== params.bookingId) {
      return {
        success: false,
        status: "failed" as const,
        amount: storedIntent.amount,
        transactionId: "",
        message: "Payment reference does not match this reservation."
      };
    }

    if (storedIntent.status === "paid" && storedIntent.transactionId) {
      return {
        success: true,
        status: "paid" as const,
        amount: storedIntent.amount,
        transactionId: storedIntent.transactionId,
        paidAt: storedIntent.paidAt,
        message: "Payment already verified."
      };
    }

    const gatewayAmount = Number(params.gatewayData?.amount ?? storedIntent.amount);

    if (gatewayAmount > 0 && Math.abs(gatewayAmount - storedIntent.amount) > 0.01) {
      return {
        success: false,
        status: "failed" as const,
        amount: storedIntent.amount,
        transactionId: "",
        message: "Payment amount does not match the reservation total."
      };
    }

    const result = await this.gateway.verifyPayment({
      ...params,
      gatewayData: {
        ...params.gatewayData,
        amount: storedIntent.amount,
        paymentMethod: params.gatewayData?.paymentMethod ?? storedIntent.paymentMethod,
        reservationType: params.gatewayData?.reservationType ?? storedIntent.reservationType,
        paymentPlan: params.gatewayData?.paymentPlan ?? "initial_only"
      }
    });

    if (result.success && result.transactionId) {
      paymentIntentStore.markPaid(params.referenceId, result.transactionId, result.paidAt ?? new Date());
    }

    return result;
  }
}

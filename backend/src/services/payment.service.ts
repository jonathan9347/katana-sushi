import { PaymentGatewayFactory } from "./payment/paymentGateway.factory";
import { paymentIntentStore, StoredPaymentIntent } from "./payment/paymentIntentStore";
import { CreatePaymentIntentParams, VerifyPaymentParams } from "../interfaces/paymentGateway.interface";

export class PaymentService {
  private gateway = PaymentGatewayFactory.getGateway();

  private getIdempotencyKey(params: CreatePaymentIntentParams) {
    return params.idempotencyKey ?? [
      params.reservationType,
      params.bookingId,
      params.purpose ?? "downpayment",
      params.paymentMethod,
      params.amount.toFixed(2)
    ].join(":");
  }

  private existingIntentResult(intent: StoredPaymentIntent, params: CreatePaymentIntentParams) {
    const matchesRequest =
      intent.bookingId === params.bookingId &&
      intent.purpose === (params.purpose ?? "downpayment") &&
      intent.amount.toFixed(2) === params.amount.toFixed(2) &&
      intent.paymentMethod === params.paymentMethod &&
      intent.reservationType === params.reservationType;

    return {
      success: matchesRequest,
      referenceId: intent.referenceId,
      expiresAt: intent.expiresAt,
      instructions: matchesRequest
        ? intent.status === "succeeded"
          ? "TEST MODE: Payment already verified."
          : "TEST MODE: Payment already started. Continue with this payment session."
        : "This idempotency key is already associated with a different payment request."
    };
  }

  async createPaymentIntent(params: CreatePaymentIntentParams) {
    console.log(`[PaymentService] Creating payment intent via ${this.gateway.gatewayName}`);
    const idempotencyKey = this.getIdempotencyKey(params);
    const existingIntent = await paymentIntentStore.findActiveByIdempotencyKey(idempotencyKey);

    if (existingIntent) {
      return this.existingIntentResult(existingIntent, params);
    }

    const result = await this.gateway.createPaymentIntent({ ...params, idempotencyKey });

    if (result.success) {
      try {
        await paymentIntentStore.save({
          referenceId: result.referenceId,
          bookingId: params.bookingId,
          purpose: params.purpose ?? "downpayment",
          idempotencyKey,
          gatewayReference: result.referenceId,
          amount: params.amount,
          paymentMethod: params.paymentMethod,
          reservationType: params.reservationType,
          status: "pending",
          expiresAt: result.expiresAt,
          createdAt: new Date()
        });
      } catch (error) {
        const concurrentIntent = await paymentIntentStore.findActiveByIdempotencyKey(idempotencyKey);
        if (!concurrentIntent) {
          throw error;
        }
        return this.existingIntentResult(concurrentIntent, params);
      }
    }

    return result;
  }

  async verifyPayment(params: VerifyPaymentParams) {
    console.log(`[PaymentService] Verifying payment via ${this.gateway.gatewayName}`);

    const storedIntent = await paymentIntentStore.get(params.referenceId);

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

    const requestedPaymentMethod = params.gatewayData?.paymentMethod;
    const requestedReservationType = params.gatewayData?.reservationType;
    if (
      (requestedPaymentMethod && requestedPaymentMethod !== storedIntent.paymentMethod) ||
      (requestedReservationType && requestedReservationType !== storedIntent.reservationType)
    ) {
      return {
        success: false,
        status: "failed" as const,
        amount: storedIntent.amount,
        transactionId: "",
        message: "Payment details do not match the payment session."
      };
    }

    if (storedIntent.status === "succeeded" && storedIntent.transactionId) {
      return {
        success: true,
        status: "paid" as const,
        amount: storedIntent.amount,
        transactionId: storedIntent.transactionId,
        paidAt: storedIntent.paidAt,
        message: "Payment already verified."
      };
    }

    if (storedIntent.expiresAt && storedIntent.expiresAt.getTime() <= Date.now()) {
      await paymentIntentStore.markExpired(params.referenceId);
      return {
        success: false,
        status: "failed" as const,
        amount: storedIntent.amount,
        transactionId: "",
        message: "Payment session expired. Please start payment again."
      };
    }

    if (["failed", "expired", "cancelled"].includes(storedIntent.status)) {
      return {
        success: false,
        status: "failed" as const,
        amount: storedIntent.amount,
        transactionId: "",
        message: "Payment session is no longer active. Please start payment again."
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
      const paidIntent = await paymentIntentStore.markPaid(params.referenceId, result.transactionId, result.paidAt ?? new Date());
      if (!paidIntent?.transactionId) {
        throw new Error("Verified payment could not be persisted.");
      }
      return {
        ...result,
        transactionId: paidIntent.transactionId,
        paidAt: paidIntent.paidAt
      };
    } else if (!result.success) {
      await paymentIntentStore.markFailed(params.referenceId);
    }

    return result;
  }

  async getPaymentStatus(referenceId: string) {
    const intent = await paymentIntentStore.get(referenceId);
    if (!intent) {
      return null;
    }

    if (intent.expiresAt && intent.expiresAt.getTime() < Date.now() && !["succeeded", "failed", "cancelled", "expired"].includes(intent.status)) {
      await paymentIntentStore.markExpired(referenceId);
      return { ...intent, status: "expired" as const };
    }

    return intent;
  }
}

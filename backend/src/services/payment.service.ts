import crypto from "crypto";
import { PaymentGatewayFactory } from "./payment/paymentGateway.factory";
import { paymentIntentStore, StoredPaymentIntent } from "./payment/paymentIntentStore";
import { getPaymentHooks } from "./payment/paymentHooks";
import {
  CreatePaymentIntentParams,
  PaymentGateway,
  PaymentIntentResult,
  VerifyPaymentParams,
  VerifyPaymentResult
} from "../interfaces/paymentGateway.interface";

const HOSTED_PAYMENT_METHOD = "paymongo";

function hostedMethodLabel(gateway: PaymentGateway) {
  return gateway.gatewayName === "paymongo" ? "PayMongo" : gateway.gatewayName;
}

export class PaymentService {
  private gateway = PaymentGatewayFactory.getGateway();

  get usesHostedCheckout() {
    return this.gateway.isHostedCheckout;
  }

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

  async createPaymentIntent(params: CreatePaymentIntentParams): Promise<PaymentIntentResult> {
    if (this.gateway.isHostedCheckout) {
      return this.createHostedPaymentIntent(params);
    }

    if (params.paymentMethod === HOSTED_PAYMENT_METHOD) {
      return {
        success: false,
        referenceId: "",
        httpStatus: 400,
        message: "Online payment is not enabled. Choose another payment method."
      };
    }

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
          gatewayReference: result.gatewayReference ?? result.referenceId,
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

  /**
   * Hosted checkout: the server decides the amount from the booking, reuses an
   * open checkout for the same booking payment, and only then opens a new one.
   */
  private async createHostedPaymentIntent(params: CreatePaymentIntentParams): Promise<PaymentIntentResult> {
    const label = hostedMethodLabel(this.gateway);
    if (params.paymentMethod !== HOSTED_PAYMENT_METHOD) {
      return {
        success: false,
        referenceId: "",
        httpStatus: 400,
        message: `Online payments are processed by ${label}. Choose online payment to continue.`
      };
    }

    const hooks = getPaymentHooks();
    const purpose = params.purpose ?? "downpayment";
    if (!hooks.resolvePayableBooking) {
      throw new Error("Payment booking rules are not registered.");
    }
    const payable = await hooks.resolvePayableBooking({
      bookingId: params.bookingId,
      reservationType: params.reservationType,
      purpose
    });
    if (!payable.ok) {
      return { success: false, referenceId: "", httpStatus: payable.status, message: payable.message };
    }
    if (Math.abs(payable.amount - params.amount) > 0.01) {
      return {
        success: false,
        referenceId: "",
        httpStatus: 409,
        message: `The amount due is PHP ${payable.amount.toFixed(2)}. Refresh the booking and try again.`
      };
    }

    const returnUrl = this.resolveReturnUrl(params.successUrl);
    if (!returnUrl) {
      return {
        success: false,
        referenceId: "",
        httpStatus: 400,
        message: "The payment return page is not allowed. Set FRONTEND_URL on the server."
      };
    }

    // One open checkout per booking payment; the server owns this key.
    const idempotencyKey = [
      HOSTED_PAYMENT_METHOD,
      params.reservationType,
      params.bookingId,
      purpose,
      payable.amount.toFixed(2)
    ].join(":");

    const existing = await paymentIntentStore.findActiveByIdempotencyKey(idempotencyKey);
    if (existing) {
      const resumed = await this.resumeHostedIntent(existing);
      if (resumed) {
        return resumed;
      }
    }

    // An older checkout for a different amount must not stay payable.
    const staleIntents = await paymentIntentStore.findOpenForBooking(params.bookingId, purpose, HOSTED_PAYMENT_METHOD);
    for (const stale of staleIntents) {
      if (stale.idempotencyKey === idempotencyKey) {
        continue;
      }
      const closed = await this.syncHostedIntent(stale, { forceExpire: true });
      if (closed.status === "succeeded") {
        return {
          success: false,
          referenceId: closed.referenceId,
          httpStatus: 409,
          message: "A payment for this booking was just received. Refresh the booking to see the new amount due."
        };
      }
    }

    const referenceId = `PMG-${crypto.randomUUID()}`;
    const result = await this.gateway.createPaymentIntent({
      ...params,
      amount: payable.amount,
      purpose,
      referenceId,
      idempotencyKey,
      description: payable.description,
      lineItemName: payable.lineItemName,
      customer: payable.customer,
      successUrl: this.withReference(returnUrl, referenceId),
      failureUrl: this.withReference(returnUrl, referenceId, true)
    });

    try {
      await paymentIntentStore.save({
        referenceId: result.referenceId,
        bookingId: params.bookingId,
        purpose,
        idempotencyKey,
        gatewayReference: result.gatewayReference,
        amount: payable.amount,
        paymentMethod: HOSTED_PAYMENT_METHOD,
        reservationType: params.reservationType,
        status: "pending",
        expiresAt: result.expiresAt,
        createdAt: new Date()
      });
    } catch (error) {
      // Another request opened a checkout for the same payment first; use that one.
      if (result.gatewayReference) {
        await this.gateway.cancelPaymentIntent?.(result.gatewayReference).catch(() => undefined);
      }
      const concurrent = await paymentIntentStore.findActiveByIdempotencyKey(idempotencyKey);
      const resumed = concurrent ? await this.resumeHostedIntent(concurrent) : null;
      if (!resumed) {
        throw error;
      }
      return resumed;
    }

    return result;
  }

  /** Returns a usable result for an existing hosted intent, or null when a new checkout is needed. */
  private async resumeHostedIntent(intent: StoredPaymentIntent): Promise<PaymentIntentResult | null> {
    const synced = await this.syncHostedIntent(intent);

    if (synced.status === "succeeded") {
      return {
        success: true,
        alreadyPaid: true,
        referenceId: synced.referenceId,
        message: "This payment is already complete."
      };
    }

    if (synced.status !== "pending" && synced.status !== "created") {
      return null;
    }

    if (!synced.gatewayReference || !this.gateway.resumePaymentIntent) {
      await paymentIntentStore.markExpired(synced.referenceId);
      return null;
    }

    const resumed = await this.gateway.resumePaymentIntent(synced.gatewayReference);
    if (!resumed) {
      const rechecked = await this.syncHostedIntent(synced, { forceExpire: true });
      return rechecked.status === "succeeded"
        ? { success: true, alreadyPaid: true, referenceId: rechecked.referenceId, message: "This payment is already complete." }
        : null;
    }

    return {
      success: true,
      referenceId: synced.referenceId,
      gatewayReference: synced.gatewayReference,
      paymentUrl: resumed.paymentUrl,
      expiresAt: synced.expiresAt,
      instructions: "Continue your payment on the secure checkout page."
    };
  }

  private resolveReturnUrl(requested?: string) {
    const hooks = getPaymentHooks();
    if (requested) {
      try {
        const parsed = new URL(requested);
        if (
          (parsed.protocol === "https:" || parsed.protocol === "http:") &&
          (hooks.isAllowedReturnUrl?.(parsed.toString()) ?? false)
        ) {
          return `${parsed.origin}${parsed.pathname}`;
        }
      } catch {
        // fall through to FRONTEND_URL
      }
    }

    const frontendUrl = process.env.FRONTEND_URL?.split(",")[0]?.trim();
    if (!frontendUrl) {
      return null;
    }
    try {
      return new URL("/payment/return", frontendUrl).toString();
    } catch {
      return null;
    }
  }

  private withReference(returnUrl: string, referenceId: string, cancelled = false) {
    const url = new URL(returnUrl);
    url.searchParams.set("reference", referenceId);
    if (cancelled) {
      url.searchParams.set("cancelled", "1");
    }
    return url.toString();
  }

  /**
   * Reads a hosted checkout back from the provider and records the outcome.
   * Paid payments are applied to their booking every time; that step is idempotent,
   * so a failed attempt is retried by the next webhook or status check.
   */
  private async syncHostedIntent(
    intent: StoredPaymentIntent,
    options: { forceExpire?: boolean } = {}
  ): Promise<StoredPaymentIntent> {
    if (intent.paymentMethod !== HOSTED_PAYMENT_METHOD || !this.gateway.isHostedCheckout) {
      return intent;
    }

    if (intent.status === "succeeded") {
      await this.fulfill(intent);
      return intent;
    }

    if (intent.status === "cancelled" || !intent.gatewayReference) {
      return intent;
    }

    let result = await this.gateway.verifyPayment({
      referenceId: intent.referenceId,
      bookingId: intent.bookingId,
      gatewayReference: intent.gatewayReference
    });

    const locallyExpired = Boolean(intent.expiresAt && intent.expiresAt.getTime() <= Date.now());
    if (result.status === "pending" && (locallyExpired || options.forceExpire)) {
      await this.gateway.cancelPaymentIntent?.(intent.gatewayReference);
      // Re-read: the customer may have paid between the two calls.
      result = await this.gateway.verifyPayment({
        referenceId: intent.referenceId,
        bookingId: intent.bookingId,
        gatewayReference: intent.gatewayReference
      });
      if (result.status === "pending") {
        return (await paymentIntentStore.markExpired(intent.referenceId)) ?? intent;
      }
    }

    if (result.status === "paid" && result.transactionId) {
      if (Math.abs(result.amount - intent.amount) > 0.01) {
        console.error(
          `[PaymentService] ${intent.referenceId}: provider reports PHP ${result.amount.toFixed(2)} paid but PHP ${intent.amount.toFixed(2)} was due. Payment ${result.transactionId} needs staff review.`
        );
        return (await paymentIntentStore.markFailed(intent.referenceId)) ?? intent;
      }

      const paid = await paymentIntentStore.markPaid(
        intent.referenceId,
        result.transactionId,
        result.paidAt ?? new Date(),
        { hostedCheckout: true }
      );
      if (paid?.status === "succeeded") {
        console.log(
          `[PaymentService] ${paid.referenceId} paid via ${result.paymentChannel ?? "online payment"} (${result.transactionId}).`
        );
        await this.fulfill(paid);
        return paid;
      }
      return paid ?? intent;
    }

    if (result.status === "expired") {
      return (await paymentIntentStore.markExpired(intent.referenceId)) ?? intent;
    }

    return intent;
  }

  private async fulfill(intent: StoredPaymentIntent) {
    const fulfillPayment = getPaymentHooks().fulfillPayment;
    if (!fulfillPayment || !intent.transactionId) {
      return;
    }

    try {
      await fulfillPayment({ ...intent, transactionId: intent.transactionId });
    } catch (error) {
      console.error(
        `[PaymentService] Payment ${intent.transactionId} for ${intent.bookingId} (${intent.purpose}) is paid but could not be applied to the booking:`,
        error instanceof Error ? error.message : error
      );
    }
  }

  /** Called by the provider webhook. Re-reads the session from the provider rather than trusting the event body. */
  async handleHostedCheckoutEvent(gatewayReference: string) {
    const intent = await paymentIntentStore.findByGatewayReference(gatewayReference);
    if (!intent) {
      console.warn(`[PaymentService] Webhook for unknown checkout session ${gatewayReference}.`);
      return null;
    }
    return this.syncHostedIntent(intent);
  }

  async verifyPayment(params: VerifyPaymentParams): Promise<VerifyPaymentResult> {
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

    if (storedIntent.paymentMethod === HOSTED_PAYMENT_METHOD) {
      return this.verifyHostedPayment(storedIntent);
    }

    if (this.gateway.isHostedCheckout) {
      return {
        success: false,
        status: "failed" as const,
        amount: storedIntent.amount,
        transactionId: "",
        message: "This payment was started in test mode and cannot be completed now. Please start payment again."
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

  private async verifyHostedPayment(intent: StoredPaymentIntent): Promise<VerifyPaymentResult> {
    if (!this.gateway.isHostedCheckout) {
      return {
        success: false,
        status: "failed",
        amount: intent.amount,
        transactionId: "",
        message: "Online payment is not enabled on this server."
      };
    }

    const synced = await this.syncHostedIntent(intent);
    if (synced.status === "succeeded" && synced.transactionId) {
      return {
        success: true,
        status: "paid",
        amount: synced.amount,
        transactionId: synced.transactionId,
        paidAt: synced.paidAt,
        message: "Payment received."
      };
    }

    if (synced.status === "pending" || synced.status === "created") {
      return {
        success: false,
        status: "pending",
        amount: synced.amount,
        transactionId: "",
        message: "Payment has not been completed yet."
      };
    }

    return {
      success: false,
      status: synced.status === "expired" ? "expired" : "failed",
      amount: synced.amount,
      transactionId: "",
      message: "This payment session is no longer active. Please start payment again."
    };
  }

  async getPaymentStatus(referenceId: string) {
    const intent = await paymentIntentStore.get(referenceId);
    if (!intent) {
      return null;
    }

    if (intent.paymentMethod === HOSTED_PAYMENT_METHOD) {
      try {
        return await this.syncHostedIntent(intent);
      } catch (error) {
        // Report the last known state; the next check or webhook will catch up.
        console.error(
          `[PaymentService] Could not refresh ${referenceId} from ${hostedMethodLabel(this.gateway)}:`,
          error instanceof Error ? error.message : error
        );
        return intent;
      }
    }

    if (intent.expiresAt && intent.expiresAt.getTime() < Date.now() && !["succeeded", "failed", "cancelled", "expired"].includes(intent.status)) {
      await paymentIntentStore.markExpired(referenceId);
      return { ...intent, status: "expired" as const };
    }

    return intent;
  }
}

import crypto from "crypto";
import {
  CreatePaymentIntentParams,
  PaymentGateway,
  PaymentIntentResult,
  RefundParams,
  RefundResult,
  VerifyPaymentParams,
  VerifyPaymentResult
} from "../../interfaces/paymentGateway.interface";
import {
  fromCentavos,
  getConfiguredPayMongoMethods,
  getPaidCheckoutPayment,
  PayMongoApiError,
  PayMongoClient,
  toCentavos
} from "./paymongo.client";

const DEFAULT_SESSION_TTL_MINUTES = 60;
const PAYMONGO_REFUND_REASONS = new Set(["duplicate", "fraudulent", "requested_by_customer", "others"]);

type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

/**
 * PayMongo hosted checkout (Checkout Sessions API).
 * The customer picks QR Ph, card, GCash, or Maya on PayMongo's page; we confirm
 * the payment by reading the session back from PayMongo, never from the browser.
 */
export class PayMongoGateway implements PaymentGateway {
  readonly gatewayName = "paymongo";
  readonly isHostedCheckout = true;
  private readonly client: PayMongoClient | null;
  private readonly configurationError: string | null;

  constructor(secretKey = process.env.PAYMONGO_SECRET_KEY?.trim(), fetchImpl?: FetchLike) {
    if (!secretKey) {
      this.client = null;
      this.configurationError = "PayMongo is selected but PAYMONGO_SECRET_KEY is not set.";
      return;
    }

    try {
      this.client = new PayMongoClient(secretKey, fetchImpl);
      this.configurationError = null;
    } catch (error) {
      this.client = null;
      this.configurationError = error instanceof Error ? error.message : "PayMongo is misconfigured.";
    }
  }

  get isConfigured() {
    return this.client !== null;
  }

  get configurationProblem() {
    return this.configurationError;
  }

  get isTestMode() {
    return this.client?.isTestMode ?? true;
  }

  get paymentMethodTypes() {
    return getConfiguredPayMongoMethods();
  }

  private get sessionTtlMs() {
    const minutes = Number(process.env.PAYMONGO_CHECKOUT_TTL_MINUTES ?? DEFAULT_SESSION_TTL_MINUTES);
    return (Number.isFinite(minutes) && minutes >= 5 ? minutes : DEFAULT_SESSION_TTL_MINUTES) * 60 * 1000;
  }

  private requireClient() {
    if (!this.client) {
      throw new PayMongoApiError(this.configurationError ?? "PayMongo is not configured.", 503);
    }
    return this.client;
  }

  async createPaymentIntent(params: CreatePaymentIntentParams): Promise<PaymentIntentResult> {
    const client = this.requireClient();
    if (!params.successUrl || !params.failureUrl) {
      throw new Error("PayMongo checkout requires success and cancel URLs.");
    }

    const referenceId = params.referenceId ?? `PMG-${crypto.randomUUID()}`;
    const description = params.description ?? `Katana Sushi booking ${params.bookingId}`;
    const session = await client.createCheckoutSession({
      lineItems: [{
        name: params.lineItemName ?? "Katana Sushi payment",
        description,
        amount: toCentavos(params.amount),
        currency: "PHP",
        quantity: 1
      }],
      paymentMethodTypes: this.paymentMethodTypes,
      successUrl: params.successUrl,
      cancelUrl: params.failureUrl,
      referenceNumber: params.bookingId,
      description,
      billing: params.customer,
      sendEmailReceipt: true,
      metadata: {
        reference_id: referenceId,
        booking_id: params.bookingId,
        reservation_type: params.reservationType,
        purpose: params.purpose ?? "downpayment"
      }
    });

    return {
      success: true,
      referenceId,
      gatewayReference: session.id,
      paymentUrl: session.attributes.checkout_url,
      instructions: this.isTestMode
        ? "PayMongo TEST MODE: no real money will be charged."
        : "Complete your payment on the secure PayMongo page.",
      expiresAt: new Date(Date.now() + this.sessionTtlMs)
    };
  }

  async verifyPayment(params: VerifyPaymentParams): Promise<VerifyPaymentResult> {
    const client = this.requireClient();
    if (!params.gatewayReference) {
      return {
        success: false,
        status: "failed",
        amount: 0,
        transactionId: "",
        message: "This payment has no PayMongo checkout session."
      };
    }

    const session = await client.retrieveCheckoutSession(params.gatewayReference);
    const paidPayment = getPaidCheckoutPayment(session);

    if (paidPayment) {
      return {
        success: true,
        status: "paid",
        amount: fromCentavos(paidPayment.attributes.amount),
        transactionId: paidPayment.id,
        paidAt: paidPayment.attributes.paid_at ? new Date(paidPayment.attributes.paid_at * 1000) : new Date(),
        paymentChannel: paidPayment.attributes.source?.type ?? undefined,
        message: "Payment received."
      };
    }

    if (session.attributes.status === "expired") {
      return {
        success: false,
        status: "expired",
        amount: 0,
        transactionId: "",
        message: "The PayMongo checkout expired before payment."
      };
    }

    return {
      success: false,
      status: "pending",
      amount: 0,
      transactionId: "",
      message: "Waiting for payment on PayMongo."
    };
  }

  async resumePaymentIntent(gatewayReference: string) {
    const session = await this.requireClient().retrieveCheckoutSession(gatewayReference);
    if (session.attributes.status !== "active" || getPaidCheckoutPayment(session)) {
      return null;
    }
    return { paymentUrl: session.attributes.checkout_url };
  }

  async cancelPaymentIntent(gatewayReference: string) {
    try {
      await this.requireClient().expireCheckoutSession(gatewayReference);
    } catch (error) {
      // An already expired or already paid session cannot be expired; the caller re-reads the session.
      if (!(error instanceof PayMongoApiError) || error.status >= 500) {
        throw error;
      }
    }
  }

  async processRefund(params: RefundParams): Promise<RefundResult> {
    const reason = PAYMONGO_REFUND_REASONS.has(params.reason) ? params.reason : "requested_by_customer";
    const refund = await this.requireClient().createRefund({
      paymentId: params.transactionId,
      amount: toCentavos(params.amount),
      reason,
      notes: reason === params.reason ? undefined : params.reason.slice(0, 255)
    });

    return {
      success: refund.attributes.status !== "failed",
      refundId: refund.id,
      message: `PayMongo refund ${refund.attributes.status}.`
    };
  }
}

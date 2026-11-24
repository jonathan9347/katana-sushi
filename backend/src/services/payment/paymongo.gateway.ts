import crypto from "crypto";
import {
  CreatePaymentIntentParams,
  PaymentGateway,
  PaymentIntentResult,
  PaymentNextAction,
  RefundParams,
  RefundResult,
  StartPaymentInput,
  StartPaymentResult,
  VerifyPaymentParams,
  VerifyPaymentResult
} from "../../interfaces/paymentGateway.interface";
import {
  describeLastPaymentError,
  fromCentavos,
  getConfiguredPayMongoMethods,
  getPaidCheckoutPayment,
  getPaidIntentPayment,
  PayMongoApiError,
  PayMongoClient,
  PayMongoPayment,
  PayMongoPaymentIntent,
  toCentavos
} from "./paymongo.client";

const DEFAULT_SESSION_TTL_MINUTES = 60;
const PAYMONGO_REFUND_REASONS = new Set(["duplicate", "fraudulent", "requested_by_customer", "others"]);
const STATEMENT_DESCRIPTOR = "KATANA SUSHI";

type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

function isCheckoutSession(gatewayReference: string) {
  return gatewayReference.startsWith("cs_");
}

function paidResult(payment: PayMongoPayment): VerifyPaymentResult {
  return {
    success: true,
    status: "paid",
    amount: fromCentavos(payment.attributes.amount),
    transactionId: payment.id,
    paidAt: payment.attributes.paid_at ? new Date(payment.attributes.paid_at * 1000) : new Date(),
    paymentChannel: payment.attributes.source?.type ?? undefined,
    message: "Payment received."
  };
}

/** Turns PayMongo's next_action into what Katana's payment page shows. */
export function toNextAction(intent: PayMongoPaymentIntent): PaymentNextAction | undefined {
  const action = intent.attributes.next_action;
  if (!action) {
    return undefined;
  }
  if (action.type === "consume_qr" && "code" in action && action.code && typeof action.code === "object") {
    const code = action.code as { image_url?: string; expires_at?: string | null; test_url?: string | null };
    if (code.image_url) {
      return {
        type: "qr",
        imageUrl: code.image_url,
        expiresAt: code.expires_at ?? undefined,
        testUrl: code.test_url ?? undefined
      };
    }
  }
  if (action.type === "redirect" && "redirect" in action && action.redirect && typeof action.redirect === "object") {
    const redirect = action.redirect as { url?: string };
    if (redirect.url) {
      return { type: "redirect", url: redirect.url };
    }
  }
  return undefined;
}

/**
 * PayMongo through Katana's own payment page (Payment Intents API).
 * The customer picks QR Ph, card, GCash, or Maya on our page; the server confirms
 * payment by reading the intent back from PayMongo, never from the browser.
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

  /** The publishable key the browser needs to send card details straight to PayMongo. */
  get publicKey() {
    const key = process.env.PAYMONGO_PUBLIC_KEY?.trim();
    if (!key || !/^pk_(test|live)_[A-Za-z0-9]+$/.test(key)) {
      return null;
    }
    // A live secret key must be paired with a live public key, and test with test.
    return key.startsWith(this.isTestMode ? "pk_test_" : "pk_live_") ? key : null;
  }

  /** Card needs the public key; without it the card option is hidden. */
  get availableChannels() {
    return this.paymentMethodTypes.filter((type) => type !== "card" || this.publicKey !== null);
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
    const referenceId = params.referenceId ?? `PMG-${crypto.randomUUID()}`;
    const description = params.description ?? `Katana Sushi booking ${params.bookingId}`;

    const intent = await client.createPaymentIntent({
      amount: toCentavos(params.amount),
      paymentMethodTypes: this.availableChannels,
      description,
      statementDescriptor: STATEMENT_DESCRIPTOR,
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
      gatewayReference: intent.id,
      instructions: this.isTestMode
        ? "PayMongo TEST MODE: no real money will be charged."
        : "Choose how you want to pay.",
      expiresAt: new Date(Date.now() + this.sessionTtlMs)
    };
  }

  async startPayment(gatewayReference: string, input: StartPaymentInput): Promise<StartPaymentResult> {
    const client = this.requireClient();
    if (isCheckoutSession(gatewayReference)) {
      throw new PayMongoApiError("This payment was started on the old checkout page. Start the payment again.", 409);
    }
    if (!this.availableChannels.includes(input.channel)) {
      return { status: "failed", message: "That payment method is not available." };
    }

    let paymentMethodId: string;
    if (input.channel === "card") {
      if (!input.paymentMethodId || !/^pm_[A-Za-z0-9]+$/.test(input.paymentMethodId)) {
        return { status: "failed", message: "Card details are missing. Please enter your card again." };
      }
      paymentMethodId = input.paymentMethodId;
    } else {
      const method = await client.createPaymentMethod({ type: input.channel, billing: input.billing });
      paymentMethodId = method.id;
    }

    const intent = await client.attachPaymentIntent(gatewayReference, {
      paymentMethodId,
      returnUrl: input.returnUrl
    });

    if (intent.attributes.status === "succeeded" || getPaidIntentPayment(intent)) {
      return { status: "paid" };
    }

    const nextAction = toNextAction(intent);
    if (nextAction) {
      return { status: "action_required", nextAction };
    }

    const lastError = describeLastPaymentError(intent);
    if (intent.attributes.status === "awaiting_payment_method" && lastError) {
      return { status: "failed", message: lastError };
    }

    return { status: "pending", message: "Your payment is being processed." };
  }

  async verifyPayment(params: VerifyPaymentParams): Promise<VerifyPaymentResult> {
    const client = this.requireClient();
    if (!params.gatewayReference) {
      return {
        success: false,
        status: "failed",
        amount: 0,
        transactionId: "",
        message: "This payment has no PayMongo reference."
      };
    }

    if (isCheckoutSession(params.gatewayReference)) {
      const session = await client.retrieveCheckoutSession(params.gatewayReference);
      const paidPayment = getPaidCheckoutPayment(session);
      if (paidPayment) {
        return paidResult(paidPayment);
      }
      return session.attributes.status === "expired"
        ? { success: false, status: "expired", amount: 0, transactionId: "", message: "The PayMongo checkout expired before payment." }
        : { success: false, status: "pending", amount: 0, transactionId: "", message: "Waiting for payment on PayMongo." };
    }

    const intent = await client.retrievePaymentIntent(params.gatewayReference);
    const paidPayment = getPaidIntentPayment(intent);
    if (paidPayment) {
      return paidResult(paidPayment);
    }

    return {
      success: false,
      status: "pending",
      amount: 0,
      transactionId: "",
      nextAction: intent.attributes.status === "awaiting_next_action" ? toNextAction(intent) : undefined,
      lastError: describeLastPaymentError(intent) ?? undefined,
      message: intent.attributes.status === "processing" ? "Your payment is being processed." : "Waiting for payment."
    };
  }

  /** Old checkout sessions are never resumed; the customer gets the new payment page. */
  async resumePaymentIntent(gatewayReference: string) {
    if (isCheckoutSession(gatewayReference)) {
      return null;
    }
    const intent = await this.requireClient().retrievePaymentIntent(gatewayReference);
    return intent.attributes.status === "succeeded" || getPaidIntentPayment(intent)
      ? null
      : { paymentUrl: "" };
  }

  /**
   * Checkout sessions can be expired at PayMongo. Payment intents cannot be
   * cancelled there; Katana stops offering them, and a late payment is still recorded.
   */
  async cancelPaymentIntent(gatewayReference: string) {
    if (!isCheckoutSession(gatewayReference)) {
      return;
    }
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

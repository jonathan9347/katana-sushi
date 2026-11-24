import crypto from "crypto";

const PAYMONGO_API_BASE_URL = "https://api.paymongo.com/v1";
const REQUEST_TIMEOUT_MS = 15_000;

export const DEFAULT_PAYMONGO_PAYMENT_METHODS = ["qrph", "card", "gcash", "paymaya"] as const;

export type PayMongoPaymentStatus = "pending" | "paid" | "failed" | string;

export type PayMongoPayment = {
  id: string;
  type: "payment";
  attributes: {
    amount: number;
    currency: string;
    status: PayMongoPaymentStatus;
    paid_at?: number | null;
    livemode?: boolean;
    source?: { id?: string; type?: string } | null;
    payment_intent_id?: string | null;
  };
};

export type PayMongoCheckoutSession = {
  id: string;
  type: "checkout_session";
  attributes: {
    checkout_url: string;
    status: "active" | "expired" | string;
    reference_number?: string | null;
    livemode?: boolean;
    payments?: PayMongoPayment[];
    payment_intent?: {
      id: string;
      attributes?: { status?: string; amount?: number };
    } | null;
    line_items?: Array<{ amount: number; currency: string; name: string; quantity: number }>;
    metadata?: Record<string, string> | null;
  };
};

export type PayMongoPaymentIntentStatus =
  | "awaiting_payment_method"
  | "awaiting_next_action"
  | "processing"
  | "succeeded"
  | string;

export type PayMongoNextAction =
  | {
      type: "consume_qr";
      code: { id: string; amount: number; image_url: string; test_url?: string | null; expires_at?: string | null };
    }
  | { type: "redirect"; redirect: { url: string; return_url?: string } }
  | { type: string; [key: string]: unknown };

export type PayMongoPaymentIntent = {
  id: string;
  type: "payment_intent";
  attributes: {
    amount: number;
    currency: string;
    status: PayMongoPaymentIntentStatus;
    client_key?: string;
    livemode?: boolean;
    payments?: PayMongoPayment[];
    next_action?: PayMongoNextAction | null;
    last_payment_error?: { failed_code?: string; failed_message?: string; payment_method_type?: string } | string | null;
    payment_method_allowed?: string[];
    metadata?: Record<string, string> | null;
  };
};

export type CreatePaymentIntentInput = {
  amount: number;
  paymentMethodTypes: string[];
  description: string;
  statementDescriptor?: string;
  metadata?: Record<string, string>;
};

export type PayMongoLineItem = {
  name: string;
  amount: number;
  currency: "PHP";
  quantity: number;
  description?: string;
};

export type CreateCheckoutSessionInput = {
  lineItems: PayMongoLineItem[];
  paymentMethodTypes: string[];
  successUrl: string;
  cancelUrl: string;
  referenceNumber: string;
  description: string;
  billing?: { name?: string; email?: string; phone?: string };
  metadata?: Record<string, string>;
  sendEmailReceipt?: boolean;
};

export type PayMongoRefund = {
  id: string;
  attributes: { status: string; amount: number };
};

export class PayMongoApiError extends Error {
  constructor(message: string, readonly status: number, readonly code?: string) {
    super(message);
    this.name = "PayMongoApiError";
  }
}

type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

export class PayMongoClient {
  constructor(
    private readonly secretKey: string,
    private readonly fetchImpl: FetchLike = (input, init) => fetch(input, init)
  ) {
    if (!/^sk_(test|live)_[A-Za-z0-9]+$/.test(secretKey)) {
      throw new Error("PAYMONGO_SECRET_KEY must be a PayMongo secret key (sk_test_... or sk_live_...).");
    }
  }

  get isTestMode() {
    return this.secretKey.startsWith("sk_test_");
  }

  async createCheckoutSession(input: CreateCheckoutSessionInput) {
    const attributes: Record<string, unknown> = {
      line_items: input.lineItems,
      payment_method_types: input.paymentMethodTypes,
      success_url: input.successUrl,
      cancel_url: input.cancelUrl,
      reference_number: input.referenceNumber,
      description: input.description,
      show_description: true,
      show_line_items: true,
      send_email_receipt: Boolean(input.sendEmailReceipt && input.billing?.email)
    };
    const billing = compactBilling(input.billing);
    if (billing) {
      attributes.billing = billing;
    }
    if (input.metadata && Object.keys(input.metadata).length > 0) {
      attributes.metadata = input.metadata;
    }

    const response = await this.request<{ data: PayMongoCheckoutSession }>("POST", "/checkout_sessions", {
      data: { attributes }
    });
    return response.data;
  }

  async retrieveCheckoutSession(checkoutSessionId: string) {
    const response = await this.request<{ data: PayMongoCheckoutSession }>(
      "GET",
      `/checkout_sessions/${encodeURIComponent(checkoutSessionId)}`
    );
    return response.data;
  }

  async expireCheckoutSession(checkoutSessionId: string) {
    const response = await this.request<{ data: PayMongoCheckoutSession }>(
      "POST",
      `/checkout_sessions/${encodeURIComponent(checkoutSessionId)}/expire`
    );
    return response.data;
  }

  async createPaymentIntent(input: CreatePaymentIntentInput) {
    const attributes: Record<string, unknown> = {
      amount: input.amount,
      currency: "PHP",
      capture_type: "automatic",
      payment_method_allowed: input.paymentMethodTypes,
      description: input.description
    };
    if (input.paymentMethodTypes.includes("card")) {
      attributes.payment_method_options = { card: { request_three_d_secure: "any" } };
    }
    if (input.statementDescriptor) {
      attributes.statement_descriptor = input.statementDescriptor;
    }
    if (input.metadata && Object.keys(input.metadata).length > 0) {
      attributes.metadata = input.metadata;
    }

    const response = await this.request<{ data: PayMongoPaymentIntent }>("POST", "/payment_intents", {
      data: { attributes }
    });
    return response.data;
  }

  async retrievePaymentIntent(paymentIntentId: string) {
    const response = await this.request<{ data: PayMongoPaymentIntent }>(
      "GET",
      `/payment_intents/${encodeURIComponent(paymentIntentId)}`
    );
    return response.data;
  }

  /** Creates a payment method that carries no card data (QR Ph and e-wallets). */
  async createPaymentMethod(input: { type: string; billing?: { name?: string; email?: string; phone?: string } }) {
    const attributes: Record<string, unknown> = { type: input.type };
    const billing = compactBilling(input.billing);
    if (billing) {
      attributes.billing = billing;
    }
    const response = await this.request<{ data: { id: string; attributes: { type: string } } }>("POST", "/payment_methods", {
      data: { attributes }
    });
    return response.data;
  }

  async attachPaymentIntent(paymentIntentId: string, input: { paymentMethodId: string; returnUrl: string }) {
    const response = await this.request<{ data: PayMongoPaymentIntent }>(
      "POST",
      `/payment_intents/${encodeURIComponent(paymentIntentId)}/attach`,
      { data: { attributes: { payment_method: input.paymentMethodId, return_url: input.returnUrl } } }
    );
    return response.data;
  }

  async createRefund(input: { paymentId: string; amount: number; reason: string; notes?: string }) {
    const response = await this.request<{ data: PayMongoRefund }>("POST", "/refunds", {
      data: {
        attributes: {
          payment_id: input.paymentId,
          amount: input.amount,
          reason: input.reason,
          ...(input.notes ? { notes: input.notes } : {})
        }
      }
    });
    return response.data;
  }

  private async request<T>(method: "GET" | "POST", path: string, body?: unknown): Promise<T> {
    let response: Response;
    try {
      response = await this.fetchImpl(`${PAYMONGO_API_BASE_URL}${path}`, {
        method,
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json",
          Authorization: `Basic ${Buffer.from(`${this.secretKey}:`).toString("base64")}`
        },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS)
      });
    } catch (error) {
      throw new PayMongoApiError(
        `PayMongo could not be reached: ${error instanceof Error ? error.message : String(error)}`,
        503
      );
    }

    const text = await response.text();
    let parsed: unknown = null;
    if (text) {
      try {
        parsed = JSON.parse(text);
      } catch {
        parsed = null;
      }
    }

    if (!response.ok) {
      const firstError = (parsed as { errors?: Array<{ code?: string; detail?: string }> } | null)?.errors?.[0];
      throw new PayMongoApiError(
        firstError?.detail ?? `PayMongo request failed with HTTP ${response.status}.`,
        response.status,
        firstError?.code
      );
    }

    return parsed as T;
  }
}

function compactBilling(billing?: { name?: string; email?: string; phone?: string }) {
  if (!billing) {
    return null;
  }
  const compacted = Object.fromEntries(
    Object.entries(billing).filter((entry): entry is [string, string] => typeof entry[1] === "string" && entry[1].trim() !== "")
  );
  return Object.keys(compacted).length > 0 ? compacted : null;
}

/** Converts pesos to the integer centavo amount PayMongo expects. */
export function toCentavos(amount: number) {
  if (!Number.isFinite(amount) || amount <= 0) {
    throw new Error("Payment amount must be a positive number.");
  }
  return Math.round(amount * 100);
}

export function fromCentavos(amount: number) {
  return Math.round(amount) / 100;
}

/** The paid payment on a payment intent, if PayMongo has captured one. */
export function getPaidIntentPayment(intent: PayMongoPaymentIntent) {
  return intent.attributes.payments?.find((payment) => payment.attributes.status === "paid") ?? null;
}

export function describeLastPaymentError(intent: PayMongoPaymentIntent) {
  const error = intent.attributes.last_payment_error;
  if (!error) {
    return null;
  }
  if (typeof error === "string") {
    return error;
  }
  return error.failed_message ?? error.failed_code ?? "The last payment attempt did not go through.";
}

/** The paid payment on a checkout session, if PayMongo has captured one. */
export function getPaidCheckoutPayment(session: PayMongoCheckoutSession) {
  return session.attributes.payments?.find((payment) => payment.attributes.status === "paid") ?? null;
}

export type PayMongoSignatureCheck =
  | { valid: true }
  | { valid: false; reason: string };

/**
 * Verifies the Paymongo-Signature header: `t=<unix>,te=<test hmac>,li=<live hmac>`.
 * The HMAC-SHA256 of `${t}.${rawBody}` keyed by the webhook secret must match
 * `te` for test-mode events and `li` for live-mode events.
 */
export function verifyPayMongoSignature(
  rawBody: Buffer | string,
  signatureHeader: string | undefined,
  webhookSecret: string,
  livemode: boolean
): PayMongoSignatureCheck {
  if (!signatureHeader) {
    return { valid: false, reason: "Missing Paymongo-Signature header." };
  }

  const parts = new Map<string, string>();
  for (const part of signatureHeader.split(",")) {
    const separatorIndex = part.indexOf("=");
    if (separatorIndex > 0) {
      parts.set(part.slice(0, separatorIndex).trim(), part.slice(separatorIndex + 1).trim());
    }
  }

  const timestamp = parts.get("t");
  const expectedSignature = livemode ? parts.get("li") : parts.get("te");
  if (!timestamp || !expectedSignature) {
    return { valid: false, reason: "Malformed Paymongo-Signature header." };
  }

  const payload = `${timestamp}.${typeof rawBody === "string" ? rawBody : rawBody.toString("utf8")}`;
  const computed = crypto.createHmac("sha256", webhookSecret).update(payload).digest("hex");
  const computedBuffer = Buffer.from(computed, "utf8");
  const expectedBuffer = Buffer.from(expectedSignature, "utf8");

  if (computedBuffer.length !== expectedBuffer.length || !crypto.timingSafeEqual(computedBuffer, expectedBuffer)) {
    return { valid: false, reason: "Signature does not match." };
  }

  return { valid: true };
}

export function getConfiguredPayMongoMethods() {
  const configured = process.env.PAYMONGO_PAYMENT_METHODS
    ?.split(",")
    .map((value) => value.trim().toLowerCase())
    .filter(Boolean);
  return configured && configured.length > 0 ? configured : [...DEFAULT_PAYMONGO_PAYMENT_METHODS];
}

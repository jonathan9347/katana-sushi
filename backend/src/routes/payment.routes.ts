import express from "express";
import { z } from "zod";
import { PaymentService } from "../services/payment.service";
import { CreatePaymentIntentParams, VerifyPaymentParams } from "../interfaces/paymentGateway.interface";
import { PaymentGatewayFactory } from "../services/payment/paymentGateway.factory";
import { PayMongoApiError, verifyPayMongoSignature } from "../services/payment/paymongo.client";
import { PayMongoGateway } from "../services/payment/paymongo.gateway";
import { prisma } from "../lib/prisma";
import type { RequestWithRawBody } from "../lib/jsonBody";

const router = express.Router();
const paymentService = new PaymentService();

function rejectFakePaymentsInProduction(res: express.Response) {
  if (process.env.NODE_ENV !== "production" || !PaymentGatewayFactory.isFakeGatewayActive()) {
    return false;
  }

  res.status(503).json({
    success: false,
    message: "Payments are unavailable because TEST MODE is enabled."
  });
  return true;
}

function paymentErrorResponse(error: unknown) {
  if (error instanceof PayMongoApiError) {
    if (error.status === 401 || error.status === 403) {
      return { status: 503, message: "Online payment is temporarily unavailable. Please try again later." };
    }
    if (error.status >= 400 && error.status < 500) {
      return { status: 400, message: `PayMongo: ${error.message}` };
    }
    return { status: 502, message: "PayMongo is not responding. Please try again in a moment." };
  }
  return null;
}

/** Tells the frontend which payment flow to show. Contains no secrets. */
router.get("/payments/config", (_req, res) => {
  const gateway = PaymentGatewayFactory.getGateway();
  const isPayMongo = gateway instanceof PayMongoGateway;
  const fakeBlocked = process.env.NODE_ENV === "production" && PaymentGatewayFactory.isFakeGatewayActive();

  return res.json({
    gateway: gateway.gatewayName,
    hostedCheckout: gateway.isHostedCheckout,
    testMode: gateway.isTestMode,
    available: isPayMongo ? gateway.isConfigured : !fakeBlocked,
    methods: isPayMongo ? gateway.paymentMethodTypes : []
  });
});

router.post("/payments/create-intent", async (req, res) => {
  if (rejectFakePaymentsInProduction(res)) {
    return;
  }

  try {
    const body = z
      .object({
        amount: z.number().positive(),
        paymentMethod: z.enum(["cash", "gcash", "bank_transfer", "paymongo"]),
        bookingId: z.string().min(1),
        reservationType: z.enum(["dine_in", "catering", "takeout"]),
        purpose: z.enum(["downpayment", "full_payment", "balance"]).optional(),
        idempotencyKey: z.string().min(1).optional(),
        description: z.string().optional(),
        successUrl: z.string().url().optional(),
        failureUrl: z.string().url().optional()
      })
      .parse(req.body) as CreatePaymentIntentParams;

    if (body.reservationType === "takeout") {
      return res.status(400).json({
        success: false,
        message: "Pickup orders are paid in cash at the counter."
      });
    }

    const { httpStatus, ...result } = await paymentService.createPaymentIntent(body);
    if (!result.success) {
      return res.status(httpStatus ?? 400).json(result);
    }
    return res.json(result);
  } catch (error) {
    console.error("Payment intent error:", error instanceof Error ? error.message : error);
    if (error instanceof z.ZodError) {
      return res.status(400).json({ success: false, message: error.errors[0]?.message ?? "Invalid payment request" });
    }
    const gatewayError = paymentErrorResponse(error);
    if (gatewayError) {
      return res.status(gatewayError.status).json({ success: false, message: gatewayError.message });
    }
    return res.status(500).json({ success: false, message: "Payment processing error" });
  }
});

router.get("/payments/status/:referenceId", async (req, res) => {
  if (rejectFakePaymentsInProduction(res)) {
    return;
  }

  try {
    const referenceId = z.string().min(1).parse(req.params.referenceId);
    const intent = await paymentService.getPaymentStatus(referenceId);

    if (!intent) {
      return res.status(404).json({ success: false, message: "Payment session not found." });
    }

    return res.json({
      success: true,
      referenceId: intent.referenceId,
      bookingId: intent.bookingId,
      amount: intent.amount,
      paymentMethod: intent.paymentMethod,
      reservationType: intent.reservationType,
      purpose: intent.purpose,
      status: intent.status === "succeeded" ? "paid" : intent.status,
      transactionId: intent.transactionId ?? null,
      paidAt: intent.paidAt ?? null,
      expiresAt: intent.expiresAt ?? null
    });
  } catch (error) {
    console.error("Payment status error:", error);
    if (error instanceof z.ZodError) {
      return res.status(400).json({ success: false, message: error.errors[0]?.message ?? "Invalid payment reference" });
    }
    return res.status(500).json({ success: false, message: "Payment status error" });
  }
});

router.post("/payments/verify", async (req, res) => {
  if (rejectFakePaymentsInProduction(res)) {
    return;
  }

  try {
    const body = z
      .object({
        referenceId: z.string().min(1),
        bookingId: z.string().min(1),
        gatewayData: z.any().optional()
      })
      .parse(req.body) as VerifyPaymentParams;

    const takeoutOrder = await prisma.takeoutOrder.findUnique({
      where: { order_number: body.bookingId },
      select: { id: true }
    });
    if (takeoutOrder) {
      return res.status(400).json({
        success: false,
        message: "Pickup orders are paid in cash at the counter."
      });
    }

    const result = await paymentService.verifyPayment(body);

    if (!result.success) {
      // A hosted checkout that is still open is not an error; the client keeps waiting.
      return res.status(result.status === "pending" ? 202 : 400).json(result);
    }

    return res.json(result);
  } catch (error) {
    console.error("Payment verification error:", error instanceof Error ? error.message : error);
    if (error instanceof z.ZodError) {
      return res.status(400).json({ success: false, message: error.errors[0]?.message ?? "Invalid verification request" });
    }
    const gatewayError = paymentErrorResponse(error);
    if (gatewayError) {
      return res.status(gatewayError.status).json({ success: false, message: gatewayError.message });
    }
    return res.status(500).json({ success: false, message: "Verification error" });
  }
});

/**
 * PayMongo webhook. Register it for the `checkout_session.payment.paid` event at
 * https://<api-host>/api/payments/paymongo/webhook and put the webhook's secret
 * key (whsk_...) in PAYMONGO_WEBHOOK_SECRET.
 */
router.post("/payments/paymongo/webhook", async (req, res) => {
  const webhookSecret = process.env.PAYMONGO_WEBHOOK_SECRET?.trim();
  if (!webhookSecret) {
    console.error("[PayMongo webhook] PAYMONGO_WEBHOOK_SECRET is not set; rejecting the event so PayMongo retries it.");
    return res.status(503).json({ received: false });
  }

  const rawBody = (req as RequestWithRawBody).rawBody;
  const event = req.body?.data;
  if (!rawBody || !event || event.type !== "event") {
    return res.status(400).json({ received: false });
  }

  const signature = verifyPayMongoSignature(
    rawBody,
    req.header("Paymongo-Signature"),
    webhookSecret,
    Boolean(event.attributes?.livemode)
  );
  if (!signature.valid) {
    console.warn(`[PayMongo webhook] Rejected event ${String(event.id ?? "unknown")}: ${signature.reason}`);
    return res.status(401).json({ received: false });
  }

  const eventType = event.attributes?.type;
  const resource = event.attributes?.data;
  if (
    eventType === "checkout_session.payment.paid" &&
    resource?.type === "checkout_session" &&
    typeof resource.id === "string"
  ) {
    try {
      await paymentService.handleHostedCheckoutEvent(resource.id);
    } catch (error) {
      console.error(
        `[PayMongo webhook] Could not process ${String(event.id)}:`,
        error instanceof Error ? error.message : error
      );
      // A non-2xx response makes PayMongo deliver the event again.
      return res.status(500).json({ received: false });
    }
  }

  return res.status(200).json({ received: true });
});

export default router;

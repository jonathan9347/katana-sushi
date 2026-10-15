import express from "express";
import { z } from "zod";
import { PaymentService } from "../services/payment.service";
import { CreatePaymentIntentParams, VerifyPaymentParams } from "../interfaces/paymentGateway.interface";
import { PaymentGatewayFactory } from "../services/payment/paymentGateway.factory";
import { prisma } from "../lib/prisma";

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

router.post("/payments/create-intent", async (req, res) => {
  if (rejectFakePaymentsInProduction(res)) {
    return;
  }

  try {
    const body = z
      .object({
        amount: z.number().positive(),
        paymentMethod: z.enum(["cash", "gcash", "bank_transfer"]),
        bookingId: z.string().min(1),
        reservationType: z.enum(["dine_in", "catering", "takeout"]),
        purpose: z.enum(["downpayment", "full_payment", "balance"]).optional(),
        idempotencyKey: z.string().min(1).optional(),
        description: z.string().optional(),
        successUrl: z.string().url().optional(),
        failureUrl: z.string().url().optional()
      })
      .parse(req.body) as CreatePaymentIntentParams;

    const result = await paymentService.createPaymentIntent(body);
    return res.json(result);
  } catch (error) {
    console.error("Payment intent error:", error);
    if (error instanceof z.ZodError) {
      return res.status(400).json({ success: false, message: error.errors[0]?.message ?? "Invalid payment request" });
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
      select: {
        id: true,
        order_number: true,
        status: true,
        payment_status: true,
        payment_intent_reference_id: true,
        payment_transaction_id: true,
        total: true
      }
    });
    if (takeoutOrder && takeoutOrder.payment_intent_reference_id !== body.referenceId) {
      return res.status(400).json({
        success: false,
        message: "Payment reference does not match this pickup order."
      });
    }
    if (takeoutOrder) {
      const intent = await paymentService.getPaymentStatus(body.referenceId);
      if (
        !intent ||
        intent.bookingId !== takeoutOrder.order_number ||
        intent.reservationType !== "takeout" ||
        Math.abs(intent.amount - takeoutOrder.total) > 0.01
      ) {
        return res.status(400).json({
          success: false,
          message: "Payment details do not match this pickup order."
        });
      }
    }

    const result = await paymentService.verifyPayment(body);

    if (takeoutOrder && result.success) {
      const paidAt = result.paidAt ?? new Date();
      await prisma.$transaction(async (tx) => {
        const updated = await tx.takeoutOrder.updateMany({
          where: {
            id: takeoutOrder.id,
            payment_intent_reference_id: body.referenceId,
            payment_transaction_id: null
          },
          data: {
            payment_status: "paid",
            payment_transaction_id: result.transactionId,
            paid_at: paidAt,
            status: takeoutOrder.status === "pending_payment" || takeoutOrder.status === "payment_failed"
              ? "pending_approval"
              : takeoutOrder.status
          }
        });
        if (updated.count === 0) {
          const latest = await tx.takeoutOrder.findUnique({
            where: { id: takeoutOrder.id },
            select: { payment_status: true, payment_transaction_id: true }
          });
          if (
            latest?.payment_status !== "paid" ||
            latest.payment_transaction_id !== result.transactionId
          ) {
            throw new Error("Pickup order payment changed while confirmation was being processed.");
          }
        }
      });
    } else if (takeoutOrder && result.status === "failed") {
      await prisma.takeoutOrder.updateMany({
        where: {
          id: takeoutOrder.id,
          payment_intent_reference_id: body.referenceId,
          payment_status: "pending"
        },
        data: {
          payment_status: "failed",
          status: "payment_failed"
        }
      });
    }

    if (!result.success) {
      return res.status(400).json(result);
    }

    return res.json(result);
  } catch (error) {
    console.error("Payment verification error:", error);
    if (error instanceof z.ZodError) {
      return res.status(400).json({ success: false, message: error.errors[0]?.message ?? "Invalid verification request" });
    }
    return res.status(500).json({ success: false, message: "Verification error" });
  }
});

router.post("/payments/webhook", async (req, res) => {
  console.log("Payment webhook received:", req.body);
  res.status(200).json({ received: true });
});

export default router;

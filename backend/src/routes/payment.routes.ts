import express from "express";
import { z } from "zod";
import { PaymentService } from "../services/payment.service";
import { CreatePaymentIntentParams, VerifyPaymentParams } from "../interfaces/paymentGateway.interface";

const router = express.Router();
const paymentService = new PaymentService();

router.post("/payments/create-intent", async (req, res) => {
  try {
    const body = z
      .object({
        amount: z.number().positive(),
        paymentMethod: z.enum(["cash", "gcash", "bank_transfer"]),
        bookingId: z.string().min(1),
        reservationType: z.enum(["dine_in", "catering"]),
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

router.post("/payments/verify", async (req, res) => {
  try {
    const body = z
      .object({
        referenceId: z.string().min(1),
        bookingId: z.string().min(1),
        gatewayData: z.any().optional()
      })
      .parse(req.body) as VerifyPaymentParams;

    const result = await paymentService.verifyPayment(body);

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

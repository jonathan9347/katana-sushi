import { prisma } from "../../lib/prisma";

export type StoredPaymentIntent = {
  referenceId: string;
  bookingId: string;
  purpose: "downpayment" | "full_payment" | "balance";
  idempotencyKey?: string;
  gatewayReference?: string;
  amount: number;
  paymentMethod: string;
  reservationType: string;
  status: "created" | "pending" | "succeeded" | "failed" | "expired" | "cancelled";
  transactionId?: string;
  paidAt?: Date;
  expiresAt?: Date;
  createdAt: Date;
  updatedAt?: Date;
};

class PaymentIntentStore {
  private fromDatabase(intent: {
    reference_id: string;
    booking_id: string;
    purpose: string;
    idempotency_key: string | null;
    gateway_reference: string | null;
    amount: number;
    payment_method: string;
    reservation_type: string;
    status: string;
    transaction_id: string | null;
    paid_at: Date | null;
    expires_at: Date | null;
    created_at: Date;
    updated_at: Date;
  }): StoredPaymentIntent {
    return {
      referenceId: intent.reference_id,
      bookingId: intent.booking_id,
      purpose: intent.purpose === "balance"
        ? "balance"
        : intent.purpose === "full_payment"
          ? "full_payment"
          : "downpayment",
      idempotencyKey: intent.idempotency_key ?? undefined,
      gatewayReference: intent.gateway_reference ?? undefined,
      amount: Number(intent.amount),
      paymentMethod: intent.payment_method,
      reservationType: intent.reservation_type,
      status: this.normalizeStatus(intent.status),
      transactionId: intent.transaction_id ?? undefined,
      paidAt: intent.paid_at ?? undefined,
      expiresAt: intent.expires_at ?? undefined,
      createdAt: intent.created_at,
      updatedAt: intent.updated_at
    };
  }

  private normalizeStatus(status: string): StoredPaymentIntent["status"] {
    if (status === "paid") return "succeeded";
    if (["created", "pending", "succeeded", "failed", "expired", "cancelled"].includes(status)) {
      return status as StoredPaymentIntent["status"];
    }
    return "pending";
  }

  async save(intent: StoredPaymentIntent) {
    await prisma.paymentIntent.upsert({
      where: { reference_id: intent.referenceId },
      update: {
        booking_id: intent.bookingId,
        purpose: intent.purpose,
        idempotency_key: intent.idempotencyKey ?? null,
        gateway_reference: intent.gatewayReference ?? null,
        amount: intent.amount,
        payment_method: intent.paymentMethod,
        reservation_type: intent.reservationType,
        status: intent.status,
        transaction_id: intent.transactionId ?? null,
        paid_at: intent.paidAt ?? null,
        expires_at: intent.expiresAt ?? null
      },
      create: {
        reference_id: intent.referenceId,
        booking_id: intent.bookingId,
        purpose: intent.purpose,
        idempotency_key: intent.idempotencyKey ?? null,
        gateway_reference: intent.gatewayReference ?? null,
        amount: intent.amount,
        payment_method: intent.paymentMethod,
        reservation_type: intent.reservationType,
        status: intent.status,
        transaction_id: intent.transactionId ?? null,
        paid_at: intent.paidAt ?? null,
        expires_at: intent.expiresAt ?? null,
        created_at: intent.createdAt
      }
    });
  }

  async findActiveByIdempotencyKey(idempotencyKey: string) {
    const persisted = await prisma.paymentIntent.findFirst({
      where: {
        idempotency_key: idempotencyKey,
        status: { in: ["created", "pending", "succeeded", "paid"] }
      }
    });
    if (!persisted) {
      return null;
    }

    return this.fromDatabase(persisted);
  }

  async get(referenceId: string) {
    const persisted = await prisma.paymentIntent.findUnique({
      where: { reference_id: referenceId }
    });
    if (!persisted) {
      return null;
    }

    return this.fromDatabase(persisted);
  }

  async markPaid(referenceId: string, transactionId: string, paidAt: Date) {
    const intent = await this.get(referenceId);

    if (!intent) {
      return null;
    }

    if (intent.status !== "succeeded") {
      await prisma.paymentIntent.updateMany({
        where: {
          reference_id: referenceId,
          status: { in: ["created", "pending"] }
        },
        data: {
          status: "succeeded",
          gateway_reference: transactionId,
          transaction_id: transactionId,
          paid_at: paidAt
        }
      });
    }

    return this.get(referenceId);
  }

  async findVerifiedTransaction(transactionId: string) {
    const persisted = await prisma.paymentIntent.findFirst({
      where: {
        status: { in: ["paid", "succeeded"] },
        transaction_id: transactionId
      }
    });
    return persisted ? this.fromDatabase(persisted) : null;
  }

  async markExpired(referenceId: string) {
    const intent = await this.get(referenceId);
    if (!intent || intent.status === "succeeded" || intent.status === "failed" || intent.status === "cancelled") {
      return intent;
    }

    await prisma.paymentIntent.updateMany({
      where: {
        reference_id: referenceId,
        status: { in: ["created", "pending"] }
      },
      data: { status: "expired" }
    });
    return this.get(referenceId);
  }

  async markFailed(referenceId: string) {
    const intent = await this.get(referenceId);
    if (!intent || intent.status === "succeeded" || intent.status === "expired" || intent.status === "cancelled") {
      return intent;
    }

    await prisma.paymentIntent.updateMany({
      where: {
        reference_id: referenceId,
        status: { in: ["created", "pending"] }
      },
      data: { status: "failed" }
    });
    return this.get(referenceId);
  }
}

export const paymentIntentStore = new PaymentIntentStore();

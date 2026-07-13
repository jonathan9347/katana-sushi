export type StoredPaymentIntent = {
  referenceId: string;
  bookingId: string;
  amount: number;
  paymentMethod: string;
  reservationType: string;
  status: "pending" | "paid";
  transactionId?: string;
  paidAt?: Date;
  createdAt: Date;
};

class PaymentIntentStore {
  private intents = new Map<string, StoredPaymentIntent>();

  save(intent: StoredPaymentIntent) {
    this.intents.set(intent.referenceId, intent);
  }

  get(referenceId: string) {
    return this.intents.get(referenceId);
  }

  markPaid(referenceId: string, transactionId: string, paidAt: Date) {
    const intent = this.intents.get(referenceId);

    if (!intent) {
      return null;
    }

    const updated: StoredPaymentIntent = {
      ...intent,
      status: "paid",
      transactionId,
      paidAt
    };

    this.intents.set(referenceId, updated);
    return updated;
  }
}

export const paymentIntentStore = new PaymentIntentStore();

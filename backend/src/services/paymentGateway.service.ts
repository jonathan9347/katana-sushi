export class PaymentGatewayService {
  async createGCashPayment(_amount: number, _referenceId: string) {
    console.log("GCash payment coming soon");
    throw new Error("GCash payments will be available in a future update");
  }

  async verifyWebhookSignature(_payload: unknown, _signature: string): Promise<boolean> {
    return false;
  }
}

import { PaymentGateway } from "../../interfaces/paymentGateway.interface";
import { FakePaymentGateway } from "./fakePayment.gateway";

// When real gateway is ready, import it here:
// import { HitPayGateway } from './hitpay.gateway';
// import { GCashGateway } from './gcash.gateway';

const USE_REAL_GATEWAY = process.env.USE_REAL_GATEWAY === "true";
const GATEWAY_TYPE = process.env.PAYMENT_GATEWAY ?? "fake";

export class PaymentGatewayFactory {
  private static instance: PaymentGateway | null = null;

  static getGateway(): PaymentGateway {
    if (!this.instance) {
      if (USE_REAL_GATEWAY) {
        switch (GATEWAY_TYPE) {
          // case 'hitpay':
          //   this.instance = new HitPayGateway();
          //   break;
          // case 'gcash':
          //   this.instance = new GCashGateway();
          //   break;
          default:
            this.instance = new FakePaymentGateway();
        }
      } else {
        this.instance = new FakePaymentGateway();
      }

      console.log(`[PaymentGateway] Using ${this.instance.gatewayName} for payments`);
    }

    return this.instance;
  }

  static reset(): void {
    this.instance = null;
  }
}

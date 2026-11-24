import { PaymentGateway } from "../../interfaces/paymentGateway.interface";
import { FakePaymentGateway } from "./fakePayment.gateway";
import { PayMongoGateway } from "./paymongo.gateway";

function selectedGatewayType() {
  const configured = process.env.PAYMENT_GATEWAY?.trim().toLowerCase();
  if (configured) {
    return configured;
  }
  // Legacy flag: USE_REAL_GATEWAY=true without PAYMENT_GATEWAY still means the fake gateway.
  return "fake";
}

export class PaymentGatewayFactory {
  private static instance: PaymentGateway | null = null;

  static isFakeGatewayActive(): boolean {
    return this.getGateway().gatewayName === "fake_gateway";
  }

  static getGateway(): PaymentGateway {
    if (!this.instance) {
      const gatewayType = selectedGatewayType();

      switch (gatewayType) {
        case "paymongo": {
          const gateway = new PayMongoGateway();
          if (!gateway.isConfigured) {
            console.error(`[PaymentGateway] ${gateway.configurationProblem} Online payments will fail until it is fixed.`);
          } else if (gateway.isTestMode && process.env.NODE_ENV === "production") {
            console.warn("[PaymentGateway] PayMongo is using a TEST secret key in production. No real money will be collected.");
          }
          this.instance = gateway;
          break;
        }
        case "fake":
          this.instance = new FakePaymentGateway();
          break;
        default:
          console.error(`[PaymentGateway] Unknown PAYMENT_GATEWAY "${gatewayType}". Falling back to the fake test gateway.`);
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

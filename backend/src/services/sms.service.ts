const TEXTBEE_API_BASE_URL = "https://api.textbee.dev/api/v1";
const REQUEST_TIMEOUT_MS = 15_000;

type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

export type SmsResult = { sent: true } | { sent: false; reason: string };

/**
 * Converts a Philippine mobile number to E.164 (+639XXXXXXXXX).
 * Accepts 09XXXXXXXXX, 9XXXXXXXXX, 639XXXXXXXXX and +639XXXXXXXXX; returns null otherwise.
 */
export function toPhilippineMobileE164(phone: string | null | undefined): string | null {
  const digits = (phone ?? "").replace(/[^\d+]/g, "").replace(/(?!^)\+/g, "");
  const match = digits.match(/^(?:\+?63|0)?(9\d{9})$/);
  return match ? `+63${match[1]}` : null;
}

/**
 * Sends SMS through TextBee, which relays messages through the restaurant's
 * Android phone (https://textbee.dev). Never throws: SMS is a courtesy notice,
 * so a failure is logged and reported, not allowed to break a booking action.
 */
export class TextBeeSmsService {
  constructor(
    private readonly apiKey = process.env.TEXTBEE_API_KEY?.trim(),
    private readonly deviceId = process.env.TEXTBEE_DEVICE_ID?.trim(),
    private readonly fetchImpl: FetchLike = (input, init) => fetch(input, init)
  ) {}

  get isConfigured() {
    return Boolean(this.apiKey && this.deviceId);
  }

  private get shouldSend() {
    return process.env.NODE_ENV === "production" || process.env.SEND_SMS_IN_DEVELOPMENT === "true";
  }

  async send(phone: string | null | undefined, message: string): Promise<SmsResult> {
    const recipient = toPhilippineMobileE164(phone);
    if (!recipient) {
      return { sent: false, reason: "No valid Philippine mobile number." };
    }

    if (!this.shouldSend) {
      console.log(`[SMS] Development preview to ${recipient}: ${message}`);
      return { sent: false, reason: "SMS sending is off in development." };
    }

    if (!this.isConfigured) {
      console.error("[SMS] TEXTBEE_API_KEY and TEXTBEE_DEVICE_ID are required to send SMS.");
      return { sent: false, reason: "TextBee is not configured." };
    }

    try {
      const response = await this.fetchImpl(
        `${TEXTBEE_API_BASE_URL}/gateway/devices/${encodeURIComponent(this.deviceId!)}/send-sms`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json", "x-api-key": this.apiKey! },
          body: JSON.stringify({ recipients: [recipient], message }),
          signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS)
        }
      );
      if (!response.ok) {
        const detail = (await response.text().catch(() => "")).slice(0, 200);
        console.error(`[SMS] TextBee returned HTTP ${response.status}: ${detail}`);
        return { sent: false, reason: `TextBee returned HTTP ${response.status}.` };
      }
      return { sent: true };
    } catch (error) {
      console.error("[SMS] TextBee request failed:", error instanceof Error ? error.message : error);
      return { sent: false, reason: "TextBee could not be reached." };
    }
  }
}

export const smsService = new TextBeeSmsService();

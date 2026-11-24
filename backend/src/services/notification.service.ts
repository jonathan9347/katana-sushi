import { format } from "date-fns";
import { getNotificationPreferences } from "./notificationPreferences";
import { smsService, TextBeeSmsService } from "./sms.service";

type ReservationCustomer = {
  name?: string | null;
  phone?: string | null;
  email?: string | null;
};

const SIGNATURE = "- Katana Sushi";

function formatDate(value: Date | string | null | undefined) {
  if (!value) return "";
  const date = typeof value === "string" ? new Date(value) : value;
  return Number.isNaN(date.getTime()) ? "" : format(date, "MMM d, yyyy");
}

function formatTime(value?: string | null) {
  if (!value || !/^\d{2}:\d{2}/.test(value)) return value ?? "";
  const [hours, minutes] = value.split(":").map(Number);
  const suffix = hours >= 12 ? "PM" : "AM";
  return `${hours % 12 || 12}:${minutes.toString().padStart(2, "0")} ${suffix}`;
}

function peso(amount: number) {
  return `PHP ${amount.toLocaleString("en-PH", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

/**
 * Customer SMS notices (TextBee). Emails are sent separately by EmailService.
 * Every method respects the admin "SMS notifications" switch and never throws.
 */
export class NotificationService {
  constructor(private readonly sms: TextBeeSmsService = smsService) {}

  private async sendSms(phone: string | null | undefined, message: string) {
    const preferences = await getNotificationPreferences();
    if (!preferences.sms) {
      return { sent: false as const, reason: "SMS notifications are turned off in settings." };
    }
    return this.sms.send(phone, message);
  }

  async sendConfirmation(bookingId: string, customer: ReservationCustomer, reservation: { date: Date; time: string }) {
    return this.sendSms(
      customer.phone,
      `Your Katana Sushi reservation ${bookingId} on ${formatDate(reservation.date)} at ${formatTime(reservation.time)} is confirmed. See you! ${SIGNATURE}`
    );
  }

  async sendRejection(bookingId: string, customer: ReservationCustomer, reason: string, suggestions?: string | null) {
    const note = (suggestions || reason || "").trim();
    return this.sendSms(
      customer.phone,
      `Sorry, we can't accept reservation ${bookingId}.${note ? ` ${note.slice(0, 200)}` : ""} ${SIGNATURE}`
    );
  }

  async sendCateringContacted(inquiryId: string, customer: ReservationCustomer) {
    return this.sendSms(
      customer.phone,
      `We received your catering inquiry ${inquiryId}. Our team will contact you soon. ${SIGNATURE}`
    );
  }

  async sendCateringReceived(reservationId: string, customer: ReservationCustomer, amountPaid: number) {
    return this.sendSms(
      customer.phone,
      `We received your catering request ${reservationId}${amountPaid > 0 ? ` and your payment of ${peso(amountPaid)}` : ""}. We'll confirm it soon. ${SIGNATURE}`
    );
  }

  async sendCateringApproved(reservationId: string, customer: ReservationCustomer, eventDate: Date | string | null | undefined) {
    const date = formatDate(eventDate);
    return this.sendSms(
      customer.phone,
      `Your catering booking ${reservationId}${date ? ` for ${date}` : ""} is confirmed. Thank you! ${SIGNATURE}`
    );
  }
}

export const notificationService = new NotificationService();

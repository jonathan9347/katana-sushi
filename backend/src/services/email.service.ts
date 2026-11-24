import { format } from "date-fns";
import nodemailer, { Transporter } from "nodemailer";
import { Resend } from "resend";
import { getNotificationPreferences } from "./notificationPreferences";

type EmailItem = {
  name: string;
  quantity: number;
  price: number;
};

export type BookingEmailDetails = {
  bookingId: string;
  email: string;
  name: string;
  date: Date | string;
  time?: string | null;
  partySize?: number | null;
  items?: EmailItem[] | null;
  total?: number | null;
  downpayment?: number | null;
  remaining?: number | null;
  status?: string | null;
  specialRequests?: string | null;
};

export type CateringEmailDetails = {
  bookingId: string;
  email: string;
  name: string;
  date: Date | string;
  partySize?: number | null;
  packageName?: string | null;
  venueAddress?: string | null;
  items?: EmailItem[] | null;
  total?: number | null;
  downpayment?: number | null;
  remaining?: number | null;
  status?: string | null;
  specialRequests?: string | null;
};

const RESTAURANT_ADDRESS = process.env.RESTAURANT_ADDRESS ?? "Katana Sushi Restaurant";
const RESTAURANT_PHONE = process.env.RESTAURANT_PHONE ?? "Please contact Katana Sushi";

/**
 * Gmail SMTP settings. Gmail needs an App Password (Google Account -> Security ->
 * 2-Step Verification -> App passwords), not the account password.
 * Port 465 uses implicit SSL/TLS; port 587 uses STARTTLS.
 */
export function getSmtpConfig(env: NodeJS.ProcessEnv = process.env) {
  const user = env.SMTP_USER?.trim();
  const pass = env.SMTP_PASS?.replace(/\s+/g, "");
  if (!user || !pass) {
    return null;
  }
  const port = Number(env.SMTP_PORT ?? 465);
  const safePort = Number.isInteger(port) && port > 0 ? port : 465;
  const secure = env.SMTP_SECURE ? env.SMTP_SECURE.trim().toLowerCase() === "true" : safePort === 465;
  return {
    host: env.SMTP_HOST?.trim() || "smtp.gmail.com",
    port: safePort,
    secure,
    requireTLS: !secure,
    auth: { user, pass },
    from: env.EMAIL_FROM?.trim() || `Katana Sushi <${user}>`
  };
}

export class EmailService {
  private smtpTransport: Transporter | null = null;

  async sendBookingConfirmation(details: BookingEmailDetails): Promise<void> {
    await this.send(
      details.email,
      `Booking received - ${details.bookingId}`,
      this.renderBookingEmail(details, "Booking Request Received", "pending")
    );
  }

  async sendApprovalNotification(details: BookingEmailDetails): Promise<void> {
    await this.send(
      details.email,
      `Booking confirmed - ${details.bookingId}`,
      this.renderBookingEmail(details, "Booking Confirmed", "confirmed")
    );
  }

  async sendRejectionNotification(
    bookingId: string,
    email: string,
    name: string,
    reason: string,
    suggestions?: string | null
  ): Promise<void> {
    await this.send(
      email,
      `Booking update - ${bookingId}`,
      this.renderRejectionEmail(bookingId, email, name, reason, suggestions)
    );
  }

  async sendCateringConfirmation(details: CateringEmailDetails): Promise<void> {
    await this.send(
      details.email,
      `Catering request received - ${details.bookingId}`,
      this.renderCateringEmail(details, "Catering Request Received", "pending approval")
    );
  }

  async sendCateringApproval(details: CateringEmailDetails): Promise<void> {
    await this.send(
      details.email,
      `Catering booking confirmed - ${details.bookingId}`,
      this.renderCateringEmail(details, "Catering Booking Confirmed", "confirmed")
    );
  }

  private async send(to: string, subject: string, html: string): Promise<void> {
    if (!to?.trim()) {
      return;
    }

    const preferences = await getNotificationPreferences();
    if (!preferences.email) {
      console.log(`[EmailService] Email notifications are turned off in settings; skipped: ${subject}`);
      return;
    }

    const shouldSend = process.env.NODE_ENV === "production" || process.env.SEND_EMAILS_IN_DEVELOPMENT === "true";

    if (!shouldSend) {
      console.log(`[EmailService] Development email preview: ${subject} -> ${to}`);
      return;
    }

    // Gmail SMTP when configured; Resend remains as a fallback.
    const smtp = getSmtpConfig();
    if (smtp) {
      if (!this.smtpTransport) {
        this.smtpTransport = nodemailer.createTransport({
          host: smtp.host,
          port: smtp.port,
          secure: smtp.secure,
          requireTLS: smtp.requireTLS,
          auth: smtp.auth
        });
      }
      await this.smtpTransport.sendMail({ from: smtp.from, to, subject, html });
      return;
    }

    const apiKey = process.env.RESEND_API_KEY?.trim();
    const from = process.env.RESEND_FROM_EMAIL?.trim();

    if (!apiKey || !from) {
      throw new Error("Email is not configured: set SMTP_USER and SMTP_PASS (Gmail), or RESEND_API_KEY and RESEND_FROM_EMAIL.");
    }

    const resend = new Resend(apiKey);
    const { error } = await resend.emails.send({ from, to, subject, html });
    if (error) {
      throw new Error(`Failed to send email: ${error.message}`);
    }
  }

  private renderBookingEmail(details: BookingEmailDetails, title: string, status: string): string {
    return this.layout(
      title,
      details.name,
      `
        ${this.bookingSummary(details.bookingId, details.date, details.time, details.partySize)}
        ${this.status(status)}
        ${this.items(details.items)}
        ${this.paymentSummary(details.total, details.downpayment, details.remaining)}
        ${details.specialRequests ? `<p><strong>Special requests:</strong> ${this.escape(details.specialRequests)}</p>` : ""}
      `
    );
  }

  private renderCateringEmail(details: CateringEmailDetails, title: string, status: string): string {
    return this.layout(
      title,
      details.name,
      `
        ${this.bookingSummary(details.bookingId, details.date, null, details.partySize, "Event date")}
        ${this.status(status)}
        ${details.packageName ? `<p><strong>Package:</strong> ${this.escape(details.packageName)}</p>` : ""}
        ${details.venueAddress ? `<p><strong>Venue:</strong> ${this.escape(details.venueAddress)}</p>` : ""}
        ${this.items(details.items)}
        ${this.paymentSummary(details.total, details.downpayment, details.remaining)}
        ${details.specialRequests ? `<p><strong>Special requests:</strong> ${this.escape(details.specialRequests)}</p>` : ""}
      `
    );
  }

  private renderRejectionEmail(bookingId: string, _email: string, name: string, reason: string, suggestions?: string | null): string {
    return this.layout(
      "Booking Update",
      name,
      `
        ${this.bookingSummary(bookingId, null, null, null)}
        ${this.status("rejected")}
        <p>We are unable to approve this booking at this time.</p>
        <p><strong>Reason:</strong> ${this.escape(reason)}</p>
        ${suggestions ? `<p><strong>Suggestions:</strong> ${this.escape(suggestions)}</p>` : ""}
      `
    );
  }

  private layout(title: string, name: string, content: string): string {
    return `<!doctype html><html><head><meta name="viewport" content="width=device-width, initial-scale=1.0"><meta charset="UTF-8"></head><body style="margin:0;background:#f4f4f5;color:#18181b;font-family:Arial,sans-serif;line-height:1.5"><div style="max-width:600px;margin:0 auto;background:#fff"><header style="padding:28px 24px;background:#dc2626;color:#fff"><h1 style="margin:0;font-size:24px">Katana Sushi</h1></header><main style="padding:28px 24px"><h2 style="margin-top:0">${this.escape(title)}</h2><p>Hello ${this.escape(name)},</p>${content}</main><footer style="padding:20px 24px;background:#27272a;color:#fff;font-size:13px"><strong>Katana Sushi</strong><br>${this.escape(RESTAURANT_ADDRESS)}<br>${this.escape(RESTAURANT_PHONE)}</footer></div></body></html>`;
  }

  private bookingSummary(bookingId: string, date: Date | string | null, time: string | null | undefined, partySize: number | null | undefined, dateLabel = "Date"): string {
    return `<table style="width:100%;border-collapse:collapse;margin:20px 0"><tr><td style="padding:8px 0"><strong>Booking ID</strong></td><td style="padding:8px 0;text-align:right">${this.escape(bookingId)}</td></tr><tr><td style="padding:8px 0"><strong>${dateLabel}</strong></td><td style="padding:8px 0;text-align:right">${this.formatDate(date)}</td></tr>${time ? `<tr><td style="padding:8px 0"><strong>Time</strong></td><td style="padding:8px 0;text-align:right">${this.escape(time)}</td></tr>` : ""}${partySize ? `<tr><td style="padding:8px 0"><strong>Party size</strong></td><td style="padding:8px 0;text-align:right">${partySize}</td></tr>` : ""}</table>`;
  }

  private items(items?: EmailItem[] | null): string {
    if (!items?.length) return "";
    return `<h3>Order items</h3><table style="width:100%;border-collapse:collapse">${items.map((item) => `<tr><td style="padding:6px 0">${this.escape(item.name)} x ${item.quantity}</td><td style="padding:6px 0;text-align:right">${this.money(item.price * item.quantity)}</td></tr>`).join("")}</table>`;
  }

  private paymentSummary(total?: number | null, paid?: number | null, amountDue?: number | null): string {
    return `<h3>Payment summary</h3><table style="width:100%;border-collapse:collapse"><tr><td>Total</td><td style="text-align:right">${this.money(total)}</td></tr><tr><td>Paid</td><td style="text-align:right">${this.money(paid)}</td></tr><tr><td>Amount due</td><td style="text-align:right">${this.money(amountDue)}</td></tr></table>`;
  }

  private status(value: string): string {
    return `<p style="display:inline-block;padding:8px 12px;background:#fee2e2;color:#991b1b;font-weight:bold;text-transform:capitalize">Status: ${this.escape(value)}</p>`;
  }

  private formatDate(value: Date | string | null): string {
    if (!value) return "To be confirmed";
    const date = value instanceof Date ? value : new Date(value);
    return Number.isNaN(date.getTime()) ? this.escape(String(value)) : format(date, "MMMM d, yyyy");
  }

  private money(value?: number | null): string {
    return `PHP ${Number(value ?? 0).toFixed(2)}`;
  }

  private escape(value: string): string {
    return value.replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character] ?? character);
  }
}

export const emailService = new EmailService();
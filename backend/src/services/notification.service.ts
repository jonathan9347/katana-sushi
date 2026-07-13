type ReservationCustomer = {
  name?: string;
  phone: string;
  email: string;
};

export class NotificationService {
  async sendConfirmation(bookingId: string, customer: ReservationCustomer, reservation: { date: Date; time: string }) {
    console.log(`SMS to ${customer.phone}: Your table at Katana Sushi is confirmed! Booking #${bookingId}`);
    console.log(`Email to ${customer.email}: Booking confirmed for ${reservation.date.toISOString().slice(0, 10)} at ${reservation.time}`);
  }

  async sendRejection(bookingId: string, customer: ReservationCustomer, reason: string, suggestions?: string | null) {
    console.log(`SMS to ${customer.phone}: Your booking #${bookingId} was rejected. ${suggestions ?? reason}`);
    console.log(`Email to ${customer.email}: Booking #${bookingId} was rejected. Reason: ${reason}`);
  }

  async sendCateringContacted(inquiryId: string, customer: ReservationCustomer) {
    console.log(`SMS to ${customer.phone}: Katana Sushi has received your catering inquiry #${inquiryId}. Our team will contact you soon.`);
    console.log(`Email to ${customer.email}: Catering inquiry #${inquiryId} is now being reviewed.`);
  }
}

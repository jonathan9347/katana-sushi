import { FormEvent, useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { CalendarPlus, CheckCircle2, Clock3, Search, XCircle } from "lucide-react";
import { api } from "../../lib/api";
import { formatManilaDate, formatTime12 } from "../../lib/dateTime";

type StatusResult = {
  status: string;
  date: string;
  time?: string;
  party_size: number;
  total_price?: number;
  payment_plan?: string;
  downpayment_amount?: number;
  remaining_balance?: number;
  full_payment_paid?: boolean;
  remaining_paid_at_venue?: boolean;
  rejected_reason?: string | null;
  alternative_suggestions?: string | null;
  package_name?: string | null;
  venue_type?: string | null;
};

export default function ReservationStatus() {
  const [searchParams] = useSearchParams();
  const [bookingId, setBookingId] = useState(searchParams.get("bookingId") ?? "");
  const [result, setResult] = useState<StatusResult | null>(null);
  const [message, setMessage] = useState("");

  const statusIcon =
    result?.status === "approved" || result?.status === "confirmed" ? (
      <CheckCircle2 className="h-6 w-6 text-emerald-400" />
    ) : result?.status === "rejected" || result?.status === "cancelled" ? (
      <XCircle className="h-6 w-6 text-katana-red" />
    ) : (
      <Clock3 className="h-6 w-6 text-amber-400" />
    );

  async function checkStatus(event?: FormEvent<HTMLFormElement>) {
    event?.preventDefault();
    setMessage("");
    setResult(null);

    if (!bookingId.trim()) {
      setMessage("Enter a booking ID.");
      return;
    }

    try {
      const bookingKey = bookingId.trim();
      const isCatering = bookingKey.toUpperCase().startsWith("CAT-");
      const endpoint = isCatering
        ? `/api/catering/reservations/status/${bookingKey}`
        : `/api/reservations/status/${bookingKey}`;
      const response = await api.get<StatusResult>(endpoint);
      setResult(response.data);
    } catch {
      setMessage("Booking not found.");
    }
  }

  useEffect(() => {
    if (bookingId) {
      void checkStatus();
    }
  }, []);

  return (
    <main className="px-4 py-8 md:py-10">
      <section className="customer-shell max-w-2xl">
        <div className="customer-card overflow-hidden">
          <div className="border-b border-katana-border px-6 py-5">
            <p className="customer-kicker">Reservation</p>
            <h1 className="mt-2 font-display text-3xl font-bold text-white">Check Booking Status</h1>
          </div>
          <form onSubmit={checkStatus} className="space-y-4 p-6">
            <label className="block">
              <span className="customer-label">Booking ID</span>
              <input className="customer-input uppercase" value={bookingId} onChange={(event) => setBookingId(event.target.value)} placeholder="KTN-20260604-0001" />
            </label>
            <button className="customer-btn-primary flex w-full gap-2" type="submit">
              <Search className="h-4 w-4" /> Check Status
            </button>
            {message && <p className="rounded-xl border border-katana-red/30 bg-katana-red/10 px-4 py-3 text-sm text-katana-red">{message}</p>}
          </form>

          {result && (
            <div className="border-t border-katana-border p-6">
              <div className="flex items-center gap-3">
                {statusIcon}
                <div>
                  <p className="text-xs font-bold uppercase tracking-[0.18em] text-katana-muted">Status</p>
                  <p className="font-display text-2xl font-bold capitalize text-white">{result.status.replace(/_/g, " ")}</p>
                </div>
              </div>
              <div className="mt-6 space-y-2 text-sm text-neutral-300">
                <p>Date: {formatManilaDate(result.date)}</p>
                {result.time && <p>Time: {formatTime12(result.time)}</p>}
                <p>Party size: {result.party_size}</p>
                {result.total_price !== undefined && <p>Total: ₱{result.total_price.toFixed(2)}</p>}
                {result.payment_plan && <p>Payment plan: {result.payment_plan.replace("_", " ")}</p>}
                {result.downpayment_amount !== undefined && <p>Downpayment paid: ₱{result.downpayment_amount.toFixed(2)}</p>}
                {result.remaining_balance !== undefined && <p>Remaining balance: ₱{result.remaining_balance.toFixed(2)}</p>}
                {result.full_payment_paid !== undefined && <p>Full payment completed: {result.full_payment_paid ? "Yes" : "No"}</p>}
                {result.package_name && <p>Package: {result.package_name}</p>}
                {result.venue_type && <p>Venue address: {result.venue_type}</p>}
                {result.rejected_reason && <p className="text-katana-red">Reason: {result.rejected_reason}</p>}
                {result.alternative_suggestions && <p>Suggestion: {result.alternative_suggestions}</p>}
              </div>
              <Link className="customer-btn-secondary mt-6 inline-flex gap-2" to="/reserve">
                <CalendarPlus className="h-4 w-4" /> Make Another Reservation
              </Link>
            </div>
          )}
        </div>
      </section>
    </main>
  );
}

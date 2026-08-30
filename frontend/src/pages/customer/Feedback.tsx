import { FormEvent, useState } from "react";
import axios from "axios";
import { CheckCircle2, MessageSquareHeart, Send, Star } from "lucide-react";
import { api } from "../../lib/api";

const visitTypes = [
  { id: "dine_in", label: "Dine In" },
  { id: "takeout", label: "Takeout" },
  { id: "delivery", label: "Delivery" },
  { id: "catering", label: "Catering" },
  { id: "general", label: "General" }
];

type FeedbackForm = {
  customer_name: string;
  customer_email: string;
  customer_phone: string;
  visit_type: string;
  rating: number;
  message: string;
};

export default function Feedback() {
  const [form, setForm] = useState<FeedbackForm>({
    customer_name: "",
    customer_email: "",
    customer_phone: "",
    visit_type: "dine_in",
    rating: 5,
    message: ""
  });
  const [notice, setNotice] = useState("");
  const [feedbackId, setFeedbackId] = useState("");
  const [submitting, setSubmitting] = useState(false);

  function setField<K extends keyof FeedbackForm>(field: K, value: FeedbackForm[K]) {
    setForm((current) => ({ ...current, [field]: value }));
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setNotice("");
    setSubmitting(true);

    if (form.customer_phone && !/^09\d{9}$/.test(form.customer_phone)) {
      setNotice("Use a valid Philippine mobile number starting with 09.");
      setSubmitting(false);
      return;
    }

    if (form.message.trim().length < 10) {
      setNotice("Please share a little more detail about your experience.");
      setSubmitting(false);
      return;
    }

    try {
      const response = await api.post<{ feedback_id: string }>("/api/feedback", form);
      setFeedbackId(response.data.feedback_id);
    } catch (error) {
      const message = axios.isAxiosError<{ message?: string }>(error)
        ? error.response?.data?.message
        : null;
      setNotice(message ?? "Unable to send feedback. Please try again.");
    } finally {
      setSubmitting(false);
    }
  }

  if (feedbackId) {
    return (
      <main className="px-4 py-8 md:py-12">
        <section className="customer-shell">
          <div className="mx-auto max-w-xl customer-card p-6 text-center md:p-8">
            <CheckCircle2 className="mx-auto h-12 w-12 text-emerald-400" />
            <h1 className="mt-4 font-display text-3xl font-bold text-white">Feedback Sent</h1>
            <p className="mt-3 rounded-xl border border-emerald-500/20 bg-emerald-500/10 px-4 py-3 text-sm font-semibold text-emerald-300">
              Reference: {feedbackId}
            </p>
            <p className="mt-4 text-sm leading-relaxed text-katana-muted">
              Thank you for helping us improve the Katana Sushi experience.
            </p>
          </div>
        </section>
      </main>
    );
  }

  return (
    <main className="px-3 py-6 md:px-4 md:py-12">
      <section className="customer-shell">
        <div className="grid gap-5 lg:grid-cols-[0.85fr_1.15fr]">
          <div className="customer-card overflow-hidden">
            <div
              className="flex min-h-72 flex-col justify-end bg-cover bg-center p-6 text-white md:min-h-full"
              style={{ backgroundImage: "linear-gradient(rgba(5,5,5,0.12), rgba(5,5,5,0.82)), url('/images/hero-banner.jpg')" }}
            >
              <MessageSquareHeart className="h-10 w-10" />
              <h1 className="mt-4 font-display text-3xl font-bold md:text-4xl">Share Your Feedback</h1>
              <p className="mt-3 max-w-md text-sm leading-relaxed text-slate-100">
                Tell us what went well or what we can improve after your Katana Sushi experience.
              </p>
            </div>
          </div>

          <form onSubmit={handleSubmit} className="customer-card">
            <div className="border-b border-katana-border px-5 py-4">
              <p className="customer-kicker">Feedback</p>
              <h2 className="mt-2 font-display text-2xl font-bold text-white">How was your visit?</h2>
            </div>

            <div className="space-y-4 p-5">
              <div className="grid gap-4 sm:grid-cols-2">
                <label className="block">
                  <span className="customer-label">Your Name *</span>
                  <input className="customer-input" value={form.customer_name} onChange={(event) => setField("customer_name", event.target.value)} required />
                </label>
                <label className="block">
                  <span className="customer-label">Visit Type *</span>
                  <select className="customer-input" value={form.visit_type} onChange={(event) => setField("visit_type", event.target.value)}>
                    {visitTypes.map((type) => (
                      <option key={type.id} value={type.id}>{type.label}</option>
                    ))}
                  </select>
                </label>
              </div>

              <div className="grid gap-4 sm:grid-cols-2">
                <label className="block">
                  <span className="customer-label">Email</span>
                  <input className="customer-input" type="email" value={form.customer_email} onChange={(event) => setField("customer_email", event.target.value)} />
                </label>
                <label className="block">
                  <span className="customer-label">Phone</span>
                  <input className="customer-input" inputMode="tel" placeholder="09123456789" value={form.customer_phone} onChange={(event) => setField("customer_phone", event.target.value)} />
                </label>
              </div>

              <div>
                <span className="customer-label">Rating *</span>
                <div className="grid grid-cols-5 gap-2">
                  {[1, 2, 3, 4, 5].map((rating) => (
                    <button
                      key={rating}
                      type="button"
                      className={`flex h-12 items-center justify-center rounded-xl border transition ${
                        form.rating >= rating ? "border-katana-red bg-katana-red text-white" : "border-katana-border bg-katana-elevated text-katana-muted hover:border-katana-red"
                      }`}
                      onClick={() => setField("rating", rating)}
                      aria-label={`${rating} star rating`}
                    >
                      <Star className="h-5 w-5" fill={form.rating >= rating ? "currentColor" : "none"} />
                    </button>
                  ))}
                </div>
              </div>

              <label className="block">
                <span className="customer-label">Message *</span>
                <textarea
                  className="min-h-36 customer-input"
                  value={form.message}
                  onChange={(event) => setField("message", event.target.value)}
                  placeholder="Share your experience with us"
                  required
                />
              </label>

              {notice && <p className="rounded-xl border border-katana-red/30 bg-katana-red/10 px-4 py-3 text-sm font-semibold text-katana-red">{notice}</p>}

              <button className="customer-btn-primary w-full gap-2" disabled={submitting} type="submit">
                <Send className="h-4 w-4" />
                {submitting ? "Sending..." : "Send Feedback"}
              </button>
            </div>
          </form>
        </div>
      </section>
    </main>
  );
}

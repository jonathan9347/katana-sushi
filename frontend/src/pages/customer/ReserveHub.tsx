import { CalendarDays, PartyPopper } from "lucide-react";
import { Link } from "react-router-dom";
import BackToHome from "../../components/layout/BackToHome";

const reservationOptions = [
  {
    title: "Book a table",
    description: "Choose a date, guest count, and menu for your dine-in reservation.",
    to: "/reserve/book",
    icon: CalendarDays
  },
  {
    title: "Book catering",
    description: "Plan sushi catering for a celebration, gathering, or special event.",
    to: "/catering/book",
    icon: PartyPopper
  }
];

export default function ReserveHub() {
  return (
    <main className="px-4 pt-3 pb-8 md:pb-10">
      <div className="customer-shell mb-4">
        <BackToHome />
      </div>
      <section className="customer-shell max-w-4xl">
        <div className="customer-card p-6 sm:p-8">
          <p className="customer-kicker">Reserve</p>
          <h1 className="mt-2 font-display text-3xl font-bold text-white sm:text-4xl">How would you like to book?</h1>
          <p className="mt-3 max-w-2xl text-sm leading-relaxed text-katana-muted sm:text-base">
            Choose a table for dining in or book catering for your event.
          </p>
          <div className="mt-6 grid gap-4 sm:grid-cols-2">
            {reservationOptions.map(({ title, description, to, icon: Icon }) => (
              <Link
                key={to}
                to={to}
                className="group rounded-2xl border border-katana-border bg-katana-surface p-5 transition hover:border-katana-red/60 hover:bg-katana-surface-2 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-katana-red"
              >
                <span className="inline-flex h-11 w-11 items-center justify-center rounded-xl bg-katana-red/15 text-katana-red">
                  <Icon className="h-5 w-5" aria-hidden="true" />
                </span>
                <span className="mt-4 block font-display text-xl font-bold text-white">{title}</span>
                <span className="mt-2 block text-sm leading-relaxed text-katana-muted">{description}</span>
              </Link>
            ))}
          </div>
        </div>
      </section>
    </main>
  );
}

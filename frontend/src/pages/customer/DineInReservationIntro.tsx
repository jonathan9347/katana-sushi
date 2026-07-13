import { CalendarDays, Clock, UtensilsCrossed } from "lucide-react";
import { Link } from "react-router-dom";

const squareFeatures = [
  {
    title: "Simple booking",
    description: "Choose your date, guest count, and reserve your table in one flow.",
    icon: CalendarDays
  },
  {
    title: "Order ahead",
    description: "Pre-select items from our menu before you arrive.",
    icon: UtensilsCrossed
  },
  {
    title: "Secure your spot",
    description: "Confirm with a small downpayment and avoid waiting.",
    icon: Clock
  }
];

export default function DineInReservationIntro() {
  return (
    <main className="px-0 py-6 md:px-3 md:py-10">
      <section className="mx-auto flex min-h-[calc(100vh-4rem)] w-full items-start justify-center px-4 md:max-w-6xl md:items-center md:px-6">
        <div className="w-full space-y-8 md:max-w-3xl">
          <div className="border-0 bg-transparent p-0 shadow-none md:rounded-2xl md:border md:border-katana-border md:bg-katana-surface/90 md:p-8 md:shadow-card md:backdrop-blur">
            <p className="customer-kicker">Dine-in reservation</p>
            <h1 className="mt-3 font-display text-4xl font-bold tracking-tight text-white">Reserve a table at Katana Sushi</h1>
            <p className="mt-4 text-sm leading-relaxed text-katana-muted">
              Experience our minimal Japanese dining concept with curated sushi, nigiri, and seasonal favorites. Start with booking your preferred date and time, then complete the reservation form to order ahead.
            </p>
            <div className="mt-8 grid gap-4 sm:grid-cols-3">
              {squareFeatures.map((feature) => {
                const Icon = feature.icon;

                return (
                  <div key={feature.title} className="border-0 bg-transparent p-0 text-sm text-katana-muted md:rounded-3xl md:border md:border-katana-border md:bg-katana-surface md:p-5">
                    <div className="inline-flex h-11 w-11 items-center justify-center rounded-2xl bg-katana-red text-white">
                      <Icon className="h-5 w-5" />
                    </div>
                    <h2 className="mt-4 font-semibold text-white">{feature.title}</h2>
                    <p className="mt-2 text-sm leading-relaxed text-katana-muted">{feature.description}</p>
                  </div>
                );
              })}
            </div>
            <div className="mt-8 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <p className="text-sm text-katana-muted">Ready to book?</p>
                <p className="text-2xl font-bold text-white">3 easy steps to complete your reservation</p>
              </div>
              <Link className="customer-btn-primary" to="/reserve/book">
                Proceed to booking
              </Link>
            </div>
          </div>
        </div>
      </section>
    </main>
  );
}

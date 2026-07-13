import { ArrowRight, PartyPopper, ShieldCheck, Sparkles } from "lucide-react";
import { Link } from "react-router-dom";

const introPoints = [
  {
    title: "Event planning made simple",
    description: "Choose a package, provide your venue details, and secure your date with one booking flow.",
    icon: PartyPopper
  },
  {
    title: "Fresh sushi stations",
    description: "Sushi, sashimi, and live tempura stations built for gatherings and celebrations.",
    icon: ShieldCheck
  },
  {
    title: "Trusted event support",
    description: "Our team will follow up your request and finalize the quote quickly.",
    icon: Sparkles
  }
];

export default function CateringReservationIntro() {
  return (
    <main className="px-0 py-6 md:px-3 md:py-10">
      <section className="mx-auto flex min-h-[calc(100vh-4rem)] w-full items-start justify-center px-4 md:max-w-6xl md:items-center md:px-6">
        <div className="w-full space-y-8 md:max-w-3xl">
          <div className="border-0 bg-transparent p-0 shadow-none md:rounded-2xl md:border md:border-katana-border md:bg-katana-surface/90 md:p-8 md:shadow-card md:backdrop-blur">
            <p className="customer-kicker">Catering reservation</p>
            <h1 className="mt-3 font-display text-4xl font-bold tracking-tight text-white">Host a private sushi event</h1>
            <p className="mt-4 text-sm leading-relaxed text-katana-muted">
              Book catering for special occasions with curated sushi, sashimi, and live stations. Start here to see event details and proceed to our reservation form.
            </p>
            <div className="mt-8 space-y-4">
              {introPoints.map((point) => {
                const Icon = point.icon;
                return (
                  <div key={point.title} className="flex gap-4 border-0 bg-transparent p-0 md:rounded-3xl md:border md:border-katana-border md:bg-katana-surface md:p-5">
                    <div className="inline-flex h-11 w-11 items-center justify-center rounded-2xl bg-katana-red text-white">
                      <Icon className="h-5 w-5" />
                    </div>
                    <div>
                      <h2 className="font-semibold text-white">{point.title}</h2>
                      <p className="mt-2 text-sm leading-relaxed text-katana-muted">{point.description}</p>
                    </div>
                  </div>
                );
              })}
            </div>
            <div className="mt-8 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <p className="text-sm text-katana-muted">Ready to send your details?</p>
                <p className="text-2xl font-bold text-white">Proceed to the catering reservation form</p>
              </div>
              <Link className="customer-btn-primary inline-flex items-center gap-2" to="/catering/book">
                Proceed to booking <ArrowRight className="h-4 w-4" />
              </Link>
            </div>
          </div>
        </div>
      </section>
    </main>
  );
}

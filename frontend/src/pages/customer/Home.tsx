import { useState } from "react";
import { CalendarDays, ChevronLeft, ChevronRight, Clock, Facebook, MapPin, PartyPopper, Phone, Sparkles, UtensilsCrossed } from "lucide-react";
import { Link } from "react-router-dom";

const experienceHighlights = [
  {
    title: "Unlimited Dining",
    body: "Enjoy curated sushi experiences with flexible packages designed for lingering tables and shared favorites.",
    icon: Sparkles,
    badge: "Unlimited",
    image: "/images/unli-dining.jpg"
  },
  {
    title: "Catering for Every Event",
    body: "Bring Katana's signature sushi to birthdays, office lunches, and private celebrations with ease.",
    icon: PartyPopper,
    badge: "Catering",
    image: "/images/cateringf.jpg"
  },
  {
    title: "Easy Reservations",
    body: "Reserve your table or plan your visit in just a few steps for a smoother dining experience.",
    icon: CalendarDays,
    badge: "Reservations",
    image: "/images/hero-banner.jpg"
  }
];

const actions = [
  {
    title: "Dine-in",
    body: "Reserve a table in minutes, choose your preferred seating, and enjoy a smooth visit with quick service, fresh favorites, and a relaxed atmosphere.",
    steps: ["Pick your date and time", "Choose your preferred seating", "Arrive and enjoy a seamless visit"],
    to: "/reserve",
    label: "Reserve",
    icon: CalendarDays
  },
  {
    title: "Menu",
    body: "Browse signature rolls, premium nigiri, seasonal specials, and chef recommendations designed to guide your next sushi order with ease.",
    steps: ["Explore featured dishes", "Filter by favorites or cravings", "Order with confidence and enjoy"],
    to: "/menu",
    label: "View Menu",
    icon: UtensilsCrossed
  },
  {
    title: "Catering",
    body: "Plan birthdays, office lunches, and private celebrations with customizable menus, flexible serving options, and dedicated support for every event.",
    steps: ["Share your event details", "Choose your menu and package", "Confirm your booking and enjoy"],
    to: "/catering",
    label: "Book Event",
    icon: PartyPopper
  }
];

const galleryItems = [
  {
    title: "Signature Sushi Bar",
    caption: "A polished interior, glowing lighting, and beautifully plated sushi for a memorable visit.",
    image: "/images/catering-banner.jpg"
  },
  {
    title: "Chef's Special Plates",
    caption: "Fresh seasonal highlights and elegant presentation that bring each dish to life.",
    image: "/images/unli-dining.jpg"
  },
  {
    title: "Event Catering Setup",
    caption: "Thoughtfully arranged catering moments designed for celebrations and shared gatherings.",
    image: "/images/hero-banner.jpg"
  }
];

const heroCards = [
  {
    image: "/images/sushi2.png"
  },
  {
    image: "/images/sushi4.png"
  },
  {
    image: "/images/sushi5.png"
  }
];

export default function Home() {
  const [activeGalleryIndex, setActiveGalleryIndex] = useState(0);
  const [activeHeroIndex, setActiveHeroIndex] = useState(1);
  const isMobile = typeof window !== "undefined" ? window.innerWidth < 768 : false;

  return (
    <main>
      <section className="relative overflow-hidden bg-[var(--customer-bg)]">
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_right,rgba(220,38,38,0.18),transparent_40%)] opacity-80" />
        <div className="pointer-events-none absolute inset-0 hidden lg:block">
          <div className="absolute left-12 top-10 h-[calc(100%-7rem)] w-px bg-[color:rgba(15,23,42,0.08)]" />
          <div className="absolute left-[18.5rem] top-20 h-[calc(100%-9rem)] w-px bg-[color:rgba(255,255,255,0.14)]" />
          <div className="absolute right-24 top-28 h-px w-40 bg-[color:rgba(15,23,42,0.08)]" />
          <div className="absolute right-28 top-48 h-px w-28 bg-[color:rgba(255,255,255,0.14)]" />
          <div className="absolute left-24 bottom-24 h-px w-32 bg-[color:rgba(15,23,42,0.08)]" />
          <div className="absolute left-10 top-1/3 h-28 w-px rounded-full bg-[color:rgba(220,38,38,0.18)]" />
          <div className="absolute right-8 top-[35%] h-28 w-px rounded-full bg-[color:rgba(220,38,38,0.18)]" />
          <div className="absolute left-6 top-20 h-px w-20 bg-[color:rgba(15,23,42,0.08)]" />
          <div className="absolute right-16 bottom-32 h-px w-24 bg-[color:rgba(255,255,255,0.12)]" />
          <div className="absolute left-20 bottom-14 h-14 w-14 rounded-full bg-[color:rgba(255,255,255,0.06)]" />
          <div className="absolute right-16 top-16 h-14 w-14 rounded-full bg-[color:rgba(15,23,42,0.06)]" />
          <div className="absolute inset-x-0 top-[10%] h-px bg-[color:rgba(220,38,38,0.1)]" />
        </div>
        <div className="customer-shell relative grid min-h-[78vh] gap-12 py-16 lg:grid-cols-[1.05fr_0.95fr] lg:items-center">
          <div className="relative z-10 max-w-2xl">
            <p className="customer-kicker inline-flex items-center gap-2">
              <Sparkles className="h-4 w-4" /> Katana Sushi
            </p>
            <h1 className="mt-4 font-display text-5xl font-bold leading-[0.95] tracking-tight text-[var(--customer-text)] sm:text-6xl lg:text-7xl">
              Precision. Craft. Sushi.
            </h1>
            <p className="mt-6 text-base leading-relaxed text-[var(--customer-muted)] sm:text-lg">
              A minimal Japanese dining experience in Lumiyap, Divisoria — fresh rolls, curated reservations, and event catering with a futuristic edge.
            </p>
            <div className="mt-10 flex flex-col gap-3 sm:flex-row">
              <Link className="customer-btn-primary" to="/reserve">
                Book a Table
              </Link>
              <Link className="customer-btn-secondary bg-[var(--customer-surface)]/90 text-[var(--customer-text)] shadow-lg shadow-black/20 backdrop-blur hover:bg-[var(--customer-surface-2)]" to="/menu">
                Explore Menu
              </Link>
            </div>
          </div>

          <div className="relative z-10">
            <div className="relative mx-auto flex h-[370px] max-w-[820px] items-center justify-center">
              {heroCards.map((card, index) => {
                const isActive = index === activeHeroIndex;
                const offset = index - activeHeroIndex;
                const normalizedOffset = offset < 0 ? offset + heroCards.length : offset;
                const zIndex = normalizedOffset === 0 ? 30 : normalizedOffset === 1 ? 20 : 10;
                const xShifts = isMobile ? [0, 52, -52] : [0, 96, -96];
                const scale = normalizedOffset === 0 ? 1 : normalizedOffset === 1 ? 0.96 : 0.94;

                return (
                  <div
                    key={card.image}
                    className="absolute transition-all duration-500"
                    style={{
                      zIndex,
                      transform: `translateX(${xShifts[normalizedOffset]}px) scale(${scale})`,
                      filter: isActive ? "none" : "blur(1.8px)",
                      opacity: isActive ? 1 : 0.82
                    }}
                  >
                    <div className="relative h-[360px] w-[260px] overflow-hidden rounded-[2rem]">
                      <img
                        src={card.image}
                        alt="Sushi preview"
                        className="h-full w-full object-contain"
                      />
                    </div>
                  </div>
                );
              })}
            </div>
            <div className="mt-6 flex items-center justify-between sm:px-4">
              <button
                type="button"
                onClick={() => setActiveHeroIndex((prev) => (prev === 0 ? heroCards.length - 1 : prev - 1))}
                className="inline-flex h-11 w-11 items-center justify-center rounded-full border border-[color:var(--customer-border)] bg-[var(--customer-surface)] text-[color:var(--customer-text)] shadow-sm transition hover:border-katana-red hover:text-katana-red"
                aria-label="Previous card"
              >
                <ChevronLeft className="h-5 w-5" />
              </button>
              <span className="text-sm text-[color:var(--customer-muted)]">0{activeHeroIndex + 1} / 03</span>
              <button
                type="button"
                onClick={() => setActiveHeroIndex((prev) => (prev === heroCards.length - 1 ? 0 : prev + 1))}
                className="inline-flex h-11 w-11 items-center justify-center rounded-full border border-[color:var(--customer-border)] bg-[var(--customer-surface)] text-[color:var(--customer-text)] shadow-sm transition hover:border-katana-red hover:text-katana-red"
                aria-label="Next card"
              >
                <ChevronRight className="h-5 w-5" />
              </button>
            </div>
          </div>
        </div>
      </section>

      <section className="customer-shell py-14 md:py-16">
        <div className="mx-auto max-w-3xl text-center">
          <p className="customer-kicker">Choose your experience</p>
          <h2 className="customer-section-title mt-3">Start your visit your way</h2>
          <p className="mt-4 text-base leading-relaxed text-katana-muted sm:text-lg">
            Whether you are joining us for a quick meal, a full dinner, or a special celebration, Katana makes every next step feel effortless.
          </p>
        </div>

        <div className="mt-10 grid gap-4 md:grid-cols-3">
          {actions.map((action) => {
            const Icon = action.icon;

            return (
              <Link
                key={action.to}
                to={action.to}
                className="group customer-card relative overflow-hidden flex h-full flex-col rounded-3xl border border-[color:var(--customer-border)] bg-[linear-gradient(135deg,var(--customer-surface),var(--customer-surface-2))] p-6 text-left shadow-lg shadow-black/10 transition duration-200 hover:-translate-y-1 hover:border-katana-red/40 hover:shadow-[0_18px_45px_rgba(0,0,0,0.12)]"
              >
                <div className="absolute inset-x-0 top-0 h-2 bg-[#FBC9B3]" />
                <div className="flex h-12 w-12 items-center justify-center rounded-2xl border border-katana-red/30 bg-katana-red/10 text-katana-red transition group-hover:bg-katana-red group-hover:text-white">
                  <Icon className="h-5 w-5" />
                </div>
                <h2 className="mt-5 font-display text-2xl font-bold text-[color:var(--customer-text)]">{action.title}</h2>
                <p className="mt-3 text-sm leading-relaxed text-[color:var(--customer-muted)]">{action.body}</p>
                <div className="mt-4 space-y-2">
                  <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-katana-red/90">How it works</p>
                  <ul className="space-y-2 text-sm text-[color:var(--customer-muted)]">
                    {action.steps.map((step) => (
                      <li key={step} className="flex items-start gap-2">
                        <span className="mt-1 h-1.5 w-1.5 rounded-full bg-katana-red" />
                        <span>{step}</span>
                      </li>
                    ))}
                  </ul>
                </div>
                <span className="mt-6 inline-flex text-xs font-bold uppercase tracking-[0.18em] text-katana-red">{action.label} →</span>
              </Link>
            );
          })}
        </div>
      </section>

      <section className="customer-shell pb-14">
        <div className="text-center">
          <p className="customer-kicker">Experience</p>
          <h2 className="customer-section-title mt-2">More ways to enjoy Katana</h2>
        </div>

        <div className="mt-8 grid gap-6 lg:grid-cols-[1.05fr_0.95fr] lg:items-stretch">
          <div className="p-0 sm:p-0">
            <div className="flex items-center gap-2">
              <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-katana-red/10 text-katana-red">
                <Sparkles className="h-5 w-5" />
              </div>
              <span className="text-xs font-bold uppercase tracking-[0.24em] text-katana-red">Curated moments</span>
            </div>

            <div className="mt-6 space-y-5">
              <div>
                <p className="text-sm font-semibold uppercase tracking-[0.24em] text-katana-red/80">Now exploring</p>
                <h3 className="mt-2 font-display text-3xl font-bold text-[color:var(--customer-text)] sm:text-4xl">
                  {experienceHighlights[activeGalleryIndex].title}
                </h3>
              </div>
              <p className="text-base leading-relaxed text-[color:var(--customer-muted)]">
                {experienceHighlights[activeGalleryIndex].body}
              </p>
              <div className="rounded-[1.25rem] border border-katana-red/20 bg-katana-red/5 p-4 text-sm leading-relaxed text-slate-300">
                {experienceHighlights[activeGalleryIndex].title} brings together thoughtful service, immersive presentation, and flexible options that make every visit feel personal and memorable.
              </div>
            </div>
          </div>

          <div className="p-0 sm:p-0">
            <div className="relative overflow-hidden rounded-[1.25rem] experience-image">
              <img
                key={experienceHighlights[activeGalleryIndex].image}
                src={experienceHighlights[activeGalleryIndex].image}
                alt={experienceHighlights[activeGalleryIndex].title}
                className="h-[280px] w-full object-cover sm:h-[360px]"
              />
              <div className="absolute inset-0 bg-gradient-to-t from-black/20 via-transparent to-transparent" />
              <div className="absolute bottom-0 left-0 right-0 p-4 sm:p-6 text-white bg-transparent">
                <p className="!text-white text-[10px] font-semibold uppercase tracking-[0.24em] drop-shadow-[0_2px_8px_rgba(0,0,0,0.7)]">
                  {experienceHighlights[activeGalleryIndex].badge}
                </p>
                <h3 className="!text-white mt-2 font-display text-2xl font-bold drop-shadow-[0_2px_10px_rgba(0,0,0,0.7)] sm:text-3xl">
                  {experienceHighlights[activeGalleryIndex].title}
                </h3>
              </div>

              <button
                type="button"
                onClick={() => setActiveGalleryIndex((prev) => (prev === 0 ? experienceHighlights.length - 1 : prev - 1))}
                className="absolute left-3 top-1/2 flex h-10 w-10 -translate-y-1/2 items-center justify-center rounded-full border border-white/20 bg-black/40 text-white backdrop-blur transition hover:bg-black/60"
                aria-label="Previous experience"
              >
                <ChevronLeft className="h-5 w-5" />
              </button>
              <button
                type="button"
                onClick={() => setActiveGalleryIndex((prev) => (prev === experienceHighlights.length - 1 ? 0 : prev + 1))}
                className="absolute right-3 top-1/2 flex h-10 w-10 -translate-y-1/2 items-center justify-center rounded-full border border-white/20 bg-black/40 text-white backdrop-blur transition hover:bg-black/60"
                aria-label="Next experience"
              >
                <ChevronRight className="h-5 w-5" />
              </button>
            </div>

            <div className="mt-4 flex items-center justify-between gap-3">
              <div className="flex gap-2">
                {experienceHighlights.map((item, index) => {
                  const isActive = index === activeGalleryIndex;

                  return (
                    <button
                      key={item.title}
                      type="button"
                      onClick={() => setActiveGalleryIndex(index)}
                      className={`h-2.5 rounded-full transition-all duration-300 ${isActive ? "w-8 bg-katana-red" : "w-2.5 bg-slate-700 hover:bg-slate-500"}`}
                      aria-label={`Show ${item.title}`}
                    />
                  );
                })}
              </div>
              <div className="text-sm text-[color:var(--customer-muted)]">
                0{activeGalleryIndex + 1} / 0{experienceHighlights.length}
              </div>
            </div>

          </div>
        </div>
      </section>

      <section className="customer-shell pb-8 sm:pb-14">
        <div className="mx-auto mb-4 max-w-2xl text-center sm:mb-6">
          <p className="customer-kicker">Gallery</p>
          <h2 className="customer-section-title mt-2">Moments from the kitchen</h2>
          <p className="mt-3 text-base leading-relaxed text-katana-muted">
            A glimpse of the ambiance, plated favorites, and celebration-ready setups that make Katana feel special.
          </p>
        </div>

        <div className="rounded-[2rem] p-4 shadow-none sm:p-6">
          <div className="hidden md:block">
            <div className="relative h-[420px] overflow-hidden rounded-[1.5rem] sm:h-[520px]">
              <div className="absolute inset-0 overflow-hidden">
                <img
                  key={galleryItems[activeGalleryIndex].image}
                  src={galleryItems[activeGalleryIndex].image}
                  alt={galleryItems[activeGalleryIndex].title}
                  className="h-full w-full object-cover animate-[fadeInScale_800ms_ease-out_forwards]"
                />
              </div>
              <div className="absolute inset-0 bg-gradient-to-t from-black/85 via-black/35 to-transparent" />

              <div className="absolute inset-0 flex">
                {galleryItems.map((item, index) => {
                  const isActive = index === activeGalleryIndex;

                  return (
                    <button
                      key={item.title}
                      type="button"
                      onMouseEnter={() => setActiveGalleryIndex(index)}
                      onFocus={() => setActiveGalleryIndex(index)}
                      className={`group relative flex-1 border-r border-transparent bg-transparent text-left transition-all duration-700 ease-[cubic-bezier(0.22,1,0.36,1)] last:border-r-0 ${isActive ? "flex-[1.15]" : "flex-[0.85] hover:flex-[1.02]"}`}
                    >
                      <div className="absolute inset-0 bg-gradient-to-t from-black/85 via-black/40 to-transparent transition-opacity duration-700 ease-out" />
                      <div className="absolute inset-x-0 bottom-0 p-4 sm:p-5">
                        <p className="text-[10px] font-semibold uppercase tracking-[0.25em] text-slate-50 drop-shadow-[0_2px_8px_rgba(0,0,0,0.95)]">
                          {isActive ? "Now viewing" : "Hover to explore"}
                        </p>
                        <h3 className="mt-2 font-display text-lg font-semibold text-slate-50 transition-all duration-700 ease-out drop-shadow-[0_2px_10px_rgba(0,0,0,0.95)] sm:text-xl">
                          {item.title}
                        </h3>
                        <div className={`overflow-hidden transition-all duration-700 ease-out ${isActive ? "mt-2 max-h-24 opacity-100" : "mt-0 max-h-0 opacity-0"}`}>
                          <p className="text-sm leading-relaxed text-slate-50 drop-shadow-[0_2px_12px_rgba(0,0,0,0.98)]">{item.caption}</p>
                        </div>
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>
          </div>

          <div className="md:hidden">
            <div className="relative h-[420px] overflow-hidden rounded-[1.5rem]">
              <div className="absolute inset-0 overflow-hidden">
                <img
                  key={galleryItems[activeGalleryIndex].image}
                  src={galleryItems[activeGalleryIndex].image}
                  alt={galleryItems[activeGalleryIndex].title}
                  className="h-full w-full object-cover animate-[fadeInScale_800ms_ease-out_forwards]"
                />
              </div>
              <div className="absolute inset-0 bg-gradient-to-t from-black/88 via-black/35 to-transparent" />
              <div className="absolute inset-x-0 bottom-0 p-5">
                <p className="text-[10px] font-semibold uppercase tracking-[0.24em] text-slate-50">Now viewing</p>
                <h3 className="mt-2 font-display text-xl font-semibold text-slate-50">
                  {galleryItems[activeGalleryIndex].title}
                </h3>
                <p className="mt-2 text-sm leading-relaxed text-slate-50">
                  {galleryItems[activeGalleryIndex].caption}
                </p>
              </div>

              <button
                type="button"
                onClick={() => setActiveGalleryIndex((prev) => (prev === 0 ? galleryItems.length - 1 : prev - 1))}
                className="absolute left-3 top-1/2 flex h-10 w-10 -translate-y-1/2 items-center justify-center rounded-full border border-white/20 bg-black/40 text-white backdrop-blur transition hover:bg-black/60"
                aria-label="Previous gallery image"
              >
                <ChevronLeft className="h-5 w-5" />
              </button>
              <button
                type="button"
                onClick={() => setActiveGalleryIndex((prev) => (prev === galleryItems.length - 1 ? 0 : prev + 1))}
                className="absolute right-3 top-1/2 flex h-10 w-10 -translate-y-1/2 items-center justify-center rounded-full border border-white/20 bg-black/40 text-white backdrop-blur transition hover:bg-black/60"
                aria-label="Next gallery image"
              >
                <ChevronRight className="h-5 w-5" />
              </button>
            </div>

            <div className="mt-4 flex items-center justify-between gap-3">
              <div className="flex gap-2">
                {galleryItems.map((item, index) => {
                  const isActive = index === activeGalleryIndex;

                  return (
                    <button
                      key={item.title}
                      type="button"
                      onClick={() => setActiveGalleryIndex(index)}
                      className={`h-2.5 rounded-full transition-all duration-300 ${isActive ? "w-8 bg-katana-red" : "w-2.5 bg-slate-700 hover:bg-slate-500"}`}
                      aria-label={`Show ${item.title}`}
                    />
                  );
                })}
              </div>
              <div className="text-sm text-[color:var(--customer-muted)]">
                0{activeGalleryIndex + 1} / 0{galleryItems.length}
              </div>
            </div>
          </div>
        </div>
      </section>

      <section className="customer-shell pb-4 sm:pb-16">
        <div className="mb-6 max-w-2xl sm:mb-8">
          <p className="customer-kicker">Visit us</p>
          <h2 className="customer-section-title mt-2">Find us easily</h2>
          <p className="mt-3 text-base leading-relaxed text-katana-muted">
            Our location in Lumiyap offers a welcoming stop for diners looking for a relaxing meal, easy access, and a pleasant arrival experience with nearby landmarks and convenient routes.
          </p>
        </div>

        <div className="grid gap-6 lg:grid-cols-[1.1fr_0.9fr] lg:items-start">
          <div className="overflow-hidden rounded-[1.5rem] p-0 sm:p-0">
            <div className="aspect-[16/9] w-full overflow-hidden rounded-[1.1rem]">
              <iframe
                title="Katana Sushi location"
                src="https://www.google.com/maps/embed?pb=!1m18!1m12!1m3!1d31920.127253914365!2d122.1064482!3d6.9478548!2m3!1f0!2f0!3f0!3m2!1i1024!2i768!4f13.1!3m3!1m2!1s0x325087b55f46c7eb%3A0xc5d8675e2f8eb59e!2sLumiyap%20Rd%2C%20Zamboanga%20City!5e0!3m2!1sen!2sph!4v1700000000000"
                className="h-full w-full border-0 bg-slate-950"
                allowFullScreen
                loading="lazy"
                referrerPolicy="no-referrer-when-downgrade"
              />
            </div>
          </div>

          <div className="space-y-4">
            {[
              {
                title: "Convenient access",
                body: "Easy to reach and simple to navigate, making your visit smooth from the moment you arrive."
              },
              {
                title: "Nearby landmarks",
                body: "A well-known area with practical stops nearby, making it easy to plan your outing."
              },
              {
                title: "Relaxed dining destination",
                body: "A comfortable setting that pairs perfectly with a satisfying sushi meal and great company."
              }
            ].map((item) => (
              <div key={item.title} className="relative overflow-hidden rounded-[1.25rem] border border-[color:var(--customer-border)] bg-[var(--customer-surface)] p-4 shadow-lg shadow-black/10">
                <div className="absolute inset-x-0 top-0 h-2 bg-[#FBC9B3]" />
                <div className="flex items-center gap-3">
                  <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-katana-red/10 text-katana-red">
                    <MapPin className="h-5 w-5" />
                  </div>
                  <h3 className="text-lg font-semibold text-[color:var(--customer-text)]">{item.title}</h3>
                </div>
                <p className="mt-3 text-sm leading-relaxed text-[color:var(--customer-muted)]">{item.body}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

    </main>
  );
}

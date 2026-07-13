import { CalendarDays, ClipboardList, Home, Menu, MoonStar, PartyPopper, Search, SunMedium, UtensilsCrossed, X } from "lucide-react";
import { useEffect, useState } from "react";
import { NavLink } from "react-router-dom";

const navItems = [
  { to: "/", label: "Home", icon: Home },
  { to: "/menu", label: "Menu", icon: ClipboardList },
  { to: "/reserve", label: "Dine In", icon: CalendarDays },

  { to: "/catering", label: "Catering", icon: PartyPopper },
  { to: "/reservation/status", label: "Status", icon: Search }
];

function linkClass(isActive: boolean) {
  return isActive ? "text-katana-red" : "text-[var(--customer-muted)] hover:text-[var(--customer-text)]";
}

export default function CustomerNav() {
  const [menuOpen, setMenuOpen] = useState(false);
  const [theme, setTheme] = useState<"dark" | "light">("dark");

  useEffect(() => {
    const storedTheme = window.localStorage.getItem("customer-theme");
    const preferredTheme = storedTheme === "light" || storedTheme === "dark"
      ? storedTheme
      : window.matchMedia("(prefers-color-scheme: light)").matches
        ? "light"
        : "dark";

    setTheme(preferredTheme);
  }, []);

  useEffect(() => {
    document.documentElement.setAttribute("data-theme", theme);
    window.localStorage.setItem("customer-theme", theme);
  }, [theme]);

  return (
    <>
      <nav className="sticky top-0 z-40 hidden border-b border-katana-border/80 bg-[var(--customer-bg)]/90 px-6 py-4 backdrop-blur-xl md:block">
        <div className="mx-auto flex max-w-6xl items-center justify-between">
          <NavLink to="/" className="group flex items-center gap-3">
            <img
              src="/images/katana-logo.jpg"
              alt="Katana Sushi logo"
              className="h-10 w-10 rounded-xl object-cover ring-1 ring-katana-red/40 transition group-hover:ring-katana-red"
            />
            <span className="font-display text-xl font-bold tracking-[0.18em] text-[var(--customer-text)]">KATANA</span>
          </NavLink>
          <div className="flex items-center gap-4 text-xs font-bold uppercase tracking-[0.18em]">
            {navItems.map((item) => (
              <NavLink key={item.to} to={item.to} className={({ isActive }) => linkClass(isActive)}>
                {item.label}
              </NavLink>
            ))}
            <button
              type="button"
              onClick={() => setTheme((current) => (current === "dark" ? "light" : "dark"))}
              className="inline-flex h-10 w-10 items-center justify-center rounded-full border border-katana-border bg-[var(--customer-surface)] text-[var(--customer-text)] shadow-sm transition hover:border-katana-red hover:text-katana-red"
              aria-label="Toggle color theme"
            >
              {theme === "dark" ? <SunMedium className="h-4 w-4" /> : <MoonStar className="h-4 w-4" />}
            </button>
          </div>
        </div>
      </nav>

      <nav className="sticky top-0 z-40 border-b border-katana-border bg-[var(--customer-bg)]/95 px-4 py-3 backdrop-blur-xl md:hidden">
        <div className="mx-auto flex max-w-6xl items-center justify-between">
          <NavLink to="/" className="group flex items-center gap-3">
            <img
              src="/images/katana-logo.jpg"
              alt="Katana Sushi logo"
              className="h-10 w-10 rounded-xl object-cover ring-1 ring-katana-red/40 transition group-hover:ring-katana-red"
            />
            <span className="font-display text-lg font-bold tracking-[0.18em] text-[var(--customer-text)]">KATANA</span>
          </NavLink>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setTheme((current) => (current === "dark" ? "light" : "dark"))}
              className="inline-flex h-10 w-10 items-center justify-center rounded-xl border border-katana-border bg-[var(--customer-surface)] text-[var(--customer-text)] shadow-sm transition hover:border-katana-red hover:text-katana-red"
              aria-label="Toggle color theme"
            >
              {theme === "dark" ? <SunMedium className="h-4 w-4" /> : <MoonStar className="h-4 w-4" />}
            </button>
            <button
              type="button"
              onClick={() => setMenuOpen((open) => !open)}
              aria-expanded={menuOpen}
              className="inline-flex h-10 w-10 items-center justify-center rounded-xl border border-katana-border bg-[var(--customer-surface)] text-[var(--customer-text)] shadow-sm transition hover:border-katana-red hover:text-katana-red"
            >
              {menuOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
            </button>
          </div>
        </div>
        {menuOpen && (
          <div className="mt-3 space-y-2 rounded-2xl border border-katana-border bg-[var(--customer-surface)]/95 p-4 shadow-xl shadow-black/10">
            {navItems.map((item) => {
              const Icon = item.icon;

              return (
                <NavLink
                  key={item.to}
                  to={item.to}
                  onClick={() => setMenuOpen(false)}
                  className={({ isActive }) =>
                    `flex items-center gap-3 rounded-2xl px-4 py-3 text-sm font-bold transition ${linkClass(isActive)}`
                  }
                >
                  <Icon className="h-5 w-5" />
                  <span>{item.label}</span>
                </NavLink>
              );
            })}
          </div>
        )}
      </nav>
    </>
  );
}

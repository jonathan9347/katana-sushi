import { CalendarDays, ClipboardList, Home, Menu, MessageSquareHeart, MoonStar, PartyPopper, Search, ShoppingBag, SunMedium, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { NavLink } from "react-router-dom";
import CustomerMenuSearch from "./CustomerMenuSearch";

const navItems = [
  { to: "/", label: "Home", icon: Home },
  { to: "/menu", label: "Menu", icon: ClipboardList },
  { to: "/takeout", label: "Pickup", icon: ShoppingBag },
  { to: "/reserve", label: "Dine In", icon: CalendarDays },

  { to: "/catering", label: "Catering", icon: PartyPopper },
  { to: "/reservation/status", label: "Status", icon: Search },
  { to: "/feedback", label: "Feedback", icon: MessageSquareHeart }
];

function linkClass(isActive: boolean) {
  return isActive ? "text-katana-red" : "text-[var(--customer-muted)] hover:text-[var(--customer-text)]";
}

export default function CustomerNav({ visible = true }: { visible?: boolean }) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [theme, setTheme] = useState<"dark" | "light">(() =>
    document.documentElement.getAttribute("data-theme") === "light" ? "light" : "dark"
  );
  const menuButtonRef = useRef<HTMLButtonElement | null>(null);
  const menuPanelRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    document.documentElement.setAttribute("data-theme", theme);
    window.localStorage.setItem("customer-theme", theme);
  }, [theme]);

  useEffect(() => {
    if (!menuOpen) return;

    const closeOnOutsidePointer = (event: PointerEvent) => {
      const target = event.target;
      if (
        target instanceof Node &&
        (menuPanelRef.current?.contains(target) || menuButtonRef.current?.contains(target))
      ) {
        return;
      }
      setMenuOpen(false);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      setMenuOpen(false);
      menuButtonRef.current?.focus();
    };

    document.addEventListener("pointerdown", closeOnOutsidePointer);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("pointerdown", closeOnOutsidePointer);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [menuOpen]);

  if (!visible) return null;

  return (
    <>
      <nav data-testid="desktop-customer-nav" aria-label="Customer navigation" className="sticky top-0 z-40 hidden border-b border-katana-border/80 bg-[var(--customer-bg)]/90 px-4 py-4 backdrop-blur-xl md:block lg:px-6">
        <div className="mx-auto grid max-w-6xl grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-x-2 xl:gap-x-6">
          <NavLink to="/" className="group flex min-w-0 items-center gap-2 xl:gap-3">
            <img
              src="/images/katana-logo.jpg"
              alt="Katana Sushi logo"
              className="h-10 w-10 rounded-xl object-cover ring-1 ring-katana-red/40 transition group-hover:ring-katana-red"
            />
            <span className="font-display text-lg font-bold tracking-[0.14em] text-[var(--customer-text)] xl:text-xl xl:tracking-[0.18em]">KATANA</span>
          </NavLink>
          <div data-testid="desktop-customer-tabs" className="flex items-center justify-center gap-2 text-[10px] font-bold uppercase tracking-[0.1em] xl:gap-4 xl:text-xs xl:tracking-[0.18em]">
            {navItems.map((item) => (
              <NavLink key={item.to} to={item.to} className={({ isActive }) => linkClass(isActive)}>
                {item.label}
              </NavLink>
            ))}
          </div>
          <div className="flex min-w-0 items-center justify-end gap-2 xl:gap-3">
            <CustomerMenuSearch />
            <button
              type="button"
              onClick={() => setTheme((current) => (current === "dark" ? "light" : "dark"))}
              className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-katana-border bg-[var(--customer-surface)] text-[var(--customer-text)] shadow-sm transition hover:border-katana-red hover:text-katana-red"
              aria-label="Toggle color theme"
            >
              {theme === "dark" ? <SunMedium className="h-4 w-4" /> : <MoonStar className="h-4 w-4" />}
            </button>
          </div>
        </div>
      </nav>

      <nav data-testid="mobile-customer-nav" aria-label="Customer navigation" className="sticky top-0 z-40 border-b border-katana-border bg-[var(--customer-bg)]/95 px-4 py-3 backdrop-blur-xl md:hidden">
        <div className="mx-auto grid max-w-6xl grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-2">
          <NavLink to="/" className="group flex min-w-0 items-center gap-2">
            <img
              src="/images/katana-logo.jpg"
              alt="Katana Sushi logo"
              className="h-10 w-10 rounded-xl object-cover ring-1 ring-katana-red/40 transition group-hover:ring-katana-red"
            />
            <span className="hidden font-display text-lg font-bold tracking-[0.18em] text-[var(--customer-text)] sm:inline">KATANA</span>
          </NavLink>
          <CustomerMenuSearch variant="mobile" />
          <div className="flex items-center justify-end">
            <button
              ref={menuButtonRef}
              type="button"
              onClick={() => setMenuOpen((open) => !open)}
              aria-expanded={menuOpen}
              aria-label={menuOpen ? "Close navigation menu" : "Open navigation menu"}
              className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-katana-border bg-[var(--customer-surface)] text-[var(--customer-text)] shadow-sm transition hover:border-katana-red hover:text-katana-red"
            >
              {menuOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
            </button>
          </div>
        </div>
        {menuOpen && (
          <div ref={menuPanelRef} data-testid="mobile-navigation-menu" className="mt-3 space-y-2 rounded-2xl border border-katana-border bg-[var(--customer-surface)]/95 p-4 shadow-xl shadow-black/10">
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
            <button
              type="button"
              onClick={() => setTheme((current) => (current === "dark" ? "light" : "dark"))}
              className="flex min-h-11 w-full items-center gap-3 rounded-2xl px-4 py-3 text-sm font-bold text-[var(--customer-text)] transition hover:bg-[var(--customer-surface-2)]"
              aria-label="Toggle color theme"
            >
              {theme === "dark" ? <SunMedium className="h-5 w-5" /> : <MoonStar className="h-5 w-5" />}
              <span>{theme === "dark" ? "Switch to light theme" : "Switch to dark theme"}</span>
            </button>
          </div>
        )}
      </nav>
    </>
  );
}

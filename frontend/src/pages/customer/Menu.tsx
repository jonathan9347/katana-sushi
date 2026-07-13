import { useQuery } from "@tanstack/react-query";
import { Search } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { api, resolveImageUrl } from "../../lib/api";

type Product = {
  id: string;
  name: string;
  category: string;
  price: string | number;
  description?: string | null;
  image_url?: string | null;
  is_available?: boolean;
};

const fallbackProducts: Product[] = [
  { id: "california", name: "California Maki", category: "Classic Roll", price: 290, description: "Crabstick, cucumber, mango" },
  { id: "mango", name: "Mango Roll", category: "Classic Roll", price: 220, description: "Crabstick, mango, sesame" },
  { id: "volcano", name: "Volcano Roll", category: "Special Roll", price: 220, description: "Crab, mango, cucumber" },
  { id: "tuna", name: "Tuna Mayo Roll", category: "Classic Roll", price: 220, description: "Tuna mayo, cucumber" },
  { id: "crunchy", name: "Crunchy Roll", category: "Fried Roll", price: 240, description: "Crisp tempura flakes" },
  { id: "salmon-nigiri", name: "Salmon Nigiri", category: "Nigiri", price: 170, description: "Fresh salmon over sushi rice" },
  { id: "salmon-sashimi", name: "Salmon Sashimi", category: "Sashimi", price: 320, description: "Fresh sliced salmon" },
  { id: "iced-tea", name: "House Iced Tea", category: "Beverage", price: 90, description: "Cold brewed tea" }
];

function money(value: string | number) {
  return new Intl.NumberFormat("en-PH", { style: "currency", currency: "PHP", maximumFractionDigits: 0 }).format(Number(value));
}

export default function Menu() {
  const [category, setCategory] = useState("All");
  const [search, setSearch] = useState("");
  const [scrollActiveCategory, setScrollActiveCategory] = useState("All");
  const groupRefs = useRef<Record<string, HTMLElement | null>>({});
  const productsQuery = useQuery({
    queryKey: ["customer-menu-products"],
    queryFn: async () => (await api.get<{ products: Product[] }>("/api/products")).data.products,
    retry: 1
  });
  const products = productsQuery.data?.length ? productsQuery.data : fallbackProducts;
  const guestFavorites = useMemo(() => {
    const availableProducts = products.filter((product) => product.is_available !== false);
    return availableProducts.slice(0, 4);
  }, [products]);
  const categories = useMemo(() => ["All", ...Array.from(new Set(products.map((product) => product.category)))], [products]);
  const filtered = products.filter((product) => {
    const matchesCategory = category === "All" || product.category === category;
    const haystack = `${product.name} ${product.category} ${product.description ?? ""}`.toLowerCase();

    return matchesCategory && haystack.includes(search.toLowerCase());
  });
  const grouped = categories
    .filter((item) => item !== "All")
    .map((item) => ({
      category: item,
      products: filtered.filter((product) => product.category === item)
    }))
    .filter((group) => group.products.length > 0);

  const activeCategory = category === "All" ? scrollActiveCategory : category;

  useEffect(() => {
    if (category !== "All") {
      return;
    }

    const observer = new IntersectionObserver(
      (entries) => {
        const visibleEntries = entries
          .filter((entry) => entry.isIntersecting)
          .sort((a, b) => b.intersectionRatio - a.intersectionRatio);

        if (visibleEntries.length > 0) {
          const categoryKey = visibleEntries[0].target.getAttribute("data-category") ?? "All";
          setScrollActiveCategory(categoryKey);
        }
      },
      { rootMargin: "-50% 0px -40% 0px", threshold: [0.1, 0.25, 0.5] }
    );

    grouped.forEach((group) => {
      const section = groupRefs.current[group.category];
      if (section) {
        observer.observe(section);
      }
    });

    return () => observer.disconnect();
  }, [grouped, category]);

  return (
    <main className="px-1 py-6 sm:px-4 sm:py-8 md:py-10">
      <section className="customer-shell">
        <div className="overflow-hidden rounded-[2rem] bg-transparent">
          <div className="grid items-center gap-4 lg:grid-cols-[1.05fr_0.95fr] lg:gap-6">
            <div className="max-w-2xl px-1 py-2 sm:px-2 sm:py-3 lg:px-0 lg:py-0">
              <p className="text-xs font-bold uppercase tracking-[0.3em] text-katana-red">Katana Sushi</p>
              <h1 className="mt-3 font-display text-3xl font-bold text-white sm:text-4xl lg:text-5xl">
                Discover your next favorite bite
              </h1>
              <p className="mt-4 text-sm leading-relaxed text-slate-300 sm:text-base">
                Browse refreshing rolls, nigiri favorites, and chef-made specials crafted for every craving and celebration.
              </p>
            </div>
            <div className="group overflow-hidden rounded-[1.25rem] [perspective:1200px]">
              <img
                src="/images/Menu-head.png"
                alt="Katana Sushi menu showcase"
                className="mx-auto h-[220px] w-full max-w-[420px] object-contain transition duration-500 ease-out group-hover:scale-105 group-hover:[transform:rotateY(8deg)_rotateX(-6deg)] sm:h-[260px] lg:h-[320px]"
              />
            </div>
          </div>
        </div>

        <section className="mt-8">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <p className="customer-kicker">Featured</p>
              <h2 className="customer-section-title mt-2">Guest Favorites</h2>
            </div>
            <p className="text-sm leading-relaxed text-katana-muted">A curated selection of our most-loved dishes, chosen for their bold flavors and crowd-pleasing appeal.</p>
          </div>
          <div className="mt-6 grid gap-4 lg:grid-cols-4">
            {guestFavorites.map((product) => {
              const imageSrc = resolveImageUrl(product.image_url);

              return (
                <article key={product.id} className="customer-card overflow-hidden">
                  {imageSrc ? (
                    <div className="aspect-[4/3] overflow-hidden bg-slate-900">
                      <img src={imageSrc} alt={product.name} className="h-full w-full object-cover" />
                    </div>
                  ) : (
                    <div className="flex aspect-[4/3] items-center justify-center bg-katana-elevated text-5xl">
                      🍣
                    </div>
                  )}
                  <div className="p-4">
                    <div className="flex items-start justify-between gap-3">
                      <h3 className="font-display text-lg font-bold text-white">{product.name}</h3>
                      <p className="text-sm font-bold text-katana-red">{money(product.price)}</p>
                    </div>
                    <p className="mt-2 text-sm leading-relaxed text-katana-muted">{product.description ?? "House specialty"}</p>
                  </div>
                </article>
              );
            })}
          </div>
        </section>

        <section className="mt-8">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <p className="customer-kicker">Browse</p>
              <h2 className="customer-section-title mt-2">Menu</h2>
            </div>
            <label className="relative block w-full sm:max-w-xs">
              <Search className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-katana-muted" />
              <input
                className="customer-input pl-11"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Search menu"
              />
            </label>
          </div>
        </section>

        <div className="mt-8 space-y-6 sm:space-y-10">
          {grouped.map((group) => (
            <section key={group.category} data-category={group.category} ref={(el) => (groupRefs.current[group.category] = el)}>
              <h2 className="font-display text-2xl font-bold text-white">{group.category}</h2>
              <div className="mt-4 grid gap-4 lg:grid-cols-4">
                {group.products.map((product) => {
                  const imageSrc = resolveImageUrl(product.image_url);

                  return (
                    <article key={product.id} className="customer-card overflow-hidden">
                      {imageSrc ? (
                        <div className="aspect-[4/3] overflow-hidden bg-slate-900">
                          <img src={imageSrc} alt={product.name} className="h-full w-full object-cover" />
                        </div>
                      ) : (
                        <div className="flex aspect-[4/3] items-center justify-center bg-katana-elevated text-5xl">
                          🍣
                        </div>
                      )}
                      <div className="p-4">
                        <div className="flex items-start justify-between gap-3">
                          <h3 className="font-display text-lg font-bold text-white">{product.name}</h3>
                          <p className="text-sm font-bold text-katana-red">{money(product.price)}</p>
                        </div>
                        <p className="mt-2 text-sm leading-relaxed text-katana-muted">{product.description ?? "House specialty"}</p>
                        {product.is_available === false && (
                          <p className="mt-3 text-xs font-bold uppercase tracking-[0.14em] text-katana-muted">Unavailable</p>
                        )}
                      </div>
                    </article>
                  );
                })}
              </div>
            </section>
          ))}
        </div>
      </section>
    </main>
  );
}

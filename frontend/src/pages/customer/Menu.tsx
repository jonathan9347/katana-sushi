import { useQuery } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { api, resolveBackendImageUrl, resolveImageUrl } from "../../lib/api";
import BackToHome from "../../components/layout/BackToHome";

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
  { id: "california", name: "California Maki", category: "Classic Roll", price: 290, description: "Crabstick, cucumber, mango", image_url: "/images/sushi2.png" },
  { id: "mango", name: "Mango Roll", category: "Classic Roll", price: 220, description: "Crabstick, mango, sesame", image_url: "/images/sushi4.png" },
  { id: "volcano", name: "Volcano Roll", category: "Special Roll", price: 220, description: "Crab, mango, cucumber", image_url: "/images/sushi5.png" },
  { id: "tuna", name: "Tuna Mayo Roll", category: "Classic Roll", price: 220, description: "Tuna mayo, cucumber", image_url: "/images/Menu-head.png" },
  { id: "crunchy", name: "Crunchy Roll", category: "Fried Roll", price: 240, description: "Crisp tempura flakes", image_url: "/images/sushi2.png" },
  { id: "salmon-nigiri", name: "Salmon Nigiri", category: "Nigiri", price: 170, description: "Fresh salmon over sushi rice", image_url: "/images/sushi4.png" },
  { id: "salmon-sashimi", name: "Salmon Sashimi", category: "Sashimi", price: 320, description: "Fresh sliced salmon", image_url: "/images/sushi5.png" },
  { id: "iced-tea", name: "House Iced Tea", category: "Beverage", price: 90, description: "Cold brewed tea", image_url: "/images/unli-dining.jpg" }
];

const PRODUCT_IMAGE_QUERY_OPTIONS = {
  staleTime: 5 * 60 * 1000,
  gcTime: 30 * 60 * 1000,
  refetchOnMount: false,
  refetchOnWindowFocus: false
};

function money(value: string | number) {
  return new Intl.NumberFormat("en-PH", { style: "currency", currency: "PHP", maximumFractionDigits: 0 }).format(Number(value));
}

function fallbackToBackendImage(element: HTMLImageElement, imageUrl?: string | null) {
  const backendImageUrl = resolveBackendImageUrl(imageUrl);

  if (backendImageUrl && element.src !== backendImageUrl) {
    element.src = backendImageUrl;
  }
}

export default function Menu() {
  const [searchParams] = useSearchParams();
  const searchProductId = searchParams.get("productId");
  const [highlightedProductId, setHighlightedProductId] = useState<string | null>(null);
  const productsQuery = useQuery({
    queryKey: ["customer-menu-products"],
    queryFn: async () => (await api.get<{ products: Product[] }>("/api/products")).data.products,
    retry: 1,
    ...PRODUCT_IMAGE_QUERY_OPTIONS
  });
  const products = productsQuery.data?.length ? productsQuery.data : fallbackProducts;
  const productImageUrls = useMemo(() => {
    return Array.from(
      new Set(products.map((product) => resolveImageUrl(product.image_url)).filter((url): url is string => Boolean(url)))
    );
  }, [products]);
  const guestFavorites = useMemo(() => {
    const availableProducts = products.filter((product) => product.is_available !== false);
    return availableProducts.slice(0, 4);
  }, [products]);
  const grouped = useMemo(() => {
    const categories = Array.from(new Set(products.map((product) => product.category)));

    return categories.map((category) => ({
      category,
      products: products.filter((product) => product.category === category)
    }));
  }, [products]);

  useEffect(() => {
    if (!searchProductId || !products.some((product) => product.id === searchProductId)) return;

    const element = document.getElementById(`menu-product-${searchProductId}`);
    if (!element) return;

    setHighlightedProductId(searchProductId);
    const animationFrame = window.requestAnimationFrame(() => {
      element.scrollIntoView({ behavior: "smooth", block: "center" });
    });
    const timeout = window.setTimeout(() => setHighlightedProductId(null), 3000);

    return () => {
      window.cancelAnimationFrame(animationFrame);
      window.clearTimeout(timeout);
    };
  }, [products, searchProductId]);

  useEffect(() => {
    productImageUrls.forEach((url) => {
      const image = new Image();
      image.decoding = "async";
      image.src = url;
    });
  }, [productImageUrls]);

  return (
    <main className="px-1 pt-3 pb-6 sm:px-4 sm:pb-8 md:pb-10">
      <div className="customer-shell mb-4">
        <BackToHome />
      </div>
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
                decoding="async"
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
          <div className="mt-6 grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
            {guestFavorites.map((product) => {
              const imageSrc = resolveImageUrl(product.image_url);

              return (
                <article key={product.id} className="customer-menu-product-card group">
                  <div className="customer-menu-product-art">
                    {imageSrc ? (
                      <img src={imageSrc} alt={product.name} loading="eager" decoding="async" onError={(event) => fallbackToBackendImage(event.currentTarget, product.image_url)} />
                    ) : (
                      <span className="text-6xl" aria-hidden="true">🍣</span>
                    )}
                  </div>
                  <div className="customer-menu-product-panel">
                    <h3 className="line-clamp-2 font-display text-base font-bold leading-tight text-[#2c120f] sm:text-lg">{product.name}</h3>
                    <span className="customer-menu-price-badge text-sm text-[#5a2e32]">{money(product.price)}</span>
                    <p className="line-clamp-2 text-xs leading-relaxed text-[#5b2f30] sm:text-sm">{product.description ?? "House specialty"}</p>
                  </div>
                </article>
              );
            })}
          </div>
        </section>

        <div className="mt-8 space-y-6 sm:mt-10 sm:space-y-10">
          {grouped.map((group) => (
            <section key={group.category}>
              <h2 className="font-display text-2xl font-bold text-white">{group.category}</h2>
              <div className="mt-4 grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
                {group.products.map((product, index) => {
                  const imageSrc = resolveImageUrl(product.image_url);
                  const eagerImage = group.category === grouped[0]?.category && index < 4;

                  return (
                    <article
                      key={product.id}
                      id={`menu-product-${product.id}`}
                      className={`customer-menu-product-card group ${highlightedProductId === product.id ? "ring-4 ring-katana-red ring-offset-4 ring-offset-[var(--customer-bg)]" : ""}`}
                    >
                      <div className="customer-menu-product-art">
                        {imageSrc ? (
                          <img src={imageSrc} alt={product.name} loading={eagerImage ? "eager" : "lazy"} decoding="async" onError={(event) => fallbackToBackendImage(event.currentTarget, product.image_url)} />
                        ) : (
                          <span className="text-6xl" aria-hidden="true">🍣</span>
                        )}
                      </div>
                      <div className="customer-menu-product-panel">
                        <h3 className="line-clamp-2 font-display text-base font-bold leading-tight text-[#2c120f] sm:text-lg">{product.name}</h3>
                        <span className="customer-menu-price-badge text-sm text-[#5a2e32]">{money(product.price)}</span>
                        <p className="line-clamp-2 text-xs leading-relaxed text-[#5b2f30] sm:text-sm">{product.description ?? "House specialty"}</p>
                        {product.is_available === false && (
                          <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-[#7a2d2f]">Unavailable</p>
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

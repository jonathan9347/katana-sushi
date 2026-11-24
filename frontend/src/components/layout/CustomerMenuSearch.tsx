import { useQuery } from "@tanstack/react-query";
import { useEffect, useId, useMemo, useRef, useState } from "react";
import { Search, X } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { api } from "../../lib/api";

type MenuProduct = {
  id: string;
  name: string;
  category: string;
  price: string | number;
};

type CustomerMenuSearchProps = {
  variant?: "desktop" | "mobile";
};

function normalizeSearch(value: string) {
  return value.trim().replace(/\s+/g, " ").toLocaleLowerCase();
}

function formatPrice(value: string | number) {
  return new Intl.NumberFormat("en-PH", {
    style: "currency",
    currency: "PHP",
    maximumFractionDigits: 0
  }).format(Number(value));
}

export default function CustomerMenuSearch({ variant = "desktop" }: CustomerMenuSearchProps) {
  const navigate = useNavigate();
  const listboxId = useId();
  const searchAreaRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const isMobile = variant === "mobile";
  const [query, setQuery] = useState("");
  const [debouncedQuery, setDebouncedQuery] = useState("");
  const [isOpen, setIsOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);

  const productsQuery = useQuery({
    queryKey: ["customer-menu-products"],
    queryFn: async () => (await api.get<{ products: MenuProduct[] }>("/api/products")).data.products,
    retry: 1,
    staleTime: 5 * 60 * 1000,
    gcTime: 30 * 60 * 1000,
    refetchOnMount: false,
    refetchOnWindowFocus: false
  });

  useEffect(() => {
    const timeout = window.setTimeout(() => setDebouncedQuery(query), 150);
    return () => window.clearTimeout(timeout);
  }, [query]);

  useEffect(() => {
    if (!isOpen) return;

    const closeOnOutsidePointer = (event: PointerEvent) => {
      const target = event.target;
      if (target instanceof Node && searchAreaRef.current?.contains(target)) return;
      setIsOpen(false);
      setActiveIndex(-1);
    };

    document.addEventListener("pointerdown", closeOnOutsidePointer);
    return () => document.removeEventListener("pointerdown", closeOnOutsidePointer);
  }, [isOpen]);

  const normalizedQuery = normalizeSearch(query);
  const isDebouncing = normalizedQuery !== normalizeSearch(debouncedQuery);
  const results = useMemo(() => {
    const normalized = normalizeSearch(debouncedQuery);
    if (!normalized) return [];

    return (productsQuery.data ?? [])
      .filter((product) =>
        normalizeSearch(product.name).includes(normalized) ||
        normalizeSearch(product.category).includes(normalized)
      )
      .slice(0, 8);
  }, [debouncedQuery, productsQuery.data]);

  const dropdownVisible = isOpen && normalizedQuery.length > 0;
  const activeProduct = results[activeIndex];

  function selectProduct(product: MenuProduct) {
    setIsOpen(false);
    setActiveIndex(-1);
    setQuery("");
    setDebouncedQuery("");
    navigate(`/menu?productId=${encodeURIComponent(product.id)}`);
  }

  function handleKeyDown(event: React.KeyboardEvent<HTMLInputElement>) {
    if (event.key === "Escape" && isOpen) {
      event.preventDefault();
      setIsOpen(false);
      setActiveIndex(-1);
      return;
    }

    if (!dropdownVisible || isDebouncing || results.length === 0) return;

    if (event.key === "ArrowDown") {
      event.preventDefault();
      setActiveIndex((current) => (current + 1) % results.length);
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setActiveIndex((current) => (current <= 0 ? results.length - 1 : current - 1));
    } else if (event.key === "Enter" && activeProduct) {
      event.preventDefault();
      selectProduct(activeProduct);
    }
  }

  return (
    <div ref={searchAreaRef} className={isMobile ? "contents" : "relative min-w-0 shrink-0"}>
      <label className={`relative block ${isMobile ? "w-full" : "w-32 md:w-36 xl:w-56"}`}>
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-katana-muted" aria-hidden="true" />
        <input
          ref={inputRef}
          type="search"
          role="combobox"
          aria-label="Search menu products"
          aria-autocomplete="list"
          aria-controls={dropdownVisible && results.length > 0 && !isDebouncing ? listboxId : undefined}
          aria-expanded={dropdownVisible}
          aria-activedescendant={activeProduct ? `${listboxId}-option-${encodeURIComponent(activeProduct.id)}` : undefined}
          autoComplete="off"
          value={query}
          onChange={(event) => {
            setQuery(event.target.value);
            setIsOpen(true);
            setActiveIndex(-1);
          }}
          onFocus={() => {
            if (normalizedQuery) setIsOpen(true);
          }}
          onKeyDown={handleKeyDown}
          placeholder="Search menu..."
          className="h-10 w-full rounded-full border border-katana-border bg-[var(--customer-surface)] pl-9 pr-9 text-xs text-[var(--customer-text)] outline-none transition placeholder:text-katana-muted focus:border-katana-red focus:ring-1 focus:ring-katana-red"
        />
        {query.length > 0 && (
          <button
            type="button"
            aria-label="Clear menu search"
            onPointerDown={(event) => event.preventDefault()}
            onClick={() => {
              setQuery("");
              setDebouncedQuery("");
              setIsOpen(false);
              setActiveIndex(-1);
              inputRef.current?.focus();
            }}
            className="absolute right-2 top-1/2 inline-flex h-7 w-7 -translate-y-1/2 items-center justify-center rounded-full text-katana-muted transition hover:bg-[var(--customer-surface-2)] hover:text-[var(--customer-text)]"
          >
            <X className="h-4 w-4" aria-hidden="true" />
          </button>
        )}
      </label>
      {dropdownVisible && (
        <div className={`${isMobile ? "absolute left-3 right-3 top-full z-[60]" : "absolute right-0 top-full z-50 mt-2 w-80 max-w-[calc(100vw-2rem)]"} overflow-hidden rounded-2xl border border-katana-border bg-[var(--customer-surface)] shadow-xl shadow-black/20`}>
          {isDebouncing ? (
            <p className="px-4 py-3 text-sm text-[var(--customer-muted)]" role="status">Searching...</p>
          ) : productsQuery.isPending ? (
            <p className="px-4 py-3 text-sm text-[var(--customer-muted)]" role="status">Loading menu...</p>
          ) : productsQuery.isError && !productsQuery.data ? (
            <div className="px-4 py-3 text-sm text-[var(--customer-text)]" role="alert">
              <p>Menu search is unavailable.</p>
              <button type="button" onClick={() => void productsQuery.refetch()} className="mt-2 font-semibold text-katana-red underline">
                Try again
              </button>
            </div>
          ) : results.length === 0 ? (
            <p className="px-4 py-3 text-sm text-[var(--customer-muted)]" role="status">No results</p>
          ) : (
            <div id={listboxId} role="listbox" aria-label="Menu product search results" className="max-h-96 overflow-y-auto p-1.5">
              {results.map((product, index) => (
                <button
                  key={product.id}
                  id={`${listboxId}-option-${encodeURIComponent(product.id)}`}
                  type="button"
                  role="option"
                  aria-selected={index === activeIndex}
                  onMouseEnter={() => setActiveIndex(index)}
                  onPointerDown={(event) => event.preventDefault()}
                  onClick={() => selectProduct(product)}
                  className={`flex w-full items-center justify-between gap-4 rounded-xl px-3 py-2.5 text-left transition ${
                    index === activeIndex
                      ? "bg-katana-red/10 text-[var(--customer-text)]"
                      : "text-[var(--customer-text)] hover:bg-[var(--customer-surface-2)]"
                  }`}
                >
                  <span className="min-w-0">
                    <span className="block truncate text-sm font-semibold">{product.name}</span>
                    <span className="mt-0.5 block truncate text-xs text-[var(--customer-muted)]">{product.category}</span>
                  </span>
                  <span className="shrink-0 text-sm font-semibold">{formatPrice(product.price)}</span>
                </button>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

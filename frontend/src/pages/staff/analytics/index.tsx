import { KeyboardEvent, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis
} from "recharts";
import {
  AlertTriangle,
  Archive,
  BadgeDollarSign,
  Box,
  CalendarDays,
  Check,
  ChevronDown,
  ChevronUp,
  Crown,
  Minus,
  Package,
  ShoppingBag,
  TrendingDown,
  TrendingUp,
  Trash2
} from "lucide-react";
import { api } from "../../../lib/api";
import { Select } from "../../../components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "../../../components/ui/table";
import "./Analytics.css";

type ProductInsight = {
  productId: string;
  name: string;
  category: string;
  price: number;
  totalQuantity: number;
  totalRevenue: number;
  frequencyRank: number;
  percentile: number;
  trend: number;
  priority: "high" | "medium" | "low" | "minimal";
  insight: string;
  avgDailySales: number;
};

type AnalyticsOverview = {
  periodDays: number;
  waste: {
    totalTransactions: number;
    totalCost: number;
    byReason: Record<string, { count: number; quantity: number; cost: number }>;
  };
  expiry: {
    expiringWithin7Days: number;
    alreadyExpired: number;
  };
  salesTrend: Array<{ date: string; total: number }>;
};

type InventoryHistory = {
  snapshots: Array<{
    date: string;
    totalValue: number;
    totalQuantity: number;
  }>;
  wasteHistory: Array<{
    id: string;
    created_at: string;
    quantity: string | number;
    unit: string;
    reason?: string;
    raw_material: { name: string };
  }>;
};

function money(value: number) {
  return `PHP ${Number(value).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function priorityColor(priority: ProductInsight["priority"]) {
  switch (priority) {
    case "high":
      return "analytics-priority-high";
    case "medium":
      return "analytics-priority-medium";
    case "low":
      return "analytics-priority-low";
    default:
      return "analytics-priority-minimal";
  }
}

const donutColors = ["#9B1D20", "#C62D30", "#E0575C", "#F0B9BB", "#E4DEDE"];

function createDonutSlices(products: ProductInsight[]) {
  const topProducts = products.slice(0, 4).map((product, index) => ({
    name: product.name,
    units: Math.max(0, product.totalQuantity),
    color: donutColors[index]
  }));
  const otherUnits = products.slice(4).reduce((total, product) => total + Math.max(0, product.totalQuantity), 0);
  if (otherUnits > 0) {
    topProducts.push({ name: "Others", units: otherUnits, color: donutColors[4] });
  }

  const total = topProducts.reduce((sum, product) => sum + product.units, 0);
  if (total <= 0) return [];

  const shares = topProducts.map((product) => (product.units / total) * 100);
  const roundedShares = shares.map(Math.floor);
  let remainder = 100 - roundedShares.reduce((sum, share) => sum + share, 0);
  const byRemainder = shares
    .map((share, index) => ({ index, fraction: share - Math.floor(share) }))
    .sort((first, second) => second.fraction - first.fraction);
  for (let index = 0; index < remainder; index += 1) {
    roundedShares[byRemainder[index % byRemainder.length].index] += 1;
  }

  return topProducts.map((product, index) => ({
    ...product,
    percent: roundedShares[index]
  }));
}

function formatAverage(value: number) {
  return Number(value).toLocaleString(undefined, { maximumFractionDigits: 2 });
}

export default function AnalyticsPage() {
  const [days, setDays] = useState("30");
  const [bestSellerMetric, setBestSellerMetric] = useState<"units" | "revenue">("units");
  const [showAllUnsold, setShowAllUnsold] = useState(false);

  const insightsQuery = useQuery({
    queryKey: ["analytics", "product-insights", days],
    queryFn: async () => {
      const response = await api.get<{
        periodDays: number;
        products: ProductInsight[];
        unsoldProducts: Array<{ productId: string; name: string; category: string }>;
        summary: {
          topSeller: ProductInsight | null;
          leastSold: ProductInsight | null;
          totalUnitsSold: number;
          totalRevenue: number;
        };
      }>("/api/analytics/product-insights", { params: { days } });
      return response.data;
    }
  });

  const overviewQuery = useQuery({
    queryKey: ["analytics", "overview", days],
    queryFn: async () => {
      const response = await api.get<AnalyticsOverview>("/api/analytics/overview", { params: { days } });
      return response.data;
    }
  });

  const historyQuery = useQuery({
    queryKey: ["analytics", "inventory-history", days],
    queryFn: async () => {
      const fromDate = new Date(Date.now() - Number(days) * 24 * 60 * 60 * 1000);
      const response = await api.get<InventoryHistory>("/api/analytics/inventory-history", {
        params: { from: fromDate.toISOString().slice(0, 10) }
      });
      return response.data;
    }
  });

  const products = insightsQuery.data?.products ?? [];
  const visibleBestSellers = products.slice(0, 10);
  const bestSellerMaximum = Math.max(
    0,
    ...visibleBestSellers.map((product) => bestSellerMetric === "units" ? product.totalQuantity : product.totalRevenue)
  );
  const donutSlices = useMemo(() => createDonutSlices(products), [products]);
  const donutGradient = donutSlices.reduce<{ stops: string[]; offset: number }>((result, slice) => {
    const nextOffset = result.offset + slice.percent;
    result.stops.push(`${slice.color} ${result.offset}% ${nextOffset}%`);
    return { stops: result.stops, offset: nextOffset };
  }, { stops: [], offset: 0 }).stops.join(", ");
  const summary = insightsQuery.data?.summary;
  const overview = overviewQuery.data;
  const unsoldProducts = insightsQuery.data?.unsoldProducts ?? [];
  const totalUnits = summary?.totalUnitsSold ?? 0;
  const topProduct = summary?.topSeller;
  const topProductShare = totalUnits > 0 && topProduct
    ? Math.round((topProduct.totalQuantity / totalUnits) * 100)
    : null;
  const expirySoonCount = overview?.expiry.expiringWithin7Days ?? 0;
  const expiryCount = overview
    ? overview.expiry.expiringWithin7Days + overview.expiry.alreadyExpired
    : 0;

  function handleMetricKeyDown(event: KeyboardEvent<HTMLButtonElement>, current: "units" | "revenue") {
    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
    event.preventDefault();
    const next = current === "units" ? "revenue" : "units";
    setBestSellerMetric(next);
    document.getElementById(`best-seller-${next}`)?.focus();
  }

  return (
    <main className="analytics-page">
      <div className="analytics-shell">
        <header className="analytics-heading">
          <div>
            <p className="analytics-eyebrow">Reports</p>
            <h1>Analytics &amp; Insights</h1>
            <p className="analytics-subtitle">
              Product performance, inventory health, and operational insights for your selected period.
            </p>
          </div>
          <label className="analytics-period">
            <span>Reporting period</span>
            <span className="analytics-select-wrap">
              <CalendarDays aria-hidden="true" size={17} />
              <Select value={days} onChange={(event) => setDays(event.target.value)}>
                <option value="7">Last 7 days</option>
                <option value="14">Last 14 days</option>
                <option value="30">Last 30 days</option>
                <option value="60">Last 60 days</option>
                <option value="90">Last 90 days</option>
              </Select>
              <ChevronDown aria-hidden="true" size={16} />
            </span>
          </label>
        </header>

        <section className="analytics-highlights" aria-label="Period highlights">
          {topProduct && topProductShare !== null && topProductShare > 0 && (
            <div className="analytics-highlight">
              <span className="analytics-highlight-icon highlight-red"><Crown size={15} /></span>
              <span><strong>{topProduct.name}</strong> leads sales with {topProductShare}% of units sold.</span>
            </div>
          )}
          {insightsQuery.data && totalUnits === 0 && (
            <div className="analytics-highlight">
              <span className="analytics-highlight-icon highlight-gray"><Package size={15} /></span>
              <span>No sales recorded in this period.</span>
            </div>
          )}
          {expirySoonCount > 0 && (
            <div className="analytics-highlight">
              <span className="analytics-highlight-icon highlight-amber"><AlertTriangle size={15} /></span>
              <span><strong>{expirySoonCount} {expirySoonCount === 1 ? "item" : "items"}</strong> expiring soon.</span>
            </div>
          )}
        </section>

        <section className="analytics-key-figures" aria-label="Key figures">
          <article className="analytics-figure analytics-figure-primary">
            <span className="analytics-figure-icon"><BadgeDollarSign size={19} /></span>
            <div>
              <p>Total revenue</p>
              <strong>{summary ? money(summary.totalRevenue) : "—"}</strong>
              <span>Selected period</span>
            </div>
          </article>
          <article className="analytics-figure">
            <span className="analytics-figure-icon figure-units"><ShoppingBag size={18} /></span>
            <div>
              <p>Total units sold</p>
              <strong>{summary ? summary.totalUnitsSold.toLocaleString() : "—"}</strong>
              <span>Across all products</span>
            </div>
          </article>
          <article className="analytics-figure">
            <span className="analytics-figure-icon figure-waste"><Trash2 size={18} /></span>
            <div>
              <p>Waste cost</p>
              <strong className="analytics-waste-value">{overview ? money(overview.waste.totalCost) : "—"}</strong>
              <span>{overview?.waste.totalTransactions ?? "—"} disposal records</span>
            </div>
          </article>
          <article className="analytics-figure">
            <span className="analytics-figure-icon figure-expiry"><AlertTriangle size={18} /></span>
            <div>
              <p>Expiry alerts</p>
              <strong className="analytics-expiry-value">{overview ? expiryCount.toLocaleString() : "—"}</strong>
              <span>
                {overview
                  ? `${overview.expiry.alreadyExpired} expired · ${overview.expiry.expiringWithin7Days} expiring soon`
                  : "Current inventory"}
              </span>
            </div>
          </article>
        </section>

        <section className="analytics-card analytics-best-sellers" aria-labelledby="best-sellers-title">
          <div className="analytics-section-heading">
            <div className="analytics-section-title">
              <span className="analytics-heading-icon"><Crown size={18} /></span>
              <div>
                <h2 id="best-sellers-title">Best sellers</h2>
                <p>Product performance ranked by sales frequency</p>
              </div>
            </div>
            <div className="analytics-segmented" role="radiogroup" aria-label="Best seller metric">
              <button
                id="best-seller-units"
                type="button"
                role="radio"
                aria-checked={bestSellerMetric === "units"}
                tabIndex={bestSellerMetric === "units" ? 0 : -1}
                onClick={() => setBestSellerMetric("units")}
                onKeyDown={(event) => handleMetricKeyDown(event, "units")}
              >
                Units sold
              </button>
              <button
                id="best-seller-revenue"
                type="button"
                role="radio"
                aria-checked={bestSellerMetric === "revenue"}
                tabIndex={bestSellerMetric === "revenue" ? 0 : -1}
                onClick={() => setBestSellerMetric("revenue")}
                onKeyDown={(event) => handleMetricKeyDown(event, "revenue")}
              >
                Revenue
              </button>
            </div>
          </div>
          <div className="analytics-best-content">
            <div className="analytics-ranking">
              {insightsQuery.isLoading && <p className="analytics-muted-message">Loading product insights…</p>}
              {!insightsQuery.isLoading && visibleBestSellers.length === 0 && (
                <div className="analytics-empty-state">
                  <span><Package size={22} /></span>
                  <strong>No sales data for this period</strong>
                  <p>Best-selling products will appear here when sales are recorded.</p>
                </div>
              )}
              {visibleBestSellers.map((product) => {
                const metricValue = bestSellerMetric === "units" ? product.totalQuantity : product.totalRevenue;
                const barPercent = bestSellerMaximum > 0 && metricValue > 0
                  ? Math.min(88, Math.max(2, (metricValue / bestSellerMaximum) * 88))
                  : 0;
                return (
                  <div className="analytics-rank-row" key={product.productId}>
                    <span className="analytics-rank-number">{product.frequencyRank}</span>
                    <div className="analytics-rank-product">
                      <strong title={product.name}>{product.name}</strong>
                      <span>{product.category}</span>
                    </div>
                    <div className="analytics-bar-area">
                      <div className="analytics-bar-rail">
                        <div
                          className="analytics-bar-fill"
                          style={{ width: `${barPercent}%` }}
                        />
                      </div>
                      <span
                        className="analytics-bar-value"
                        style={{ left: `clamp(16px, calc(${barPercent}% + 8px), calc(100% - 112px))` }}
                      >
                        {bestSellerMetric === "units" ? metricValue.toLocaleString() : money(metricValue)}
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>

            <aside className="analytics-share-panel" aria-label="Sales share by product">
              <h3>Sales share</h3>
              {donutSlices.length === 0 ? (
                <div className="analytics-share-empty">
                  <span><ShoppingBag size={20} /></span>
                  <p>Share data will appear when products have sales.</p>
                </div>
              ) : (
                <>
                  <div
                    className="analytics-donut"
                    role="img"
                    aria-label={`Sales share: ${donutSlices.map((slice) => `${slice.name} ${slice.percent}%`).join(", ")}`}
                    style={{ background: `conic-gradient(${donutGradient})` }}
                  >
                    <div className="analytics-donut-center">
                      <strong>{totalUnits.toLocaleString()}</strong>
                      <span>units sold</span>
                    </div>
                  </div>
                  <ul className="analytics-share-legend">
                    {donutSlices.map((slice) => (
                      <li key={slice.name}>
                        <span className="analytics-legend-color" style={{ backgroundColor: slice.color }} />
                        <span className="analytics-legend-name" title={slice.name}>{slice.name}</span>
                        <strong>{slice.percent}%</strong>
                      </li>
                    ))}
                  </ul>
                </>
              )}
            </aside>
          </div>

          <div className="analytics-table-section">
            <div className="analytics-table-heading">
              <div>
                <h3>Product frequency ranking</h3>
                <p>Ranked by total quantity sold. Use priority insights to decide what to stock, promote, or reduce.</p>
              </div>
              <span className="analytics-table-count">{products.length} products</span>
            </div>
            {insightsQuery.isLoading && <p className="analytics-muted-message">Loading product insights…</p>}
            {!insightsQuery.isLoading && products.length === 0 && (
              <div className="analytics-table-empty">No product sales in this period.</div>
            )}
            {products.length > 0 && (
              <div className="overflow-x-auto">
                <Table className="analytics-products-table">
                  <TableHeader>
                    <TableRow>
                      <TableHead>Rank</TableHead>
                      <TableHead>Product / category</TableHead>
                      <TableHead>Units sold</TableHead>
                      <TableHead>Avg/day</TableHead>
                      <TableHead>Revenue</TableHead>
                      <TableHead>Trend</TableHead>
                      <TableHead>Priority</TableHead>
                      <TableHead>Insight</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {products.map((product) => {
                      const trendClass = product.trend > 0
                        ? "analytics-trend-up"
                        : product.trend < 0
                          ? "analytics-trend-down"
                          : "analytics-trend-flat";
                      return (
                        <TableRow key={product.productId}>
                          <TableCell className="analytics-product-rank">#{product.frequencyRank}</TableCell>
                          <TableCell>
                            <span className="analytics-product-name">{product.name}</span>
                            <span className="analytics-product-category">{product.category}</span>
                          </TableCell>
                          <TableCell>{product.totalQuantity.toLocaleString()}</TableCell>
                          <TableCell>{formatAverage(product.avgDailySales)}</TableCell>
                          <TableCell>{money(product.totalRevenue)}</TableCell>
                          <TableCell>
                            <span className={`analytics-trend ${trendClass}`}>
                              {product.trend > 0
                                ? <TrendingUp aria-hidden="true" size={14} />
                                : product.trend < 0
                                  ? <TrendingDown aria-hidden="true" size={14} />
                                  : <Minus aria-hidden="true" size={14} />}
                              {product.trend > 0 ? "+" : ""}{product.trend}%
                            </span>
                          </TableCell>
                          <TableCell>
                            <span className={`analytics-priority ${priorityColor(product.priority)}`}>
                              {product.priority}
                            </span>
                          </TableCell>
                          <TableCell className="analytics-insight-cell" title={product.insight}>{product.insight}</TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </div>
            )}
          </div>
        </section>

        {unsoldProducts.length > 0 && (
          <section className="analytics-card analytics-unsold" aria-labelledby="unsold-title">
            <div className="analytics-section-heading analytics-unsold-heading">
              <div className="analytics-section-title">
                <span className="analytics-heading-icon analytics-heading-icon-muted"><Box size={18} /></span>
                <div>
                  <h2 id="unsold-title">Products with no sales</h2>
                  <p>These menu items had zero sales in the selected period — lowest priority for prep.</p>
                </div>
              </div>
              <span className="analytics-table-count">{unsoldProducts.length} products</span>
            </div>
            <div className="analytics-unsold-chips">
              {(showAllUnsold ? unsoldProducts : unsoldProducts.slice(0, 16)).map((product) => (
                <span className="analytics-unsold-chip" key={product.productId}>
                  <span>{product.name}</span>
                  <span>{product.category}</span>
                </span>
              ))}
            </div>
            {unsoldProducts.length > 16 && (
              <button
                className="analytics-expand-button"
                type="button"
                aria-expanded={showAllUnsold}
                onClick={() => setShowAllUnsold((current) => !current)}
              >
                {showAllUnsold ? <ChevronUp size={15} /> : <ChevronDown size={15} />}
                {showAllUnsold ? "Show fewer" : `Show all ${unsoldProducts.length}`}
              </button>
            )}
          </section>
        )}

        <section className="analytics-lower-grid" aria-label="Inventory and waste reports">
          <article className="analytics-card analytics-lower-card">
            <div className="analytics-section-heading">
              <div className="analytics-section-title">
                <span className="analytics-heading-icon analytics-heading-icon-muted"><Archive size={18} /></span>
                <div>
                  <h2>Historical inventory value</h2>
                  <p>Recorded changes over the selected period</p>
                </div>
              </div>
            </div>
            <div className="analytics-history-chart">
              {!historyQuery.data?.snapshots.length ? (
                <div className="analytics-empty-state">
                  <span><Archive size={22} /></span>
                  <strong>No inventory history yet</strong>
                  <p>Historical snapshots will appear as inventory changes are recorded.</p>
                </div>
              ) : (
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={historyQuery.data.snapshots} margin={{ top: 8, right: 14, left: 4, bottom: 0 }}>
                    <CartesianGrid stroke="#EEE7E7" strokeDasharray="4 4" vertical={false} />
                    <XAxis dataKey="date" tick={{ fontSize: 11, fill: "#77717A" }} axisLine={false} tickLine={false} />
                    <YAxis tick={{ fontSize: 11, fill: "#77717A" }} axisLine={false} tickLine={false} />
                    <Tooltip formatter={(value: number) => [money(value), "Inventory value"]} />
                    <Line type="monotone" dataKey="totalValue" stroke="#9B1D20" strokeWidth={2.5} dot={false} activeDot={{ r: 4 }} />
                  </LineChart>
                </ResponsiveContainer>
              )}
            </div>
          </article>

          <article className="analytics-card analytics-lower-card">
            <div className="analytics-section-heading">
              <div className="analytics-section-title">
                <span className="analytics-heading-icon analytics-heading-icon-muted"><Trash2 size={18} /></span>
                <div>
                  <h2>Recent waste history</h2>
                  <p>Latest recorded material disposals</p>
                </div>
              </div>
            </div>
            {!historyQuery.data?.wasteHistory.length ? (
              <div className="analytics-empty-state analytics-waste-empty">
                <span><Check size={22} /></span>
                <strong>No waste records</strong>
                <p>No waste records in this period.</p>
              </div>
            ) : (
              <div className="analytics-waste-table-wrap">
                <Table className="analytics-waste-table">
                  <TableHeader>
                    <TableRow>
                      <TableHead>Date</TableHead>
                      <TableHead>Material</TableHead>
                      <TableHead>Quantity</TableHead>
                      <TableHead>Reason</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {historyQuery.data.wasteHistory.slice(0, 10).map((entry) => (
                      <TableRow key={entry.id}>
                        <TableCell>{new Date(entry.created_at).toLocaleDateString()}</TableCell>
                        <TableCell className="analytics-waste-material">{entry.raw_material.name}</TableCell>
                        <TableCell>{Number(entry.quantity).toLocaleString()} {entry.unit}</TableCell>
                        <TableCell className="analytics-waste-reason">{entry.reason?.replace("_", " ") ?? "—"}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </article>
        </section>
      </div>
    </main>
  );
}

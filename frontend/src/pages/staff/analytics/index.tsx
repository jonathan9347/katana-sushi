import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis
} from "recharts";
import { AlertTriangle, BarChart3, TrendingDown, TrendingUp } from "lucide-react";
import { api } from "../../../lib/api";
import { Card, CardContent, CardHeader, CardTitle } from "../../../components/ui/card";
import { Select } from "../../../components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "../../../components/ui/table";

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
      return "bg-emerald-100 text-emerald-800";
    case "medium":
      return "bg-blue-100 text-blue-800";
    case "low":
      return "bg-amber-100 text-amber-800";
    default:
      return "bg-slate-100 text-slate-600";
  }
}

const chartColors = ["#b91c1c", "#dc2626", "#ef4444", "#f87171", "#fca5a5", "#fecaca"];

export default function AnalyticsPage() {
  const [days, setDays] = useState("30");

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

  const topProductsChart = useMemo(
    () =>
      (insightsQuery.data?.products ?? []).slice(0, 10).map((product) => ({
        name: product.name.length > 18 ? `${product.name.slice(0, 18)}…` : product.name,
        quantity: product.totalQuantity,
        revenue: product.totalRevenue
      })),
    [insightsQuery.data]
  );

  const frequencyChart = useMemo(
    () =>
      (insightsQuery.data?.products ?? []).slice(0, 15).map((product, index) => ({
        name: `#${product.frequencyRank}`,
        fullName: product.name,
        quantity: product.totalQuantity,
        fill: chartColors[index % chartColors.length]
      })),
    [insightsQuery.data]
  );

  const summary = insightsQuery.data?.summary;
  const overview = overviewQuery.data;

  return (
    <main className="min-h-screen bg-slate-100 px-4 py-6 lg:px-8">
      <div className="mx-auto grid max-w-7xl gap-5">
        <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
          <div>
            <p className="text-sm font-medium uppercase text-red-700">Staff</p>
            <h1 className="flex items-center gap-2 text-3xl font-semibold text-slate-950">
              <BarChart3 className="h-8 w-8" />
              Analytics & Insights
            </h1>
            <p className="mt-1 text-sm text-slate-600">
              Product frequency rankings, priority recommendations, waste tracking, and historical inventory data.
            </p>
          </div>
          <Select className="w-44" value={days} onChange={(event) => setDays(event.target.value)}>
            <option value="7">Last 7 days</option>
            <option value="14">Last 14 days</option>
            <option value="30">Last 30 days</option>
            <option value="60">Last 60 days</option>
            <option value="90">Last 90 days</option>
          </Select>
        </div>

        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-slate-500">Total Units Sold</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-2xl font-semibold text-slate-950">{summary?.totalUnitsSold.toLocaleString() ?? "—"}</p>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-slate-500">Revenue</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-2xl font-semibold text-slate-950">{summary ? money(summary.totalRevenue) : "—"}</p>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-slate-500">Waste Cost</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-2xl font-semibold text-red-700">{overview ? money(overview.waste.totalCost) : "—"}</p>
              <p className="text-xs text-slate-500">{overview?.waste.totalTransactions ?? 0} disposal records</p>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-slate-500">Expiry Alerts</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="flex items-center gap-2 text-2xl font-semibold text-amber-700">
                <AlertTriangle className="h-5 w-5" />
                {overview ? overview.expiry.expiringWithin7Days + overview.expiry.alreadyExpired : "—"}
              </p>
              <p className="text-xs text-slate-500">
                {overview?.expiry.alreadyExpired ?? 0} expired · {overview?.expiry.expiringWithin7Days ?? 0} expiring soon
              </p>
            </CardContent>
          </Card>
        </div>

        <div className="grid gap-5 xl:grid-cols-2">
          <Card>
            <CardHeader>
              <CardTitle>Top 10 Best-Selling Products</CardTitle>
            </CardHeader>
            <CardContent className="h-80">
              {topProductsChart.length === 0 ? (
                <p className="text-sm text-slate-500">No sales data for this period.</p>
              ) : (
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={topProductsChart} layout="vertical" margin={{ left: 8, right: 16 }}>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis type="number" />
                    <YAxis dataKey="name" type="category" width={120} tick={{ fontSize: 11 }} />
                    <Tooltip formatter={(value: number) => [value, "Units sold"]} />
                    <Bar dataKey="quantity" fill="#b91c1c" radius={[0, 4, 4, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Sales Trend</CardTitle>
            </CardHeader>
            <CardContent className="h-80">
              {!overview?.salesTrend.length ? (
                <p className="text-sm text-slate-500">No sales trend data for this period.</p>
              ) : (
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={overview.salesTrend}>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis dataKey="date" tick={{ fontSize: 11 }} />
                    <YAxis tick={{ fontSize: 11 }} />
                    <Tooltip formatter={(value: number) => [money(value), "Sales"]} />
                    <Line type="monotone" dataKey="total" stroke="#b91c1c" strokeWidth={2} dot={false} />
                  </LineChart>
                </ResponsiveContainer>
              )}
            </CardContent>
          </Card>
        </div>

        <Card>
          <CardHeader>
            <CardTitle>Product Frequency Ranking — Most to Least Sold</CardTitle>
            <p className="text-sm text-slate-500">
              Ranked by total quantity sold. Use priority insights to decide what to stock, promote, or reduce.
            </p>
          </CardHeader>
          <CardContent>
            <div className="mb-6 h-64">
              {frequencyChart.length > 0 && (
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={frequencyChart}>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis dataKey="name" tick={{ fontSize: 11 }} />
                    <YAxis tick={{ fontSize: 11 }} />
                    <Tooltip
                      formatter={(value: number) => [value, "Units"]}
                      labelFormatter={(_, payload) => payload?.[0]?.payload?.fullName ?? ""}
                    />
                    <Bar dataKey="quantity" radius={[4, 4, 0, 0]}>
                      {frequencyChart.map((entry) => (
                        <Cell key={entry.name} fill={entry.fill} />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              )}
            </div>

            {insightsQuery.isLoading && <p className="text-sm text-slate-500">Loading product insights...</p>}
            {insightsQuery.data?.products.length === 0 && !insightsQuery.isLoading && (
              <p className="text-sm text-slate-500">No product sales in this period.</p>
            )}
            {!!insightsQuery.data?.products.length && (
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Rank</TableHead>
                      <TableHead>Product</TableHead>
                      <TableHead>Category</TableHead>
                      <TableHead>Units Sold</TableHead>
                      <TableHead>Avg/Day</TableHead>
                      <TableHead>Revenue</TableHead>
                      <TableHead>Trend</TableHead>
                      <TableHead>Priority</TableHead>
                      <TableHead>Insight</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {insightsQuery.data.products.map((product) => (
                      <TableRow key={product.productId}>
                        <TableCell className="font-semibold">#{product.frequencyRank}</TableCell>
                        <TableCell className="font-medium">{product.name}</TableCell>
                        <TableCell>{product.category}</TableCell>
                        <TableCell>{product.totalQuantity.toLocaleString()}</TableCell>
                        <TableCell>{product.avgDailySales}</TableCell>
                        <TableCell>{money(product.totalRevenue)}</TableCell>
                        <TableCell>
                          <span className={`inline-flex items-center gap-1 text-sm ${product.trend >= 0 ? "text-emerald-700" : "text-red-700"}`}>
                            {product.trend >= 0 ? <TrendingUp className="h-3.5 w-3.5" /> : <TrendingDown className="h-3.5 w-3.5" />}
                            {product.trend > 0 ? "+" : ""}
                            {product.trend}%
                          </span>
                        </TableCell>
                        <TableCell>
                          <span className={`rounded-full px-2.5 py-1 text-xs font-semibold capitalize ${priorityColor(product.priority)}`}>
                            {product.priority}
                          </span>
                        </TableCell>
                        <TableCell className="max-w-xs text-sm text-slate-600">{product.insight}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </CardContent>
        </Card>

        {(insightsQuery.data?.unsoldProducts.length ?? 0) > 0 && (
          <Card>
            <CardHeader>
              <CardTitle>Products With No Sales ({insightsQuery.data?.unsoldProducts.length})</CardTitle>
              <p className="text-sm text-slate-500">These menu items had zero sales in the selected period — lowest priority for prep.</p>
            </CardHeader>
            <CardContent>
              <div className="flex flex-wrap gap-2">
                {insightsQuery.data?.unsoldProducts.map((product) => (
                  <span key={product.productId} className="rounded-full bg-slate-200 px-3 py-1 text-sm text-slate-700">
                    {product.name}
                  </span>
                ))}
              </div>
            </CardContent>
          </Card>
        )}

        <div className="grid gap-5 xl:grid-cols-2">
          <Card>
            <CardHeader>
              <CardTitle>Historical Inventory Value</CardTitle>
            </CardHeader>
            <CardContent className="h-72">
              {!historyQuery.data?.snapshots.length ? (
                <p className="text-sm text-slate-500">Historical snapshots will appear as inventory changes are recorded.</p>
              ) : (
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={historyQuery.data.snapshots}>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis dataKey="date" tick={{ fontSize: 11 }} />
                    <YAxis tick={{ fontSize: 11 }} />
                    <Tooltip formatter={(value: number) => [money(value), "Inventory value"]} />
                    <Line type="monotone" dataKey="totalValue" stroke="#334155" strokeWidth={2} dot={false} />
                  </LineChart>
                </ResponsiveContainer>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Recent Waste History</CardTitle>
            </CardHeader>
            <CardContent>
              {!historyQuery.data?.wasteHistory.length ? (
                <p className="text-sm text-slate-500">No waste records in this period.</p>
              ) : (
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Date</TableHead>
                        <TableHead>Material</TableHead>
                        <TableHead>Qty</TableHead>
                        <TableHead>Reason</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {historyQuery.data.wasteHistory.slice(0, 10).map((entry) => (
                        <TableRow key={entry.id}>
                          <TableCell>{new Date(entry.created_at).toLocaleDateString()}</TableCell>
                          <TableCell>{entry.raw_material.name}</TableCell>
                          <TableCell>
                            {Number(entry.quantity).toLocaleString()} {entry.unit}
                          </TableCell>
                          <TableCell className="capitalize">{entry.reason?.replace("_", " ") ?? "—"}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </main>
  );
}

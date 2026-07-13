import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Download, Eye, Printer, RotateCcw, Settings, ShoppingCart } from "lucide-react";
import { Link } from "react-router-dom";
import SectionNav, { SectionNavTab } from "../../../components/layout/SectionNav";
import TransactionDetailsModal, { PosHistoryTransaction } from "../../../components/pos/TransactionDetailsModal";
import { Button } from "../../../components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "../../../components/ui/card";
import { Select } from "../../../components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "../../../components/ui/table";
import { api } from "../../../lib/api";
import { useToast } from "../../../hooks/useToast";
import { formatManilaDateTime, todayManilaDateKey } from "../../../lib/dateTime";

type PosSummary = {
  totalSales: number;
  totalTransactions: number;
  averageOrderValue: number;
  byType: Record<string, { count: number; total: number }>;
  byPayment: Record<string, { count: number; total: number }>;
};

const posTabs: Array<SectionNavTab> = [
  { id: "new-sale", label: "New Sale", icon: <ShoppingCart className="h-4 w-4" />, to: "/staff/pos", end: true },
  { id: "history", label: "Transaction History", icon: <Printer className="h-4 w-4" />, to: "/staff/pos/history" },
  { id: "settings", label: "Unlimited Settings", icon: <Settings className="h-4 w-4" />, to: "/staff/pos/unlimited-settings" }
];

function today() {
  return todayManilaDateKey();
}

function getStoredRole() {
  if (!localStorage.getItem("katana_token")) {
    return "staff";
  }

  return localStorage.getItem("katana_role")?.toLowerCase() ?? "staff";
}

function money(value: number) {
  return `PHP ${Number(value).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function transactionTypeLabel(type: string) {
  const labels: Record<string, string> = {
    dine_in: "Dine-in Sale",
    takeout: "Takeout Sale",
    unlimited: "Unlimited Sale",
    dine_in_deposit: "Dine-in Deposit",
    dine_in_balance: "Dine-in Balance",
    dine_in_prepaid: "Dine-in Prepaid",
    catering_deposit: "Catering Deposit",
    catering_balance: "Catering Balance",
    catering_prepaid: "Catering Prepaid"
  };

  return labels[type] ?? type.replace(/_/g, " ");
}


export default function PosHistory() {
  const [from, setFrom] = useState(today());
  const [to, setTo] = useState(today());
  const [paymentMethod, setPaymentMethod] = useState("");
  const [transactionType, setTransactionType] = useState("");
  const [search, setSearch] = useState("");
  const [selectedTransaction, setSelectedTransaction] = useState<PosHistoryTransaction | null>(null);
  const role = getStoredRole();
  const admin = role === "admin";
  const allowed = admin || role === "cashier";
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const transactionsQuery = useQuery({
    queryKey: ["pos", "transactions", from, to, paymentMethod, transactionType, search],
    queryFn: async () => {
      const response = await api.get<{ transactions: PosHistoryTransaction[] }>("/api/pos/transactions/unified", {

        params: {
          from,
          to,
          payment_method: paymentMethod || undefined,
          transaction_type: transactionType || undefined,
          search: search || undefined,
          limit: 100
        }
      });
      return response.data.transactions;
    },
    enabled: allowed,
    refetchInterval: 30000
  });

  const summaryQuery = useQuery({
    queryKey: ["pos", "transactions", "summary", from, to],
    queryFn: async () => {
      const response = await api.get<PosSummary>("/api/pos/transactions/summary", {
        params: { from, to }
      });
      return response.data;
    },
    enabled: allowed,
    refetchInterval: 30000
  });

  const filteredTransactions = transactionsQuery.data ?? [];
  const totalSales = useMemo(
    () => filteredTransactions.reduce((sum, transaction) => sum + Number(transaction.total), 0),
    [filteredTransactions]
  );

  const refundMutation = useMutation({
    mutationFn: async (transaction: PosHistoryTransaction) => api.post(`/api/pos/refund/${transaction.id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["pos", "transactions"] });
      queryClient.invalidateQueries({ queryKey: ["inventory"] });
      setSelectedTransaction(null);
      toast("Transaction refunded.");
    },
    onError: () => toast("Unable to refund transaction.")
  });

  if (!allowed) {
    return (
      <main className="flex min-h-screen flex-col items-center justify-center gap-4 px-6 text-center">
        <h1 className="text-2xl font-semibold text-slate-950">POS history access required</h1>
        <Link className="text-red-700 underline" to="/staff/login">
          Go to staff login
        </Link>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-slate-100 px-4 py-6 lg:px-8">
      <div className="mx-auto grid max-w-7xl gap-5">
        <div className="flex flex-col gap-2 md:flex-row md:items-end md:justify-between">
          <div>
            <p className="text-sm font-medium uppercase text-red-700">POS</p>
            <h1 className="text-3xl font-semibold text-slate-950">Transaction History</h1>
          </div>
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => exportCsv(filteredTransactions)}>
              <Download className="mr-2 h-4 w-4" />
              Export CSV
            </Button>
          </div>
        </div>

        <SectionNav tabs={posTabs} />

        <Card>
          <CardHeader>
            <CardTitle>Filters</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid gap-3 md:grid-cols-5">
              <input className="h-10 rounded-md border border-slate-300 px-3 text-sm" type="date" value={from} onChange={(event) => setFrom(event.target.value)} />
              <input className="h-10 rounded-md border border-slate-300 px-3 text-sm" type="date" value={to} onChange={(event) => setTo(event.target.value)} />
              <Select value={paymentMethod} onChange={(event) => setPaymentMethod(event.target.value)}>
                <option value="">All payments</option>
                <option value="cash">Cash</option>
                <option value="gcash">GCash</option>
                <option value="bank_transfer">BPI (Bank Transfer)</option>
              </Select>
              <Select value={transactionType} onChange={(event) => setTransactionType(event.target.value)}>
                <option value="">All types</option>
                <option value="dine_in">Dine-in Sale</option>
                <option value="takeout">Takeout Sale</option>
                <option value="unlimited">Unlimited Sale</option>
                <option value="dine_in_deposit">Dine-in Deposit</option>
                <option value="dine_in_balance">Dine-in Balance</option>
                <option value="dine_in_prepaid">Dine-in Prepaid</option>
                <option value="catering_deposit">Catering Deposit</option>
                <option value="catering_balance">Catering Balance</option>
                <option value="catering_prepaid">Catering Prepaid</option>
              </Select>

              <input
                className="h-10 rounded-md border border-slate-300 px-3 text-sm"
                placeholder="Search # or customer"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
              />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Summary</CardTitle>
          </CardHeader>
          <CardContent>
            {summaryQuery.isLoading && <p className="text-sm text-slate-500">Loading summary...</p>}
            {summaryQuery.isError && <p className="text-sm text-red-700">Unable to load summary.</p>}
            {summaryQuery.data && (
              <div className="grid gap-3 md:grid-cols-3 xl:grid-cols-6">
                <SummaryTile label="Total Sales" value={money(summaryQuery.data.totalSales)} />
                <SummaryTile label="Transactions" value={summaryQuery.data.totalTransactions.toLocaleString()} />
                <SummaryTile label="Avg. Order" value={money(summaryQuery.data.averageOrderValue)} />
                <SummaryTile
                  label="Dine-in"
                  value={money(summaryQuery.data.byType.dine_in?.total ?? 0)}
                  meta={`${summaryQuery.data.byType.dine_in?.count ?? 0} orders`}
                />
                <SummaryTile
                  label="Takeout"
                  value={money(summaryQuery.data.byType.takeout?.total ?? 0)}
                  meta={`${summaryQuery.data.byType.takeout?.count ?? 0} orders`}
                />
                <SummaryTile
                  label="Unlimited"
                  value={money(summaryQuery.data.byType.unlimited?.total ?? 0)}
                  meta={`${summaryQuery.data.byType.unlimited?.count ?? 0} sessions`}
                />
                <SummaryTile
                  label="Catering Deposits"
                  value={money(summaryQuery.data.byType.reservation_deposit?.total ?? 0)}
                  meta={`${summaryQuery.data.byType.reservation_deposit?.count ?? 0} payments`}
                />
                <SummaryTile
                  label="Catering Balances"
                  value={money(summaryQuery.data.byType.reservation_balance?.total ?? 0)}
                  meta={`${summaryQuery.data.byType.reservation_balance?.count ?? 0} payments`}
                />
                <SummaryTile
                  label="Dine-in Bookings"
                  value={(summaryQuery.data.byType.dine_in_reservation?.count ?? 0).toLocaleString()}
                  meta="No payment"
                />
                <SummaryTile
                  label="Cash / GCash / BPI"
                  value={`${money(summaryQuery.data.byPayment.cash?.total ?? 0)} / ${money(summaryQuery.data.byPayment.gcash?.total ?? 0)} / ${money(summaryQuery.data.byPayment.bank_transfer?.total ?? 0)}`}
                  meta={`${summaryQuery.data.byPayment.cash?.count ?? 0} cash, ${summaryQuery.data.byPayment.gcash?.count ?? 0} GCash, ${summaryQuery.data.byPayment.bank_transfer?.count ?? 0} BPI`}
                />
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
            <CardTitle>Transactions</CardTitle>
            <p className="text-sm font-semibold text-slate-700">Total Sales: {money(totalSales)}</p>
          </CardHeader>
          <CardContent>
            {transactionsQuery.isLoading && <p className="text-sm text-slate-500">Loading transactions...</p>}
            {transactionsQuery.isError && <p className="text-sm text-red-700">Unable to load transactions.</p>}
            {transactionsQuery.data && (
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Transaction #</TableHead>
                      <TableHead>Date/Time</TableHead>
                      <TableHead>Customer</TableHead>
                      <TableHead>Type</TableHead>
                      <TableHead>Reference ID</TableHead>
                      <TableHead>Total</TableHead>
                      <TableHead>Payment</TableHead>
                      <TableHead>Cashier</TableHead>
                      <TableHead>Actions</TableHead>

                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {filteredTransactions.map((transaction) => (
                      <TableRow key={transaction.id}>
                        <TableCell className="font-medium">{transaction.transaction_number}</TableCell>
                        <TableCell>{formatManilaDateTime(transaction.created_at)}</TableCell>
                        <TableCell>{transaction.customer_name || "Walk-in"}</TableCell>
                        <TableCell>{transaction.label ?? transactionTypeLabel(transaction.transaction_type)}</TableCell>
                        <TableCell>
                          {transaction.reference_booking_id ? (
                            <Link className="text-blue-600 underline" to={`/reservation/status?bookingId=${transaction.reference_booking_id}`}>
                              {transaction.reference_booking_id}
                            </Link>
                          ) : (
                            "—"
                          )}
                        </TableCell>
                        <TableCell>{money(transaction.total)}</TableCell>

                        <TableCell>{transaction.payment_method}</TableCell>
                        <TableCell>{transaction.cashier?.name ?? "Unknown"}</TableCell>
                        <TableCell>
                          <div className="flex gap-2">
                            <Button size="sm" variant="outline" onClick={() => setSelectedTransaction(transaction)}>
                              <Eye className="h-4 w-4" />
                            </Button>
                            {admin && transaction.status !== "refunded" && ["dine_in", "takeout"].includes(transaction.transaction_type) && (
                              <Button size="sm" variant="danger" onClick={() => refundMutation.mutate(transaction)}>
                                <RotateCcw className="h-4 w-4" />
                              </Button>
                            )}
                          </div>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      <TransactionDetailsModal
        admin={admin}
        refundPending={refundMutation.isPending}
        transaction={selectedTransaction}
        onClose={() => setSelectedTransaction(null)}
        onRefund={(transaction) => refundMutation.mutate(transaction)}
      />
    </main>
  );
}

function SummaryTile({ label, meta, value }: { label: string; meta?: string; value: string }) {
  return (
    <div className="min-h-24 rounded-md border border-slate-200 bg-white p-3">
      <p className="text-xs font-semibold uppercase text-slate-500">{label}</p>
      <p className="mt-2 break-words text-lg font-semibold text-slate-950">{value}</p>
      {meta && <p className="mt-1 text-xs text-slate-500">{meta}</p>}
    </div>
  );
}

function exportCsv(transactions: PosHistoryTransaction[]) {
  const rows = [
    ["Transaction #", "Date/Time", "Customer", "Type", "Total", "Payment", "Cashier", "Status"],
    ...transactions.map((transaction) => [
      transaction.transaction_number,
      formatManilaDateTime(transaction.created_at),
      transaction.customer_name || "Walk-in",
      transaction.transaction_type,
      String(transaction.total),
      transaction.payment_method,
      transaction.cashier?.name ?? "",
      transaction.status
    ])
  ];
  const csv = rows.map((row) => row.map((cell) => `"${cell.replace(/"/g, '""')}"`).join(",")).join("\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `pos-history-${today()}.csv`;
  link.click();
  URL.revokeObjectURL(url);
}

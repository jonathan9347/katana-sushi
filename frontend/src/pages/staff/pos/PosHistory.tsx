import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Download, Eye, Printer, RotateCcw } from "lucide-react";
import { Link } from "react-router-dom";
import TransactionDetailsModal, { PosHistoryTransaction } from "../../../components/pos/TransactionDetailsModal";
import { Button } from "../../../components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "../../../components/ui/card";
import { Select } from "../../../components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "../../../components/ui/table";
import { api } from "../../../lib/api";
import { useToast } from "../../../hooks/useToast";
import { formatManilaDateTime, todayManilaDateKey } from "../../../lib/dateTime";
import PosHeader from "./PosHeader";

type PosSummary = {
  totalSales: number;
  totalTransactions: number;
  averageOrderValue: number;
  byType: Record<string, { count: number; total: number }>;
  byPayment: Record<string, { count: number; total: number }>;
};

type HistoryTable = {
  id: string;
  table_number: number;
  is_archived: boolean;
  is_temporary: boolean;
};

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
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [paymentMethod, setPaymentMethod] = useState("");
  const [transactionType, setTransactionType] = useState("");
  const [tableId, setTableId] = useState("");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [exporting, setExporting] = useState(false);
  const [selectedTransaction, setSelectedTransaction] = useState<PosHistoryTransaction | null>(null);
  const role = getStoredRole();
  const admin = role === "admin";
  const allowed = admin || role === "cashier";
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const tablesQuery = useQuery({
    queryKey: ["pos", "transactions", "history-tables"],
    queryFn: async () => {
      const response = await api.get<{ tables: HistoryTable[] }>("/api/pos/dining/history-tables");
      return response.data.tables;
    },
    enabled: allowed
  });

  const transactionsQuery = useQuery({
    queryKey: ["pos", "transactions", from, to, paymentMethod, transactionType, tableId, search, page],
    queryFn: async () => {
      const response = await api.get<{
        transactions: PosHistoryTransaction[];
        pagination: { page: number; limit: number; total: number; pages: number };
      }>("/api/pos/transactions/unified", {
        params: {
          from: from || undefined,
          to: to || undefined,
          payment_method: paymentMethod || undefined,
          transaction_type: transactionType || undefined,
          table_id: tableId || undefined,
          search: search || undefined,
          page,
          limit: 100
        }
      });
      return response.data;
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

  const filteredTransactions = transactionsQuery.data?.transactions ?? [];
  const pagination = transactionsQuery.data?.pagination;
  const totalSales = useMemo(
    () => filteredTransactions.reduce((sum, transaction) => sum + Number(transaction.total), 0),
    [filteredTransactions]
  );

  const handleExport = async () => {
    if (!pagination) return;

    setExporting(true);
    try {
      const allTransactions = [...filteredTransactions];
      for (let nextPage = 2; nextPage <= pagination.pages; nextPage += 1) {
        const response = await api.get<{ transactions: PosHistoryTransaction[] }>("/api/pos/transactions/unified", {
          params: {
            from: from || undefined,
            to: to || undefined,
            payment_method: paymentMethod || undefined,
            transaction_type: transactionType || undefined,
            table_id: tableId || undefined,
            search: search || undefined,
            page: nextPage,
            limit: 100
          }
        });
        allTransactions.push(...response.data.transactions);
      }
      exportCsv(allTransactions);
    } catch {
      toast("Unable to export transaction history.");
    } finally {
      setExporting(false);
    }
  };

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
          Sign in
        </Link>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-slate-100 px-4 py-6 lg:pl-4 lg:pr-8">
      <div className="grid w-full gap-5">
        <PosHeader section="Transaction History" showBack />
        <div className="flex justify-end">
          <div className="flex gap-2">
            <Button variant="outline" disabled={exporting || !pagination} onClick={handleExport}>
              <Download className="mr-2 h-4 w-4" />
              {exporting ? "Exporting..." : "Export CSV"}
            </Button>
          </div>
        </div>

        <section className="grid min-w-0 gap-5">
            <Card>
              <CardHeader>
                <CardTitle>Filters</CardTitle>
              </CardHeader>
              <CardContent>
                {tablesQuery.isError && (
                  <p className="mb-3 text-sm text-red-700" role="alert">
                    Unable to load tables for history filtering.
                  </p>
                )}
                <div className="grid gap-3 md:grid-cols-6">
              <input aria-label="From date" className="h-10 rounded-md border border-slate-300 px-3 text-sm" type="date" value={from} onChange={(event) => { setFrom(event.target.value); setPage(1); }} />
              <input aria-label="To date" className="h-10 rounded-md border border-slate-300 px-3 text-sm" type="date" value={to} onChange={(event) => { setTo(event.target.value); setPage(1); }} />
              <Select value={paymentMethod} onChange={(event) => { setPaymentMethod(event.target.value); setPage(1); }}>
                <option value="">All payments</option>
                <option value="cash">Cash</option>
                <option value="gcash">GCash</option>
                <option value="bank_transfer">BPI (Bank Transfer)</option>
              </Select>
              <Select value={transactionType} onChange={(event) => { setTransactionType(event.target.value); setPage(1); }}>
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
              <Select aria-label="Table" value={tableId} onChange={(event) => { setTableId(event.target.value); setPage(1); }}>
                <option value="">All tables</option>
                {(tablesQuery.data ?? []).map((table) => (
                  <option key={table.id} value={table.id}>
                    Table {table.table_number}
                    {table.is_temporary ? " (temporary)" : ""}
                    {table.is_archived ? " (archived)" : ""}
                  </option>
                ))}
              </Select>

              <input
                className="h-10 rounded-md border border-slate-300 px-3 text-sm"
                placeholder="Search # or customer"
                value={search}
                onChange={(event) => { setSearch(event.target.value); setPage(1); }}
              />
                </div>
              <p className="mt-3 text-xs text-slate-500">Leave the date filters empty to show all transaction history.</p>
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
                  label="Dine-in Deposits"
                  value={money(summaryQuery.data.byType.dine_in_deposit?.total ?? 0)}
                  meta={`${summaryQuery.data.byType.dine_in_deposit?.count ?? 0} payments`}
                />
                <SummaryTile
                  label="Dine-in Balances"
                  value={money(summaryQuery.data.byType.dine_in_balance?.total ?? 0)}
                  meta={`${summaryQuery.data.byType.dine_in_balance?.count ?? 0} payments`}
                />
                <SummaryTile
                  label="Dine-in Prepaid"
                  value={money(summaryQuery.data.byType.dine_in_prepaid?.total ?? 0)}
                  meta={`${summaryQuery.data.byType.dine_in_prepaid?.count ?? 0} payments`}
                />
                <SummaryTile
                  label="Catering Deposits"
                  value={money(summaryQuery.data.byType.catering_deposit?.total ?? 0)}
                  meta={`${summaryQuery.data.byType.catering_deposit?.count ?? 0} payments`}
                />
                <SummaryTile
                  label="Catering Balances"
                  value={money(summaryQuery.data.byType.catering_balance?.total ?? 0)}
                  meta={`${summaryQuery.data.byType.catering_balance?.count ?? 0} payments`}
                />
                <SummaryTile
                  label="Catering Prepaid"
                  value={money(summaryQuery.data.byType.catering_prepaid?.total ?? 0)}
                  meta={`${summaryQuery.data.byType.catering_prepaid?.count ?? 0} payments`}
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
                <p className="text-sm font-semibold text-slate-700">Page Sales: {money(totalSales)}</p>
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
                        {filteredTransactions.length === 0 && !transactionsQuery.isLoading && (
                          <TableRow>
                            <TableCell colSpan={9} className="py-8 text-center text-slate-500">
                              No transactions match the selected filters.
                            </TableCell>
                          </TableRow>
                        )}
                      </TableBody>
                    </Table>
                  </div>
                )}
                {pagination && (
                  <div className="mt-4 flex flex-col gap-3 border-t border-slate-200 pt-4 sm:flex-row sm:items-center sm:justify-between">
                    <p className="text-sm text-slate-600">
                      {pagination.total === 0
                        ? "No transactions"
                        : `Showing ${(page - 1) * pagination.limit + 1}–${Math.min(page * pagination.limit, pagination.total)} of ${pagination.total.toLocaleString()} transactions`}
                    </p>
                    <div className="flex items-center gap-3">
                      <Button variant="outline" disabled={page <= 1 || transactionsQuery.isFetching} onClick={() => setPage((current) => current - 1)}>
                        Previous
                      </Button>
                      <span className="text-sm text-slate-600">
                        Page {page} of {Math.max(1, pagination.pages)}
                      </span>
                      <Button variant="outline" disabled={page >= pagination.pages || transactionsQuery.isFetching} onClick={() => setPage((current) => current + 1)}>
                        Next
                      </Button>
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>
        </section>
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

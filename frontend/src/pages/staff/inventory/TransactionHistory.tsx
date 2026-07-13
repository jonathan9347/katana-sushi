import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ChevronDown, ChevronRight, Download } from "lucide-react";
import { api } from "../../../lib/api";
import { Button } from "../../../components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "../../../components/ui/card";
import { Select } from "../../../components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "../../../components/ui/table";
import { InventoryTransaction, RawMaterial } from "./types";

type HistoryView = "transaction" | "material";

type PosHistoryRecord = {
  id: string;
  transaction_number: string;
  customer_name?: string | null;
  transaction_type: string;
  total: number;
  payment_method: string;
  status: string;
  created_at: string;
  cashier?: {
    name: string;
    email: string;
  };
  table?: {
    table_number: number;
  } | null;
  items: Array<{
    id: string;
    quantity: number;
    total_price: number;
    round_number?: number;
    selling_product: {
      name: string;
      category: string;
    };
  }>;
  unlimited_session?: {
    pax_count: number;
    total_paid: number;
    leftover_charges: number;
    rounds: Array<{
      id: string;
      round_number: number;
      items: Array<{
        id: string;
        quantity: number;
        selling_product: {
          name: string;
        };
      }>;
    }>;
  };
};

function money(value: number) {
  return `PHP ${Number(value).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export default function TransactionHistory() {
  const [view, setView] = useState<HistoryView>("transaction");
  const [materialId, setMaterialId] = useState("");
  const [materialType, setMaterialType] = useState("");
  const [transactionType, setTransactionType] = useState("");
  const [search, setSearch] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});

  const materialsQuery = useQuery({
    queryKey: ["inventory", "materials"],
    queryFn: async () => {
      const response = await api.get<{ materials: RawMaterial[] }>("/api/inventory/materials");
      return response.data.materials;
    },
    enabled: view === "material"
  });

  const transactionsQuery = useQuery({
    queryKey: ["pos", "transactions", "inventory-view", transactionType, search, from, to],
    queryFn: async () => {
      const response = await api.get<{ transactions: PosHistoryRecord[] }>("/api/pos/transactions", {
        params: {
          from: from || undefined,
          to: to || undefined,
          transaction_type: transactionType || undefined,
          search: search || undefined,
          limit: 100
        }
      });
      return response.data.transactions;
    },
    enabled: view === "transaction"
  });

  const materialTransactionsQuery = useQuery({
    queryKey: ["inventory", "transactions", materialId, materialType, from, to],
    queryFn: async () => {
      const response = await api.get<{ transactions: InventoryTransaction[] }>("/api/inventory/transactions", {
        params: {
          materialId: materialId || undefined,
          type: materialType || undefined,
          from: from || undefined,
          to: to || undefined
        }
      });
      return response.data.transactions;
    },
    enabled: view === "material"
  });

  const materialGroups = useMemo(() => {
    const groups = new Map<string, InventoryTransaction[]>();

    (materialTransactionsQuery.data ?? []).forEach((transaction) => {
      groups.set(transaction.raw_material.name, [...(groups.get(transaction.raw_material.name) ?? []), transaction]);
    });

    return Array.from(groups.entries()).map(([material, transactions]) => ({ material, transactions }));
  }, [materialTransactionsQuery.data]);

  const csv = useMemo(() => {
    if (view === "transaction") {
      const rows = [
        ["Date", "Transaction", "Type", "Total", "Payment", "Cashier", "Items"],
        ...(transactionsQuery.data ?? []).map((transaction) => [
          new Date(transaction.created_at).toLocaleString(),
          transaction.transaction_number,
          transaction.transaction_type,
          String(transaction.total),
          transaction.payment_method,
          transaction.cashier?.name ?? transaction.cashier?.email ?? "System",
          transaction.items.map((item) => `${item.selling_product.name} x${item.quantity}`).join("; ")
        ])
      ];

      return rows.map((row) => row.map((cell) => `"${String(cell).replace(/"/g, '""')}"`).join(",")).join("\n");
    }

    const rows = [
      ["Date", "Material", "Type", "Quantity", "Reference", "User"],
      ...(materialTransactionsQuery.data ?? []).map((transaction) => [
        new Date(transaction.created_at).toLocaleString(),
        transaction.raw_material.name,
        transaction.transaction_type,
        `${transaction.quantity} ${transaction.unit}`,
        transaction.reference ?? "",
        transaction.user?.name ?? transaction.user?.email ?? "System"
      ])
    ];

    return rows.map((row) => row.map((cell) => `"${String(cell).replace(/"/g, '""')}"`).join(",")).join("\n");
  }, [materialTransactionsQuery.data, transactionsQuery.data, view]);

  function exportCsv() {
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = view === "transaction" ? "transactions-by-transaction.csv" : "transactions-by-material.csv";
    link.click();
    URL.revokeObjectURL(url);
  }

  function toggleExpanded(id: string) {
    setExpanded((current) => ({ ...current, [id]: !current[id] }));
  }

  return (
    <Card>
      <CardHeader className="flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
        <CardTitle>{view === "transaction" ? "Transaction History" : "Transaction History (Material View)"}</CardTitle>
        <div className="flex flex-wrap gap-2">
          <Button variant={view === "transaction" ? "default" : "outline"} onClick={() => setView("transaction")}>
            By Transaction
          </Button>
          <Button variant={view === "material" ? "default" : "outline"} onClick={() => setView("material")}>
            By Material
          </Button>
          <Button variant="outline" onClick={exportCsv}>
            <Download className="mr-2 h-4 w-4" />
            Export CSV
          </Button>
        </div>
      </CardHeader>
      <CardContent className="grid gap-4">
        <div className="grid gap-2 md:grid-cols-5">
          <input className="h-10 rounded-md border border-slate-300 px-3 text-sm" type="date" value={from} onChange={(event) => setFrom(event.target.value)} />
          <input className="h-10 rounded-md border border-slate-300 px-3 text-sm" type="date" value={to} onChange={(event) => setTo(event.target.value)} />
          {view === "transaction" ? (
            <>
              <Select value={transactionType} onChange={(event) => setTransactionType(event.target.value)}>
                <option value="">All types</option>
                <option value="dine_in">Dine-in</option>
                <option value="takeout">Takeout</option>
                <option value="unlimited">Unlimited</option>
              </Select>
              <input
                className="h-10 rounded-md border border-slate-300 px-3 text-sm md:col-span-2"
                placeholder="Search transaction or customer"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
              />
            </>
          ) : (
            <>
              <Select value={materialId} onChange={(event) => setMaterialId(event.target.value)}>
                <option value="">All materials</option>
                {materialsQuery.data?.map((material) => (
                  <option key={material.id} value={material.id}>
                    {material.name}
                  </option>
                ))}
              </Select>
              <Select value={materialType} onChange={(event) => setMaterialType(event.target.value)}>
                <option value="">All movement types</option>
                <option value="add">Add</option>
                <option value="deduct">Deduct</option>
                <option value="waste">Waste / Disposal</option>
              </Select>
            </>
          )}
        </div>

        {view === "transaction" && (
          <div className="grid gap-3">
            {transactionsQuery.isLoading && <p className="text-sm text-slate-500">Loading transactions...</p>}
            {transactionsQuery.isError && <p className="text-sm text-red-700">Unable to load transactions.</p>}
            {transactionsQuery.data?.length === 0 && <p className="text-sm text-slate-500">No transactions found.</p>}
            {transactionsQuery.data?.map((transaction) => {
              const open = expanded[transaction.id] ?? false;
              const itemCount = transaction.items.reduce((sum, item) => sum + item.quantity, 0);

              return (
                <section key={transaction.id} className="rounded-md border border-slate-200 bg-white">
                  <button className="flex w-full items-start justify-between gap-4 p-4 text-left" type="button" onClick={() => toggleExpanded(transaction.id)}>
                    <span className="flex gap-3">
                      {open ? <ChevronDown className="mt-1 h-4 w-4 text-slate-500" /> : <ChevronRight className="mt-1 h-4 w-4 text-slate-500" />}
                      <span>
                        <span className="block font-semibold text-slate-950">
                          {transaction.transaction_type === "unlimited" ? "Unlimited Session" : "Transaction"} #{transaction.transaction_number}
                        </span>
                        <span className="mt-1 block text-sm text-slate-600">
                          {new Date(transaction.created_at).toLocaleString()} | Cashier: {transaction.cashier?.name ?? "System"} | Type:{" "}
                          {transaction.transaction_type.replace("_", " ")}
                        </span>
                        <span className="mt-1 block text-sm text-slate-600">
                          {transaction.transaction_type === "unlimited"
                            ? `Table ${transaction.table?.table_number ?? "-"} | Guests: ${transaction.unlimited_session?.pax_count ?? 0} | Rounds: ${
                                transaction.unlimited_session?.rounds.length ?? 0
                              } | Items: ${itemCount}`
                            : `Customer: ${transaction.customer_name || "Walk-in"} | Payment: ${transaction.payment_method}`}
                        </span>
                      </span>
                    </span>
                    <span className="font-semibold text-slate-950">{money(transaction.total)}</span>
                  </button>
                  {open && (
                    <div className="border-t border-slate-200 p-4">
                      <div className="overflow-x-auto">
                        <Table>
                          <TableHeader>
                            <TableRow>
                              {transaction.transaction_type === "unlimited" && <TableHead>Round</TableHead>}
                              <TableHead>Item</TableHead>
                              <TableHead>Qty</TableHead>
                              <TableHead>Total</TableHead>
                            </TableRow>
                          </TableHeader>
                          <TableBody>
                            {transaction.items.map((item) => (
                              <TableRow key={item.id}>
                                {transaction.transaction_type === "unlimited" && <TableCell>{item.round_number ?? "-"}</TableCell>}
                                <TableCell className="font-medium">{item.selling_product.name}</TableCell>
                                <TableCell>{item.quantity}</TableCell>
                                <TableCell>{money(item.total_price)}</TableCell>
                              </TableRow>
                            ))}
                          </TableBody>
                        </Table>
                      </div>
                      {transaction.unlimited_session && (
                        <p className="mt-3 text-sm text-slate-600">
                          Total paid: {money(transaction.unlimited_session.total_paid)} | Leftover charges:{" "}
                          {money(transaction.unlimited_session.leftover_charges)}
                        </p>
                      )}
                    </div>
                  )}
                </section>
              );
            })}
          </div>
        )}

        {view === "material" && (
          <div className="grid gap-3">
            {materialTransactionsQuery.isLoading && <p className="text-sm text-slate-500">Loading material movements...</p>}
            {materialTransactionsQuery.isError && <p className="text-sm text-red-700">Unable to load material movements.</p>}
            {materialGroups.length === 0 && !materialTransactionsQuery.isLoading && <p className="text-sm text-slate-500">No material movements found.</p>}
            {materialGroups.map((group) => {
              const open = expanded[group.material] ?? false;

              return (
                <section key={group.material} className="rounded-md border border-slate-200 bg-white">
                  <button className="flex w-full items-center justify-between p-4 text-left" type="button" onClick={() => toggleExpanded(group.material)}>
                    <span className="flex items-center gap-2 font-semibold text-slate-950">
                      {open ? <ChevronDown className="h-4 w-4 text-slate-500" /> : <ChevronRight className="h-4 w-4 text-slate-500" />}
                      {group.material}
                    </span>
                    <span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-semibold text-slate-600">{group.transactions.length} movements</span>
                  </button>
                  {open && (
                    <div className="border-t border-slate-200 p-4">
                      <div className="overflow-x-auto">
                        <Table>
                          <TableHeader>
                            <TableRow>
                              <TableHead>Date</TableHead>
                              <TableHead>Type</TableHead>
                              <TableHead>Quantity</TableHead>
                              <TableHead>Batch</TableHead>
                              <TableHead>Reference</TableHead>
                              <TableHead>User</TableHead>
                            </TableRow>
                          </TableHeader>
                          <TableBody>
                            {group.transactions.map((transaction) => (
                              <TableRow key={transaction.id}>
                                <TableCell>{new Date(transaction.created_at).toLocaleString()}</TableCell>
                                <TableCell>{transaction.transaction_type}{transaction.reason ? ` (${transaction.reason.replace("_", " ")})` : ""}</TableCell>
                                <TableCell>
                                  {Number(transaction.quantity).toLocaleString()} {transaction.unit}
                                </TableCell>
                                <TableCell>{transaction.batch?.batch_number ?? "—"}</TableCell>
                                <TableCell>{transaction.reference ?? "-"}</TableCell>
                                <TableCell>{transaction.user?.name ?? transaction.user?.email ?? "System"}</TableCell>
                              </TableRow>
                            ))}
                          </TableBody>
                        </Table>
                      </div>
                    </div>
                  )}
                </section>
              );
            })}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

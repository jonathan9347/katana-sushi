import { Button } from "../ui/button";
import { Dialog } from "../ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "../ui/table";
import { Link } from "react-router-dom";
import { formatManilaDateTime } from "../../lib/dateTime";

export type PosHistoryTransaction = {
  id: string;
  transaction_number: string;
  reference_booking_id?: string | null;
  label: string;
  customer_name?: string | null;
  transaction_type: string;
  subtotal: number;
  tax: number;
  total: number;
  payment_method: string;
  cash_received?: number | null;
  change_due?: number | null;
  status: string;
  created_at: string;
  cashier?: {
    name: string;
    email: string;
  };
  items: Array<{
    id: string;
    quantity: number;
    unit_price: number;
    total_price: number;
    selling_product: {
      name: string;
      category: string;
    };
  }>;
};

type TransactionDetailsModalProps = {
  transaction: PosHistoryTransaction | null;
  admin: boolean;
  refundPending: boolean;
  onClose: () => void;
  onRefund: (transaction: PosHistoryTransaction) => void;
};

function money(value: number) {
  return `PHP ${Number(value).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export default function TransactionDetailsModal({
  admin,
  refundPending,
  transaction,
  onClose,
  onRefund
}: TransactionDetailsModalProps) {
  return (
    <Dialog
      open={Boolean(transaction)}
      title={transaction ? `Transaction ${transaction.transaction_number}` : "Transaction Details"}
      panelClassName="max-w-4xl"
      onClose={onClose}
    >
      {transaction && (
        <div className="grid gap-4">
          <div className="grid gap-2 rounded-md border border-slate-200 bg-slate-50 p-4 text-sm sm:grid-cols-2">
            <p>Customer: <span className="font-semibold">{transaction.customer_name || "Walk-in"}</span></p>
            <p>Cashier: <span className="font-semibold">{transaction.cashier?.name ?? "Unknown"}</span></p>
            <p>Type: <span className="font-semibold">{transaction.label}</span></p>
            <p>Payment: <span className="font-semibold">{transaction.payment_method}</span></p>
            <p>Status: <span className="font-semibold">{transaction.status}</span></p>
            <p>Date: <span className="font-semibold">{formatManilaDateTime(transaction.created_at)}</span></p>
            {transaction.reference_booking_id && (
              <p>
                Booking ID:{" "}
                <Link className="font-semibold text-blue-600 underline" to={`/reservation/status?bookingId=${transaction.reference_booking_id}`}>
                  {transaction.reference_booking_id}
                </Link>
              </p>
            )}
          </div>

          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Item</TableHead>
                  <TableHead>Qty</TableHead>
                  <TableHead>Unit</TableHead>
                  <TableHead>Total</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {transaction.items.map((item) => (
                  <TableRow key={item.id}>
                    <TableCell className="font-medium">{item.selling_product.name}</TableCell>
                    <TableCell>{item.quantity}</TableCell>
                    <TableCell>{money(item.unit_price)}</TableCell>
                    <TableCell>{money(item.total_price)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>

          <div className="ml-auto grid w-full max-w-xs gap-1 text-sm">
            <Line label="Subtotal" value={transaction.subtotal} />
            <Line label="Tax" value={transaction.tax} />
            <Line label="Total" value={transaction.total} strong />
          </div>

          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={onClose}>
              Close
            </Button>
            {admin && transaction.status !== "refunded" && ["dine_in", "takeout"].includes(transaction.transaction_type) && (
              <Button type="button" variant="danger" disabled={refundPending} onClick={() => onRefund(transaction)}>
                Refund
              </Button>
            )}
          </div>
        </div>
      )}
    </Dialog>
  );
}

function Line({ label, value, strong = false }: { label: string; value: number; strong?: boolean }) {
  return (
    <p className={`flex justify-between ${strong ? "text-lg font-semibold text-slate-950" : "text-slate-600"}`}>
      <span>{label}</span>
      <span>{money(value)}</span>
    </p>
  );
}

import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

type Label =
  | "Dine-in Sale"
  | "Takeout Sale"
  | "Unlimited Sale"
  | "Dine-in Deposit"
  | "Dine-in Balance"
  | "Dine-in Prepaid"
  | "Catering Deposit"
  | "Catering Balance"
  | "Catering Prepaid";

export type UnifiedTransaction = {
  id: string;
  transaction_number: string;
  reference_booking_id: string | null;
  customer_name: string | null;
  transaction_type:
    | "dine_in"
    | "takeout"
    | "unlimited"
    | "dine_in_deposit"
    | "dine_in_balance"
    | "dine_in_prepaid"
    | "catering_deposit"
    | "catering_balance"
    | "catering_prepaid";
  label: Label;
  subtotal: number;
  tax: number;
  total: number;
  payment_method: string;
  cash_received?: number | null;
  change_due?: number | null;
  status: string;
  cashier?: { name: string; email: string } | null;
  created_at: Date;
  items: Array<unknown>;
};

function roundMoney(value: number) {
  return Number(value.toFixed(2));
}

function manilaDateToUtc(dateString: string) {
  return new Date(`${dateString}T00:00:00+08:00`);
}

function startOfDay(date: Date) {
  return manilaDateToUtc(
    new Intl.DateTimeFormat("en-CA", {
      timeZone: "Asia/Manila",
      year: "numeric",
      month: "2-digit",
      day: "2-digit"
    }).format(date)
  );
}

function endOfDay(date: Date) {
  const d = startOfDay(date);
  d.setUTCHours(d.getUTCHours() + 24);
  d.setUTCMilliseconds(d.getUTCMilliseconds() - 1);
  return d;
}

function manilaDateRange(dateFrom?: string, dateTo?: string) {
  if (!dateFrom && !dateTo) return undefined;
  return {
    gte: dateFrom ? startOfDay(manilaDateToUtc(dateFrom)) : undefined,
    lte: dateTo ? endOfDay(manilaDateToUtc(dateTo)) : undefined
  };
}

function labelFor(type: UnifiedTransaction["transaction_type"]): Label {
  switch (type) {
    case "dine_in":
      return "Dine-in Sale";
    case "takeout":
      return "Takeout Sale";
    case "unlimited":
      return "Unlimited Sale";
    case "dine_in_deposit":
      return "Dine-in Deposit";
    case "dine_in_balance":
      return "Dine-in Balance";
    case "dine_in_prepaid":
      return "Dine-in Prepaid";
    case "catering_deposit":
      return "Catering Deposit";
    case "catering_balance":
      return "Catering Balance";
    case "catering_prepaid":
      return "Catering Prepaid";
    default:
      return "Dine-in Sale";
  }
}

export async function getUnifiedTransactions(params: {
  date?: string;
  from?: string;
  to?: string;
  search?: string;
  cashierId?: string;
  paymentMethod?: string;
  transactionType?: string;
  page?: number;
  limit?: number;
}): Promise<{ transactions: UnifiedTransaction[]; pagination: { page: number; limit: number; total: number; pages: number } }> {
  const {
    date,
    from,
    to,
    search = "",
    cashierId,
    paymentMethod,
    transactionType,
    page = 1,
    limit = 20
  } = params;

  const dateFrom = from ?? date;
  const dateTo = to ?? date;
  const createdAt = manilaDateRange(dateFrom, dateTo);

  const pageNum = Math.max(page, 1);
  const limitNum = Math.min(Math.max(limit, 1), 100);

  const posTransactionTypes = ["dine_in", "takeout"];
  const includePosTransactions = !transactionType || posTransactionTypes.includes(transactionType);

  const includeUnlimitedSessions = !transactionType || transactionType === "unlimited";
  const includeCateringReservations = !transactionType || ["catering_deposit", "catering_balance", "catering_prepaid"].includes(transactionType);
  const includeDineInReservations = !transactionType || ["dine_in_deposit", "dine_in_balance", "dine_in_prepaid"].includes(transactionType);

  const wherePos: any = {
    created_at: createdAt,
    ...(cashierId ? { cashier_id: cashierId } : {}),
    ...(paymentMethod ? { payment_method: paymentMethod } : {})
  };

  if (transactionType && transactionType !== "unlimited" && includePosTransactions) {
    wherePos.transaction_type = transactionType;
  }

  if (search) {
    wherePos.OR = [
      { transaction_number: { contains: search, mode: "insensitive" } },
      { customer_name: { contains: search, mode: "insensitive" } }
    ];
  }

  const [posTransactions, unlimitedSessions, cateringReservations, dineInReservations] = await Promise.all([
    includePosTransactions
      ? prisma.posTransaction.findMany({
          where: wherePos,
          include: {
            cashier: { select: { id: true, name: true, email: true } },
            items: { include: { selling_product: true } }
          },
          orderBy: { created_at: "desc" }
        })
      : Promise.resolve([]),

    includeUnlimitedSessions
      ? prisma.unlimitedSession.findMany({
          where: {
            ...(cashierId ? { cashier_id: cashierId } : {}),
            created_at: createdAt,
            ...(search
              ? {
                  OR: [
                    { id: { contains: search, mode: "insensitive" } },
                    { table: { table_number: Number.isFinite(Number(search)) ? Number(search) : undefined } }
                  ]
                }
              : {})
          },
          include: {
            cashier: { select: { id: true, name: true, email: true } },
            table: true,
            leftover_items: { include: { selling_product: true } },
            rounds: { include: { items: { include: { selling_product: true } } }, orderBy: { round_number: "asc" } }
          },
          orderBy: { created_at: "desc" }
        })
      : Promise.resolve([]),

    includeCateringReservations
      ? prisma.cateringReservation.findMany({
          where: {
            created_at: createdAt,
            ...(search
              ? {
                  OR: [
                    { inquiry: { inquiry_id: { contains: search, mode: "insensitive" } } },
                    { inquiry: { customer_name: { contains: search, mode: "insensitive" } } },
                    { inquiry: { package_type: { contains: search, mode: "insensitive" } } }
                  ]
                }
              : {})
          },
          include: { inquiry: true, package: true, ingredient_locks: { include: { raw_material: true } } },
          orderBy: { created_at: "desc" }
        })
      : Promise.resolve([]),

    includeDineInReservations
      ? prisma.reservation.findMany({
          where: {
            created_at: createdAt,
            ...(search
              ? {
                  OR: [
                    { booking_id: { contains: search, mode: "insensitive" } },
                    { customer_name: { contains: search, mode: "insensitive" } }
                  ]
                }
              : {})
          },
          include: { table: true },
          orderBy: { created_at: "desc" }
        })
      : Promise.resolve([])
  ]);

  const unified: UnifiedTransaction[] = [];

  // POS walk-in sales
  for (const t of posTransactions) {
    const transactionType = t.transaction_type === "takeout" ? "takeout" : "dine_in";

    unified.push({
      id: `pos-${t.id}`,
      transaction_number: t.transaction_number,
      reference_booking_id: null,
      customer_name: t.customer_name,
      transaction_type: transactionType,
      label: labelFor(transactionType),
      subtotal: Number(t.subtotal),
      tax: Number(t.tax),
      total: Number(t.total),
      payment_method: t.payment_method,
      cash_received: t.cash_received,
      change_due: t.change_due,
      status: t.status,
      cashier: t.cashier ? { name: t.cashier.name, email: t.cashier.email } : null,
      created_at: t.created_at,
      items: t.items
    });
  }

  // Dine-in reservation deposit/balance/prepaid
  for (const r of dineInReservations as any[]) {
    const referenceId = r.booking_id;

    const downpayment = Number(r.downpayment_amount ?? 0);
    const remaining = Number(r.remaining_balance ?? 0);
    const isPrepaid = remaining <= 0 && r.final_payment_status === "paid";

    if (downpayment > 0 && r.downpayment_status === "paid") {
      if (isPrepaid) {
        unified.push({
          id: `${r.id}-prepaid`,
          transaction_number: `PRE-${referenceId}`,
          reference_booking_id: referenceId,
          customer_name: r.customer_name,
          transaction_type: "dine_in_prepaid",
          label: labelFor("dine_in_prepaid"),
          subtotal: Number(r.total_price ?? downpayment),
          tax: Number(r.tax ?? 0),
          total: Number(r.total_price ?? downpayment),
          payment_method: r.final_payment_method ?? r.downpayment_method ?? "cash",
          cash_received: Number(r.total_price ?? downpayment),
          change_due: 0,
          status: r.status,
          cashier: null,
          created_at: r.downpayment_date ?? r.created_at,
          items: []
        });
      } else {
        unified.push({
          id: `${r.id}-deposit`,
          transaction_number: `DEP-${referenceId}`,
          reference_booking_id: referenceId,
          customer_name: r.customer_name,
          transaction_type: "dine_in_deposit",
          label: labelFor("dine_in_deposit"),
          subtotal: downpayment,
          tax: Number(r.tax ?? 0),
          total: downpayment,
          payment_method: r.downpayment_method ?? "cash",
          cash_received: downpayment,
          change_due: 0,
          status: r.status,
          cashier: null,
          created_at: r.downpayment_date ?? r.created_at,
          items: []
        });
      }
    }

    // Remaining balance => only show when completed and remaining > 0
    if (r.status === "completed" && remaining > 0) {
      unified.push({
        id: `${r.id}-balance`,
        transaction_number: `BAL-${referenceId}`,
        reference_booking_id: referenceId,
        customer_name: r.customer_name,
        transaction_type: "dine_in_balance",
        label: labelFor("dine_in_balance"),
        subtotal: remaining,
        tax: 0,
        total: remaining,
        payment_method: r.final_payment_method ?? "cash",
        cash_received: remaining,
        change_due: 0,
        status: r.status,
        cashier: null,
        created_at: r.remaining_paid_date ?? r.created_at,
        items: []
      });
    }
  }

  // Catering reservation deposit/balance/prepaid
  for (const r of cateringReservations as any[]) {
    const bookingRef = r.reservation_id;
    const inquiryRef = r.inquiry?.inquiry_id;
    const referenceId = inquiryRef ?? bookingRef;

    const depositPaid = Number(r.deposit_paid ?? 0);
    const total = Number(r.total_price ?? 0);
    const remaining = Math.max(total - depositPaid, 0);

    const isFullyPaid = remaining <= 0 && r.final_payment_status === "paid";

    if (depositPaid > 0) {
      const type = isFullyPaid && remaining <= 0 ? "catering_prepaid" : "catering_deposit";
      unified.push({
        id: `${r.id}-deposit`,
        transaction_number: `DEP-${referenceId}`,
        reference_booking_id: bookingRef,
        customer_name: r.inquiry?.customer_name ?? null,
        transaction_type: type,
        label: labelFor(type),
        subtotal: type === "catering_prepaid" ? total : depositPaid,
        tax: 0,
        total: type === "catering_prepaid" ? total : depositPaid,
        payment_method: r.downpayment_method ?? "cash",
        cash_received: depositPaid,
        change_due: 0,
        status: r.status,
        cashier: null,
        created_at: r.downpayment_date ?? r.created_at,
        items: []
      });
    }

    if (r.status === "completed" && remaining > 0) {
      unified.push({
        id: `${r.id}-balance`,
        transaction_number: `BAL-${referenceId}`,
        reference_booking_id: bookingRef,
        customer_name: r.inquiry?.customer_name ?? null,
        transaction_type: "catering_balance",
        label: labelFor("catering_balance"),
        subtotal: remaining,
        tax: 0,
        total: remaining,
        payment_method: r.final_payment_method ?? "cash",
        cash_received: remaining,
        change_due: 0,
        status: r.status,
        cashier: null,
        created_at: r.remaining_paid_date ?? r.created_at,
        items: []
      });
    }
  }

  // Filter/normalize to only required set for Task 7
  const requiredTypes: UnifiedTransaction["transaction_type"][] = [
    "dine_in",
    "takeout",
    "unlimited",
    "dine_in_deposit",
    "dine_in_balance",
    "dine_in_prepaid",
    "catering_deposit",
    "catering_balance",
    "catering_prepaid"
  ];

  const normalized = unified.filter((t) => requiredTypes.includes(t.transaction_type));

  normalized.sort((a, b) => b.created_at.getTime() - a.created_at.getTime());

  const total = normalized.length;
  const pages = Math.ceil(total / limitNum);
  const sliceStart = (pageNum - 1) * limitNum;

  return {
    transactions: normalized.slice(sliceStart, sliceStart + limitNum),
    pagination: { page: pageNum, limit: limitNum, total, pages }
  };
}


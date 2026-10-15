import { Prisma } from "@prisma/client";
import { prisma } from "../lib/prisma";

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
  discount_amount?: number;
  guest_count?: number;
  discount_guest_count?: number;
  payment_method: string;
  cash_received?: number | null;
  change_due?: number | null;
  status: string;
  cashier?: { name: string; email: string } | null;
  created_at: Date;
  items: Array<unknown>;
};

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

function isInDateRange(date: Date, range: ReturnType<typeof manilaDateRange>) {
  return (!range?.gte || date >= range.gte) && (!range?.lte || date <= range.lte);
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
}): Promise<{
  transactions: UnifiedTransaction[];
  pagination: { page: number; limit: number; total: number; pages: number };
  summary: {
    totalSales: number;
    totalTransactions: number;
    averageOrderValue: number;
    byType: Record<string, { count: number; total: number }>;
    byPayment: Record<string, { count: number; total: number }>;
  };
}> {
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

  const posTransactionTypes: UnifiedTransaction["transaction_type"][] = ["dine_in", "takeout", "unlimited"];
  const includePosTransactions = !transactionType || posTransactionTypes.some((type) => type === transactionType);

  const includeUnlimitedSessions = !transactionType || transactionType === "unlimited";
  const includeCateringReservations = (!transactionType || ["catering_deposit", "catering_balance", "catering_prepaid"].includes(transactionType)) && !cashierId;
  const includeDineInReservations = (!transactionType || ["dine_in_deposit", "dine_in_balance", "dine_in_prepaid"].includes(transactionType)) && !cashierId;

  const wherePos: Prisma.PosTransactionWhereInput = {
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

  const reservationDateCondition: Prisma.ReservationWhereInput | undefined = createdAt
    ? {
        OR: [
          { created_at: createdAt },
          { downpayment_date: createdAt },
          { full_payment_date: createdAt },
          { remaining_paid_date: createdAt },
          { payments: { some: { received_at: createdAt } } }
        ]
      }
    : undefined;
  const reservationSearchCondition: Prisma.ReservationWhereInput | undefined = search
    ? {
        OR: [
          { booking_id: { contains: search, mode: "insensitive" } },
          { customer_name: { contains: search, mode: "insensitive" } }
        ]
      }
    : undefined;
  const cateringDateCondition: Prisma.CateringReservationWhereInput | undefined = createdAt
    ? {
        OR: [
          { created_at: createdAt },
          { downpayment_date: createdAt },
          { full_payment_date: createdAt },
          { remaining_paid_date: createdAt },
          { payments: { some: { received_at: createdAt } } }
        ]
      }
    : undefined;
  const cateringSearchCondition: Prisma.CateringReservationWhereInput | undefined = search
    ? {
        OR: [
          { reservation_id: { contains: search, mode: "insensitive" } },
          { customer_name: { contains: search, mode: "insensitive" } },
          { inquiry: { inquiry_id: { contains: search, mode: "insensitive" } } },
          { inquiry: { customer_name: { contains: search, mode: "insensitive" } } },
          { inquiry: { package_type: { contains: search, mode: "insensitive" } } }
        ]
      }
    : undefined;

  const [posTransactions, unlimitedSessions, cateringReservations, dineInReservations] = await Promise.all([
    includePosTransactions
      ? prisma.posTransaction.findMany({
          where: wherePos,
          include: {
            cashier: { select: { id: true, name: true, email: true } },
            items: { include: { selling_product: true } },
            charges: true
          },
          orderBy: { created_at: "desc" }
        })
      : Promise.resolve([]),

    includeUnlimitedSessions
      && (!paymentMethod || paymentMethod === "cash")
      ? prisma.unlimitedSession.findMany({
          where: {
            dining_session_id: null,
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
            AND: [cateringDateCondition, cateringSearchCondition].filter(
              (condition): condition is Prisma.CateringReservationWhereInput => Boolean(condition)
            )
          },
          include: { inquiry: true, package: true, payments: { orderBy: { received_at: "asc" } } },
          orderBy: { created_at: "desc" }
        })
      : Promise.resolve([]),

    includeDineInReservations
      ? prisma.reservation.findMany({
          where: {
            AND: [reservationDateCondition, reservationSearchCondition].filter(
              (condition): condition is Prisma.ReservationWhereInput => Boolean(condition)
            )
          },
          include: { table: true, payments: { orderBy: { received_at: "asc" } } },
          orderBy: { created_at: "desc" }
        })
      : Promise.resolve([])
  ]);

  const unified: UnifiedTransaction[] = [];

  // POS walk-in sales
  for (const t of posTransactions) {
    const transactionType: UnifiedTransaction["transaction_type"] =
      t.transaction_type === "takeout" ? "takeout" : t.transaction_type === "unlimited" ? "unlimited" : "dine_in";

    unified.push({
      id: t.id,
      transaction_number: t.transaction_number,
      reference_booking_id: null,
      customer_name: t.customer_name,
      transaction_type: transactionType,
      label: labelFor(transactionType),
      subtotal: Number(t.subtotal),
      tax: Number(t.tax),
      total: Number(t.total),
      discount_amount: Number(t.discount_amount),
      guest_count: t.guest_count,
      discount_guest_count: t.discount_guest_count,
      payment_method: t.payment_method,
      cash_received: t.cash_received,
      change_due: t.change_due,
      status: t.status,
      cashier: t.cashier ? { name: t.cashier.name, email: t.cashier.email } : null,
      created_at: t.created_at,
      items: [
        ...t.items,
        ...t.charges.map((charge) => ({
          id: charge.id,
          quantity: charge.quantity,
          unit_price: Number(charge.unit_price),
          total_price: Number(charge.total_price),
          selling_product: {
            name: charge.name_snapshot,
            category: "Charge"
          }
        }))
      ]
    });
  }

  // Unlimited sessions are stored separately from standard POS sales.
  for (const session of unlimitedSessions) {
    const leftoverCharges = session.leftover_items.reduce((total, item) => total + item.charge_amount, 0);
    const total = Number(session.total_paid) + leftoverCharges;
    const items = [
      ...session.rounds.flatMap((round) =>
        round.items.map((item) => ({
          id: item.id,
          quantity: item.quantity,
          unit_price: Number(item.selling_product.price),
          total_price: Number(item.selling_product.price) * item.quantity,
          selling_product: item.selling_product
        }))
      ),
      ...session.leftover_items.map((item) => ({
        id: item.id,
        quantity: item.quantity,
        unit_price: item.quantity > 0 ? item.charge_amount / item.quantity : item.charge_amount,
        total_price: item.charge_amount,
        selling_product: item.selling_product
      }))
    ];

    unified.push({
      id: `unlimited-${session.id}`,
      transaction_number: `UNL-${session.created_at.toISOString().slice(0, 10).replace(/-/g, "")}-${session.id.slice(-4).toUpperCase()}`,
      reference_booking_id: null,
      customer_name: null,
      transaction_type: "unlimited",
      label: labelFor("unlimited"),
      subtotal: Number(session.total_paid),
      tax: 0,
      total,
      payment_method: "cash",
      cash_received: total,
      change_due: 0,
      status: session.status,
      cashier: session.cashier ? { name: session.cashier.name, email: session.cashier.email } : null,
      created_at: session.created_at,
      items
    });
  }

  const makeReservationItem = (id: string, name: string, category: string, amount: number) => [{
    id: `${id}-item`,
    quantity: 1,
    unit_price: amount,
    total_price: amount,
    selling_product: { name, category }
  }];

  // Dine-in reservation payments include separate balance payments from the ledger.
  for (const reservation of dineInReservations) {
    const paymentStages = new Set(reservation.payments.map((payment) => payment.payment_stage));
    const addPayment = (
      id: string,
      transactionNumber: string,
      type: "dine_in_deposit" | "dine_in_balance" | "dine_in_prepaid",
      amount: number,
      method: string,
      paymentDate: Date,
      cashReceived?: number | null,
      changeDue?: number | null
    ) => {
      if (amount <= 0 || !isInDateRange(paymentDate, createdAt) || (paymentMethod && paymentMethod !== method)) return;

      unified.push({
        id,
        transaction_number: transactionNumber,
        reference_booking_id: reservation.booking_id,
        customer_name: reservation.customer_name,
        transaction_type: type,
        label: labelFor(type),
        subtotal: amount,
        tax: 0,
        total: amount,
        payment_method: method,
        cash_received: cashReceived ?? amount,
        change_due: changeDue ?? 0,
        status: "paid",
        cashier: null,
        created_at: paymentDate,
        items: makeReservationItem(
          id,
          type === "dine_in_balance" ? `Dine-in balance (${reservation.time})` :
            type === "dine_in_prepaid" ? `Dine-in prepaid (${reservation.time})` : `Dine-in deposit (${reservation.time})`,
          "Reservation",
          amount
        )
      });
    };

    for (const payment of reservation.payments) {
      const type = payment.payment_stage === "remaining_balance"
        ? "dine_in_balance"
        : payment.payment_stage === "full_payment"
          ? "dine_in_prepaid"
          : payment.payment_stage === "cancellation"
            ? null
            : "dine_in_deposit";
      if (type) {
        const prefix = type === "dine_in_balance" ? "BAL" : type === "dine_in_prepaid" ? "PRE" : "DEP";
        addPayment(
          `reservation-payment-${payment.id}`,
          `${prefix}-${reservation.booking_id}-${payment.id.slice(-6).toUpperCase()}`,
          type,
          payment.amount,
          payment.method,
          payment.received_at,
          payment.cash_received,
          payment.change_due
        );
      }
    }

    const downpayment = Number(reservation.downpayment_amount);
    if (!paymentStages.has("downpayment") && !paymentStages.has("full_payment") &&
        reservation.downpayment_status === "paid" && downpayment > 0) {
      const prepaid = reservation.payment_plan === "full_payment" || downpayment >= Number(reservation.total_price);
      const type = prepaid ? "dine_in_prepaid" : "dine_in_deposit";
      const amount = prepaid ? Number(reservation.total_price) : downpayment;
      addPayment(
        `${reservation.id}-${prepaid ? "prepaid" : "deposit"}`,
        `${prepaid ? "PRE" : "DEP"}-${reservation.booking_id}`,
        type,
        amount,
        prepaid
          ? reservation.final_payment_method ?? reservation.downpayment_method ?? "cash"
          : reservation.downpayment_method ?? "cash",
        prepaid
          ? reservation.full_payment_date ?? reservation.downpayment_date ?? reservation.created_at
          : reservation.downpayment_date ?? reservation.created_at
      );
    }

    if (!paymentStages.has("remaining_balance") &&
        (reservation.remaining_paid_at_venue || reservation.remaining_paid_date || reservation.final_payment_status === "paid") &&
        Number(reservation.total_price) > downpayment) {
      const amount = Number(reservation.total_price) - downpayment;
      addPayment(
        `${reservation.id}-balance`,
        `BAL-${reservation.booking_id}`,
        "dine_in_balance",
        amount,
        reservation.final_payment_method ?? "cash",
        reservation.remaining_paid_date ?? reservation.final_payment_date ?? reservation.created_at
      );
    }
  }

  // Catering reservation payments use the same payment ledger as dine-in bookings.
  for (const reservation of cateringReservations) {
    const bookingId = reservation.reservation_id ?? reservation.inquiry?.inquiry_id ?? reservation.id;
    const referenceId = reservation.inquiry?.inquiry_id ?? bookingId;
    const customerName = reservation.customer_name ?? reservation.inquiry?.customer_name ?? null;
    const packageName = reservation.package?.name ?? reservation.inquiry?.package_type ?? "Catering";
    const paymentStages = new Set(reservation.payments.map((payment) => payment.payment_stage));
    const addPayment = (
      id: string,
      transactionNumber: string,
      type: "catering_deposit" | "catering_balance" | "catering_prepaid",
      amount: number,
      method: string,
      paymentDate: Date,
      cashReceived?: number | null,
      changeDue?: number | null
    ) => {
      if (amount <= 0 || !isInDateRange(paymentDate, createdAt) || (paymentMethod && paymentMethod !== method)) return;

      unified.push({
        id,
        transaction_number: transactionNumber,
        reference_booking_id: reservation.reservation_id,
        customer_name: customerName,
        transaction_type: type,
        label: labelFor(type),
        subtotal: amount,
        tax: 0,
        total: amount,
        payment_method: method,
        cash_received: cashReceived ?? amount,
        change_due: changeDue ?? 0,
        status: "paid",
        cashier: null,
        created_at: paymentDate,
        items: makeReservationItem(
          id,
          `${packageName} ${type === "catering_balance" ? "balance" : type === "catering_prepaid" ? "prepaid" : "deposit"}`,
          "Catering",
          amount
        )
      });
    };

    for (const payment of reservation.payments) {
      const type = payment.payment_stage === "remaining_balance"
        ? "catering_balance"
        : payment.payment_stage === "full_payment"
          ? "catering_prepaid"
          : payment.payment_stage === "cancellation"
            ? null
            : "catering_deposit";
      if (type) {
        const prefix = type === "catering_balance" ? "BAL" : type === "catering_prepaid" ? "PRE" : "DEP";
        addPayment(
          `catering-payment-${payment.id}`,
          `${prefix}-${referenceId}-${payment.id.slice(-6).toUpperCase()}`,
          type,
          payment.amount,
          payment.method,
          payment.received_at,
          payment.cash_received,
          payment.change_due
        );
      }
    }

    const depositPaid = Number(reservation.deposit_paid ?? reservation.downpayment_amount);
    const isPrepaid = reservation.payment_plan === "full_payment" ||
      (Number(reservation.remaining_balance) <= 0 && reservation.final_payment_status === "paid" &&
        depositPaid >= Number(reservation.total_price));
    if (!paymentStages.has("downpayment") && !paymentStages.has("full_payment") && depositPaid > 0) {
      const type = isPrepaid ? "catering_prepaid" : "catering_deposit";
      const amount = isPrepaid ? Number(reservation.total_price) : depositPaid;
      addPayment(
        `${reservation.id}-${isPrepaid ? "prepaid" : "deposit"}`,
        `${isPrepaid ? "PRE" : "DEP"}-${referenceId}`,
        type,
        amount,
        isPrepaid
          ? reservation.final_payment_method ?? reservation.downpayment_method ?? "cash"
          : reservation.downpayment_method ?? "cash",
        isPrepaid
          ? reservation.full_payment_date ?? reservation.downpayment_date ?? reservation.created_at
          : reservation.downpayment_date ?? reservation.created_at
      );
    }

    if (!paymentStages.has("remaining_balance") &&
        (reservation.remaining_paid_at_venue || reservation.remaining_paid_date || reservation.final_payment_status === "paid") &&
        Number(reservation.total_price) > depositPaid) {
      const amount = Number(reservation.total_price) - depositPaid;
      addPayment(
        `${reservation.id}-balance`,
        `BAL-${referenceId}`,
        "catering_balance",
        amount,
        reservation.final_payment_method ?? "cash",
        reservation.remaining_paid_date ?? reservation.final_payment_date ?? reservation.created_at
      );
    }
  }

  const normalized = unified.filter((transaction) =>
    (!paymentMethod || transaction.payment_method === paymentMethod) &&
    (!createdAt || isInDateRange(transaction.created_at, createdAt))
  );

  normalized.sort((a, b) => b.created_at.getTime() - a.created_at.getTime());

  const total = normalized.length;
  const pages = Math.ceil(total / limitNum);
  const sliceStart = (pageNum - 1) * limitNum;
  const byType: Record<string, { count: number; total: number }> = {};
  const byPayment: Record<string, { count: number; total: number }> = {};

  for (const transaction of normalized) {
    const typeBucket = byType[transaction.transaction_type] ??= { count: 0, total: 0 };
    typeBucket.count += 1;
    typeBucket.total += transaction.total;

    const paymentBucket = byPayment[transaction.payment_method] ??= { count: 0, total: 0 };
    paymentBucket.count += 1;
    paymentBucket.total += transaction.total;
  }
  const totalSales = normalized.reduce((sum, transaction) => sum + transaction.total, 0);

  return {
    transactions: normalized.slice(sliceStart, sliceStart + limitNum),
    pagination: { page: pageNum, limit: limitNum, total, pages },
    summary: {
      totalSales,
      totalTransactions: total,
      averageOrderValue: total > 0 ? totalSales / total : 0,
      byType,
      byPayment
    }
  };
}

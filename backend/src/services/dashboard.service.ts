import { prisma } from "../lib/prisma";

export const DASHBOARD_CRITICAL_STOCK_PERCENT = 25;

const HOLDING_STATUSES = ["approved", "confirmed", "seated", "preparing", "in_progress", "pending_final_payment"];

export function getDashboardStockSeverity(quantityLeft: number, percentOfPar: number) {
  return quantityLeft <= 0 || percentOfPar <= DASHBOARD_CRITICAL_STOCK_PERCENT ? "critical" as const : "reorder" as const;
}

export type DashboardNotification = {
  id: string;
  type: "table" | "catering" | "pickup";
  reference: string;
  customerName: string;
  date: Date;
  time: string | null;
  status: string;
  details: string;
  createdAt: Date;
};

function dateKey(date: Date, timeZone: string) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).format(date);
}

function addDays(key: string, days: number) {
  const date = new Date(`${key}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

export function localDateTimeToUtc(key: string, timeZone: string, hour = 0, minute = 0) {
  const [year, month, day] = key.split("-").map(Number);
  const target = Date.UTC(year, month - 1, day, hour, minute);
  let guess = target;

  for (let attempt = 0; attempt < 3; attempt += 1) {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hourCycle: "h23"
    }).formatToParts(new Date(guess));
    const value = (type: string) => Number(parts.find((part) => part.type === type)?.value);
    const observed = Date.UTC(value("year"), value("month") - 1, value("day"), value("hour"), value("minute"), value("second"));
    guess = target - (observed - guess);
  }

  return new Date(guess);
}

function localDayBounds(now: Date, timeZone: string) {
  const today = dateKey(now, timeZone);
  return {
    today,
    start: localDateTimeToUtc(today, timeZone),
    end: localDateTimeToUtc(addDays(today, 1), timeZone)
  };
}

function amountFromCents(cents: bigint | number) {
  const amount = BigInt(cents);
  const whole = amount / 100n;
  const fraction = String(amount % 100n).padStart(2, "0");
  return `${whole}.${fraction}`;
}

function centsFromAmount(amount: number) {
  return BigInt(Math.round(amount * 100));
}

export async function getDashboardTimeZone() {
  const settings = await prisma.systemSetting.findFirst({
    select: { timezone: true }
  });
  const timeZone = settings?.timezone?.trim() || "Asia/Manila";

  try {
    new Intl.DateTimeFormat("en-US", { timeZone }).format();
    return timeZone;
  } catch {
    return "Asia/Manila";
  }
}

export async function getDashboardSummary(now = new Date()) {
  const timeZone = await getDashboardTimeZone();
  const bounds = localDayBounds(now, timeZone);
  const [sales, hourly, pendingTable, pendingCatering, pendingPickup, lowStock, upcomingEvents] = await Promise.all([
    prisma.$queryRaw<Array<{ total_cents: bigint; transaction_count: number }>>`
      SELECT COALESCE(SUM(ROUND(total::numeric * 100)::bigint), 0)::bigint AS total_cents,
             COUNT(*)::int AS transaction_count
      FROM pos_transactions
      WHERE status = 'paid' AND created_at >= ${bounds.start} AND created_at < ${bounds.end}
    `,
    prisma.$queryRaw<Array<{ hour: number; total_cents: bigint }>>`
      SELECT EXTRACT(HOUR FROM created_at AT TIME ZONE ${timeZone})::int AS hour,
             COALESCE(SUM(ROUND(total::numeric * 100)::bigint), 0)::bigint AS total_cents
      FROM pos_transactions
      WHERE status = 'paid' AND created_at >= ${bounds.start} AND created_at < ${bounds.end}
      GROUP BY hour
    `,
    prisma.reservation.count({ where: { status: { in: ["pending", "pending_approval"] } } }),
    prisma.cateringReservation.count({ where: { status: { in: ["pending", "pending_approval"] } } }),
    prisma.takeoutOrder.count({ where: { status: "pending_approval" } }),
    getInventoryAlerts(1),
    prisma.cateringReservation.count({
      where: {
        status: { in: ["approved", "confirmed"] },
        OR: [
          { event_date: { gte: bounds.start } },
          { event_date: null, confirmed_date: { gte: bounds.start } }
        ]
      }
    })
  ]);
  const seriesByHour = new Map(hourly.map((item) => [item.hour, item.total_cents]));

  return {
    todaySales: {
      total: amountFromCents(sales[0]?.total_cents ?? 0n),
      transactionCount: Number(sales[0]?.transaction_count ?? 0),
      series: Array.from({ length: 24 }, (_, hour) => ({
        hour,
        total: amountFromCents(seriesByHour.get(hour) ?? 0n)
      }))
    },
    pendingApprovals: pendingTable + pendingCatering + pendingPickup,
    lowStockCount: lowStock.total,
    upcomingEvents
  };
}

export async function getRecentDashboardSales(limit: number) {
  // Recent sales include only paid POS transactions; pending and refunded transactions are excluded.
  const transactions = await prisma.posTransaction.findMany({
    where: { status: "paid" },
    orderBy: [{ created_at: "desc" }, { id: "desc" }],
    take: limit,
    select: { id: true, transaction_number: true, total: true, created_at: true }
  });

  return transactions.map((transaction) => ({
    id: transaction.id,
    orderNumber: transaction.transaction_number,
    total: amountFromCents(centsFromAmount(transaction.total)),
    completedAt: transaction.created_at
  }));
}

export async function getInventoryAlerts(limit: number) {
  // Available stock is on-hand minus active reservations; alerts are below par and critical at zero or 25% of par.
  const timeZone = await getDashboardTimeZone();
  const todayStart = localDayBounds(new Date(), timeZone).start;
  const rows = await prisma.$queryRaw<Array<{
    id: string;
    name: string;
    unit: string;
    quantity_left: bigint;
    par_level: bigint;
    percent_of_par: number;
    total_count: bigint;
  }>>`
    WITH active_locks AS (
      SELECT lock.raw_material_id, lock.reserved_quantity
      FROM catering_ingredient_locks lock
      JOIN catering_reservations booking ON booking.id = lock.catering_reservation_id
      WHERE lock.is_released = false
        AND LOWER(COALESCE(booking.status, '')) = ANY(${HOLDING_STATUSES})
        AND (booking.event_date IS NULL OR booking.event_date >= ${todayStart})
      UNION ALL
      SELECT lock.raw_material_id, lock.reserved_quantity
      FROM reservation_ingredient_locks lock
      JOIN reservations booking ON booking.id = lock.reservation_id
      WHERE lock.is_released = false
        AND LOWER(booking.status) = ANY(${HOLDING_STATUSES})
        AND booking.date >= ${todayStart}
      UNION ALL
      SELECT lock.raw_material_id, lock.reserved_quantity
      FROM takeout_ingredient_locks lock
      JOIN takeout_orders booking ON booking.id = lock.order_id
      WHERE lock.is_released = false
        AND booking.status = ANY(ARRAY['pending_payment', 'payment_failed', 'pending_approval', 'confirmed', 'preparing', 'ready'])
        AND (booking.payment_plan = 'pay_at_pickup' OR booking.payment_status = 'paid' OR booking.payment_expires_at > NOW())
      UNION ALL
      SELECT lock.raw_material_id, lock.reserved_quantity
      FROM dine_in_ingredient_locks lock
      JOIN dining_orders booking ON booking.id = lock.order_id
      WHERE lock.is_released = false AND booking.status = ANY(ARRAY['reserved', 'prepared', 'ready'])
    ),
    reserved AS (
      SELECT raw_material_id, SUM(reserved_quantity)::bigint AS reserved_quantity
      FROM active_locks
      GROUP BY raw_material_id
    ),
    low_stock AS (
      SELECT material.id, material.name, material.unit,
             (material.current_stock - COALESCE(reserved.reserved_quantity, 0))::bigint AS quantity_left,
             material.reorder_level AS par_level,
             CASE WHEN material.reorder_level <= 0 THEN 100
                  ELSE FLOOR(GREATEST(material.current_stock - COALESCE(reserved.reserved_quantity, 0), 0) * 100.0 / material.reorder_level)::int
             END AS percent_of_par
      FROM raw_materials material
      LEFT JOIN reserved ON reserved.raw_material_id = material.id
      WHERE material.is_deleted = false
        AND material.reorder_level > 0
        AND material.current_stock - COALESCE(reserved.reserved_quantity, 0) < material.reorder_level
    )
    SELECT *, COUNT(*) OVER()::bigint AS total_count
    FROM low_stock
    ORDER BY quantity_left ASC, name ASC
    LIMIT ${limit}
  `;

  const total = Number(rows[0]?.total_count ?? 0n);
  return {
    total,
    items: rows.map((row) => ({
      id: row.id,
      name: row.name,
      unit: row.unit,
      quantityLeft: Number(row.quantity_left),
      parLevel: Number(row.par_level),
      severity: getDashboardStockSeverity(Number(row.quantity_left), row.percent_of_par),
      percentOfPar: row.percent_of_par
    }))
  };
}

export async function getDashboardReminders(
  days: number,
  limit: number,
  allowedTypes: Array<"table" | "catering"> = ["table", "catering"]
) {
  // Reminders are approved table and catering bookings from now through the requested business-local day range.
  const timeZone = await getDashboardTimeZone();
  const now = new Date();
  const start = localDayBounds(now, timeZone).start;
  const end = localDateTimeToUtc(addDays(dateKey(now, timeZone), days), timeZone);
  const reminderHasNotPassed = (date: Date, time: string | null) => {
    const [hour, minute] = (time ?? "00:00").split(":").map(Number);
    return localDateTimeToUtc(dateKey(date, timeZone), timeZone, hour, minute).getTime() >= now.getTime();
  };
  const [tables, catering] = await Promise.all([
    allowedTypes.includes("table") ? prisma.reservation.findMany({
      where: { status: { in: ["confirmed", "approved"] }, date: { gte: start, lt: end } },
      orderBy: [{ date: "asc" }, { time: "asc" }],
      take: limit,
      select: { id: true, booking_id: true, customer_name: true, date: true, time: true, party_size: true }
    }) : Promise.resolve([]),
    allowedTypes.includes("catering") ? prisma.cateringReservation.findMany({
      where: {
        status: { in: ["confirmed", "approved"] },
        OR: [
          { event_date: { gte: start, lt: end } },
          { event_date: null, confirmed_date: { gte: start, lt: end } }
        ]
      },
      orderBy: [{ event_date: "asc" }, { confirmed_date: "asc" }],
      take: limit,
      select: {
        id: true,
        reservation_id: true,
        customer_name: true,
        headcount: true,
        event_date: true,
        confirmed_date: true,
        event_time: true,
        package: { select: { name: true } }
      }
    }) : Promise.resolve([])
  ]);

  return [
    ...tables.map((booking) => ({
      id: booking.id,
      type: "table" as const,
      reference: booking.booking_id,
      customerName: booking.customer_name,
      date: booking.date,
      time: booking.time,
      details: `${booking.party_size} guests`
    })),
    ...catering.map((booking) => ({
      id: booking.id,
      type: "catering" as const,
      reference: booking.reservation_id ?? booking.id,
      customerName: booking.customer_name ?? "Customer",
      date: booking.event_date ?? booking.confirmed_date ?? start,
      time: booking.event_time,
      details: [booking.package?.name, booking.headcount ? `${booking.headcount} guests` : null].filter(Boolean).join(" · ")
    }))
  ]
    .filter((item) => reminderHasNotPassed(item.date, item.time))
    .sort((first, second) => first.date.getTime() - second.date.getTime() || (first.time ?? "").localeCompare(second.time ?? ""))
    .slice(0, limit);
}

export async function getDashboardFeedback(limit: number) {
  // Feedback is ordered newest first and bounded by the validated route limit.
  return prisma.customerFeedback.findMany({
    orderBy: [{ created_at: "desc" }, { id: "desc" }],
    take: limit,
    select: { id: true, feedback_id: true, customer_name: true, visit_type: true, rating: true, message: true, created_at: true }
  });
}

export async function getDashboardCalendar(month: string) {
  // Calendar dates are the business-local dates of approved or confirmed table and catering bookings.
  const timeZone = await getDashboardTimeZone();
  const [year, monthNumber] = month.split("-").map(Number);
  const firstDay = `${month}-01`;
  const nextMonth = monthNumber === 12
    ? `${year + 1}-01-01`
    : `${year}-${String(monthNumber + 1).padStart(2, "0")}-01`;
  const start = localDateTimeToUtc(firstDay, timeZone);
  const end = localDateTimeToUtc(nextMonth, timeZone);
  const dates = await prisma.$queryRaw<Array<{ date: string }>>`
    SELECT DISTINCT date_key AS date
    FROM (
      SELECT TO_CHAR(date AT TIME ZONE 'UTC' AT TIME ZONE ${timeZone}, 'YYYY-MM-DD') AS date_key
      FROM reservations
      WHERE status IN ('confirmed', 'approved') AND date >= ${start} AND date < ${end}
      UNION ALL
      SELECT TO_CHAR(COALESCE(event_date, confirmed_date) AT TIME ZONE 'UTC' AT TIME ZONE ${timeZone}, 'YYYY-MM-DD') AS date_key
      FROM catering_reservations
      WHERE status IN ('confirmed', 'approved')
        AND COALESCE(event_date, confirmed_date) >= ${start}
        AND COALESCE(event_date, confirmed_date) < ${end}
    ) approved_bookings
    ORDER BY date_key
  `;
  return dates.map((entry) => entry.date);
}

export async function getDashboardNotifications(
  limit: number,
  allowedTypes: DashboardNotification["type"][] = ["table", "catering", "pickup"]
): Promise<{ total: number; items: DashboardNotification[] }> {
  const includeTables = allowedTypes.includes("table");
  const includeCatering = allowedTypes.includes("catering");
  const includePickup = allowedTypes.includes("pickup");
  const [tables, catering, pickup, tableCount, cateringCount, pickupCount] = await Promise.all([
    includeTables ? prisma.reservation.findMany({
      where: { status: { in: ["pending", "pending_approval"] } },
      orderBy: [{ created_at: "desc" }, { id: "desc" }],
      take: limit,
      select: { id: true, booking_id: true, customer_name: true, date: true, time: true, party_size: true, status: true, created_at: true }
    }) : Promise.resolve([]),
    includeCatering ? prisma.cateringReservation.findMany({
      where: { status: { in: ["pending", "pending_approval"] } },
      orderBy: [{ created_at: "desc" }, { id: "desc" }],
      take: limit,
      select: {
        id: true, reservation_id: true, customer_name: true, event_date: true, event_time: true,
        headcount: true, status: true, created_at: true, package: { select: { name: true } }
      }
    }) : Promise.resolve([]),
    includePickup ? prisma.takeoutOrder.findMany({
      where: { status: "pending_approval" },
      orderBy: [{ created_at: "desc" }, { id: "desc" }],
      take: limit,
      include: { items: { orderBy: { created_at: "asc" }, select: { name_snapshot: true, quantity: true } } }
    }) : Promise.resolve([]),
    includeTables ? prisma.reservation.count({ where: { status: { in: ["pending", "pending_approval"] } } }) : Promise.resolve(0),
    includeCatering ? prisma.cateringReservation.count({ where: { status: { in: ["pending", "pending_approval"] } } }) : Promise.resolve(0),
    includePickup ? prisma.takeoutOrder.count({ where: { status: "pending_approval" } }) : Promise.resolve(0)
  ]);

  const items: DashboardNotification[] = [
    ...tables.map((booking) => ({
      id: booking.id,
      type: "table" as const,
      reference: booking.booking_id,
      customerName: booking.customer_name,
      date: booking.date,
      time: booking.time,
      status: booking.status,
      details: `${booking.party_size} guests`,
      createdAt: booking.created_at
    })),
    ...catering.map((booking) => ({
      id: booking.id,
      type: "catering" as const,
      reference: booking.reservation_id ?? booking.id,
      customerName: booking.customer_name ?? "Customer",
      date: booking.event_date ?? booking.created_at,
      time: booking.event_time,
      status: booking.status ?? "pending_approval",
      details: [booking.package?.name, booking.headcount ? `${booking.headcount} guests` : null].filter(Boolean).join(" · "),
      createdAt: booking.created_at
    })),
    ...pickup.map((booking) => ({
      id: booking.order_number,
      type: "pickup" as const,
      reference: booking.order_number,
      customerName: booking.customer_name,
      date: booking.created_at,
      time: null,
      status: booking.status,
      details: booking.items.map((item) => `${item.quantity} × ${item.name_snapshot}`).join(", "),
      createdAt: booking.created_at
    }))
  ].sort((first, second) => second.createdAt.getTime() - first.createdAt.getTime());

  return { total: tableCount + cateringCount + pickupCount, items: items.slice(0, limit) };
}

import { randomUUID } from "crypto";
import express, { NextFunction, Request, Response } from "express";
import { Prisma } from "@prisma/client";
import { z } from "zod";
import { prisma } from "../lib/prisma";
import { getBeverageStockMaterialName } from "../lib/beverageStock";
import { normalizeTableStatus } from "../services/tableStatus.service";
import {
  assertCanArchiveTable,
  assertCanChangeTableAvailability,
  assertCanEditTableSeats,
  assertCanLinkUnavailableTable,
  getNextTableNumber,
  type ManagedTableState
} from "../services/tableManagement.service";
import { roleGuard, ROLES } from "../middleware/roleGuard";
import { isDineInReservationLateAlert } from "../config/reservationSettings";
import {
  consumeMaterialStock,
  inventoryUnitsMatch,
  getActiveCateringReservationQuantity,
  lockMaterialForUpdate,
  recordReservationMovement,
  InventoryError
} from "../services/inventory.service";

const router = express.Router();
const COMMITTED_ORDER_STATUS_CHECK =
  "CHECK ((status = ANY (ARRAY['reserved'::text, 'prepared'::text, 'ready'::text, 'released'::text, 'cancelled'::text, 'committed'::text])))";
const COMMITTED_ORDER_STATUS_CACHE_MS = 5000;
const money = (amount: number) => Number(amount.toFixed(2));
type AuthenticatedRequest = Request & { user?: { sub: string } };
let committedOrderStatusCache: { allowed: boolean; expiresAt: number } | null = null;

function actorId(req: Request) {
  const user = (req as AuthenticatedRequest).user;
  if (!user?.sub) throw new Error("Authenticated staff identity is missing.");
  return user.sub;
}

function asyncRoute(
  handler: (req: Request, res: Response, next: NextFunction) => Promise<unknown>
) {
  return (req: Request, res: Response, next: NextFunction) => {
    void handler(req, res, next).catch(next);
  };
}

function makeReference(prefix: string) {
  const date = new Date().toISOString().slice(0, 10).replace(/-/g, "");
  return `${prefix}-${date}-${randomUUID().slice(0, 8).toUpperCase()}`;
}

async function isCommittedOrderStatusAllowed() {
  if (committedOrderStatusCache && committedOrderStatusCache.expiresAt > Date.now()) {
    return committedOrderStatusCache.allowed;
  }

  const [constraint] = await prisma.$queryRaw<Array<{ allowed: boolean }>>`
    SELECT EXISTS (
      SELECT 1
      FROM pg_constraint AS c
      WHERE c.conrelid = to_regclass('public.dining_orders')
        AND c.conname = 'dining_orders_status_check'
        AND c.contype = 'c'
        AND c.convalidated
        AND pg_get_constraintdef(c.oid) = ${COMMITTED_ORDER_STATUS_CHECK}
    ) AS allowed
  `;
  const allowed = constraint?.allowed ?? false;
  committedOrderStatusCache = {
    allowed,
    expiresAt: Date.now() + COMMITTED_ORDER_STATUS_CACHE_MS
  };
  return allowed;
}

function isSameOrderRequest(
  order: {
    dining_session_id: string;
    order_type: string;
    unlimited_session_id: string | null;
    items: Array<{
      selling_product_id: string | null;
      guest: { guest_number: number } | null;
      quantity: number;
      unit_price: number;
    }>;
  },
  input: {
    orderType: string;
    unlimitedSessionId?: string;
    items: Array<{ productId: string; guestNumber?: number; quantity: number; expectedUnitPrice: number }>;
  },
  sessionId: string
) {
  const requested = input.items.map((item) =>
    `${item.productId}:${item.guestNumber ?? ""}:${item.quantity}:${money(item.expectedUnitPrice)}`
  ).sort();
  const saved = order.items.map((item) =>
    `${item.selling_product_id ?? ""}:${item.guest?.guest_number ?? ""}:${item.quantity}:${money(Number(item.unit_price))}`
  ).sort();
  return order.dining_session_id === sessionId
    && order.order_type === input.orderType
    && order.unlimited_session_id === (input.unlimitedSessionId ?? null)
    && requested.length === saved.length
    && requested.every((item, index) => item === saved[index]);
}

async function getDiningSession(tx: Prisma.TransactionClient, sessionId: string) {
  return tx.diningTableSession.findUnique({
    where: { id: sessionId },
    include: {
      table: true,
      guests: { orderBy: { guest_number: "asc" } },
      orders: {
        include: {
          items: { include: { guest: true } },
          ingredient_locks: true
        },
        orderBy: { created_at: "asc" }
      },
      unlimited_sessions: {
        include: {
          leftover_items: { include: { selling_product: true } },
          extensions: { orderBy: { created_at: "asc" } }
        },
        orderBy: { created_at: "asc" }
      }
    }
  });
}

function getCommittedTableNumberSnapshot(session: NonNullable<Awaited<ReturnType<typeof getDiningSession>>>) {
  return session.orders.find((order) =>
    order.order_type === "ala_carte"
    && order.status === "committed"
    && order.table_number_snapshot !== null
  )?.table_number_snapshot ?? null;
}

async function lockTablesInStableOrder(tx: Prisma.TransactionClient) {
  await tx.$queryRaw<Array<{ id: string }>>`
    SELECT id FROM tables ORDER BY id FOR UPDATE
  `;
}

async function getManagedTable(tx: Prisma.TransactionClient, tableId: string) {
  return tx.table.findUnique({
    where: { id: tableId },
    include: {
      dining_sessions: {
        where: { status: "active" },
        take: 1,
        include: { guests: { select: { id: true } } }
      },
      linked_tables: {
        where: { is_archived: false },
        take: 1,
        select: { id: true }
      }
    }
  });
}

function getManagedTableState(table: NonNullable<Awaited<ReturnType<typeof getManagedTable>>>): ManagedTableState {
  const activeSession = table.dining_sessions[0];
  return {
    id: table.id,
    status: table.status,
    is_archived: table.is_archived,
    linked_to_table_id: table.linked_to_table_id,
    has_active_session: Boolean(activeSession),
    has_linked_tables: table.linked_tables.length > 0,
    has_seated_customer: (activeSession?.guests.length ?? 0) > 0
  };
}

async function findInventoryNeeds(
  tx: Prisma.TransactionClient,
  items: Array<{ productId: string; quantity: number }>,
  products: Array<{
    id: string;
    name: string;
    category: string;
    recipes: Array<{
      recipe_ingredients: Array<{
        quantity_per_yield: bigint;
        unit: string;
        raw_material: { id: string; name: string; unit: string };
      }>;
    }>;
  }>
) {
  const needs = new Map<string, { raw_material_id: string; material_name: string; quantity: number; unit: string }>();
  const productsById = new Map(products.map((product) => [product.id, product]));

  for (const item of items) {
    const product = productsById.get(item.productId);
    if (!product) {
      throw new InventoryError("A selected product is no longer available.", "PRODUCT_NOT_FOUND", 409);
    }
    const ingredients = product.recipes[0]?.recipe_ingredients ?? [];
    if (ingredients.length === 0 && product.category.trim().toLowerCase() === "beverage") {
      const material = await tx.rawMaterial.findFirst({
        where: { name: getBeverageStockMaterialName(product.name), is_deleted: false },
        select: { id: true, name: true, unit: true }
      });
      if (!material) {
        throw new InventoryError(`${product.name} has no linked inventory ingredient.`, "RECIPE_MISSING", 409);
      }
      const current = needs.get(material.id);
      needs.set(material.id, {
        raw_material_id: material.id,
        material_name: material.name,
        quantity: (current?.quantity ?? 0) + item.quantity,
        unit: material.unit
      });
      continue;
    }
    if (ingredients.length === 0) {
      throw new InventoryError(
        `${product.name} has no inventory recipe and cannot be reserved until its ingredients are linked.`,
        "RECIPE_MISSING",
        409
      );
    }

    for (const ingredient of ingredients) {
      const material = ingredient.raw_material;
      if (!inventoryUnitsMatch(ingredient.unit, material.unit)) {
        throw new InventoryError(
          `${product.name} recipe unit for ${material.name} does not match its stock unit.`,
          "UNIT_MISMATCH",
          409
        );
      }
      const quantity = Number(ingredient.quantity_per_yield) * item.quantity;
      const current = needs.get(material.id);
      needs.set(material.id, {
        raw_material_id: material.id,
        material_name: material.name,
        quantity: (current?.quantity ?? 0) + quantity,
        unit: material.unit
      });
    }
  }

  return Array.from(needs.values()).sort((a, b) => a.raw_material_id.localeCompare(b.raw_material_id));
}

async function buildCheckout(session: NonNullable<Awaited<ReturnType<typeof getDiningSession>>>) {
  const unfinishedOrders = session.orders.filter((order) =>
    !["committed", "released", "cancelled"].includes(order.status)
  );
  if (unfinishedOrders.length > 0) {
    throw new InventoryError(
      "Legacy kitchen tickets (reserved, prepared, or ready) must be released or cancelled before bill-out.",
      "ORDERS_NOT_COMPLETE",
      409
    );
  }
  const activeUnlimitedSessions = session.unlimited_sessions.filter((unlimited) => unlimited.status === "active");
  if (activeUnlimitedSessions.length > 0) {
    throw new InventoryError("End every Unlimited package before table checkout.", "UNLIMITED_SESSION_ACTIVE", 409);
  }

  const aLaCarteItems = session.orders
    .filter((order) =>
      order.order_type === "ala_carte"
      && ["committed", "released"].includes(order.status)
    )
    .flatMap((order) => order.items);
  const aLaCarteAmount = aLaCarteItems.reduce((total, item) => total + Number(item.total_price), 0);
  const unlimitedPackages = session.unlimited_sessions
    .filter((unlimited) => unlimited.status === "completed")
    .map((unlimited) => ({
      session_id: unlimited.id,
      covers: unlimited.pax_count,
      price_per_cover: Number(unlimited.price_per_pax),
      total: money(unlimited.pax_count * Number(unlimited.price_per_pax))
    }));
  const unlimitedAmount = unlimitedPackages.reduce((total, item) => total + item.total, 0);
  const leftoverLines = session.unlimited_sessions.flatMap((unlimited) =>
    unlimited.leftover_items.map((item) => ({
      name: `Unlimited leftovers - ${item.selling_product.name}`,
      quantity: item.quantity,
      total: Number(item.charge_amount)
    }))
  );
  const leftoverAmount = leftoverLines.reduce((total, item) => total + item.total, 0);
  const subtotal = money(aLaCarteAmount + unlimitedAmount + leftoverAmount);
  const guestCount = session.guests.length;
  const discountedGuestCount = session.guests.filter((guest) => guest.discount_type !== "none").length;
  const perGuestShare = guestCount > 0 ? money(subtotal / guestCount) : 0;
  const discountAmount = money(perGuestShare * discountedGuestCount);
  const total = money(Math.max(0, subtotal - discountAmount));

  return {
    aLaCarteItems,
    aLaCarteAmount: money(aLaCarteAmount),
    unlimitedPackages,
    unlimitedAmount: money(unlimitedAmount),
    leftoverLines,
    leftoverAmount: money(leftoverAmount),
    subtotal,
    guestCount,
    discountedGuestCount,
    perGuestShare,
    discountAmount,
    total
  };
}

router.get(
  "/api/pos/dining/tables",
  roleGuard(["admin", "cashier"]),
  asyncRoute(async (_req, res) => {
    const tables = await prisma.table.findMany({
      where: { is_archived: false },
      orderBy: { table_number: "asc" },
      include: {
        dining_sessions: {
          where: { status: "active" },
          take: 1,
          include: { guests: { orderBy: { guest_number: "asc" } } }
        }
      }
    });
    return res.json({
      tables: tables.map((table) => ({
        id: table.id,
        table_number: table.table_number,
        capacity: table.capacity,
        status: normalizeTableStatus(table.status),
        linked_to_table_id: table.linked_to_table_id,
        unavailable_reason: table.unavailable_reason,
        active_session: table.dining_sessions[0] ?? null
      }))
    });
  })
);

router.get(
  "/api/pos/dining/upcoming-reservations",
  roleGuard(["admin", "cashier"]),
  asyncRoute(async (_req, res) => {
    const today = new Intl.DateTimeFormat("en-CA", {
      timeZone: "Asia/Manila",
      year: "numeric",
      month: "2-digit",
      day: "2-digit"
    }).format(new Date());
    const dayStart = new Date(`${today}T00:00:00+08:00`);
    const nextDayStart = new Date(dayStart.getTime() + 24 * 60 * 60 * 1000);
    const reservations = await prisma.reservation.findMany({
      where: {
        date: { gte: dayStart, lt: nextDayStart },
        status: { in: ["confirmed", "seated", "preparing", "in_progress", "pending_final_payment"] },
        table_assignments: { some: { status: { in: ["assigned", "seated"] } } }
      },
      select: {
        id: true,
        customer_name: true,
        date: true,
        time: true,
        party_size: true,
        status: true,
        activity: {
          where: { event_type: "late_arrival_still_coming" },
          select: { id: true },
          take: 1
        },
        table_assignments: {
          where: { status: { in: ["assigned", "seated"] } },
          orderBy: { table: { table_number: "asc" } },
          select: { table: { select: { table_number: true, is_temporary: true } } }
        }
      },
      orderBy: [{ time: "asc" }, { id: "asc" }]
    });

    return res.json({
      reservations: reservations.map((reservation) => {
        const arrived = ["seated", "preparing", "in_progress", "pending_final_payment"].includes(reservation.status);
        const lateAlert = isDineInReservationLateAlert(
          reservation.date,
          reservation.time,
          reservation.status,
          reservation.activity.length > 0
        );
        return {
          id: reservation.id,
          time: reservation.time,
          customer_name: reservation.customer_name,
          party_size: reservation.party_size,
          table_numbers: reservation.table_assignments
            .filter((assignment) => !assignment.table.is_temporary)
            .map((assignment) => assignment.table.table_number),
          temporary_table_numbers: reservation.table_assignments
            .filter((assignment) => assignment.table.is_temporary)
            .map((assignment) => assignment.table.table_number),
          state: arrived ? "arrived" as const : lateAlert ? "late" as const : "upcoming" as const
        };
      })
    });
  })
);

router.post(
  "/api/pos/dining/reservations/:id/temporary-table",
  roleGuard(["admin", "cashier"]),
  asyncRoute(async (req, res) => {
    const reservationId = z.string().min(1).parse(req.params.id);
    const cashierId = actorId(req);
    const result = await prisma.$transaction(async (tx) => {
      await lockTablesInStableOrder(tx);
      await tx.$queryRaw<Array<{ id: string }>>`
        SELECT id FROM reservations WHERE id = ${reservationId} FOR UPDATE
      `;

      const reservation = await tx.reservation.findUnique({
        where: { id: reservationId },
        include: {
          table_assignments: {
            where: { status: "assigned" },
            orderBy: [{ table: { table_number: "asc" } }, { table_id: "asc" }],
            include: {
              table: {
                include: {
                  dining_sessions: {
                    where: { status: "active" },
                    take: 1,
                    select: { id: true }
                  }
                }
              }
            }
          }
        }
      });

      if (!reservation) {
        throw new InventoryError("Reservation not found.", "BOOKING_NOT_FOUND", 404);
      }
      if (!["confirmed", "approved"].includes(reservation.status)) {
        throw new InventoryError(
          reservation.status === "seated"
            ? "This reservation has already been seated."
            : `This reservation cannot use a temporary table while it is ${reservation.status}.`,
          "BOOKING_NOT_READY_TO_SEAT",
          409
        );
      }
      const today = new Intl.DateTimeFormat("en-CA", {
        timeZone: "Asia/Manila",
        year: "numeric",
        month: "2-digit",
        day: "2-digit"
      }).format(new Date());
      const reservationDate = new Intl.DateTimeFormat("en-CA", {
        timeZone: "Asia/Manila",
        year: "numeric",
        month: "2-digit",
        day: "2-digit"
      }).format(reservation.date);
      if (reservationDate !== today) {
        throw new InventoryError(
          "Only today's reservations can use a temporary table from the POS.",
          "BOOKING_NOT_TODAY",
          409
        );
      }

      const assignments = reservation.table_assignments;
      if (assignments.length === 0) {
        throw new InventoryError(
          "This reservation has no active table assignments.",
          "BOOKING_TABLE_ASSIGNMENTS_MISSING",
          409
        );
      }
      const blockedAssignments = assignments.filter(({ table }) =>
        table.is_archived ||
        normalizeTableStatus(table.status) !== "available" ||
        Boolean(table.linked_to_table_id) ||
        table.dining_sessions.length > 0
      );
      if (blockedAssignments.length === 0) {
        throw new InventoryError(
          "The assigned tables are available. Seat this reservation at its assigned table instead.",
          "RESERVATION_TABLES_AVAILABLE",
          409
        );
      }

      const releasedAssignments = await tx.reservationTableAssignment.updateMany({
        where: { reservation_id: reservation.id, status: "assigned" },
        data: { status: "released" }
      });
      if (releasedAssignments.count !== assignments.length) {
        throw new InventoryError(
          "The reservation's table assignments changed while creating a temporary table. Refresh and try again.",
          "RESERVATION_ASSIGNMENTS_CHANGED",
          409
        );
      }

      const existingTables = await tx.table.findMany({ select: { table_number: true } });
      const table = await tx.table.create({
        data: {
          table_number: getNextTableNumber(existingTables.map((item) => item.table_number)),
          capacity: reservation.party_size,
          status: "occupied",
          is_temporary: true
        }
      });
      const session = await tx.diningTableSession.create({
        data: { table_id: table.id, cashier_id: cashierId },
        include: { table: true, guests: { orderBy: { guest_number: "asc" } } }
      });
      await tx.reservationTableAssignment.create({
        data: {
          reservation_id: reservation.id,
          table_id: table.id,
          seat_count: reservation.party_size,
          status: "seated"
        }
      });
      await tx.reservation.update({
        where: { id: reservation.id },
        data: { status: "seated" }
      });
      await tx.reservationActivity.create({
        data: {
          reservation_id: reservation.id,
          event_type: "status_changed",
          from_status: reservation.status,
          to_status: "seated",
          actor_type: "staff",
          actor_id: cashierId,
          reason: `Guests seated at temporary table ${table.table_number}`
        }
      });

      return { session, table };
    });
    return res.status(201).json(result);
  })
);

router.post(
  "/api/pos/dining/tables",
  roleGuard(["admin"]),
  asyncRoute(async (req, res) => {
    const body = z.object({ capacity: z.coerce.number().int().min(1).max(100) }).parse(req.body);
    const table = await prisma.$transaction(async (tx) => {
      await lockTablesInStableOrder(tx);
      const existing = await tx.table.findMany({ select: { table_number: true } });
      const tableNumber = getNextTableNumber(existing.map((item) => item.table_number));
      return tx.table.create({
        data: { table_number: tableNumber, capacity: body.capacity, status: "available" }
      });
    });
    return res.status(201).json({ table });
  })
);

router.patch(
  "/api/pos/dining/tables/:id/seats",
  roleGuard(["admin"]),
  asyncRoute(async (req, res) => {
    const tableId = z.string().min(1).parse(req.params.id);
    const body = z.object({ capacity: z.coerce.number().int().min(1).max(100) }).parse(req.body);
    const table = await prisma.$transaction(async (tx) => {
      await lockTablesInStableOrder(tx);
      const current = await getManagedTable(tx, tableId);
      if (!current) throw new InventoryError("Table not found.", "TABLE_NOT_FOUND", 404);
      assertCanEditTableSeats(getManagedTableState(current));
      return tx.table.update({ where: { id: current.id }, data: { capacity: body.capacity } });
    });
    return res.json({ table });
  })
);

router.post(
  "/api/pos/dining/tables/:id/archive",
  roleGuard(["admin"]),
  asyncRoute(async (req, res) => {
    const tableId = z.string().min(1).parse(req.params.id);
    const table = await prisma.$transaction(async (tx) => {
      await lockTablesInStableOrder(tx);
      const current = await getManagedTable(tx, tableId);
      if (!current) throw new InventoryError("Table not found.", "TABLE_NOT_FOUND", 404);
      assertCanArchiveTable(getManagedTableState(current));
      return tx.table.update({
        where: { id: current.id },
        data: { is_archived: true, archived_at: new Date(), status: "unavailable", unavailable_reason: null }
      });
    });
    return res.json({ table });
  })
);

router.patch(
  "/api/pos/dining/tables/:id/availability",
  roleGuard(["admin", "cashier"]),
  asyncRoute(async (req, res) => {
    const tableId = z.string().min(1).parse(req.params.id);
    const body = z.object({
      status: z.enum(["available", "unavailable"]),
      reason: z.preprocess(
        (value) => typeof value === "string" && value.trim() === "" ? null : value,
        z.string().trim().max(120).nullable().optional()
      ),
      linkToTableId: z.string().min(1).nullable().optional()
    }).parse(req.body);
    if (body.status === "available" && body.linkToTableId) {
      throw new InventoryError("A table can be linked only while it is marked unavailable.", "INVALID_TABLE_LINK", 400);
    }
    const table = await prisma.$transaction(async (tx) => {
      await lockTablesInStableOrder(tx);
      const current = await getManagedTable(tx, tableId);
      if (!current) throw new InventoryError("Table not found.", "TABLE_NOT_FOUND", 404);
      const currentState = getManagedTableState(current);

      if (body.linkToTableId) {
        const target = await getManagedTable(tx, body.linkToTableId);
        if (!target) throw new InventoryError("Link target table not found.", "TABLE_NOT_FOUND", 404);
        assertCanLinkUnavailableTable(currentState, getManagedTableState(target));
        return tx.table.update({
          where: { id: current.id },
          data: {
            status: "unavailable",
            linked_to_table_id: target.id,
            unavailable_reason: body.reason ?? null
          }
        });
      }

      assertCanChangeTableAvailability(currentState, body.status);
      return tx.table.update({
        where: { id: current.id },
        data: {
          status: body.status,
          linked_to_table_id: null,
          unavailable_reason: body.status === "unavailable" ? body.reason ?? null : null
        }
      });
    });
    return res.json({ table });
  })
);

router.get(
  "/api/pos/dining/sessions",
  roleGuard(["admin", "cashier"]),
  asyncRoute(async (_req, res) => {
    const sessions = await prisma.diningTableSession.findMany({
      where: { status: "active" },
      include: {
        table: true,
        guests: { orderBy: { guest_number: "asc" } },
        orders: {
          include: { items: { include: { guest: true } } },
          orderBy: { created_at: "desc" }
        },
        unlimited_sessions: {
          include: { extensions: { orderBy: { created_at: "asc" } } },
          orderBy: { created_at: "desc" }
        }
      },
      orderBy: { opened_at: "asc" },
      take: 100
    });
    return res.json({ sessions });
  })
);

router.post(
  "/api/pos/dining/sessions",
  roleGuard(["admin", "cashier"]),
  asyncRoute(async (req, res) => {
    const body = z.object({ tableId: z.string().min(1) }).parse(req.body);
    const cashierId = actorId(req);
    const session = await prisma.$transaction(async (tx) => {
      await lockTablesInStableOrder(tx);
      const table = await tx.table.findUnique({ where: { id: body.tableId } });
      if (!table) throw new InventoryError("Table not found.", "TABLE_NOT_FOUND", 404);
      if (table.is_archived || normalizeTableStatus(table.status) !== "available" || table.linked_to_table_id) {
        throw new InventoryError("Choose a live table marked available.", "TABLE_NOT_AVAILABLE", 409);
      }
      const active = await tx.diningTableSession.findFirst({
        where: { table_id: table.id, status: "active" },
        select: { id: true }
      });
      if (active || normalizeTableStatus(table.status) === "occupied") {
        throw new InventoryError("This table already has an active dining session.", "TABLE_OCCUPIED", 409);
      }
      const created = await tx.diningTableSession.create({
        data: {
          table_id: table.id,
          cashier_id: cashierId
        },
        include: { table: true, guests: { orderBy: { guest_number: "asc" } } }
      });
      await tx.table.update({ where: { id: table.id }, data: { status: "occupied" } });
      return created;
    });
    return res.status(201).json({ session });
  })
);

router.post(
  "/api/pos/dining/reservations/:id/seat",
  roleGuard(["admin", "cashier"]),
  asyncRoute(async (req, res) => {
    const reservationId = z.string().min(1).parse(req.params.id);
    const cashierId = actorId(req);
    const session = await prisma.$transaction(async (tx) => {
      await lockTablesInStableOrder(tx);
      await tx.$queryRaw<Array<{ id: string }>>`
        SELECT id FROM reservations WHERE id = ${reservationId} FOR UPDATE
      `;

      const reservation = await tx.reservation.findUnique({
        where: { id: reservationId },
        include: {
          table_assignments: {
            where: { status: "assigned" },
            orderBy: [{ table: { table_number: "asc" } }, { table_id: "asc" }],
            include: {
              table: {
                include: {
                  dining_sessions: {
                    where: { status: "active" },
                    take: 1,
                    select: { id: true }
                  }
                }
              }
            }
          }
        }
      });

      if (!reservation) {
        throw new InventoryError("Reservation not found.", "BOOKING_NOT_FOUND", 404);
      }
      if (!["confirmed", "approved"].includes(reservation.status)) {
        throw new InventoryError(
          reservation.status === "seated"
            ? "This reservation has already been seated."
            : `This reservation cannot be seated while it is ${reservation.status}.`,
          "BOOKING_NOT_READY_TO_SEAT",
          409
        );
      }
      const today = new Intl.DateTimeFormat("en-CA", {
        timeZone: "Asia/Manila",
        year: "numeric",
        month: "2-digit",
        day: "2-digit"
      }).format(new Date());
      const reservationDate = new Intl.DateTimeFormat("en-CA", {
        timeZone: "Asia/Manila",
        year: "numeric",
        month: "2-digit",
        day: "2-digit"
      }).format(reservation.date);
      if (reservationDate !== today) {
        throw new InventoryError(
          "Only today's reservations can be seated from the POS.",
          "BOOKING_NOT_TODAY",
          409
        );
      }

      const assignments = reservation.table_assignments;
      if (assignments.length === 0) {
        throw new InventoryError(
          "This reservation has no active table assignments.",
          "BOOKING_TABLE_ASSIGNMENTS_MISSING",
          409
        );
      }

      const unavailableTables = assignments.filter(({ table }) =>
        table.is_archived ||
        normalizeTableStatus(table.status) !== "available" ||
        Boolean(table.linked_to_table_id) ||
        table.dining_sessions.length > 0
      );
      if (unavailableTables.length > 0) {
        throw new InventoryError(
          "An assigned table is occupied or unavailable. Offer the customer a temporary table.",
          "RESERVATION_TABLE_UNAVAILABLE",
          409
        );
      }

      const [primaryAssignment, ...linkedAssignments] = assignments;
      const created = await tx.diningTableSession.create({
        data: { table_id: primaryAssignment.table_id, cashier_id: cashierId },
        include: { table: true, guests: { orderBy: { guest_number: "asc" } } }
      });
      await tx.table.update({
        where: { id: primaryAssignment.table_id },
        data: { status: "occupied" }
      });
      for (const assignment of linkedAssignments) {
        await tx.table.update({
          where: { id: assignment.table_id },
          data: {
            status: "unavailable",
            linked_to_table_id: primaryAssignment.table_id,
            unavailable_reason: `Linked to reservation at table ${primaryAssignment.table.table_number}`
          }
        });
      }

      const updatedAssignments = await tx.reservationTableAssignment.updateMany({
        where: { reservation_id: reservation.id, status: "assigned" },
        data: { status: "seated" }
      });
      if (updatedAssignments.count !== assignments.length) {
        throw new InventoryError(
          "The reservation's table assignments changed while seating. Refresh and try again.",
          "RESERVATION_ASSIGNMENTS_CHANGED",
          409
        );
      }

      await tx.reservation.update({
        where: { id: reservation.id },
        data: { status: "seated" }
      });
      await tx.reservationActivity.create({
        data: {
          reservation_id: reservation.id,
          event_type: "status_changed",
          from_status: reservation.status,
          to_status: "seated",
          actor_type: "staff",
          actor_id: cashierId,
          reason: "Guests seated from POS"
        }
      });

      return created;
    });
    return res.status(201).json({ session });
  })
);

router.patch(
  "/api/pos/dining/sessions/:id/table",
  roleGuard(["admin", "cashier"]),
  asyncRoute(async (req, res) => {
    const body = z.object({ tableId: z.string().min(1) }).parse(req.body);
    const sessionId = z.string().min(1).parse(req.params.id);
    const result = await prisma.$transaction(async (tx) => {
      await tx.$queryRaw<Array<{ id: string }>>`
        SELECT id FROM dining_table_sessions WHERE id = ${sessionId} FOR UPDATE
      `;
      const current = await tx.diningTableSession.findUnique({ where: { id: sessionId } });
      if (!current || current.status !== "active") {
        throw new InventoryError("Active dining session not found.", "SESSION_NOT_FOUND", 404);
      }
      if (current.table_id === body.tableId) return current;
      const ids = [current.table_id, body.tableId].sort();
      for (const id of ids) {
        await tx.$queryRaw<Array<{ id: string }>>`SELECT id FROM tables WHERE id = ${id} FOR UPDATE`;
      }
      const destination = await tx.table.findUnique({ where: { id: body.tableId } });
      if (!destination) throw new InventoryError("Destination table not found.", "TABLE_NOT_FOUND", 404);
      if (
        destination.is_archived ||
        destination.linked_to_table_id ||
        normalizeTableStatus(destination.status) !== "available" ||
        await tx.diningTableSession.findFirst({
        where: { table_id: body.tableId, status: "active" },
        select: { id: true }
      })) {
        throw new InventoryError("Destination table is not available.", "TABLE_NOT_AVAILABLE", 409);
      }
      const guestCount = await tx.diningGuest.count({ where: { dining_session_id: current.id } });
      if (guestCount > destination.capacity) {
        throw new InventoryError(`Destination table seats up to ${destination.capacity} guests.`, "TABLE_CAPACITY_EXCEEDED", 409);
      }
      const moved = await tx.diningTableSession.update({
        where: { id: current.id },
        data: { table_id: destination.id },
        include: { table: true, guests: { orderBy: { guest_number: "asc" } } }
      });
      await tx.unlimitedSession.updateMany({
        where: { dining_session_id: current.id, status: "active" },
        data: { table_id: destination.id }
      });
      await tx.table.update({ where: { id: current.table_id }, data: { status: "available" } });
      await tx.table.update({ where: { id: destination.id }, data: { status: "occupied" } });
      return moved;
    });
    return res.json({ session: result });
  })
);

router.patch(
  "/api/pos/dining/sessions/:id/guests/:guestId",
  roleGuard(["admin", "cashier"]),
  asyncRoute(async (req, res) => {
    const body = z.object({ discountType: z.enum(["none", "senior", "pwd"]) }).parse(req.body);
    const sessionId = z.string().min(1).parse(req.params.id);
    const guestId = z.string().min(1).parse(req.params.guestId);
    const guest = await prisma.$transaction(async (tx) => {
      const session = await tx.diningTableSession.findUnique({ where: { id: sessionId } });
      if (!session || session.status !== "active") {
        throw new InventoryError("Active dining session not found.", "SESSION_NOT_FOUND", 404);
      }
      const updated = await tx.diningGuest.updateMany({
        where: { id: guestId, dining_session_id: sessionId },
        data: { discount_type: body.discountType }
      });
      if (updated.count === 0) throw new InventoryError("Guest number not found.", "GUEST_NOT_FOUND", 404);
      return tx.diningGuest.findUnique({ where: { id: guestId } });
    });
    return res.json({ guest });
  })
);

router.get(
  "/api/pos/dining/orders/:id",
  roleGuard(["admin", "cashier"]),
  asyncRoute(async (req, res) => {
    const orderId = z.string().min(1).parse(req.params.id);
    const order = await prisma.diningOrder.findFirst({
      where: { id: orderId, status: "committed" },
      select: {
        id: true,
        order_number: true,
        table_number_snapshot: true,
        created_at: true,
        items: {
          select: {
            id: true,
            name_snapshot: true,
            quantity: true,
            unit_price: true,
            total_price: true
          },
          orderBy: { id: "asc" }
        }
      }
    });
    if (!order) {
      throw new InventoryError("Committed dine-in order not found.", "ORDER_NOT_FOUND", 404);
    }
    return res.json({ order });
  })
);

router.post(
  "/api/pos/dining/sessions/:id/orders",
  roleGuard(["admin", "cashier"]),
  asyncRoute(async (req, res) => {
    const body = z.object({
      idempotencyKey: z.string().min(16).max(128),
      orderType: z.enum(["ala_carte", "unlimited"]),
      unlimitedSessionId: z.string().min(1).optional(),
      items: z.array(z.object({
        productId: z.string().min(1),
        guestNumber: z.coerce.number().int().positive().optional(),
        quantity: z.coerce.number().int().min(1).max(100),
        expectedUnitPrice: z.coerce.number().finite().min(0).refine(
          (value) => Math.abs(value * 100 - Math.round(value * 100)) < 1e-8,
          "Expected unit price must be in cents."
        )
      })).min(1).max(100)
    }).superRefine((value, context) => {
      if (value.orderType === "unlimited" && !value.unlimitedSessionId) {
        context.addIssue({ code: z.ZodIssueCode.custom, path: ["unlimitedSessionId"], message: "Choose an active Unlimited package." });
      }
      if (value.orderType === "ala_carte" && value.unlimitedSessionId) {
        context.addIssue({ code: z.ZodIssueCode.custom, path: ["unlimitedSessionId"], message: "A la carte tickets cannot use an Unlimited package." });
      }
    }).parse(req.body);
    if (body.orderType !== "ala_carte") {
      throw new InventoryError("Unlimited order commits are not available yet.", "ORDER_TYPE_NOT_ENABLED", 409);
    }
    if (!(await isCommittedOrderStatusAllowed())) {
      throw new InventoryError(
        "Order commit is not available until the pending database migration is deployed",
        "ORDER_COMMIT_MIGRATION_PENDING",
        503
      );
    }
    const sessionId = z.string().min(1).parse(req.params.id);
    const creatorId = actorId(req);
    const existing = await prisma.diningOrder.findUnique({
      where: { idempotency_key: body.idempotencyKey },
      include: { items: { include: { guest: true } } }
    });
    if (existing) {
      if (!isSameOrderRequest(existing, body, sessionId)) {
        throw new InventoryError("This order key is already tied to a different order.", "IDEMPOTENCY_CONFLICT", 409);
      }
      return res.json({ order: existing, replayed: true });
    }

    const orderNumber = makeReference("DIN");
    try {
      const result = await prisma.$transaction(async (tx) => {
        await tx.$queryRaw<Array<{ id: string }>>`
          SELECT id FROM dining_table_sessions WHERE id = ${sessionId} FOR UPDATE
        `;
        const session = await tx.diningTableSession.findUnique({
          where: { id: sessionId },
          include: { table: true, guests: true }
        });
        if (!session || session.status !== "active") {
          throw new InventoryError("Active dining session not found.", "SESSION_NOT_FOUND", 404);
        }

        const racedOrder = await tx.diningOrder.findUnique({
          where: { idempotency_key: body.idempotencyKey },
          include: { items: { include: { guest: true } } }
        });
        if (racedOrder) {
          if (!isSameOrderRequest(racedOrder, body, sessionId)) {
            throw new InventoryError("This order key is already tied to a different order.", "IDEMPOTENCY_CONFLICT", 409);
          }
          return { order: racedOrder, replayed: true };
        }

        const guestByNumber = new Map(session.guests.map((guest) => [guest.guest_number, guest]));
        if (body.items.some((item) => item.guestNumber !== undefined && !guestByNumber.has(item.guestNumber))) {
          throw new InventoryError("Choose a valid customer number for every item.", "GUEST_NOT_FOUND", 400);
        }

        const products = await tx.sellingProduct.findMany({
          where: {
            id: { in: body.items.map((item) => item.productId) },
            is_deleted: false
          },
          include: { recipes: { include: { recipe_ingredients: { include: { raw_material: true } } } } }
        });
        const productsById = new Map(products.map((product) => [product.id, product]));
        for (const item of body.items) {
          const product = productsById.get(item.productId);
          if (!product || !product.is_available) {
            throw new InventoryError("A selected product is unavailable.", "PRODUCT_UNAVAILABLE", 409);
          }
          if (!product.is_sold_a_la_carte) {
            throw new InventoryError(`${product.name} is only available in the Unlimited cart.`, "PRODUCT_NOT_SOLD_A_LA_CARTE", 409);
          }
          if (money(Number(product.price)) !== money(item.expectedUnitPrice)) {
            throw new InventoryError(
              `${product.name}'s price has changed. Review the order again before confirming.`,
              "PRODUCT_PRICE_CHANGED",
              409
            );
          }
        }

        const requestedForInventory = body.items.map((item) => ({
          productId: item.productId,
          quantity: item.quantity
        }));
        const needs = await findInventoryNeeds(tx, requestedForInventory, products);

        const created = await tx.diningOrder.create({
          data: {
            order_number: orderNumber,
            idempotency_key: body.idempotencyKey,
            dining_session_id: sessionId,
            table_number_snapshot: session.table.table_number,
            order_type: "ala_carte",
            status: "committed",
            created_by: creatorId,
            items: {
              create: body.items.map((item) => {
                const product = productsById.get(item.productId)!;
                const price = money(Number(product.price));
                return {
                  guest_id: item.guestNumber === undefined ? null : guestByNumber.get(item.guestNumber)!.id,
                  selling_product_id: product.id,
                  name_snapshot: product.name,
                  quantity: item.quantity,
                  unit_price: price,
                  total_price: money(price * item.quantity)
                };
              })
            },
          },
          include: {
            items: { include: { guest: true } },
            dining_session: { include: { table: true } },
            ingredient_locks: true
          }
        });

        for (const need of needs) {
          await consumeMaterialStock(tx, {
            raw_material_id: need.raw_material_id,
            quantity: need.quantity,
            source_type: "dine-in",
            source_reference: orderNumber,
            actor_id: creatorId,
            note: "Dine-in a la carte order committed",
            action: "Used"
          });
        }
        return { order: created, replayed: false };
      });
      return res.status(result.replayed ? 200 : 201).json(result);
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
        const raced = await prisma.diningOrder.findUnique({
          where: { idempotency_key: body.idempotencyKey },
          include: { items: { include: { guest: true } } }
        });
        if (raced && isSameOrderRequest(raced, body, sessionId)) {
          return res.json({ order: raced, replayed: true });
        }
        if (raced) {
          throw new InventoryError("This order key is already tied to a different order.", "IDEMPOTENCY_CONFLICT", 409);
        }
      }
      throw error;
    }
  })
);

router.get(
  "/api/pos/kitchen/orders",
  roleGuard(["admin", "cashier", "chef"]),
  asyncRoute(async (_req, res) => {
    const orders = await prisma.diningOrder.findMany({
      where: { status: { in: ["reserved", "prepared", "ready"] } },
      include: {
        dining_session: { include: { table: true } },
        unlimited_session: true,
        items: { include: { guest: true } }
      },
      orderBy: { created_at: "asc" },
      take: 100
    });
    return res.json({ orders });
  })
);

router.patch(
  "/api/pos/kitchen/orders/:id/status",
  roleGuard(["admin", "cashier", "chef"]),
  asyncRoute(async (req, res) => {
    const body = z.object({
      status: z.enum(["prepared", "ready", "released", "cancelled"])
    }).parse(req.body);
    const orderId = z.string().min(1).parse(req.params.id);
    const userId = actorId(req);
    const order = await prisma.$transaction(async (tx) => {
      await tx.$queryRaw<Array<{ id: string }>>`
        SELECT id FROM dining_orders WHERE id = ${orderId} FOR UPDATE
      `;
      const current = await tx.diningOrder.findUnique({
        where: { id: orderId },
        include: { items: true, ingredient_locks: true, unlimited_session: true }
      });
      if (!current) throw new InventoryError("Kitchen ticket not found.", "ORDER_NOT_FOUND", 404);
      const expected = body.status === "prepared"
        ? "reserved"
        : body.status === "ready"
          ? "prepared"
          : body.status === "released"
            ? "ready"
            : "reserved";
      if (current.status !== expected) {
        throw new InventoryError(`Cannot move this ticket from ${current.status} to ${body.status}.`, "INVALID_ORDER_TRANSITION", 409);
      }

      if (body.status === "cancelled") {
        for (const lock of [...current.ingredient_locks].sort((a, b) => a.raw_material_id.localeCompare(b.raw_material_id))) {
          await lockMaterialForUpdate(tx, lock.raw_material_id);
          const reservedBefore = await getActiveCateringReservationQuantity(tx, lock.raw_material_id);
          await tx.dineInIngredientLock.update({
            where: { id: lock.id },
            data: { is_released: true, released_at: new Date() }
          });
          const reservedAfter = await getActiveCateringReservationQuantity(tx, lock.raw_material_id);
          await recordReservationMovement(tx, {
            raw_material_id: lock.raw_material_id,
            quantity: Number(lock.reserved_quantity),
            unit: lock.unit,
            source_type: "dine-in",
            source_reference: current.order_number,
            action: "Released back",
            reserved_before: reservedBefore,
            reserved_after: reservedAfter,
            actor_id: userId,
            note: "Dine-in kitchen ticket cancelled before preparation"
          });
        }
      }

      if (body.status === "released") {
        for (const lock of [...current.ingredient_locks].sort((a, b) => a.raw_material_id.localeCompare(b.raw_material_id))) {
          await consumeMaterialStock(tx, {
            raw_material_id: lock.raw_material_id,
            quantity: Number(lock.reserved_quantity),
            source_type: "dine-in",
            source_reference: current.order_number,
            actor_id: userId,
            note: `Dine-in ${current.order_type} ticket served`,
            action: "Released",
            releaseReservedQuantity: Number(lock.reserved_quantity)
          });
          await tx.dineInIngredientLock.update({
            where: { id: lock.id },
            data: { is_released: true, released_at: new Date() }
          });
        }
      }
      const now = new Date();
      const updated = await tx.diningOrder.update({
        where: { id: current.id },
        data: {
          status: body.status,
          ...(body.status === "prepared" ? { prepared_at: now } : {}),
          ...(body.status === "ready" ? { ready_at: now } : {}),
          ...(body.status === "released" ? { released_at: now } : {}),
          ...(body.status === "cancelled" ? { cancelled_at: now } : {})
        },
        include: {
          dining_session: { include: { table: true } },
          unlimited_session: true,
          items: { include: { guest: true } }
        }
      });
      if (
        body.status === "released" &&
        updated.order_type === "unlimited" &&
        updated.unlimited_session &&
        !updated.unlimited_session.first_round_at
      ) {
        const firstRoundAt = now;
        await tx.unlimitedSession.update({
          where: { id: updated.unlimited_session.id },
          data: {
            first_round_at: firstRoundAt,
            ends_at: new Date(firstRoundAt.getTime() + updated.unlimited_session.time_limit_minutes * 60_000)
          }
        });
      }
      return updated;
    });
    return res.json({ order });
  })
);

router.post(
  "/api/pos/dining/sessions/:id/unlimited-sessions",
  roleGuard(["admin", "cashier"]),
  asyncRoute(async (req, res) => {
    const body = z.object({ paxCount: z.coerce.number().int().positive().max(100) }).parse(req.body);
    const sessionId = z.string().min(1).parse(req.params.id);
    const cashierId = actorId(req);
    const settings = await prisma.unlimitedSetting.findFirst();
    if (!settings) throw new InventoryError("Unlimited pricing settings are unavailable.", "UNLIMITED_SETTINGS_MISSING", 503);
    const unlimited = await prisma.$transaction(async (tx) => {
      await tx.$queryRaw<Array<{ id: string }>>`
        SELECT id FROM dining_table_sessions WHERE id = ${sessionId} FOR UPDATE
      `;
      const tableSession = await tx.diningTableSession.findUnique({
        where: { id: sessionId },
        include: { table: true }
      });
      if (!tableSession || tableSession.status !== "active") {
        throw new InventoryError("Active dining session not found.", "SESSION_NOT_FOUND", 404);
      }
      const activePackage = await tx.unlimitedSession.findFirst({
        where: { dining_session_id: sessionId, status: "active" },
        select: { id: true }
      });
      if (activePackage) {
        throw new InventoryError("End the current Unlimited package before starting another.", "UNLIMITED_SESSION_ACTIVE", 409);
      }
      const startedAt = new Date();
      const endsAt = new Date(startedAt.getTime() + settings.time_limit_minutes * 60_000);
      return tx.unlimitedSession.create({
        data: {
          dining_session_id: sessionId,
          table_id: tableSession.table_id,
          pax_count: body.paxCount,
          price_per_pax: settings.price_per_person,
          total_paid: 0,
          time_limit_minutes: settings.time_limit_minutes,
          started_at: startedAt,
          first_round_at: startedAt,
          ends_at: endsAt,
          status: "active",
          cashier_id: cashierId
        },
        include: { table: true, dining_orders: { include: { items: true } }, extensions: true }
      });
    });
    return res.status(201).json({
      unlimited_session: unlimited,
      package_amount_due_after_dining: money(unlimited.pax_count * unlimited.price_per_pax)
    });
  })
);

router.post(
  "/api/pos/dining/unlimited-sessions/:id/extend",
  roleGuard(ROLES.CASHIER),
  asyncRoute(async (req, res) => {
    const unlimitedId = z.string().min(1).parse(req.params.id);
    const approvedBy = actorId(req);
    const result = await prisma.$transaction(async (tx) => {
      await tx.$queryRaw<Array<{ id: string }>>`
        SELECT id FROM unlimited_sessions WHERE id = ${unlimitedId} FOR UPDATE
      `;
      const session = await tx.unlimitedSession.findUnique({ where: { id: unlimitedId } });
      if (!session || session.status !== "active" || !session.dining_session_id) {
        throw new InventoryError("Active table Unlimited session not found.", "UNLIMITED_SESSION_NOT_FOUND", 404);
      }
      const settings = await tx.unlimitedSetting.findFirst();
      if (!settings) throw new InventoryError("Unlimited pricing settings are unavailable.", "UNLIMITED_SETTINGS_MISSING", 503);
      const now = new Date();
      const extensionMinutes = settings.extension_minutes;
      const nextEnd = new Date(Math.max(session.ends_at.getTime(), now.getTime()) + extensionMinutes * 60_000);
      const [extension, updated] = await Promise.all([
        tx.unlimitedExtension.create({
          data: {
            unlimited_session_id: session.id,
            minutes: extensionMinutes,
            approved_by: approvedBy
          }
        }),
        tx.unlimitedSession.update({
          where: { id: session.id },
          data: { ends_at: nextEnd },
          include: { table: true, extensions: { orderBy: { created_at: "asc" } } }
        })
      ]);
      return { extension, session: updated };
    });
    return res.json(result);
  })
);

router.post(
  "/api/pos/dining/unlimited-sessions/:id/end",
  roleGuard(["admin", "cashier"]),
  asyncRoute(async (req, res) => {
    const body = z.object({
      leftovers: z.array(z.object({
        productId: z.string().min(1),
        quantity: z.coerce.number().int().positive()
      })).default([])
    }).parse(req.body);
    const unlimitedId = z.string().min(1).parse(req.params.id);
    const result = await prisma.$transaction(async (tx) => {
      await tx.$queryRaw<Array<{ id: string }>>`
        SELECT id FROM unlimited_sessions WHERE id = ${unlimitedId} FOR UPDATE
      `;
      const session = await tx.unlimitedSession.findUnique({
        where: { id: unlimitedId },
        include: { dining_orders: { where: { status: "released" }, include: { items: true } } }
      });
      if (!session || session.status !== "active" || !session.dining_session_id) {
        throw new InventoryError("Active table Unlimited session not found.", "UNLIMITED_SESSION_NOT_FOUND", 404);
      }
      const orderedByProduct = new Map<string, number>();
      for (const order of session.dining_orders) {
        for (const item of order.items) {
          if (item.selling_product_id) {
            orderedByProduct.set(item.selling_product_id, (orderedByProduct.get(item.selling_product_id) ?? 0) + item.quantity);
          }
        }
      }
      const requestedLeftovers = new Map<string, number>();
      for (const leftover of body.leftovers) {
        requestedLeftovers.set(
          leftover.productId,
          (requestedLeftovers.get(leftover.productId) ?? 0) + leftover.quantity
        );
      }
      for (const [productId, quantity] of requestedLeftovers) {
        if (quantity > (orderedByProduct.get(productId) ?? 0)) {
          throw new InventoryError("Leftovers cannot exceed the quantity served under Unlimited.", "INVALID_LEFTOVER_QUANTITY", 400);
        }
      }
      const settings = await tx.unlimitedSetting.findFirst();
      if (!settings) throw new InventoryError("Unlimited pricing settings are unavailable.", "UNLIMITED_SETTINGS_MISSING", 503);
      const products = await tx.sellingProduct.findMany({
        where: { id: { in: body.leftovers.map((item) => item.productId) } },
        select: { id: true, price: true }
      });
      const productById = new Map(products.map((product) => [product.id, product]));
      await tx.unlimitedLeftoverItem.createMany({
        data: body.leftovers.map((item) => {
          const product = productById.get(item.productId);
          if (!product) throw new InventoryError("A leftover product was not found.", "PRODUCT_NOT_FOUND", 409);
          return {
            session_id: session.id,
            selling_product_id: item.productId,
            quantity: item.quantity,
            charge_amount: money(
              Number(product.price) * item.quantity * settings.leftover_charge_percent / 100
            )
          };
        })
      });
      return tx.unlimitedSession.update({
        where: { id: session.id },
        data: { status: "completed" },
        include: { leftover_items: { include: { selling_product: true } }, extensions: true }
      });
    });
    return res.json({ unlimited_session: result });
  })
);

router.get(
  "/api/pos/dining/sessions/:id/checkout-preview",
  roleGuard(["admin", "cashier"]),
  asyncRoute(async (req, res) => {
    const session = await getDiningSession(prisma, z.string().min(1).parse(req.params.id));
    if (!session || session.status !== "active") {
      throw new InventoryError("Active dining session not found.", "SESSION_NOT_FOUND", 404);
    }
    const totals = await buildCheckout(session);
    return res.json({
      session_id: session.id,
      table_number: getCommittedTableNumberSnapshot(session) ?? session.table.table_number,
      guest_count: totals.guestCount,
      a_la_carte_lines: totals.aLaCarteItems.map((item) => ({
        name: item.name_snapshot,
        guest_number: item.guest?.guest_number ?? null,
        quantity: item.quantity,
        unit_price: Number(item.unit_price),
        total_price: Number(item.total_price)
      })),
      unlimited_lines: totals.unlimitedPackages.map((item) => ({
        name: "Unlimited package",
        quantity: item.covers,
        unit_price: item.price_per_cover,
        total_price: item.total
      })),
      leftover_lines: totals.leftoverLines,
      subtotal: totals.subtotal,
      unlimited_amount: totals.unlimitedAmount,
      leftover_amount: totals.leftoverAmount,
      discounted_guest_count: totals.discountedGuestCount,
      per_guest_share: totals.perGuestShare,
      discount_amount: totals.discountAmount,
      total: totals.total
    });
  })
);

router.post(
  "/api/pos/dining/sessions/:id/checkout",
  roleGuard(["admin", "cashier"]),
  asyncRoute(async (req, res) => {
    const body = z.object({
      paymentMethod: z.enum(["cash", "gcash", "bank_transfer"]),
      cashReceived: z.coerce.number().nonnegative().optional()
    }).parse(req.body);
    const sessionId = z.string().min(1).parse(req.params.id);
    const cashierId = actorId(req);
    const transactionNumber = makeReference("POS");
    const result = await prisma.$transaction(async (tx) => {
      await tx.$queryRaw<Array<{ id: string }>>`
        SELECT id FROM dining_table_sessions WHERE id = ${sessionId} FOR UPDATE
      `;
      await lockTablesInStableOrder(tx);
      const existingTransaction = await tx.posTransaction.findUnique({
        where: { dining_session_id: sessionId },
        include: {
          items: { include: { selling_product: true } },
          charges: true,
          cashier: { select: { id: true, name: true } },
          dining_session: { include: { table: true, guests: true } }
        }
      });
      if (existingTransaction) {
        return { transaction: existingTransaction, totals: null, replayed: true };
      }
      const session = await getDiningSession(tx, sessionId);
      if (!session || session.status !== "active") {
        throw new InventoryError("Active dining session not found.", "SESSION_NOT_FOUND", 404);
      }
      const totals = await buildCheckout(session);
      if (body.paymentMethod === "cash" && Number(body.cashReceived ?? 0) < totals.total) {
        throw new InventoryError("Cash received must be at least the amount due.", "INSUFFICIENT_CASH", 400);
      }
      const received = body.paymentMethod === "cash" ? Number(body.cashReceived ?? 0) : null;
      const transaction = await tx.posTransaction.create({
        data: {
          transaction_number: transactionNumber,
          customer_name: null,
          dining_session_id: session.id,
          table_number_snapshot: getCommittedTableNumberSnapshot(session),
          transaction_type: "dine_in",
          subtotal: totals.subtotal,
          tax: 0,
          unlimited_amount: totals.unlimitedAmount,
          leftover_amount: totals.leftoverAmount,
          discount_amount: totals.discountAmount,
          guest_count: totals.guestCount,
          discount_guest_count: totals.discountedGuestCount,
          total: totals.total,
          payment_method: body.paymentMethod,
          cash_received: received,
          change_due: received === null ? null : money(received - totals.total),
          status: "paid",
          cashier_id: cashierId,
          items: {
            create: totals.aLaCarteItems.map((item) => ({
              selling_product_id: item.selling_product_id!,
              name_snapshot: item.name_snapshot,
              quantity: item.quantity,
              unit_price: Number(item.unit_price),
              total_price: Number(item.total_price)
            }))
          },
          charges: {
            create: [
              ...totals.unlimitedPackages.map((item) => ({
                line_type: "unlimited_package",
                name_snapshot: `Unlimited package - ${item.covers} covers`,
                quantity: item.covers,
                unit_price: item.price_per_cover,
                total_price: item.total
              })),
              ...totals.leftoverLines.map((item) => ({
                line_type: "unlimited_leftover",
                name_snapshot: item.name,
                quantity: item.quantity,
                unit_price: money(item.total / item.quantity),
                total_price: item.total
              }))
            ]
          }
        },
        include: {
          items: { include: { selling_product: true } },
          charges: true,
          cashier: { select: { id: true, name: true } },
          dining_session: { include: { table: true, guests: true } }
        }
      });
      await tx.diningTableSession.update({
        where: { id: session.id },
        data: { status: "closed", closed_at: new Date() }
      });
      await tx.table.update({
        where: { id: session.table_id },
        data: session.table.is_temporary
          ? {
              status: "unavailable",
              is_archived: true,
              archived_at: new Date(),
              linked_to_table_id: null,
              unavailable_reason: null
            }
          : { status: "available", unavailable_reason: null }
      });
      await tx.table.updateMany({
        where: { linked_to_table_id: session.table_id, is_archived: false },
        data: { status: "available", linked_to_table_id: null, unavailable_reason: null }
      });
      for (const unlimited of session.unlimited_sessions.filter((item) => item.status === "completed")) {
        const packageAmount = unlimited.pax_count * Number(unlimited.price_per_pax);
        await tx.unlimitedSession.update({
          where: { id: unlimited.id },
          data: { total_paid: money(packageAmount) }
        });
      }
      return { transaction, totals, replayed: false };
    });
    return res.status(result.replayed ? 200 : 201).json(result);
  })
);

export default router;

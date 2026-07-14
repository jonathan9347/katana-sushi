import cookieParser from "cookie-parser";
import cors from "cors";
import express, { NextFunction, Request, Response } from "express";
import helmet from "helmet";
import jwt, { SignOptions } from "jsonwebtoken";
import morgan from "morgan";
import bcrypt from "bcrypt";
import fs from "fs";
import path from "path";
import multer from "multer";
import { Prisma, PrismaClient } from "@prisma/client";
import { z } from "zod";
import { NotificationService } from "./services/notification.service";
import { generateTransactionNumber } from "./utils/transactionNumber";
import paymentRoutes from "./routes/payment.routes";
import { seedDemoData } from "./services/demoSeed.service";

import dotenv from "dotenv";

// Load .env file only in development (won't exist in production on Render)
if (process.env.NODE_ENV !== "production") {
  dotenv.config({ path: path.resolve(__dirname, "..", ".env") });
}

export const prisma = new PrismaClient();
const app = express();
const notificationService = new NotificationService();

export async function ensureDemoSeed() {
  try {
    // Check if both users and products exist (complete seed required for system to work)
    const [userCount, productCount] = await Promise.all([
      prisma.user.count(),
      prisma.sellingProduct.count()
    ]);

    if (userCount > 0 && productCount > 0) {
      console.log("Database already seeded with users and products. Skipping demo data initialization.");
      return;
    }

    // Warn if we're doing a partial reseed
    if (userCount > 0 && productCount === 0) {
      console.warn("⚠ Warning: Database has users but no products. Performing recovery reseed...");
    }

    console.log("Initializing demo seed data...");
    await seedDemoData(prisma);
    console.log("✓ Demo seed data initialized successfully.");
  } catch (error) {
    console.error("✗ Failed to initialize demo seed data:", error);
    throw error; // Re-throw to prevent app from running in incomplete state
  }
}

// Lightweight health check — does not depend on the database. Use for uptime
// monitoring and to let the platform know the process is healthy quickly.
app.get('/health', (_req, res) => {
  res.json({ ok: true, uptime: process.uptime(), timestamp: new Date().toISOString() });
});

const uploadDir = path.join(__dirname, "..", "uploads", "products");
fs.mkdirSync(uploadDir, { recursive: true });

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, uploadDir),
  filename: (_req, file, cb) => {
    const safeName = file.originalname.replace(/\s+/g, "-").replace(/[^a-zA-Z0-9-._]/g, "");
    cb(null, `${Date.now()}-${Math.round(Math.random() * 1e9)}-${safeName}`);
  }
});

const upload = multer({
  storage,
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (file.mimetype.startsWith("image/")) {
      cb(null, true);
    } else {
      cb(new Error("Only image files are allowed."));
    }
  }
});
const menuCategoryOrder = [
  "Classic Roll",
  "Fried Roll",
  "Futo Maki",
  "Hoso Maki",
  "Special Roll",
  "Nigiri",
  "Sashimi",
  "Baked Sushi",
  "Platter",
  "Spring Roll",
  "Gyozai"
];

type TokenPayload = {
  sub: string;
  email: string;
  role: string;
};

function getUserFromRequest(req: Request) {
  const bearerToken = req.headers.authorization?.startsWith("Bearer ")
    ? req.headers.authorization.slice("Bearer ".length)
    : null;
  const token = req.cookies?.token ?? bearerToken;

  if (!token) {
    return null;
  }

  try {
    return jwt.verify(
      token,
      process.env.JWT_SECRET ?? "katana-super-secret-key-change-in-production"
    ) as TokenPayload;
  } catch {
    return null;
  }
}

function normalizeRole(role?: string) {
  return role?.toLowerCase();
}

function requireRole(req: Request, res: Response, roles: string[]) {
  const user = getUserFromRequest(req);
  const role = normalizeRole(user?.role);

  if (!user || !role) {
    res.status(401).json({ message: "Please sign in again." });
    return null;
  }

  if (!roles.includes(role)) {
    res.status(403).json({ message: "Forbidden" });
    return null;
  }

  return user;
}

const frontendUrl = process.env.FRONTEND_URL?.trim();
const allowedFrontendOrigins = new Set([
  "http://localhost:5173",
  "http://127.0.0.1:5173",
  frontendUrl
].filter((origin): origin is string => Boolean(origin)));

function isLocalFrontendOrigin(origin?: string) {
  if (!origin || allowedFrontendOrigins.has(origin)) {
    return true;
  }

  try {
    const parsed = new URL(origin);
    const isVitePort = parsed.port === "5173";
    const isPrivateHost =
      parsed.hostname === "localhost" ||
      parsed.hostname === "127.0.0.1" ||
      /^192\.168\.\d{1,3}\.\d{1,3}$/.test(parsed.hostname) ||
      /^10\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(parsed.hostname) ||
      /^172\.(1[6-9]|2\d|3[0-1])\.\d{1,3}\.\d{1,3}$/.test(parsed.hostname);
    const isNetlifyOrigin = parsed.hostname.endsWith(".netlify.app");

    return (isVitePort && isPrivateHost) || isNetlifyOrigin;
  } catch {
    return false;
  }
}

if (process.env.NODE_ENV === "production" && !frontendUrl) {
  console.warn(
    "WARNING: FRONTEND_URL is not set in production. Netlify frontends are allowed by default if the request origin ends with .netlify.app, but set FRONTEND_URL to your exact domain for strict CORS enforcement."
  );
}

app.use(
  cors({
    origin: (origin: string | undefined, callback: (err: Error | null, allow?: boolean) => void) => {
      if (isLocalFrontendOrigin(origin)) {
        callback(null, true);
        return;
      }

      callback(new Error("Not allowed by CORS"));
    },
    credentials: true,
    methods: ["GET", "POST", "PUT", "DELETE"],
    allowedHeaders: ["Content-Type", "Authorization"]
  })
);
app.use(
  helmet({
    crossOriginResourcePolicy: { policy: "cross-origin" }
  })
);
app.use(morgan("dev"));
app.use(cookieParser());
app.use(express.json());
app.use(
  "/uploads",
  express.static(path.join(__dirname, "..", "uploads"), {
    setHeaders: (res) => {
      res.setHeader("Cross-Origin-Resource-Policy", "cross-origin");
    }
  })
);
app.use("/api", paymentRoutes);

app.get("/", (_req, res) => {
  res.json({ message: "Katana Sushi API" });
});

app.get("/health", (_req, res) => {
  res.json({ status: "ok" });
});

const reservationBodySchema = z.object({
  customer_name: z.string().min(1),
  customer_phone: z.string().regex(/^09\d{9}$/),
  customer_email: z.string().email(),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  time: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
  party_size: z.coerce.number().int().min(1).max(30),
  special_requests: z.string().optional()
});

const cateringInquiryBodySchema = z.object({
  customer_name: z.string().min(1),
  customer_phone: z.string().regex(/^09\d{9}$/),
  customer_email: z.string().email(),
  event_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  headcount: z.coerce.number().int().min(10),
  venue_address: z.string().min(5),
  package_type: z.enum(["sushi_station", "sashimi_bar", "tempura_live"]).optional().nullable(),
  downpayment_acknowledged: z.coerce.boolean().refine(Boolean),
  message: z.string().optional()
});

const reservationDineInBodySchema = z.object({
  customer_name: z.string().min(1),
  customer_phone: z.string().regex(/^09\d{9}$/),
  customer_email: z.string().email(),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  time: z.string().regex(/^([01]?\d|2[0-3]):[0-5]\d$/),
  party_size: z.coerce.number().int().min(1),
  reservation_type: z.enum(["dine_in", "unlimited"]).default("dine_in"),
  selected_products: z
    .array(
      z.object({
        product_id: z.string().min(1),
        name: z.string().min(1),
        quantity: z.coerce.number().int().min(1),
        price: z.coerce.number().nonnegative()
      })
    )
    .optional(),
  unlimited_package_id: z.string().optional().nullable(),
  payment_plan: z.enum(["initial_only", "full_payment"]).default("initial_only"),
  payment_method: z.enum(["cash", "gcash", "bank_transfer"]).optional().nullable(),
  payment_transaction_id: z.string().optional(),
  booking_id: z.string().optional(),
  special_requests: z.string().optional()
}).superRefine((data, ctx) => {
  if (!data.selected_products || data.selected_products.length === 0) {
    ctx.addIssue({
      path: ["selected_products"],
      code: z.ZodIssueCode.custom,
      message: "Please select at least one menu item for this reservation."
    });
  }

  if (data.reservation_type === "unlimited" && !data.unlimited_package_id) {
    ctx.addIssue({
      path: ["unlimited_package_id"],
      code: z.ZodIssueCode.custom,
      message: "Unlimited reservation requires a package selection."
    });
  }

  if (!data.payment_method) {
    ctx.addIssue({
      path: ["payment_method"],
      code: z.ZodIssueCode.custom,
      message: "Payment method is required to confirm your reservation."
    });
  }
});

const cateringReservationBodySchema = z.object({
  customer_name: z.string().min(1),
  customer_phone: z.string().regex(/^09\d{9}$/),
  customer_email: z.string().email(),
  event_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  headcount: z.coerce.number().int().min(10),
  venue_address: z.string().min(5),
  package_id: z.string().min(1),
  payment_plan: z.enum(["initial_only", "full_payment"]).default("initial_only"),
  payment_method: z.enum(["cash", "gcash", "bank_transfer"]),
  payment_transaction_id: z.string().optional(),
  reservation_id: z.string().optional(),
  special_requests: z.string().optional()
});

const reservationPaymentBodySchema = z.object({
  amount: z.coerce.number().positive(),
  payment_method: z.enum(["cash", "gcash", "bank_transfer"]),
  reference_number: z.string().optional().nullable(),
  cash_received: z.coerce.number().positive().optional().nullable(),
  received_by: z.string().optional()
}).superRefine((data, ctx) => {
  if (data.payment_method !== "cash" && !data.reference_number?.trim()) {
    ctx.addIssue({
      path: ["reference_number"],
      code: z.ZodIssueCode.custom,
      message: "Reference number is required for GCash and BPI payments."
    });
  }
});

type ReservationPaymentHistoryItem = {
  id: string;
  payment_stage: string;
  method: string;
  amount: number;
  reference_number?: string | null;
  cash_received?: number | null;
  change_due?: number | null;
  source: string;
  received_at: Date;
};

function roundMoney(value: number) {
  return Number(value.toFixed(2));
}

function buildPaymentHistory(reservation: any): ReservationPaymentHistoryItem[] {
  const history: ReservationPaymentHistoryItem[] = [];

  if (Number(reservation.downpayment_amount ?? 0) > 0 && reservation.downpayment_status === "paid") {
    history.push({
      id: `${reservation.id}-downpayment`,
      payment_stage: reservation.payment_plan === "full_payment" ? "full_payment" : "downpayment",
      method: reservation.downpayment_method ?? "cash",
      amount: Number(reservation.downpayment_amount),
      reference_number: reservation.downpayment_transaction_id ?? null,
      source: "online",
      received_at: reservation.downpayment_date ?? reservation.created_at
    });
  }

  for (const payment of reservation.payments ?? []) {
    history.push({
      id: payment.id,
      payment_stage: payment.payment_stage,
      method: payment.method,
      amount: Number(payment.amount),
      reference_number: payment.reference_number,
      cash_received: payment.cash_received,
      change_due: payment.change_due,
      source: payment.source,
      received_at: payment.received_at
    });
  }

  return history.sort((a, b) => new Date(a.received_at).getTime() - new Date(b.received_at).getTime());
}

function paymentSummaryFields(reservation: any) {
  return {
    payment_history: buildPaymentHistory(reservation)
  };
}

const sushiStationInclusions = [
  "California Maki",
  "Mango Roll",
  "Volcano Roll",
  "Tori Teriyaki Roll",
  "Salmon Cheese Maki",
  "Futo California",
  "Tamago Sushi",
  "Kani Sushi",
  "Salmon Nigiri"
];

const cateringStationPackages = [
  {
    id: "pkg_sushi_50_60",
    stationType: "sushi_station",
    name: "Sushi Station",
    description: "50-60 pax",
    pricePerPerson: 0,
    minPax: 50,
    maxPax: 60,
    imageUrl: "/images/catering/sushi-station.jpg",
    items: { pricingType: "flat", flatPrice: 6000, inclusions: sushiStationInclusions }
  },
  {
    id: "pkg_sushi_75_85",
    stationType: "sushi_station",
    name: "Sushi Station",
    description: "75-85 pax",
    pricePerPerson: 0,
    minPax: 75,
    maxPax: 85,
    imageUrl: "/images/catering/sushi-station.jpg",
    items: { pricingType: "flat", flatPrice: 9000, inclusions: sushiStationInclusions }
  },
  {
    id: "pkg_sushi_100_120",
    stationType: "sushi_station",
    name: "Sushi Station",
    description: "100-120 pax",
    pricePerPerson: 0,
    minPax: 100,
    maxPax: 120,
    imageUrl: "/images/catering/sushi-station.jpg",
    items: { pricingType: "flat", flatPrice: 12000, inclusions: sushiStationInclusions }
  },
  {
    id: "pkg_sushi_150_170",
    stationType: "sushi_station",
    name: "Sushi Station",
    description: "150-170 pax",
    pricePerPerson: 0,
    minPax: 150,
    maxPax: 170,
    imageUrl: "/images/catering/sushi-station.jpg",
    items: { pricingType: "flat", flatPrice: 17500, inclusions: sushiStationInclusions }
  },
  {
    id: "pkg_sushi_200_220",
    stationType: "sushi_station",
    name: "Sushi Station",
    description: "200-220 pax",
    pricePerPerson: 0,
    minPax: 200,
    maxPax: 220,
    imageUrl: "/images/catering/sushi-station.jpg",
    items: { pricingType: "flat", flatPrice: 23000, inclusions: sushiStationInclusions }
  },
  {
    id: "pkg_sashimi_20_29",
    stationType: "sashimi_bar",
    name: "Sashimi Bar",
    description: "20-29kg whole tuna",
    pricePerPerson: 0,
    minPax: 20,
    maxPax: 29,
    imageUrl: "/images/catering/sashimi-bar.jpg",
    items: { pricingType: "range", minPrice: 15000, maxPrice: 21750, inclusions: ["Whole tuna sashimi service"] }
  },
  {
    id: "pkg_sashimi_30_40",
    stationType: "sashimi_bar",
    name: "Sashimi Bar",
    description: "30-40kg whole tuna",
    pricePerPerson: 0,
    minPax: 30,
    maxPax: 40,
    imageUrl: "/images/catering/sashimi-bar.jpg",
    items: { pricingType: "range", minPrice: 22500, maxPrice: 30000, inclusions: ["Whole tuna sashimi service"] }
  },
  {
    id: "pkg_tempura_live",
    stationType: "tempura_live",
    name: "Tempura Live",
    description: "Live tempura station",
    pricePerPerson: 0,
    minPax: 10,
    maxPax: 999,
    imageUrl: "/images/catering/tempura-live.jpg",
    items: { pricingType: "quote", inclusions: ["Live tempura cooking station"] }
  }
];

const cateringPackageTypeMap = Object.fromEntries(
  cateringStationPackages.map((stationPackage) => [stationPackage.id, stationPackage.stationType])
);

function getCateringPackagePrice(packageId: string): number {
  const stationPackage = cateringStationPackages.find((item) => item.id === packageId);
  const items = stationPackage?.items;

  if (!items || items.pricingType === "quote") {
    return 0;
  }

  if (items.pricingType === "range") {
    return items.minPrice ?? 0;
  }

  return items.flatPrice ?? 0;
}

function normalizeProductName(value: string) {
  return value
    .toLowerCase()
    .replace(/\([^)]*\)/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function getCateringPackageProductNames(packageId: string) {
  const stationPackage = cateringStationPackages.find((item) => item.id === packageId);
  const inclusions = stationPackage?.items?.inclusions;

  if (!Array.isArray(inclusions)) {
    return [];
  }

  return inclusions
    .map((item) => String(item))
    .filter((item): item is string => Boolean(item));
}

async function ensureCateringStationPackage(packageId: string) {
  const stationPackage = cateringStationPackages.find((item) => item.id === packageId);

  if (!stationPackage) {
    return null;
  }

  return prisma.cateringPackage.upsert({
    where: { id: stationPackage.id },
    update: {
      name: stationPackage.name,
      description: stationPackage.description,
      pricePerPerson: stationPackage.pricePerPerson,
      minPax: stationPackage.minPax,
      maxPax: stationPackage.maxPax,
      imageUrl: stationPackage.imageUrl,
      items: stationPackage.items
    },
    create: {
      id: stationPackage.id,
      name: stationPackage.name,
      description: stationPackage.description,
      pricePerPerson: stationPackage.pricePerPerson,
      minPax: stationPackage.minPax,
      maxPax: stationPackage.maxPax,
      imageUrl: stationPackage.imageUrl,
      items: stationPackage.items
    }
  });
}

function manilaDateToUtc(dateString: string) {
  return new Date(`${dateString}T00:00:00+08:00`);
}

function manilaDateKey(date: Date) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Manila",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).format(date);
}

function isWithinOperatingHours(time: string) {
  return time >= "10:00" && time <= "22:00";
}

function startOfDay(date: Date) {
  return manilaDateToUtc(manilaDateKey(date));
}

function endOfDay(date: Date) {
  const day = startOfDay(date);
  day.setUTCDate(day.getUTCDate() + 1);
  day.setUTCMilliseconds(day.getUTCMilliseconds() - 1);
  return day;
}

function manilaDateRange(dateFrom?: string, dateTo?: string) {
  return dateFrom || dateTo
    ? {
        gte: dateFrom ? startOfDay(manilaDateToUtc(dateFrom)) : undefined,
        lte: dateTo ? endOfDay(manilaDateToUtc(dateTo)) : undefined
      }
    : undefined;
}

function isPastDate(date: Date) {
  return manilaDateKey(date) < manilaDateKey(new Date());
}

type PrismaTx = Omit<PrismaClient, "$connect" | "$disconnect" | "$on" | "$transaction" | "$use" | "$extends">;

async function deductFromBatchesFEFO(tx: PrismaTx, materialId: string, quantity: number) {
  const batches = await tx.materialBatch.findMany({
    where: {
      raw_material_id: materialId,
      is_disposed: false,
      remaining_quantity: { gt: 0 }
    },
    orderBy: [{ expiration_date: "asc" }, { received_at: "asc" }]
  });

  let remaining = quantity;
  const deductions: Array<{ batchId: string; quantity: number }> = [];

  for (const batch of batches) {
    if (remaining <= 0) {
      break;
    }

    const batchRemaining = Number(batch.remaining_quantity);
    const deductAmount = Math.min(batchRemaining, remaining);

    if (deductAmount <= 0) {
      continue;
    }

    const nextRemaining = batchRemaining - deductAmount;
    await tx.materialBatch.update({
      where: { id: batch.id },
      data: {
        remaining_quantity: nextRemaining,
        is_disposed: nextRemaining <= 0
      }
    });

    deductions.push({ batchId: batch.id, quantity: deductAmount });
    remaining -= deductAmount;
  }

  return deductions;
}

async function createCateringIngredientLocks(
  tx: PrismaTx,
  reservationId: string,
  packageId: string,
  headcount: number
) {
  const packageProductNames = getCateringPackageProductNames(packageId);

  if (packageProductNames.length === 0) {
    return;
  }

  const products = await tx.sellingProduct.findMany({
    where: { is_deleted: false },
    include: {
      recipes: {
        include: {
          recipe_ingredients: {
            include: { raw_material: true }
          }
        }
      }
    }
  });
  const productsByNormalizedName = new Map(
    products.map((product) => [normalizeProductName(product.name), product])
  );
  const selectedProducts = packageProductNames
    .map((name) => {
      const normalized = normalizeProductName(name);
      return (
        productsByNormalizedName.get(normalized) ??
        products.find((product) => normalizeProductName(product.name).startsWith(normalized))
      );
    })
    .filter((product): product is NonNullable<typeof product> => Boolean(product));
  const locksByMaterial = new Map<string, { raw_material_id: string; reserved_quantity: number; unit: string }>();

  for (const product of selectedProducts) {
    const recipeIngredients = product.recipes[0]?.recipe_ingredients ?? [];

    for (const ingredient of recipeIngredients) {
      const material = ingredient.raw_material;
      const reservedQuantity = convertQuantityToMaterialUnit(
        Number(ingredient.quantity_per_yield) * headcount,
        ingredient.unit,
        material.unit
      );
      const existing = locksByMaterial.get(material.id);

      if (existing) {
        existing.reserved_quantity += reservedQuantity;
      } else {
        locksByMaterial.set(material.id, {
          raw_material_id: material.id,
          reserved_quantity: reservedQuantity,
          unit: material.unit
        });
      }
    }
  }

  if (locksByMaterial.size === 0) {
    return;
  }

  await tx.cateringIngredientLock.createMany({
    data: Array.from(locksByMaterial.values()).map((lock) => ({
      ...lock,
      catering_reservation_id: reservationId
    }))
  });
  await tx.cateringReservation.update({
    where: { id: reservationId },
    data: { ingredients_locked: true }
  });
}

async function recordDineInReservationPayment(
  reservationId: string,
  body: z.infer<typeof reservationPaymentBodySchema>,
  userId?: string
) {
  return prisma.$transaction(async (tx) => {
    const reservation = await tx.reservation.findUnique({ where: { id: reservationId } });

    if (!reservation) {
      throw Object.assign(new Error("Reservation not found"), { statusCode: 404 });
    }

    const remainingBalance = Number(reservation.remaining_balance);

    if (remainingBalance <= 0) {
      throw Object.assign(new Error("No remaining balance due."), { statusCode: 400 });
    }

    const appliedAmount = roundMoney(Math.min(body.amount, remainingBalance));
    const nextRemaining = roundMoney(Math.max(remainingBalance - appliedAmount, 0));
    const isFullyPaid = nextRemaining <= 0;
    const cashReceived = body.payment_method === "cash" ? Number(body.cash_received ?? body.amount) : null;
    const changeDue = body.payment_method === "cash" ? roundMoney(Math.max((cashReceived ?? 0) - appliedAmount, 0)) : null;

    await tx.reservationPayment.create({
      data: {
        reservation_id: reservation.id,
        payment_stage: "remaining_balance",
        method: body.payment_method,
        amount: appliedAmount,
        reference_number: body.payment_method === "cash" ? null : body.reference_number?.trim() ?? null,
        cash_received: cashReceived,
        change_due: changeDue,
        source: "staff",
        recorded_by_id: userId
      }
    });

    return tx.reservation.update({
      where: { id: reservationId },
      data: {
        remaining_balance: nextRemaining,
        final_payment_status: isFullyPaid ? "paid" : "pending",
        final_payment_method: isFullyPaid ? body.payment_method : reservation.final_payment_method,
        final_payment_date: isFullyPaid ? new Date() : reservation.final_payment_date,
        full_payment_paid: isFullyPaid,
        full_payment_date: isFullyPaid ? new Date() : reservation.full_payment_date,
        remaining_paid_at_venue: isFullyPaid ? true : reservation.remaining_paid_at_venue,
        remaining_paid_date: isFullyPaid ? new Date() : reservation.remaining_paid_date,
        status: reservation.status === "pending_final_payment" && isFullyPaid ? "seated" : reservation.status
      },
      include: { payments: { orderBy: { received_at: "asc" } } }
    });
  });
}

async function recordCateringReservationPayment(
  reservationId: string,
  body: z.infer<typeof reservationPaymentBodySchema>,
  userId?: string
) {
  return prisma.$transaction(async (tx) => {
    const reservation = await tx.cateringReservation.findUnique({ where: { id: reservationId } });

    if (!reservation) {
      throw Object.assign(new Error("Reservation not found"), { statusCode: 404 });
    }

    const remainingBalance = Number(reservation.remaining_balance);

    if (remainingBalance <= 0) {
      throw Object.assign(new Error("No remaining balance due."), { statusCode: 400 });
    }

    const appliedAmount = roundMoney(Math.min(body.amount, remainingBalance));
    const nextRemaining = roundMoney(Math.max(remainingBalance - appliedAmount, 0));
    const isFullyPaid = nextRemaining <= 0;
    const cashReceived = body.payment_method === "cash" ? Number(body.cash_received ?? body.amount) : null;
    const changeDue = body.payment_method === "cash" ? roundMoney(Math.max((cashReceived ?? 0) - appliedAmount, 0)) : null;

    await tx.reservationPayment.create({
      data: {
        catering_reservation_id: reservation.id,
        payment_stage: "remaining_balance",
        method: body.payment_method,
        amount: appliedAmount,
        reference_number: body.payment_method === "cash" ? null : body.reference_number?.trim() ?? null,
        cash_received: cashReceived,
        change_due: changeDue,
        source: "staff",
        recorded_by_id: userId
      }
    });

    return tx.cateringReservation.update({
      where: { id: reservationId },
      data: {
        remaining_balance: nextRemaining,
        final_payment_status: isFullyPaid ? "paid" : "pending",
        final_payment_method: isFullyPaid ? body.payment_method : reservation.final_payment_method,
        final_payment_date: isFullyPaid ? new Date() : reservation.final_payment_date,
        full_payment_paid: isFullyPaid,
        full_payment_date: isFullyPaid ? new Date() : reservation.full_payment_date,
        remaining_paid_at_venue: isFullyPaid ? true : reservation.remaining_paid_at_venue,
        remaining_paid_date: isFullyPaid ? new Date() : reservation.remaining_paid_date,
        status: reservation.status === "pending_final_payment" && isFullyPaid ? "in_progress" : reservation.status
      },
      include: { payments: { orderBy: { received_at: "asc" } } }
    });
  });
}

async function captureInventorySnapshot(snapshotDate?: Date) {
  const date = snapshotDate ?? new Date();
  const dayStart = startOfDay(date);
  const materials = await prisma.rawMaterial.findMany({ where: { is_deleted: false } });

  for (const material of materials) {
    const quantity = Number(material.current_stock);
    const totalValue = quantity * Number(material.cost_per_unit);

    await prisma.inventorySnapshot.upsert({
      where: {
        snapshot_date_raw_material_id: {
          snapshot_date: dayStart,
          raw_material_id: material.id
        }
      },
      create: {
        snapshot_date: dayStart,
        raw_material_id: material.id,
        quantity,
        unit: material.unit,
        total_value: totalValue
      },
      update: {
        quantity,
        unit: material.unit,
        total_value: totalValue
      }
    });
  }
}

async function generateReadableId(prefix: string, date: Date, field: "booking_id" | "inquiry_id" | "reservation_id") {
  const stamp = manilaDateKey(date).replace(/-/g, "");
  const count =
    field === "booking_id"
      ? await prisma.reservation.count({ where: { booking_id: { startsWith: `${prefix}-${stamp}` } } })
      : field === "inquiry_id"
      ? await prisma.cateringInquiry.count({ where: { inquiry_id: { startsWith: `${prefix}-${stamp}` } } })
      : await prisma.cateringReservation.count({ where: { reservation_id: { startsWith: `${prefix}-${stamp}` } } });

  return `${prefix}-${stamp}-${String(count + 1).padStart(4, "0")}`;
}

const totalRestaurantCapacity = 50;

async function getAvailableCapacity(date: Date, time: string) {
  const approvedGuests = await prisma.reservation.aggregate({
    where: {
      date: {
        gte: startOfDay(date),
        lte: endOfDay(date)
      },
      time,
      status: { in: ["approved", "confirmed", "seated"] }
    },
    _sum: { party_size: true }
  });

  return Math.max(totalRestaurantCapacity - (approvedGuests._sum.party_size ?? 0), 0);
}

app.post("/api/reservations", async (req, res, next) => {
  try {
    const rawBody = reservationBodySchema.parse(req.body);
    const date = manilaDateToUtc(rawBody.date);
    const body = { ...rawBody, date };

    if (isPastDate(body.date)) {
      return res.status(400).json({ message: "Date cannot be in the past" });
    }

    if (!isWithinOperatingHours(body.time)) {
      return res.status(400).json({ message: "Time must be within operating hours" });
    }

    const booking_id = await generateReadableId("KTN", body.date, "booking_id");
    const reservation = await prisma.reservation.create({
      data: {
        ...body,
        booking_id,
        status: "pending",
        special_requests: body.special_requests || null
      }
    });

    return res.status(201).json({
      success: true,
      booking_id: reservation.booking_id,
      message: "Reservation request sent. We will notify you within 30 minutes."
    });
  } catch (error) {
    return next(error);
  }
});

app.get("/api/reservations/status/:bookingId", async (req, res, next) => {
  try {
    const reservation = await prisma.reservation.findUnique({
      where: { booking_id: req.params.bookingId },
      include: { payments: { orderBy: { received_at: "asc" } } }
    });

    if (!reservation) {
      return res.status(404).json({ message: "Reservation not found" });
    }

    return res.json({
      status: reservation.status,
      reservation_type: reservation.reservation_type,
      date: reservation.date,
      time: reservation.time,
      party_size: reservation.party_size,
      total_price: reservation.total_price,
      payment_plan: reservation.payment_plan,
      downpayment_amount: reservation.downpayment_amount,
      downpayment_status: reservation.downpayment_status,
      remaining_balance: reservation.remaining_balance,
      full_payment_paid: reservation.full_payment_paid,
      remaining_paid_at_venue: reservation.remaining_paid_at_venue,
      ...paymentSummaryFields(reservation),
      rejected_reason: reservation.rejected_reason,
      alternative_suggestions: reservation.alternative_suggestions
    });
  } catch (error) {
    return next(error);
  }
});

app.get("/api/unlimited/settings", async (_req, res, next) => {
  try {
    const settings = await getUnlimitedSettings();
    return res.json({ settings });
  } catch (error) {
    return next(error);
  }
});

app.get("/api/catering/packages", async (_req, res, next) => {
  try {
    const packages = await Promise.all(
      cateringStationPackages.map((stationPackage) => ensureCateringStationPackage(stationPackage.id))
    );
    return res.json({ packages });
  } catch (error) {
    return next(error);
  }
});

app.post("/api/catering/reservations", async (req, res, next) => {
  try {
    const rawBody = cateringReservationBodySchema.parse(req.body);
    const event_date = manilaDateToUtc(rawBody.event_date);
    const body = { ...rawBody, event_date };

    if (isPastDate(body.event_date)) {
      return res.status(400).json({ message: "Event date cannot be in the past" });
    }

    const selectedPackage = await prisma.cateringPackage.findUnique({ where: { id: body.package_id } });

    if (!selectedPackage) {
      return res.status(404).json({ message: "Selected catering package not found" });
    }

    const subtotal = getCateringPackagePrice(body.package_id);
    const tax = Number((subtotal * 0.12).toFixed(2));
    const total_price = Number((subtotal + tax).toFixed(2));
    const isFullPayment = body.payment_plan === "full_payment";
    const downpayment_amount = Number((isFullPayment ? total_price : Number((total_price * 0.5).toFixed(2))).toFixed(2));
    const remaining_balance = Number((total_price - downpayment_amount).toFixed(2));

    const reservation_id = body.reservation_id ?? (await generateReadableId("CAT", body.event_date, "reservation_id"));
    const inquiry_id = await generateReadableId("CAT", body.event_date, "inquiry_id");

    const reservation = await prisma.$transaction(async (tx) => {
      const inquiry = await tx.cateringInquiry.create({
        data: {
          inquiry_id,
          customer_name: body.customer_name,
          customer_phone: body.customer_phone,
          customer_email: body.customer_email,
          event_date: body.event_date,
          headcount: body.headcount,
          venue_type: body.venue_address,
          package_type: cateringPackageTypeMap[body.package_id] ?? null,
          status: "pending",
          message: body.special_requests || null
        }
      });

      const created = await tx.cateringReservation.create({
        data: {
          reservation_id,
          inquiry_id: inquiry.id,
          customer_name: body.customer_name,
          customer_phone: body.customer_phone,
          customer_email: body.customer_email,
          event_date: body.event_date,
          headcount: body.headcount,
          package_id: body.package_id,
          total_price,
          payment_plan: body.payment_plan,
          downpayment_amount,
          remaining_balance,
          downpayment_status: "paid",
          downpayment_method: body.payment_method,
          downpayment_date: new Date(),
          downpayment_transaction_id: body.payment_transaction_id ?? null,
          full_payment_paid: isFullPayment,
          full_payment_date: isFullPayment ? new Date() : null,
          final_payment_status: isFullPayment ? "paid" : "pending",
          final_payment_method: isFullPayment ? body.payment_method : null,
          status: "pending_approval",
          confirmed_date: body.event_date,
          deposit_paid: downpayment_amount,
          deposit_due_date: null
        }
      });

      return created;
    });

    return res.status(201).json({
      success: true,
      reservation_id: reservation.reservation_id,
      downpayment_amount: reservation.downpayment_amount,
      remaining_balance: reservation.remaining_balance,
      payment_method: reservation.downpayment_method,
      message: "Catering reservation created. Please wait for staff approval."
    });
  } catch (error) {
    return next(error);
  }
});

app.get("/api/catering/reservations/status/:reservationId", async (req, res, next) => {
  try {
    const reservation = await prisma.cateringReservation.findUnique({
      where: { reservation_id: req.params.reservationId },
      include: { package: true, inquiry: true, payments: { orderBy: { received_at: "asc" } } }
    });

    if (!reservation) {
      return res.status(404).json({ message: "Reservation not found" });
    }

    return res.json({
      status: reservation.status,
      date: reservation.event_date,
      time: "",
      party_size: reservation.headcount,
      total_price: reservation.total_price,
      payment_plan: reservation.payment_plan,
      downpayment_amount: reservation.downpayment_amount,
      remaining_balance: reservation.remaining_balance,
      full_payment_paid: reservation.full_payment_paid,
      remaining_paid_at_venue: reservation.remaining_paid_at_venue,
      final_payment_status: reservation.final_payment_status,
      ...paymentSummaryFields(reservation),
      package_name: reservation.package?.name ?? null,
      venue_type: reservation.inquiry?.venue_type ?? null,
      venue_address: reservation.inquiry?.venue_type ?? null
    });
  } catch (error) {
    return next(error);
  }
});

app.post("/api/catering/reservations/:reservationId/pay-remaining", async (req, res, next) => {
  try {
    const body = z.object({
      payment_method: z.enum(["cash", "gcash", "bank_transfer"]),
      reference_number: z.string().optional().nullable()
    }).parse(req.body);
    const reservation = await prisma.cateringReservation.findUnique({ where: { reservation_id: req.params.reservationId } });

    if (!reservation) {
      return res.status(404).json({ message: "Reservation not found" });
    }

    if (reservation.remaining_balance <= 0) {
      return res.status(400).json({ message: "No remaining balance due." });
    }

    const parsedPayment = reservationPaymentBodySchema.parse({
      amount: reservation.remaining_balance,
      payment_method: body.payment_method,
      reference_number: body.reference_number ?? `ONLINE-${reservation.reservation_id}`,
      cash_received: reservation.remaining_balance
    });
    const updated = await recordCateringReservationPayment(reservation.id, parsedPayment);

    return res.json({ reservation: { ...updated, ...paymentSummaryFields(updated) } });
  } catch (error) {
    return next(error);
  }
});

app.get("/api/customer/bookings", async (req, res, next) => {
  try {
    const email = typeof req.query.email === "string" ? req.query.email.trim().toLowerCase() : undefined;
    const phone = typeof req.query.phone === "string" ? req.query.phone.trim() : undefined;
    const type = typeof req.query.type === "string" ? req.query.type : "all";

    if (!email && !phone) {
      return res.status(400).json({ message: "Email or phone is required to look up bookings." });
    }

    const reservationWhere: Prisma.ReservationWhereInput = email
      ? { customer_email: { equals: email, mode: "insensitive" } }
      : { customer_phone: phone };

    const cateringWhere: Prisma.CateringReservationWhereInput = email
      ? { customer_email: { equals: email, mode: "insensitive" } }
      : { customer_phone: phone };

    const [reservations, cateringReservations] = await Promise.all([
      prisma.reservation.findMany({ where: reservationWhere, include: { payments: { orderBy: { received_at: "asc" } } }, orderBy: [{ date: "desc" }, { time: "desc" }] }),
      prisma.cateringReservation.findMany({ where: cateringWhere, include: { package: true, inquiry: true, payments: { orderBy: { received_at: "asc" } } } })
    ]);

    const todayKey = manilaDateKey(new Date());
    const mapType = (reservation: any) => {
      const dateKey = manilaDateKey(reservation.date ?? reservation.event_date);
      const isPast = dateKey < todayKey || reservation.status === "completed" || reservation.status === "cancelled";
      if (type === "upcoming") return !isPast;
      if (type === "past") return isPast;
      if (type === "cancelled") return reservation.status === "cancelled";
      return true;
    };

    const combined = [
      ...reservations.map((reservation) => ({
        id: reservation.id,
        type: "dine_in",
        reference: reservation.booking_id,
        customer_name: reservation.customer_name,
        phone: reservation.customer_phone,
        email: reservation.customer_email,
        date: reservation.date,
        time: reservation.time,
        guests: reservation.party_size,
        total_price: reservation.total_price,
        payment_plan: reservation.payment_plan,
        downpayment_amount: reservation.downpayment_amount,
        remaining_balance: reservation.remaining_balance,
        payment_status: reservation.final_payment_status,
        ...paymentSummaryFields(reservation),
        reservation_status: reservation.status,
        special_requests: reservation.special_requests,
        booking_url: `/reservation/status?bookingId=${reservation.booking_id}`
      })),
      ...cateringReservations.map((reservation) => ({
        id: reservation.id,
        type: "catering",
        reference: reservation.reservation_id,
        customer_name: reservation.customer_name,
        phone: reservation.customer_phone,
        email: reservation.customer_email,
        date: reservation.event_date,
        time: "",
        guests: reservation.headcount,
        total_price: reservation.total_price,
        package_name: reservation.package?.name ?? reservation.inquiry?.package_type ?? null,
        payment_plan: reservation.payment_plan,
        downpayment_amount: reservation.downpayment_amount,
        remaining_balance: reservation.remaining_balance,
        payment_status: reservation.final_payment_status,
        ...paymentSummaryFields(reservation),
        reservation_status: reservation.status,
        special_requests: reservation.inquiry?.message ?? null,
        booking_url: `/reservation/status?bookingId=${reservation.reservation_id}`
      }))
    ].filter(mapType)
      .sort((a, b) => ((a.date?.getTime() ?? 0) < (b.date?.getTime() ?? 0) ? 1 : (a.date?.getTime() ?? 0) > (b.date?.getTime() ?? 0) ? -1 : 0));

    return res.json({ bookings: combined });
  } catch (error) {
    return next(error);
  }
});

app.get("/api/customer/bookings/:reference", async (req, res, next) => {
  try {
    const reference = req.params.reference;
    const isCatering = reference.toUpperCase().startsWith("CAT-");

    if (isCatering) {
      const reservation = await prisma.cateringReservation.findUnique({
        where: { reservation_id: reference },
        include: { package: true, inquiry: true, payments: { orderBy: { received_at: "asc" } } }
      });

      if (!reservation) {
        return res.status(404).json({ message: "Booking not found" });
      }

      return res.json({
        id: reservation.id,
        type: "catering",
        reference: reservation.reservation_id,
        customer_name: reservation.customer_name,
        phone: reservation.customer_phone,
        email: reservation.customer_email,
        date: reservation.event_date,
        time: "",
        guests: reservation.headcount,
        total_price: reservation.total_price,
        payment_plan: reservation.payment_plan,
        downpayment_amount: reservation.downpayment_amount,
        remaining_balance: reservation.remaining_balance,
        payment_status: reservation.final_payment_status,
        ...paymentSummaryFields(reservation),
        reservation_status: reservation.status,
        package_name: reservation.package?.name ?? reservation.inquiry?.package_type ?? null,
        venue_type: reservation.inquiry?.venue_type ?? null,
        special_requests: reservation.inquiry?.message ?? null
      });
    }

    const reservation = await prisma.reservation.findUnique({
      where: { booking_id: reference },
      include: { payments: { orderBy: { received_at: "asc" } } }
    });

    if (!reservation) {
      return res.status(404).json({ message: "Booking not found" });
    }

    return res.json({
      id: reservation.id,
      type: "dine_in",
      reference: reservation.booking_id,
      customer_name: reservation.customer_name,
      phone: reservation.customer_phone,
      email: reservation.customer_email,
      date: reservation.date,
      time: reservation.time,
      guests: reservation.party_size,
      total_price: reservation.total_price,
      payment_plan: reservation.payment_plan,
      downpayment_amount: reservation.downpayment_amount,
      remaining_balance: reservation.remaining_balance,
      payment_status: reservation.final_payment_status,
      ...paymentSummaryFields(reservation),
      reservation_status: reservation.status,
      special_requests: reservation.special_requests
    });
  } catch (error) {
    return next(error);
  }
});

app.post("/api/reservations/:bookingId/pay-remaining", async (req, res, next) => {
  try {
    const body = z.object({
      payment_method: z.enum(["cash", "gcash", "bank_transfer"]),
      reference_number: z.string().optional().nullable()
    }).parse(req.body);
    const reservation = await prisma.reservation.findUnique({ where: { booking_id: req.params.bookingId } });

    if (!reservation) {
      return res.status(404).json({ message: "Reservation not found" });
    }

    if (reservation.remaining_balance <= 0) {
      return res.status(400).json({ message: "No remaining balance due." });
    }

    const parsedPayment = reservationPaymentBodySchema.parse({
      amount: reservation.remaining_balance,
      payment_method: body.payment_method,
      reference_number: body.reference_number ?? `ONLINE-${reservation.booking_id}`,
      cash_received: reservation.remaining_balance
    });
    const updated = await recordDineInReservationPayment(reservation.id, parsedPayment);

    return res.json({ reservation: { ...updated, ...paymentSummaryFields(updated) } });
  } catch (error) {
    return next(error);
  }
});

app.get("/api/staff/catering/reservations/pending", async (req, res, next) => {
  try {
    const user = requireRole(req, res, ["admin", "event_coordinator"]);

    if (!user) {
      return;
    }

    const reservations = await prisma.cateringReservation.findMany({
      where: { status: "pending_approval" },
      include: { inquiry: true, package: true },
      orderBy: { created_at: "asc" }
    });

    return res.json({ reservations });
  } catch (error) {
    return next(error);
  }
});

app.put("/api/staff/catering/reservations/:id/approve", async (req, res, next) => {
  try {
    const user = requireRole(req, res, ["admin", "event_coordinator"]);

    if (!user) {
      return;
    }

    const reservation = await prisma.$transaction(async (tx) => {
      const updated = await tx.cateringReservation.update({ where: { id: req.params.id }, data: { status: "confirmed" } });

      if (updated.package_id && updated.headcount && !updated.ingredients_locked) {
        await createCateringIngredientLocks(tx, updated.id, updated.package_id, updated.headcount);
      }

      if (updated.inquiry_id) {
        await tx.cateringInquiry.update({ where: { id: updated.inquiry_id }, data: { status: "confirmed" } });
      }

      return tx.cateringReservation.findUnique({
        where: { id: updated.id },
        include: { inquiry: true, package: true, ingredient_locks: { include: { raw_material: true } }, payments: true }
      });
    });

    return res.json({ reservation });
  } catch (error) {
    return next(error);
  }
});

app.put("/api/staff/catering/reservations/:id/start-event", async (req, res, next) => {
  try {
    const user = requireRole(req, res, ["admin", "event_coordinator"]);

    if (!user) {
      return;
    }

    const reservation = await prisma.cateringReservation.update({ where: { id: req.params.id }, data: { status: "in_progress" } });
    return res.json({ reservation });
  } catch (error) {
    return next(error);
  }
});

app.post("/api/staff/catering/reservations/:id/record-payment", async (req, res, next) => {
  try {
    const user = requireRole(req, res, ["admin", "event_coordinator"]);

    if (!user) {
      return;
    }

    const body = reservationPaymentBodySchema.parse(req.body);
    const updated = await recordCateringReservationPayment(req.params.id, body, user.sub);

    return res.json({ reservation: { ...updated, ...paymentSummaryFields(updated) } });
  } catch (error) {
    return next(error);
  }
});

app.post("/api/staff/catering/reservations/:id/record-cash-payment", async (req, res, next) => {
  try {
    const user = requireRole(req, res, ["admin", "event_coordinator"]);

    if (!user) {
      return;
    }

    const body = reservationPaymentBodySchema.parse({
      ...req.body,
      payment_method: "cash",
      cash_received: req.body?.cash_received ?? req.body?.amount
    });
    const updated = await recordCateringReservationPayment(req.params.id, body, user.sub);

    return res.json({ reservation: { ...updated, ...paymentSummaryFields(updated) } });
  } catch (error) {
    return next(error);
  }
});

app.post("/api/staff/reservations/:id/record-payment", async (req, res, next) => {
  try {
    const user = requireRole(req, res, ["admin", "receptionist"]);

    if (!user) {
      return;
    }

    const body = reservationPaymentBodySchema.parse(req.body);
    const updated = await recordDineInReservationPayment(req.params.id, body, user.sub);

    return res.json({ reservation: { ...updated, ...paymentSummaryFields(updated) } });
  } catch (error) {
    return next(error);
  }
});

app.post("/api/staff/reservations/:id/record-cash-payment", async (req, res, next) => {
  try {
    const user = requireRole(req, res, ["admin", "receptionist"]);

    if (!user) {
      return;
    }

    const body = reservationPaymentBodySchema.parse({
      ...req.body,
      payment_method: "cash",
      cash_received: req.body?.cash_received ?? req.body?.amount
    });
    const updated = await recordDineInReservationPayment(req.params.id, body, user.sub);

    return res.json({ reservation: { ...updated, ...paymentSummaryFields(updated) } });
  } catch (error) {
    return next(error);
  }
});

app.put("/api/staff/catering/reservations/:id/complete", async (req, res, next) => {
  return completeCateringReservation(req, res, next);
});

app.post("/api/reservations/dine-in", async (req, res, next) => {
  try {
    const rawBody = reservationDineInBodySchema.parse(req.body);
    const date = manilaDateToUtc(rawBody.date);
    const body = { ...rawBody, date };

    if (isPastDate(body.date)) {
      return res.status(400).json({ message: "Date cannot be in the past" });
    }

    if (!isWithinOperatingHours(body.time)) {
      return res.status(400).json({ message: "Time must be within operating hours" });
    }

    const unlimitedSettings = body.reservation_type === "unlimited" ? await getUnlimitedSettings() : null;
    const subtotal =
      body.reservation_type === "unlimited"
        ? Number(unlimitedSettings?.price_per_person ?? 599) * body.party_size
        : body.selected_products?.reduce((sum, item) => sum + Number(item.price) * Number(item.quantity), 0) ?? 0;
    const tax = Number((subtotal * 0.12).toFixed(2));
    const total_price = Number((subtotal + tax).toFixed(2));
    const isFullPayment = body.payment_plan === "full_payment";
    const downpayment_amount = Number((isFullPayment ? total_price : Number((total_price * 0.5).toFixed(2))).toFixed(2));
    const remaining_balance = Number((total_price - downpayment_amount).toFixed(2));
    const booking_id = body.booking_id ?? (await generateReadableId(body.reservation_type === "unlimited" ? "KTN-UNL" : "KTN-DINE", body.date, "booking_id"));

    const reservation = await prisma.reservation.create({
      data: {
        booking_id,
        customer_name: body.customer_name,
        customer_phone: body.customer_phone,
        customer_email: body.customer_email,
        reservation_type: body.reservation_type,
        date: body.date,
        time: body.time,
        party_size: body.party_size,
        selected_products: body.selected_products ?? [],
        unlimited_package_id: body.reservation_type === "unlimited" ? body.unlimited_package_id ?? unlimitedSettings?.id : null,
        subtotal,
        tax,
        total_price,
        payment_plan: body.payment_plan,
        downpayment_amount,
        remaining_balance,
        downpayment_status: "paid",
        downpayment_method: body.payment_method ?? null,
        downpayment_date: new Date(),
        downpayment_transaction_id: body.payment_transaction_id ?? `DWN-${booking_id}`,
        full_payment_paid: isFullPayment,
        full_payment_date: isFullPayment ? new Date() : null,
        remaining_paid_at_venue: false,
        remaining_paid_date: null,
        final_payment_status: isFullPayment ? "paid" : "pending",
        final_payment_method: isFullPayment ? body.payment_method ?? null : null,
        status: "pending_approval",
        special_requests: body.special_requests || null
      }
    });

    return res.status(201).json({
      success: true,
      booking_id: reservation.booking_id,
      downpayment_amount: reservation.downpayment_amount,
      remaining_balance: reservation.remaining_balance,
      payment_method: reservation.downpayment_method,
      message: "Reservation created. Please wait for staff approval."
    });
  } catch (error) {
    return next(error);
  }
});

app.post("/api/catering/inquiry", async (req, res, next) => {
  try {
    const rawBody = cateringInquiryBodySchema.parse(req.body);
    const event_date = manilaDateToUtc(rawBody.event_date);
    const body = { ...rawBody, event_date };

    if (isPastDate(body.event_date)) {
      return res.status(400).json({ message: "Event date cannot be in the past" });
    }

    const inquiry_id = await generateReadableId("CAT", body.event_date, "inquiry_id");
    const inquiry = await prisma.cateringInquiry.create({
      data: {
        customer_name: body.customer_name,
        customer_phone: body.customer_phone,
        customer_email: body.customer_email,
        event_date: body.event_date,
        headcount: body.headcount,
        venue_type: body.venue_address,
        inquiry_id,
        status: "pending",
        package_type: body.package_type ?? null,
        message: body.message || null
      }
    });

    return res.status(201).json({
      success: true,
      inquiry_id: inquiry.inquiry_id,
      message: "Catering inquiry sent. Our event team will contact you soon."
    });
  } catch (error) {
    return next(error);
  }
});

app.get("/api/staff/reservations/pending", async (req, res, next) => {
  try {
    const user = requireRole(req, res, ["admin", "receptionist"]);

    if (!user) {
      return;
    }

    const reservations = await prisma.reservation.findMany({
      where: { status: { in: ["pending", "pending_approval"] } },
      orderBy: [{ date: "asc" }, { time: "asc" }]
    });
    const reservationsWithCapacity = await Promise.all(
      reservations.map(async (reservation) => ({
        ...reservation,
        available_capacity: await getAvailableCapacity(reservation.date, reservation.time)
      }))
    );

    return res.json({ reservations: reservationsWithCapacity });
  } catch (error) {
    return next(error);
  }
});

app.get("/api/staff/reservations/approved", async (req, res, next) => {
  try {
    const user = requireRole(req, res, ["admin", "receptionist"]);

    if (!user) {
      return;
    }

    const reservations = await prisma.reservation.findMany({
      where: { status: "confirmed" },
      orderBy: [{ date: "asc" }, { time: "asc" }]
    });

    return res.json({ reservations });
  } catch (error) {
    return next(error);
  }
});

app.get("/api/staff/reservations/all", async (req, res, next) => {
  try {
    const user = requireRole(req, res, ["admin", "receptionist"]);

    if (!user) {
      return;
    }

    const date = typeof req.query.date === "string" ? manilaDateToUtc(req.query.date) : undefined;
    const status = typeof req.query.status === "string" ? req.query.status : undefined;

    const dineInReservations = await prisma.reservation.findMany({
      where: {
        status,
        date: date ? { gte: startOfDay(date), lte: endOfDay(date) } : undefined
      },
      include: { unlimited_package: true, payments: { orderBy: { received_at: "asc" } } },
      orderBy: [{ date: "desc" }, { time: "asc" }]
    });

    const cateringReservations = await prisma.cateringReservation.findMany({
      where: {
        status,
        event_date: date ? { gte: startOfDay(date), lte: endOfDay(date) } : undefined
      },
      include: { package: true, inquiry: true, payments: { orderBy: { received_at: "asc" } } },
      orderBy: [{ event_date: "desc" }]
    });

    const reservations = [
      ...dineInReservations.map((reservation) => ({
        id: reservation.id,
        type: "dine_in",
        reference: reservation.booking_id,
        customer_name: reservation.customer_name,
        phone: reservation.customer_phone,
        email: reservation.customer_email,
        date: reservation.date,
        time: reservation.time,
        guests: reservation.party_size,
        reservation_type: reservation.reservation_type,
        selected_products: reservation.selected_products ?? [],
        status: reservation.status,
        payment_plan: reservation.payment_plan,
        downpayment_amount: reservation.downpayment_amount,
        remaining_balance: reservation.remaining_balance,
        total_price: reservation.total_price,
        payment_status: reservation.final_payment_status,
        ...paymentSummaryFields(reservation),
        package_name: reservation.reservation_type === "unlimited" ? "Unlimited Eat-All-You-Can" : "Regular Order",
        venue_type: null
      })),
      ...cateringReservations.map((reservation) => ({
        id: reservation.id,
        type: "catering",
        reference: reservation.reservation_id,
        customer_name: reservation.customer_name,
        date: reservation.event_date,
        time: "",
        guests: reservation.headcount,
        status: reservation.status,
        payment_plan: reservation.payment_plan,
        downpayment_amount: reservation.downpayment_amount,
        remaining_balance: reservation.remaining_balance,
        total_price: reservation.total_price,
        payment_status: reservation.final_payment_status,
        ...paymentSummaryFields(reservation),
        package_name: reservation.package?.name ?? reservation.inquiry?.package_type ?? null,
        venue_type: reservation.inquiry?.venue_type ?? null
      }))
    ].sort((a, b) => {
      const dateA = a.date?.getTime() ?? 0;
      const dateB = b.date?.getTime() ?? 0;
      return dateA < dateB ? 1 : dateA > dateB ? -1 : (a.time || "") < (b.time || "") ? 1 : -1;
    });

    return res.json({ reservations });
  } catch (error) {
    return next(error);
  }
});

app.put("/api/staff/reservations/:id/approve", async (req, res, next) => {
  try {
    const user = requireRole(req, res, ["admin", "receptionist"]);

    if (!user) {
      return;
    }

    const body = z.object({ admin_notes: z.string().optional() }).parse(req.body);
    const existing = await prisma.reservation.findUnique({ where: { id: req.params.id } });

    if (!existing) {
      return res.status(404).json({ message: "Reservation not found" });
    }

    const availableCapacity = await getAvailableCapacity(existing.date, existing.time);

    if (availableCapacity < existing.party_size) {
      return res.status(409).json({ message: "Not enough restaurant capacity for this time slot." });
    }

    const reservation = await prisma.reservation.update({
      where: { id: req.params.id },
      data: {
        admin_notes: body.admin_notes || null,
        rejected_reason: null,
        alternative_suggestions: null,
        status: "confirmed"
      }
    });

    await notificationService.sendConfirmation(
      reservation.booking_id,
      { name: reservation.customer_name, phone: reservation.customer_phone, email: reservation.customer_email },
      { date: reservation.date, time: reservation.time }
    );

    return res.json({ reservation });
  } catch (error) {
    return next(error);
  }
});

app.put("/api/staff/reservations/:id/reject", async (req, res, next) => {
  try {
    const user = requireRole(req, res, ["admin", "receptionist"]);

    if (!user) {
      return;
    }

    const body = z.object({ rejected_reason: z.string().min(1), alternative_suggestions: z.string().optional() }).parse(req.body);
    const reservation = await prisma.reservation.update({
      where: { id: req.params.id },
      data: {
        status: "rejected",
        rejected_reason: body.rejected_reason,
        alternative_suggestions: body.alternative_suggestions || null
      }
    });

    await notificationService.sendRejection(
      reservation.booking_id,
      { name: reservation.customer_name, phone: reservation.customer_phone, email: reservation.customer_email },
      reservation.rejected_reason ?? "Unavailable",
      reservation.alternative_suggestions
    );

    return res.json({ reservation });
  } catch (error) {
    return next(error);
  }
});

app.put("/api/staff/reservations/:id/seat", async (req, res, next) => {
  try {
    const user = requireRole(req, res, ["admin", "receptionist"]);

    if (!user) {
      return;
    }

    const reservation = await prisma.reservation.update({ where: { id: req.params.id }, data: { status: "seated" } });
    return res.json({ reservation });
  } catch (error) {
    return next(error);
  }
});

app.put("/api/staff/reservations/:id/arrive", async (req, res, next) => {
  try {
    const user = requireRole(req, res, ["admin", "receptionist"]);

    if (!user) {
      return;
    }

    const reservation = await prisma.reservation.update({ where: { id: req.params.id }, data: { status: "seated" } });
    return res.json({ reservation });
  } catch (error) {
    return next(error);
  }
});

app.put("/api/staff/reservations/:id/complete", async (req, res, next) => {
  try {
    const user = requireRole(req, res, ["admin", "receptionist"]);

    if (!user) {
      return;
    }

    const reservation = await prisma.reservation.findUnique({ where: { id: req.params.id } });

    if (!reservation) {
      return res.status(404).json({ message: "Reservation not found" });
    }

const hasOpenBalance = Number(reservation.remaining_balance) > 0;

    const paymentCompleted = reservation.final_payment_status === "paid";

    if (hasOpenBalance || !paymentCompleted) {
      return res.status(400).json({ message: "Cannot complete reservation until remaining balance is fully settled." });
    }

    const updated = await prisma.reservation.update({ where: { id: req.params.id }, data: { status: "completed" } });
    return res.json({ reservation: updated });
  } catch (error) {
    return next(error);
  }
});

app.get("/api/staff/tables", async (req, res, next) => {
  try {
    const user = requireRole(req, res, ["admin", "receptionist"]);

    if (!user) {
      return;
    }

    const tables = await prisma.table.findMany({ orderBy: { table_number: "asc" } });
    return res.json({ tables });
  } catch (error) {
    return next(error);
  }
});

app.get("/api/staff/tables/available", async (req, res, next) => {
  try {
    const user = requireRole(req, res, ["admin", "receptionist"]);

    if (!user) {
      return;
    }

    const query = z
      .object({
        date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
        time: z.string()
      })
      .parse(req.query);

    return res.json({ available_capacity: await getAvailableCapacity(manilaDateToUtc(query.date), query.time) });
  } catch (error) {
    return next(error);
  }
});

app.put("/api/staff/tables/:id/status", async (req, res, next) => {
  try {
    const user = requireRole(req, res, ["admin", "receptionist"]);

    if (!user) {
      return;
    }

    const body = z.object({ status: z.enum(["available", "occupied", "reserved"]) }).parse(req.body);
    const table = await prisma.table.update({ where: { id: req.params.id }, data: { status: body.status } });
    return res.json({ table });
  } catch (error) {
    return next(error);
  }
});

app.get("/api/staff/catering/inquiries/pending", async (req, res, next) => {
  try {
    const user = requireRole(req, res, ["admin", "event_coordinator"]);

    if (!user) {
      return;
    }

    const inquiries = await prisma.cateringInquiry.findMany({
      where: { status: "pending" },
      orderBy: { event_date: "asc" }
    });

    return res.json({ inquiries });
  } catch (error) {
    return next(error);
  }
});

app.get("/api/staff/catering/inquiries/all", async (req, res, next) => {
  try {
    const user = requireRole(req, res, ["admin", "event_coordinator"]);

    if (!user) {
      return;
    }

    const inquiries = await prisma.cateringInquiry.findMany({ orderBy: { event_date: "desc" } });
    return res.json({ inquiries });
  } catch (error) {
    return next(error);
  }
});

app.put("/api/staff/catering/inquiries/:id/contacted", async (req, res, next) => {
  try {
    const user = requireRole(req, res, ["admin", "event_coordinator"]);

    if (!user) {
      return;
    }

    const inquiry = await prisma.cateringInquiry.update({ where: { id: req.params.id }, data: { status: "contacted" } });
    await notificationService.sendCateringContacted(inquiry.inquiry_id, {
      name: inquiry.customer_name,
      phone: inquiry.customer_phone,
      email: inquiry.customer_email
    });
    return res.json({ inquiry });
  } catch (error) {
    return next(error);
  }
});

app.post("/api/staff/catering/reservations/confirm", async (req, res, next) => {
  try {
    const user = requireRole(req, res, ["admin", "event_coordinator"]);

    if (!user) {
      return;
    }

    const parseDateString = (value: unknown) => {
      if (typeof value === "string") {
        const dateOnly = value.slice(0, 10);
        if (/^\d{4}-\d{2}-\d{2}$/.test(dateOnly)) {
          return manilaDateToUtc(dateOnly);
        }
      }
      return value;
    };

    const body = z
      .object({
        inquiry_id: z.string().min(1),
        confirmed_date: z.preprocess(parseDateString, z.date()),
        total_price: z.coerce.number().nonnegative(),
        deposit_paid: z.coerce.number().nonnegative(),
        deposit_due_date: z.preprocess((value) => (value == null ? null : parseDateString(value)), z.date().optional().nullable())
      })
      .parse(req.body);

    const reservation = await prisma.$transaction(async (tx) => {
      const created = await tx.cateringReservation.create({
        data: {
          inquiry_id: body.inquiry_id,
          confirmed_date: body.confirmed_date,
          total_price: body.total_price,
          deposit_paid: body.deposit_paid,
          deposit_due_date: body.deposit_due_date ?? null,
          status: "confirmed"
        }
      });
      await tx.cateringInquiry.update({ where: { id: body.inquiry_id }, data: { status: "confirmed" } });
      return created;
    });

    return res.status(201).json({ reservation });
  } catch (error) {
    return next(error);
  }
});

app.get("/api/staff/catering/reservations", async (req, res, next) => {
  try {
    const user = requireRole(req, res, ["admin", "event_coordinator"]);

    if (!user) {
      return;
    }

    const reservations = await prisma.cateringReservation.findMany({
      include: {
        inquiry: true,
        package: true,
        ingredient_locks: { include: { raw_material: true } },
        payments: { orderBy: { received_at: "asc" } }
      },
      orderBy: { confirmed_date: "asc" }
    });
    return res.json({
      reservations: reservations.map((reservation) => ({
        ...reservation,
        ...paymentSummaryFields(reservation)
      }))
    });
  } catch (error) {
    return next(error);
  }
});

app.get("/api/staff/catering/reservations/:id/ingredient-locks", async (req, res, next) => {
  try {
    const user = requireRole(req, res, ["admin", "event_coordinator"]);

    if (!user) {
      return;
    }

    const locks = await prisma.cateringIngredientLock.findMany({
      where: { catering_reservation_id: req.params.id },
      include: { raw_material: true },
      orderBy: { created_at: "asc" }
    });
    return res.json({ locks });
  } catch (error) {
    return next(error);
  }
});

app.post("/api/staff/catering/ingredient-locks", async (req, res, next) => {
  try {
    const user = requireRole(req, res, ["admin", "event_coordinator"]);

    if (!user) {
      return;
    }

    const body = z
      .object({
        catering_reservation_id: z.string().min(1),
        ingredient_locks: z
          .array(
            z.object({
              raw_material_id: z.string().min(1),
              reserved_quantity: z.coerce.number().positive(),
              unit: z.string().min(1)
            })
          )
          .min(1)
      })
      .parse(req.body);
    const locks = await prisma.cateringIngredientLock.createMany({
      data: body.ingredient_locks.map((lock) => ({
        ...lock,
        catering_reservation_id: body.catering_reservation_id
      }))
    });

    return res.status(201).json({ locks });
  } catch (error) {
    return next(error);
  }
});

async function releaseCateringLocks(
  tx: Prisma.TransactionClient,
  reservationId: string,
  userId?: string,
  reference?: string
) {
  const locks = await tx.cateringIngredientLock.findMany({
    where: { catering_reservation_id: reservationId, is_released: false },
    include: { raw_material: true }
  });

  for (const lock of locks) {
    const nextStock = Math.max(Number(lock.raw_material.current_stock) - lock.reserved_quantity, 0);
    await tx.rawMaterial.update({ where: { id: lock.raw_material_id }, data: { current_stock: nextStock } });
    await tx.inventoryTransaction.create({
      data: {
        raw_material_id: lock.raw_material_id,
        transaction_type: "deduct",
        quantity: lock.reserved_quantity,
        unit: lock.unit,
        reference: reference ?? `Catering reservation ${reservationId}`,
        reason: "catering_event",
        user_id: userId
      }
    });
  }

  await tx.cateringIngredientLock.updateMany({
    where: { catering_reservation_id: reservationId, is_released: false },
    data: { is_released: true, released_at: new Date() }
  });
}

async function completeCateringReservation(req: Request, res: Response, next: NextFunction) {
  try {
    const user = requireRole(req, res, ["admin", "event_coordinator"]);

    if (!user) {
      return;
    }

    const reservation = await prisma.$transaction(async (tx) => {
      const current = await tx.cateringReservation.findUnique({
        where: { id: req.params.id },
        include: { inquiry: true }
      });

      if (!current) {
        throw Object.assign(new Error("Reservation not found"), { statusCode: 404 });
      }

      const hasOpenBalance = Number(current.remaining_balance) > 0 || current.final_payment_status !== "paid";

      if (hasOpenBalance) {
        throw Object.assign(new Error("Cannot complete event until remaining balance is fully settled."), { statusCode: 400 });
      }

      await releaseCateringLocks(
        tx,
        req.params.id,
        user.sub,
        `Catering reservation ${current.reservation_id ?? current.inquiry?.inquiry_id ?? req.params.id}`
      );
      return tx.cateringReservation.update({ where: { id: req.params.id }, data: { status: "completed" } });
    });

    return res.json({ reservation });
  } catch (error) {
    return next(error);
  }
}

app.put("/api/staff/catering/reservations/:id/complete", completeCateringReservation);
app.post("/api/staff/catering/reservations/:id/complete", completeCateringReservation);

app.post("/api/auth/login", async (req, res, next) => {
  try {
    const body = z.object({ email: z.string().email(), password: z.string().min(1) }).parse(req.body);
    const user = await prisma.user.findUnique({ where: { email: body.email } });

    if (!user || !(await bcrypt.compare(body.password, user.password_hash))) {
      return res.status(401).json({ message: "Invalid email or password" });
    }

    const expiresIn = process.env.JWT_EXPIRES_IN ?? "8h";
    const token = jwt.sign(
      { sub: user.id, email: user.email, role: user.role },
      process.env.JWT_SECRET ?? "katana-super-secret-key-change-in-production",
      { expiresIn }
    );

    res.cookie("token", token, {
      httpOnly: true,
      maxAge: 8 * 60 * 60 * 1000,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production"
    });
    return res.json({ token, user: { id: user.id, email: user.email, role: user.role, name: user.name } });
  } catch (error) {
    return next(error);
  }
});

app.get("/api/inventory/materials", async (_req, res, next) => {
  try {
    const materials = await prisma.rawMaterial.findMany({
      where: { is_deleted: false },
      orderBy: { name: "asc" },
      include: {
        catering_ingredient_locks: {
          where: { is_released: false },
          include: {
            catering_reservation: {
              include: { inquiry: true }
            }
          }
        }
      }
    });
    const materialsWithReserved = materials.map((material) => {
      const reserved_quantity = material.catering_ingredient_locks.reduce((total, lock) => total + lock.reserved_quantity, 0);
      const reserved_for = material.catering_ingredient_locks.map((lock) => ({
        id: lock.id,
        reserved_quantity: lock.reserved_quantity,
        unit: lock.unit,
        event_name:
          lock.catering_reservation.inquiry?.package_type ?? "Catering",
        event_date: lock.catering_reservation.confirmed_date,
        customer_name: lock.catering_reservation.inquiry?.customer_name ?? "Unknown",
        venue_address: lock.catering_reservation.inquiry?.venue_type ?? null
      }));
      const { catering_ingredient_locks, ...rest } = material;

      return {
        ...rest,
        reserved_quantity,
        available_quantity: Number(material.current_stock) - reserved_quantity,
        reserved_for
      };
    });
    res.json({ materials: materialsWithReserved });
  } catch (error) {
    next(error);
  }
});

app.get("/api/inventory/materials/low-stock", async (_req, res, next) => {
  try {
    const materials = await prisma.rawMaterial.findMany({
      where: { is_deleted: false },
      orderBy: { name: "asc" }
    });
    res.json({
      materials: materials.filter((material) => Number(material.current_stock) <= Number(material.reorder_level))
    });
  } catch (error) {
    next(error);
  }
});

app.get("/api/inventory/materials/summary", async (_req, res, next) => {
  try {
    const materials = await prisma.rawMaterial.findMany({
      where: { is_deleted: false },
      orderBy: { name: "asc" },
      select: {
        id: true,
        name: true,
        current_stock: true,
        unit: true
      }
    });

    res.json({
      materials,
      summary: materials
    });
  } catch (error) {
    next(error);
  }
});

app.post("/api/inventory/materials", async (req, res, next) => {
  try {
    const user = requireRole(req, res, ["admin"]);

    if (!user) {
      return;
    }

    const body = z
      .object({
        name: z.string().min(1),
        unit: z.string().min(1),
        current_stock: z.coerce.number().nonnegative(),
        reorder_level: z.coerce.number().nonnegative(),
        cost_per_unit: z.coerce.number().nonnegative()
      })
      .parse(req.body);

    const material = await prisma.rawMaterial.create({ data: body });
    return res.status(201).json({ material });
  } catch (error) {
    return next(error);
  }
});

app.put("/api/inventory/materials/:id", async (req, res, next) => {
  try {
    const user = requireRole(req, res, ["admin"]);

    if (!user) {
      return;
    }

    const body = z
      .object({
        name: z.string().min(1),
        unit: z.string().min(1),
        current_stock: z.coerce.number().nonnegative(),
        reorder_level: z.coerce.number().nonnegative(),
        cost_per_unit: z.coerce.number().nonnegative()
      })
      .parse(req.body);
    const material = await prisma.rawMaterial.update({
      where: { id: req.params.id },
      data: body
    });

    return res.json({ material });
  } catch (error) {
    return next(error);
  }
});

app.put("/api/inventory/materials/:id/cost", async (req, res, next) => {
  try {
    const user = requireRole(req, res, ["admin"]);

    if (!user) {
      return;
    }

    const body = z
      .object({
        cost_per_unit: z.coerce.number().nonnegative()
      })
      .parse(req.body);
    const material = await prisma.rawMaterial.update({
      where: { id: req.params.id },
      data: { cost_per_unit: body.cost_per_unit }
    });

    return res.json({ material });
  } catch (error) {
    return next(error);
  }
});

app.delete("/api/inventory/materials/:id", async (req, res, next) => {
  try {
    const user = requireRole(req, res, ["admin"]);

    if (!user) {
      return;
    }

    const material = await prisma.rawMaterial.update({
      where: { id: req.params.id },
      data: { is_deleted: true }
    });

    return res.json({ material });
  } catch (error) {
    return next(error);
  }
});

app.put("/api/inventory/materials/:id/stock", async (req, res, next) => {
  try {
    const user = requireRole(req, res, ["admin", "inventory_manager"]);

    if (!user) {
      return;
    }

    const body = z
      .object({
        type: z.enum(["add", "deduct"]),
        quantity: z.coerce.number().positive(),
        reference: z.string().optional()
      })
      .parse(req.body);
    const material = await prisma.rawMaterial.findFirst({ where: { id: req.params.id, is_deleted: false } });

    if (!material) {
      return res.status(404).json({ message: "Material not found" });
    }

    const currentStock = Number(material.current_stock);
    const nextStock = body.type === "add" ? currentStock + body.quantity : Math.max(currentStock - body.quantity, 0);

    const [updatedMaterial] = await prisma.$transaction([
      prisma.rawMaterial.update({
        where: { id: material.id },
        data: { current_stock: nextStock }
      }),
      prisma.inventoryTransaction.create({
        data: {
          raw_material_id: material.id,
          transaction_type: body.type,
          quantity: body.quantity,
          unit: material.unit,
          reference: body.reference ?? "Quick stock adjustment",
          user_id: user.sub
        }
      })
    ]);

    return res.json({ material: updatedMaterial });
  } catch (error) {
    return next(error);
  }
});

app.get("/api/inventory/transactions", async (req, res, next) => {
  try {
    const materialId = typeof req.query.materialId === "string" ? req.query.materialId : undefined;
    const type = typeof req.query.type === "string" ? req.query.type : undefined;
    const from = typeof req.query.from === "string" ? req.query.from : undefined;
    const to = typeof req.query.to === "string" ? req.query.to : undefined;

    const transactions = await prisma.inventoryTransaction.findMany({
      where: {
        raw_material_id: materialId,
        transaction_type: type || undefined,
        created_at: {
          gte: from ? new Date(from) : undefined,
          lte: to ? new Date(`${to}T23:59:59.999Z`) : undefined
        }
      },
      include: {
        raw_material: true,
        batch: {
          select: { id: true, batch_number: true, expiration_date: true }
        },
        user: {
          select: {
            name: true,
            email: true
          }
        }
      },
      orderBy: { created_at: "desc" }
    });

    res.json({ transactions });
  } catch (error) {
    next(error);
  }
});

app.get("/api/inventory/batches", async (req, res, next) => {
  try {
    const materialId = typeof req.query.materialId === "string" ? req.query.materialId : undefined;
    const includeDisposed = req.query.includeDisposed === "true";
    const expiringWithinDays = typeof req.query.expiringWithinDays === "string"
      ? Number(req.query.expiringWithinDays)
      : undefined;

    const expirationCutoff = expiringWithinDays
      ? new Date(Date.now() + expiringWithinDays * 24 * 60 * 60 * 1000)
      : undefined;

    const batches = await prisma.materialBatch.findMany({
      where: {
        raw_material_id: materialId,
        is_disposed: includeDisposed ? undefined : false,
        remaining_quantity: includeDisposed ? undefined : { gt: 0 },
        expiration_date: expirationCutoff ? { lte: expirationCutoff, not: null } : undefined
      },
      include: {
        raw_material: {
          select: { id: true, name: true, unit: true, current_stock: true }
        }
      },
      orderBy: [{ expiration_date: "asc" }, { received_at: "asc" }]
    });

    const now = new Date();
    const enriched = batches.map((batch) => {
      const daysUntilExpiry = batch.expiration_date
        ? Math.ceil((batch.expiration_date.getTime() - now.getTime()) / (24 * 60 * 60 * 1000))
        : null;

      let expiryStatus: "expired" | "critical" | "warning" | "ok" | "none" = "none";

      if (daysUntilExpiry !== null) {
        if (daysUntilExpiry < 0) {
          expiryStatus = "expired";
        } else if (daysUntilExpiry <= 3) {
          expiryStatus = "critical";
        } else if (daysUntilExpiry <= 7) {
          expiryStatus = "warning";
        } else {
          expiryStatus = "ok";
        }
      }

      return { ...batch, daysUntilExpiry, expiryStatus };
    });

    res.json({ batches: enriched });
  } catch (error) {
    next(error);
  }
});

app.get("/api/inventory/batches/expiring", async (req, res, next) => {
  try {
    const days = typeof req.query.days === "string" ? Number(req.query.days) : 7;
    const cutoff = new Date(Date.now() + days * 24 * 60 * 60 * 1000);

    const batches = await prisma.materialBatch.findMany({
      where: {
        is_disposed: false,
        remaining_quantity: { gt: 0 },
        expiration_date: { lte: cutoff, not: null }
      },
      include: {
        raw_material: { select: { id: true, name: true, unit: true } }
      },
      orderBy: { expiration_date: "asc" }
    });

    res.json({ batches, days });
  } catch (error) {
    next(error);
  }
});

app.post("/api/inventory/batches", async (req, res, next) => {
  try {
    const user = requireRole(req, res, ["admin", "inventory_manager"]);

    if (!user) {
      return;
    }

    const body = z
      .object({
        raw_material_id: z.string().min(1),
        batch_number: z.string().min(1),
        quantity: z.coerce.number().positive(),
        expiration_date: z.string().optional(),
        cost_per_unit: z.coerce.number().nonnegative().optional(),
        notes: z.string().optional()
      })
      .parse(req.body);

    const material = await prisma.rawMaterial.findFirst({
      where: { id: body.raw_material_id, is_deleted: false }
    });

    if (!material) {
      return res.status(404).json({ message: "Material not found" });
    }

    const existingBatch = await prisma.materialBatch.findUnique({
      where: {
        raw_material_id_batch_number: {
          raw_material_id: body.raw_material_id,
          batch_number: body.batch_number
        }
      }
    });

    if (existingBatch) {
      return res.status(409).json({ message: "Batch number already exists for this material" });
    }

    const [batch, updatedMaterial] = await prisma.$transaction(async (tx) => {
      const created = await tx.materialBatch.create({
        data: {
          raw_material_id: body.raw_material_id,
          batch_number: body.batch_number,
          quantity: body.quantity,
          remaining_quantity: body.quantity,
          expiration_date: body.expiration_date ? new Date(body.expiration_date) : null,
          cost_per_unit: body.cost_per_unit ?? material.cost_per_unit,
          notes: body.notes
        },
        include: { raw_material: true }
      });

      const updated = await tx.rawMaterial.update({
        where: { id: material.id },
        data: { current_stock: Number(material.current_stock) + body.quantity }
      });

      await tx.inventoryTransaction.create({
        data: {
          raw_material_id: material.id,
          batch_id: created.id,
          transaction_type: "add",
          quantity: body.quantity,
          unit: material.unit,
          reference: `Batch ${body.batch_number} received`,
          reason: "receive",
          user_id: user.sub
        }
      });

      return [created, updated];
    });

    await captureInventorySnapshot();

    return res.status(201).json({ batch, material: updatedMaterial });
  } catch (error) {
    return next(error);
  }
});

app.post("/api/inventory/waste", async (req, res, next) => {
  try {
    const user = requireRole(req, res, ["admin", "inventory_manager"]);

    if (!user) {
      return;
    }

    const body = z
      .object({
        raw_material_id: z.string().min(1),
        quantity: z.coerce.number().positive(),
        reason: z.enum(["spoilage", "expired", "prep_waste", "damaged", "other"]),
        notes: z.string().optional(),
        batch_id: z.string().optional()
      })
      .parse(req.body);

    const material = await prisma.rawMaterial.findFirst({
      where: { id: body.raw_material_id, is_deleted: false }
    });

    if (!material) {
      return res.status(404).json({ message: "Material not found" });
    }

    if (Number(material.current_stock) < body.quantity) {
      return res.status(400).json({ message: "Insufficient stock to dispose" });
    }

    const result = await prisma.$transaction(async (tx) => {
      const wasteTransactions: Array<{ batchId: string | null; quantity: number }> = [];

      if (body.batch_id) {
        const batch = await tx.materialBatch.findFirst({
          where: {
            id: body.batch_id,
            raw_material_id: material.id,
            is_disposed: false
          }
        });

        if (!batch) {
          throw new Error("BATCH_NOT_FOUND");
        }

        if (Number(batch.remaining_quantity) < body.quantity) {
          throw new Error("INSUFFICIENT_BATCH_STOCK");
        }

        const nextRemaining = Number(batch.remaining_quantity) - body.quantity;
        await tx.materialBatch.update({
          where: { id: batch.id },
          data: {
            remaining_quantity: nextRemaining,
            is_disposed: nextRemaining <= 0
          }
        });

        wasteTransactions.push({ batchId: batch.id, quantity: body.quantity });
      } else {
        const deductions = await deductFromBatchesFEFO(tx, material.id, body.quantity);
        wasteTransactions.push(...deductions.map((d) => ({ batchId: d.batchId, quantity: d.quantity })));

        if (wasteTransactions.length === 0) {
          wasteTransactions.push({ batchId: null, quantity: body.quantity });
        }
      }

      const updatedMaterial = await tx.rawMaterial.update({
        where: { id: material.id },
        data: { current_stock: Math.max(Number(material.current_stock) - body.quantity, 0) }
      });

      const reasonLabels: Record<string, string> = {
        spoilage: "Spoilage",
        expired: "Expired",
        prep_waste: "Prep waste",
        damaged: "Damaged",
        other: "Other"
      };

      const transactions = await Promise.all(
        wasteTransactions.map((entry) =>
          tx.inventoryTransaction.create({
            data: {
              raw_material_id: material.id,
              batch_id: entry.batchId,
              transaction_type: "waste",
              quantity: entry.quantity,
              unit: material.unit,
              reference: body.notes ?? `${reasonLabels[body.reason]} disposal`,
              reason: body.reason,
              user_id: user.sub
            },
            include: {
              raw_material: true,
              batch: true,
              user: { select: { name: true, email: true } }
            }
          })
        )
      );

      return { material: updatedMaterial, transactions };
    });

    await captureInventorySnapshot();

    return res.status(201).json(result);
  } catch (error) {
    if (error instanceof Error) {
      if (error.message === "BATCH_NOT_FOUND") {
        return res.status(404).json({ message: "Batch not found" });
      }

      if (error.message === "INSUFFICIENT_BATCH_STOCK") {
        return res.status(400).json({ message: "Insufficient quantity in selected batch" });
      }
    }

    return next(error);
  }
});

app.get("/api/analytics/product-insights", async (req, res, next) => {
  try {
    const user = requireRole(req, res, ["admin", "inventory_manager"]);

    if (!user) {
      return;
    }

    const days = typeof req.query.days === "string" ? Number(req.query.days) : 30;
    const fromDate = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
    const midDate = new Date(Date.now() - Math.floor(days / 2) * 24 * 60 * 60 * 1000);

    const [posItems, unlimitedItems, products] = await Promise.all([
      prisma.posItem.findMany({
        where: { transaction: { created_at: { gte: fromDate }, status: { not: "refunded" } } },
        include: {
          selling_product: { select: { id: true, name: true, category: true, price: true } },
          transaction: { select: { created_at: true } }
        }
      }),
      prisma.unlimitedOrderItem.findMany({
        where: { deducted_at: { gte: fromDate } },
        include: {
          selling_product: { select: { id: true, name: true, category: true, price: true } }
        }
      }),
      prisma.sellingProduct.findMany({
        where: { is_deleted: false },
        select: { id: true, name: true, category: true, price: true, is_available: true }
      })
    ]);

    type ProductStats = {
      productId: string;
      name: string;
      category: string;
      price: number;
      totalQuantity: number;
      totalRevenue: number;
      recentQuantity: number;
      priorQuantity: number;
    };

    const statsMap = new Map<string, ProductStats>();

    for (const product of products) {
      statsMap.set(product.id, {
        productId: product.id,
        name: product.name,
        category: product.category,
        price: Number(product.price),
        totalQuantity: 0,
        totalRevenue: 0,
        recentQuantity: 0,
        priorQuantity: 0
      });
    }

    for (const item of posItems) {
      const stats = statsMap.get(item.selling_product_id);

      if (!stats) {
        continue;
      }

      stats.totalQuantity += item.quantity;
      stats.totalRevenue += item.total_price;

      if (item.transaction.created_at >= midDate) {
        stats.recentQuantity += item.quantity;
      } else {
        stats.priorQuantity += item.quantity;
      }
    }

    for (const item of unlimitedItems) {
      const stats = statsMap.get(item.selling_product_id);

      if (!stats) {
        continue;
      }

      stats.totalQuantity += item.quantity;
      stats.totalRevenue += item.quantity * Number(item.selling_product.price);

      if (item.deducted_at >= midDate) {
        stats.recentQuantity += item.quantity;
      } else {
        stats.priorQuantity += item.quantity;
      }
    }

    const ranked = Array.from(statsMap.values())
      .filter((s) => s.totalQuantity > 0)
      .sort((a, b) => b.totalQuantity - a.totalQuantity)
      .map((stats, index) => {
        const trend = stats.priorQuantity > 0
          ? ((stats.recentQuantity - stats.priorQuantity) / stats.priorQuantity) * 100
          : stats.recentQuantity > 0
          ? 100
          : 0;
        const frequencyRank = index + 1;
        const totalSoldProducts = statsMap.size;
        const percentile = totalSoldProducts > 0 ? ((totalSoldProducts - frequencyRank) / totalSoldProducts) * 100 : 0;

        let priority: "high" | "medium" | "low" | "minimal" = "minimal";
        let insight = "";

        if (frequencyRank <= 5) {
          priority = "high";
          insight = "Top seller — ensure ingredients are always stocked and prominently featured.";
        } else if (frequencyRank <= 15) {
          priority = "medium";
          insight = "Consistent performer — maintain stock levels and consider combo promotions.";
        } else if (frequencyRank <= 30) {
          priority = "low";
          insight = "Moderate demand — monitor trends before increasing inventory.";
        } else {
          priority = "minimal";
          insight = "Low frequency — review menu placement or consider reducing prep quantities.";
        }

        if (trend > 20) {
          insight += " Trending up — demand is increasing.";
        } else if (trend < -20) {
          insight += " Trending down — consider promotions or review quality.";
        }

        return {
          ...stats,
          frequencyRank,
          percentile: Math.round(percentile),
          trend: Math.round(trend),
          priority,
          insight,
          avgDailySales: Math.round((stats.totalQuantity / days) * 10) / 10
        };
      });

    const unsold = Array.from(statsMap.values())
      .filter((s) => s.totalQuantity === 0)
      .map((s) => ({ productId: s.productId, name: s.name, category: s.category }));

    return res.json({
      periodDays: days,
      totalProductsSold: ranked.length,
      products: ranked,
      unsoldProducts: unsold,
      summary: {
        topSeller: ranked[0] ?? null,
        leastSold: ranked[ranked.length - 1] ?? null,
        totalUnitsSold: ranked.reduce((sum, p) => sum + p.totalQuantity, 0),
        totalRevenue: ranked.reduce((sum, p) => sum + p.totalRevenue, 0)
      }
    });
  } catch (error) {
    return next(error);
  }
});

app.get("/api/analytics/overview", async (req, res, next) => {
  try {
    const user = requireRole(req, res, ["admin", "inventory_manager"]);

    if (!user) {
      return;
    }

    const days = typeof req.query.days === "string" ? Number(req.query.days) : 30;
    const fromDate = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

    const [wasteTransactions, expiringBatches, expiredBatches, posTransactions, unlimitedSessions] = await Promise.all([
      prisma.inventoryTransaction.findMany({
        where: { transaction_type: "waste", created_at: { gte: fromDate } },
        include: { raw_material: { select: { name: true, cost_per_unit: true } } }
      }),
      prisma.materialBatch.count({
        where: {
          is_disposed: false,
          remaining_quantity: { gt: 0 },
          expiration_date: {
            lte: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
            gte: new Date()
          }
        }
      }),
      prisma.materialBatch.count({
        where: {
          is_disposed: false,
          remaining_quantity: { gt: 0 },
          expiration_date: { lt: new Date() }
        }
      }),
      prisma.posTransaction.findMany({
        where: { created_at: { gte: fromDate }, status: { not: "refunded" } },
        select: { total: true, created_at: true }
      }),
      prisma.unlimitedSession.findMany({
        where: { created_at: { gte: fromDate } },
        include: { leftover_items: true }
      })
    ]);

    const wasteByReason: Record<string, { count: number; quantity: number; cost: number }> = {};
    let totalWasteCost = 0;

    for (const tx of wasteTransactions) {
      const reason = tx.reason ?? "other";
      wasteByReason[reason] ??= { count: 0, quantity: 0, cost: 0 };
      wasteByReason[reason].count += 1;
      wasteByReason[reason].quantity += Number(tx.quantity);
      const cost = Number(tx.quantity) * Number(tx.raw_material.cost_per_unit);
      wasteByReason[reason].cost += cost;
      totalWasteCost += cost;
    }

    const dailySales: Record<string, number> = {};

    for (const tx of posTransactions) {
      const key = manilaDateKey(tx.created_at);
      dailySales[key] = (dailySales[key] ?? 0) + tx.total;
    }

    for (const session of unlimitedSessions) {
      const key = manilaDateKey(session.created_at);
      const total = session.total_paid + session.leftover_items.reduce((sum, item) => sum + item.charge_amount, 0);
      dailySales[key] = (dailySales[key] ?? 0) + total;
    }

    const salesTrend = Object.entries(dailySales)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([date, total]) => ({ date, total: Math.round(total * 100) / 100 }));

    return res.json({
      periodDays: days,
      waste: {
        totalTransactions: wasteTransactions.length,
        totalCost: Math.round(totalWasteCost * 100) / 100,
        byReason: wasteByReason
      },
      expiry: {
        expiringWithin7Days: expiringBatches,
        alreadyExpired: expiredBatches
      },
      salesTrend
    });
  } catch (error) {
    return next(error);
  }
});

app.get("/api/analytics/inventory-history", async (req, res, next) => {
  try {
    const user = requireRole(req, res, ["admin", "inventory_manager"]);

    if (!user) {
      return;
    }

    const from = typeof req.query.from === "string" ? req.query.from : undefined;
    const to = typeof req.query.to === "string" ? req.query.to : undefined;
    const materialId = typeof req.query.materialId === "string" ? req.query.materialId : undefined;

    await captureInventorySnapshot();

    const snapshots = await prisma.inventorySnapshot.findMany({
      where: {
        raw_material_id: materialId,
        snapshot_date: manilaDateRange(from, to)
      },
      include: {
        raw_material: { select: { id: true, name: true, unit: true } }
      },
      orderBy: [{ snapshot_date: "asc" }, { raw_material: { name: "asc" } }]
    });

    const byDate = new Map<string, { date: string; totalValue: number; totalQuantity: number; materials: typeof snapshots }>();

    for (const snapshot of snapshots) {
      const dateKey = manilaDateKey(snapshot.snapshot_date);
      const entry = byDate.get(dateKey) ?? { date: dateKey, totalValue: 0, totalQuantity: 0, materials: [] };
      entry.totalValue += Number(snapshot.total_value);
      entry.totalQuantity += Number(snapshot.quantity);
      entry.materials.push(snapshot);
      byDate.set(dateKey, entry);
    }

    const wasteHistory = await prisma.inventoryTransaction.findMany({
      where: {
        transaction_type: "waste",
        raw_material_id: materialId,
        created_at: manilaDateRange(from, to)
          ? {
              gte: from ? startOfDay(manilaDateToUtc(from)) : undefined,
              lte: to ? endOfDay(manilaDateToUtc(to)) : undefined
            }
          : undefined
      },
      include: {
        raw_material: { select: { name: true, unit: true } },
        user: { select: { name: true } }
      },
      orderBy: { created_at: "desc" },
      take: 100
    });

    return res.json({
      snapshots: Array.from(byDate.values()),
      wasteHistory
    });
  } catch (error) {
    return next(error);
  }
});

app.get("/api/inventory/yield", async (_req, res, next) => {
  try {
    const [materials, products, conversionRules] = await Promise.all([
      prisma.rawMaterial.findMany({ where: { is_deleted: false } }),
      prisma.sellingProduct.findMany({
        where: { is_deleted: false },
        orderBy: [{ category: "asc" }, { name: "asc" }],
        include: {
          recipes: {
            include: {
              recipe_ingredients: {
                include: {
                  raw_material: true
                }
              }
            }
          }
        }
      }),
      prisma.conversionRule.findMany()
    ]);
    const conversionFor = (materialName: string) => {
      const normalizedName = materialName.toLowerCase();
      return conversionRules.find((rule) => {
        const searchable = `${rule.name} ${rule.from_unit} ${rule.to_unit}`.toLowerCase();
        return searchable.includes(normalizedName);
      });
    };
    const effectiveStock = (material: (typeof materials)[number]) => {
      const rule = conversionFor(material.name);

      if (!rule) {
        return Number(material.current_stock);
      }

      return Number(material.current_stock) * (Number(rule.to_quantity) / Number(rule.from_quantity));
    };
    const nonBeverageProducts = products.filter((product) => product.category.toLowerCase() !== "beverage");
    const productsWithYield = nonBeverageProducts.map((product) => {
      const ingredients = product.recipes[0]?.recipe_ingredients ?? [];
      const calculations = ingredients.map((ingredient) => ({
        ingredient: ingredient.raw_material.name,
        currentStock: effectiveStock(ingredient.raw_material),
        requiredPerPortion: Number(ingredient.quantity_per_yield),
        maxPortions: Math.floor(effectiveStock(ingredient.raw_material) / Number(ingredient.quantity_per_yield))
      }));
      const limiting =
        calculations.length > 0
          ? calculations.reduce((lowest, item) => (item.maxPortions < lowest.maxPortions ? item : lowest))
          : { ingredient: "No recipe", currentStock: 0, requiredPerPortion: 0, maxPortions: 0 };

      return {
        id: product.id,
        name: product.name,
        category: product.category,
        maxPortions: Math.max(limiting.maxPortions, 0),
        limitingIngredient: limiting.ingredient,
        limitingStock: limiting.currentStock,
        requiredPerPortion: limiting.requiredPerPortion,
        potentialRevenue: Math.max(limiting.maxPortions, 0) * Number(product.price)
      };
    });
    const bottleneckCounts = productsWithYield.reduce<Record<string, number>>((acc, item) => {
      acc[item.limitingIngredient] = (acc[item.limitingIngredient] ?? 0) + 1;
      return acc;
    }, {});
    const [ingredient = "No recipe", affectedProducts = 0] =
      Object.entries(bottleneckCounts).sort((a, b) => b[1] - a[1])[0] ?? [];
    const affectedProductNames = productsWithYield
      .filter((product) => product.limitingIngredient === ingredient)
      .map((product) => product.name);
    const stockSummary = materials
      .filter((material) => ["Rice", "Salmon", "Tuna", "Nori"].includes(material.name))
      .map((material) => ({
        name: conversionFor(material.name)?.to_unit ?? material.name,
        current: effectiveStock(material),
        unit: material.unit
      }));

    res.json({
      products: productsWithYield,
      globalBottleneck: {
        ingredient,
        affectedProducts: affectedProductNames,
        suggestion:
          affectedProducts > 0
            ? `Order 2 ${ingredient} units to increase production across ${affectedProducts} products`
            : "No bottleneck detected"
      },
      stockSummary,
      productYields: productsWithYield.map((product) => ({
        product_id: product.id,
        product_name: product.name,
        category: product.category,
        max_portions: product.maxPortions,
        limiting_ingredient: product.limitingIngredient,
        potential_revenue: product.potentialRevenue
      }))
    });
  } catch (error) {
    next(error);
  }
});

app.get("/api/inventory/conversion-rules", async (_req, res, next) => {
  try {
    const rules = await prisma.conversionRule.findMany({ orderBy: { name: "asc" } });
    res.json({ rules });
  } catch (error) {
    next(error);
  }
});

app.put("/api/inventory/conversion-rules/:materialId", async (req, res, next) => {
  try {
    const user = requireRole(req, res, ["admin"]);

    if (!user) {
      return;
    }

    const body = z
      .object({
        name: z.string().min(1).optional(),
        from_quantity: z.coerce.number().positive(),
        from_unit: z.string().min(1),
        to_quantity: z.coerce.number().positive(),
        to_unit: z.string().min(1)
      })
      .parse(req.body);
    const rule = await prisma.conversionRule.update({
      where: { id: req.params.materialId },
      data: body
    });

    return res.json({ rule });
  } catch (error) {
    return next(error);
  }
});

app.get("/api/products", async (_req, res, next) => {
  try {
    // Lightweight product list for unauthenticated customer requests
    const requestingUser = getUserFromRequest(_req);

    if (!requestingUser) {
      const products = await prisma.sellingProduct.findMany({
        where: { is_deleted: false },
        orderBy: [{ category: "asc" }, { name: "asc" }],
        select: {
          id: true,
          name: true,
          category: true,
          price: true,
          is_available: true,
          image_url: true,
          description: true
        }
      });

      const productsWithImageUrls = products.map((product) => ({
        ...product,
        image_url: product.image_url ?? null,
        imageUrl: product.image_url ?? null
      }));

      return res.json({ products: productsWithImageUrls });
    }

    // Authenticated/staff requests: include recipes for inventory management
    const products = await prisma.sellingProduct.findMany({
      where: { is_deleted: false },
      orderBy: [{ category: "asc" }, { name: "asc" }],
      include: {
        recipes: {
          include: {
            recipe_ingredients: {
              include: {
                raw_material: true
              },
              orderBy: {
                raw_material: {
                  name: "asc"
                }
              }
            }
          }
        }
      }
    });

    const productsWithImageUrls = products.map((product) => ({
      ...product,
      image_url: product.image_url ?? null,
      imageUrl: product.image_url ?? null
    }));

    res.json({ products: productsWithImageUrls });
  } catch (error) {
    next(error);
  }
});

app.post("/api/products", upload.single("imageFile"), async (req, res, next) => {
  try {
    const user = requireRole(req, res, ["admin"]);

    if (!user) {
      return;
    }

    const body = z
      .object({
        name: z.string().min(1),
        category: z.string().min(1),
        price: z.coerce.number().nonnegative(),
        description: z.string().optional(),
        is_available: z.coerce.boolean().optional(),
        image_url: z.string().optional().nullable()
      })
      .parse(req.body);

    const uploadedImagePath = req.file ? `/uploads/products/${req.file.filename}` : body.image_url ?? null;

    const product = await prisma.sellingProduct.create({
      data: {
        name: body.name,
        category: body.category,
        price: body.price,
        description: body.description || null,
        image_url: uploadedImagePath,
        is_available: body.is_available ?? true,
        recipes: {
          create: {
            total_yield_quantity: 1,
            yield_unit: "serving"
          }
        }
      }
    });

    return res.status(201).json({ product });
  } catch (error) {
    return next(error);
  }
});

app.put("/api/products/:id", upload.single("imageFile"), async (req, res, next) => {
  try {
    const user = requireRole(req, res, ["admin"]);

    if (!user) {
      return;
    }

    const body = z
      .object({
        name: z.string().min(1).optional(),
        category: z.string().min(1).optional(),
        price: z.coerce.number().nonnegative().optional(),
        description: z.string().optional(),
        is_available: z.coerce.boolean().optional(),
        image_url: z.string().optional().nullable()
      })
      .parse(req.body);

    const updateData: any = {
      name: body.name,
      category: body.category,
      price: body.price,
      description: body.description,
      is_available: body.is_available
    };

    if (req.file) {
      updateData.image_url = `/uploads/products/${req.file.filename}`;
    } else if (body.image_url !== undefined) {
      updateData.image_url = body.image_url;
    }

    const product = await prisma.sellingProduct.update({
      where: { id: req.params.id },
      data: updateData
    });

    return res.json({ product });
  } catch (error) {
    return next(error);
  }
});

app.delete("/api/products/:id", async (req, res, next) => {
  try {
    const user = requireRole(req, res, ["admin"]);

    if (!user) {
      return;
    }

    const product = await prisma.sellingProduct.update({
      where: { id: req.params.id },
      data: { is_deleted: true, is_available: false }
    });

    return res.json({ product });
  } catch (error) {
    return next(error);
  }
});

app.get("/api/products/grouped", async (_req, res, next) => {
  try {
    const products = await prisma.sellingProduct.findMany({
      where: { is_deleted: false },
      include: {
        recipes: {
          include: {
            recipe_ingredients: {
              include: {
                raw_material: true
              },
              orderBy: {
                raw_material: {
                  name: "asc"
                }
              }
            }
          }
        }
      }
    });

    const productsWithImageUrls = products.map((product) => ({
      ...product,
      image_url: product.image_url ?? null,
      imageUrl: product.image_url ?? null
    }));

    const groups = menuCategoryOrder.map((category) => ({
      category,
      products: productsWithImageUrls
        .filter((product) => product.category === category)
        .sort((a, b) => a.name.localeCompare(b.name))
    }));

    res.json({ groups });
  } catch (error) {
    next(error);
  }
});

app.get("/api/tables", async (_req, res, next) => {
  try {
    const tables = await prisma.table.findMany({ orderBy: { table_number: "asc" } });
    res.json({ tables });
  } catch (error) {
    next(error);
  }
});

function normalizeRecipeUnit(unit: string) {
  const normalized = unit.trim().toLowerCase();

  if (normalized === "gram" || normalized === "grams") {
    return "g";
  }

  if (normalized === "kilogram" || normalized === "kilograms") {
    return "kg";
  }

  if (normalized === "milliliter" || normalized === "milliliters" || normalized === "millilitre" || normalized === "millilitres") {
    return "ml";
  }

  if (normalized === "l" || normalized === "liter" || normalized === "liters" || normalized === "litre" || normalized === "litres") {
    return "liters";
  }

  if (normalized === "piece") {
    return "pieces";
  }

  if (normalized === "sheet") {
    return "sheets";
  }

  return normalized;
}

function calculateIngredientCost(quantity: number, ingredientUnit: string, material: { unit: string; cost_per_unit: unknown }) {
  return convertQuantityToMaterialUnit(quantity, ingredientUnit, material.unit) * Number(material.cost_per_unit);
}

function convertQuantityToMaterialUnit(quantity: number, ingredientUnit: string, materialUnit: string) {
  const normalizedIngredientUnit = normalizeRecipeUnit(ingredientUnit);
  const normalizedMaterialUnit = normalizeRecipeUnit(materialUnit);

  if (normalizedIngredientUnit === normalizedMaterialUnit) {
    return quantity;
  }

  if (
    normalizedIngredientUnit === "g" &&
    normalizedMaterialUnit === "kg"
  ) {
    return quantity / 1000;
  }

  if (
    normalizedIngredientUnit === "kg" &&
    normalizedMaterialUnit === "g"
  ) {
    return quantity * 1000;
  }

  if (
    normalizedIngredientUnit === "ml" &&
    normalizedMaterialUnit === "liters"
  ) {
    return quantity / 1000;
  }

  if (
    normalizedIngredientUnit === "liters" &&
    normalizedMaterialUnit === "ml"
  ) {
    return quantity * 1000;
  }

  return quantity;
}

function formatRecipeDetail(recipe: NonNullable<Awaited<ReturnType<typeof getRecipeWithDetails>>>) {
  const sellingPrice = Number(recipe.selling_product.price);
  const ingredients = recipe.recipe_ingredients.map((ingredient) => {
    const quantity = Number(ingredient.quantity_per_yield);

    return {
      id: ingredient.id,
      rawMaterialId: ingredient.raw_material_id,
      rawMaterialName: ingredient.raw_material.name,
      rawMaterialUnit: ingredient.raw_material.unit,
      rawMaterialCostPerUnit: Number(ingredient.raw_material.cost_per_unit),
      quantity,
      unit: ingredient.unit,
      costPerPortion: calculateIngredientCost(quantity, ingredient.unit, ingredient.raw_material)
    };
  });
  const totalIngredientCost = ingredients.reduce((total, ingredient) => total + ingredient.costPerPortion, 0);

  return {
    productId: recipe.selling_product.id,
    productName: recipe.selling_product.name,
    sellingPrice,
    ingredients,
    totalIngredientCost,
    profitMargin: sellingPrice > 0 ? ((sellingPrice - totalIngredientCost) / sellingPrice) * 100 : 0
  };
}

function getRecipeWithDetails(productId: string) {
  return prisma.recipe.findFirst({
    where: {
      selling_product_id: productId
    },
    include: {
      selling_product: true,
      recipe_ingredients: {
        include: {
          raw_material: true
        },
        orderBy: {
          raw_material: {
            name: "asc"
          }
        }
      }
    }
  });
}

app.get("/api/products/:id/recipe", async (req, res, next) => {
  try {
    const recipe = await getRecipeWithDetails(req.params.id);

    if (!recipe) {
      return res.status(404).json({ message: "Recipe not found" });
    }

    return res.json({ ...formatRecipeDetail(recipe), recipe });
  } catch (error) {
    return next(error);
  }
});

app.post("/api/products/:id/recipe", async (req, res, next) => {
  try {
    const user = requireRole(req, res, ["admin"]);

    if (!user) {
      return;
    }

    const body = z
      .object({
        ingredients: z.array(
          z.object({
            rawMaterialId: z.string().min(1),
            quantity: z.coerce.number().positive(),
            unit: z.string().min(1)
          })
        )
      })
      .parse(req.body);
    const product = await prisma.sellingProduct.findFirst({
      where: { id: req.params.id, is_deleted: false },
      include: { recipes: true }
    });

    if (!product) {
      return res.status(404).json({ message: "Product not found" });
    }

    if (product.category.toLowerCase() !== "beverage" && body.ingredients.length === 0) {
      return res.status(400).json({ message: "Recipe ingredients are required for non-beverage products" });
    }

    const materialIds = body.ingredients.map((ingredient) => ingredient.rawMaterialId);
    const materials = await prisma.rawMaterial.findMany({
      where: { id: { in: materialIds }, is_deleted: false }
    });
    const materialsById = new Map(materials.map((material) => [material.id, material]));

    const invalidIngredient = body.ingredients.find((ingredient) => {
      const material = materialsById.get(ingredient.rawMaterialId);
      return !material;
    });

    if (invalidIngredient) {
      return res.status(400).json({ message: "Selected recipe material no longer exists" });
    }

    const recipe = await prisma.$transaction(async (tx) => {
      const existingRecipe =
        product.recipes[0] ??
        (await tx.recipe.create({
          data: {
            selling_product_id: product.id,
            total_yield_quantity: 1,
            yield_unit: "serving"
          }
        }));

      await tx.recipeIngredient.deleteMany({ where: { recipe_id: existingRecipe.id } });

      if (body.ingredients.length > 0) {
        await tx.recipeIngredient.createMany({
          data: body.ingredients.map((ingredient) => ({
            recipe_id: existingRecipe.id,
            raw_material_id: ingredient.rawMaterialId,
            quantity_per_yield: ingredient.quantity,
            unit: ingredient.unit
          }))
        });
      }

      return existingRecipe;
    });

    const updatedRecipe = await getRecipeWithDetails(product.id);

    if (!updatedRecipe) {
      return res.status(404).json({ message: "Recipe not found" });
    }

    return res.status(201).json({ ...formatRecipeDetail(updatedRecipe), recipe });
  } catch (error) {
    return next(error);
  }
});

app.put("/api/products/:id/recipe", async (req, res, next) => {
  try {
    const user = requireRole(req, res, ["admin"]);

    if (!user) {
      return;
    }

    const body = z
      .object({
        ingredients: z.array(
          z.object({
            id: z.string().min(1).optional(),
            rawMaterialId: z.string().min(1).optional(),
            quantity: z.coerce.number().positive().optional(),
            quantity_per_yield: z.coerce.number().positive().optional(),
            unit: z.string().min(1)
          })
            .refine((ingredient) => ingredient.id || ingredient.rawMaterialId, "Ingredient id or rawMaterialId is required")
            .refine((ingredient) => ingredient.quantity ?? ingredient.quantity_per_yield, "Quantity is required")
        )
      })
      .parse(req.body);
    const recipe = await prisma.recipe.findFirst({
      where: { selling_product_id: req.params.id },
      include: { recipe_ingredients: true }
    });

    if (!recipe) {
      return res.status(404).json({ message: "Recipe not found" });
    }

    const recipeIngredientIds = new Set(recipe.recipe_ingredients.map((ingredient) => ingredient.id));
    const recipeIngredientMaterialIds = new Set(recipe.recipe_ingredients.map((ingredient) => ingredient.raw_material_id));
    const invalidIngredient = body.ingredients.find((ingredient) => {
      if (ingredient.id) {
        return !recipeIngredientIds.has(ingredient.id);
      }

      return !ingredient.rawMaterialId || !recipeIngredientMaterialIds.has(ingredient.rawMaterialId);
    });

    if (invalidIngredient) {
      return res.status(400).json({ message: "Ingredient does not belong to this product recipe" });
    }

    await prisma.$transaction(
      body.ingredients.map((ingredient) => {
        const existingIngredient = recipe.recipe_ingredients.find((recipeIngredient) =>
          ingredient.id ? recipeIngredient.id === ingredient.id : recipeIngredient.raw_material_id === ingredient.rawMaterialId
        );

        if (!existingIngredient) {
          throw new Error("Recipe ingredient not found");
        }

        return prisma.recipeIngredient.update({
          where: { id: existingIngredient.id },
          data: {
            quantity_per_yield: ingredient.quantity ?? ingredient.quantity_per_yield,
            unit: ingredient.unit
          }
        });
      })
    );

    const updatedRecipe = await getRecipeWithDetails(req.params.id);

    if (!updatedRecipe) {
      return res.status(404).json({ message: "Recipe not found" });
    }

    return res.json({ ...formatRecipeDetail(updatedRecipe), recipe: updatedRecipe });
  } catch (error) {
    return next(error);
  }
});

const posItemSchema = z.object({
  productId: z.string().min(1),
  quantity: z.coerce.number().int().positive(),
  unitPrice: z.coerce.number().nonnegative().optional()
});

async function createUniqueTransactionNumber() {
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const transactionNumber = generateTransactionNumber();
    const existing = await prisma.posTransaction.findUnique({
      where: { transaction_number: transactionNumber },
      select: { id: true }
    });

    if (!existing) {
      return transactionNumber;
    }
  }

  throw new Error("Unable to generate unique transaction number");
}

app.post("/api/pos/transaction", async (req, res, next) => {
  try {
    const user = requireRole(req, res, ["admin", "cashier"]);

    if (!user) {
      return;
    }

    const body = z
      .object({
        customerName: z.string().optional(),
        transactionType: z.enum(["dine_in", "takeout", "unlimited"]),
        paymentMethod: z.enum(["cash", "gcash", "bank_transfer"]),
        cashReceived: z.coerce.number().nonnegative().optional(),
        items: z.array(posItemSchema).min(1)
      })
      .parse(req.body);
    const products = await prisma.sellingProduct.findMany({
      where: { id: { in: body.items.map((item) => item.productId) }, is_deleted: false },
      include: {
        recipes: {
          include: {
            recipe_ingredients: {
              include: {
                raw_material: true
              }
            }
          }
        }
      }
    });
    const productsById = new Map(products.map((product) => [product.id, product]));
    const missingItem = body.items.find((item) => !productsById.has(item.productId));

    if (missingItem) {
      return res.status(400).json({ message: "One or more products were not found" });
    }

    const subtotal = body.items.reduce((total, item) => {
      const product = productsById.get(item.productId);
      const unitPrice = item.unitPrice ?? Number(product?.price ?? 0);
      return total + unitPrice * item.quantity;
    }, 0);
    const tax = Number((subtotal * 0.12).toFixed(2));
    const total = Number((subtotal + tax).toFixed(2));

    if (body.paymentMethod === "cash" && Number(body.cashReceived ?? 0) < total) {
      return res.status(400).json({ message: "Cash received must be at least the total amount" });
    }

    const transactionNumber = await createUniqueTransactionNumber();
    const transaction = await prisma.$transaction(async (tx) => {
      const stockByMaterialId = new Map<string, number>();
      const createdTransaction = await tx.posTransaction.create({
        data: {
          transaction_number: transactionNumber,
          customer_name: body.customerName || null,
          transaction_type: body.transactionType,
          subtotal,
          tax,
          total,
          payment_method: body.paymentMethod,
          cash_received: body.paymentMethod === "cash" ? body.cashReceived ?? 0 : null,
          change_due: body.paymentMethod === "cash" ? Number(((body.cashReceived ?? 0) - total).toFixed(2)) : null,
          status: "paid",
          cashier_id: user.sub,
          items: {
            create: body.items.map((item) => {
              const product = productsById.get(item.productId);
              const unitPrice = item.unitPrice ?? Number(product?.price ?? 0);

              return {
                selling_product_id: item.productId,
                quantity: item.quantity,
                unit_price: unitPrice,
                total_price: Number((unitPrice * item.quantity).toFixed(2))
              };
            })
          }
        },
        include: {
          cashier: { select: { id: true, name: true, email: true } },
          items: { include: { selling_product: true } }
        }
      });

      for (const item of body.items) {
        const product = productsById.get(item.productId);
        const recipeIngredients = product?.recipes[0]?.recipe_ingredients ?? [];

        for (const ingredient of recipeIngredients) {
          const material = ingredient.raw_material;
          const deduction = convertQuantityToMaterialUnit(
            Number(ingredient.quantity_per_yield) * item.quantity,
            ingredient.unit,
            material.unit
          );
          const currentStock = stockByMaterialId.get(material.id) ?? Number(material.current_stock);
          const nextStock = Math.max(currentStock - deduction, 0);

          await tx.rawMaterial.update({
            where: { id: material.id },
            data: { current_stock: nextStock }
          });
          await tx.inventoryTransaction.create({
            data: {
              raw_material_id: material.id,
              transaction_type: "deduct",
              quantity: deduction,
              unit: material.unit,
              reference: `POS Transaction ${transactionNumber}`,
              user_id: user.sub
            }
          });
          stockByMaterialId.set(material.id, nextStock);
        }
      }

      return createdTransaction;
    });

    return res.status(201).json({ transaction });
  } catch (error) {
    return next(error);
  }
});

async function getUnifiedTransactions(req: Request, res: Response, next: NextFunction) {
  try {
    const user = requireRole(req, res, ["admin", "cashier"]);

    if (!user) {
      return;
    }

    const date = typeof req.query.date === "string" ? req.query.date : undefined;
    const from = typeof req.query.from === "string" ? req.query.from : undefined;
    const to = typeof req.query.to === "string" ? req.query.to : undefined;
    const search = typeof req.query.search === "string" ? req.query.search.trim() : "";
    const cashierId = typeof req.query.cashier === "string" ? req.query.cashier : undefined;
    const paymentMethod = typeof req.query.payment_method === "string" ? req.query.payment_method : undefined;
    const transactionType = typeof req.query.transaction_type === "string" ? req.query.transaction_type : undefined;
    const page = Math.max(Number(req.query.page ?? 1), 1);
    const limit = Math.min(Math.max(Number(req.query.limit ?? 20), 1), 100);
    const dateFrom = from ?? date;
    const dateTo = to ?? date;
    const createdAt = manilaDateRange(dateFrom, dateTo);
    const posTransactionTypes = ["dine_in", "takeout"];
    const includePosTransactions = !transactionType || posTransactionTypes.includes(transactionType);
    const includeUnlimitedSessions = (!transactionType || transactionType === "unlimited") && !paymentMethod;
    const includeCateringReservations = (!transactionType || ["reservation_deposit", "reservation_balance"].includes(transactionType)) && !paymentMethod && !cashierId;
    const includeDineInReservations = (!transactionType || transactionType === "dine_in_reservation") && !paymentMethod && !cashierId;
    const where = {
      cashier_id: cashierId,
      payment_method: paymentMethod,
      transaction_type: transactionType && transactionType !== "unlimited" ? transactionType : undefined,
      OR: search
        ? [
            { transaction_number: { contains: search, mode: "insensitive" as const } },
            { customer_name: { contains: search, mode: "insensitive" as const } }
          ]
        : undefined,
      created_at: createdAt
    };
    const [posTransactions, unlimitedSessions, cateringReservations, dineInReservations] = await Promise.all([
      includePosTransactions
        ? prisma.posTransaction.findMany({
            where,
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
              cashier_id: cashierId,
              created_at: createdAt,
              OR: search
                ? [
                    { id: { contains: search, mode: "insensitive" as const } },
                    { table: { table_number: Number.isFinite(Number(search)) ? Number(search) : undefined } }
                  ]
                : undefined
            },
            include: {
              cashier: { select: { id: true, name: true, email: true } },
              table: true,
              leftover_items: { include: { selling_product: true } },
              rounds: { include: { items: { include: { selling_product: true } } }, orderBy: { round_number: "asc" } }
            },
            orderBy: { created_at: "desc" }
          })
        : Promise.resolve([])
      ,
      includeCateringReservations
        ? prisma.cateringReservation.findMany({
            where: {
              created_at: createdAt,
              OR: search
                ? [
                    { inquiry: { inquiry_id: { contains: search, mode: "insensitive" as const } } },
                    { inquiry: { customer_name: { contains: search, mode: "insensitive" as const } } },
                    { inquiry: { package_type: { contains: search, mode: "insensitive" as const } } }
                  ]
                : undefined
            },
            include: { inquiry: true, package: true, ingredient_locks: { include: { raw_material: true } } },
            orderBy: { created_at: "desc" }
          })
        : Promise.resolve([]),
      includeDineInReservations
        ? prisma.reservation.findMany({
            where: {
              created_at: createdAt,
              OR: search
                ? [
                    { booking_id: { contains: search, mode: "insensitive" as const } },
                    { customer_name: { contains: search, mode: "insensitive" as const } }
                  ]
                : undefined
            },
            include: { table: true },
            orderBy: { created_at: "desc" }
          })
        : Promise.resolve([])
    ]);
    const formattedUnlimitedSessions = unlimitedSessions.map((session) => {
      const leftoverCharges = session.leftover_items.reduce((total, item) => total + item.charge_amount, 0);
      const items = session.rounds.flatMap((round) =>
        round.items.map((item) => ({
          id: item.id,
          quantity: item.quantity,
          unit_price: Number(item.selling_product.price),
          total_price: Number(item.selling_product.price) * item.quantity,
          round_number: round.round_number,
          selling_product: item.selling_product
        }))
      );

      return {
        id: session.id,
        transaction_number: `UNL-${session.created_at.toISOString().slice(0, 10).replace(/-/g, "")}-${session.id.slice(-4).toUpperCase()}`,
        customer_name: null,
        table_id: session.table_id,
        transaction_type: "unlimited",
        subtotal: session.total_paid,
        tax: 0,
        total: session.total_paid + leftoverCharges,
        payment_method: "cash",
        cash_received: session.total_paid + leftoverCharges,
        change_due: 0,
        status: session.status,
        cashier_id: session.cashier_id,
        created_at: session.created_at,
        updated_at: session.created_at,
        cashier: session.cashier,
        table: session.table,
        items,
        unlimited_session: {
          pax_count: session.pax_count,
          price_per_pax: session.price_per_pax,
          total_paid: session.total_paid,
          leftover_charges: leftoverCharges,
          rounds: session.rounds
        }
      };
    });
    const formattedCateringReservations = cateringReservations.flatMap((reservation) => {
      const bookingRef = reservation.reservation_id;
      const inquiryRef = reservation.inquiry?.inquiry_id;
      const referenceId = inquiryRef ?? bookingRef;

      const records: any[] = [];

      const isFullyPaid = Number(reservation.remaining_balance) <= 0 && reservation.final_payment_status === "paid";
      const balanceAmount = Math.max(reservation.total_price - reservation.deposit_paid, 0);

      // Deposit
      if (Number(reservation.deposit_paid) > 0) {
        const isPrepaid = isFullyPaid;
        const transaction_type = isPrepaid && balanceAmount <= 0 ? "catering_prepaid" : "catering_deposit";

        records.push({
          id: `${reservation.id}-deposit`,
          transaction_number: `DEP-${referenceId}`,
          reference_booking_id: bookingRef,
          customer_name: reservation.inquiry?.customer_name ?? "Unknown",
          table_id: null,
          transaction_type,
          subtotal: reservation.deposit_paid,
          tax: 0,
          total: reservation.deposit_paid,
          payment_method: "manual",
          cash_received: reservation.deposit_paid,
          change_due: 0,
          status: reservation.status,
          cashier_id: null,
          created_at: reservation.created_at,
          updated_at: reservation.created_at,
          cashier: null,
          table: null,
          items: [
            {
              id: `${reservation.id}-deposit-item`,
              quantity: 1,
              unit_price: reservation.deposit_paid,
              total_price: reservation.deposit_paid,
              selling_product: {
                name: `${reservation.inquiry?.package_type ?? "Catering"} downpayment`,
                category: "Catering"
              }
            }
          ],
          catering_reservation: reservation
        });
      }

      // Remaining balance (only shows once completed)
      if (reservation.status === "completed" && balanceAmount > 0) {
        records.push({
          id: `${reservation.id}-balance`,
          transaction_number: `BAL-${referenceId}`,
          reference_booking_id: bookingRef,
          customer_name: reservation.inquiry?.customer_name ?? "Unknown",
          table_id: null,
          transaction_type: "catering_balance",
          subtotal: balanceAmount,
          tax: 0,
          total: balanceAmount,
          payment_method: "manual",
          cash_received: balanceAmount,
          change_due: 0,
          status: reservation.status,
          cashier_id: null,
          created_at: reservation.created_at,
          updated_at: reservation.created_at,
          cashier: null,
          table: null,
          items: [
            {
              id: `${reservation.id}-balance-item`,
              quantity: 1,
              unit_price: balanceAmount,
              total_price: balanceAmount,
              selling_product: {
                name: `${reservation.inquiry?.package_type ?? "Catering"} balance`,
                category: "Catering"
              }
            }
          ],
          catering_reservation: reservation
        });
      }

      // If fully paid via online and there is no separate balance record, show prepaid as one record.
      // (This keeps UX simple; we already show deposit above, but requirement wants explicit Prepaid.)
      if (isFullyPaid && Number(reservation.deposit_paid) > 0 && balanceAmount <= 0) {
        records.push({
          id: `${reservation.id}-prepaid`,
          transaction_number: `PRE-${referenceId}`,
          reference_booking_id: bookingRef,
          customer_name: reservation.inquiry?.customer_name ?? "Unknown",
          table_id: null,
          transaction_type: "catering_prepaid",
          subtotal: reservation.total_price,
          tax: 0,
          total: reservation.total_price,
          payment_method: "manual",
          cash_received: reservation.total_price,
          change_due: 0,
          status: reservation.status,
          cashier_id: null,
          created_at: reservation.created_at,
          updated_at: reservation.created_at,
          cashier: null,
          table: null,
          items: [
            {
              id: `${reservation.id}-prepaid-item`,
              quantity: 1,
              unit_price: reservation.total_price,
              total_price: reservation.total_price,
              selling_product: {
                name: `${reservation.inquiry?.package_type ?? "Catering"} prepaid`,
                category: "Catering"
              }
            }
          ],
          catering_reservation: reservation
        });
      }

      return records;
    });

    const formattedDineInReservations = dineInReservations.flatMap((reservation) => {
      const referenceId = reservation.booking_id;
      const records: any[] = [];

      const isPrepaid = Number(reservation.remaining_balance) <= 0 && reservation.final_payment_status === "paid";

      // Deposit record exists when reservation.downpayment_amount > 0 (always created)
      if (Number(reservation.downpayment_amount) > 0 && reservation.downpayment_status === "paid") {
        records.push({
          id: `${reservation.id}-deposit`,
          transaction_number: `DEP-${referenceId}`,
          reference_booking_id: referenceId,
          customer_name: reservation.customer_name,
          table_id: reservation.assigned_table_id,
          transaction_type: isPrepaid ? "dine_in_prepaid" : "dine_in_deposit",
          subtotal: Number(reservation.downpayment_amount),
          tax: reservation.tax ?? 0,
          total: Number(reservation.downpayment_amount),
          payment_method: reservation.downpayment_method ?? "cash",
          cash_received: Number(reservation.downpayment_amount),
          change_due: 0,
          status: reservation.status,
          cashier_id: null,
          created_at: reservation.downpayment_date ?? reservation.created_at,
          updated_at: reservation.downpayment_date ?? reservation.created_at,
          cashier: null,
          table: reservation.table,
          items: [
            {
              id: `${reservation.id}-deposit-item`,
              quantity: 1,
              unit_price: Number(reservation.downpayment_amount),
              total_price: Number(reservation.downpayment_amount),
              selling_product: {
                name: `Dine-in deposit (${reservation.time})`,
                category: "Reservation"
              }
            }
          ],
          reservation
        });
      }

      // Remaining balance record
      const balanceAmount = Number(reservation.remaining_balance);
      if (reservation.status === "completed" && balanceAmount > 0) {
        records.push({
          id: `${reservation.id}-balance`,
          transaction_number: `BAL-${referenceId}`,
          reference_booking_id: referenceId,
          customer_name: reservation.customer_name,
          table_id: reservation.assigned_table_id,
          transaction_type: "dine_in_balance",
          subtotal: balanceAmount,
          tax: 0,
          total: balanceAmount,
          payment_method: reservation.final_payment_method ?? "cash",
          cash_received: balanceAmount,
          change_due: 0,
          status: reservation.status,
          cashier_id: null,
          created_at: reservation.remaining_paid_date ?? reservation.created_at,
          updated_at: reservation.remaining_paid_date ?? reservation.created_at,
          cashier: null,
          table: reservation.table,
          items: [
            {
              id: `${reservation.id}-balance-item`,
              quantity: 1,
              unit_price: balanceAmount,
              total_price: balanceAmount,
              selling_product: {
                name: `Dine-in balance (${reservation.time})`,
                category: "Reservation"
              }
            }
          ],
          reservation
        });
      }

      // Prepaid full payment record
      if (isPrepaid && Number(reservation.downpayment_amount) > 0 && balanceAmount <= 0) {
        records.push({
          id: `${reservation.id}-prepaid`,
          transaction_number: `PRE-${referenceId}`,
          reference_booking_id: referenceId,
          customer_name: reservation.customer_name,
          table_id: reservation.assigned_table_id,
          transaction_type: "dine_in_prepaid",
          subtotal: Number(reservation.total_price ?? 0),
          tax: 0,
          total: Number(reservation.total_price ?? 0),
          payment_method: reservation.final_payment_method ?? reservation.downpayment_method ?? "cash",
          cash_received: Number(reservation.total_price ?? 0),
          change_due: 0,
          status: reservation.status,
          cashier_id: null,
          created_at: reservation.downpayment_date ?? reservation.created_at,
          updated_at: reservation.downpayment_date ?? reservation.created_at,
          cashier: null,
          table: reservation.table,
          items: [
            {
              id: `${reservation.id}-prepaid-item`,
              quantity: 1,
              unit_price: Number(reservation.total_price ?? 0),
              total_price: Number(reservation.total_price ?? 0),
              selling_product: {
                name: `Dine-in prepaid (${reservation.time})`,
                category: "Reservation"
              }
            }
          ],
          reservation
        });
      }

      return records;
    });

    const transactions = [...posTransactions, ...formattedUnlimitedSessions, ...formattedCateringReservations, ...formattedDineInReservations]
      .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());

    const total = transactions.length;
    const paginatedTransactions = transactions.slice((page - 1) * limit, page * limit);

    return res.json({ transactions: paginatedTransactions, pagination: { page, limit, total, pages: Math.ceil(total / limit) } });
  } catch (error) {
    return next(error);
  }
}

import { getUnifiedTransactions as getUnifiedTransactionsFromService } from "./services/transaction.service";

// Unified list consumed by staff POS history UI
app.get("/api/pos/transactions/unified", async (req, res, next) => {
  try {
    const user = requireRole(req, res, ["admin", "cashier"]);
    if (!user) return;

    const { transactions, pagination } = await getUnifiedTransactionsFromService({
      date: typeof req.query.date === "string" ? req.query.date : undefined,
      from: typeof req.query.from === "string" ? req.query.from : undefined,
      to: typeof req.query.to === "string" ? req.query.to : undefined,
      search: typeof req.query.search === "string" ? req.query.search : undefined,
      cashierId: typeof req.query.cashier === "string" ? req.query.cashier : undefined,
      paymentMethod: typeof req.query.payment_method === "string" ? req.query.payment_method : undefined,
      transactionType: typeof req.query.transaction_type === "string" ? req.query.transaction_type : undefined,
      page: req.query.page ? Number(req.query.page) : undefined,
      limit: req.query.limit ? Number(req.query.limit) : undefined
    });

    return res.json({ transactions, pagination });
  } catch (error) {
    return next(error);
  }
});

// Backwards-compatible routes
app.get("/api/pos/transactions", async (req, res, next) => {
  req.url = "/api/pos/transactions/unified";
  return next();
});
app.get("/api/transactions/unified", async (req, res, next) => {
  req.url = "/api/pos/transactions/unified";
  return next();
});



app.get("/api/pos/transactions/summary", async (req, res, next) => {
  try {
    const user = requireRole(req, res, ["admin", "cashier"]);

    if (!user) {
      return;
    }

    const date = typeof req.query.date === "string" ? req.query.date : undefined;
    const from = typeof req.query.from === "string" ? req.query.from : undefined;
    const to = typeof req.query.to === "string" ? req.query.to : undefined;
    const dateFrom = from ?? date;
    const dateTo = to ?? date;
    const createdAt = manilaDateRange(dateFrom, dateTo);
    const [posTransactions, unlimitedSessions, cateringReservations, dineInReservations] = await Promise.all([
      prisma.posTransaction.findMany({
        where: { created_at: createdAt },
        select: {
          transaction_type: true,
          payment_method: true,
          total: true
        }
      }),
      prisma.unlimitedSession.findMany({
        where: { created_at: createdAt },
        include: { leftover_items: true }
      }),
      prisma.cateringReservation.findMany({
        where: { created_at: createdAt },
        select: {
          deposit_paid: true,
          total_price: true,
          status: true,
          downpayment_method: true,
          final_payment_method: true,
          final_payment_status: true,
          reservation_id: true
        }
      }),
      prisma.reservation.findMany({
        where: { created_at: createdAt },
        select: {
          downpayment_amount: true,
          downpayment_status: true,
          downpayment_method: true,
          total_price: true,
          remaining_balance: true,
          final_payment_status: true,
          final_payment_method: true,
          status: true,
          booking_id: true
        }
      })
    ]);
    const records = [
      ...posTransactions.map((transaction) => ({
        type: transaction.transaction_type,
        payment: transaction.payment_method,
        total: transaction.total
      })),
      ...unlimitedSessions.map((session) => ({
        type: "unlimited",
        payment: "cash",
        total: session.total_paid + session.leftover_items.reduce((sum, item) => sum + item.charge_amount, 0)
      })),
      ...cateringReservations.flatMap((reservation) => {
        const depositPaid = reservation.deposit_paid ?? 0;
        const totalPrice = reservation.total_price ?? 0;
        const remaining = Math.max(totalPrice - depositPaid, 0);
        const isFullyPaid = remaining <= 0 && reservation.final_payment_status === "paid";

        const depositRecord = depositPaid > 0 && !isFullyPaid
          ? [{ type: "catering_deposit", payment: reservation.downpayment_method ?? "cash", total: depositPaid }]
          : [];

        const prepaidRecord = depositPaid > 0 && isFullyPaid
          ? [{ type: "catering_prepaid", payment: reservation.final_payment_method ?? reservation.downpayment_method ?? "cash", total: totalPrice }]
          : [];

        const balanceRecord = reservation.status === "completed" && remaining > 0
          ? [{ type: "catering_balance", payment: reservation.final_payment_method ?? "cash", total: remaining }]
          : [];

        return [...depositRecord, ...prepaidRecord, ...balanceRecord];
      }),
      ...dineInReservations.flatMap((reservation) => {
        const downpayment = Number(reservation.downpayment_amount ?? 0);
        const remaining = Number(reservation.remaining_balance ?? 0);
        const isPrepaid = remaining <= 0 && reservation.final_payment_status === "paid";

        const depositRecord = downpayment > 0 && !isPrepaid
          ? [{ type: "dine_in_deposit", payment: reservation.downpayment_method ?? "cash", total: downpayment }]
          : [];

        const prepaidRecord = downpayment > 0 && isPrepaid
          ? [{ type: "dine_in_prepaid", payment: reservation.final_payment_method ?? reservation.downpayment_method ?? "cash", total: Number(reservation.total_price ?? downpayment) }]
          : [];

        const balanceRecord = reservation.status === "completed" && remaining > 0
          ? [{ type: "dine_in_balance", payment: reservation.final_payment_method ?? "cash", total: remaining }]
          : [];

        return [...depositRecord, ...prepaidRecord, ...balanceRecord];
      })
    ];
    const emptyBucket = () => ({ count: 0, total: 0 });
    const byType: Record<string, { count: number; total: number }> = {
      dine_in: emptyBucket(),
      takeout: emptyBucket(),
      unlimited: emptyBucket(),
      dine_in_deposit: emptyBucket(),
      dine_in_balance: emptyBucket(),
      dine_in_prepaid: emptyBucket(),
      catering_deposit: emptyBucket(),
      catering_balance: emptyBucket(),
      catering_prepaid: emptyBucket(),
      dine_in_reservation: emptyBucket()
    };
    const byPayment: Record<string, { count: number; total: number }> = {
      cash: emptyBucket(),
      gcash: emptyBucket(),
      bank_transfer: emptyBucket(),
      manual: emptyBucket(),
      none: emptyBucket()
    };

    records.forEach((record) => {
      byType[record.type] ??= emptyBucket();
      byType[record.type].count += 1;
      byType[record.type].total += record.total;
      byPayment[record.payment] ??= emptyBucket();
      byPayment[record.payment].count += 1;
      byPayment[record.payment].total += record.total;
    });

    const totalSales = records.reduce((sum, record) => sum + record.total, 0);
    const totalTransactions = records.length;

    return res.json({
      totalSales,
      totalTransactions,
      averageOrderValue: totalTransactions > 0 ? totalSales / totalTransactions : 0,
      byType,
      byPayment
    });
  } catch (error) {
    return next(error);
  }
});

app.get("/api/pos/transactions/:id", async (req, res, next) => {
  try {
    const user = requireRole(req, res, ["admin", "cashier"]);

    if (!user) {
      return;
    }

    const transaction = await prisma.posTransaction.findUnique({
      where: { id: req.params.id },
      include: {
        cashier: { select: { id: true, name: true, email: true } },
        items: { include: { selling_product: true } }
      }
    });

    if (!transaction) {
      return res.status(404).json({ message: "Transaction not found" });
    }

    return res.json({ transaction });
  } catch (error) {
    return next(error);
  }
});

app.post("/api/pos/refund/:id", async (req, res, next) => {
  try {
    const user = requireRole(req, res, ["admin"]);

    if (!user) {
      return;
    }

    const transaction = await prisma.posTransaction.findUnique({
      where: { id: req.params.id },
      include: {
        items: {
          include: {
            selling_product: {
              include: {
                recipes: {
                  include: {
                    recipe_ingredients: {
                      include: {
                        raw_material: true
                      }
                    }
                  }
                }
              }
            }
          }
        }
      }
    });

    if (!transaction) {
      return res.status(404).json({ message: "Transaction not found" });
    }

    if (transaction.status === "refunded") {
      return res.status(400).json({ message: "Transaction is already refunded" });
    }

    const refundedTransaction = await prisma.$transaction(async (tx) => {
      const stockByMaterialId = new Map<string, number>();

      for (const item of transaction.items) {
        const recipeIngredients = item.selling_product.recipes[0]?.recipe_ingredients ?? [];

        for (const ingredient of recipeIngredients) {
          const material = ingredient.raw_material;
          const addition = convertQuantityToMaterialUnit(
            Number(ingredient.quantity_per_yield) * item.quantity,
            ingredient.unit,
            material.unit
          );
          const currentStock = stockByMaterialId.get(material.id) ?? Number(material.current_stock);
          const nextStock = currentStock + addition;

          await tx.rawMaterial.update({
            where: { id: material.id },
            data: { current_stock: nextStock }
          });
          await tx.inventoryTransaction.create({
            data: {
              raw_material_id: material.id,
              transaction_type: "add",
              quantity: addition,
              unit: material.unit,
              reference: `Refund ${transaction.transaction_number}`,
              user_id: user.sub
            }
          });
          stockByMaterialId.set(material.id, nextStock);
        }
      }

      return tx.posTransaction.update({
        where: { id: transaction.id },
        data: { status: "refunded" },
        include: {
          cashier: { select: { id: true, name: true, email: true } },
          items: { include: { selling_product: true } }
        }
      });
    });

    return res.json({ transaction: refundedTransaction });
  } catch (error) {
    return next(error);
  }
});

async function getUnlimitedSettings() {
  const existing = await prisma.unlimitedSetting.findFirst();

  if (existing) {
    return existing;
  }

  return prisma.unlimitedSetting.create({
    data: {
      price_per_person: 599,
      time_limit_minutes: 90,
      leftover_charge_percent: 100
    }
  });
}

async function deductRecipeForProduct(
  tx: Parameters<Parameters<typeof prisma.$transaction>[0]>[0],
  product: {
    id: string;
    recipes: Array<{
      recipe_ingredients: Array<{
        quantity_per_yield: unknown;
        unit: string;
        raw_material: { id: string; unit: string; current_stock: unknown };
      }>;
    }>;
  },
  quantity: number,
  reference: string,
  userId: string
) {
  const recipeIngredients = product.recipes[0]?.recipe_ingredients ?? [];

  for (const ingredient of recipeIngredients) {
    const material = ingredient.raw_material;
    const deduction = convertQuantityToMaterialUnit(
      Number(ingredient.quantity_per_yield) * quantity,
      ingredient.unit,
      material.unit
    );
    const current = await tx.rawMaterial.findUnique({ where: { id: material.id } });
    const nextStock = Math.max(Number(current?.current_stock ?? material.current_stock) - deduction, 0);

    await tx.rawMaterial.update({
      where: { id: material.id },
      data: { current_stock: nextStock }
    });
    await tx.inventoryTransaction.create({
      data: {
        raw_material_id: material.id,
        transaction_type: "deduct",
        quantity: deduction,
        unit: material.unit,
        reference,
        user_id: userId
      }
    });
  }
}

app.get("/api/admin/unlimited/settings", async (req, res, next) => {
  try {
    const user = requireRole(req, res, ["admin", "cashier"]);

    if (!user) {
      return;
    }

    const settings = await getUnlimitedSettings();
    return res.json({ settings });
  } catch (error) {
    return next(error);
  }
});

app.put("/api/admin/unlimited/settings", async (req, res, next) => {
  try {
    const user = requireRole(req, res, ["admin", "cashier"]);

    if (!user) {
      return;
    }

    const body = z
      .object({
        price_per_person: z.coerce.number().positive(),
        time_limit_minutes: z.coerce.number().int().positive(),
        leftover_charge_percent: z.coerce.number().nonnegative()
      })
      .parse(req.body);
    const current = await getUnlimitedSettings();
    const settings = await prisma.unlimitedSetting.update({
      where: { id: current.id },
      data: body
    });

    return res.json({ settings });
  } catch (error) {
    return next(error);
  }
});

app.get("/api/admin/unlimited/included-products", async (req, res, next) => {
  try {
    const user = requireRole(req, res, ["admin", "cashier"]);

    if (!user) {
      return;
    }

    const products = await prisma.sellingProduct.findMany({
      where: { is_deleted: false },
      include: { unlimited_included_products: true },
      orderBy: [{ category: "asc" }, { name: "asc" }]
    });

    return res.json({
      products: products.map((product) => ({
        id: product.id,
        name: product.name,
        category: product.category,
        price: Number(product.price),
        is_included: product.unlimited_included_products[0]?.is_included ?? false
      }))
    });
  } catch (error) {
    return next(error);
  }
});

app.put("/api/admin/unlimited/included-products", async (req, res, next) => {
  try {
    const user = requireRole(req, res, ["admin", "cashier"]);

    if (!user) {
      return;
    }

    const body = z
      .object({
        products: z.array(z.object({ productId: z.string().min(1), isIncluded: z.coerce.boolean() }))
      })
      .parse(req.body);

    await prisma.$transaction(
      body.products.map((product) =>
        prisma.unlimitedIncludedProduct.upsert({
          where: { selling_product_id: product.productId },
          create: { selling_product_id: product.productId, is_included: product.isIncluded },
          update: { is_included: product.isIncluded }
        })
      )
    );

    return res.json({ ok: true });
  } catch (error) {
    return next(error);
  }
});

app.get("/api/pos/unlimited/included-products", async (req, res, next) => {
  try {
    const user = requireRole(req, res, ["admin", "cashier"]);

    if (!user) {
      return;
    }

    const products = await prisma.sellingProduct.findMany({
      where: {
        is_deleted: false,
        is_available: true,
        unlimited_included_products: { some: { is_included: true } }
      },
      orderBy: [{ category: "asc" }, { name: "asc" }]
    });

    return res.json({ products });
  } catch (error) {
    return next(error);
  }
});

app.post("/api/pos/unlimited/start", async (req, res, next) => {
  try {
    const user = requireRole(req, res, ["admin", "cashier"]);

    if (!user) {
      return;
    }

    const body = z.object({ tableId: z.string().min(1), paxCount: z.coerce.number().int().positive() }).parse(req.body);
    const settings = await getUnlimitedSettings();
    const startedAt = new Date();
    const endsAt = new Date(startedAt.getTime() + settings.time_limit_minutes * 60 * 1000);
    const session = await prisma.unlimitedSession.create({
      data: {
        table_id: body.tableId,
        pax_count: body.paxCount,
        price_per_pax: settings.price_per_person,
        total_paid: settings.price_per_person * body.paxCount,
        started_at: startedAt,
        ends_at: endsAt,
        status: "active",
        cashier_id: user.sub
      },
      include: { table: true, rounds: { include: { items: { include: { selling_product: true } } } } }
    });

    return res.status(201).json({ session, settings });
  } catch (error) {
    return next(error);
  }
});

app.post("/api/pos/unlimited/round", async (req, res, next) => {
  try {
    const user = requireRole(req, res, ["admin", "cashier"]);

    if (!user) {
      return;
    }

    const body = z
      .object({
        sessionId: z.string().min(1),
        items: z.array(z.object({ productId: z.string().min(1), quantity: z.coerce.number().int().positive() })).min(1)
      })
      .parse(req.body);
    const session = await prisma.unlimitedSession.findUnique({
      where: { id: body.sessionId },
      include: { rounds: true }
    });

    if (!session || session.status !== "active") {
      return res.status(404).json({ message: "Active unlimited session not found" });
    }

    const products = await prisma.sellingProduct.findMany({
      where: {
        id: { in: body.items.map((item) => item.productId) },
        unlimited_included_products: { some: { is_included: true } }
      },
      include: { recipes: { include: { recipe_ingredients: { include: { raw_material: true } } } } }
    });
    const productsById = new Map(products.map((product) => [product.id, product]));
    const missingItem = body.items.find((item) => !productsById.has(item.productId));

    if (missingItem) {
      return res.status(400).json({ message: "Only included unlimited products can be ordered" });
    }

    const round = await prisma.$transaction(async (tx) => {
      const createdRound = await tx.unlimitedRound.create({
        data: {
          session_id: session.id,
          round_number: session.rounds.length + 1,
          items: {
            create: body.items.map((item) => ({
              selling_product_id: item.productId,
              quantity: item.quantity
            }))
          }
        },
        include: { items: { include: { selling_product: true } } }
      });

      if (!session.first_round_at) {
        const firstRoundAt = createdRound.served_at;
        const settings = await getUnlimitedSettings();
        await tx.unlimitedSession.update({
          where: { id: session.id },
          data: {
            first_round_at: firstRoundAt,
            ends_at: new Date(firstRoundAt.getTime() + settings.time_limit_minutes * 60 * 1000)
          }
        });
      }

      for (const item of body.items) {
        const product = productsById.get(item.productId);

        if (product) {
          await deductRecipeForProduct(tx, product, item.quantity, `Unlimited Session ${session.id} Round ${createdRound.round_number}`, user.sub);
        }
      }

      return createdRound;
    });

    return res.status(201).json({ round });
  } catch (error) {
    return next(error);
  }
});

app.get("/api/pos/unlimited/session/:id", async (req, res, next) => {
  try {
    const user = requireRole(req, res, ["admin", "cashier"]);

    if (!user) {
      return;
    }

    const session = await prisma.unlimitedSession.findUnique({
      where: { id: req.params.id },
      include: {
        table: true,
        leftover_items: { include: { selling_product: true } },
        rounds: { include: { items: { include: { selling_product: true } } }, orderBy: { round_number: "asc" } }
      }
    });

    if (!session) {
      return res.status(404).json({ message: "Session not found" });
    }

    return res.json({ session, settings: await getUnlimitedSettings() });
  } catch (error) {
    return next(error);
  }
});

app.post("/api/pos/unlimited/end", async (req, res, next) => {
  try {
    const user = requireRole(req, res, ["admin", "cashier"]);

    if (!user) {
      return;
    }

    const body = z
      .object({
        sessionId: z.string().min(1),
        leftovers: z.array(z.object({ productId: z.string().min(1), quantity: z.coerce.number().int().positive() })).default([])
      })
      .parse(req.body);
    const settings = await getUnlimitedSettings();
    const products = await prisma.sellingProduct.findMany({ where: { id: { in: body.leftovers.map((item) => item.productId) } } });
    const productById = new Map(products.map((product) => [product.id, product]));
    const session = await prisma.$transaction(async (tx) => {
      await tx.unlimitedLeftoverItem.createMany({
        data: body.leftovers.map((item) => {
          const product = productById.get(item.productId);
          const alaCarte = Number(product?.price ?? 0) * item.quantity;

          return {
            session_id: body.sessionId,
            selling_product_id: item.productId,
            quantity: item.quantity,
            charge_amount: alaCarte * (settings.leftover_charge_percent / 100)
          };
        })
      });

      return tx.unlimitedSession.update({
        where: { id: body.sessionId },
        data: { status: "completed" },
        include: {
          table: true,
          leftover_items: { include: { selling_product: true } },
          rounds: { include: { items: { include: { selling_product: true } } }, orderBy: { round_number: "asc" } }
        }
      });
    });

    return res.json({ session, settings });
  } catch (error) {
    return next(error);
  }
});

async function autoCompleteOverdueCateringReservations() {
  const todayStart = startOfDay(new Date());
  const overdueReservations = await prisma.cateringReservation.findMany({
    where: {
      confirmed_date: { lt: todayStart },
      status: { not: "completed" },
      ingredient_locks: { some: { is_released: false } }
    },
    select: {
      id: true,
      reservation_id: true,
      remaining_balance: true,
      final_payment_status: true,
      inquiry: { select: { inquiry_id: true } }
    }
  });

  for (const reservation of overdueReservations) {
    await prisma.$transaction(async (tx) => {
      const hasOpenBalance = Number(reservation.remaining_balance) > 0 || reservation.final_payment_status !== "paid";

      if (hasOpenBalance) {
        await tx.cateringReservation.update({
          where: { id: reservation.id },
          data: { status: "pending_final_payment" }
        });
        return;
      }

      await releaseCateringLocks(
        tx,
        reservation.id,
        undefined,
        `Catering reservation ${reservation.reservation_id ?? reservation.inquiry?.inquiry_id ?? reservation.id}`
      );
      await tx.cateringReservation.update({
        where: { id: reservation.id },
        data: { status: "completed" }
      });
    });
  }
}

void autoCompleteOverdueCateringReservations().catch((error) => {
  console.error("Unable to auto-complete overdue catering reservations", error);
});
setInterval(() => {
  void autoCompleteOverdueCateringReservations().catch((error) => {
    console.error("Unable to auto-complete overdue catering reservations", error);
  });
}, 24 * 60 * 60 * 1000);

app.use((error: Error, _req: Request, res: Response, _next: NextFunction) => {
  console.error(error);

  if (error instanceof z.ZodError) {
    return res.status(400).json({
      message: error.errors[0]?.message ?? "Invalid request data"
    });
  }

  const statusCode = (error as Error & { statusCode?: number }).statusCode;

  if (statusCode && statusCode >= 400 && statusCode < 600) {
    return res.status(statusCode).json({ message: error.message });
  }

  res.status(500).json({ message: "Internal server error" });
});

export default app;

import cookieParser from "cookie-parser";
import cors from "cors";
import express, { NextFunction, Request, Response } from "express";
import helmet from "helmet";
import jwt from "jsonwebtoken";
import morgan from "morgan";
import bcrypt from "bcrypt";
import fs from "fs";
import path from "path";
import multer from "multer";
import { Prisma } from "@prisma/client";
import { z } from "zod";
import { NotificationService } from "./services/notification.service";
import { emailService } from "./services/email.service";
import { generateTransactionNumber } from "./utils/transactionNumber";
import paymentRoutes from "./routes/payment.routes";
import diningPosRoutes from "./routes/diningPos.routes";
import { seedDemoData } from "./services/demoSeed.service";
import { assertDevelopmentDatabase } from "./lib/seedSafety";
import { getBeverageStockMaterialName } from "./lib/beverageStock";
import { getProductCartCompatibility } from "./services/productCartCompatibility.service";
import {
  assertEnoughAvailable,
  assertBatchQuantitiesMatchOnHand,
  assertReservationIngredientAvailability,
  inventoryUnitsMatch,
  calculateAvailableQuantity,
  consumeMaterialStock,
  createInventoryMovement,
  getActiveCateringReservationQuantity,
  getActiveCateringReservationQuantities,
  getReservationIngredientNeeds,
  InventoryError,
  isReservationInventoryHoldActive,
  isTerminalReservationStatus,
  lockMaterialForUpdate,
  recordReservationMovement,
  validateInventoryCount,
  validateInventoryQuantity
} from "./services/inventory.service";
import { paymentIntentStore } from "./services/payment/paymentIntentStore";
import { PaymentGatewayFactory } from "./services/payment/paymentGateway.factory";
import { PaymentService } from "./services/payment.service";
import { prisma } from "./lib/prisma";
import { jwtExpirationSeconds } from "./lib/jwtExpiration";
import { checkDatabaseHealth, getDatabaseStatus, markDatabaseDown } from "./lib/database";
import { getJwtSecret } from "./lib/jwt";
import {
  isDineInReservationLate,
  isDineInReservationLateAlert,
  reservationTimeError,
  RESERVATION_SETTINGS
} from "./config/reservationSettings";
import { normalizeTableStatus } from "./services/tableStatus.service";
import {
  findBestTableCombination,
  getTablesUnavailableForSlot,
  type TablePlanningWindow
} from "./services/tableAllocation.service";
import {
  calculateAvailableReservationPax,
  getReservationSlotStart
} from "./services/reservationCapacity.service";

import dotenv from "dotenv";

// Load .env file only in development (won't exist in production on Render)
if (process.env.NODE_ENV !== "production") {
  dotenv.config({ path: path.resolve(__dirname, "..", ".env") });
}

const supabaseUrl = process.env.SUPABASE_URL?.trim();
const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
const supabaseStorageBucket = process.env.SUPABASE_STORAGE_BUCKET?.trim();

let supabase: any = null;
let useSupabaseStorage = false;

async function initSupabase() {
  if (!supabaseUrl || !supabaseServiceRoleKey || !supabaseStorageBucket) {
    return;
  }

  try {
    const { createClient } = await import("@supabase/supabase-js");
    supabase = createClient(supabaseUrl, supabaseServiceRoleKey);
    useSupabaseStorage = Boolean(supabase);
  } catch {
    supabase = null;
    useSupabaseStorage = false;
  }
}

initSupabase().catch((error) => {
  console.error("Failed to initialize Supabase client:", error);
});

const app = express();
app.set("json replacer", (_key: string, value: unknown) => {
  if (typeof value !== "bigint") return value;
  const numericValue = Number(value);
  if (!Number.isSafeInteger(numericValue)) {
    throw new RangeError("Inventory quantity exceeds the safe JSON integer range.");
  }
  return numericValue;
});
const notificationService = new NotificationService();
const paymentService = new PaymentService();

const defaultStaffUsers = [
  { email: "admin@katana.com", password: "Admin123!", name: "System Administrator", role: "admin" },
  { email: "inventory@katana.com", password: "Inventory123!", name: "Inventory Manager", role: "inventory_manager" },
  { email: "cashier@katana.com", password: "Cashier123!", name: "Cashier", role: "cashier" },
  { email: "reception@katana.com", password: "Reception123!", name: "Receptionist", role: "receptionist" },
  { email: "events@katana.com", password: "Events123!", name: "Event Coordinator", role: "event_coordinator" },
  { email: "chef@katana.com", password: "Chef123!", name: "Chef", role: "chef" }
];

async function ensureDefaultStaffUsers() {
  await assertDevelopmentDatabase(prisma);
  const existingUserCount = await prisma.user.count();

  if (existingUserCount > 0) {
    return;
  }

  await Promise.all(
    defaultStaffUsers.map(async (user) => {
      await prisma.user.upsert({
        where: { email: user.email },
        update: {},
        create: {
          email: user.email,
          password_hash: await bcrypt.hash(user.password, 10),
          role: user.role,
          name: user.name
        }
      });
    })
  );

  console.log("Created default staff login accounts because the users table was empty.");
}

export async function ensureDemoSeed() {
  try {
    await assertDevelopmentDatabase(prisma);
    await ensureOperationalSchema();
    await ensureCustomerFeedbackTable();
    const userCount = await prisma.user.count();
    const productCount = await prisma.sellingProduct.count();
    const materialCount = await prisma.rawMaterial.count();

    if (userCount > 0 && productCount > 0) {
      console.log("Database already seeded with users and products. Skipping demo data initialization.");
      await backfillPersistedProductImages();
      return;
    }

    if (userCount > 0 || productCount > 0 || materialCount > 0) {
      if (userCount === 0) {
        await ensureDefaultStaffUsers();
      }

      if (productCount === 0) {
        console.warn(
          "Database has no selling products, but it is not empty. Skipping destructive demo reseed. Run a catalog import/seed intentionally after backing up data."
        );
      }

      await backfillPersistedProductImages();
      return;
    }

    if (userCount > 0 && productCount === 0) {
      console.warn("⚠ Warning: Database has users but no products. Performing recovery reseed...");
    }

    console.log("Initializing demo seed data...");
    await seedDemoData(prisma);
    await backfillPersistedProductImages();
    console.log("✓ Demo seed data initialized successfully.");
  } catch (error) {
    console.error("✗ Failed to initialize demo seed data:", error);
    throw error;
  }
}

export async function ensureOperationalSchema() {
  await prisma.$executeRaw`ALTER TABLE "reservations" ADD COLUMN IF NOT EXISTS "created_by" TEXT`;
  await prisma.$executeRaw`ALTER TABLE "catering_reservations" ADD COLUMN IF NOT EXISTS "created_by" TEXT`;
  await prisma.$executeRaw`ALTER TABLE "catering_reservations" ADD COLUMN IF NOT EXISTS "package_ids" JSONB`;
  await prisma.$executeRaw`ALTER TABLE "reservation_payments" ADD COLUMN IF NOT EXISTS "override_reason" TEXT`;

  await prisma.$executeRaw`
    CREATE TABLE IF NOT EXISTS "reservation_ingredient_locks" (
      "id" TEXT NOT NULL,
      "reservation_id" TEXT NOT NULL,
      "raw_material_id" TEXT NOT NULL,
      "reserved_quantity" BIGINT NOT NULL,
      "unit" TEXT NOT NULL,
      "is_released" BOOLEAN NOT NULL DEFAULT false,
      "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
      "released_at" TIMESTAMP(3),
      CONSTRAINT "reservation_ingredient_locks_pkey" PRIMARY KEY ("id")
    )
  `;
  await prisma.$executeRaw`CREATE INDEX IF NOT EXISTS "reservation_ingredient_locks_raw_material_id_is_released_idx" ON "reservation_ingredient_locks"("raw_material_id", "is_released")`;
  await prisma.$executeRaw`CREATE INDEX IF NOT EXISTS "reservation_ingredient_locks_reservation_id_is_released_idx" ON "reservation_ingredient_locks"("reservation_id", "is_released")`;

  await prisma.$executeRaw`
    CREATE TABLE IF NOT EXISTS "reservation_activity" (
      "id" TEXT NOT NULL,
      "reservation_id" TEXT,
      "catering_reservation_id" TEXT,
      "event_type" TEXT NOT NULL,
      "from_status" TEXT,
      "to_status" TEXT,
      "actor_type" TEXT NOT NULL,
      "actor_id" TEXT,
      "actor_name" TEXT,
      "reason" TEXT,
      "details" JSONB,
      "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
      CONSTRAINT "reservation_activity_pkey" PRIMARY KEY ("id")
    )
  `;
  await prisma.$executeRaw`CREATE INDEX IF NOT EXISTS "reservation_activity_reservation_id_created_at_idx" ON "reservation_activity"("reservation_id", "created_at")`;
  await prisma.$executeRaw`CREATE INDEX IF NOT EXISTS "reservation_activity_catering_reservation_id_created_at_idx" ON "reservation_activity"("catering_reservation_id", "created_at")`;

  await prisma.$executeRaw`
    CREATE TABLE IF NOT EXISTS "payment_transaction_claims" (
      "transaction_id" TEXT NOT NULL,
      "reservation_id" TEXT,
      "catering_reservation_id" TEXT,
      "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
      CONSTRAINT "payment_transaction_claims_pkey" PRIMARY KEY ("transaction_id")
    )
  `;

  await prisma.$executeRaw`
    CREATE TABLE IF NOT EXISTS "payment_intents" (
      "reference_id" TEXT NOT NULL,
      "booking_id" TEXT NOT NULL,
      "purpose" TEXT NOT NULL DEFAULT 'downpayment',
      "idempotency_key" TEXT,
      "gateway_reference" TEXT,
      "amount" DOUBLE PRECISION NOT NULL,
      "payment_method" TEXT NOT NULL,
      "reservation_type" TEXT NOT NULL,
      "status" TEXT NOT NULL DEFAULT 'pending',
      "transaction_id" TEXT,
      "paid_at" TIMESTAMP(3),
      "expires_at" TIMESTAMP(3),
      "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
      "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
      CONSTRAINT "payment_intents_pkey" PRIMARY KEY ("reference_id")
    )
  `;
  await prisma.$executeRaw`ALTER TABLE "payment_intents" ADD COLUMN IF NOT EXISTS "purpose" TEXT NOT NULL DEFAULT 'downpayment'`;
  await prisma.$executeRaw`ALTER TABLE "payment_intents" ADD COLUMN IF NOT EXISTS "idempotency_key" TEXT`;
  await prisma.$executeRaw`ALTER TABLE "payment_intents" ADD COLUMN IF NOT EXISTS "gateway_reference" TEXT`;
  await prisma.$executeRaw`CREATE UNIQUE INDEX IF NOT EXISTS "payment_intents_transaction_id_key" ON "payment_intents"("transaction_id") WHERE "transaction_id" IS NOT NULL`;
  await prisma.$executeRaw`CREATE UNIQUE INDEX IF NOT EXISTS "payment_intents_idempotency_key_key" ON "payment_intents"("idempotency_key") WHERE "idempotency_key" IS NOT NULL`;
  await prisma.$executeRaw`CREATE INDEX IF NOT EXISTS "payment_intents_booking_id_idx" ON "payment_intents"("booking_id")`;
  await prisma.$executeRaw`CREATE INDEX IF NOT EXISTS "payment_intents_status_created_at_idx" ON "payment_intents"("status", "created_at")`;

  await prisma.$executeRaw`
    CREATE TABLE IF NOT EXISTS "inventory_movements" (
      "id" TEXT NOT NULL,
      "raw_material_id" TEXT NOT NULL,
      "batch_id" TEXT,
      "source_type" TEXT,
      "source_reference" TEXT,
      "action" TEXT NOT NULL,
      "quantity" BIGINT NOT NULL,
      "unit" TEXT NOT NULL,
      "quantity_before" BIGINT,
      "quantity_after" BIGINT,
      "reserved_before" BIGINT,
      "reserved_after" BIGINT,
      "actor_id" TEXT,
      "note" TEXT,
      "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
      CONSTRAINT "inventory_movements_pkey" PRIMARY KEY ("id")
    )
  `;
  await prisma.$executeRaw`CREATE INDEX IF NOT EXISTS "inventory_movements_raw_material_id_created_at_idx" ON "inventory_movements"("raw_material_id", "created_at")`;
  await prisma.$executeRaw`CREATE INDEX IF NOT EXISTS "inventory_movements_source_type_source_reference_idx" ON "inventory_movements"("source_type", "source_reference")`;
  await prisma.$executeRaw`CREATE INDEX IF NOT EXISTS "inventory_movements_action_created_at_idx" ON "inventory_movements"("action", "created_at")`;

  await ensureCustomerFeedbackTable();
  await ensureSystemSettingsRow();
  await ensurePerformanceIndexes();
}

async function ensurePerformanceIndexes() {
  await prisma.$executeRaw`CREATE INDEX IF NOT EXISTS "raw_materials_is_deleted_name_idx" ON "raw_materials"("is_deleted", "name")`;
  await prisma.$executeRaw`CREATE INDEX IF NOT EXISTS "selling_products_is_deleted_category_name_idx" ON "selling_products"("is_deleted", "category", "name")`;
  await prisma.$executeRaw`CREATE INDEX IF NOT EXISTS "selling_products_is_available_idx" ON "selling_products"("is_available")`;
  await prisma.$executeRaw`CREATE INDEX IF NOT EXISTS "reservations_status_date_time_idx" ON "reservations"("status", "date", "time")`;
  await prisma.$executeRaw`CREATE INDEX IF NOT EXISTS "reservations_date_time_idx" ON "reservations"("date", "time")`;
  await prisma.$executeRaw`CREATE INDEX IF NOT EXISTS "reservations_customer_email_idx" ON "reservations"("customer_email")`;
  await prisma.$executeRaw`CREATE INDEX IF NOT EXISTS "catering_reservations_status_event_date_idx" ON "catering_reservations"("status", "event_date")`;
  await prisma.$executeRaw`CREATE INDEX IF NOT EXISTS "catering_reservations_confirmed_date_idx" ON "catering_reservations"("confirmed_date")`;
  await prisma.$executeRaw`CREATE INDEX IF NOT EXISTS "catering_reservations_customer_email_idx" ON "catering_reservations"("customer_email")`;
  await prisma.$executeRaw`CREATE INDEX IF NOT EXISTS "catering_inquiries_status_event_date_idx" ON "catering_inquiries"("status", "event_date")`;
  await prisma.$executeRaw`CREATE INDEX IF NOT EXISTS "reservation_payments_reservation_received_idx" ON "reservation_payments"("reservation_id", "received_at")`;
  await prisma.$executeRaw`CREATE INDEX IF NOT EXISTS "reservation_payments_catering_received_idx" ON "reservation_payments"("catering_reservation_id", "received_at")`;
  await prisma.$executeRaw`CREATE INDEX IF NOT EXISTS "pos_transactions_created_status_idx" ON "pos_transactions"("created_at", "status")`;
  await prisma.$executeRaw`CREATE INDEX IF NOT EXISTS "pos_items_transaction_idx" ON "pos_items"("transaction_id")`;
  await prisma.$executeRaw`CREATE INDEX IF NOT EXISTS "inventory_transactions_material_created_idx" ON "inventory_transactions"("raw_material_id", "created_at")`;
  await prisma.$executeRaw`CREATE INDEX IF NOT EXISTS "inventory_transactions_type_created_idx" ON "inventory_transactions"("transaction_type", "created_at")`;
  await prisma.$executeRaw`CREATE INDEX IF NOT EXISTS "material_batches_material_disposed_expiration_idx" ON "material_batches"("raw_material_id", "is_disposed", "expiration_date")`;
  await prisma.$executeRaw`CREATE INDEX IF NOT EXISTS "customer_feedback_status_created_idx" ON "customer_feedback"("status", "created_at")`;
}

async function ensureCustomerFeedbackTable() {
  await prisma.$executeRaw`
    CREATE TABLE IF NOT EXISTS customer_feedback (
      id TEXT PRIMARY KEY,
      feedback_id TEXT UNIQUE NOT NULL,
      customer_name TEXT NOT NULL,
      customer_email TEXT,
      customer_phone TEXT,
      visit_type TEXT NOT NULL,
      rating INTEGER NOT NULL,
      message TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'new',
      created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `;
}

// Lightweight health check — does not depend on the database. Use for uptime
// monitoring and to let the platform know the process is healthy quickly.
app.get("/health/live", (_req, res) => {
  res.json({ ok: true, uptime: process.uptime(), timestamp: new Date().toISOString() });
});

app.get('/health', async (_req, res) => {
  const databaseIsUp = await checkDatabaseHealth();
  const database = getDatabaseStatus();
  res.status(200).json({
    ok: databaseIsUp,
    server: "up",
    database: database.database,
    message: databaseIsUp ? undefined : "Reconnecting, please try again.",
    uptime: process.uptime(),
    timestamp: new Date().toISOString()
  });
});

app.get("/health/db", async (_req, res) => {
  try {
    const [database] = await prisma.$queryRaw<Array<{ database_name: string; schema_name: string }>>`
      SELECT current_database() AS database_name, current_schema() AS schema_name
    `;
    const [users, products, materials] = await Promise.all([
      prisma.user.count(),
      prisma.sellingProduct.count(),
      prisma.rawMaterial.count()
    ]);

    res.json({
      ok: true,
      database,
      counts: { users, products, materials },
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    markDatabaseDown(error);
    const databaseError = getDatabaseErrorResponse(error instanceof Error ? error : new Error(String(error)));
    res.status(databaseError?.status ?? 503).json({
      ok: false,
      message: databaseError?.message ?? "Database health check failed.",
      timestamp: new Date().toISOString()
    });
  }
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

function getMimeTypeFromPath(filePath: string) {
  switch (path.extname(filePath).toLowerCase()) {
    case ".jpg":
    case ".jpeg":
      return "image/jpeg";
    case ".png":
      return "image/png";
    case ".gif":
      return "image/gif";
    case ".webp":
      return "image/webp";
    case ".svg":
      return "image/svg+xml";
    default:
      return "application/octet-stream";
  }
}

function getExtensionFromMimeType(mimeType: string) {
  switch (mimeType.toLowerCase()) {
    case "image/jpeg":
      return "jpg";
    case "image/png":
      return "png";
    case "image/gif":
      return "gif";
    case "image/webp":
      return "webp";
    case "image/svg+xml":
      return "svg";
    default:
      return "bin";
  }
}

function parseDataUrl(dataUrl: string) {
  const match = dataUrl.match(/^data:(image\/[a-zA-Z+.-]+);base64,(.+)$/);

  if (!match) {
    return null;
  }

  return {
    mimeType: match[1],
    buffer: Buffer.from(match[2], "base64")
  };
}

function getPersistableImageValue(imageUrl?: string | null) {
  if (!imageUrl) {
    return null;
  }

  if (imageUrl.startsWith("data:")) {
    return imageUrl;
  }

  if (imageUrl.startsWith("/uploads/")) {
    return imageUrl;
  }

  return imageUrl;
}

async function uploadFileToSupabase(filePath: string, storagePath: string) {
  if (!useSupabaseStorage || !supabase || !supabaseStorageBucket) {
    return null;
  }

  const fileStream = fs.createReadStream(filePath);
  const { error: uploadError } = await supabase.storage.from(supabaseStorageBucket).upload(storagePath, fileStream, {
    cacheControl: "public, max-age=2592000, immutable"
  });

  if (uploadError) {
    throw uploadError;
  }

  const publicUrlData = supabase.storage.from(supabaseStorageBucket).getPublicUrl(storagePath);

  if (!publicUrlData.data?.publicUrl) {
    throw new Error("Failed to get Supabase public URL");
  }

  return publicUrlData.data.publicUrl;
}

async function persistDataUrlImage(productId: string, imageUrl: string) {
  const parsed = parseDataUrl(imageUrl);
  if (!parsed) {
    return null;
  }

  const extension = getExtensionFromMimeType(parsed.mimeType);
  const filename = `${productId}-${Date.now()}.${extension}`;
  const storagePath = `products/${filename}`;

  if (useSupabaseStorage && supabase && supabaseStorageBucket) {
    const { error: uploadError } = await supabase.storage.from(supabaseStorageBucket).upload(storagePath, parsed.buffer, {
      contentType: parsed.mimeType,
      cacheControl: "public, max-age=2592000, immutable"
    });

    if (uploadError) {
      throw uploadError;
    }

    const publicUrlData = supabase.storage.from(supabaseStorageBucket).getPublicUrl(storagePath);

    if (!publicUrlData.data?.publicUrl) {
      throw new Error("Failed to get Supabase public URL");
    }

    return publicUrlData.data.publicUrl;
  }

  const localFilename = `${Date.now()}-${Math.round(Math.random() * 1e9)}-${filename}`;
  const localPath = path.join(uploadDir, localFilename);
  fs.writeFileSync(localPath, parsed.buffer);
  return `/uploads/products/${localFilename}`;
}

async function normalizeProductImage(product: { id: string; image_url: string | null }) {
  const imageUrl = product.image_url;

  if (!imageUrl) {
    return null;
  }

  if (imageUrl.startsWith("data:")) {
    const persistedUrl = await persistDataUrlImage(product.id, imageUrl);

    if (persistedUrl && persistedUrl !== imageUrl) {
      await prisma.sellingProduct.update({
        where: { id: product.id },
        data: { image_url: persistedUrl }
      });
    }

    return persistedUrl ?? imageUrl;
  }

  if (imageUrl.startsWith("/uploads/") && useSupabaseStorage && supabase && supabaseStorageBucket) {
    const localPath = path.join(__dirname, "..", imageUrl.replace(/^\/+/, ""));

    if (fs.existsSync(localPath)) {
      const storagePath = imageUrl.replace(/^\/uploads\/?/, "");
      const publicUrl = await uploadFileToSupabase(localPath, storagePath);

      if (publicUrl && publicUrl !== imageUrl) {
        await prisma.sellingProduct.update({
          where: { id: product.id },
          data: { image_url: publicUrl }
        });

        return publicUrl;
      }
    }
  }

  return imageUrl;
}

async function backfillPersistedProductImages() {
  const whereClause: any = { is_deleted: false };

  if (useSupabaseStorage) {
    whereClause.OR = [
      { image_url: { startsWith: "/uploads/products/" } },
      { image_url: { startsWith: "data:" } }
    ];
  } else {
    whereClause.image_url = { startsWith: "data:" };
  }

  const products = await prisma.sellingProduct.findMany({
    where: whereClause,
    select: { id: true, image_url: true }
  });

  for (const product of products) {
    await normalizeProductImage(product);
  }
}

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

  const jwtSecret = getJwtSecret();
  if (!jwtSecret) {
    return null;
  }

  try {
    return jwt.verify(token, jwtSecret) as TokenPayload;
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

  const requiredRoles = req.path.startsWith("/api/staff/reservations/") ? ["admin"] : roles;
  if (!requiredRoles.includes(role)) {
    res.status(403).json({ message: "Forbidden" });
    return null;
  }

  return user;
}

const frontendUrl = process.env.FRONTEND_URL?.trim();
const allowedFrontendOrigins = new Set([
  "http://localhost:5173",
  "http://127.0.0.1:5173",
  "https://katana-sushi-u54k.vercel.app",
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
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE"],
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
  "/images",
  express.static(path.resolve(__dirname, "..", "..", "frontend", "public", "images"), {
    immutable: true,
    maxAge: "1y",
    setHeaders: (res) => {
      res.setHeader("Cross-Origin-Resource-Policy", "cross-origin");
      res.setHeader("Cache-Control", "public, max-age=31536000, immutable");
    }
  })
);
app.use(
  "/uploads",
  express.static(path.join(__dirname, "..", "uploads"), {
    immutable: true,
    maxAge: "1y",
    setHeaders: (res) => {
      res.setHeader("Cross-Origin-Resource-Policy", "cross-origin");
      res.setHeader("Cache-Control", "public, max-age=31536000, immutable");
    }
  })
);
app.use("/api", (req, res, next) => {
  const database = getDatabaseStatus();

  if (database.database !== "up") {
    return res.status(503).json({ message: "Reconnecting, please try again." });
  }

  return next();
});
app.use("/api", paymentRoutes);
app.use(diningPosRoutes);

app.get("/", (_req, res) => {
  res.json({ message: "Katana Sushi API" });
});

const reservationBodySchema = z.object({
  customer_name: z.string().min(1),
  customer_phone: z.string().regex(/^09\d{9}$/),
  customer_email: z.string().email(),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  time: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
  party_size: z.coerce.number().int().min(1).max(20),
  special_requests: z.string().optional()
});

const cateringInquiryBodySchema = z.object({
  customer_name: z.string().min(1),
  customer_phone: z.string().regex(/^09\d{9}$/),
  customer_email: z.string().email(),
  event_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  headcount: z.union([z.coerce.number().int().min(1), z.null()]).optional(),
  venue_address: z.string().min(5),
  package_type: z.enum(["sushi_station", "sashimi_bar", "tempura_live"]).optional().nullable(),
  message: z.string().optional()
});

const customerFeedbackBodySchema = z.object({
  customer_name: z.string().min(1),
  customer_email: z.string().email().optional().or(z.literal("")),
  customer_phone: z.string().regex(/^09\d{9}$/).optional().or(z.literal("")),
  visit_type: z.enum(["dine_in", "takeout", "delivery", "catering", "general"]),
  rating: z.coerce.number().int().min(1).max(5),
  message: z.string().min(10)
});

const reservationDineInBodySchema = z.object({
  customer_name: z.string().trim().min(1).max(120),
  customer_phone: z.string().regex(/^09\d{9}$/),
  customer_email: z.string().trim().email().max(254),
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
  payment_plan: z.enum(["full_payment", "pay_at_venue"]).default("pay_at_venue"),
  payment_method: z.enum(["cash", "gcash", "bank_transfer"]).optional().nullable(),
  payment_transaction_id: z.string().optional(),
  booking_id: z.string().optional()
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

  if (data.payment_plan === "full_payment" && !data.payment_method) {
    ctx.addIssue({
      path: ["payment_method"],
      code: z.ZodIssueCode.custom,
      message: "Payment method is required for full online payment."
    });
  }

  if (data.payment_plan === "pay_at_venue" && data.payment_transaction_id) {
    ctx.addIssue({
      path: ["payment_transaction_id"],
      code: z.ZodIssueCode.custom,
      message: "A payment transaction is not expected when paying at the restaurant."
    });
  }
});

const tableReservationBodySchema = z.object({
  customer_name: z.string().trim().min(1).max(120),
  customer_phone: z.string().regex(/^09\d{9}$/),
  customer_email: z.string().trim().email().max(254),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  time: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
  party_size: z.coerce.number().int().min(1).max(RESERVATION_SETTINGS.MAX_GUESTS),
  reservation_type: z.enum(["dine_in", "unlimited"])
});

const cateringReservationBodySchema = z.object({
  customer_name: z.string().min(1),
  customer_phone: z.string().regex(/^09\d{9}$/),
  customer_email: z.string().email(),
  event_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  event_time: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
  headcount: z.union([z.coerce.number().int().min(1), z.null()]).optional(),
  venue_address: z.string().min(5),
  event_type: z.enum(["Wedding", "Birthday", "Corporate Event", "Private Party", "Graduation", "Other", "Others"]),
  event_type_other: z.string().trim().max(60).optional().nullable(),
  package_id: z.string().min(1),
  package_ids: z.array(z.string().min(1)).min(1).optional(),
  sashimi_quantity_kg: z.number().int().positive().optional(),
  payment_plan: z.enum(["downpayment", "full_payment"]),
  payment_method: z.enum(["cash", "gcash", "bank_transfer"]).optional(),
  payment_transaction_id: z.string().optional(),
  reservation_id: z.string().optional(),
  special_requests: z.string().optional()
}).superRefine((data, ctx) => {
  if (data.event_type === "Others" && !data.event_type_other) {
    ctx.addIssue({
      path: ["event_type_other"],
      code: z.ZodIssueCode.custom,
      message: "Please specify the event type."
    });
  }
  if (data.event_type_other && /[<>]/.test(data.event_type_other)) {
    ctx.addIssue({
      path: ["event_type_other"],
      code: z.ZodIssueCode.custom,
      message: "Event type must be plain text."
    });
  }
  if (!data.payment_method) {
    ctx.addIssue({
      path: ["payment_method"],
      code: z.ZodIssueCode.custom,
      message: "Choose a payment method for your payment."
    });
  }
});

const reservationPaymentBodySchema = z.object({
  amount: z.coerce.number().positive(),
  payment_method: z.enum(["cash", "gcash", "bank_transfer"]),
  reference_number: z.string().optional().nullable(),
  cash_received: z.coerce.number().positive().optional().nullable(),
  received_by: z.string().optional(),
  override_reason: z.string().optional()
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
  const paymentEvents = reservation.payments ?? [];
  const hasRecordedDownpayment = paymentEvents.some((payment: any) =>
    ["downpayment", "full_payment"].includes(payment.payment_stage)
  );

  if (!hasRecordedDownpayment && Number(reservation.downpayment_amount ?? 0) > 0 && reservation.downpayment_status === "paid") {
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
    if (["refund", "refund_downpayment", "cancellation"].includes(payment.payment_stage)) {
      continue;
    }
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
  const paymentEvents = reservation.payments ?? [];
  const downpaymentEvents = paymentEvents.filter((payment: any) =>
    ["downpayment", "full_payment"].includes(payment.payment_stage)
  );
  const balanceEvents = paymentEvents.filter((payment: any) =>
    ["remaining_balance", "balance"].includes(payment.payment_stage)
  );
  const refundEvents = paymentEvents.filter((payment: any) =>
    ["refund", "refund_downpayment"].includes(payment.payment_stage)
  );
  const recordedDownpayment = downpaymentEvents.length > 0
    ? downpaymentEvents.reduce((total: number, payment: any) => total + Number(payment.amount), 0)
    : Number(reservation.downpayment_status === "paid" ? reservation.downpayment_amount ?? 0 : 0);
  const balancePaid = balanceEvents.reduce((total: number, payment: any) => total + Number(payment.amount), 0);
  const historicalRefunds = refundEvents.reduce((total: number, payment: any) => total + Number(payment.amount), 0);
  const netPaid = roundMoney(Math.max(recordedDownpayment + balancePaid - historicalRefunds, 0));
  const total = Number(reservation.total_price ?? 0);
  const status = String(reservation.status ?? "").toLowerCase();
  const terminal = ["cancelled", "canceled", "declined", "rejected", "expired", "no-show", "no_show"].includes(status);
  const remaining = roundMoney(Math.max(total - netPaid, 0));
  let paymentStatus = netPaid > 0 ? "Payment received" : "Unpaid";

  if (status === "cancelled" || status === "canceled") {
    paymentStatus = "Cancelled";
  } else if (status === "no-show" || status === "no_show") {
    paymentStatus = "No-show";
  } else if (terminal) {
    paymentStatus = status.replace(/_/g, " ").replace(/^\w/, (letter) => letter.toUpperCase());
  } else if (total <= 0 && reservation.payment_plan === "pay_at_venue" && netPaid <= 0) {
    paymentStatus = "Pay at restaurant after dining";
  } else if (remaining <= 0) {
    paymentStatus = status === "pending" || status === "pending_approval"
      ? "Paid; awaiting approval"
      : "Fully paid";
  } else if (netPaid <= 0) {
    paymentStatus = status === "pending" || status === "pending_approval"
      ? "Unpaid; awaiting approval"
      : "Unpaid";
  } else if (status === "pending" || status === "pending_approval") {
    paymentStatus = "Partially paid; awaiting approval";
  } else if (status !== "pending" && status !== "pending_approval" && balancePaid > 0) {
    paymentStatus = "Partial";
  } else if (status !== "pending" && status !== "pending_approval") {
    const bookingDate = reservation.date ?? reservation.event_date;
    paymentStatus = bookingDate && manilaDateKey(bookingDate) < manilaDateKey(new Date())
      ? "Balance overdue"
      : "Balance due";
  }

  return {
    payment_history: buildPaymentHistory(reservation),
    net_paid: netPaid,
    remaining_balance: remaining,
    payment_status: paymentStatus
  };
}

async function getVerifiedDownpayment(
  transactionId: string | undefined,
  bookingId: string,
  reservationType: "dine_in" | "catering",
  paymentMethod: string | null | undefined,
  expectedAmount: number,
  expectedPurpose: "downpayment" | "full_payment" = "downpayment"
) {
  if (!transactionId?.trim()) {
    throw new InventoryError("A verified payment is required before submitting this booking.", "PAYMENT_REQUIRED", 400);
  }

  const intent = await paymentIntentStore.findVerifiedTransaction(transactionId);
  if (
    !intent ||
    intent.status !== "succeeded" ||
    !intent.transactionId ||
    intent.bookingId !== bookingId ||
    intent.reservationType !== reservationType ||
    intent.purpose !== expectedPurpose
  ) {
    throw new InventoryError("The payment could not be verified for this booking. Please complete payment again.", "PAYMENT_NOT_VERIFIED", 400);
  }
  if (!paymentMethod || intent.paymentMethod !== paymentMethod) {
    throw new InventoryError("The verified payment method does not match this booking.", "PAYMENT_METHOD_MISMATCH", 400);
  }
  if (Math.abs(intent.amount - expectedAmount) > 0.01) {
    throw new InventoryError(
      `The required payment is PHP ${expectedAmount.toFixed(2)}. Please restart payment with the correct amount.`,
      "PAYMENT_AMOUNT_MISMATCH",
      400
    );
  }

  return { ...intent, transactionId: intent.transactionId };
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

const cateringPackageInventoryInclusions: Record<string, string[]> = {
  pkg_sushi_50_60: sushiStationInclusions,
  pkg_sushi_75_85: sushiStationInclusions,
  pkg_sushi_100_120: sushiStationInclusions,
  pkg_sushi_150_170: sushiStationInclusions,
  pkg_sushi_200_220: sushiStationInclusions,
  pkg_sashimi_20_29: ["Whole tuna sashimi service"],
  pkg_sashimi_30_40: ["Whole tuna sashimi service"],
  pkg_tempura_live: ["Live tempura cooking station"]
};

function getCateringPackageItems(items: Prisma.JsonValue | null | undefined): Prisma.JsonObject {
  if (!items || typeof items !== "object" || Array.isArray(items)) {
    return {};
  }

  return items as Prisma.JsonObject;
}

function getCateringPackagePrice(
  stationPackage: { items: Prisma.JsonValue | null },
  quantity?: number
): number {
  const items = getCateringPackageItems(stationPackage.items);
  const pricingType = items.pricingType;
  const pricingModel = items.pricingModel;

  if (pricingType === "quote" || pricingModel === "quote") {
    return 0;
  }

  const perUnitPrice = typeof items.pricePerUnit === "number"
    ? items.pricePerUnit
    : typeof items.pricePerKg === "number"
      ? items.pricePerKg
      : null;
  if (pricingType === "range" || pricingType === "per_unit" || pricingModel === "per_unit") {
    if (
      perUnitPrice === null ||
      !Number.isFinite(perUnitPrice) ||
      perUnitPrice < 0 ||
      quantity === undefined ||
      !Number.isFinite(quantity) ||
      quantity <= 0
    ) {
      throw new Error("Catering package has invalid per-unit pricing data.");
    }
    return perUnitPrice * quantity;
  }

  const fixedPrice = typeof items.fixedPrice === "number" ? items.fixedPrice : items.flatPrice;
  if (pricingModel === "fixed" || pricingType === "flat") {
    if (typeof fixedPrice !== "number" || !Number.isFinite(fixedPrice) || fixedPrice < 0) {
      throw new Error("Catering package has invalid fixed pricing data.");
    }
    return fixedPrice;
  }

  if (pricingModel === "tier") {
    const tierPrice = typeof fixedPrice === "number" ? fixedPrice : items.minPrice;
    if (typeof tierPrice !== "number" || !Number.isFinite(tierPrice) || tierPrice < 0) {
      throw new Error("Catering package has invalid tier pricing data.");
    }
    return tierPrice;
  }

  throw new Error("Catering package has an unsupported pricing configuration.");
}

function normalizeProductName(value: string) {
  return value
    .toLowerCase()
    .replace(/\([^)]*\)/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

type ReservationRecipeProduct = {
  id: string;
  name: string;
  recipes: Array<{
    recipe_ingredients: Array<{
      quantity_per_yield: unknown;
      unit: string;
      raw_material: { id: string; name: string; unit: string };
    }>;
  }>;
};

function getReservationIngredientRequirements(
  selectedProducts: Array<{
    product_id?: string | null;
    productId?: string | null;
    name?: string | null;
    quantity?: number | string | null;
  }> = [],
  products: ReservationRecipeProduct[]
) {
  if (!Array.isArray(selectedProducts) || selectedProducts.length === 0) {
    return { ingredients: [], warnings: [] as string[] };
  }

  const productsById = new Map(products.map((product) => [product.id, product]));
  const productsByName = new Map(
    products.map((product) => [normalizeProductName(product.name), product])
  );

  const totals = new Map<string, { material_id: string; material: string; quantity: number; unit: string }>();
  const warnings: string[] = [];

  for (const item of selectedProducts) {
    const quantity = Number(item.quantity ?? 1);
    if (!Number.isFinite(quantity) || quantity <= 0) {
      continue;
    }

    const productId = typeof item.product_id === "string" ? item.product_id : item.productId;
    const product = productId
      ? productsById.get(productId)
      : productsByName.get(normalizeProductName(String(item.name ?? "")));

    if (!product) {
      warnings.push(`Menu item "${item.name ?? productId ?? "Unknown"}" was not found in the product catalog.`);
      continue;
    }

    const recipeIngredients = product.recipes[0]?.recipe_ingredients ?? [];
    if (recipeIngredients.length === 0) {
      warnings.push(`${product.name} has no inventory recipe.`);
      continue;
    }

    for (const ingredient of recipeIngredients) {
      const material = ingredient.raw_material;
      if (!inventoryUnitsMatch(ingredient.unit, material.unit)) {
        warnings.push(`${product.name}: ${material.name} uses ${ingredient.unit} in its recipe but ${material.unit} in stock.`);
        continue;
      }
      const required = Number(ingredient.quantity_per_yield) * quantity;
      const existing = totals.get(material.id);
      totals.set(material.id, existing
        ? { ...existing, quantity: existing.quantity + required }
        : {
            material_id: material.id,
            material: material.name,
            quantity: required,
            unit: material.unit
          });
    }
  }

  return {
    ingredients: Array.from(totals.values()).sort((first, second) => first.material.localeCompare(second.material)),
    warnings: Array.from(new Set(warnings))
  };
}

function getCateringPackageProductNames(packageId: string) {
  return cateringPackageInventoryInclusions[packageId] ?? [];
}

async function findCateringStationPackage(packageId: string) {
  return prisma.cateringPackage.findFirst({
    where: { id: packageId, stationType: { not: null } }
  });
}

function manilaDateToUtc(dateString: string) {
  return new Date(`${dateString}T00:00:00+08:00`);
}

function isFutureManilaDateTime(date: string, time: string, now = new Date()) {
  const eventTimestamp = Date.parse(`${date}T${time}:00+08:00`);
  return Number.isFinite(eventTimestamp) && eventTimestamp > now.getTime();
}

function isAtLeastOneManilaDayAhead(date: string, now = new Date()) {
  const tomorrow = new Date(`${manilaDateKey(now)}T00:00:00.000Z`);
  tomorrow.setUTCDate(tomorrow.getUTCDate() + 1);
  return date >= tomorrow.toISOString().slice(0, 10);
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
  return time >= "12:00" && time <= "20:00";
}

function isFutureReservationTime(date: Date, time: string) {
  const bookingTime = new Date(`${manilaDateKey(date)}T${time}:00+08:00`);
  return Number.isFinite(bookingTime.getTime()) && bookingTime.getTime() > Date.now();
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

type PrismaTx = Prisma.TransactionClient;

async function lockCateringReservationForUpdate(tx: Prisma.TransactionClient, reservationId: string) {
  await tx.$queryRaw`SELECT "id" FROM "catering_reservations" WHERE "id" = ${reservationId} FOR UPDATE`;
}

async function lockDineInReservationForUpdate(tx: Prisma.TransactionClient, reservationId: string) {
  await tx.$queryRaw`SELECT "id" FROM "reservations" WHERE "id" = ${reservationId} FOR UPDATE`;
}

async function cancelReservationIngredientLocks(
  tx: Prisma.TransactionClient,
  reservationId: string,
  userId?: string,
  reason?: string,
  bookingReference?: string
) {
  const locks = await tx.cateringIngredientLock.findMany({
    where: { catering_reservation_id: reservationId, is_released: false },
    include: { raw_material: true }
  });

  if (locks.length === 0) {
    await tx.cateringReservation.update({
      where: { id: reservationId },
      data: { ingredients_locked: false }
    });
    return;
  }

  const quantitiesByMaterial = new Map<string, number>();
  for (const lock of locks) {
    quantitiesByMaterial.set(
      lock.raw_material_id,
      (quantitiesByMaterial.get(lock.raw_material_id) ?? 0) + Number(lock.reserved_quantity)
    );
  }

  await tx.cateringIngredientLock.updateMany({
    where: { catering_reservation_id: reservationId, is_released: false },
    data: { is_released: true, released_at: new Date() }
  });

  for (const [materialId, releasedQuantity] of quantitiesByMaterial) {
    const reservedAfter = await getActiveCateringReservationQuantity(tx, materialId);
    await recordReservationMovement(tx, {
      raw_material_id: materialId,
      quantity: releasedQuantity,
      unit: locks.find((lock) => lock.raw_material_id === materialId)?.unit ?? "unit",
      source_type: "catering",
      source_reference: bookingReference ?? reservationId,
      action: "Released",
      reserved_before: reservedAfter + releasedQuantity,
      reserved_after: reservedAfter,
      actor_id: userId,
      note: reason ?? "Catering reservation cancelled"
    });
  }

  await tx.inventoryTransaction.createMany({
    data: locks.map((lock) => ({
      raw_material_id: lock.raw_material_id,
      transaction_type: "release",
      quantity: Number(lock.reserved_quantity),
      unit: lock.unit,
      reference: reason ?? `Reservation release ${reservationId}`,
      reason: "reservation_cancelled",
      user_id: userId
    }))
  });

  await tx.cateringReservation.update({
    where: { id: reservationId },
    data: { ingredients_locked: false }
  });
}

async function cancelDineInIngredientLocks(
  tx: Prisma.TransactionClient,
  reservationId: string,
  userId?: string,
  reason?: string,
  bookingReference?: string
) {
  const locks = await tx.reservationIngredientLock.findMany({
    where: { reservation_id: reservationId, is_released: false },
    include: { raw_material: true }
  });
  if (locks.length === 0) return;

  const quantitiesByMaterial = new Map<string, number>();
  for (const lock of locks) {
    quantitiesByMaterial.set(
      lock.raw_material_id,
      (quantitiesByMaterial.get(lock.raw_material_id) ?? 0) + Number(lock.reserved_quantity)
    );
  }

  await tx.reservationIngredientLock.updateMany({
    where: { reservation_id: reservationId, is_released: false },
    data: { is_released: true, released_at: new Date() }
  });

  for (const [materialId, releasedQuantity] of quantitiesByMaterial) {
    const reservedAfter = await getActiveCateringReservationQuantity(tx, materialId);
    const material = locks.find((lock) => lock.raw_material_id === materialId);
    await recordReservationMovement(tx, {
      raw_material_id: materialId,
      quantity: releasedQuantity,
      unit: material?.unit ?? "unit",
      source_type: "dine-in",
      source_reference: bookingReference ?? reservationId,
      action: "Released",
      reserved_before: reservedAfter + releasedQuantity,
      reserved_after: reservedAfter,
      actor_id: userId,
      note: reason ?? "Dine-in booking cancelled"
    });
  }

  await tx.inventoryTransaction.createMany({
    data: locks.map((lock) => ({
      raw_material_id: lock.raw_material_id,
      transaction_type: "release",
      quantity: Number(lock.reserved_quantity),
      unit: lock.unit,
      reference: reason ?? `Reservation release ${reservationId}`,
      reason: "reservation_cancelled",
      user_id: userId
    }))
  });
}

async function wasteCateringReservationIngredients(
  tx: Prisma.TransactionClient,
  input: {
    reservationId: string;
    materialId: string;
    quantity: number;
    bookingReference: string;
    actorId: string;
    reason: string;
    batchId?: string;
  }
) {
  const locks = await tx.cateringIngredientLock.findMany({
    where: {
      catering_reservation_id: input.reservationId,
      raw_material_id: input.materialId,
      is_released: false
    },
    orderBy: { created_at: "asc" }
  });
  const reservedForBooking = locks.reduce((total, lock) => total + Number(lock.reserved_quantity), 0);

  if (reservedForBooking < input.quantity) {
    throw new InventoryError(
      `This booking has only ${Number(reservedForBooking.toFixed(3))} units of this material reserved.`,
      "INSUFFICIENT_BOOKING_RESERVATION",
      409
    );
  }

  const consumed = await consumeMaterialStock(tx, {
    raw_material_id: input.materialId,
    quantity: input.quantity,
    source_type: "catering",
    source_reference: input.bookingReference,
    actor_id: input.actorId,
    action: "Wasted",
    releaseReservedQuantity: input.quantity,
    batch_id: input.batchId,
    note: input.reason
  });

  let remainingToRelease = input.quantity;
  for (const lock of locks) {
    if (remainingToRelease <= 0) break;
    const reserved = Number(lock.reserved_quantity);
    const released = Math.min(reserved, remainingToRelease);
    const remainder = reserved - released;
    await tx.cateringIngredientLock.update({
      where: { id: lock.id },
      data: remainder <= 0
        ? { reserved_quantity: 0, is_released: true, released_at: new Date() }
        : { reserved_quantity: remainder }
    });
    remainingToRelease -= released;
  }

  return consumed;
}

async function wasteDineInReservationIngredients(
  tx: Prisma.TransactionClient,
  input: {
    reservationId: string;
    materialId: string;
    quantity: number;
    bookingReference: string;
    actorId: string;
    reason: string;
    batchId?: string;
  }
) {
  const locks = await tx.reservationIngredientLock.findMany({
    where: {
      reservation_id: input.reservationId,
      raw_material_id: input.materialId,
      is_released: false
    },
    orderBy: { created_at: "asc" }
  });
  const reservedForBooking = locks.reduce((total, lock) => total + Number(lock.reserved_quantity), 0);
  if (reservedForBooking < input.quantity) {
    throw new InventoryError(
      `This booking has only ${Number(reservedForBooking.toFixed(3))} units of this material reserved.`,
      "INSUFFICIENT_BOOKING_RESERVATION",
      409
    );
  }

  const consumed = await consumeMaterialStock(tx, {
    raw_material_id: input.materialId,
    quantity: input.quantity,
    source_type: "dine-in",
    source_reference: input.bookingReference,
    actor_id: input.actorId,
    action: "Wasted",
    releaseReservedQuantity: input.quantity,
    batch_id: input.batchId,
    note: input.reason
  });

  let remainingToRelease = input.quantity;
  for (const lock of locks) {
    if (remainingToRelease <= 0) break;
    const reserved = Number(lock.reserved_quantity);
    const released = Math.min(reserved, remainingToRelease);
    const remainder = reserved - released;
    await tx.reservationIngredientLock.update({
      where: { id: lock.id },
      data: remainder <= 0
        ? { reserved_quantity: 0, is_released: true, released_at: new Date() }
        : { reserved_quantity: remainder }
    });
    remainingToRelease -= released;
  }

  return consumed;
}

async function createCateringIngredientLocks(
  tx: PrismaTx,
  reservationId: string,
  packageIds: string[],
  headcount: number,
  userId?: string
) {
  const packageProductNames = [...new Set(packageIds.flatMap(getCateringPackageProductNames))];

  if (packageProductNames.length === 0) {
    throw new InventoryError(
      "This catering package has no menu items linked to inventory recipes.",
      "CATERING_PACKAGE_RECIPE_MISSING",
      409
    );
  }

  const reservation = await tx.cateringReservation.findUnique({
    where: { id: reservationId },
    select: { reservation_id: true }
  });
  const bookingReference = reservation?.reservation_id ?? reservationId;

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
  const selectedProducts = packageProductNames.map((name) => {
      const normalized = normalizeProductName(name);
      return (
        productsByNormalizedName.get(normalized) ??
        products.find((product) => normalizeProductName(product.name).startsWith(normalized))
      );
    });
  const missingProduct = packageProductNames.find((_, index) => !selectedProducts[index]);
  if (missingProduct) {
    throw new InventoryError(
      `Catering menu item "${missingProduct}" is not linked to a selling product and inventory recipe.`,
      "CATERING_PRODUCT_RECIPE_MISSING",
      409
    );
  }
  const locksByMaterial = new Map<string, { raw_material_id: string; reserved_quantity: number; unit: string }>();

  for (const product of selectedProducts) {
    if (!product) continue;
    const recipeIngredients = product.recipes[0]?.recipe_ingredients ?? [];
    if (recipeIngredients.length === 0) {
      throw new InventoryError(
        `Catering menu item "${product.name}" has no inventory recipe.`,
        "CATERING_RECIPE_MISSING",
        409
      );
    }

    for (const ingredient of recipeIngredients) {
      const material = ingredient.raw_material;
      if (!inventoryUnitsMatch(ingredient.unit, material.unit)) {
        throw new InventoryError(
          `${product.name} recipe unit for ${material.name} does not match its stock unit.`,
          "UNIT_MISMATCH",
          409
        );
      }
      const reservedQuantity = Number(ingredient.quantity_per_yield) * headcount;
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

  for (const lock of locksByMaterial.values()) {
    await lockMaterialForUpdate(tx, lock.raw_material_id);
    const material = await tx.rawMaterial.findUnique({ where: { id: lock.raw_material_id } });

    if (!material) {
      throw new InventoryError("A recipe refers to a material that no longer exists.", "MATERIAL_NOT_FOUND", 409);
    }

    await assertBatchQuantitiesMatchOnHand(
      tx,
      material.id,
      material.name,
      Number(material.current_stock)
    );
    validateInventoryQuantity(lock.reserved_quantity, material.unit);
    const reservedBefore = await getActiveCateringReservationQuantity(tx, material.id);
    const available = calculateAvailableQuantity(Number(material.current_stock), reservedBefore);

    if (available < 0) {
      throw new InventoryError(
        `${material.name} already has a stock shortage of ${Number((-available).toFixed(3))} ${material.unit}. Reconcile stock before confirming bookings.`,
        "NEGATIVE_AVAILABLE_STOCK",
        409
      );
    }

    assertEnoughAvailable(material.name, material.unit, lock.reserved_quantity, available);
  }

  await tx.cateringIngredientLock.createMany({
    data: Array.from(locksByMaterial.values()).map((lock) => ({
      ...lock,
      catering_reservation_id: reservationId
    }))
  });

  for (const lock of locksByMaterial.values()) {
    const reservedAfter = await getActiveCateringReservationQuantity(tx, lock.raw_material_id);
    await recordReservationMovement(tx, {
      raw_material_id: lock.raw_material_id,
      quantity: lock.reserved_quantity,
      unit: lock.unit,
      source_type: "catering",
      source_reference: bookingReference,
      action: "Reserved",
      reserved_before: reservedAfter - lock.reserved_quantity,
      reserved_after: reservedAfter,
      actor_id: userId,
      note: "Catering booking confirmed"
    });
  }

  await tx.cateringReservation.update({
    where: { id: reservationId },
    data: { ingredients_locked: true }
  });
}

async function createDineInIngredientLocks(
  tx: PrismaTx,
  reservationId: string,
  selectedItems: Array<{ product_id: string; name: string; quantity: number }>,
  userId?: string
) {
  const reservation = await tx.reservation.findUnique({
    where: { id: reservationId },
    select: { booking_id: true }
  });
  if (!reservation) {
    throw new InventoryError("Dine-in booking not found.", "BOOKING_NOT_FOUND", 404);
  }

  const needs = await getReservationIngredientNeeds(tx, selectedItems);
  for (const need of needs) {
    await lockMaterialForUpdate(tx, need.raw_material_id);
    const material = await tx.rawMaterial.findUnique({ where: { id: need.raw_material_id } });
    if (!material) {
      throw new InventoryError("A recipe refers to a material that no longer exists.", "MATERIAL_NOT_FOUND", 409);
    }
    validateInventoryQuantity(need.quantity, material.unit);
    await assertBatchQuantitiesMatchOnHand(tx, material.id, material.name, Number(material.current_stock));
    const reservedBefore = await getActiveCateringReservationQuantity(tx, material.id);
    const available = calculateAvailableQuantity(Number(material.current_stock), reservedBefore);
    if (available < 0) {
      throw new InventoryError(
        `${material.name} already has a stock shortage of ${Number((-available).toFixed(3))} ${material.unit}. Reconcile stock before confirming bookings.`,
        "NEGATIVE_AVAILABLE_STOCK",
        409
      );
    }
    assertEnoughAvailable(material.name, material.unit, need.quantity, available);
  }

  await tx.reservationIngredientLock.createMany({
    data: needs.map((need) => ({
      reservation_id: reservationId,
      raw_material_id: need.raw_material_id,
      reserved_quantity: need.quantity,
      unit: need.unit
    }))
  });

  for (const need of needs) {
    const reservedAfter = await getActiveCateringReservationQuantity(tx, need.raw_material_id);
    await recordReservationMovement(tx, {
      raw_material_id: need.raw_material_id,
      quantity: need.quantity,
      unit: need.unit,
      source_type: "dine-in",
      source_reference: reservation.booking_id,
      action: "Reserved",
      reserved_before: reservedAfter - need.quantity,
      reserved_after: reservedAfter,
      actor_id: userId,
      note: "Dine-in booking approved"
    });
  }

  if (needs.length > 0) {
    await tx.inventoryTransaction.createMany({
      data: needs.map((need) => ({
        raw_material_id: need.raw_material_id,
        transaction_type: "reserve",
        quantity: need.quantity,
        unit: need.unit,
        reference: `Booking ${reservation.booking_id}`,
        reason: "reservation_confirmed",
        user_id: userId
      }))
    });
  }
}

async function addReservationActivity(
  tx: Prisma.TransactionClient,
  input: {
    reservationId?: string;
    cateringReservationId?: string;
    eventType: string;
    fromStatus?: string | null;
    toStatus?: string | null;
    actorType: string;
    actorId?: string | null;
    actorName?: string | null;
    reason?: string | null;
    details?: Prisma.InputJsonValue;
  }
) {
  return tx.reservationActivity.create({
    data: {
      reservation_id: input.reservationId ?? null,
      catering_reservation_id: input.cateringReservationId ?? null,
      event_type: input.eventType,
      from_status: input.fromStatus ?? null,
      to_status: input.toStatus ?? null,
      actor_type: input.actorType,
      actor_id: input.actorId ?? null,
      actor_name: input.actorName ?? null,
      reason: input.reason ?? null,
      details: input.details
    }
  });
}

async function recordVerifiedDownpayment(
  tx: Prisma.TransactionClient,
  input: {
    transactionId: string;
    reservationId?: string;
    cateringReservationId?: string;
    amount: number;
    method: string;
    paidAt: Date;
    paymentStage?: "downpayment" | "full_payment" | "remaining_balance";
  }
) {
  await tx.paymentTransactionClaim.create({
    data: {
      transaction_id: input.transactionId,
      reservation_id: input.reservationId ?? null,
      catering_reservation_id: input.cateringReservationId ?? null
    }
  });

  await tx.reservationPayment.create({
    data: {
      reservation_id: input.reservationId ?? null,
      catering_reservation_id: input.cateringReservationId ?? null,
      payment_stage: input.paymentStage ?? "downpayment",
      method: input.method,
      amount: input.amount,
      reference_number: input.transactionId,
      source: "online",
      received_at: input.paidAt
    }
  });
}

async function recordDineInReservationPayment(
  reservationId: string,
  body: z.infer<typeof reservationPaymentBodySchema>,
  userId?: string,
  userRole?: string
) {
  return prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT "id" FROM "reservations" WHERE "id" = ${reservationId} FOR UPDATE`;
    const reservation = await tx.reservation.findUnique({ where: { id: reservationId } });

    if (!reservation) {
      throw Object.assign(new Error("Reservation not found"), { statusCode: 404 });
    }
    if (["cancelled", "canceled", "rejected", "declined", "expired", "no_show", "no-show"].includes((reservation.status ?? "").toLowerCase())) {
      throw new InventoryError("A closed booking cannot receive balance payments.", "BOOKING_CLOSED", 409);
    }

    const remainingBalance = Number(reservation.remaining_balance);

    if (remainingBalance <= 0) {
      throw Object.assign(new Error("No remaining balance due."), { statusCode: 400 });
    }
    const offBookingDate = manilaDateKey(reservation.date) !== manilaDateKey(new Date());
    const isAdmin = normalizeRole(userRole) === "admin";
    if (offBookingDate && (!isAdmin || !body.override_reason?.trim())) {
      throw new InventoryError(
        isAdmin
          ? "Add a reason to override the booking-date payment rule."
          : "The remaining balance can only be paid on the booking date. Ask an admin to record an override.",
        "BALANCE_PAYMENT_DATE_RESTRICTED",
        400
      );
    }
    if (!["confirmed", "approved", "seated", "preparing", "in_progress", "pending_final_payment"].includes(reservation.status)) {
      throw new InventoryError("Balance payments are available only for approved bookings.", "BOOKING_NOT_APPROVED", 409);
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
        source: userId ? "staff" : "online",
        recorded_by_id: userId,
        override_reason: offBookingDate ? body.override_reason!.trim() : null
      }
    });
    await addReservationActivity(tx, {
      reservationId: reservation.id,
      eventType: "balance_payment_recorded",
      fromStatus: reservation.status,
      toStatus: reservation.status,
      actorType: userId ? "staff" : "customer",
      actorId: userId,
      actorName: body.received_by,
      reason: offBookingDate ? body.override_reason : null,
      details: { amount: appliedAmount, payment_method: body.payment_method }
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
        remaining_paid_at_venue: false,
        remaining_paid_date: isFullyPaid ? new Date() : reservation.remaining_paid_date,
        status: reservation.status === "pending_final_payment" && isFullyPaid ? "seated" : reservation.status
      },
      include: { payments: { orderBy: { received_at: "asc" } } }
    });
  }, { maxWait: 10_000, timeout: 30_000 });
}

async function recordCateringReservationPayment(
  reservationId: string,
  body: z.infer<typeof reservationPaymentBodySchema>,
  userId?: string
) {
  return prisma.$transaction(async (tx) => {
    await lockCateringReservationForUpdate(tx, reservationId);
    const reservation = await tx.cateringReservation.findUnique({ where: { id: reservationId } });

    if (!reservation) {
      throw Object.assign(new Error("Reservation not found"), { statusCode: 404 });
    }
    if (["cancelled", "canceled", "rejected", "declined", "expired", "no_show", "no-show"].includes((reservation.status ?? "").toLowerCase())) {
      throw new InventoryError("A closed booking cannot receive balance payments.", "BOOKING_CLOSED", 409);
    }

    const remainingBalance = Number(reservation.remaining_balance);

    if (remainingBalance <= 0) {
      throw Object.assign(new Error("No remaining balance due."), { statusCode: 400 });
    }
    const bookingDate = reservation.event_date ?? reservation.confirmed_date;
    if (!bookingDate || manilaDateKey(bookingDate) <= manilaDateKey(new Date())) {
      throw new InventoryError("Catering balances must be paid before the event date.", "BALANCE_PAYMENT_DATE_RESTRICTED", 400);
    }
    if (!["confirmed", "approved", "in_progress", "preparing", "pending_final_payment"].includes(reservation.status ?? "")) {
      throw new InventoryError("Balance payments are available only for approved bookings.", "BOOKING_NOT_APPROVED", 409);
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
        source: userId ? "staff" : "online",
        recorded_by_id: userId
      }
    });
    await addReservationActivity(tx, {
      cateringReservationId: reservation.id,
      eventType: "balance_payment_recorded",
      fromStatus: reservation.status,
      toStatus: reservation.status,
      actorType: userId ? "staff" : "customer",
      actorId: userId,
      actorName: body.received_by,
      details: { amount: appliedAmount, payment_method: body.payment_method }
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
  }, { maxWait: 10_000, timeout: 30_000 });
}

async function recordVerifiedCateringBalancePayment(
  reservationReference: string,
  transactionId: string,
  paymentMethod: string
) {
  const intent = await paymentIntentStore.findVerifiedTransaction(transactionId);
  if (
    !intent ||
    intent.status !== "succeeded" ||
    intent.bookingId !== reservationReference ||
    intent.reservationType !== "catering" ||
    intent.purpose !== "balance" ||
    intent.paymentMethod !== paymentMethod
  ) {
    throw new InventoryError("The payment could not be verified for this catering balance.", "PAYMENT_NOT_VERIFIED", 400);
  }

  const reservation = await prisma.cateringReservation.findUnique({
    where: { reservation_id: reservationReference }
  });
  if (!reservation) {
    throw new InventoryError("Catering booking not found.", "BOOKING_NOT_FOUND", 404);
  }

  return prisma.$transaction(async (tx) => {
    await lockCateringReservationForUpdate(tx, reservation.id);
    const current = await tx.cateringReservation.findUnique({ where: { id: reservation.id } });
    if (!current) {
      throw new InventoryError("Catering booking not found.", "BOOKING_NOT_FOUND", 404);
    }
    const claim = await tx.paymentTransactionClaim.findUnique({ where: { transaction_id: transactionId } });
    if (claim) {
      const claimedPayment = await tx.reservationPayment.findFirst({
        where: {
          catering_reservation_id: current.id,
          reference_number: transactionId
        },
        select: { payment_stage: true }
      });
      if (claim.catering_reservation_id !== current.id || claimedPayment?.payment_stage !== "remaining_balance") {
        throw new InventoryError("This payment was already used for another booking.", "PAYMENT_ALREADY_CLAIMED", 409);
      }
      return tx.cateringReservation.findUnique({
        where: { id: current.id },
        include: { payments: { orderBy: { received_at: "asc" } } }
      });
    }

    const eventDate = current.event_date ?? current.confirmed_date;
    if (!eventDate || manilaDateKey(eventDate) <= manilaDateKey(new Date())) {
      throw new InventoryError("Catering balances must be paid before the event date.", "BALANCE_PAYMENT_DATE_RESTRICTED", 400);
    }
    if (!["confirmed", "approved"].includes(current.status ?? "")) {
      throw new InventoryError("The catering request must be approved before paying its balance.", "BOOKING_NOT_APPROVED", 409);
    }
    const remainingBalance = roundMoney(Number(current.remaining_balance));
    if (remainingBalance <= 0) {
      throw new InventoryError("No remaining balance is due.", "NO_REMAINING_BALANCE", 400);
    }
    if (Math.abs(intent.amount - remainingBalance) > 0.01) {
      throw new InventoryError("The balance changed. Refresh the booking and try payment again.", "PAYMENT_AMOUNT_MISMATCH", 409);
    }

    const paidAt = intent.paidAt ?? new Date();
    await recordVerifiedDownpayment(tx, {
      transactionId,
      cateringReservationId: current.id,
      amount: remainingBalance,
      method: paymentMethod,
      paidAt,
      paymentStage: "remaining_balance"
    });
    const updated = await tx.cateringReservation.update({
      where: { id: current.id },
      data: {
        remaining_balance: 0,
        final_payment_status: "paid",
        final_payment_method: paymentMethod,
        final_payment_date: paidAt,
        full_payment_paid: true,
        full_payment_date: paidAt,
        remaining_paid_at_venue: false,
        remaining_paid_date: paidAt
      },
      include: { payments: { orderBy: { received_at: "asc" } } }
    });
    await addReservationActivity(tx, {
      cateringReservationId: current.id,
      eventType: "balance_payment_recorded",
      fromStatus: current.status,
      toStatus: updated.status,
      actorType: "customer",
      details: { amount: remainingBalance, payment_method: paymentMethod }
    });
    return updated;
  }, { maxWait: 10_000, timeout: 30_000 });
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

async function generateReadableId(
  prefix: string,
  date: Date,
  field: "booking_id" | "inquiry_id" | "reservation_id",
  tx: Prisma.TransactionClient | typeof prisma = prisma
) {
  const stamp = manilaDateKey(date).replace(/-/g, "");
  const count =
    field === "booking_id"
      ? await tx.reservation.count({ where: { booking_id: { startsWith: `${prefix}-${stamp}` } } })
      : field === "inquiry_id"
      ? await tx.cateringInquiry.count({ where: { inquiry_id: { startsWith: `${prefix}-${stamp}` } } })
      : await tx.cateringReservation.count({ where: { reservation_id: { startsWith: `${prefix}-${stamp}` } } });

  return `${prefix}-${stamp}-${String(count + 1).padStart(4, "0")}`;
}

async function generateFeedbackId() {
  const stamp = manilaDateKey(new Date()).replace(/-/g, "");
  const rows = await prisma.$queryRaw<Array<{ count: bigint }>>`
    SELECT COUNT(*)::bigint AS count
    FROM customer_feedback
    WHERE feedback_id LIKE ${`FDB-${stamp}%`}
  `;
  const count = Number(rows[0]?.count ?? 0);

  return `FDB-${stamp}-${String(count + 1).padStart(4, "0")}`;
}

function createFeedbackRowId() {
  return `fb_${Date.now()}_${Math.round(Math.random() * 1e9)}`;
}

function analyzeFeedback(message: string, rating: number) {
  const text = message.toLowerCase();
  const complaintWords = ["bad", "cold", "late", "slow", "rude", "wrong", "dirty", "complain", "complaint", "poor", "terrible", "awful", "disappointed", "refund", "overpriced"];
  const suggestionWords = ["suggest", "please add", "recommend", "should", "could", "improve", "more", "less", "option", "hope"];
  const praiseWords = ["good", "great", "excellent", "amazing", "love", "loved", "perfect", "delicious", "fresh", "friendly", "fast", "thank"];
  const questionWords = ["?", "how", "when", "where", "can you", "do you"];

  if (rating <= 2 || complaintWords.some((word) => text.includes(word))) {
    return "Complaint";
  }

  if (suggestionWords.some((word) => text.includes(word))) {
    return "Suggestion";
  }

  if (rating >= 4 || praiseWords.some((word) => text.includes(word))) {
    return "Praise";
  }

  if (questionWords.some((word) => text.includes(word))) {
    return "Question";
  }

  return "General Feedback";
}

function addMinutesToTime(time: string, minutes: number) {
  const [hour, minute] = time.split(":").map(Number);
  const totalMinutes = hour * 60 + minute + minutes;
  return `${String(Math.floor(totalMinutes / 60)).padStart(2, "0")}:${String(totalMinutes % 60).padStart(2, "0")}`;
}

async function getReservationSlotSummary(
  tx: Prisma.TransactionClient | typeof prisma,
  dateKey: string,
  time: string
) {
  const slotStart = getReservationSlotStart(
    time,
    RESERVATION_SETTINGS.OPENING_TIME,
    RESERVATION_SETTINGS.SLOT_DURATION_MINUTES
  );
  const slotEnd = addMinutesToTime(slotStart, RESERVATION_SETTINGS.SLOT_DURATION_MINUTES);
  const date = manilaDateToUtc(dateKey);
  const [tableCapacity, slot, bookedReservations] = await Promise.all([
    tx.table.aggregate({ where: { is_archived: false }, _sum: { capacity: true } }),
    tx.reservationSlotCapacity.findUnique({
      where: { service_date_slot_start: { service_date: dateKey, slot_start: slotStart } }
    }),
    tx.reservation.aggregate({
      where: {
        date: { gte: startOfDay(date), lte: endOfDay(date) },
        time: { gte: slotStart, lt: slotEnd },
        status: { in: ["pending", "pending_approval", "confirmed", "approved", "seated", "preparing", "in_progress", "pending_final_payment"] }
      },
      _sum: { party_size: true }
    })
  ]);
  const totalTableCapacity = tableCapacity._sum.capacity ?? 0;
  const walkInPax = slot?.walk_in_pax ?? 0;
  const bookedPax = bookedReservations._sum.party_size ?? 0;

  return {
    service_date: dateKey,
    slot_start: slotStart,
    slot_end: slotEnd,
    total_table_capacity: totalTableCapacity,
    walk_in_pax: walkInPax,
    booked_pax: bookedPax,
    available_pax: calculateAvailableReservationPax(
      totalTableCapacity,
      walkInPax,
      bookedPax,
      RESERVATION_SETTINGS.MAX_PAX_PER_SLOT
    )
  };
}

const ACTIVE_TABLE_RESERVATION_STATUSES = [
  "pending",
  "pending_approval",
  "confirmed",
  "approved",
  "seated",
  "preparing",
  "in_progress",
  "pending_final_payment"
];

async function allocateReservationTables(
  tx: Prisma.TransactionClient | typeof prisma,
  dateKey: string,
  time: string,
  partySize: number
) {
  const settings = await tx.$queryRaw<Array<{ estimated_dining_duration_minutes: number }>>`
    SELECT estimated_dining_duration_minutes
    FROM system_settings
    WHERE singleton_key = 'default'
    LIMIT 1
  `;
  const estimatedDurationMinutes = Number(settings[0]?.estimated_dining_duration_minutes);
  if (!Number.isInteger(estimatedDurationMinutes) || estimatedDurationMinutes <= 0) {
    throw new InventoryError(
      "The estimated dining duration setting is missing or invalid. Contact an administrator.",
      "INVALID_DINING_DURATION_SETTING",
      503
    );
  }

  const [tables, assignments, sessions] = await Promise.all([
    tx.table.findMany({
      where: { is_archived: false, is_temporary: false },
      orderBy: [{ table_number: "asc" }, { id: "asc" }],
      select: {
        id: true,
        table_number: true,
        capacity: true,
        status: true,
        linked_to_table_id: true,
        is_temporary: true
      }
    }),
    tx.reservationTableAssignment.findMany({
      where: {
        status: { notIn: ["released", "cancelled"] },
        reservation: {
          is: {
            status: { in: ACTIVE_TABLE_RESERVATION_STATUSES }
          }
        }
      },
      include: { reservation: { select: { date: true, time: true } } }
    }),
    tx.diningTableSession.findMany({
      where: { status: "active" },
      select: {
        table_id: true,
        opened_at: true,
        table_combination: {
          select: { members: { select: { table_id: true } } }
        }
      }
    })
  ]);

  const activeSessionTableIds = new Set(sessions.flatMap((session) => [
    session.table_id,
    ...(session.table_combination?.members.map((member) => member.table_id) ?? [])
  ]));
  const unavailableTableIds = tables
    .filter((table) => {
      const status = normalizeTableStatus(table.status);
      return Boolean(table.linked_to_table_id) ||
        (status !== "available" && status !== "occupied") ||
        (status === "occupied" && !activeSessionTableIds.has(table.id));
    })
    .map((table) => table.id);

  const reservationWindows: TablePlanningWindow[] = assignments.map((assignment) => ({
    serviceDate: manilaDateKey(assignment.reservation.date),
    startTime: assignment.reservation.time,
    tableIds: [assignment.table_id]
  }));
  const activeDiningSessions: TablePlanningWindow[] = sessions.map((session) => ({
    serviceDate: manilaDateKey(session.opened_at),
    startTime: session.opened_at.toLocaleTimeString("en-GB", {
      timeZone: RESERVATION_SETTINGS.TIME_ZONE,
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23"
    }),
    tableIds: [
      session.table_id,
      ...(session.table_combination?.members.map((member) => member.table_id) ?? [])
    ]
  }));
  const unavailableForSlot = getTablesUnavailableForSlot(
    dateKey,
    time,
    estimatedDurationMinutes,
    reservationWindows,
    activeDiningSessions
  );
  const result = findBestTableCombination(
    partySize,
    tables.map((table) => ({
      id: table.id,
      table_number: table.table_number,
      capacity: table.capacity,
      is_temporary: table.is_temporary
    })),
    { unavailableTableIds: [...unavailableTableIds, ...unavailableForSlot] }
  );

  if (!result) {
    return null;
  }

  const selectedTableIds = new Set(result.tableIds);
  const selectedTables = tables.filter((table) => selectedTableIds.has(table.id));
  if (selectedTables.length !== result.tableIds.length) {
    throw new InventoryError(
      "Table availability changed while the booking was being confirmed. Please retry.",
      "TABLE_ALLOCATION_CHANGED",
      409
    );
  }
  let remainingSeats = partySize;
  return selectedTables.map((table) => {
    const seatCount = Math.min(table.capacity, remainingSeats);
    remainingSeats -= seatCount;
    return { table_id: table.id, seat_count: seatCount };
  });
}

async function getAvailableCapacity(date: Date, time: string) {
  const dateKey = manilaDateKey(date);
  const summary = await getReservationSlotSummary(prisma, dateKey, time);
  return summary.available_pax;
}

app.post("/api/feedback", async (req, res, next) => {
  try {
    const body = customerFeedbackBodySchema.parse(req.body);
    const feedback_id = await generateFeedbackId();
    const rows = await prisma.$queryRaw<Array<{ feedback_id: string }>>`
      INSERT INTO customer_feedback (
        id,
        feedback_id,
        customer_name,
        customer_email,
        customer_phone,
        visit_type,
        rating,
        message
      )
      VALUES (
        ${createFeedbackRowId()},
        ${feedback_id},
        ${body.customer_name.trim()},
        ${body.customer_email?.trim() || null},
        ${body.customer_phone?.trim() || null},
        ${body.visit_type},
        ${body.rating},
        ${body.message.trim()}
      )
      RETURNING feedback_id
    `;

    return res.status(201).json({
      success: true,
      feedback_id: rows[0]?.feedback_id ?? feedback_id,
      message: "Thank you for sharing your feedback."
    });
  } catch (error) {
    return next(error);
  }
});

app.get("/api/staff/feedback/analysis", async (req, res, next) => {
  try {
    const user = requireRole(req, res, ["admin", "receptionist", "event_coordinator"]);

    if (!user) {
      return;
    }

    const rows = await prisma.$queryRaw<
      Array<{
        id: string;
        feedback_id: string;
        customer_name: string;
        visit_type: string;
        rating: number;
        message: string;
        status: string;
        created_at: Date;
      }>
    >`
      SELECT id, feedback_id, customer_name, visit_type, rating, message, status, created_at
      FROM customer_feedback
      ORDER BY created_at DESC
      LIMIT 25
    `;
    const feedback = rows.map((item) => ({
      ...item,
      analysis: analyzeFeedback(item.message, item.rating)
    }));

    return res.json({ feedback });
  } catch (error) {
    return next(error);
  }
});

app.post("/api/reservations", async (req, res, next) => {
  return res.status(409).json({
    message: "A verified downpayment is required to submit a booking. Please use the dine-in checkout flow."
  });
});

app.get("/api/reservations/rules", (_req, res) => {
  res.setHeader("Cache-Control", "no-store");
  return res.json({
    settings: {
      ...RESERVATION_SETTINGS,
      PAYMENT_GATEWAY: process.env.PAYMENT_GATEWAY ?? "fake"
    },
    server_now: new Date().toISOString()
  });
});

app.get("/api/reservations/table-availability", async (req, res, next) => {
  try {
    const query = z.object({
      date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
      time: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
      party_size: z.coerce.number().int().min(1).max(RESERVATION_SETTINGS.MAX_GUESTS)
    }).parse(req.query);
    const date = manilaDateToUtc(query.date);
    if (manilaDateKey(date) !== query.date) {
      return res.status(400).json({ message: "Choose a valid reservation date." });
    }
    const timeError = reservationTimeError(query.date, query.time);
    if (timeError) {
      return res.status(400).json({ message: timeError });
    }

    const assignments = await allocateReservationTables(
      prisma,
      query.date,
      query.time,
      query.party_size
    );
    return res.json({
      availability: assignments ? "available" : "full",
      checked_at: new Date().toISOString()
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
      total_price: Number(reservation.total_price) > 0 ? reservation.total_price : null,
      payment_plan: reservation.payment_plan,
      downpayment_amount: reservation.downpayment_amount,
      downpayment_status: reservation.downpayment_status,
      full_payment_paid: reservation.full_payment_paid,
      remaining_paid_at_venue: reservation.remaining_paid_at_venue,
      ...paymentSummaryFields(reservation),
      rejected_reason: reservation.rejected_reason,
      alternative_suggestions: reservation.alternative_suggestions,
      special_requests: reservation.special_requests
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

app.get("/api/unlimited/products", async (_req, res, next) => {
  try {
    const included = await prisma.unlimitedIncludedProduct.findMany({
      where: {
        is_included: true,
        selling_product: {
          is_deleted: false,
          is_available: true
        }
      },
      select: { selling_product_id: true }
    });

    return res.json({ productIds: included.map((item) => item.selling_product_id) });
  } catch (error) {
    return next(error);
  }
});

app.get("/api/settings/system", async (_req, res, next) => {
  try {
    const settings = await getSystemSettings();
    return res.json({ settings });
  } catch (error) {
    return next(error);
  }
});

app.put("/api/admin/settings/system", async (req, res, next) => {
  try {
    const user = requireRole(req, res, ["admin", "cashier", "receptionist", "event_coordinator", "inventory_manager", "chef", "staff"]);

    if (!user) {
      return;
    }

    const body = z
      .object({
        restaurant_name: z.string().min(1).max(120),
        timezone: z.string().min(1).max(80),
        currency: z.string().min(1).max(8),
        tax_rate_percent: z.coerce.number().min(0).max(100),
        receipt_paper_size: z.string().min(1).max(20),
        receipt_footer: z.string().min(1).max(240),
        max_party_size: z.coerce.number().int().min(1).max(500),
        reservation_duration_minutes: z.coerce.number().int().min(15).max(480),
        estimated_dining_duration_minutes: z.coerce.number().int().min(15).max(480),
        reservation_grace_period_minutes: z.coerce.number().int().min(0).max(120),
        minimum_catering_pax: z.coerce.number().int().min(1).max(1000),
        default_downpayment_percent: z.coerce.number().min(0).max(100),
        auto_lock_catering_ingredients: z.coerce.boolean(),
        release_catering_locks_on_completion: z.coerce.boolean(),
        default_reorder_level: z.coerce.number().int().nonnegative(),
        low_stock_threshold_percent: z.coerce.number().min(0).max(500),
        auto_reorder_enabled: z.coerce.boolean(),
        email_notifications_enabled: z.coerce.boolean(),
        sms_notifications_enabled: z.coerce.boolean(),
        low_stock_alerts_enabled: z.coerce.boolean()
      })
      .parse(req.body);
    const settings = await updateSystemSettings(body);

    return res.json({ settings });
  } catch (error) {
    return next(error);
  }
});

app.get("/api/catering/packages", async (_req, res, next) => {
  try {
    const packages = await prisma.cateringPackage.findMany({
      where: { isActive: true, stationType: { not: null } }
    });
    packages.sort((first, second) => {
      const firstItems = getCateringPackageItems(first.items);
      const secondItems = getCateringPackageItems(second.items);
      const firstStationOrder = typeof firstItems.stationOrder === "number" ? firstItems.stationOrder : Number.MAX_SAFE_INTEGER;
      const secondStationOrder = typeof secondItems.stationOrder === "number" ? secondItems.stationOrder : Number.MAX_SAFE_INTEGER;
      const firstOptionOrder = typeof firstItems.optionOrder === "number" ? firstItems.optionOrder : first.minPax;
      const secondOptionOrder = typeof secondItems.optionOrder === "number" ? secondItems.optionOrder : second.minPax;

      return firstStationOrder - secondStationOrder || firstOptionOrder - secondOptionOrder || first.name.localeCompare(second.name);
    });
    return res.json({ packages });
  } catch (error) {
    return next(error);
  }
});

app.put("/api/admin/catering/packages/:id/photo", upload.single("imageFile"), async (req, res, next) => {
  try {
    const user = requireRole(req, res, ["admin"]);

    if (!user) {
      return;
    }

    const stationPackage = await findCateringStationPackage(req.params.id);

    if (!stationPackage) {
      return res.status(404).json({ message: "Catering option not found." });
    }

    const body = z
      .object({
        image_url: z.string().optional().nullable()
      })
      .parse(req.body);

    let imageUrl: string | null | undefined;

    if (req.file) {
      const localUploadPath = path.join(uploadDir, req.file.filename);
      if (useSupabaseStorage && supabase && supabaseStorageBucket) {
        const supabasePath = `catering-packages/${req.file.filename}`;
        imageUrl = await uploadFileToSupabase(localUploadPath, supabasePath);
      } else {
        imageUrl = `/uploads/products/${req.file.filename}`;
      }
    } else if (body.image_url !== undefined) {
      imageUrl = body.image_url;
    }

    if (imageUrl === undefined) {
      return res.status(400).json({ message: "Add an image file or image URL." });
    }

    const cateringPackage = await prisma.cateringPackage.update({
      where: { id: req.params.id },
      data: { imageUrl: getPersistableImageValue(imageUrl) }
    });

    return res.json({ package: cateringPackage });
  } catch (error) {
    return next(error);
  }
});

app.put(
  "/api/admin/catering/packages/:id/photos",
  (req, res, next) => {
    if (!requireRole(req, res, ["admin"])) {
      return;
    }
    next();
  },
  upload.fields([
    { name: "imageFile_0", maxCount: 1 },
    { name: "imageFile_1", maxCount: 1 },
    { name: "imageFile_2", maxCount: 1 }
  ]),
  async (req, res, next) => {
    try {
      const stationPackage = await findCateringStationPackage(req.params.id);
      if (!stationPackage) {
        return res.status(404).json({ message: "Catering option not found." });
      }

      let parsedImageUrls: unknown;
      try {
        parsedImageUrls = JSON.parse(req.body.image_urls);
      } catch {
        return res.status(400).json({ message: "Provide exactly three photo URLs." });
      }

      const parsedBody = z.object({
        image_urls: z.array(z.string().max(2048)).length(3)
      }).safeParse({ image_urls: parsedImageUrls });
      if (!parsedBody.success) {
        return res.status(400).json({ message: "Provide exactly three photo URLs." });
      }

      const uploadedFiles = Array.isArray(req.files) ? {} : req.files ?? {};
      const galleryImages: string[] = [];

      for (const index of [0, 1, 2]) {
        const imageFile = uploadedFiles[`imageFile_${index}`]?.[0];
        if (!imageFile) {
          galleryImages.push(parsedBody.data.image_urls[index].trim());
          continue;
        }

        const localUploadPath = path.join(uploadDir, imageFile.filename);
        if (useSupabaseStorage && supabase && supabaseStorageBucket) {
          const imageUrl = await uploadFileToSupabase(localUploadPath, `catering-packages/${imageFile.filename}`);
          if (!imageUrl) {
            throw new Error("The uploaded catering photo could not be stored.");
          }
          galleryImages.push(imageUrl);
        } else {
          galleryImages.push(`/uploads/products/${imageFile.filename}`);
        }
      }

      const existingItems = stationPackage.items;
      const packageItems = existingItems && typeof existingItems === "object" && !Array.isArray(existingItems)
        ? existingItems
        : {};
      const cateringPackage = await prisma.cateringPackage.update({
        where: { id: stationPackage.id },
        data: {
          imageUrl: getPersistableImageValue(galleryImages[0] || null),
          items: {
            ...packageItems,
            galleryImages
          } as Prisma.InputJsonValue
        }
      });

      return res.json({ package: cateringPackage });
    } catch (error) {
      return next(error);
    }
  }
);

app.post("/api/catering/reservations", async (req, res, next) => {
  try {
    const rawBody = cateringReservationBodySchema.parse(req.body);
    const event_date = manilaDateToUtc(rawBody.event_date);
    const body = { ...rawBody, event_date };

    if (!isAtLeastOneManilaDayAhead(rawBody.event_date)) {
      return res.status(400).json({ message: "Catering events must be booked at least one day in advance." });
    }
    if (!isFutureManilaDateTime(rawBody.event_date, rawBody.event_time)) {
      return res.status(400).json({ message: "Event date and time must be in the future." });
    }

    const selectedPackageIds = [...new Set(body.package_ids ?? [body.package_id])];
    if (!selectedPackageIds.includes(body.package_id)) {
      return res.status(400).json({ message: "The primary package must be included in the selected packages." });
    }
    const [selectedPackages, systemSettings] = await Promise.all([
      prisma.cateringPackage.findMany({
        where: { id: { in: selectedPackageIds }, isActive: true, stationType: { not: null } }
      }),
      getSystemSettings()
    ]);
    if (selectedPackages.length !== selectedPackageIds.length) {
      return res.status(400).json({ message: "One or more selected catering packages are unavailable." });
    }
    const packagesById = new Map(selectedPackages.map((item) => [item.id, item]));
    const selectedPackagesInOrder = selectedPackageIds
      .map((id) => packagesById.get(id))
      .filter((item): item is NonNullable<typeof item> => item !== undefined);
    const selectedPackage = packagesById.get(body.package_id);
    if (!selectedPackage) {
      return res.status(404).json({ message: "Selected catering package not found" });
    }
    const selectedStationTypes = selectedPackagesInOrder.map((item) => item.stationType);
    if (new Set(selectedStationTypes).size !== selectedStationTypes.length) {
      return res.status(400).json({ message: "Select only one option for each catering station." });
    }
    const selectedSashimiPackage = selectedPackagesInOrder.find((item) => item.stationType === "sashimi_bar");
    if (selectedSashimiPackage) {
      const items = getCateringPackageItems(selectedSashimiPackage.items);
      const minimumKg = typeof items.minimum === "number"
        ? items.minimum
        : typeof items.minKg === "number" ? items.minKg : undefined;
      const maximumKg = typeof items.maximum === "number"
        ? items.maximum
        : typeof items.maxKg === "number" ? items.maxKg : undefined;
      const stepKg = typeof items.step === "number"
        ? items.step
        : typeof items.stepKg === "number" ? items.stepKg : 1;
      const quantityKg = body.sashimi_quantity_kg;

      if (
        typeof minimumKg !== "number" ||
        typeof quantityKg !== "number" ||
        !Number.isFinite(stepKg) ||
        stepKg <= 0 ||
        quantityKg < minimumKg ||
        (maximumKg !== undefined && quantityKg > maximumKg) ||
        Math.abs((quantityKg - minimumKg) / stepKg - Math.round((quantityKg - minimumKg) / stepKg)) > 1e-9
      ) {
        return res.status(400).json({ message: "Select a sashimi quantity that meets the selected option's minimum, step, and maximum." });
      }
    } else if (body.sashimi_quantity_kg !== undefined) {
      return res.status(400).json({ message: "A sashimi quantity is only valid when the Sashimi Bar is selected." });
    }
    const selectedSushiPackage = selectedPackagesInOrder.find((item) => item.stationType === "sushi_station");
    const selectedTempuraPackage = selectedPackagesInOrder.find((item) => item.stationType === "tempura_live");
    const tempuraItems = selectedTempuraPackage ? getCateringPackageItems(selectedTempuraPackage.items) : null;
    const headcount = selectedSushiPackage
      ? selectedSushiPackage.minPax
      : selectedTempuraPackage
        ? typeof tempuraItems?.fixedPax === "number" ? tempuraItems.fixedPax : selectedTempuraPackage.minPax
        : null;
    if (headcount !== null && headcount < systemSettings.minimum_catering_pax) {
      return res.status(400).json({ message: `Catering requires at least ${systemSettings.minimum_catering_pax} pax.` });
    }
    const subtotal = selectedPackagesInOrder.reduce(
      (total, item) => total + getCateringPackagePrice(
        item,
        item.id === selectedSashimiPackage?.id ? body.sashimi_quantity_kg : undefined
      ),
      0
    );
    const packageSnapshots = selectedPackagesInOrder.map((item) => {
      const packageItems = getCateringPackageItems(item.items);
      const isSashimi = item.id === selectedSashimiPackage?.id;
      const isSushi = item.stationType === "sushi_station";
      const isTempura = item.stationType === "tempura_live";
      const quantity = isSashimi
        ? body.sashimi_quantity_kg!
        : isSushi
          ? item.minPax
          : isTempura && typeof packageItems.fixedPax === "number"
            ? packageItems.fixedPax
            : null;
      const pricePerUnit = typeof packageItems.pricePerUnit === "number"
        ? packageItems.pricePerUnit
        : typeof packageItems.pricePerKg === "number"
          ? packageItems.pricePerKg
          : null;
      const linePrice = getCateringPackagePrice(item, isSashimi ? body.sashimi_quantity_kg : undefined);

      return {
        packageId: item.id,
        stationType: item.stationType,
        packageName: item.name,
        description: item.description,
        pricingModel: typeof packageItems.pricingModel === "string" ? packageItems.pricingModel : null,
        unit: typeof packageItems.unit === "string" ? packageItems.unit : null,
        quantity,
        rate: pricePerUnit,
        fixedPrice: typeof packageItems.fixedPrice === "number"
          ? packageItems.fixedPrice
          : typeof packageItems.flatPrice === "number" ? packageItems.flatPrice : null,
        fixedPax: typeof packageItems.fixedPax === "number" ? packageItems.fixedPax : null,
        minPax: item.minPax,
        maxPax: item.maxPax,
        price: linePrice
      };
    });
    const tax = 0;
    const total_price = Number(subtotal.toFixed(2));
    const isFullPayment = body.payment_plan === "full_payment";
    const expectedInitialPayment = isFullPayment
      ? total_price
      : Number((total_price * 0.5).toFixed(2));

    const reservation_id = body.reservation_id ?? (await generateReadableId("CAT", body.event_date, "reservation_id"));
    const verifiedPayment = body.payment_transaction_id
      ? await getVerifiedDownpayment(
          body.payment_transaction_id,
          reservation_id,
          "catering",
          body.payment_method,
          expectedInitialPayment,
          isFullPayment ? "full_payment" : "downpayment"
        )
      : null;
    const paidAmount = verifiedPayment ? expectedInitialPayment : 0;
    const remaining_balance = Number((total_price - paidAmount).toFixed(2));
    if (body.reservation_id) {
      const existing = await prisma.cateringReservation.findUnique({
        where: { reservation_id: reservation_id }
      });
      if (existing) {
        const existingPackageIds = Array.isArray(existing.package_ids)
          ? existing.package_ids.filter((value): value is string => typeof value === "string")
          : [];
        const sameRequest =
          existing.customer_name === body.customer_name &&
          existing.customer_phone === body.customer_phone &&
          existing.customer_email?.toLowerCase() === body.customer_email.toLowerCase() &&
          existing.event_date?.getTime() === body.event_date.getTime() &&
          existing.event_time === body.event_time &&
          existing.payment_plan === body.payment_plan &&
          JSON.stringify(existingPackageIds) === JSON.stringify(selectedPackageIds) &&
          Math.abs(Number(existing.package_total || existing.total_price) - total_price) < 0.01;
        if (!sameRequest) {
          return res.status(409).json({ message: "This reservation reference is already associated with a different request." });
        }
        return res.status(200).json({
          success: true,
          reservation_id: existing.reservation_id,
          paid_amount: Number(existing.downpayment_amount),
          remaining_balance: Number(existing.remaining_balance),
          package_total: Number(existing.package_total || existing.total_price),
          initial_payment_due: existing.downpayment_status === "paid"
            ? 0
            : existing.payment_plan === "full_payment"
              ? Number(existing.package_total || existing.total_price)
              : roundMoney(Number(existing.package_total || existing.total_price) * 0.5),
          payment_plan: existing.payment_plan,
          message: "Catering request already received."
        });
      }
    }
    const inquiry_id = await generateReadableId("CAT", body.event_date, "inquiry_id");

    const reservation = await prisma.$transaction(async (tx) => {
      const duplicate = await tx.cateringReservation.findFirst({
        where: {
          event_date: body.event_date,
          headcount,
          status: { notIn: ["cancelled", "canceled", "rejected", "declined", "expired", "no-show", "no_show"] },
          OR: [
            { customer_email: { equals: body.customer_email, mode: "insensitive" } },
            { customer_phone: body.customer_phone }
          ]
        },
        select: { reservation_id: true }
      });
      if (duplicate) {
        throw new InventoryError(
          `A catering booking with the same customer, date, and guest count already exists (${duplicate.reservation_id}).`,
          "DUPLICATE_BOOKING",
          409
        );
      }
      const inquiry = await tx.cateringInquiry.create({
        data: {
          inquiry_id,
          customer_name: body.customer_name,
          customer_phone: body.customer_phone,
          customer_email: body.customer_email,
          event_date: body.event_date,
          headcount: body.headcount,
          venue_type: body.venue_address,
          event_type: body.event_type,
          event_type_other: body.event_type_other || null,
          package_type: selectedPackage.stationType,
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
          event_time: body.event_time,
          sashimi_quantity_kg: body.sashimi_quantity_kg ?? null,
          headcount,
          package_id: body.package_id,
          package_ids: selectedPackageIds,
          package_snapshot: packageSnapshots,
          package_total: total_price,
          mobilization_fee: 0,
          total_price,
          payment_plan: body.payment_plan,
          downpayment_amount: paidAmount,
          remaining_balance,
          downpayment_percent: isFullPayment ? 100 : 50,
          downpayment_status: verifiedPayment ? "paid" : "pending",
          downpayment_method: verifiedPayment ? body.payment_method : null,
          downpayment_date: verifiedPayment?.paidAt ?? null,
          downpayment_transaction_id: verifiedPayment?.transactionId ?? null,
          full_payment_paid: isFullPayment && verifiedPayment !== null,
          full_payment_date: isFullPayment ? verifiedPayment?.paidAt ?? null : null,
          final_payment_status: verifiedPayment && isFullPayment ? "paid" : "pending",
          final_payment_method: verifiedPayment && isFullPayment ? body.payment_method ?? null : null,
          status: "pending_approval",
          confirmed_date: body.event_date,
          deposit_paid: paidAmount,
          deposit_due_date: null,
          created_by: body.customer_name
        }
      });

      if (verifiedPayment) {
        await recordVerifiedDownpayment(tx, {
          transactionId: verifiedPayment.transactionId,
          cateringReservationId: created.id,
          amount: paidAmount,
          method: body.payment_method!,
          paidAt: verifiedPayment.paidAt ?? new Date(),
          paymentStage: isFullPayment ? "full_payment" : "downpayment"
        });
      }
      await addReservationActivity(tx, {
        cateringReservationId: created.id,
        eventType: "booking_created",
        toStatus: created.status,
        actorType: "customer",
        actorName: body.customer_name,
        details: {
          payment_stage: verifiedPayment
            ? isFullPayment ? "full_payment" : "downpayment"
            : "awaiting_initial_payment",
          amount: paidAmount,
          transaction_id: verifiedPayment?.transactionId ?? null
        }
      });

      return created;
    });

    void emailService.sendCateringConfirmation({
      bookingId: reservation.reservation_id ?? inquiry_id,
      email: reservation.customer_email ?? body.customer_email,
      name: reservation.customer_name ?? body.customer_name,
      date: reservation.event_date ?? body.event_date,
      partySize: reservation.headcount ?? undefined,
      packageName: selectedPackage.name,
      venueAddress: body.venue_address,
      total: reservation.total_price,
      downpayment: paidAmount,
      remaining: remaining_balance,
      status: reservation.status
    }).catch((error) => console.error("Failed to send catering confirmation email:", error));

    return res.status(201).json({
      success: true,
      reservation_id: reservation.reservation_id,
      paid_amount: paidAmount,
      remaining_balance: reservation.remaining_balance,
      package_total: total_price,
      initial_payment_due: verifiedPayment ? 0 : expectedInitialPayment,
      payment_plan: reservation.payment_plan,
      message: "Catering request received. Complete the selected package payment before staff approval."
    });
  } catch (error) {
    return next(error);
  }
});

app.post("/api/catering/reservations/:reservationId/record-initial-payment", async (req, res, next) => {
  try {
    const body = z.object({
      payment_transaction_id: z.string().min(1),
      payment_method: z.enum(["cash", "gcash", "bank_transfer"])
    }).parse(req.body);
    const existingReservation = await prisma.cateringReservation.findUnique({
      where: { reservation_id: req.params.reservationId }
    });
    if (!existingReservation) {
      return res.status(404).json({ message: "Reservation not found." });
    }

    const isFullPayment = existingReservation.payment_plan === "full_payment";
    const packageTotal = Number(existingReservation.package_total || existingReservation.total_price);
    const expectedAmount = isFullPayment ? packageTotal : roundMoney(packageTotal * 0.5);
    const verifiedPayment = await getVerifiedDownpayment(
      body.payment_transaction_id,
      req.params.reservationId,
      "catering",
      body.payment_method,
      expectedAmount,
      isFullPayment ? "full_payment" : "downpayment"
    );

    const reservation = await prisma.$transaction(async (tx) => {
      await lockCateringReservationForUpdate(tx, existingReservation.id);
      const current = await tx.cateringReservation.findUnique({ where: { id: existingReservation.id } });
      if (!current) {
        throw new InventoryError("Catering booking not found.", "BOOKING_NOT_FOUND", 404);
      }
      const claim = await tx.paymentTransactionClaim.findUnique({
        where: { transaction_id: verifiedPayment.transactionId }
      });
      if (claim) {
        const claimedPayment = await tx.reservationPayment.findFirst({
          where: {
            catering_reservation_id: current.id,
            reference_number: verifiedPayment.transactionId
          },
          select: { payment_stage: true }
        });
        if (
          claim.catering_reservation_id !== current.id ||
          claimedPayment?.payment_stage !== (isFullPayment ? "full_payment" : "downpayment")
        ) {
          throw new InventoryError("This payment was already used for another booking.", "PAYMENT_ALREADY_CLAIMED", 409);
        }
        return tx.cateringReservation.findUnique({
          where: { id: current.id },
          include: { payments: { orderBy: { received_at: "asc" } } }
        });
      }
      if (current.status !== "pending_approval") {
        throw new InventoryError("Initial package payment is available only for a pending catering request.", "BOOKING_NOT_PENDING", 409);
      }
      if (current.downpayment_status === "paid") {
        throw new InventoryError("The initial package payment has already been recorded.", "PAYMENT_ALREADY_RECORDED", 409);
      }

      const remaining = roundMoney(Math.max(Number(current.total_price) - expectedAmount, 0));
      const paidAt = verifiedPayment.paidAt ?? new Date();
      await recordVerifiedDownpayment(tx, {
        transactionId: verifiedPayment.transactionId,
        cateringReservationId: current.id,
        amount: expectedAmount,
        method: body.payment_method,
        paidAt,
        paymentStage: isFullPayment ? "full_payment" : "downpayment"
      });
      const updated = await tx.cateringReservation.update({
        where: { id: current.id },
        data: {
          downpayment_amount: expectedAmount,
          downpayment_status: "paid",
          downpayment_method: body.payment_method,
          downpayment_date: paidAt,
          downpayment_transaction_id: verifiedPayment.transactionId,
          deposit_paid: expectedAmount,
          remaining_balance: remaining,
          full_payment_paid: isFullPayment && remaining === 0,
          full_payment_date: isFullPayment && remaining === 0 ? paidAt : null,
          final_payment_status: remaining === 0 ? "paid" : "pending",
          final_payment_method: remaining === 0 ? body.payment_method : null,
          final_payment_date: remaining === 0 ? paidAt : null
        },
        include: { payments: { orderBy: { received_at: "asc" } } }
      });
      await addReservationActivity(tx, {
        cateringReservationId: current.id,
        eventType: "initial_package_payment_recorded",
        fromStatus: current.status,
        toStatus: updated.status,
        actorType: "customer",
        actorName: current.customer_name,
        details: { amount: expectedAmount, payment_method: body.payment_method }
      });
      return updated;
    });

    return res.json({
      success: true,
      reservation: reservation ? { ...reservation, ...paymentSummaryFields(reservation) } : null
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
      time: reservation.event_time ?? "",
      event_type: reservation.inquiry?.event_type ?? null,
      event_type_other: reservation.inquiry?.event_type_other ?? null,
      party_size: reservation.headcount,
      package_total: Number(reservation.package_total || reservation.total_price),
      mobilization_fee: Number(reservation.mobilization_fee),
      total_price: reservation.total_price,
      payment_plan: reservation.payment_plan,
      downpayment_status: reservation.downpayment_status,
      initial_payment_due: reservation.downpayment_status === "paid"
        ? 0
        : reservation.payment_plan === "full_payment"
          ? Number(reservation.package_total || reservation.total_price)
          : roundMoney(Number(reservation.package_total || reservation.total_price) * 0.5),
      downpayment_amount: reservation.downpayment_amount,
      full_payment_paid: reservation.full_payment_paid,
      remaining_paid_at_venue: reservation.remaining_paid_at_venue,
      final_payment_status: reservation.final_payment_status,
      ...paymentSummaryFields(reservation),
      package_name: reservation.package?.name ?? null,
      package_snapshot: reservation.package_snapshot,
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
      payment_transaction_id: z.string().min(1)
    }).parse(req.body);
    const updated = await recordVerifiedCateringBalancePayment(
      req.params.reservationId,
      body.payment_transaction_id,
      body.payment_method
    );
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
        created_at: reservation.created_at,
        created_by: reservation.created_by,
        date: reservation.date,
        time: reservation.time,
        guests: reservation.party_size,
        total_price: reservation.total_price,
        payment_plan: reservation.payment_plan,
        downpayment_amount: reservation.downpayment_amount,
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
        created_at: reservation.created_at,
        created_by: reservation.created_by,
        date: reservation.event_date,
        time: reservation.event_time ?? "",
        guests: reservation.headcount,
        package_total: Number(reservation.package_total || reservation.total_price),
        mobilization_fee: Number(reservation.mobilization_fee),
        total_price: reservation.total_price,
        package_name: reservation.package?.name ?? reservation.inquiry?.package_type ?? null,
        payment_plan: reservation.payment_plan,
        downpayment_amount: reservation.downpayment_amount,
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
        time: reservation.event_time ?? "",
        guests: reservation.headcount,
        package_total: Number(reservation.package_total || reservation.total_price),
        mobilization_fee: Number(reservation.mobilization_fee),
        total_price: reservation.total_price,
        payment_plan: reservation.payment_plan,
        downpayment_amount: reservation.downpayment_amount,
        ...paymentSummaryFields(reservation),
        reservation_status: reservation.status,
        package_name: reservation.package?.name ?? reservation.inquiry?.package_type ?? null,
        package_snapshot: reservation.package_snapshot,
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
      created_at: reservation.created_at,
      created_by: reservation.created_by,
      date: reservation.date,
      time: reservation.time,
      guests: reservation.party_size,
      total_price: reservation.total_price,
      payment_plan: reservation.payment_plan,
      downpayment_amount: reservation.downpayment_amount,
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
    const body = z.object({
      mobilization_fee: z.coerce.number().finite().min(0).max(1_000_000).default(0)
    }).parse(req.body ?? {});

    const reservation = await prisma.$transaction(async (tx) => {
      await lockCateringReservationForUpdate(tx, req.params.id);
      const current = await tx.cateringReservation.findUnique({
        where: { id: req.params.id },
        include: { payments: true }
      });
      if (!current) {
        throw new InventoryError("Catering booking not found.", "BOOKING_NOT_FOUND", 404);
      }
      if (current.status !== "pending_approval") {
        throw new InventoryError("Only a pending catering booking can be approved.", "BOOKING_NOT_PENDING", 409);
      }
      if (current.payment_plan !== "pay_at_venue" &&
          (current.downpayment_status !== "paid" || Number(current.downpayment_amount) <= 0)) {
        throw new InventoryError("A recorded downpayment is required before approval.", "DOWNPAYMENT_REQUIRED", 409);
      }

      const packageTotal = Number(current.package_total || current.total_price);
      const totalPrice = roundMoney(packageTotal + body.mobilization_fee);
      const remainingBalance = roundMoney(Math.max(totalPrice - Number(current.downpayment_amount), 0));
      const isFullyPaid = remainingBalance === 0;
      const updated = await tx.cateringReservation.update({
        where: { id: req.params.id },
        data: {
          package_total: packageTotal,
          mobilization_fee: body.mobilization_fee,
          total_price: totalPrice,
          remaining_balance: remainingBalance,
          full_payment_paid: isFullyPaid,
          full_payment_date: isFullyPaid ? current.full_payment_date ?? new Date() : null,
          final_payment_status: isFullyPaid ? "paid" : "pending",
          final_payment_method: isFullyPaid ? current.final_payment_method ?? current.downpayment_method : null,
          final_payment_date: isFullyPaid ? current.final_payment_date ?? current.downpayment_date : null,
          status: "confirmed"
        }
      });
      await addReservationActivity(tx, {
        cateringReservationId: updated.id,
        eventType: "status_changed",
        fromStatus: current.status,
        toStatus: updated.status,
        actorType: "staff",
        actorId: user.sub,
        reason: "Booking approved",
        details: {
          package_total: packageTotal,
          mobilization_fee: body.mobilization_fee,
          total_price: totalPrice,
          remaining_balance: remainingBalance
        }
      });

      if (updated.inquiry_id) {
        await tx.cateringInquiry.update({ where: { id: updated.inquiry_id }, data: { status: "confirmed" } });
      }

      return tx.cateringReservation.findUnique({
        where: { id: updated.id },
        include: { inquiry: true, package: true, ingredient_locks: { include: { raw_material: true } }, payments: true }
      });
    });

    if (reservation) {
      void emailService.sendCateringApproval({
        bookingId: reservation.reservation_id ?? reservation.id,
        email: reservation.customer_email ?? reservation.inquiry?.customer_email ?? "",
        name: reservation.customer_name ?? reservation.inquiry?.customer_name ?? "Customer",
        date: reservation.event_date ?? reservation.inquiry?.event_date ?? new Date(),
        partySize: reservation.headcount ?? reservation.inquiry?.headcount,
        packageName: reservation.package?.name,
        venueAddress: reservation.inquiry?.venue_type,
        total: reservation.total_price,
        downpayment: reservation.downpayment_amount,
        remaining: reservation.remaining_balance,
        status: reservation.status
      }).catch((error) => console.error("Failed to send catering approval email:", error));
    }

    return res.json({ reservation });
  } catch (error) {
    return next(error);
  }
});

app.put("/api/staff/catering/reservations/:id/decline", async (req, res, next) => {
  try {
    const user = requireRole(req, res, ["admin", "event_coordinator"]);
    if (!user) return;
    const body = z.object({ reason: z.string().min(1) }).parse(req.body);
    const reservation = await prisma.$transaction(async (tx) => {
      await lockCateringReservationForUpdate(tx, req.params.id);
      const current = await tx.cateringReservation.findUnique({
        where: { id: req.params.id },
        include: { payments: true }
      });
      if (!current) throw new InventoryError("Catering booking not found.", "BOOKING_NOT_FOUND", 404);
      if (!["pending", "pending_approval"].includes(current.status ?? "")) {
        throw new InventoryError("Only a pending catering booking can be declined.", "BOOKING_NOT_PENDING", 409);
      }
      if (current.payments.some((payment) => payment.payment_stage === "refund")) {
        throw new InventoryError("The downpayment has already been refunded.", "REFUND_ALREADY_RECORDED", 409);
      }

      const refundAmount = Number(current.downpayment_amount);
      if (refundAmount > 0) {
        await tx.reservationPayment.create({
          data: {
            catering_reservation_id: current.id,
            payment_stage: "refund",
            method: current.downpayment_method ?? "cash",
            amount: refundAmount,
            reference_number: current.downpayment_transaction_id,
            source: "staff",
            recorded_by_id: user.sub
          }
        });
      }
      if (current.inquiry_id) {
        await tx.cateringInquiry.update({
          where: { id: current.inquiry_id },
          data: { status: "declined", admin_notes: body.reason }
        });
      }
      const updated = await tx.cateringReservation.update({
        where: { id: current.id },
        data: {
          status: "declined",
          remaining_balance: Number(current.total_price),
          final_payment_status: "refunded",
          full_payment_paid: false,
          full_payment_date: null
        },
        include: { payments: true }
      });
      await addReservationActivity(tx, {
        cateringReservationId: current.id,
        eventType: "booking_declined",
        fromStatus: current.status,
        toStatus: updated.status,
        actorType: "staff",
        actorId: user.sub,
        reason: body.reason,
        details: { refund_amount: refundAmount }
      });
      return updated;
    });
    return res.json({ reservation });
  } catch (error) {
    return next(error);
  }
});

app.put("/api/staff/catering/reservations/:id/cancel", async (req, res, next) => {
  try {
    const user = requireRole(req, res, ["admin", "event_coordinator"]);

    if (!user) {
      return;
    }

    const body = z.object({
      reason: z.string().min(1),
      amount: z.coerce.number().min(0).optional(),
      payment_method: z.enum(["cash", "gcash", "bank_transfer"]).optional(),
      reference_number: z.string().optional().nullable(),
      cash_received: z.coerce.number().min(0).optional().nullable(),
      prepared_ingredients: z.array(z.object({
        raw_material_id: z.string().min(1),
        quantity: z.coerce.number().int().positive()
      })).optional()
    }).parse(req.body);

    const reservation = await prisma.$transaction(async (tx) => {
      await lockCateringReservationForUpdate(tx, req.params.id);
      const current = await tx.cateringReservation.findUnique({
        where: { id: req.params.id },
        include: { payments: { orderBy: { received_at: "asc" } } }
      });

      if (!current) {
        throw Object.assign(new Error("Reservation not found"), { statusCode: 404 });
      }

      if (isTerminalReservationStatus(current.status)) {
        throw new InventoryError("This catering booking is already closed.", "BOOKING_ALREADY_CLOSED", 409);
      }

      if (body.prepared_ingredients?.length) {
        throw new InventoryError(
          "Prepared ingredient quantities are no longer recorded during catering cancellation. Refresh the staff page and cancel again.",
          "CATERING_INVENTORY_DISABLED",
          409
        );
      }

      if (current.payments.some((payment) => payment.payment_stage === "forfeited_fee")) {
        throw new InventoryError("This catering booking was already cancelled and cannot be cancelled again.", "BOOKING_ALREADY_CANCELLED", 409);
      }

      const forfeitureAmount = Number(current.downpayment_amount);
      if (forfeitureAmount > 0) {
        await tx.reservationPayment.create({
          data: {
            catering_reservation_id: current.id,
            payment_stage: "forfeited_fee",
            method: current.downpayment_method ?? "cash",
            amount: forfeitureAmount,
            reference_number: current.downpayment_transaction_id,
            source: "staff",
            recorded_by_id: user.sub
          }
        });
      }

      if (current.inquiry_id) {
        await tx.cateringInquiry.update({
          where: { id: current.inquiry_id },
          data: {
            status: "cancelled",
            admin_notes: body.reason
          }
        });
      }

      const updated = await tx.cateringReservation.update({
        where: { id: current.id },
        data: {
          status: "cancelled",
          remaining_balance: 0,
          final_payment_status: "cancelled",
          full_payment_paid: false,
          full_payment_date: null,
          remaining_paid_at_venue: false,
          remaining_paid_date: null
        },
        include: { payments: { orderBy: { received_at: "asc" } } }
      });
      await addReservationActivity(tx, {
        cateringReservationId: current.id,
        eventType: "booking_cancelled",
        fromStatus: current.status,
        toStatus: updated.status,
        actorType: "staff",
        actorId: user.sub,
        reason: body.reason,
        details: { forfeited_amount: forfeitureAmount }
      });
      return updated;
    });

    return res.json({ reservation });
  } catch (error) {
    return next(error);
  }
});

app.put("/api/staff/catering/reservations/:id/no-show", async (req, res, next) => {
  try {
    const user = requireRole(req, res, ["admin", "event_coordinator"]);
    if (!user) return;
    const body = z.object({ reason: z.string().min(1) }).parse(req.body);
    const reservation = await prisma.$transaction(async (tx) => {
      await lockCateringReservationForUpdate(tx, req.params.id);
      const current = await tx.cateringReservation.findUnique({
        where: { id: req.params.id },
        include: { payments: true }
      });
      if (!current) throw new InventoryError("Catering booking not found.", "BOOKING_NOT_FOUND", 404);
      if (isTerminalReservationStatus(current.status)) {
        throw new InventoryError("This booking is already closed.", "BOOKING_ALREADY_CLOSED", 409);
      }
      if (current.status !== "confirmed") {
        throw new InventoryError("Only a confirmed catering booking that has not started can be marked no-show.", "BOOKING_NOT_READY_FOR_NO_SHOW", 409);
      }
      if (current.payments.some((payment) => payment.payment_stage === "forfeited_fee")) {
        throw new InventoryError("The downpayment has already been forfeited.", "FORFEITURE_ALREADY_RECORDED", 409);
      }
      const forfeitureAmount = Number(current.downpayment_amount);
      if (forfeitureAmount > 0) {
        await tx.reservationPayment.create({
          data: {
            catering_reservation_id: current.id,
            payment_stage: "forfeited_fee",
            method: current.downpayment_method ?? "cash",
            amount: forfeitureAmount,
            reference_number: current.downpayment_transaction_id,
            source: "staff",
            recorded_by_id: user.sub
          }
        });
      }
      const updated = await tx.cateringReservation.update({
        where: { id: current.id },
        data: { status: "no_show", remaining_balance: 0, final_payment_status: "forfeited" },
        include: { payments: true }
      });
      await addReservationActivity(tx, {
        cateringReservationId: current.id,
        eventType: "booking_no_show",
        fromStatus: current.status,
        toStatus: updated.status,
        actorType: "staff",
        actorId: user.sub,
        reason: body.reason,
        details: { forfeited_amount: forfeitureAmount }
      });
      return updated;
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

    const reservation = await prisma.$transaction(async (tx) => {
      await lockCateringReservationForUpdate(tx, req.params.id);
      const current = await tx.cateringReservation.findUnique({
        where: { id: req.params.id },
        include: { inquiry: true }
      });

      if (!current) {
        throw Object.assign(new Error("Reservation not found"), { statusCode: 404 });
      }

      if (current.status !== "confirmed") {
        throw new InventoryError("Only a confirmed catering booking can be started.", "BOOKING_NOT_CONFIRMED", 409);
      }

      const started = await tx.cateringReservation.update({
        where: { id: current.id },
        data: { status: "in_progress" }
      });
      await addReservationActivity(tx, {
        cateringReservationId: current.id,
        eventType: "status_changed",
        fromStatus: current.status,
        toStatus: started.status,
        actorType: "staff",
        actorId: user.sub,
        reason: "Catering preparation started"
      });
      return started;
    });
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
    const updated = await recordDineInReservationPayment(req.params.id, body, user.sub, user.role);

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
    const updated = await recordDineInReservationPayment(req.params.id, body, user.sub, user.role);

    return res.json({ reservation: { ...updated, ...paymentSummaryFields(updated) } });
  } catch (error) {
    return next(error);
  }
});

app.put("/api/staff/catering/reservations/:id/complete", async (req, res, next) => {
  return completeCateringReservation(req, res, next);
});

app.post("/api/reservations/table", async (req, res, next) => {
  try {
    const body = tableReservationBodySchema.parse(req.body);
    const date = manilaDateToUtc(body.date);

    const timeError = reservationTimeError(body.date, body.time);
    if (timeError) {
      return res.status(400).json({ message: timeError });
    }

    if (manilaDateKey(date) !== body.date) {
      return res.status(400).json({ message: "Choose a valid reservation date." });
    }

    const unlimitedSettings = body.reservation_type === "unlimited"
      ? await getUnlimitedSettings()
      : null;
    const totalPrice = body.reservation_type === "unlimited"
      ? Number(unlimitedSettings?.price_per_person ?? 0) * body.party_size
      : 0;
    const reservation = await prisma.$transaction(async (tx) => {
      const duplicate = await tx.reservation.findFirst({
        where: {
          date: { gte: startOfDay(date), lte: endOfDay(date) },
          time: body.time,
          status: { notIn: ["cancelled", "canceled", "rejected", "declined", "expired", "no-show", "no_show", "completed"] },
          OR: [
            { customer_email: { equals: body.customer_email, mode: "insensitive" } },
            { customer_phone: body.customer_phone }
          ]
        },
        select: { booking_id: true }
      });
      if (duplicate) {
        throw new InventoryError(
          `A booking for this customer at the selected date and time already exists (${duplicate.booking_id}).`,
          "DUPLICATE_BOOKING",
          409
        );
      }

      await tx.$queryRaw<Array<{ id: string }>>`
        SELECT id FROM tables ORDER BY id FOR UPDATE
      `;

      const tableAssignments = await allocateReservationTables(
        tx,
        body.date,
        body.time,
        body.party_size
      );
      if (!tableAssignments) {
        throw new InventoryError(
          "No suitable tables are available for this party at the selected time. Choose another time or a smaller party.",
          "TABLE_ASSIGNMENT_CONFLICT",
          409
        );
      }
      const bookingId = await generateReadableId(
        body.reservation_type === "unlimited" ? "KTN-UNL" : "KTN-DINE",
        date,
        "booking_id",
        tx
      );

      const created = await tx.reservation.create({
        data: {
          booking_id: bookingId,
          customer_name: body.customer_name,
          customer_phone: body.customer_phone,
          customer_email: body.customer_email,
          reservation_type: body.reservation_type,
          date,
          time: body.time,
          party_size: body.party_size,
          unlimited_package_id: unlimitedSettings?.id ?? null,
          subtotal: totalPrice,
          tax: 0,
          total_price: totalPrice,
          payment_plan: "pay_at_venue",
          downpayment_percent: 0,
          downpayment_amount: 0,
          remaining_balance: totalPrice,
          downpayment_status: "pending",
          full_payment_paid: false,
          remaining_paid_at_venue: false,
          final_payment_status: "pending",
          status: "confirmed",
          special_requests: null,
          created_by: body.customer_name
        }
      });
      await tx.reservationTableAssignment.createMany({
        data: tableAssignments.map((assignment) => ({
          reservation_id: created.id,
          table_id: assignment.table_id,
          seat_count: assignment.seat_count,
          status: "assigned"
        }))
      });
      await addReservationActivity(tx, {
        reservationId: created.id,
        eventType: "booking_created",
        toStatus: created.status,
        actorType: "customer",
        actorName: body.customer_name,
        details: {
          payment_stage: "pay_at_venue",
          amount: 0,
          reservation_type: body.reservation_type
        }
      });
      return created;
    });

    return res.status(201).json({
      success: true,
      booking_id: reservation.booking_id,
      downpayment_amount: reservation.downpayment_amount,
      paid_amount: 0,
      remaining_balance: reservation.remaining_balance,
      payment_method: reservation.downpayment_method,
      payment_plan: reservation.payment_plan,
      status: reservation.status,
      message: "Reservation confirmed. Pay at the restaurant after dining."
    });
  } catch (error) {
    return next(error);
  }
});

app.post("/api/reservations/dine-in", (_req, res) => {
  return res.status(410).json({
    message: "Product-based dine-in reservations are no longer available. Use the table reservation flow."
  });
});

app.post("/api/catering/inquiry", async (req, res, next) => {
  try {
    const rawBody = cateringInquiryBodySchema.parse(req.body);
    const systemSettings = await getSystemSettings();
    const event_date = manilaDateToUtc(rawBody.event_date);
    const body = { ...rawBody, event_date };

    if (isPastDate(body.event_date)) {
      return res.status(400).json({ message: "Event date cannot be in the past" });
    }

    if (body.headcount !== undefined && body.headcount !== null && body.headcount < systemSettings.minimum_catering_pax) {
      return res.status(400).json({ message: `Catering requires at least ${systemSettings.minimum_catering_pax} pax.` });
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
      include: {
        activity: {
          where: { event_type: "late_arrival_still_coming" },
          select: { id: true },
          take: 1
        }
      },
      orderBy: [{ date: "asc" }, { time: "asc" }]
    });

    return res.json({
      reservations: reservations.map((reservation) => ({
        ...reservation,
        late_alert: isDineInReservationLateAlert(
          reservation.date,
          reservation.time,
          reservation.status,
          reservation.activity.length > 0
        )
      }))
    });
  } catch (error) {
    return next(error);
  }
});

app.get("/api/staff/reminders", async (req, res, next) => {
  try {
    const user = requireRole(req, res, ["admin", "receptionist", "event_coordinator"]);

    if (!user) {
      return;
    }

    const todayKey = manilaDateKey(new Date());
    const reminderHorizon = new Date(`${todayKey}T00:00:00.000Z`);
    reminderHorizon.setUTCDate(reminderHorizon.getUTCDate() + 7);
    const throughDateKey = reminderHorizon.toISOString().slice(0, 10);
    const dateRange = {
      gte: startOfDay(manilaDateToUtc(todayKey)),
      lte: endOfDay(manilaDateToUtc(throughDateKey))
    };
    const role = user.role.toLowerCase();
    const [dineInReservations, cateringReservations] = await Promise.all([
      ["admin", "receptionist"].includes(role)
        ? prisma.reservation.findMany({
            where: { status: "confirmed", date: dateRange },
            select: {
              id: true,
              booking_id: true,
              customer_name: true,
              date: true,
              time: true,
              party_size: true
            },
            orderBy: [{ date: "asc" }, { time: "asc" }]
          })
        : Promise.resolve([]),
      ["admin", "event_coordinator"].includes(role)
        ? prisma.cateringReservation.findMany({
            where: {
              status: { in: ["confirmed", "in_progress"] },
              confirmed_date: dateRange
            },
            select: {
              id: true,
              reservation_id: true,
              customer_name: true,
              headcount: true,
              confirmed_date: true,
              status: true,
              package: { select: { name: true } }
            },
            orderBy: { confirmed_date: "asc" }
          })
        : Promise.resolve([])
    ]);

    const reminders = [
      ...dineInReservations.map((reservation) => ({
        id: reservation.id,
        type: "dine_in" as const,
        reference: reservation.booking_id,
        customerName: reservation.customer_name,
        date: reservation.date,
        time: reservation.time,
        status: "confirmed",
        detail: `${reservation.party_size} guests`
      })),
      ...cateringReservations.map((reservation) => ({
        id: reservation.id,
        type: "catering" as const,
        reference: reservation.reservation_id ?? reservation.id,
        customerName: reservation.customer_name ?? "Customer",
        date: reservation.confirmed_date ?? new Date(0),
        time: null,
        status: reservation.status ?? "confirmed",
        detail: [reservation.package?.name, reservation.headcount ? `${reservation.headcount} guests` : null]
          .filter(Boolean)
          .join(" · ")
      }))
    ].sort((left, right) => {
      const dateOrder = new Date(left.date).getTime() - new Date(right.date).getTime();
      return dateOrder || (left.time ?? "").localeCompare(right.time ?? "");
    });

    return res.json({ reminders });
  } catch (error) {
    return next(error);
  }
});

app.get("/api/staff/notifications", async (req, res, next) => {
  try {
    const user = requireRole(req, res, ["admin", "inventory_manager", "cashier", "receptionist", "event_coordinator", "chef"]);

    if (!user) {
      return;
    }

    const role = user.role.toLowerCase();
    const [dineInReservations, cateringReservations] = await Promise.all([
      ["admin", "receptionist"].includes(role)
        ? prisma.reservation.findMany({
            where: { status: { in: ["pending", "pending_approval"] } },
            select: {
              id: true,
              booking_id: true,
              customer_name: true,
              date: true,
              time: true,
              status: true,
              created_at: true
            },
            orderBy: { created_at: "desc" },
            take: 8
          })
        : Promise.resolve([]),
      ["admin", "event_coordinator"].includes(role)
        ? prisma.cateringReservation.findMany({
            where: { status: { in: ["pending", "pending_approval"] } },
            select: {
              id: true,
              reservation_id: true,
              customer_name: true,
              event_date: true,
              status: true,
              created_at: true
            },
            orderBy: { created_at: "desc" },
            take: 8
          })
        : Promise.resolve([])
    ]);

    const notifications = [
      ...dineInReservations.map((reservation) => ({
        id: reservation.id,
        type: "dine_in" as const,
        reference: reservation.booking_id,
        customerName: reservation.customer_name,
        date: reservation.date,
        time: reservation.time,
        status: reservation.status,
        createdAt: reservation.created_at
      })),
      ...cateringReservations.map((reservation) => ({
        id: reservation.id,
        type: "catering" as const,
        reference: reservation.reservation_id ?? "Catering booking",
        customerName: reservation.customer_name ?? "Customer",
        date: reservation.event_date ?? reservation.created_at,
        time: null,
        status: reservation.status ?? "pending_approval",
        createdAt: reservation.created_at
      }))
    ]
      .sort((first, second) => second.createdAt.getTime() - first.createdAt.getTime())
      .slice(0, 8);

    return res.json({ notifications });
  } catch (error) {
    return next(error);
  }
});

app.get("/api/staff/reservations/overview", async (req, res, next) => {
  try {
    const user = requireRole(req, res, ["admin", "receptionist", "cashier", "event_coordinator", "chef"]);
    if (!user) {
      return;
    }
    const canViewTables = ["admin", "receptionist"].includes(user.role);
    const canViewCatering = ["admin", "event_coordinator"].includes(user.role);

    const [tableReservations, cateringReservations] = await Promise.all([
      canViewTables ? prisma.reservation.findMany({
        select: {
          id: true,
          booking_id: true,
          customer_name: true,
          date: true,
          time: true,
          party_size: true,
          reservation_type: true,
          status: true,
          table_assignments: {
            where: { status: { in: ["assigned", "seated"] } },
            orderBy: { table: { table_number: "asc" } },
            select: { table: { select: { table_number: true } } }
          }
        },
        orderBy: [{ date: "asc" }, { time: "asc" }]
      }) : Promise.resolve([]),
      canViewCatering ? prisma.cateringReservation.findMany({
        where: { confirmed_date: { not: null } },
        select: {
          id: true,
          reservation_id: true,
          customer_name: true,
          confirmed_date: true,
          event_time: true,
          headcount: true,
          status: true,
          package: { select: { name: true } }
        },
        orderBy: [{ confirmed_date: "asc" }, { event_time: "asc" }]
      }) : Promise.resolve([])
    ]);

    const reservations = [
      ...tableReservations.map((reservation) => ({
        id: reservation.id,
        type: "dine_in" as const,
        reference: reservation.booking_id,
        customer_name: reservation.customer_name,
        date: reservation.date,
        time: reservation.time,
        guests: reservation.party_size,
        reservation_type: reservation.reservation_type,
        status: reservation.status,
        table_numbers: reservation.table_assignments.map((assignment) => assignment.table.table_number)
      })),
      ...cateringReservations.map((reservation) => ({
        id: reservation.id,
        type: "catering" as const,
        reference: reservation.reservation_id ?? reservation.id,
        customer_name: reservation.customer_name ?? "Customer",
        date: reservation.confirmed_date!,
        time: reservation.event_time ?? "",
        guests: reservation.headcount ?? 0,
        reservation_type: "catering",
        status: reservation.status ?? "pending",
        table_numbers: [] as number[],
        package_name: reservation.package?.name ?? null
      }))
    ].sort((first, second) =>
      first.date.getTime() - second.date.getTime() ||
      first.time.localeCompare(second.time) ||
      first.reference.localeCompare(second.reference)
    );

    return res.json({ reservations });
  } catch (error) {
    return next(error);
  }
});

app.get("/api/staff/reservations/overview/pickup", async (req, res, next) => {
  try {
    const user = requireRole(req, res, ["admin", "receptionist", "cashier", "chef"]);
    if (!user) return;
    const orders = await prisma.takeoutOrder.findMany({
      where: { status: { notIn: ["cancelled", "expired"] } },
      select: {
        order_number: true,
        status: true,
        payment_plan: true,
        payment_status: true,
        payment_method: true,
        customer_name: true,
        created_at: true,
        total: true,
        items: {
          orderBy: { created_at: "asc" },
          select: { name_snapshot: true, quantity: true, total_price: true }
        }
      },
      orderBy: [{ created_at: "asc" }, { order_number: "asc" }]
    });
    return res.json({
      orders: orders.map((order) => ({
        order_number: order.order_number,
        status: order.status === "released" ? "completed" : order.status,
        payment_plan: order.payment_plan,
        payment_status: order.payment_status,
        payment_method: order.payment_method,
        customer_name: order.customer_name,
        created_at: order.created_at,
        total: order.total,
        items: order.items.map((item) => ({
          name: item.name_snapshot,
          quantity: item.quantity,
          total_price: item.total_price
        }))
      }))
    });
  } catch (error) {
    return next(error);
  }
});

app.get("/api/staff/reservations/all", async (req, res, next) => {
  try {
    const user = requireRole(req, res, ["admin", "receptionist"]);
    if (!user) return;

    const date = typeof req.query.date === "string" ? manilaDateToUtc(req.query.date) : undefined;
    const status = typeof req.query.status === "string" ? req.query.status : undefined;

    const dineInReservations = await prisma.reservation.findMany({
      where: {
        status,
        date: date ? { gte: startOfDay(date), lte: endOfDay(date) } : undefined
      },
      include: {
        unlimited_package: true,
        payments: { orderBy: { received_at: "asc" } },
        ingredient_locks: { include: { raw_material: true }, orderBy: { created_at: "asc" } },
        table_assignments: {
          where: { status: { in: ["assigned", "seated"] } },
          orderBy: { table: { table_number: "asc" } },
          select: { table: { select: { table_number: true } } }
        },
        activity: {
          where: { event_type: "late_arrival_still_coming" },
          select: { id: true },
          take: 1
        }
      },
      orderBy: [{ date: "desc" }, { time: "asc" }]
    });

    const cateringReservations = await prisma.cateringReservation.findMany({
      where: {
        status,
        event_date: date ? { gte: startOfDay(date), lte: endOfDay(date) } : undefined
      },
      include: {
        package: true,
        inquiry: true,
        payments: { orderBy: { received_at: "asc" } },
        ingredient_locks: { include: { raw_material: true }, orderBy: { created_at: "asc" } }
      },
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
        created_at: reservation.created_at,
        created_by: reservation.created_by,
        date: reservation.date,
        time: reservation.time,
        guests: reservation.party_size,
        table_numbers: reservation.table_assignments.map((assignment) => assignment.table.table_number),
        reservation_type: reservation.reservation_type,
        selected_products: reservation.selected_products ?? [],
        ingredient_locks: reservation.ingredient_locks,
        status: reservation.status,
        late_alert: isDineInReservationLateAlert(
          reservation.date,
          reservation.time,
          reservation.status,
          reservation.activity.length > 0
        ),
        late_acknowledged: reservation.activity.length > 0,
        payment_plan: reservation.payment_plan,
        downpayment_amount: reservation.downpayment_amount,
        total_price: reservation.total_price,
        ...paymentSummaryFields(reservation),
        package_name: reservation.reservation_type === "unlimited" ? "Unlimited Eat-All-You-Can" : "Regular Order",
        venue_type: null
      })),
      ...cateringReservations.map((reservation) => ({
        id: reservation.id,
        type: "catering",
        reference: reservation.reservation_id,
        customer_name: reservation.customer_name,
        created_at: reservation.created_at,
        created_by: reservation.created_by,
        date: reservation.event_date,
        ingredient_locks: reservation.ingredient_locks,
        time: "",
        guests: reservation.headcount,
        table_numbers: [],
        status: reservation.status,
        payment_plan: reservation.payment_plan,
        downpayment_amount: reservation.downpayment_amount,
        total_price: reservation.total_price,
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

app.get("/api/staff/reservations/:id/ingredient-locks", async (req, res, next) => {
  try {
    const user = requireRole(req, res, ["admin", "receptionist"]);
    if (!user) return;
    const locks = await prisma.reservationIngredientLock.findMany({
      where: { reservation_id: req.params.id },
      include: { raw_material: true },
      orderBy: { created_at: "asc" }
    });
    return res.json({ locks });
  } catch (error) {
    return next(error);
  }
});

app.get("/api/staff/reservations/:id/activity", async (req, res, next) => {
  try {
    const user = requireRole(req, res, ["admin", "receptionist"]);
    if (!user) return;
    const activity = await prisma.reservationActivity.findMany({
      where: { reservation_id: req.params.id },
      orderBy: { created_at: "asc" }
    });
    return res.json({ activity });
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

    const reservation = await prisma.$transaction(async (tx) => {
      await lockDineInReservationForUpdate(tx, req.params.id);
      const current = await tx.reservation.findUnique({ where: { id: req.params.id } });
      if (!current) {
        throw new InventoryError("Reservation not found.", "BOOKING_NOT_FOUND", 404);
      }
      if (!["pending_approval", "pending"].includes(current.status)) {
        throw new InventoryError("Only a pending booking can be approved.", "BOOKING_NOT_PENDING", 409);
      }
      const updated = await tx.reservation.update({
        where: { id: req.params.id },
        data: {
          admin_notes: body.admin_notes || null,
          rejected_reason: null,
          alternative_suggestions: null,
          status: "confirmed"
        }
      });
      const selectedItemsResult = z.array(z.object({
        product_id: z.string().min(1),
        name: z.string(),
        quantity: z.coerce.number().int().positive()
      })).safeParse(current.selected_products);
      if (!selectedItemsResult.success || selectedItemsResult.data.length === 0) {
        throw new InventoryError("This booking has no menu items to reserve.", "BOOKING_ITEMS_MISSING", 409);
      }
      const selectedItems = selectedItemsResult.data;
      await createDineInIngredientLocks(tx, current.id, selectedItems, user.sub);
      await addReservationActivity(tx, {
        reservationId: current.id,
        eventType: "status_changed",
        fromStatus: current.status,
        toStatus: updated.status,
        actorType: "staff",
        actorId: user.sub,
        reason: "Booking approved"
      });

      return updated;
    }, { maxWait: 10_000, timeout: 30_000 });

    await notificationService.sendConfirmation(
      reservation.booking_id,
      { name: reservation.customer_name, phone: reservation.customer_phone, email: reservation.customer_email },
      { date: reservation.date, time: reservation.time }
    );
    void emailService.sendApprovalNotification({
      bookingId: reservation.booking_id,
      email: reservation.customer_email,
      name: reservation.customer_name,
      date: reservation.date,
      time: reservation.time,
      partySize: reservation.party_size,
      items: Array.isArray(reservation.selected_products) ? reservation.selected_products as any : undefined,
      total: reservation.total_price,
      downpayment: reservation.downpayment_amount,
      remaining: reservation.remaining_balance,
      status: reservation.status,
      specialRequests: reservation.special_requests
    }).catch((error) => console.error("Failed to send booking approval email:", error));

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
    const reservation = await prisma.$transaction(async (tx) => {
      await lockDineInReservationForUpdate(tx, req.params.id);
      const current = await tx.reservation.findUnique({
        where: { id: req.params.id },
        include: { payments: true }
      });
      if (!current) {
        throw new InventoryError("Reservation not found.", "BOOKING_NOT_FOUND", 404);
      }
      if (!["pending", "pending_approval"].includes(current.status)) {
        throw new InventoryError("Only a pending booking can be declined.", "BOOKING_NOT_PENDING", 409);
      }
      if (current.payments.some((payment) => payment.payment_stage === "refund")) {
        throw new InventoryError("The downpayment has already been refunded.", "REFUND_ALREADY_RECORDED", 409);
      }
      const refundAmount = Number(current.downpayment_amount);
      if (refundAmount > 0) {
        await tx.reservationPayment.create({
          data: {
            reservation_id: current.id,
            payment_stage: "refund",
            method: current.downpayment_method ?? "cash",
            amount: refundAmount,
            reference_number: current.downpayment_transaction_id,
            source: "staff",
            recorded_by_id: user.sub
          }
        });
      }
      const updated = await tx.reservation.update({
        where: { id: current.id },
        data: {
          status: "rejected",
          rejected_reason: body.rejected_reason,
          alternative_suggestions: body.alternative_suggestions || null,
          remaining_balance: Number(current.total_price),
          final_payment_status: refundAmount > 0 ? "refunded" : "unpaid",
          full_payment_paid: false,
          full_payment_date: null
        },
        include: { payments: true }
      });
      await addReservationActivity(tx, {
        reservationId: current.id,
        eventType: "booking_declined",
        fromStatus: current.status,
        toStatus: updated.status,
        actorType: "staff",
        actorId: user.sub,
        reason: body.rejected_reason,
        details: { refund_amount: refundAmount }
      });
      return updated;
    });

    await notificationService.sendRejection(
      reservation.booking_id,
      { name: reservation.customer_name, phone: reservation.customer_phone, email: reservation.customer_email },
      reservation.rejected_reason ?? "Unavailable",
      reservation.alternative_suggestions
    );
    void emailService.sendRejectionNotification(
      reservation.booking_id,
      reservation.customer_email,
      reservation.customer_name,
      reservation.rejected_reason ?? "Unavailable",
      reservation.alternative_suggestions
    ).catch((error) => console.error("Failed to send booking rejection email:", error));

    return res.json({ reservation });
  } catch (error) {
    return next(error);
  }
});

app.put("/api/staff/reservations/:id/cancel", async (req, res, next) => {
  try {
    const user = requireRole(req, res, ["admin", "receptionist"]);

    if (!user) {
      return;
    }

    const body = z.object({
      reason: z.string().min(1),
      amount: z.coerce.number().min(0).optional(),
      payment_method: z.enum(["cash", "gcash", "bank_transfer"]).optional(),
      reference_number: z.string().optional().nullable(),
      cash_received: z.coerce.number().min(0).optional().nullable(),
      prepared_ingredients: z.array(z.object({
        raw_material_id: z.string().min(1),
        quantity: z.coerce.number().int().positive()
      })).optional()
    }).parse(req.body);

    const reservation = await prisma.$transaction(async (tx) => {
      await lockDineInReservationForUpdate(tx, req.params.id);
      const current = await tx.reservation.findUnique({
        where: { id: req.params.id },
        include: {
          payments: { orderBy: { received_at: "asc" } },
          ingredient_locks: { where: { is_released: false } }
        }
      });

      if (!current) {
        throw Object.assign(new Error("Reservation not found"), { statusCode: 404 });
      }

      if (isTerminalReservationStatus(current.status)) {
        throw new InventoryError("This dine-in booking is already closed and cannot be cancelled again.", "BOOKING_ALREADY_CLOSED", 409);
      }

      const preparationStarted = ["seated", "preparing", "in_progress", "pending_final_payment"].includes(current.status.toLowerCase());
      if (preparationStarted && current.ingredient_locks.length > 0 && body.prepared_ingredients === undefined) {
        throw new InventoryError(
          "Record the quantities already prepared before cancelling this booking.",
          "PREPARATION_DETAILS_REQUIRED",
          400
        );
      }

      const preparedByMaterial = new Map<string, number>();
      for (const item of body.prepared_ingredients ?? []) {
        preparedByMaterial.set(item.raw_material_id, (preparedByMaterial.get(item.raw_material_id) ?? 0) + item.quantity);
      }
      for (const [materialId, quantity] of preparedByMaterial) {
        const wasted = await wasteDineInReservationIngredients(tx, {
          reservationId: current.id,
          materialId,
          quantity,
          bookingReference: current.booking_id,
          actorId: user.sub,
          reason: `Prepared before cancellation: ${body.reason}`
        });
        await tx.inventoryTransaction.createMany({
          data: wasted.allocations.map((allocation) => ({
            raw_material_id: materialId,
            batch_id: allocation.batchId,
            transaction_type: "waste",
            quantity: allocation.quantity,
            unit: wasted.material.unit,
            reference: `Booking ${current.booking_id}: Prepared before cancellation`,
            reason: "prep_waste",
            user_id: user.sub
          }))
        });
      }

      if (current.ingredient_locks.length > 0) {
        await cancelDineInIngredientLocks(tx, current.id, user.sub, body.reason, current.booking_id);
      }

      const updated = await tx.reservation.update({
        where: { id: current.id },
        data: {
          status: "cancelled",
          rejected_reason: body.reason,
          admin_notes: body.reason
        },
        include: { payments: { orderBy: { received_at: "asc" } } }
      });
      await addReservationActivity(tx, {
        reservationId: current.id,
        eventType: "booking_cancelled",
        fromStatus: current.status,
        toStatus: updated.status,
        actorType: "staff",
        actorId: user.sub,
        reason: body.reason
      });
      return updated;
    });

    return res.json({ reservation });
  } catch (error) {
    return next(error);
  }
});

app.put("/api/staff/reservations/:id/no-show", async (req, res, next) => {
  try {
    const user = requireRole(req, res, ["admin", "receptionist"]);
    if (!user) return;
    const body = z.object({ reason: z.string().trim().min(1).max(500) }).parse(req.body);
    const reservation = await prisma.$transaction(async (tx) => {
      await lockDineInReservationForUpdate(tx, req.params.id);
      const current = await tx.reservation.findUnique({
        where: { id: req.params.id },
        include: { ingredient_locks: { where: { is_released: false } }, payments: true }
      });
      if (!current) throw new InventoryError("Reservation not found.", "BOOKING_NOT_FOUND", 404);
      if (isTerminalReservationStatus(current.status)) {
        throw new InventoryError("This booking is already closed.", "BOOKING_ALREADY_CLOSED", 409);
      }
      if (!["confirmed", "approved"].includes(current.status)) {
        throw new InventoryError("Only a confirmed booking that has not started preparation can be marked no-show.", "BOOKING_NOT_READY_FOR_NO_SHOW", 409);
      }
      if (!isDineInReservationLate(current.date, current.time)) {
        throw new InventoryError(
          `A no-show decision is available ${RESERVATION_SETTINGS.LATE_ALERT_MINUTES} minutes after the booked time.`,
          "BOOKING_NOT_LATE",
          409
        );
      }
      await cancelDineInIngredientLocks(tx, current.id, user.sub, body.reason, current.booking_id);
      const updated = await tx.reservation.update({
        where: { id: current.id },
        data: { status: "no_show" },
        include: { payments: true }
      });
      await addReservationActivity(tx, {
        reservationId: current.id,
        eventType: "booking_no_show",
        fromStatus: current.status,
        toStatus: updated.status,
        actorType: "staff",
        actorId: user.sub,
        reason: body.reason
      });
      return updated;
    });
    return res.json({ reservation });
  } catch (error) {
    return next(error);
  }
});

app.put("/api/staff/reservations/:id/still-coming", async (req, res, next) => {
  try {
    const user = requireRole(req, res, ["admin", "receptionist"]);
    if (!user) return;
    const body = z.object({
      note: z.string().trim().max(500).optional(),
      expected_time: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/).optional()
    }).parse(req.body);
    const reservation = await prisma.$transaction(async (tx) => {
      await lockDineInReservationForUpdate(tx, req.params.id);
      const current = await tx.reservation.findUnique({ where: { id: req.params.id } });
      if (!current) throw new InventoryError("Reservation not found.", "BOOKING_NOT_FOUND", 404);
      if (!["confirmed", "approved"].includes(current.status)) {
        throw new InventoryError("Only a confirmed booking can be marked as still coming.", "BOOKING_NOT_CONFIRMED", 409);
      }
      if (!isDineInReservationLate(current.date, current.time)) {
        throw new InventoryError(
          `A late-arrival decision is available ${RESERVATION_SETTINGS.LATE_ALERT_MINUTES} minutes after the booked time.`,
          "BOOKING_NOT_LATE",
          409
        );
      }
      const previousDecision = await tx.reservationActivity.findFirst({
        where: { reservation_id: current.id, event_type: "late_arrival_still_coming" },
        select: { id: true }
      });
      if (previousDecision) {
        throw new InventoryError("A late-arrival decision has already been recorded for this booking.", "LATE_DECISION_RECORDED", 409);
      }
      await addReservationActivity(tx, {
        reservationId: current.id,
        eventType: "late_arrival_still_coming",
        fromStatus: current.status,
        toStatus: current.status,
        actorType: "staff",
        actorId: user.sub,
        reason: body.note || "Customer confirmed they are still coming.",
        details: { expected_time: body.expected_time ?? null }
      });
      return current;
    });
    return res.json({ reservation, late_alert_cleared: true });
  } catch (error) {
    return next(error);
  }
});

for (const action of ["seat", "arrive"] as const) {
  app.put(`/api/staff/reservations/:id/${action}`, (req, res) => {
    const user = requireRole(req, res, ["admin", "receptionist"]);
    if (!user) return;
    return res.status(410).json({
      message: "Reservations can only be seated from the POS."
    });
  });
}

app.put("/api/staff/reservations/:id/complete", async (req, res, next) => {
  try {
    const user = requireRole(req, res, ["admin", "receptionist"]);

    if (!user) {
      return;
    }

    const updated = await prisma.$transaction(async (tx) => {
      await lockDineInReservationForUpdate(tx, req.params.id);
      const reservation = await tx.reservation.findUnique({ where: { id: req.params.id } });
      if (!reservation) {
        throw new InventoryError("Reservation not found.", "BOOKING_NOT_FOUND", 404);
      }
      if (!["confirmed", "seated", "preparing", "in_progress", "pending_final_payment"].includes(reservation.status)) {
        throw new InventoryError("Only an active booking can be completed.", "BOOKING_NOT_ACTIVE", 409);
      }
      if (Number(reservation.remaining_balance) > 0) {
        throw new InventoryError("The remaining balance must be paid before completing this booking.", "BALANCE_DUE", 409);
      }

      await useDineInReservationLocks(tx, reservation.id, user.sub, reservation.booking_id);
      const completed = await tx.reservation.update({
        where: { id: reservation.id },
        data: { status: "completed" }
      });
      await addReservationActivity(tx, {
        reservationId: reservation.id,
        eventType: "status_changed",
        fromStatus: reservation.status,
        toStatus: completed.status,
        actorType: "staff",
        actorId: user.sub,
        reason: "Booking served"
      });
      return completed;
    });
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

    const tables = await prisma.table.findMany({ where: { is_archived: false }, orderBy: { table_number: "asc" } });
    const normalizedTables = tables.map((table) => ({ ...table, status: normalizeTableStatus(table.status) }));
    return res.json({ tables: normalizedTables });
  } catch (error) {
    return next(error);
  }
});

app.get("/api/staff/reservation-slot-capacity", async (req, res, next) => {
  try {
    const user = requireRole(req, res, ["admin"]);
    if (!user) return;

    const query = z.object({
      date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
      time: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/)
    }).parse(req.query);
    const date = manilaDateToUtc(query.date);
    if (manilaDateKey(date) !== query.date ||
        query.time < RESERVATION_SETTINGS.OPENING_TIME ||
        query.time > RESERVATION_SETTINGS.LAST_BOOKING_TIME) {
      return res.status(400).json({ message: "Choose a valid service date and time." });
    }

    return res.json(await getReservationSlotSummary(prisma, query.date, query.time));
  } catch (error) {
    return next(error);
  }
});

app.put("/api/staff/reservation-slot-capacity", async (req, res, next) => {
  try {
    const user = requireRole(req, res, ["admin"]);
    if (!user) return;

    const body = z.object({
      date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
      time: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
      walk_in_pax: z.coerce.number().int().min(0).max(1000)
    }).parse(req.body);
    const date = manilaDateToUtc(body.date);
    if (manilaDateKey(date) !== body.date ||
        body.time < RESERVATION_SETTINGS.OPENING_TIME ||
        body.time > RESERVATION_SETTINGS.LAST_BOOKING_TIME) {
      return res.status(400).json({ message: "Choose a valid service date and time." });
    }

    const slotStart = getReservationSlotStart(
      body.time,
      RESERVATION_SETTINGS.OPENING_TIME,
      RESERVATION_SETTINGS.SLOT_DURATION_MINUTES
    );
    const summary = await prisma.$transaction(async (tx) => {
      await tx.reservationSlotCapacity.upsert({
        where: { service_date_slot_start: { service_date: body.date, slot_start: slotStart } },
        update: {},
        create: { service_date: body.date, slot_start: slotStart, walk_in_pax: 0 }
      });
      await tx.$queryRaw`
        SELECT "id" FROM "reservation_slot_capacities"
        WHERE "service_date" = ${body.date} AND "slot_start" = ${slotStart}
        FOR UPDATE
      `;
      await tx.reservationSlotCapacity.update({
        where: { service_date_slot_start: { service_date: body.date, slot_start: slotStart } },
        data: { walk_in_pax: body.walk_in_pax }
      });
      return getReservationSlotSummary(tx, body.date, body.time);
    });
    return res.json(summary);
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

    const body = z.object({
      status: z.preprocess(
        (value) => typeof value === "string" ? normalizeTableStatus(value) : value,
        z.enum(["available", "occupied", "reserved"])
      )
    }).parse(req.body);
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
  const user = requireRole(req, res, ["admin", "event_coordinator"]);
  if (!user) return;
  return res.status(409).json({
    message: "Catering bookings must be submitted with a verified downpayment, then approved from the pending bookings list."
  });
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

app.get("/api/staff/catering/reservations/:id/activity", async (req, res, next) => {
  try {
    const user = requireRole(req, res, ["admin", "event_coordinator"]);
    if (!user) return;
    const activity = await prisma.reservationActivity.findMany({
      where: { catering_reservation_id: req.params.id },
      orderBy: { created_at: "asc" }
    });
    return res.json({ activity });
  } catch (error) {
    return next(error);
  }
});

app.post("/api/staff/catering/ingredient-locks", async (req, res, next) => {
  try {
    const user = requireRole(req, res, ["admin", "event_coordinator"]);
    if (!user) return;
    throw new InventoryError("Catering ingredient reservations are disabled.", "CATERING_INVENTORY_DISABLED", 409);
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

  const deductionsByMaterial = new Map<string, { quantity: number; unit: string }>();
  for (const lock of locks) {
    const deduction = deductionsByMaterial.get(lock.raw_material_id) ?? { quantity: 0, unit: lock.unit };
    deduction.quantity += Number(lock.reserved_quantity);
    deductionsByMaterial.set(lock.raw_material_id, deduction);
  }

  for (const [rawMaterialId, deduction] of deductionsByMaterial) {
    await consumeMaterialStock(tx, {
      raw_material_id: rawMaterialId,
      quantity: deduction.quantity,
      source_type: "catering",
      source_reference: reference ?? reservationId,
      actor_id: userId,
      action: "Used",
      releaseReservedQuantity: deduction.quantity,
      note: "Catering reservation served"
    });
  }

  if (locks.length > 0) {
    await tx.inventoryTransaction.createMany({
      data: locks.map((lock) => ({
        raw_material_id: lock.raw_material_id,
        transaction_type: "deduct",
        quantity: lock.reserved_quantity,
        unit: lock.unit,
        reference: reference ?? `Catering reservation ${reservationId}`,
        reason: "catering_event",
        user_id: userId
      }))
    });
  }

  await tx.cateringIngredientLock.updateMany({
    where: { catering_reservation_id: reservationId, is_released: false },
    data: { is_released: true, released_at: new Date() }
  });
}

async function useDineInReservationLocks(
  tx: Prisma.TransactionClient,
  reservationId: string,
  userId?: string,
  reference?: string
) {
  const locks = await tx.reservationIngredientLock.findMany({
    where: { reservation_id: reservationId, is_released: false },
    include: { raw_material: true }
  });
  const quantitiesByMaterial = new Map<string, { quantity: number; unit: string }>();
  for (const lock of locks) {
    const current = quantitiesByMaterial.get(lock.raw_material_id) ?? { quantity: 0, unit: lock.unit };
    current.quantity += Number(lock.reserved_quantity);
    quantitiesByMaterial.set(lock.raw_material_id, current);
  }

  for (const [materialId, reserved] of quantitiesByMaterial) {
    await consumeMaterialStock(tx, {
      raw_material_id: materialId,
      quantity: reserved.quantity,
      source_type: "dine-in",
      source_reference: reference ?? reservationId,
      actor_id: userId,
      action: "Used",
      releaseReservedQuantity: reserved.quantity,
      note: "Dine-in reservation served"
    });
  }

  if (locks.length > 0) {
    await tx.inventoryTransaction.createMany({
      data: locks.map((lock) => ({
        raw_material_id: lock.raw_material_id,
        transaction_type: "deduct",
        quantity: Number(lock.reserved_quantity),
        unit: lock.unit,
        reference: reference ?? `Dine-in reservation ${reservationId}`,
        reason: "dine_in_event",
        user_id: userId
      }))
    });
  }

  await tx.reservationIngredientLock.updateMany({
    where: { reservation_id: reservationId, is_released: false },
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
      await lockCateringReservationForUpdate(tx, req.params.id);
      const current = await tx.cateringReservation.findUnique({
        where: { id: req.params.id },
        include: { payments: true }
      });

      if (!current) {
        throw Object.assign(new Error("Reservation not found"), { statusCode: 404 });
      }

      if (["cancelled", "canceled", "completed", "declined", "expired", "no-show", "no_show"].includes((current.status ?? "").toLowerCase())) {
        throw new InventoryError("This catering booking is already closed.", "BOOKING_ALREADY_CLOSED", 409);
      }

      if (!["confirmed", "in_progress", "pending_final_payment", "preparing"].includes(current.status ?? "")) {
        throw new InventoryError("Only an active catering booking can be completed.", "BOOKING_NOT_ACTIVE", 409);
      }

      const { remaining_balance: remainingBalance } = paymentSummaryFields(current);
      if (remainingBalance > 0) {
        throw new InventoryError("Full payment is required before this catering booking can be completed.", "FULL_PAYMENT_REQUIRED", 409);
      }

      const completed = await tx.cateringReservation.update({
        where: { id: req.params.id },
        data: { status: "completed" }
      });
      await addReservationActivity(tx, {
        cateringReservationId: current.id,
        eventType: "status_changed",
        fromStatus: current.status,
        toStatus: completed.status,
        actorType: "staff",
        actorId: user.sub,
        reason: "Catering event served"
      });
      return completed;
    }, { maxWait: 10_000, timeout: 25_000 });

    return res.json({ reservation });
  } catch (error) {
    return next(error);
  }
}

app.put("/api/staff/catering/reservations/:id/complete", completeCateringReservation);
app.post("/api/staff/catering/reservations/:id/complete", completeCateringReservation);

app.post("/api/auth/login", async (req, res, next) => {
  try {
    const jwtSecret = getJwtSecret();
    if (!jwtSecret) {
      return res.status(503).json({ message: "Authentication is unavailable because JWT_SECRET is not configured." });
    }

    const body = z.object({ email: z.string().email(), password: z.string().min(1) }).parse(req.body);
    const user = await prisma.user.findUnique({ where: { email: body.email } });

    if (!user || !(await bcrypt.compare(body.password, user.password_hash))) {
      return res.status(401).json({ message: "Invalid email or password" });
    }

    const expiresIn = jwtExpirationSeconds(process.env.JWT_EXPIRES_IN ?? "8h");
    const token = jwt.sign(
      { sub: user.id, email: user.email, role: user.role },
      jwtSecret,
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

async function ensureBeverageStockMaterials() {
  const beverageProducts = await prisma.sellingProduct.findMany({
    where: { is_deleted: false, category: { equals: "Beverage", mode: "insensitive" } },
    select: { name: true }
  });

  await Promise.all(
    beverageProducts.map((product) => {
      const materialName = getBeverageStockMaterialName(product.name);
      return prisma.rawMaterial.upsert({
        where: { name: materialName },
        update: { category: "Beverage", is_deleted: false },
        create: {
          name: materialName,
          category: "Beverage",
          unit: normalizedBeverageUnit(product.name),
          current_stock: 0,
          reorder_level: 0,
          cost_per_unit: 0
        }
      });
    })
  );
}

app.get("/api/inventory/materials", async (_req, res, next) => {
  try {
    await ensureBeverageStockMaterials();

    const materials = await prisma.rawMaterial.findMany({
      where: { is_deleted: false },
      orderBy: { name: "asc" },
      include: {
        batches: { select: { remaining_quantity: true, expiration_date: true } }
      }
    });
    const materialIds = materials.map((material) => material.id);
    const [cateringLocks, dineInLocks, takeoutLocks, posDiningLocks] = materialIds.length === 0
      ? [[], [], [], []] as const
      : await Promise.all([
          prisma.cateringIngredientLock.findMany({
            where: { raw_material_id: { in: materialIds }, is_released: false },
            select: {
              id: true,
              raw_material_id: true,
              reserved_quantity: true,
              unit: true,
              catering_reservation: {
                select: {
                  id: true,
                  reservation_id: true,
                  status: true,
                  event_date: true,
                  confirmed_date: true,
                  inquiry: { select: { package_type: true, customer_name: true } }
                }
              }
            }
          }),
          prisma.reservationIngredientLock.findMany({
            where: { raw_material_id: { in: materialIds }, is_released: false },
            select: {
              id: true,
              raw_material_id: true,
              reserved_quantity: true,
              unit: true,
              reservation: {
                select: {
                  booking_id: true,
                  status: true,
                  reservation_type: true,
                  date: true,
                  customer_name: true
                }
              }
            }
          }),
          prisma.takeoutIngredientLock.findMany({
            where: {
              raw_material_id: { in: materialIds },
              is_released: false,
              order: {
                status: { in: ["pending_payment", "payment_failed", "pending_approval", "confirmed", "preparing", "ready"] },
                OR: [
                  { payment_plan: "pay_at_pickup" },
                  { payment_status: "paid" },
                  { payment_expires_at: { gt: new Date() } }
                ]
              }
            },
            select: {
              id: true,
              raw_material_id: true,
              reserved_quantity: true,
              unit: true,
              order: {
                select: {
                  order_number: true,
                  customer_name: true,
                  status: true,
                  created_at: true
                }
              }
            }
          }),
          prisma.dineInIngredientLock.findMany({
            where: {
              raw_material_id: { in: materialIds },
              is_released: false,
              order: { status: { in: ["reserved", "prepared", "ready"] } }
            },
            select: {
              id: true,
              raw_material_id: true,
              reserved_quantity: true,
              unit: true,
              order: {
                select: {
                  order_number: true,
                  status: true,
                  created_at: true,
                  dining_session: { select: { table: { select: { table_number: true } } } },
                  items: {
                    take: 1,
                    select: { guest: { select: { guest_number: true } } }
                  }
                }
              }
            }
          })
        ]);

    const activeCateringLocksByMaterial = new Map<string, typeof cateringLocks>();
    const activeDineInLocksByMaterial = new Map<string, typeof dineInLocks>();
    const activeTakeoutLocksByMaterial = new Map<string, typeof takeoutLocks>();
    const activePosDiningLocksByMaterial = new Map<string, typeof posDiningLocks>();
    for (const lock of cateringLocks) {
      if (!isReservationInventoryHoldActive(lock.catering_reservation.status, lock.catering_reservation.event_date)) {
        continue;
      }
      activeCateringLocksByMaterial.set(lock.raw_material_id, [
        ...(activeCateringLocksByMaterial.get(lock.raw_material_id) ?? []),
        lock
      ]);
    }
    for (const lock of dineInLocks) {
      if (!isReservationInventoryHoldActive(lock.reservation.status, lock.reservation.date)) {
        continue;
      }
      activeDineInLocksByMaterial.set(lock.raw_material_id, [
        ...(activeDineInLocksByMaterial.get(lock.raw_material_id) ?? []),
        lock
      ]);
    }
    for (const lock of takeoutLocks) {
      activeTakeoutLocksByMaterial.set(lock.raw_material_id, [
        ...(activeTakeoutLocksByMaterial.get(lock.raw_material_id) ?? []),
        lock
      ]);
    }
    for (const lock of posDiningLocks) {
      activePosDiningLocksByMaterial.set(lock.raw_material_id, [
        ...(activePosDiningLocksByMaterial.get(lock.raw_material_id) ?? []),
        lock
      ]);
    }

    const materialsWithReserved = materials.map((material) => {
      const cateringLocksForMaterial = activeCateringLocksByMaterial.get(material.id) ?? [];
      const dineInLocksForMaterial = activeDineInLocksByMaterial.get(material.id) ?? [];
      const takeoutLocksForMaterial = activeTakeoutLocksByMaterial.get(material.id) ?? [];
      const posDiningLocksForMaterial = activePosDiningLocksByMaterial.get(material.id) ?? [];
      const reserved_quantity = [
        ...cateringLocksForMaterial,
        ...dineInLocksForMaterial,
        ...takeoutLocksForMaterial,
        ...posDiningLocksForMaterial
      ].reduce((total, lock) => total + Number(lock.reserved_quantity), 0);
      const reserved_for = [
        ...cateringLocksForMaterial.map((lock) => ({
          id: lock.id,
          booking_reference:
            lock.catering_reservation.reservation_id ?? lock.catering_reservation.id,
          reserved_quantity: lock.reserved_quantity,
          unit: lock.unit,
          status: lock.catering_reservation.status,
          event_name:
            lock.catering_reservation.inquiry?.package_type ?? "Catering",
          event_date: lock.catering_reservation.event_date ?? lock.catering_reservation.confirmed_date,
          customer_name: lock.catering_reservation.inquiry?.customer_name ?? "Unknown"
        })),
        ...dineInLocksForMaterial.map((lock) => ({
          id: lock.id,
          booking_reference: lock.reservation.booking_id,
          reserved_quantity: lock.reserved_quantity,
          unit: lock.unit,
          status: lock.reservation.status,
          event_name: lock.reservation.reservation_type === "unlimited" ? "Unlimited dining" : "Dine-in",
          event_date: lock.reservation.date,
          customer_name: lock.reservation.customer_name
        })),
        ...takeoutLocksForMaterial.map((lock) => ({
          id: lock.id,
          booking_reference: lock.order.order_number,
          reserved_quantity: lock.reserved_quantity,
          unit: lock.unit,
          status: lock.order.status,
          event_name: "Takeout pickup",
          event_date: lock.order.created_at,
          customer_name: lock.order.customer_name
        })),
        ...posDiningLocksForMaterial.map((lock) => ({
          id: lock.id,
          booking_reference: lock.order.order_number,
          reserved_quantity: lock.reserved_quantity,
          unit: lock.unit,
          status: lock.order.status,
          event_name: `Table ${lock.order.dining_session.table.table_number} kitchen ticket`,
          event_date: lock.order.created_at,
          customer_name: `Guest ${lock.order.items[0]?.guest?.guest_number ?? "—"}`
        }))
      ];
      const batch_total = material.batches.reduce(
        (total, batch) => total + Number(batch.remaining_quantity),
        0
      );
      const expiring_within_7_days = material.batches.some(
        (batch) =>
          Number(batch.remaining_quantity) > 0 &&
          batch.expiration_date !== null &&
          batch.expiration_date.getTime() <= Date.now() + 7 * 24 * 60 * 60 * 1000
      );
      const { batches, ...rest } = material;

      return {
        ...rest,
        reserved_quantity,
        available_quantity: calculateAvailableQuantity(Number(material.current_stock), reserved_quantity),
        batch_total,
        batch_mismatch: Number(material.current_stock) !== batch_total,
        expiring_within_7_days,
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
    await ensureBeverageStockMaterials();
    const [materials, systemSettings] = await Promise.all([
      prisma.rawMaterial.findMany({
        where: { is_deleted: false },
        orderBy: { name: "asc" },
        select: {
          id: true,
          name: true,
          category: true,
          unit: true,
          current_stock: true,
          reorder_level: true,
          cost_per_unit: true,
          created_at: true,
          updated_at: true,
          is_deleted: true
        }
      }),
      getSystemSettings()
    ]);
    const reservedByMaterial = await getActiveCateringReservationQuantities(
      prisma,
      materials.map((material) => material.id)
    );
    const thresholdMultiplier = systemSettings.low_stock_alerts_enabled
      ? systemSettings.low_stock_threshold_percent / 100
      : 0;

    res.json({
      materials: materials
        .map((material) => {
          const reserved_quantity = reservedByMaterial.get(material.id) ?? 0;
          const available_quantity = calculateAvailableQuantity(Number(material.current_stock), reserved_quantity);
          return { ...material, reserved_quantity, available_quantity };
        })
        .filter((material) => material.available_quantity <= Number(material.reorder_level) * thresholdMultiplier)
    });
  } catch (error) {
    next(error);
  }
});

app.get("/api/inventory/materials/summary", async (_req, res, next) => {
  try {
    await ensureBeverageStockMaterials();
    const materials = await prisma.rawMaterial.findMany({
      where: { is_deleted: false },
      orderBy: { name: "asc" },
      select: {
        id: true,
        name: true,
        category: true,
        unit: true,
        current_stock: true
      }
    });
    const reservedByMaterial = await getActiveCateringReservationQuantities(
      prisma,
      materials.map((material) => material.id)
    );

    const stockSummary = materials.map((material) => {
      const reserved_quantity = reservedByMaterial.get(material.id) ?? 0;
      return {
        id: material.id,
        name: material.name,
        category: material.category,
        unit: material.unit,
        current_stock: material.current_stock,
        reserved_quantity,
        available_quantity: calculateAvailableQuantity(Number(material.current_stock), reserved_quantity)
      };
    });

    res.json({
      materials: stockSummary,
      summary: stockSummary
    });
  } catch (error) {
    next(error);
  }
});

app.get("/api/inventory/reservations", async (req, res, next) => {
  try {
    const user = requireRole(req, res, ["admin", "inventory_manager"]);
    if (!user) return;

    const [dineInReservations, cateringReservations, recipeProducts, takeoutOrders] = await Promise.all([
      prisma.reservation.findMany({
        orderBy: [{ date: "desc" }, { time: "asc" }],
        take: 100,
        include: { unlimited_package: true }
      }),
      prisma.cateringReservation.findMany({
        orderBy: { event_date: "desc" },
        take: 100,
        include: {
          package: true,
          inquiry: true,
          ingredient_locks: {
            orderBy: { created_at: "asc" },
            include: { raw_material: { select: { id: true, name: true, unit: true } } }
          }
        }
      }),
      prisma.sellingProduct.findMany({
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
      }),
      prisma.takeoutOrder.findMany({
        where: {
          status: { in: ["pending_payment", "payment_failed", "pending_approval", "confirmed", "preparing", "ready"] },
          OR: [
            { payment_plan: "pay_at_pickup" },
            { payment_status: "paid" },
            { payment_expires_at: { gt: new Date() } }
          ]
        },
        orderBy: { created_at: "desc" },
        take: 100,
        include: {
          items: { orderBy: { created_at: "asc" } },
          ingredient_locks: {
            where: { is_released: false },
            orderBy: { created_at: "asc" },
            include: { raw_material: { select: { id: true, name: true, unit: true } } }
          }
        }
      })
    ]);

    const dineInIngredientRequirements = dineInReservations.map((reservation) => {
        const requirement = getReservationIngredientRequirements(
          Array.isArray(reservation.selected_products)
            ? reservation.selected_products as Array<{ product_id?: string | null; productId?: string | null; name?: string | null; quantity?: number | string | null }>
            : [],
          recipeProducts
        );
        const { ingredients, warnings } = requirement;
        const activeStatus = ["cancelled", "canceled", "rejected", "declined", "expired", "no-show", "no_show", "completed"].includes((reservation.status ?? "").toLowerCase())
          ? "Released"
          : "Reserved";

        return {
          id: reservation.id,
          type: "dine-in" as const,
          reference: reservation.booking_id,
          customer_name: reservation.customer_name,
          date: reservation.date,
          time: reservation.time,
          guests: reservation.party_size,
          status: reservation.status,
          menu: reservation.selected_products ?? [],
          ingredients: ingredients.map((ingredient) => ({
            material_id: ingredient.material_id,
            material: ingredient.material,
            quantity: ingredient.quantity,
            unit: ingredient.unit,
            status: activeStatus
          })),
          stock_note: warnings.length > 0
            ? warnings.join(" ")
            : ingredients.length > 0
              ? `Estimated recipe demand for ${ingredients.length} ingredient${ingredients.length === 1 ? "" : "s"}; dine-in stock is not yet locked.`
              : "No inventory recipe linked to the selected menu items."
        };
      });

    const reservations = [
      ...dineInIngredientRequirements,
      ...cateringReservations.map((reservation) => ({
        id: reservation.id,
        type: "catering" as const,
        reference: reservation.reservation_id ?? reservation.id,
        customer_name: reservation.customer_name ?? reservation.inquiry?.customer_name ?? "Unknown",
        date: reservation.event_date ?? reservation.confirmed_date,
        time: null,
        guests: reservation.headcount,
        status: reservation.status ?? "pending",
        menu: reservation.package?.name ?? reservation.inquiry?.package_type ?? "Catering package",
        ingredients: reservation.ingredient_locks.map((lock) => ({
          material_id: lock.raw_material_id,
          material: lock.raw_material.name,
          quantity: lock.reserved_quantity,
          unit: lock.unit,
          status: lock.is_released ? "Released" : "Reserved"
        })),
        stock_note: null
      })),
      ...takeoutOrders.map((order) => ({
        id: order.id,
        type: "takeout" as const,
        reference: order.order_number,
        customer_name: order.customer_name,
        date: order.created_at,
        time: null,
        guests: null,
        status: order.status,
        menu: order.items.map((item) => `${item.quantity} × ${item.name_snapshot}`),
        ingredients: order.ingredient_locks.map((lock) => ({
          material_id: lock.raw_material_id,
          material: lock.raw_material.name,
          quantity: lock.reserved_quantity,
          unit: lock.unit,
          status: "Reserved"
        })),
        stock_note: order.ingredient_locks.length ? null : "No inventory recipe linked to these items."
      }))
    ].sort((first, second) => new Date(second.date ?? 0).getTime() - new Date(first.date ?? 0).getTime());

    return res.json({ reservations });
  } catch (error) {
    return next(error);
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
        category: z.enum(["Beverage", "Raw Material"]).default("Raw Material"),
        unit: z.enum(["g", "ml", "piece", "sheet", "bottle", "cup"]),
        reorder_level: z.coerce.number().int().nonnegative(),
        cost_per_unit: z.coerce.number().finite().nonnegative()
      })
      .parse(req.body);

    const material = await prisma.rawMaterial.create({
      data: { ...body, current_stock: 0 }
    });
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
        category: z.enum(["Beverage", "Raw Material"]).default("Raw Material"),
        unit: z.enum(["g", "ml", "piece", "sheet", "bottle", "cup"]),
        reorder_level: z.coerce.number().int().nonnegative(),
        cost_per_unit: z.coerce.number().finite().nonnegative()
      })
      .parse(req.body);
    const material = await prisma.$transaction(async (tx) => {
      await lockMaterialForUpdate(tx, req.params.id);
      const current = await tx.rawMaterial.findFirst({
        where: { id: req.params.id, is_deleted: false }
      });
      if (!current) {
        throw new InventoryError("Material not found.", "MATERIAL_NOT_FOUND", 404);
      }

      if (body.unit !== current.unit) {
        const [batchCount, recipeCount, activeLockCount, movementCount, legacyTransactionCount] = await Promise.all([
          tx.materialBatch.count({ where: { raw_material_id: current.id } }),
          tx.recipeIngredient.count({ where: { raw_material_id: current.id } }),
          tx.cateringIngredientLock.count({ where: { raw_material_id: current.id, is_released: false } }),
          tx.inventoryMovement.count({ where: { raw_material_id: current.id } }),
          tx.inventoryTransaction.count({ where: { raw_material_id: current.id } })
        ]);

        if (
          Number(current.current_stock) !== 0 ||
          batchCount > 0 ||
          recipeCount > 0 ||
          activeLockCount > 0 ||
          movementCount > 0 ||
          legacyTransactionCount > 0
        ) {
          throw new InventoryError(
            "A material's base unit cannot change after it has stock, batches, recipes, reservations, or movement history.",
            "MATERIAL_UNIT_IN_USE"
          );
        }
      }

      return tx.rawMaterial.update({
        where: { id: req.params.id },
        data: body
      });
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
        cost_per_unit: z.coerce.number().finite().nonnegative()
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
        quantity: z.coerce.number().int().positive(),
        reference: z.string().optional(),
        reason: z.string().optional()
      })
      .parse(req.body);
    const material = await prisma.rawMaterial.findFirst({
      where: { id: req.params.id, is_deleted: false }
    });

    if (!material) {
      return res.status(404).json({ message: "Material not found" });
    }

    if (body.type === "add") {
      return res.status(400).json({ message: "Use Receive Stock to add inventory. A batch number, expiry date, quantity, and cost are required." });
    }

    const updatedMaterial = await prisma.$transaction(async (tx) => {
      const consumed = await consumeMaterialStock(tx, {
        raw_material_id: material.id,
        quantity: body.quantity,
        source_type: "inventory",
        source_reference: body.reference ?? `Manual use ${new Date().toISOString()}`,
        actor_id: user.sub,
        action: "Adjusted",
        note: body.reason ?? body.reference ?? "Manual stock use"
      });

      await tx.inventoryTransaction.create({
        data: {
          raw_material_id: material.id,
          transaction_type: "deduct",
          quantity: body.quantity,
          unit: material.unit,
          reference: body.reference ?? "Manual stock use",
          reason: body.reason,
          user_id: user.sub
        }
      });

      return consumed.material;
    });

    return res.json({ material: updatedMaterial });
  } catch (error) {
    return next(error);
  }
});

app.post("/api/inventory/stock-count", async (req, res, next) => {
  try {
    const user = requireRole(req, res, ["admin", "inventory_manager"]);

    if (!user) {
      return;
    }

    const body = z.object({
      raw_material_id: z.string().min(1),
      physical_count: z.coerce.number().int().finite().nonnegative(),
      reason: z.string().trim().min(1),
      batch_number: z.string().trim().min(1).optional(),
      expiration_date: z.string().optional(),
      cost_per_unit: z.coerce.number().finite().nonnegative().optional()
    }).parse(req.body);
    const result = await prisma.$transaction(async (tx) => {
      await lockMaterialForUpdate(tx, body.raw_material_id);
      const material = await tx.rawMaterial.findFirst({
        where: { id: body.raw_material_id, is_deleted: false }
      });

      if (!material) {
        throw new InventoryError("Material not found.", "MATERIAL_NOT_FOUND", 404);
      }

      validateInventoryCount(body.physical_count, material.unit);
      const onHand = Number(material.current_stock);
      const difference = body.physical_count - onHand;

      if (difference === 0) {
        return { material, adjusted: false, difference };
      }

      await assertBatchQuantitiesMatchOnHand(tx, material.id, material.name, onHand);
      const reservationQuantity = await getActiveCateringReservationQuantity(tx, material.id);

      if (difference < 0) {
        const quantity = Math.abs(difference);
        const consumed = await consumeMaterialStock(tx, {
          raw_material_id: material.id,
          quantity,
          source_type: "inventory",
          source_reference: `Stock count ${new Date().toISOString()}`,
          actor_id: user.sub,
          action: "Adjusted",
          note: body.reason
        });

        await tx.inventoryTransaction.create({
          data: {
            raw_material_id: material.id,
            transaction_type: "deduct",
            quantity,
            unit: material.unit,
            reference: `Stock count adjustment: ${body.reason}`,
            reason: "stock_count",
            user_id: user.sub
          }
        });

        return { material: consumed.material, adjusted: true, difference };
      }

      if (!body.batch_number || !body.expiration_date || body.cost_per_unit === undefined) {
        throw new InventoryError(
          "A positive stock-count adjustment needs a batch number, expiry date, and cost per unit.",
          "ADJUSTMENT_BATCH_REQUIRED"
        );
      }

      const expirationDate = new Date(body.expiration_date);
      if (!Number.isFinite(expirationDate.getTime())) {
        throw new InventoryError("Enter a valid batch expiry date.", "INVALID_EXPIRATION_DATE");
      }
      if (manilaDateKey(expirationDate) < manilaDateKey(new Date())) {
        throw new InventoryError("Expired stock cannot be added as usable inventory.", "EXPIRED_STOCK");
      }

      validateInventoryQuantity(difference, material.unit);
      const existingBatch = await tx.materialBatch.findUnique({
        where: {
          raw_material_id_batch_number: {
            raw_material_id: material.id,
            batch_number: body.batch_number
          }
        }
      });
      if (existingBatch) {
        throw new InventoryError("Batch number already exists for this material.", "BATCH_NUMBER_EXISTS", 409);
      }

      const batch = await tx.materialBatch.create({
        data: {
          raw_material_id: material.id,
          batch_number: body.batch_number,
          quantity: difference,
          remaining_quantity: difference,
          expiration_date: expirationDate,
          cost_per_unit: body.cost_per_unit,
          notes: `Stock count adjustment: ${body.reason}`
        }
      });
      const updatedMaterial = await tx.rawMaterial.update({
        where: { id: material.id },
        data: { current_stock: body.physical_count }
      });
      await createInventoryMovement(tx, {
        raw_material_id: material.id,
        batch_id: batch.id,
        source_type: "inventory",
        source_reference: `Stock count ${new Date().toISOString()}`,
        action: "Adjusted",
        quantity: difference,
        unit: material.unit,
        quantity_before: onHand,
        quantity_after: body.physical_count,
        reserved_before: reservationQuantity,
        reserved_after: reservationQuantity,
        actor_id: user.sub,
        note: body.reason
      });
      await tx.inventoryTransaction.create({
        data: {
          raw_material_id: material.id,
          batch_id: batch.id,
          transaction_type: "add",
          quantity: difference,
          unit: material.unit,
          reference: `Stock count adjustment: ${body.reason}`,
          reason: "stock_count",
          user_id: user.sub
        }
      });

      return { material: updatedMaterial, adjusted: true, difference, batch };
    });

    if (result.adjusted) {
      await captureInventorySnapshot();
    }

    return res.json(result);
  } catch (error) {
    return next(error);
  }
});

app.get("/api/inventory/movements", async (req, res, next) => {
  try {
    const user = requireRole(req, res, ["admin", "inventory_manager"]);

    if (!user) {
      return;
    }

    const query = z.object({
      materialId: z.string().optional(),
      booking: z.string().optional(),
      action: z.string().optional(),
      sourceType: z.enum(["dine-in", "catering", "POS", "unlimited", "inventory", "legacy"]).optional(),
      from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
      to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
      page: z.coerce.number().int().positive().default(1),
      limit: z.coerce.number().int().positive().max(100).default(50)
    }).parse(req.query);
    const today = manilaDateKey(new Date());
    const dateFrom = query.from ?? today;
    const dateTo = query.to ?? today;
    const legacyTransactionTypesByAction: Record<string, string[]> = {
      Received: ["receive", "received"],
      Reserved: ["reserve", "reserved"],
      Released: ["release", "released"],
      Used: ["deduct", "used"],
      Wasted: ["waste", "wasted"],
      Adjusted: ["adjust", "adjustment", "adjusted"]
    };
    const where: Prisma.InventoryMovementWhereInput = {
      raw_material_id: query.materialId,
      action: query.action
        ? {
            in: [
              query.action,
              ...(legacyTransactionTypesByAction[query.action] ?? []).map((type) => `Legacy: ${type}`)
            ]
          }
        : undefined,
      source_type: query.sourceType,
      source_reference: query.booking
        ? { contains: query.booking, mode: "insensitive" }
        : undefined,
      created_at: manilaDateRange(dateFrom, dateTo)
    };
    try {
      const [total, movements] = await prisma.$transaction([
        prisma.inventoryMovement.count({ where }),
        prisma.inventoryMovement.findMany({
          where,
          include: {
            raw_material: { select: { id: true, name: true, unit: true } },
            batch: { select: { id: true, batch_number: true, expiration_date: true } },
            actor: { select: { id: true, name: true } }
          },
          orderBy: [{ created_at: "desc" }, { id: "desc" }],
          skip: (query.page - 1) * query.limit,
          take: query.limit
        })
      ]);

      return res.json({
        movements,
        pagination: {
          page: query.page,
          limit: query.limit,
          total,
          pages: Math.ceil(total / query.limit)
        },
        dateRange: { from: dateFrom, to: dateTo }
      });
    } catch (error) {
      if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== "P2021") {
        throw error;
      }

      if (query.sourceType && query.sourceType !== "legacy") {
        return res.json({
          movements: [],
          pagination: { page: query.page, limit: query.limit, total: 0, pages: 0 },
          dateRange: { from: dateFrom, to: dateTo },
          legacyFallback: true,
          notice: "The inventory movement ledger table is not installed. Showing legacy inventory transactions where available."
        });
      }

      const legacyWhere: Prisma.InventoryTransactionWhereInput = {
        raw_material_id: query.materialId,
        reference: query.booking ? { contains: query.booking, mode: "insensitive" } : undefined,
        transaction_type: query.action
          ? { in: legacyTransactionTypesByAction[query.action] ?? [] }
          : undefined,
        created_at: manilaDateRange(dateFrom, dateTo)
      };
      const [total, transactions] = await prisma.$transaction([
        prisma.inventoryTransaction.count({ where: legacyWhere }),
        prisma.inventoryTransaction.findMany({
          where: legacyWhere,
          include: {
            raw_material: { select: { id: true, name: true, unit: true } },
            batch: { select: { id: true, batch_number: true, expiration_date: true } },
            user: { select: { id: true, name: true } }
          },
          orderBy: [{ created_at: "desc" }, { id: "desc" }],
          skip: (query.page - 1) * query.limit,
          take: query.limit
        })
      ]);
      const legacyAction = (type: string) => {
        switch (type.toLowerCase()) {
          case "receive":
          case "received":
            return "Received";
          case "reserve":
          case "reserved":
            return "Reserved";
          case "release":
          case "released":
            return "Released";
          case "deduct":
          case "used":
            return "Used";
          case "waste":
          case "wasted":
            return "Wasted";
          case "adjust":
          case "adjustment":
          case "adjusted":
            return "Adjusted";
          default:
            return `Legacy: ${type}`;
        }
      };
      const movements = transactions.map((transaction) => ({
        id: transaction.id,
        raw_material_id: transaction.raw_material_id,
        batch_id: transaction.batch_id,
        source_type: "legacy",
        source_reference: transaction.reference,
        action: legacyAction(transaction.transaction_type),
        quantity: transaction.quantity,
        unit: transaction.unit,
        quantity_before: null,
        quantity_after: null,
        reserved_before: null,
        reserved_after: null,
        actor_id: transaction.user_id,
        note: transaction.reason,
        created_at: transaction.created_at,
        raw_material: transaction.raw_material,
        batch: transaction.batch,
        actor: transaction.user
      }));

      return res.json({
        movements,
        pagination: {
          page: query.page,
          limit: query.limit,
          total,
          pages: Math.ceil(total / query.limit)
        },
        dateRange: { from: dateFrom, to: dateTo },
        legacyFallback: true,
        notice: "Showing legacy inventory transactions because the inventory movement ledger migration has not been applied. Historical before/after stock values are unavailable."
      });
    }
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
        quantity: z.coerce.number().int().positive(),
        expiration_date: z.string().min(1),
        cost_per_unit: z.coerce.number().finite().nonnegative(),
        notes: z.string().optional()
      })
      .parse(req.body);

    if (!Number.isFinite(new Date(body.expiration_date).getTime())) {
      return res.status(400).json({ message: "Enter a valid batch expiry date." });
    }

    if (manilaDateKey(new Date(body.expiration_date)) < manilaDateKey(new Date())) {
      return res.status(400).json({ message: "Expired stock cannot be received as usable inventory." });
    }

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

    validateInventoryQuantity(body.quantity, material.unit);
    const [batch, updatedMaterial] = await prisma.$transaction(async (tx) => {
      await lockMaterialForUpdate(tx, material.id);
      const lockedMaterial = await tx.rawMaterial.findFirst({
        where: { id: material.id, is_deleted: false }
      });

      if (!lockedMaterial) {
        throw new InventoryError("Material not found.", "MATERIAL_NOT_FOUND", 404);
      }

      const quantityBefore = Number(lockedMaterial.current_stock);
      await assertBatchQuantitiesMatchOnHand(
        tx,
        lockedMaterial.id,
        lockedMaterial.name,
        quantityBefore
      );
      const reservedBefore = await getActiveCateringReservationQuantity(tx, material.id);
      const created = await tx.materialBatch.create({
        data: {
          raw_material_id: body.raw_material_id,
          batch_number: body.batch_number,
          quantity: body.quantity,
          remaining_quantity: body.quantity,
          expiration_date: new Date(body.expiration_date),
          cost_per_unit: body.cost_per_unit,
          notes: body.notes
        },
        include: { raw_material: true }
      });

      const updated = await tx.rawMaterial.update({
        where: { id: material.id },
        data: { current_stock: quantityBefore + body.quantity }
      });

      await createInventoryMovement(tx, {
        raw_material_id: material.id,
        batch_id: created.id,
        source_type: "inventory",
        source_reference: body.batch_number,
        action: "Received",
        quantity: body.quantity,
        unit: material.unit,
        quantity_before: quantityBefore,
        quantity_after: quantityBefore + body.quantity,
        reserved_before: reservedBefore,
        reserved_after: reservedBefore,
        actor_id: user.sub,
        note: body.notes ?? `Received batch ${body.batch_number}`
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

    let snapshotWarning: string | undefined;
    try {
      await captureInventorySnapshot();
    } catch (error) {
      console.error("Batch was received, but the inventory snapshot could not be refreshed:", error);
      snapshotWarning = "The batch was received and stock was updated, but the inventory snapshot could not be refreshed.";
    }

    return res.status(201).json({ batch, material: updatedMaterial, warning: snapshotWarning });
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
        quantity: z.coerce.number().int().positive(),
        reason: z.enum(["spoilage", "expired", "prep_waste", "damaged", "other"]),
        notes: z.string().trim().min(1),
        batch_id: z.string().optional(),
        booking_type: z.enum(["dine-in", "catering"]).optional(),
        booking_reference: z.string().min(1).optional()
      })
      .parse(req.body);

    if (Boolean(body.booking_type) !== Boolean(body.booking_reference)) {
      return res.status(400).json({ message: "Booking type and booking reference must be provided together." });
    }

    const material = await prisma.rawMaterial.findFirst({
      where: { id: body.raw_material_id, is_deleted: false }
    });

    if (!material) {
      return res.status(404).json({ message: "Material not found" });
    }

    const result = await prisma.$transaction(async (tx) => {
      let linkedReservation:
        | {
            id: string;
            reservation_id: string | null;
            status: string | null;
            ingredient_locks: Array<{ id: string; reserved_quantity: unknown }>;
          }
        | undefined;

      if (body.booking_reference) {
        if (body.booking_type !== "catering") {
          throw new InventoryError(
            "Booking-linked waste can currently be recorded for catering reservations only.",
            "BOOKING_TYPE_UNSUPPORTED",
            409
          );
        }

        const reservationIdentity = await tx.cateringReservation.findFirst({
          where: {
            OR: [{ id: body.booking_reference }, { reservation_id: body.booking_reference }]
          },
          select: { id: true }
        });
        if (!reservationIdentity) {
          throw new InventoryError(
            "The linked catering booking was not found.",
            "BOOKING_NOT_FOUND",
            404
          );
        }
        await lockCateringReservationForUpdate(tx, reservationIdentity.id);
        linkedReservation = await tx.cateringReservation.findFirst({
          where: {
            id: reservationIdentity.id
          },
          include: {
            ingredient_locks: {
              where: { raw_material_id: material.id, is_released: false },
              orderBy: { created_at: "asc" },
              select: { id: true, reserved_quantity: true }
            }
          }
        }) ?? undefined;

        if (!linkedReservation || isTerminalReservationStatus(linkedReservation.status)) {
          throw new InventoryError(
            "The linked catering booking is missing or already closed.",
            "BOOKING_NOT_ACTIVE",
            409
          );
        }
        const reservedForBooking = linkedReservation.ingredient_locks.reduce(
          (total, lock) => total + Number(lock.reserved_quantity),
          0
        );
        if (reservedForBooking < body.quantity) {
          throw new InventoryError(
            `This booking has only ${Number(reservedForBooking.toFixed(3))} ${material.unit} of ${material.name} reserved.`,
            "INSUFFICIENT_BOOKING_RESERVATION",
            409
          );
        }
      }

      const consumed = linkedReservation
        ? await wasteCateringReservationIngredients(tx, {
            reservationId: linkedReservation.id,
            materialId: material.id,
            quantity: body.quantity,
            bookingReference: linkedReservation.reservation_id ?? linkedReservation.id,
            actorId: user.sub,
            reason: `${body.reason}: ${body.notes}`,
            batchId: body.batch_id
          })
        : await consumeMaterialStock(tx, {
            raw_material_id: material.id,
            quantity: body.quantity,
            source_type: "inventory",
            source_reference: body.batch_id ?? body.reason,
            actor_id: user.sub,
            action: "Wasted",
            batch_id: body.batch_id,
            note: `${body.reason}: ${body.notes}`
          });

      const reasonLabels: Record<string, string> = {
        spoilage: "Spoilage",
        expired: "Expired",
        prep_waste: "Prep waste",
        damaged: "Damaged",
        other: "Other"
      };

      const transactions = await Promise.all(
        consumed.allocations.map((entry) =>
          tx.inventoryTransaction.create({
            data: {
              raw_material_id: material.id,
              batch_id: entry.batchId,
              transaction_type: "waste",
              quantity: entry.quantity,
              unit: material.unit,
              reference: body.booking_reference
                ? `Booking ${body.booking_reference}: ${body.notes}`
                : body.notes,
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

      return { material: consumed.material, transactions };
    });

    await captureInventorySnapshot();

    return res.status(201).json(result);
  } catch (error) {
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
    await ensureBeverageStockMaterials();
    const [materials, products] = await Promise.all([
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
      })
    ]);
    const reservedByMaterial = await getActiveCateringReservationQuantities(
      prisma,
      materials.map((material) => material.id)
    );
    const availableByMaterial = new Map(
      materials.map((material) => [
        material.id,
        calculateAvailableQuantity(
          Number(material.current_stock),
          reservedByMaterial.get(material.id) ?? 0
        )
      ])
    );
    const nonBeverageProducts = products.filter((product) => product.category.toLowerCase() !== "beverage");
    const productsWithYield = nonBeverageProducts.map((product) => {
      const ingredients = product.recipes[0]?.recipe_ingredients ?? [];
      const calculations = ingredients.map((ingredient) => {
        const material = ingredient.raw_material;
        const currentStock = availableByMaterial.get(material.id) ?? 0;
        const unitIsValid = inventoryUnitsMatch(ingredient.unit, material.unit);
        const requiredPerPortion = Number(ingredient.quantity_per_yield);

        return {
          ingredient: material.name,
          unit: material.unit,
          currentStock,
          requiredPerPortion,
          maxPortions: unitIsValid && requiredPerPortion > 0
            ? Math.floor(currentStock / requiredPerPortion)
            : 0,
          unitMismatch: unitIsValid
            ? null
            : `Recipe uses ${ingredient.unit}; ${material.name} is stocked in ${material.unit}.`
        };
      });
      const limiting =
        calculations.length > 0
          ? calculations.reduce((lowest, item) => (item.maxPortions < lowest.maxPortions ? item : lowest))
          : {
              ingredient: "No recipe",
              unit: "",
              currentStock: 0,
              requiredPerPortion: 0,
              maxPortions: 0,
              unitMismatch: "No recipe is linked to this product."
            };
      const recipeWarnings = calculations
        .map((item) => item.unitMismatch)
        .filter((warning): warning is string => Boolean(warning));

      return {
        id: product.id,
        name: product.name,
        category: product.category,
        maxPortions: Math.max(limiting.maxPortions, 0),
        limitingIngredient: limiting.ingredient,
        limitingStock: limiting.currentStock,
        limitingUnit: limiting.unit,
        requiredPerPortion: limiting.requiredPerPortion,
        potentialRevenue: Math.max(limiting.maxPortions, 0) * Number(product.price),
        recipeWarnings
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

type ProductStockSource = {
  name: string;
  category: string;
  recipes: Array<{
    recipe_ingredients: Array<{
      quantity_per_yield: unknown;
      unit: string;
      raw_material: { id: string; unit: string; current_stock: unknown };
    }>;
  }>;
};

async function getAvailableProductStocks(products: ProductStockSource[]) {
  const ingredientMaterials = products.flatMap((product) =>
    (product.recipes[0]?.recipe_ingredients ?? []).map((ingredient) => ingredient.raw_material)
  );
  const beverageNames = products
    .filter((product) => product.category.toLowerCase() === "beverage" && (product.recipes[0]?.recipe_ingredients.length ?? 0) === 0)
    .map((product) => getBeverageStockMaterialName(product.name));
  const beverageMaterials = beverageNames.length > 0
    ? await prisma.rawMaterial.findMany({
        where: { name: { in: beverageNames }, is_deleted: false },
        select: { id: true, name: true, unit: true, current_stock: true }
      })
    : [];
  const materialByName = new Map(beverageMaterials.map((material) => [material.name, material]));
  const materialIds = Array.from(new Set([
    ...ingredientMaterials.map((material) => material.id),
    ...beverageMaterials.map((material) => material.id)
  ]));
  const reservedByMaterial = materialIds.length > 0
    ? await getActiveCateringReservationQuantities(prisma, materialIds)
    : new Map<string, number>();

  return new Map(products.map((product) => {
    const ingredients = product.recipes[0]?.recipe_ingredients ?? [];

    if (product.category.toLowerCase() === "beverage" && ingredients.length === 0) {
      const material = materialByName.get(getBeverageStockMaterialName(product.name));
      const available = material
        ? calculateAvailableQuantity(
            Number(material.current_stock),
            reservedByMaterial.get(material.id) ?? 0
          )
        : 0;
      return [product, Math.max(available, 0)];
    }

    if (ingredients.length === 0 || ingredients.some((ingredient) =>
      !inventoryUnitsMatch(ingredient.unit, ingredient.raw_material.unit)
    )) {
      return [product, 0];
    }

    const requiredByMaterial = new Map<string, { currentStock: number; requiredPerProduct: number }>();
    for (const ingredient of ingredients) {
      const material = ingredient.raw_material;
      const required = Number(ingredient.quantity_per_yield);
      const existing = requiredByMaterial.get(material.id);
      requiredByMaterial.set(material.id, {
        currentStock: calculateAvailableQuantity(
          Number(material.current_stock),
          reservedByMaterial.get(material.id) ?? 0
        ),
        requiredPerProduct: (existing?.requiredPerProduct ?? 0) + required
      });
    }

    const stock = requiredByMaterial.size > 0
      ? Math.floor(Math.min(...Array.from(requiredByMaterial.values()).map((entry) => entry.currentStock / entry.requiredPerProduct)))
      : 0;
    return [product, Math.max(stock, 0)];
  }));
}

type TakeoutLineInput = { product_id: string; quantity: number };

async function getTakeoutRequirements(
  tx: Prisma.TransactionClient,
  requestedItems: TakeoutLineInput[]
) {
  const products = await tx.sellingProduct.findMany({
    where: {
      id: { in: requestedItems.map((item) => item.product_id) },
      is_deleted: false
    },
    include: {
      recipes: {
        take: 1,
        include: {
          recipe_ingredients: {
            include: { raw_material: true }
          }
        }
      }
    }
  });
  const productsById = new Map(products.map((product) => [product.id, product]));
  const missing = requestedItems.find((item) => !productsById.has(item.product_id));
  if (missing) {
    throw new InventoryError("One or more products are no longer available.", "PRODUCT_NOT_FOUND", 409);
  }

  const needsByMaterial = new Map<string, {
    raw_material_id: string;
    material_name: string;
    quantity: number;
    unit: string;
  }>();

  for (const item of requestedItems) {
    const product = productsById.get(item.product_id);
    if (!product || !product.is_available) {
      throw new InventoryError("A selected product is marked unavailable.", "PRODUCT_UNAVAILABLE", 409);
    }
    const ingredients = product.recipes[0]?.recipe_ingredients ?? [];

    if (product.category.toLowerCase() === "beverage" && ingredients.length === 0) {
      const material = await tx.rawMaterial.findFirst({
        where: { name: getBeverageStockMaterialName(product.name), is_deleted: false }
      });
      if (!material) {
        throw new InventoryError(`${product.name} is out of stock.`, "PRODUCT_OUT_OF_STOCK", 409);
      }
      const existing = needsByMaterial.get(material.id);
      needsByMaterial.set(material.id, {
        raw_material_id: material.id,
        material_name: material.name,
        quantity: (existing?.quantity ?? 0) + item.quantity,
        unit: material.unit
      });
      continue;
    }

    if (ingredients.length === 0) {
      throw new InventoryError(
        `${product.name} has no inventory recipe and cannot be sold online.`,
        "RECIPE_MISSING",
        409
      );
    }

    for (const ingredient of ingredients) {
      const material = ingredient.raw_material;
      if (material.is_deleted) {
        throw new InventoryError(
          `${product.name} refers to an inactive ingredient and cannot be sold.`,
          "MATERIAL_NOT_FOUND",
          409
        );
      }
      if (!inventoryUnitsMatch(ingredient.unit, material.unit)) {
        throw new InventoryError(
          `${product.name} has an incompatible ingredient unit and cannot be sold online.`,
          "UNIT_MISMATCH",
          409
        );
      }
      const quantity = Number(ingredient.quantity_per_yield) * item.quantity;
      const existing = needsByMaterial.get(material.id);
      needsByMaterial.set(material.id, {
        raw_material_id: material.id,
        material_name: material.name,
        quantity: (existing?.quantity ?? 0) + quantity,
        unit: material.unit
      });
    }
  }

  return {
    productsById,
    needs: [...needsByMaterial.values()].sort((left, right) =>
      left.raw_material_id.localeCompare(right.raw_material_id)
    )
  };
}

async function generateTakeoutOrderNumber() {
  for (let attempt = 0; attempt < 10; attempt += 1) {
    const orderNumber = generateTransactionNumber().replace(/^KTN-/, "KTO-");
    const existing = await prisma.takeoutOrder.findUnique({
      where: { order_number: orderNumber },
      select: { id: true }
    });
    if (!existing) return orderNumber;
  }
  throw new Error("Unable to generate a unique pickup order number.");
}

function takeoutOrderSummary(order: {
  order_number: string;
  status: string;
  payment_plan: string;
  payment_status: string;
  subtotal: number;
  total: number;
  items: Array<{
    name_snapshot: string;
    quantity: number;
    unit_price: number;
    total_price: number;
  }>;
}) {
  return {
    order_number: order.order_number,
    status: order.status,
    payment_plan: order.payment_plan,
    payment_status: order.payment_status,
    subtotal: order.subtotal,
    total: order.total,
    items: order.items.map((item) => ({
      name: item.name_snapshot,
      quantity: item.quantity,
      unit_price: item.unit_price,
      total_price: item.total_price
    }))
  };
}

const takeoutOrderBodySchema = z.object({
  customer_name: z.string().trim().min(1).max(120),
  customer_phone: z.string().regex(/^\d{1,11}$/),
  payment_plan: z.enum(["pay_now", "pay_at_pickup"]),
  payment_method: z.enum(["gcash", "bank_transfer"]).optional(),
  idempotency_key: z.string().min(16).max(128),
  items: z.array(z.object({
    product_id: z.string().min(1),
    quantity: z.coerce.number().int().min(1).max(100)
  })).min(1).max(50).superRefine((items, context) => {
    if (new Set(items.map((item) => item.product_id)).size !== items.length) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Each product may only appear once in the cart."
      });
    }
  })
}).superRefine((body, context) => {
  if (body.payment_plan === "pay_now" && !body.payment_method) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["payment_method"],
      message: "Choose a payment method for online payment."
    });
  }
  if (body.payment_plan === "pay_at_pickup" && body.payment_method) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["payment_method"],
      message: "Choose the payment method at pickup."
    });
  }
});

app.get("/api/takeout/catalog", async (_req, res, next) => {
  try {
    const products = await prisma.sellingProduct.findMany({
      where: { is_deleted: false },
      orderBy: [{ category: "asc" }, { name: "asc" }],
      include: {
        unlimited_included_products: {
          select: { is_included: true }
        },
        recipes: {
          select: {
            recipe_ingredients: {
              select: {
                quantity_per_yield: true,
                unit: true,
                raw_material: { select: { id: true, unit: true, current_stock: true } }
              }
            }
          }
        }
      }
    });
    const availableStock = await getAvailableProductStocks(products);
    const productsWithImages = await Promise.all(products.map(async (product) => ({
      id: product.id,
      name: product.name,
      category: product.category,
      price: Number(product.price),
      description: product.description,
      image_url: await normalizeProductImage(product),
      is_available: product.is_available && (availableStock.get(product) ?? 0) > 0
    })));
    return res.json({ products: productsWithImages });
  } catch (error) {
    return next(error);
  }
});

app.post("/api/takeout/orders", async (req, res, next) => {
  try {
    const body = takeoutOrderBodySchema.parse(req.body);
    if (
      body.payment_plan === "pay_now" &&
      process.env.NODE_ENV === "production" &&
      PaymentGatewayFactory.isFakeGatewayActive()
    ) {
      return res.status(503).json({
        message: "Online payment is unavailable while TEST MODE is enabled."
      });
    }
    const existingOrder = await prisma.takeoutOrder.findUnique({
      where: { idempotency_key: body.idempotency_key },
      include: { items: { orderBy: { created_at: "asc" } } }
    });
    const requestItems = [...body.items].sort((a, b) => a.product_id.localeCompare(b.product_id));
    let order = existingOrder;
    let isNewOrder = false;

    if (existingOrder) {
      const existingItems = existingOrder.items
        .map((item) => ({ product_id: item.selling_product_id, quantity: item.quantity }))
        .sort((a, b) => (a.product_id ?? "").localeCompare(b.product_id ?? ""));
      const sameRequest = existingOrder.customer_name === body.customer_name &&
        existingOrder.customer_phone === body.customer_phone &&
        existingOrder.payment_plan === body.payment_plan &&
        existingOrder.payment_method === (body.payment_method ?? null) &&
        existingItems.length === requestItems.length &&
        existingItems.every((item, index) =>
          item.product_id === requestItems[index].product_id &&
          item.quantity === requestItems[index].quantity
        );
      if (!sameRequest) {
        return res.status(409).json({ message: "This checkout key is already tied to a different order." });
      }
      if (["cancelled", "expired"].includes(existingOrder.status)) {
        return res.status(409).json({ message: "This pickup order is no longer active. Start a new checkout." });
      }
      if (
        existingOrder.payment_plan === "pay_now" &&
        existingOrder.payment_expires_at &&
        existingOrder.payment_expires_at.getTime() <= Date.now()
      ) {
        return res.status(409).json({ message: "This payment session expired. Start a new checkout." });
      }
    } else {
      const orderNumber = await generateTakeoutOrderNumber();
      try {
        order = await prisma.$transaction(async (tx) => {
          const { productsById, needs } = await getTakeoutRequirements(tx, body.items);
          const reservedBeforeByMaterial = new Map<string, number>();

          for (const need of needs) {
            await lockMaterialForUpdate(tx, need.raw_material_id);
            const material = await tx.rawMaterial.findFirst({
              where: { id: need.raw_material_id, is_deleted: false }
            });
            if (!material) {
              throw new InventoryError("A required ingredient is no longer available.", "MATERIAL_NOT_FOUND", 409);
            }
            await assertBatchQuantitiesMatchOnHand(
              tx,
              material.id,
              material.name,
              Number(material.current_stock)
            );
            const reserved = await getActiveCateringReservationQuantity(tx, material.id);
            const available = calculateAvailableQuantity(Number(material.current_stock), reserved);
            assertEnoughAvailable(material.name, material.unit, need.quantity, available);
            reservedBeforeByMaterial.set(material.id, reserved);
          }

          const subtotal = Number(body.items.reduce((total, item) => {
            const product = productsById.get(item.product_id);
            return total + Number(product?.price ?? 0) * item.quantity;
          }, 0).toFixed(2));
          if (body.payment_plan === "pay_now" && subtotal <= 0) {
            throw new InventoryError("Online payment requires an order total greater than zero.", "INVALID_ORDER_TOTAL", 400);
          }
          const paymentExpiresAt = body.payment_plan === "pay_now"
            ? new Date(Date.now() + 60 * 60 * 1000)
            : null;
          const created = await tx.takeoutOrder.create({
            data: {
              order_number: orderNumber,
              idempotency_key: body.idempotency_key,
              customer_name: body.customer_name,
              customer_phone: body.customer_phone,
              status: body.payment_plan === "pay_now" ? "pending_payment" : "pending_approval",
              payment_plan: body.payment_plan,
              payment_status: body.payment_plan === "pay_now" ? "pending" : "unpaid",
              payment_method: body.payment_method ?? null,
              payment_expires_at: paymentExpiresAt,
              subtotal,
              total: subtotal,
              items: {
                create: body.items.map((item) => {
                  const product = productsById.get(item.product_id)!;
                  const unitPrice = Number(product.price);
                  return {
                    selling_product_id: product.id,
                    name_snapshot: product.name,
                    quantity: item.quantity,
                    unit_price: unitPrice,
                    total_price: Number((unitPrice * item.quantity).toFixed(2))
                  };
                })
              },
              ingredient_locks: {
                create: needs.map((need) => ({
                  raw_material_id: need.raw_material_id,
                  reserved_quantity: need.quantity,
                  unit: need.unit
                }))
              }
            },
            include: { items: { orderBy: { created_at: "asc" } } }
          });

          for (const need of needs) {
            const reservedBefore = reservedBeforeByMaterial.get(need.raw_material_id) ?? 0;
            await recordReservationMovement(tx, {
              raw_material_id: need.raw_material_id,
              quantity: need.quantity,
              unit: need.unit,
              source_type: "takeout",
              source_reference: created.order_number,
              action: "Reserved",
              reserved_before: reservedBefore,
              reserved_after: reservedBefore + need.quantity,
              note: "Pickup order accepted"
            });
          }
          return created;
        });
        isNewOrder = true;
      } catch (error) {
        if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== "P2002") {
          throw error;
        }
        order = await prisma.takeoutOrder.findUnique({
          where: { idempotency_key: body.idempotency_key },
          include: { items: { orderBy: { created_at: "asc" } } }
        });
        if (!order) throw error;
        const racedItems = order.items
          .map((item) => ({ product_id: item.selling_product_id, quantity: item.quantity }))
          .sort((a, b) => (a.product_id ?? "").localeCompare(b.product_id ?? ""));
        const sameRequest = order.customer_name === body.customer_name &&
          order.customer_phone === body.customer_phone &&
          order.payment_plan === body.payment_plan &&
          order.payment_method === (body.payment_method ?? null) &&
          racedItems.length === requestItems.length &&
          racedItems.every((item, index) =>
            item.product_id === requestItems[index].product_id &&
            item.quantity === requestItems[index].quantity
          );
        if (!sameRequest) {
          return res.status(409).json({ message: "This checkout key is already tied to a different order." });
        }
      }
    }

    if (!order) {
      return res.status(500).json({ message: "Pickup order could not be created." });
    }

    let payment: {
      success: boolean;
      referenceId: string;
      qrCode?: string;
      paymentUrl?: string;
      instructions?: string;
      expiresAt?: Date;
    } | null = null;
    if (order.payment_plan === "pay_now" && order.payment_status !== "paid") {
      const attempt = order.payment_status === "pending" && order.payment_attempt > 0
        ? order.payment_attempt
        : order.payment_attempt + 1;
      payment = await paymentService.createPaymentIntent({
        amount: order.total,
        paymentMethod: body.payment_method!,
        bookingId: order.order_number,
        reservationType: "takeout",
        purpose: "full_payment",
        idempotencyKey: `takeout:${order.id}:full:${attempt}`,
        description: `Pickup order ${order.order_number}`
      });
      if (!payment.success) {
        return res.status(503).json({ message: "Online payment could not be started. Please retry this checkout." });
      }
      order = await prisma.takeoutOrder.update({
        where: { id: order.id },
        data: {
          payment_attempt: attempt,
          payment_intent_reference_id: payment.referenceId,
          payment_expires_at: payment.expiresAt ?? order.payment_expires_at
        },
        include: { items: { orderBy: { created_at: "asc" } } }
      });
    }

    return res.status(isNewOrder ? 201 : 200).json({
      order: takeoutOrderSummary(order),
      payment
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ message: error.errors[0]?.message ?? "Invalid pickup order." });
    }
    if (error instanceof InventoryError) {
      return res.status(error.statusCode).json({ message: error.message, code: error.code });
    }
    return next(error);
  }
});

app.get("/api/takeout/orders/:orderNumber", async (req, res, next) => {
  try {
    const query = z.object({ phone: z.string().regex(/^\d{1,11}$/) }).parse(req.query);
    const order = await prisma.takeoutOrder.findFirst({
      where: {
        order_number: z.string().min(1).parse(req.params.orderNumber),
        customer_phone: query.phone
      },
      include: { items: { orderBy: { created_at: "asc" } } }
    });
    if (!order) {
      return res.status(404).json({ message: "Pickup order not found." });
    }
    return res.json({
      order: {
        ...takeoutOrderSummary(order),
        created_at: order.created_at,
        payment_expires_at: order.payment_expires_at,
        prepared_at: order.prepared_at,
        ready_at: order.ready_at,
        released_at: order.released_at
      }
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ message: error.errors[0]?.message ?? "Invalid pickup order lookup." });
    }
    return next(error);
  }
});

app.post("/api/takeout/orders/:orderNumber/cancel", async (req, res, next) => {
  try {
    const body = z.object({ phone: z.string().regex(/^\d{1,11}$/) }).parse(req.body);
    const order = await prisma.takeoutOrder.findFirst({
      where: {
        order_number: z.string().min(1).parse(req.params.orderNumber),
        customer_phone: body.phone
      },
      include: { items: { orderBy: { created_at: "asc" } } }
    });
    if (!order) {
      return res.status(404).json({ message: "Pickup order not found." });
    }

    const cancelled = await prisma.$transaction(async (tx) => {
      await tx.$queryRaw<Array<{ id: string }>>`
        SELECT id FROM takeout_orders WHERE id = ${order.id} FOR UPDATE
      `;
      const current = await tx.takeoutOrder.findUnique({
        where: { id: order.id },
        include: { ingredient_locks: { where: { is_released: false } } }
      });
      if (!current) {
        throw new InventoryError("Pickup order not found.", "ORDER_NOT_FOUND", 404);
      }
      if (current.status === "cancelled") return current;
      if (
        current.payment_plan !== "pay_at_pickup" ||
        current.payment_status !== "unpaid" ||
        !["pending_approval", "confirmed", "preparing", "ready"].includes(current.status)
      ) {
        throw new InventoryError(
          "Only unpaid pickup orders can be cancelled before handoff.",
          "ORDER_CANNOT_BE_CANCELLED",
          409
        );
      }

      for (const lock of [...current.ingredient_locks].sort((a, b) =>
        a.raw_material_id.localeCompare(b.raw_material_id)
      )) {
        await lockMaterialForUpdate(tx, lock.raw_material_id);
        const reservedBefore = await getActiveCateringReservationQuantity(tx, lock.raw_material_id);
        await tx.takeoutIngredientLock.update({
          where: { id: lock.id },
          data: { is_released: true, released_at: new Date() }
        });
        const reservedAfter = await getActiveCateringReservationQuantity(tx, lock.raw_material_id);
        await recordReservationMovement(tx, {
          raw_material_id: lock.raw_material_id,
          quantity: Number(lock.reserved_quantity),
          unit: lock.unit,
          source_type: "takeout",
          source_reference: current.order_number,
          action: "Released back",
          reserved_before: reservedBefore,
          reserved_after: reservedAfter,
          note: "Pickup order cancelled before handoff"
        });
      }

      await tx.takeoutOrder.update({
        where: { id: current.id },
        data: { status: "cancelled", cancelled_at: new Date() }
      });
      return current;
    });
    return res.json({
      message: "Pickup order cancelled.",
      order: { order_number: cancelled.order_number, status: "cancelled" }
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ message: error.errors[0]?.message ?? "Invalid cancellation request." });
    }
    if (error instanceof InventoryError) {
      return res.status(error.statusCode).json({ message: error.message, code: error.code });
    }
    return next(error);
  }
});

app.get("/api/admin/takeout/orders", async (req, res, next) => {
  try {
    if (!requireRole(req, res, ["admin", "cashier", "chef", "receptionist"])) return;
    const status = z.string().optional().parse(req.query.status);
    const orders = await prisma.takeoutOrder.findMany({
      where: status ? { status } : { status: { notIn: ["cancelled", "expired"] } },
      orderBy: { created_at: "asc" },
      include: { items: { orderBy: { created_at: "asc" } } }
    });
    return res.json({
      orders: orders.map((order) => ({
        ...takeoutOrderSummary(order),
        customer_name: order.customer_name,
        customer_phone: order.customer_phone,
        payment_method: order.payment_method,
        payment_transaction_id: order.payment_transaction_id,
        created_at: order.created_at,
        prepared_at: order.prepared_at,
        ready_at: order.ready_at,
        released_at: order.released_at
      }))
    });
  } catch (error) {
    return next(error);
  }
});

app.patch("/api/admin/takeout/orders/:orderNumber/status", async (req, res, next) => {
  try {
    const user = requireRole(req, res, ["admin", "cashier", "chef"]);
    if (!user) return;
    const body = z.object({
      status: z.enum(["confirmed", "preparing", "ready", "released"]),
      payment_method: z.enum(["cash", "gcash", "bank_transfer"]).optional()
    }).parse(req.body);
    const orderNumber = z.string().min(1).parse(req.params.orderNumber);
    const updated = await prisma.$transaction(async (tx) => {
      await tx.$queryRaw<Array<{ id: string }>>`
        SELECT id FROM takeout_orders WHERE order_number = ${orderNumber} FOR UPDATE
      `;
      const order = await tx.takeoutOrder.findUnique({
        where: { order_number: orderNumber },
        include: { ingredient_locks: { where: { is_released: false } } }
      });
      if (!order) {
        throw new InventoryError("Pickup order not found.", "ORDER_NOT_FOUND", 404);
      }
      if (
        order.payment_plan === "pay_now" &&
        order.payment_status !== "paid"
      ) {
        throw new InventoryError("Online payment must be confirmed before preparation.", "PAYMENT_REQUIRED", 409);
      }
      if (
        body.status === "released" &&
        order.payment_plan === "pay_at_pickup" &&
        order.payment_status !== "paid" &&
        !body.payment_method
      ) {
        throw new InventoryError("Record the payment method before handing over this order.", "PAYMENT_METHOD_REQUIRED", 400);
      }
      const expectedStatus = body.status === "confirmed"
        ? "pending_approval"
        : body.status === "preparing"
          ? "confirmed"
        : body.status === "ready"
          ? "preparing"
          : "ready";
      if (order.status !== expectedStatus) {
        throw new InventoryError(
          `Cannot move this pickup order from ${order.status} to ${body.status}.`,
          "INVALID_ORDER_TRANSITION",
          409
        );
      }

      if (body.status === "released") {
        for (const lock of [...order.ingredient_locks].sort((a, b) =>
          a.raw_material_id.localeCompare(b.raw_material_id)
        )) {
          await consumeMaterialStock(tx, {
            raw_material_id: lock.raw_material_id,
            quantity: Number(lock.reserved_quantity),
            source_type: "takeout",
            source_reference: order.order_number,
            actor_id: user.sub,
            note: "Pickup order handed to customer",
            action: "Released",
            releaseReservedQuantity: Number(lock.reserved_quantity)
          });
          await tx.takeoutIngredientLock.update({
            where: { id: lock.id },
            data: { is_released: true, released_at: new Date() }
          });
        }
      }

      return tx.takeoutOrder.update({
        where: { id: order.id },
        data: {
          status: body.status,
          ...(body.status === "released" && order.payment_plan === "pay_at_pickup" && order.payment_status !== "paid"
            ? {
                payment_status: "paid",
                payment_method: body.payment_method,
                paid_at: new Date()
              }
            : {}),
          prepared_at: body.status === "preparing" ? new Date() : order.prepared_at,
          ready_at: body.status === "ready" ? new Date() : order.ready_at,
          released_at: body.status === "released" ? new Date() : order.released_at
        },
        include: { items: { orderBy: { created_at: "asc" } } }
      });
    });
    return res.json({ order: takeoutOrderSummary(updated) });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ message: error.errors[0]?.message ?? "Invalid order status." });
    }
    if (error instanceof InventoryError) {
      return res.status(error.statusCode).json({ message: error.message, code: error.code });
    }
    return next(error);
  }
});

app.post("/api/reservations/dine-in/availability", async (req, res, next) => {
  try {
    const body = z.object({
      selected_products: z.array(z.object({
        product_id: z.string().min(1),
        quantity: z.coerce.number().int().min(1)
      })).max(200).default([])
    }).parse(req.body);
    const selectedQuantityByProduct = new Map<string, number>();
    body.selected_products.forEach((item) => {
      selectedQuantityByProduct.set(
        item.product_id,
        (selectedQuantityByProduct.get(item.product_id) ?? 0) + item.quantity
      );
    });

    const products = await prisma.sellingProduct.findMany({
      where: { is_deleted: false },
      orderBy: [{ category: "asc" }, { name: "asc" }],
      include: {
        recipes: {
          take: 1,
          include: {
            recipe_ingredients: {
              include: {
                raw_material: {
                  select: {
                    id: true,
                    unit: true,
                    current_stock: true,
                    batches: {
                      where: { is_disposed: false },
                      select: { remaining_quantity: true, expiration_date: true }
                    }
                  }
                }
              }
            }
          }
        }
      }
    });
    const productNeeds = new Map<string, Map<string, number>>();
    const materialById = new Map<string, {
      id: string;
      unit: string;
      current_stock: unknown;
      batches: Array<{ remaining_quantity: unknown; expiration_date: Date | null }>;
    }>();

    for (const product of products) {
      const ingredients = product.recipes[0]?.recipe_ingredients ?? [];
      if (!product.is_available || ingredients.length === 0) continue;
      const needs = new Map<string, number>();
      let validRecipe = true;
      for (const ingredient of ingredients) {
        const material = ingredient.raw_material;
        materialById.set(material.id, material);
        if (!inventoryUnitsMatch(ingredient.unit, material.unit)) {
          validRecipe = false;
          break;
        }
        const quantity = Number(ingredient.quantity_per_yield);
        needs.set(material.id, (needs.get(material.id) ?? 0) + quantity);
      }
      if (validRecipe && needs.size > 0) {
        productNeeds.set(product.id, needs);
      }
    }

    const materialIds = [...materialById.keys()];
    const reservedByMaterial = materialIds.length > 0
      ? await getActiveCateringReservationQuantities(prisma, materialIds)
      : new Map<string, number>();
    const availableByMaterial = new Map<string, number>();
    const now = new Date();
    for (const [materialId, material] of materialById) {
      const batches = material.batches;
      const onHand = batches.length > 0
        ? batches
            .filter((batch) => !batch.expiration_date || batch.expiration_date >= now)
            .reduce((total, batch) => total + Number(batch.remaining_quantity), 0)
        : Number(material.current_stock);
      availableByMaterial.set(
        materialId,
        Math.max(0, onHand - (reservedByMaterial.get(materialId) ?? 0))
      );
    }

    const demandByMaterial = new Map<string, number>();
    for (const [productId, quantity] of selectedQuantityByProduct) {
      const needs = productNeeds.get(productId);
      if (!needs) continue;
      for (const [materialId, perItem] of needs) {
        demandByMaterial.set(
          materialId,
          (demandByMaterial.get(materialId) ?? 0) + perItem * quantity
        );
      }
    }

    const availability = products.map((product) => {
      const needs = productNeeds.get(product.id);
      const selectedQuantity = selectedQuantityByProduct.get(product.id) ?? 0;
      if (!needs || !product.is_available) {
        return {
          product_id: product.id,
          available: false,
          can_add: false,
          maximum_quantity: 0
        };
      }

      let maximumQuantity = Number.POSITIVE_INFINITY;
      for (const [materialId, perItem] of needs) {
        const otherDemand = (demandByMaterial.get(materialId) ?? 0) - perItem * selectedQuantity;
        const remaining = (availableByMaterial.get(materialId) ?? 0) - otherDemand;
        maximumQuantity = Math.min(maximumQuantity, Math.floor(remaining / perItem));
      }
      const safeMaximum = Number.isFinite(maximumQuantity) ? Math.max(0, maximumQuantity) : 0;
      return {
        product_id: product.id,
        available: safeMaximum > 0 && selectedQuantity <= safeMaximum,
        can_add: safeMaximum > selectedQuantity,
        maximum_quantity: safeMaximum
      };
    });

    return res.json({ availability, checked_at: now.toISOString() });
  } catch (error) {
    return next(error);
  }
});

app.get("/api/products", async (_req, res, next) => {
  try {
    // Lightweight product list for unauthenticated customer requests
    const requestingUser = getUserFromRequest(_req);

    if (!requestingUser) {
      await ensureBeverageStockMaterials();
      const products = await prisma.sellingProduct.findMany({
        where: { is_deleted: false },
        orderBy: [{ category: "asc" }, { name: "asc" }],
        include: {
          recipes: {
            select: {
              recipe_ingredients: {
                select: {
                  quantity_per_yield: true,
                  unit: true,
                  raw_material: {
                    select: { id: true, unit: true, current_stock: true }
                  }
                }
              }
            }
          }
        }
      });
      const availableStockByProduct = await getAvailableProductStocks(products);

      const productsWithImageUrls = await Promise.all(
        products.map(async (product) => {
          const imageUrl = await normalizeProductImage(product);
          return {
            id: product.id,
            name: product.name,
            category: product.category,
            price: product.price,
            is_available: product.is_available,
            description: product.description,
            image_url: imageUrl,
            imageUrl
          };
        })
      );

      return res.json({ products: productsWithImageUrls });
    }

    // Authenticated/staff requests: include recipes for inventory management
    await ensureBeverageStockMaterials();
    const products = await prisma.sellingProduct.findMany({
      where: { is_deleted: false },
      orderBy: [{ category: "asc" }, { name: "asc" }],
      include: {
        unlimited_included_products: {
          select: { is_included: true }
        },
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
    const availableStockByProduct = await getAvailableProductStocks(products);

    const productsWithImageUrls = await Promise.all(
      products.map(async (product) => {
        const imageUrl = await normalizeProductImage(product);

        return {
          ...product,
          is_included: product.unlimited_included_products[0]?.is_included ?? false,
          cart_compatibility: {
            a_la_carte: getProductCartCompatibility({
              name: product.name,
              category: product.category,
              is_included: product.unlimited_included_products[0]?.is_included ?? false,
              is_sold_a_la_carte: product.is_sold_a_la_carte
            }, "a_la_carte"),
            unlimited: getProductCartCompatibility({
              name: product.name,
              category: product.category,
              is_included: product.unlimited_included_products[0]?.is_included ?? false,
              is_sold_a_la_carte: product.is_sold_a_la_carte
            }, "unlimited")
          },
          image_url: imageUrl,
          imageUrl,
          available_stock: availableStockByProduct.get(product) ?? 0
        };
      })
    );

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

    let imageUrl: string | null = body.image_url ?? null;

    if (req.file) {
      const localUploadPath = path.join(uploadDir, req.file.filename);
      if (useSupabaseStorage && supabase && supabaseStorageBucket) {
        const supabasePath = `products/${req.file.filename}`;
        imageUrl = await uploadFileToSupabase(localUploadPath, supabasePath);
      } else {
        imageUrl = `/uploads/products/${req.file.filename}`;
      }
    }

    const persistedImageValue = getPersistableImageValue(imageUrl);

    const shouldTrackBeverageStock = body.category.toLowerCase() === "beverage";

    const product = await prisma.$transaction(async (tx) => {
      const createdProduct = await tx.sellingProduct.create({
        data: {
          name: body.name,
          category: body.category,
          price: body.price,
          description: body.description || null,
          image_url: persistedImageValue,
          is_available: body.is_available ?? true,
          recipes: {
            create: {
              total_yield_quantity: 1,
              yield_unit: "serving"
            }
          }
        }
      });

      if (shouldTrackBeverageStock) {
        const beverageUnit = normalizedBeverageUnit(body.name);
        const materialName = getBeverageStockMaterialName(body.name);
        await tx.rawMaterial.upsert({
          where: { name: materialName },
          update: {
            is_deleted: false,
            unit: beverageUnit
          },
          create: {
            name: materialName,
            unit: beverageUnit,
            current_stock: 0,
            reorder_level: 0,
            cost_per_unit: 0
          }
        });
      }

      return createdProduct;
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
      const localUploadPath = path.join(uploadDir, req.file.filename);
      if (useSupabaseStorage && supabase && supabaseStorageBucket) {
        const supabasePath = `products/${req.file.filename}`;
        updateData.image_url = await uploadFileToSupabase(localUploadPath, supabasePath);
      } else {
        updateData.image_url = getPersistableImageValue(`/uploads/products/${req.file.filename}`);
      }
    } else if (body.image_url !== undefined) {
      updateData.image_url = getPersistableImageValue(body.image_url);
    }

    const product = await prisma.sellingProduct.update({
      where: { id: req.params.id },
      data: updateData
    });

    if (product.category.toLowerCase() === "beverage") {
      const beverageUnit = normalizedBeverageUnit(product.name);
      const materialName = getBeverageStockMaterialName(product.name);
      await prisma.rawMaterial.upsert({
        where: { name: materialName },
        update: {
          is_deleted: false,
          unit: beverageUnit
        },
        create: {
          name: materialName,
          unit: beverageUnit,
          current_stock: 0,
          reorder_level: 0,
          cost_per_unit: 0
        }
      });
    }

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

    const productsWithImageUrls = await Promise.all(
      products.map(async (product) => {
        const imageUrl = await normalizeProductImage(product);
        return {
          ...product,
          image_url: imageUrl,
          imageUrl
        };
      })
    );

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
    const tables = await prisma.table.findMany({ where: { is_archived: false }, orderBy: { table_number: "asc" } });
    res.json({ tables: tables.map((table) => ({ ...table, status: normalizeTableStatus(table.status) })) });
  } catch (error) {
    next(error);
  }
});

function normalizedBeverageUnit(name: string) {
  const normalizedName = name.toLowerCase();

  if (normalizedName.includes("tea") || normalizedName.includes("juice") || normalizedName.includes("shake")) {
    return "cup";
  }

  return "bottle";
}

function calculateIngredientCost(quantity: number, ingredientUnit: string, material: { unit: string; cost_per_unit: unknown }) {
  if (!inventoryUnitsMatch(ingredientUnit, material.unit)) {
    throw new InventoryError(
      `Recipe unit ${ingredientUnit} does not match ${material.unit} stock unit.`,
      "UNIT_MISMATCH",
      409
    );
  }

  return quantity * Number(material.cost_per_unit);
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
    status: recipe.status,
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
            quantity: z.coerce.number().int().positive(),
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

    const unitMismatch = body.ingredients.find((ingredient) =>
      ingredient.unit !== materialsById.get(ingredient.rawMaterialId)?.unit
    );
    if (unitMismatch) {
      return res.status(400).json({ message: "Recipe ingredient units must exactly match the material's base stock unit." });
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
            quantity: z.coerce.number().int().positive().optional(),
            quantity_per_yield: z.coerce.number().int().positive().optional(),
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

    const materialById = new Map((await prisma.rawMaterial.findMany({
      where: { id: { in: [...recipeIngredientMaterialIds] } },
      select: { id: true, unit: true }
    })).map((material) => [material.id, material.unit]));
    const unitMismatch = body.ingredients.find((ingredient) => {
      const materialId = ingredient.id
        ? recipe.recipe_ingredients.find((entry) => entry.id === ingredient.id)?.raw_material_id
        : ingredient.rawMaterialId;
      return !materialId || ingredient.unit !== materialById.get(materialId);
    });
    if (unitMismatch) {
      return res.status(400).json({ message: "Recipe ingredient units must exactly match the material's base stock unit." });
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

class InsufficientPosStockError extends Error {}

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
    if (body.transactionType !== "takeout") {
      return res.status(409).json({
        message: "Dine-in and Unlimited checkout must use the table service flow."
      });
    }
    const [products, systemSettings] = await Promise.all([
      prisma.sellingProduct.findMany({
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
      }),
      getSystemSettings()
    ]);
    const productsById = new Map(products.map((product) => [product.id, product]));
    const missingItem = body.items.find((item) => !productsById.has(item.productId));

    if (missingItem) {
      return res.status(400).json({ message: "One or more products were not found" });
    }

    const unavailableItem = body.items.find((item) => productsById.get(item.productId)?.is_available === false);

    if (unavailableItem) {
      return res.status(409).json({ message: `${productsById.get(unavailableItem.productId)?.name} is unavailable.` });
    }

    const subtotal = body.items.reduce((total, item) => {
      const product = productsById.get(item.productId);
      const unitPrice = item.unitPrice ?? Number(product?.price ?? 0);
      return total + unitPrice * item.quantity;
    }, 0);
    const tax = calculateTax(subtotal, systemSettings.tax_rate_percent);
    const total = Number((subtotal + tax).toFixed(2));

    if (body.paymentMethod === "cash" && Number(body.cashReceived ?? 0) < total) {
      return res.status(400).json({ message: "Cash received must be at least the total amount" });
    }

    const transactionNumber = await createUniqueTransactionNumber();
    const transaction = await prisma.$transaction(async (tx) => {
      const deductionsByMaterialId = new Map<string, {
        materialName: string;
        unit: string;
        quantity: number;
        productName: string;
      }>();

      for (const item of body.items) {
        const product = productsById.get(item.productId);
        const recipeIngredients = product?.recipes[0]?.recipe_ingredients ?? [];

        if (product && product.category.toLowerCase() === "beverage" && recipeIngredients.length === 0) {
          const beverageMaterial = await tx.rawMaterial.findFirst({
            where: { name: getBeverageStockMaterialName(product.name), is_deleted: false }
          });

          if (!beverageMaterial) {
            throw new InsufficientPosStockError(`${product.name} is out of stock.`);
          }

          const existing = deductionsByMaterialId.get(beverageMaterial.id);
          deductionsByMaterialId.set(beverageMaterial.id, {
            materialName: beverageMaterial.name,
            unit: beverageMaterial.unit,
            quantity: (existing?.quantity ?? 0) + item.quantity,
            productName: product.name
          });
          continue;
        }

        for (const ingredient of recipeIngredients) {
          const material = ingredient.raw_material;
          if (!inventoryUnitsMatch(ingredient.unit, material.unit)) {
            throw new InventoryError(
              `Recipe unit for ${material.name} does not match its stock unit.`,
              "UNIT_MISMATCH",
              409
            );
          }
          const deduction = Number(ingredient.quantity_per_yield) * item.quantity;
          const existing = deductionsByMaterialId.get(material.id);
          deductionsByMaterialId.set(material.id, {
            materialName: material.name,
            unit: material.unit,
            quantity: (existing?.quantity ?? 0) + deduction,
            productName: product?.name ?? material.name
          });
        }
      }

      for (const [materialId, deduction] of deductionsByMaterialId) {
        try {
          await consumeMaterialStock(tx, {
            raw_material_id: materialId,
            quantity: deduction.quantity,
            source_type: "POS",
            source_reference: transactionNumber,
            actor_id: user.sub,
            note: `POS ${body.transactionType} sale`,
            checkReservations: true
          });
        } catch (error) {
          if (error instanceof InventoryError) {
            throw new InsufficientPosStockError(
              `${deduction.productName} cannot be sold: ${error.message}`
            );
          }
          throw error;
        }

        await tx.inventoryTransaction.create({
            data: {
              raw_material_id: materialId,
              transaction_type: "deduct",
              quantity: deduction.quantity,
              unit: deduction.unit,
              reference: `POS Transaction ${transactionNumber}`,
              user_id: user.sub
            }
          });
      }

      return tx.posTransaction.create({
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
    });

    return res.status(201).json({ transaction });
  } catch (error) {
    if (error instanceof InsufficientPosStockError) {
      return res.status(409).json({ message: error.message });
    }

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
      if (Number(reservation.deposit_paid) > 0 && !(isFullyPaid && balanceAmount <= 0)) {
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
      tableId: typeof req.query.table_id === "string" ? req.query.table_id : undefined,
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

    const summary = await getUnifiedTransactionsFromService({
      date: typeof req.query.date === "string" ? req.query.date : undefined,
      from: typeof req.query.from === "string" ? req.query.from : undefined,
      to: typeof req.query.to === "string" ? req.query.to : undefined,
      limit: 1
    });

    return res.json(summary.summary);
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
      await tx.$queryRaw`SELECT "id" FROM "pos_transactions" WHERE "id" = ${transaction.id} FOR UPDATE`;
      const current = await tx.posTransaction.findUnique({ where: { id: transaction.id } });

      if (!current) {
        throw new InventoryError("Transaction not found.", "TRANSACTION_NOT_FOUND", 404);
      }
      if (current.status === "refunded") {
        throw new InventoryError("Transaction is already refunded.", "TRANSACTION_ALREADY_REFUNDED", 409);
      }

      const movements = await tx.inventoryMovement.findMany({
        where: {
          source_type: "POS",
          source_reference: current.transaction_number,
          action: "Used"
        },
        include: { batch: true, raw_material: true },
        orderBy: [{ raw_material_id: "asc" }, { batch_id: "asc" }, { created_at: "asc" }]
      });
      const hasTrackedItems = transaction.items.some(
        (item) =>
          item.selling_product.category.toLowerCase() === "beverage" ||
          (item.selling_product.recipes[0]?.recipe_ingredients.length ?? 0) > 0
      );

      if (hasTrackedItems && movements.length === 0) {
        throw new InventoryError(
          "This sale has no batch-level stock history, so it cannot be safely restocked by a refund. Reconcile its inventory first.",
          "REFUND_STOCK_HISTORY_MISSING",
          409
        );
      }

      const movementsByMaterial = new Map<string, typeof movements>();
      for (const movement of movements) {
        const rows = movementsByMaterial.get(movement.raw_material_id) ?? [];
        rows.push(movement);
        movementsByMaterial.set(movement.raw_material_id, rows);
      }

      for (const [materialId, materialMovements] of movementsByMaterial) {
        await lockMaterialForUpdate(tx, materialId);
        const material = await tx.rawMaterial.findFirst({
          where: { id: materialId, is_deleted: false }
        });
        if (!material) {
          throw new InventoryError("A sale ingredient no longer exists.", "MATERIAL_NOT_FOUND", 409);
        }
        await assertBatchQuantitiesMatchOnHand(
          tx,
          material.id,
          material.name,
          Number(material.current_stock)
        );
        const reserved = await getActiveCateringReservationQuantity(tx, material.id);
        let quantityBefore = Number(material.current_stock);

        for (const movement of materialMovements) {
          if (!movement.batch) {
            throw new InventoryError(
              `${material.name} sale history is missing its batch allocation. Reconcile inventory before refunding.`,
              "REFUND_BATCH_HISTORY_MISSING",
              409
            );
          }

          const quantity = Number(movement.quantity);
          const batch = await tx.materialBatch.findUnique({ where: { id: movement.batch.id } });
          if (!batch) {
            throw new InventoryError("A sale batch no longer exists.", "REFUND_BATCH_MISSING", 409);
          }
          await tx.materialBatch.update({
            where: { id: batch.id },
            data: {
              remaining_quantity: Number(batch.remaining_quantity) + quantity,
              is_disposed: false
            }
          });
          await createInventoryMovement(tx, {
            raw_material_id: material.id,
            batch_id: batch.id,
            source_type: "POS",
            source_reference: current.transaction_number,
            action: "Adjusted",
            quantity,
            unit: material.unit,
            quantity_before: quantityBefore,
            quantity_after: quantityBefore + quantity,
            reserved_before: reserved,
            reserved_after: reserved,
            actor_id: user.sub,
            note: "POS refund stock restoration"
          });
          await tx.inventoryTransaction.create({
            data: {
              raw_material_id: material.id,
              batch_id: batch.id,
              transaction_type: "add",
              quantity,
              unit: material.unit,
              reference: `Refund ${current.transaction_number}`,
              reason: "pos_refund",
              user_id: user.sub
            }
          });
          quantityBefore += quantity;
        }

        await tx.rawMaterial.update({
          where: { id: material.id },
          data: { current_stock: quantityBefore }
        });
      }

      return tx.posTransaction.update({
        where: { id: current.id },
        data: { status: "refunded" },
        include: {
          cashier: { select: { id: true, name: true, email: true } },
          items: { include: { selling_product: true } }
        }
      });
    });

    await captureInventorySnapshot();
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
      extension_minutes: 30,
      leftover_charge_percent: 100
    }
  });
}

type SystemSettingsRecord = {
  id: string;
  singleton_key: string;
  restaurant_name: string;
  timezone: string;
  currency: string;
  tax_rate_percent: number;
  receipt_paper_size: string;
  receipt_footer: string;
  max_party_size: number;
  reservation_duration_minutes: number;
  estimated_dining_duration_minutes: number;
  reservation_grace_period_minutes: number;
  minimum_catering_pax: number;
  default_downpayment_percent: number;
  auto_lock_catering_ingredients: boolean;
  release_catering_locks_on_completion: boolean;
  default_reorder_level: number;
  low_stock_threshold_percent: number;
  auto_reorder_enabled: boolean;
  email_notifications_enabled: boolean;
  sms_notifications_enabled: boolean;
  low_stock_alerts_enabled: boolean;
  updated_at: Date;
};

type SystemSettingsInput = Pick<
  SystemSettingsRecord,
  | "restaurant_name"
  | "timezone"
  | "currency"
  | "tax_rate_percent"
  | "receipt_paper_size"
  | "receipt_footer"
  | "max_party_size"
  | "reservation_duration_minutes"
  | "estimated_dining_duration_minutes"
  | "reservation_grace_period_minutes"
  | "minimum_catering_pax"
  | "default_downpayment_percent"
  | "auto_lock_catering_ingredients"
  | "release_catering_locks_on_completion"
  | "default_reorder_level"
  | "low_stock_threshold_percent"
  | "auto_reorder_enabled"
  | "email_notifications_enabled"
  | "sms_notifications_enabled"
  | "low_stock_alerts_enabled"
>;

const defaultSystemSettings: SystemSettingsInput = {
  restaurant_name: "Katana Sushi",
  timezone: "Asia/Manila",
  currency: "PHP",
  tax_rate_percent: 12,
  receipt_paper_size: "80mm",
  receipt_footer: "Thank you for dining with us!",
  max_party_size: 30,
  reservation_duration_minutes: 90,
  estimated_dining_duration_minutes: 120,
  reservation_grace_period_minutes: 15,
  minimum_catering_pax: 10,
  default_downpayment_percent: 50,
  auto_lock_catering_ingredients: true,
  release_catering_locks_on_completion: true,
  default_reorder_level: 10,
  low_stock_threshold_percent: 100,
  auto_reorder_enabled: false,
  email_notifications_enabled: true,
  sms_notifications_enabled: false,
  low_stock_alerts_enabled: true
};

function calculateTax(_subtotal: number, _taxRatePercent: number) {
  return 0;
}

async function ensureSystemSettingsRow() {
  await prisma.$executeRaw`ALTER TABLE system_settings ADD COLUMN IF NOT EXISTS receipt_paper_size TEXT DEFAULT '80mm'`;
  await prisma.$executeRaw`ALTER TABLE system_settings ADD COLUMN IF NOT EXISTS max_party_size INTEGER DEFAULT 30`;
  await prisma.$executeRaw`ALTER TABLE system_settings ADD COLUMN IF NOT EXISTS reservation_duration_minutes INTEGER DEFAULT 90`;
  await prisma.$executeRaw`ALTER TABLE system_settings ADD COLUMN IF NOT EXISTS reservation_grace_period_minutes INTEGER DEFAULT 15`;
  await prisma.$executeRaw`ALTER TABLE system_settings ADD COLUMN IF NOT EXISTS minimum_catering_pax INTEGER DEFAULT 10`;
  await prisma.$executeRaw`ALTER TABLE system_settings ADD COLUMN IF NOT EXISTS default_downpayment_percent DOUBLE PRECISION DEFAULT 50`;
  await prisma.$executeRaw`ALTER TABLE system_settings ADD COLUMN IF NOT EXISTS auto_lock_catering_ingredients BOOLEAN DEFAULT TRUE`;
  await prisma.$executeRaw`ALTER TABLE system_settings ADD COLUMN IF NOT EXISTS release_catering_locks_on_completion BOOLEAN DEFAULT TRUE`;
  await prisma.$executeRaw`ALTER TABLE system_settings ADD COLUMN IF NOT EXISTS default_reorder_level INTEGER DEFAULT 10`;
  await prisma.$executeRaw`ALTER TABLE system_settings ADD COLUMN IF NOT EXISTS low_stock_threshold_percent DOUBLE PRECISION DEFAULT 100`;
  await prisma.$executeRaw`ALTER TABLE system_settings ADD COLUMN IF NOT EXISTS auto_reorder_enabled BOOLEAN DEFAULT FALSE`;
  await prisma.$executeRaw`ALTER TABLE system_settings ADD COLUMN IF NOT EXISTS email_notifications_enabled BOOLEAN DEFAULT TRUE`;
  await prisma.$executeRaw`ALTER TABLE system_settings ADD COLUMN IF NOT EXISTS sms_notifications_enabled BOOLEAN DEFAULT FALSE`;
  await prisma.$executeRaw`ALTER TABLE system_settings ADD COLUMN IF NOT EXISTS low_stock_alerts_enabled BOOLEAN DEFAULT TRUE`;

  await prisma.$executeRaw`
    INSERT INTO system_settings (
      id,
      singleton_key,
      restaurant_name,
      timezone,
      currency,
      tax_rate_percent,
      receipt_paper_size,
      receipt_footer,
      max_party_size,
      reservation_duration_minutes,
      estimated_dining_duration_minutes,
      reservation_grace_period_minutes,
      minimum_catering_pax,
      default_downpayment_percent,
      auto_lock_catering_ingredients,
      release_catering_locks_on_completion,
      default_reorder_level,
      low_stock_threshold_percent,
      auto_reorder_enabled,
      email_notifications_enabled,
      sms_notifications_enabled,
      low_stock_alerts_enabled,
      updated_at
    )
    VALUES (
      'system-settings-default',
      'default',
      ${defaultSystemSettings.restaurant_name},
      ${defaultSystemSettings.timezone},
      ${defaultSystemSettings.currency},
      ${defaultSystemSettings.tax_rate_percent},
      ${defaultSystemSettings.receipt_paper_size},
      ${defaultSystemSettings.receipt_footer},
      ${defaultSystemSettings.max_party_size},
      ${defaultSystemSettings.reservation_duration_minutes},
      ${defaultSystemSettings.estimated_dining_duration_minutes},
      ${defaultSystemSettings.reservation_grace_period_minutes},
      ${defaultSystemSettings.minimum_catering_pax},
      ${defaultSystemSettings.default_downpayment_percent},
      ${defaultSystemSettings.auto_lock_catering_ingredients},
      ${defaultSystemSettings.release_catering_locks_on_completion},
      ${defaultSystemSettings.default_reorder_level},
      ${defaultSystemSettings.low_stock_threshold_percent},
      ${defaultSystemSettings.auto_reorder_enabled},
      ${defaultSystemSettings.email_notifications_enabled},
      ${defaultSystemSettings.sms_notifications_enabled},
      ${defaultSystemSettings.low_stock_alerts_enabled},
      NOW()
    )
    ON CONFLICT (singleton_key) DO NOTHING
  `;
}

async function getSystemSettings() {
  const rows = await prisma.$queryRaw<SystemSettingsRecord[]>`
    SELECT
      id,
      singleton_key,
      restaurant_name,
      timezone,
      currency,
      tax_rate_percent,
      receipt_paper_size,
      receipt_footer,
      max_party_size,
      reservation_duration_minutes,
      estimated_dining_duration_minutes,
      reservation_grace_period_minutes,
      minimum_catering_pax,
      default_downpayment_percent,
      auto_lock_catering_ingredients,
      release_catering_locks_on_completion,
      default_reorder_level,
      low_stock_threshold_percent,
      auto_reorder_enabled,
      email_notifications_enabled,
      sms_notifications_enabled,
      low_stock_alerts_enabled,
      updated_at
    FROM system_settings
    WHERE singleton_key = 'default'
    LIMIT 1
  `;

  return rows[0] ?? { id: "system-settings-default", singleton_key: "default", ...defaultSystemSettings, updated_at: new Date() };
}

async function updateSystemSettings(settings: SystemSettingsInput) {
  const rows = await prisma.$queryRaw<SystemSettingsRecord[]>`
    UPDATE system_settings
    SET
      restaurant_name = ${settings.restaurant_name},
      timezone = ${settings.timezone},
      currency = ${settings.currency.toUpperCase()},
      tax_rate_percent = ${settings.tax_rate_percent},
      receipt_paper_size = ${settings.receipt_paper_size},
      receipt_footer = ${settings.receipt_footer},
      max_party_size = ${settings.max_party_size},
      reservation_duration_minutes = ${settings.reservation_duration_minutes},
      estimated_dining_duration_minutes = ${settings.estimated_dining_duration_minutes},
      reservation_grace_period_minutes = ${settings.reservation_grace_period_minutes},
      minimum_catering_pax = ${settings.minimum_catering_pax},
      default_downpayment_percent = ${settings.default_downpayment_percent},
      auto_lock_catering_ingredients = ${settings.auto_lock_catering_ingredients},
      release_catering_locks_on_completion = ${settings.release_catering_locks_on_completion},
      default_reorder_level = ${settings.default_reorder_level},
      low_stock_threshold_percent = ${settings.low_stock_threshold_percent},
      auto_reorder_enabled = ${settings.auto_reorder_enabled},
      email_notifications_enabled = ${settings.email_notifications_enabled},
      sms_notifications_enabled = ${settings.sms_notifications_enabled},
      low_stock_alerts_enabled = ${settings.low_stock_alerts_enabled},
      updated_at = NOW()
    WHERE singleton_key = 'default'
    RETURNING
      id,
      singleton_key,
      restaurant_name,
      timezone,
      currency,
      tax_rate_percent,
      receipt_paper_size,
      receipt_footer,
      max_party_size,
      reservation_duration_minutes,
      estimated_dining_duration_minutes,
      reservation_grace_period_minutes,
      minimum_catering_pax,
      default_downpayment_percent,
      auto_lock_catering_ingredients,
      release_catering_locks_on_completion,
      default_reorder_level,
      low_stock_threshold_percent,
      auto_reorder_enabled,
      email_notifications_enabled,
      sms_notifications_enabled,
      low_stock_alerts_enabled,
      updated_at
  `;

  return rows[0] ?? getSystemSettings();
}

async function deductRecipeForProduct(
  tx: Prisma.TransactionClient,
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
    if (!inventoryUnitsMatch(ingredient.unit, material.unit)) {
      throw new InventoryError(
        `Recipe unit for ${material.id} does not match its stock unit.`,
        "UNIT_MISMATCH",
        409
      );
    }
    const deduction = Number(ingredient.quantity_per_yield) * quantity;
    await consumeMaterialStock(tx, {
      raw_material_id: material.id,
      quantity: deduction,
      source_type: "unlimited",
      source_reference: reference,
      actor_id: userId,
      note: "Unlimited session round"
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
        extension_minutes: z.coerce.number().int().min(5).max(120),
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

    return res.status(409).json({
      message: "Start Unlimited from an active table session so its package can be included in the shared bill."
    });
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

    return res.status(409).json({
      message: "Send Unlimited orders as kitchen tickets from an active table session."
    });
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

async function processReservationBookingDates() {
  const todayStart = startOfDay(new Date());
  const expiredDineIn = await prisma.reservation.findMany({
    where: {
      date: { lt: todayStart },
      status: { in: ["pending", "pending_approval"] }
    },
    select: { id: true }
  });
  const expiredCatering = await prisma.cateringReservation.findMany({
    where: {
      event_date: { lt: todayStart },
      status: { in: ["pending", "pending_approval"] }
    },
    select: { id: true }
  });
  for (const { id } of expiredDineIn) {
    await prisma.$transaction(async (tx) => {
      await lockDineInReservationForUpdate(tx, id);
      const current = await tx.reservation.findUnique({ where: { id }, include: { payments: true } });
      if (!current || !["pending", "pending_approval"].includes(current.status ?? "")) return;
      const refundAmount = Number(current.downpayment_amount);
      if (refundAmount > 0 && !current.payments.some((payment) => payment.payment_stage === "refund")) {
        await tx.reservationPayment.create({
          data: {
            reservation_id: current.id,
            payment_stage: "refund",
            method: current.downpayment_method ?? "cash",
            amount: refundAmount,
            reference_number: current.downpayment_transaction_id,
            source: "system"
          }
        });
      }
      const expired = await tx.reservation.update({
        where: { id },
        data: {
          status: "expired",
          remaining_balance: Number(current.total_price),
          final_payment_status: refundAmount > 0 ? "refunded" : "expired"
        }
      });
      await addReservationActivity(tx, {
        reservationId: id,
        eventType: "booking_expired",
        fromStatus: current.status,
        toStatus: expired.status,
        actorType: "system",
        reason: "Booking date passed before approval",
        details: { refund_amount: refundAmount }
      });
    }, { maxWait: 10_000, timeout: 30_000 });
  }

  for (const { id } of expiredCatering) {
    await prisma.$transaction(async (tx) => {
      await lockCateringReservationForUpdate(tx, id);
      const current = await tx.cateringReservation.findUnique({ where: { id }, include: { payments: true } });
      if (!current || !["pending", "pending_approval"].includes(current.status ?? "")) return;
      const refundAmount = Number(current.downpayment_amount);
      if (refundAmount > 0 && !current.payments.some((payment) => payment.payment_stage === "refund")) {
        await tx.reservationPayment.create({
          data: {
            catering_reservation_id: current.id,
            payment_stage: "refund",
            method: current.downpayment_method ?? "cash",
            amount: refundAmount,
            reference_number: current.downpayment_transaction_id,
            source: "system"
          }
        });
      }
      const expired = await tx.cateringReservation.update({
        where: { id },
        data: {
          status: "expired",
          remaining_balance: Number(current.total_price),
          final_payment_status: refundAmount > 0 ? "refunded" : "expired"
        }
      });
      await addReservationActivity(tx, {
        cateringReservationId: id,
        eventType: "booking_expired",
        fromStatus: current.status,
        toStatus: expired.status,
        actorType: "system",
        reason: "Booking date passed before approval",
        details: { refund_amount: refundAmount }
      });
    }, { maxWait: 10_000, timeout: 30_000 });
  }

  const pastDineIn = await prisma.reservation.findMany({
    where: {
      date: { lt: todayStart },
      status: { in: ["confirmed", "approved", "seated", "preparing", "in_progress", "pending_final_payment"] },
      ingredient_locks: { some: { is_released: false } }
    },
    select: { id: true, booking_id: true, status: true }
  });
  for (const booking of pastDineIn) {
    await prisma.$transaction(async (tx) => {
      await lockDineInReservationForUpdate(tx, booking.id);
      const current = await tx.reservation.findUnique({ where: { id: booking.id } });
      if (!current || isTerminalReservationStatus(current.status)) return;
      await cancelDineInIngredientLocks(tx, current.id, undefined, "Booking date ended; unused ingredients released", current.booking_id);
      await addReservationActivity(tx, {
        reservationId: current.id,
        eventType: "booking_date_ended",
        fromStatus: current.status,
        toStatus: current.status,
        actorType: "system",
        reason: "Unused ingredients released after booking date"
      });
    }, { maxWait: 10_000, timeout: 30_000 });
  }

}

export function startAutoCompleteTask() {
  void processReservationBookingDates().catch((error) => {
    console.error("Unable to process reservation booking dates", error);
  });
  const interval = setInterval(() => {
    void processReservationBookingDates().catch((error) => {
      console.error("Unable to process reservation booking dates", error);
    });
  }, 60 * 1000);
  interval.unref?.();
  return interval;
}

async function expireTakeoutOrders() {
  const expiredCandidates = await prisma.takeoutOrder.findMany({
    where: {
      payment_plan: "pay_now",
      payment_status: { in: ["pending", "failed"] },
      status: { in: ["pending_payment", "payment_failed"] },
      payment_expires_at: { lte: new Date() }
    },
    select: { id: true },
    orderBy: { payment_expires_at: "asc" },
    take: 50
  });

  for (const candidate of expiredCandidates) {
    await prisma.$transaction(async (tx) => {
      await tx.$queryRaw<Array<{ id: string }>>`
        SELECT id FROM takeout_orders WHERE id = ${candidate.id} FOR UPDATE
      `;
      const order = await tx.takeoutOrder.findUnique({
        where: { id: candidate.id },
        include: { ingredient_locks: { where: { is_released: false } } }
      });
      if (
        !order ||
        !["pending_payment", "payment_failed"].includes(order.status) ||
        !["pending", "failed"].includes(order.payment_status) ||
        !order.payment_expires_at ||
        order.payment_expires_at.getTime() > Date.now()
      ) {
        return;
      }

      for (const lock of [...order.ingredient_locks].sort((a, b) =>
        a.raw_material_id.localeCompare(b.raw_material_id)
      )) {
        await lockMaterialForUpdate(tx, lock.raw_material_id);
        const reservedBefore = await getActiveCateringReservationQuantity(tx, lock.raw_material_id);
        await tx.takeoutIngredientLock.update({
          where: { id: lock.id },
          data: { is_released: true, released_at: new Date() }
        });
        const reservedAfter = await getActiveCateringReservationQuantity(tx, lock.raw_material_id);
        await recordReservationMovement(tx, {
          raw_material_id: lock.raw_material_id,
          quantity: Number(lock.reserved_quantity),
          unit: lock.unit,
          source_type: "takeout",
          source_reference: order.order_number,
          action: "Released back",
          reserved_before: reservedBefore,
          reserved_after: reservedAfter,
          note: "Online pickup payment expired"
        });
      }

      await tx.takeoutOrder.update({
        where: { id: order.id },
        data: { status: "expired", payment_status: "expired" }
      });
      if (order.payment_intent_reference_id) {
        await tx.paymentIntent.updateMany({
          where: {
            reference_id: order.payment_intent_reference_id,
            status: { in: ["created", "pending", "failed"] }
          },
          data: { status: "expired" }
        });
      }
    });
  }
}

export function startTakeoutExpiryTask() {
  let running = false;
  const run = async () => {
    if (running) return;
    running = true;
    try {
      await expireTakeoutOrders();
    } catch (error) {
      console.error("Failed to expire pending pickup orders:", error);
    } finally {
      running = false;
    }
  };
  const interval = setInterval(() => void run(), 30 * 1000);
  interval.unref?.();
  void run();
  return interval;
}

export { app, prisma };

function getDatabaseErrorResponse(error: Error) {
  if (error instanceof Prisma.PrismaClientKnownRequestError) {
    if (error.code === "P1001" || error.code === "P1017") {
      return {
        status: 503,
        message: "Reconnecting, please try again."
      };
    }

    if (error.code === "P2021") {
      return {
        status: 503,
        message: "Database schema is missing a required table. Run Prisma migrations before using this feature."
      };
    }

    if (error.code === "P2022") {
      return {
        status: 503,
        message: "Database schema is missing a required column. Run Prisma migrations before using this feature."
      };
    }
  }

  if (error instanceof Prisma.PrismaClientInitializationError) {
    return {
      status: 503,
      message: "Database is not ready. Check DATABASE_URL and database availability."
    };
  }

  if (error instanceof Prisma.PrismaClientRustPanicError) {
    return {
      status: 503,
      message: "Database client encountered a runtime failure. Restart the API and check the backend logs."
    };
  }

  return null;
}

app.use((error: Error, _req: Request, res: Response, _next: NextFunction) => {
  console.error(error);

  if (error instanceof z.ZodError) {
    return res.status(400).json({
      message: error.errors[0]?.message ?? "Invalid request data"
    });
  }

  const databaseError = getDatabaseErrorResponse(error);

  if (databaseError) {
    markDatabaseDown(error);
    return res.status(databaseError.status).json({ message: databaseError.message });
  }

  const statusCode = (error as Error & { statusCode?: number }).statusCode;

  if (statusCode && statusCode >= 400 && statusCode < 600) {
    return res.status(statusCode).json({ message: error.message });
  }

  res.status(500).json({ message: "Internal server error" });
});

export default app;

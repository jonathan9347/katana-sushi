import fs from "node:fs";
import path from "node:path";
import dotenv from "dotenv";
import { Prisma, PrismaClient } from "@prisma/client";

dotenv.config({ path: path.resolve(__dirname, "..", "..", ".env") });

if (process.env.DIRECT_URL) {
  process.env.DATABASE_URL = process.env.DIRECT_URL;
}

const prisma = new PrismaClient();

const backupTables = [
  "audit_logs",
  "catering_ingredient_locks",
  "catering_inquiries",
  "catering_reservations",
  "customer_feedback",
  "inventory_movements",
  "inventory_snapshots",
  "inventory_transactions",
  "payment_transaction_claims",
  "pos_items",
  "pos_transactions",
  "reservation_activity",
  "reservation_ingredient_locks",
  "reservation_payments",
  "reservations",
  "unlimited_leftover_items",
  "unlimited_order_items",
  "unlimited_rounds",
  "unlimited_sessions"
] as const;

const deleteOrder = [
  "audit_logs",
  "payment_transaction_claims",
  "reservation_activity",
  "reservation_ingredient_locks",
  "reservation_payments",
  "catering_ingredient_locks",
  "pos_items",
  "unlimited_order_items",
  "unlimited_leftover_items",
  "unlimited_rounds",
  "inventory_movements",
  "inventory_snapshots",
  "inventory_transactions",
  "pos_transactions",
  "unlimited_sessions",
  "catering_reservations",
  "catering_inquiries",
  "reservations",
  "customer_feedback"
] as const;

const preservedTables = [
  "users",
  "selling_products",
  "recipes",
  "recipe_ingredients",
  "raw_materials",
  "material_batches",
  "conversion_rules",
  "catering_packages",
  "tables",
  "system_settings",
  "unlimited_settings",
  "unlimited_included_products"
] as const;

function quoteIdentifier(value: string) {
  return `"${value.replace(/"/g, '""')}"`;
}

async function tableExists(table: string, client: PrismaClient | Prisma.TransactionClient = prisma) {
  const rows = await client.$queryRaw<Array<{ exists: boolean }>>`
    SELECT EXISTS (
      SELECT 1
      FROM information_schema.tables
      WHERE table_schema = 'public'
        AND table_name = ${table}
    ) AS exists
  `;
  return rows[0]?.exists === true;
}

async function countRows(table: string) {
  const rows = await prisma.$queryRawUnsafe<Array<{ row_count: bigint }>>(
    `SELECT count(*)::bigint AS row_count FROM "public".${quoteIdentifier(table)}`
  );
  return Number(rows[0]?.row_count ?? 0);
}

async function readRows(table: string) {
  return prisma.$queryRawUnsafe<Array<Record<string, unknown>>>(
    `SELECT * FROM "public".${quoteIdentifier(table)}`
  );
}

async function disableInventoryMovementTrigger(tx: Prisma.TransactionClient) {
  if (!(await tableExists("inventory_movements", tx))) return false;

  const rows = await tx.$queryRaw<Array<{ trigger_name: string }>>`
    SELECT trigger_name
    FROM information_schema.triggers
    WHERE event_object_schema = 'public'
      AND event_object_table = 'inventory_movements'
      AND trigger_name = 'inventory_movements_append_only'
  `;
  if (rows.length === 0) return false;

  await tx.$executeRawUnsafe(`ALTER TABLE "public"."inventory_movements" DISABLE TRIGGER "inventory_movements_append_only"`);
  return true;
}

async function main() {
  const execute = process.argv.includes("--execute");
  const existingBackupTables = [];
  const counts: Record<string, number> = {};

  for (const table of backupTables) {
    if (await tableExists(table)) {
      existingBackupTables.push(table);
      counts[table] = await countRows(table);
    }
  }

  const preservedCounts: Record<string, number> = {};
  for (const table of preservedTables) {
    if (await tableExists(table)) {
      preservedCounts[table] = await countRows(table);
    }
  }

  if (!execute) {
    console.log(JSON.stringify({
      mode: "DRY_RUN",
      rows_to_delete: counts,
      rows_to_preserve: preservedCounts,
      note: "Run with --execute to back up and delete operational records. Raw material stock, costs, and batches are preserved."
    }, null, 2));
    return;
  }

  const backupDir = path.resolve(__dirname, "..", "..", "backups");
  fs.mkdirSync(backupDir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const backupPath = path.join(backupDir, `fresh-start-records-${stamp}.json`);

  const records: Record<string, Array<Record<string, unknown>>> = {};
  for (const table of existingBackupTables) {
    records[table] = await readRows(table);
  }

  fs.writeFileSync(backupPath, JSON.stringify({
    created_at: new Date().toISOString(),
    database: await prisma.$queryRaw`SELECT current_database() AS database_name, current_schema() AS schema_name`,
    preserved_tables: preservedCounts,
    deleted_table_counts_before_reset: counts,
    records
  }, null, 2));

  const deleted = await prisma.$transaction(async (tx) => {
    await tx.$executeRawUnsafe(`SET LOCAL lock_timeout = '10s'`);
    const triggerDisabled = await disableInventoryMovementTrigger(tx);
    const deletedCounts: Record<string, number> = {};

    try {
      for (const table of deleteOrder) {
        if (!(await tableExists(table, tx))) continue;
        deletedCounts[table] = await tx.$executeRawUnsafe(`DELETE FROM "public".${quoteIdentifier(table)}`);
      }
    } finally {
      if (triggerDisabled) {
        await tx.$executeRawUnsafe(`ALTER TABLE "public"."inventory_movements" ENABLE TRIGGER "inventory_movements_append_only"`);
      }
    }

    return deletedCounts;
  }, { maxWait: 15000, timeout: 120000 });

  const remaining: Record<string, number> = {};
  for (const table of existingBackupTables) {
    remaining[table] = await countRows(table);
  }

  console.log(JSON.stringify({
    mode: "RESET_COMPLETE",
    backup_path: backupPath,
    deleted,
    remaining,
    preserved: preservedCounts
  }, null, 2));
}

main()
  .catch((error: unknown) => {
    console.error("Fresh-start reset failed:", error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });

import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import readline from "node:readline/promises";
import { stdin, stdout } from "node:process";
import dotenv from "dotenv";
import { Prisma, PrismaClient } from "@prisma/client";

if (process.env.NODE_ENV !== "production") {
  dotenv.config({ path: path.resolve(__dirname, "..", "..", ".env") });
}

const prisma = new PrismaClient();

type TableAction = "WIPE" | "KEEP" | "RESET";

const tablePlan: Array<{ table: string; action: TableAction; reason: string }> = [
  { table: "_prisma_migrations", action: "KEEP", reason: "Preserve database migration history." },
  { table: "audit_logs", action: "KEEP", reason: "Preserve the audit trail." },
  { table: "catering_ingredient_locks", action: "WIPE", reason: "Remove all catering reservation holds." },
  { table: "catering_inquiries", action: "WIPE", reason: "Remove catering inquiries and customer contact data." },
  { table: "catering_packages", action: "KEEP", reason: "Preserve catering package setup and photos." },
  { table: "catering_reservations", action: "WIPE", reason: "Remove catering bookings and payment/contact details." },
  { table: "conversion_rules", action: "KEEP", reason: "Preserve unit conversion setup." },
  { table: "customer_feedback", action: "WIPE", reason: "Remove customer feedback and contact data." },
  { table: "dine_in_ingredient_locks", action: "WIPE", reason: "Remove active dine-in order holds." },
  { table: "inventory_movements", action: "WIPE", reason: "Remove the inventory movement ledger, including legacy rows." },
  { table: "inventory_snapshots", action: "WIPE", reason: "Remove historical inventory snapshots." },
  { table: "inventory_transactions", action: "WIPE", reason: "Remove inventory transactions, including waste records." },
  { table: "material_batches", action: "WIPE", reason: "Remove stock batches and expiry records." },
  { table: "pos_items", action: "WIPE", reason: "Remove POS sale line items." },
  { table: "pos_transactions", action: "WIPE", reason: "Remove POS sales transactions." },
  { table: "raw_materials", action: "RESET", reason: "Keep material definitions and set current stock to zero." },
  { table: "reservation_ingredient_locks", action: "WIPE", reason: "Remove active reservation holds from dine-in bookings." },
  { table: "recipe_ingredients", action: "KEEP", reason: "Preserve recipes and their material links." },
  { table: "recipes", action: "KEEP", reason: "Preserve menu recipes." },
  { table: "reservation_payments", action: "WIPE", reason: "Remove payments, deposits, refunds, and payment history." },
  { table: "reservations", action: "WIPE", reason: "Remove dine-in and unlimited bookings and customer contact data." },
  { table: "selling_products", action: "KEEP", reason: "Preserve menu products." },
  { table: "takeout_ingredient_locks", action: "WIPE", reason: "Remove active takeout reservation holds." },
  { table: "system_settings", action: "KEEP", reason: "Preserve system settings." },
  { table: "tables", action: "KEEP", reason: "Preserve dining table setup; all are currently available." },
  { table: "unlimited_included_products", action: "KEEP", reason: "Preserve unlimited menu configuration." },
  { table: "unlimited_leftover_items", action: "WIPE", reason: "Remove unlimited-session leftover charges." },
  { table: "unlimited_order_items", action: "WIPE", reason: "Remove unlimited-session order line items." },
  { table: "unlimited_rounds", action: "WIPE", reason: "Remove unlimited-session rounds." },
  { table: "unlimited_sessions", action: "WIPE", reason: "Remove unlimited dining sessions and sales." },
  { table: "unlimited_settings", action: "KEEP", reason: "Preserve unlimited dining configuration." },
  { table: "users", action: "KEEP", reason: "Preserve staff/admin accounts and login access." }
];

const deleteOrder = [
  "pos_items",
  "unlimited_order_items",
  "unlimited_leftover_items",
  "unlimited_rounds",
  "reservation_payments",
  "takeout_ingredient_locks",
  "reservation_ingredient_locks",
  "dine_in_ingredient_locks",
  "catering_ingredient_locks",
  "inventory_movements",
  "inventory_transactions",
  "inventory_snapshots",
  "material_batches",
  "pos_transactions",
  "unlimited_sessions",
  "catering_reservations",
  "catering_inquiries",
  "reservations",
  "customer_feedback"
];

const restoreOrder = [
  "customer_feedback",
  "catering_inquiries",
  "catering_reservations",
  "reservations",
  "reservation_payments",
  "dine_in_ingredient_locks",
  "reservation_ingredient_locks",
  "takeout_ingredient_locks",
  "catering_ingredient_locks",
  "pos_transactions",
  "pos_items",
  "unlimited_sessions",
  "unlimited_rounds",
  "unlimited_order_items",
  "unlimited_leftover_items",
  "material_batches",
  "inventory_snapshots",
  "inventory_transactions",
  "inventory_movements"
];

type Backup = {
  database: { database_name: string; schema_name: string };
  database_host: string;
  tables: string[];
  columns: Array<{
    table_name: string;
    column_name: string;
    ordinal_position: number;
    data_type: string;
  }>;
  counts: Record<string, number>;
  records: Record<string, Array<Record<string, unknown>>>;
};

function quoteIdentifier(value: string) {
  return `"${value.replace(/"/g, '""')}"`;
}

function getDatabaseUrl() {
  const value = process.env.DATABASE_URL;
  if (!value) {
    throw new Error("DATABASE_URL is not configured.");
  }
  return new URL(value);
}

function getTargetEnvironment() {
  const declared = process.env.RESET_DATABASE_ENV?.trim().toLowerCase();
  if (declared && ["local", "test", "production"].includes(declared)) {
    return declared;
  }

  const host = getDatabaseUrl().hostname.toLowerCase();
  if (["localhost", "127.0.0.1", "::1"].includes(host)) {
    return "local";
  }
  return "remote-unclassified";
}

function readBackup(filePath: string): Backup {
  const data = fs.readFileSync(filePath);
  const decompressed = filePath.toLowerCase().endsWith(".gz") ? zlib.gunzipSync(data) : data;
  const parsed = JSON.parse(decompressed.toString("utf8")) as Backup;
  if (!parsed.database?.database_name || !Array.isArray(parsed.tables) || !parsed.records) {
    throw new Error("The selected backup does not have the expected full-table export format.");
  }
  return parsed;
}

function sqlLiteral(value: unknown, dataType: string): string {
  if (value === null || value === undefined) return "NULL";
  if (typeof value === "boolean") return value ? "TRUE" : "FALSE";
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new Error("Backup contains a non-finite numeric value.");
    return String(value);
  }
  if (typeof value === "object") {
    if (Array.isArray(value) && dataType !== "json" && dataType !== "jsonb") {
      throw new Error("Backup contains an array value that this restore script does not support.");
    }
    const json = JSON.stringify(value).replace(/'/g, "''");
    return `'${json}'::${dataType === "json" ? "json" : "jsonb"}`;
  }

  const text = String(value).replace(/'/g, "''");
  if (dataType === "date") return `DATE '${text}'`;
  if (dataType === "timestamp without time zone") return `TIMESTAMP '${text}'`;
  if (dataType === "timestamp with time zone") return `TIMESTAMPTZ '${text}'`;
  return `'${text}'`;
}

async function confirmPhrase(phrase: string) {
  const terminal = readline.createInterface({ input: stdin, output: stdout });
  try {
    const answer = await terminal.question(`Type "${phrase}" to continue: `);
    return answer === phrase;
  } finally {
    terminal.close();
  }
}

async function getTableCounts(tx: PrismaClient | Prisma.TransactionClient) {
  const actualTables = await tx.$queryRaw<Array<{ table_name: string }>>`
    SELECT table_name
    FROM information_schema.tables
    WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
    ORDER BY table_name
  `;
  const expected = tablePlan.map(({ table }) => table).sort();
  const actual = actualTables.map(({ table_name }) => table_name).sort();
  if (JSON.stringify(expected) !== JSON.stringify(actual)) {
    throw new Error(`Database table inventory differs from the reset plan. Expected ${expected.length} tables; found ${actual.length}. Refusing to proceed.`);
  }

  const counts: Record<string, number> = {};
  for (const { table } of tablePlan) {
    const [{ row_count }] = await tx.$queryRawUnsafe<Array<{ row_count: bigint }>>(
      `SELECT count(*)::bigint AS row_count FROM "public".${quoteIdentifier(table)}`
    );
    counts[table] = Number(row_count);
  }
  return counts;
}

async function verifyBackupMatchesTarget(backup: Backup) {
  const database = await prisma.$queryRaw<Array<{ database_name: string; schema_name: string }>>`
    SELECT current_database() AS database_name, current_schema() AS schema_name
  `;
  if (backup.database.database_name !== database[0].database_name
    || backup.database.schema_name !== database[0].schema_name
    || backup.database_host !== getDatabaseUrl().hostname) {
    throw new Error("Backup database/schema does not match the connected target.");
  }
}

async function showDryRun() {
  const [database] = await prisma.$queryRaw<Array<{ database_name: string; schema_name: string; server_version: string }>>`
    SELECT current_database() AS database_name,
           current_schema() AS schema_name,
           current_setting('server_version') AS server_version
  `;
  const [counts, materialInfo, identities] = await prisma.$transaction(async (tx) => {
    const tableCounts = await getTableCounts(tx);
    const materialRows = await tx.$queryRaw<Array<{ materials: bigint; with_stock: bigint }>>`
      SELECT count(*)::bigint AS materials,
             count(*) FILTER (WHERE current_stock <> 0)::bigint AS with_stock
      FROM "public"."raw_materials"
    `;
    const identityColumns = await tx.$queryRaw<Array<{ table_name: string; column_name: string }>>`
      SELECT table_name, column_name
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND (is_identity = 'YES' OR column_default LIKE 'nextval(%')
      ORDER BY table_name, ordinal_position
    `;
    return [tableCounts, materialRows[0], identityColumns] as const;
  }, { maxWait: 15000, timeout: 120000, isolationLevel: "RepeatableRead" });

  const totalRowsToDelete = deleteOrder.reduce((total, table) => total + (counts[table] ?? 0), 0);
  const rowsToReset = identities as Array<{ table_name: string; column_name: string }>;
  console.log(JSON.stringify({
    mode: "DRY_RUN",
    target_environment: getTargetEnvironment(),
    database,
    production_reset_allowed: false,
    customer_data_choice: "DELETE",
    customer_account_table: "None exists; staff/admin accounts are in users and will be kept.",
    table_plan: tablePlan.map((item) => ({
      table: item.table,
      action: item.action,
      current_rows: counts[item.table],
      reason: item.reason
    })),
    total_rows_that_would_be_deleted: totalRowsToDelete,
    materials: {
      total: Number(materialInfo.materials),
      with_nonzero_stock_to_reset: Number(materialInfo.with_stock),
      reserved_after_reset: 0,
      available_after_reset: 0
    },
    auto_increment_counters: rowsToReset.length === 0
      ? "No identity/serial counters exist; no counter reset is needed."
      : rowsToReset
  }, null, 2));
}

async function enforceEnvironmentSafety(allowProduction: boolean) {
  const environment = getTargetEnvironment();
  if (environment === "remote-unclassified") {
    throw new Error("Refusing to reset an unclassified remote database. Set RESET_DATABASE_ENV=test or RESET_DATABASE_ENV=production after verifying the target.");
  }
  if (environment === "production" && !allowProduction) {
    throw new Error("Refusing to reset production without the explicit --allow-production flag.");
  }
  if (environment !== "production" && allowProduction) {
    throw new Error("--allow-production was supplied, but RESET_DATABASE_ENV is not production.");
  }
}

async function resetData(backupPath: string, allowProduction: boolean) {
  await enforceEnvironmentSafety(allowProduction);
  if (!fs.existsSync(backupPath)) {
    throw new Error(`Required verified backup does not exist: ${backupPath}`);
  }
  const backup = readBackup(backupPath);
  await verifyBackupMatchesTarget(backup);

  if (!(await confirmPhrase("RESET MY DATA"))) {
    throw new Error("Confirmation text did not match; no database changes were made.");
  }

  const result = await prisma.$transaction(async (tx) => {
    await tx.$executeRawUnsafe(`SET LOCAL lock_timeout = '10s'`);
    await tx.$executeRawUnsafe(`LOCK TABLE ${deleteOrder.map((table) => `"public".${quoteIdentifier(table)}`).join(", ")}, "public"."raw_materials" IN ACCESS EXCLUSIVE MODE`);
    await tx.$executeRawUnsafe(`ALTER TABLE "public"."inventory_movements" DISABLE TRIGGER "inventory_movements_append_only"`);
    const deleted: Record<string, number> = {};
    for (const table of deleteOrder) {
      deleted[table] = await tx.$executeRawUnsafe(`DELETE FROM "public".${quoteIdentifier(table)}`);
    }
    await tx.$executeRawUnsafe(`UPDATE "public"."raw_materials" SET "current_stock" = 0`);
    await tx.$executeRawUnsafe(`ALTER TABLE "public"."inventory_movements" ENABLE TRIGGER "inventory_movements_append_only"`);

    const remaining = await getTableCounts(tx);
    for (const table of deleteOrder) {
      if (remaining[table] !== 0) {
        throw new Error(`Post-reset verification failed: ${table} still has ${remaining[table]} rows.`);
      }
    }
    const [{ material_count, nonzero_stock }] = await tx.$queryRaw<Array<{ material_count: bigint; nonzero_stock: bigint }>>`
      SELECT count(*)::bigint AS material_count,
             count(*) FILTER (WHERE current_stock <> 0)::bigint AS nonzero_stock
      FROM "public"."raw_materials"
    `;
    if (Number(nonzero_stock) !== 0) {
      throw new Error(`Post-reset verification failed: ${nonzero_stock} materials still have nonzero stock.`);
    }
    return { deleted, remaining, material_count: Number(material_count) };
  }, { maxWait: 15000, timeout: 120000, isolationLevel: "Serializable" });

  console.log(JSON.stringify({ mode: "RESET_COMPLETE", deleted: result.deleted, materials_kept_at_zero_stock: result.material_count }, null, 2));
}

async function restoreBackup(backupPath: string, allowProduction: boolean) {
  await enforceEnvironmentSafety(allowProduction);
  const backup = readBackup(backupPath);
  await verifyBackupMatchesTarget(backup);

  if (!(await confirmPhrase("RESTORE MY DATA"))) {
    throw new Error("Confirmation text did not match; no database changes were made.");
  }

  const columnType = new Map(
    backup.columns.map((column) => [`${column.table_name}.${column.column_name}`, column.data_type])
  );
  await prisma.$transaction(async (tx) => {
    await tx.$executeRawUnsafe(`SET LOCAL lock_timeout = '10s'`);
    await tx.$executeRawUnsafe(`LOCK TABLE ${deleteOrder.map((table) => `"public".${quoteIdentifier(table)}`).join(", ")}, "public"."raw_materials" IN ACCESS EXCLUSIVE MODE`);
    await tx.$executeRawUnsafe(`ALTER TABLE "public"."inventory_movements" DISABLE TRIGGER "inventory_movements_append_only"`);
    for (const table of deleteOrder) {
      await tx.$executeRawUnsafe(`DELETE FROM "public".${quoteIdentifier(table)}`);
    }

    for (const row of backup.records.raw_materials ?? []) {
      const id = String(row.id).replace(/'/g, "''");
      const stock = sqlLiteral(row.current_stock, "numeric");
      await tx.$executeRawUnsafe(`UPDATE "public"."raw_materials" SET "current_stock" = ${stock} WHERE "id" = '${id}'`);
    }

    for (const table of restoreOrder) {
      const rows = backup.records[table] ?? [];
      for (const row of rows) {
        const columns = Object.keys(row);
        const quotedColumns = columns.map(quoteIdentifier).join(", ");
        const values = columns.map((column) =>
          sqlLiteral(row[column], columnType.get(`${table}.${column}`) ?? "text")
        ).join(", ");
        await tx.$executeRawUnsafe(
          `INSERT INTO "public".${quoteIdentifier(table)} (${quotedColumns}) VALUES (${values})`
        );
      }
    }
    await tx.$executeRawUnsafe(`ALTER TABLE "public"."inventory_movements" ENABLE TRIGGER "inventory_movements_append_only"`);
  }, { maxWait: 15000, timeout: 120000, isolationLevel: "Serializable" });
  console.log(`Backup restored from ${path.resolve(backupPath)}. Verify application records before resuming normal service.`);
}

async function main() {
  const args = process.argv.slice(2);
  const dryRun = args.includes("--dry-run");
  const execute = args.includes("--execute");
  const allowProduction = args.includes("--allow-production");
  const restoreIndex = args.indexOf("--restore-backup");
  if (dryRun && (execute || restoreIndex >= 0)) {
    throw new Error("Choose only one mode: --dry-run, --execute, or --restore-backup <file>.");
  }
  if (restoreIndex >= 0) {
    const backupPath = args[restoreIndex + 1];
    if (!backupPath || backupPath.startsWith("--")) {
      throw new Error("--restore-backup requires a backup file path.");
    }
    await restoreBackup(backupPath, allowProduction);
    return;
  }
  if (execute) {
    const backupPath = process.env.RESET_BACKUP_PATH;
    if (!backupPath) {
      throw new Error("Set RESET_BACKUP_PATH to the verified pre-reset backup before using --execute.");
    }
    await resetData(backupPath, allowProduction);
    return;
  }
  if (allowProduction) {
    throw new Error("--allow-production only applies with --execute or --restore-backup.");
  }
  await showDryRun();
}

main()
  .catch((error: unknown) => {
    console.error("Data reset tool stopped:", error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });

import path from "node:path";
import dotenv from "dotenv";
import { PrismaClient } from "@prisma/client";

dotenv.config({ path: path.resolve(__dirname, "..", "..", ".env") });

const prisma = new PrismaClient();

const indexStatements = [
  `CREATE INDEX IF NOT EXISTS "raw_materials_is_deleted_name_idx" ON "raw_materials"("is_deleted", "name")`,
  `CREATE INDEX IF NOT EXISTS "selling_products_is_deleted_category_name_idx" ON "selling_products"("is_deleted", "category", "name")`,
  `CREATE INDEX IF NOT EXISTS "selling_products_is_available_idx" ON "selling_products"("is_available")`,
  `CREATE INDEX IF NOT EXISTS "reservations_status_date_time_idx" ON "reservations"("status", "date", "time")`,
  `CREATE INDEX IF NOT EXISTS "reservations_date_time_idx" ON "reservations"("date", "time")`,
  `CREATE INDEX IF NOT EXISTS "reservations_customer_email_idx" ON "reservations"("customer_email")`,
  `CREATE INDEX IF NOT EXISTS "catering_reservations_status_event_date_idx" ON "catering_reservations"("status", "event_date")`,
  `CREATE INDEX IF NOT EXISTS "catering_reservations_confirmed_date_idx" ON "catering_reservations"("confirmed_date")`,
  `CREATE INDEX IF NOT EXISTS "catering_reservations_customer_email_idx" ON "catering_reservations"("customer_email")`,
  `CREATE INDEX IF NOT EXISTS "catering_inquiries_status_event_date_idx" ON "catering_inquiries"("status", "event_date")`,
  `CREATE INDEX IF NOT EXISTS "reservation_payments_reservation_received_idx" ON "reservation_payments"("reservation_id", "received_at")`,
  `CREATE INDEX IF NOT EXISTS "reservation_payments_catering_received_idx" ON "reservation_payments"("catering_reservation_id", "received_at")`,
  `CREATE INDEX IF NOT EXISTS "pos_transactions_created_status_idx" ON "pos_transactions"("created_at", "status")`,
  `CREATE INDEX IF NOT EXISTS "pos_items_transaction_idx" ON "pos_items"("transaction_id")`,
  `CREATE INDEX IF NOT EXISTS "inventory_transactions_material_created_idx" ON "inventory_transactions"("raw_material_id", "created_at")`,
  `CREATE INDEX IF NOT EXISTS "inventory_transactions_type_created_idx" ON "inventory_transactions"("transaction_type", "created_at")`,
  `CREATE INDEX IF NOT EXISTS "material_batches_material_disposed_expiration_idx" ON "material_batches"("raw_material_id", "is_disposed", "expiration_date")`,
  `CREATE INDEX IF NOT EXISTS "customer_feedback_status_created_idx" ON "customer_feedback"("status", "created_at")`
];

async function main() {
  for (const statement of indexStatements) {
    await prisma.$executeRawUnsafe(statement);
  }

  console.log(JSON.stringify({
    mode: "PERFORMANCE_INDEXES_APPLIED",
    indexes: indexStatements.length
  }, null, 2));
}

main()
  .catch((error: unknown) => {
    console.error("Performance index setup failed:", error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });

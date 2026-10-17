ALTER TABLE "tables"
  ADD COLUMN IF NOT EXISTS "is_archived" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS "archived_at" TIMESTAMP(3);

CREATE TABLE IF NOT EXISTS "table_combinations" (
  "id" TEXT NOT NULL,
  "name" TEXT,
  "status" TEXT NOT NULL DEFAULT 'active',
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "table_combinations_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "table_combination_members" (
  "id" TEXT NOT NULL,
  "table_combination_id" TEXT NOT NULL,
  "table_id" TEXT NOT NULL,
  "order_index" INTEGER NOT NULL DEFAULT 0,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "table_combination_members_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "table_combination_members_table_combination_id_fkey"
    FOREIGN KEY ("table_combination_id") REFERENCES "table_combinations"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "table_combination_members_table_id_fkey"
    FOREIGN KEY ("table_id") REFERENCES "tables"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "table_combination_members_table_combination_id_table_id_key" UNIQUE ("table_combination_id", "table_id")
);

CREATE INDEX IF NOT EXISTS "table_combination_members_table_combination_id_order_index_idx"
  ON "table_combination_members" ("table_combination_id", "order_index");

CREATE TABLE IF NOT EXISTS "reservation_table_assignments" (
  "id" TEXT NOT NULL,
  "reservation_id" TEXT NOT NULL,
  "table_id" TEXT NOT NULL,
  "table_combination_id" TEXT,
  "seat_count" INTEGER NOT NULL DEFAULT 0,
  "status" TEXT NOT NULL DEFAULT 'assigned',
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "reservation_table_assignments_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "reservation_table_assignments_reservation_id_fkey"
    FOREIGN KEY ("reservation_id") REFERENCES "reservations"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "reservation_table_assignments_table_id_fkey"
    FOREIGN KEY ("table_id") REFERENCES "tables"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "reservation_table_assignments_table_combination_id_fkey"
    FOREIGN KEY ("table_combination_id") REFERENCES "table_combinations"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT "reservation_table_assignments_reservation_id_table_id_key" UNIQUE ("reservation_id", "table_id")
);

CREATE INDEX IF NOT EXISTS "reservation_table_assignments_table_id_status_idx"
  ON "reservation_table_assignments" ("table_id", "status");

ALTER TABLE "pos_transactions"
    ADD COLUMN "dining_session_id" TEXT,
    ADD COLUMN "unlimited_amount" DOUBLE PRECISION NOT NULL DEFAULT 0,
    ADD COLUMN "leftover_amount" DOUBLE PRECISION NOT NULL DEFAULT 0,
    ADD COLUMN "discount_amount" DOUBLE PRECISION NOT NULL DEFAULT 0,
    ADD COLUMN "guest_count" INTEGER NOT NULL DEFAULT 0,
    ADD COLUMN "discount_guest_count" INTEGER NOT NULL DEFAULT 0;

ALTER TABLE "unlimited_sessions"
    ADD COLUMN "dining_session_id" TEXT,
    ADD COLUMN "time_limit_minutes" INTEGER NOT NULL DEFAULT 90;

CREATE INDEX "unlimited_sessions_dining_session_id_status_idx"
    ON "unlimited_sessions"("dining_session_id", "status");

CREATE TABLE "dining_table_sessions" (
    "id" TEXT NOT NULL,
    "table_id" TEXT NOT NULL,
    "cashier_id" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'active',
    "opened_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "closed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "dining_table_sessions_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "dining_table_sessions_status_check" CHECK ("status" IN ('active', 'closed'))
);

CREATE TABLE "dining_guests" (
    "id" TEXT NOT NULL,
    "dining_session_id" TEXT NOT NULL,
    "guest_number" INTEGER NOT NULL,
    "discount_type" TEXT NOT NULL DEFAULT 'none',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "dining_guests_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "dining_guests_guest_number_check" CHECK ("guest_number" > 0),
    CONSTRAINT "dining_guests_discount_type_check" CHECK ("discount_type" IN ('none', 'senior', 'pwd'))
);

CREATE TABLE "dining_orders" (
    "id" TEXT NOT NULL,
    "order_number" TEXT NOT NULL,
    "idempotency_key" TEXT NOT NULL,
    "dining_session_id" TEXT NOT NULL,
    "unlimited_session_id" TEXT,
    "order_type" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'reserved',
    "created_by" TEXT NOT NULL,
    "prepared_at" TIMESTAMP(3),
    "ready_at" TIMESTAMP(3),
    "released_at" TIMESTAMP(3),
    "cancelled_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "dining_orders_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "dining_orders_order_type_check" CHECK ("order_type" IN ('ala_carte', 'unlimited')),
    CONSTRAINT "dining_orders_status_check" CHECK ("status" IN ('reserved', 'prepared', 'ready', 'released', 'cancelled'))
);

CREATE TABLE "dining_order_items" (
    "id" TEXT NOT NULL,
    "order_id" TEXT NOT NULL,
    "guest_id" TEXT NOT NULL,
    "selling_product_id" TEXT,
    "name_snapshot" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL,
    "unit_price" DOUBLE PRECISION NOT NULL,
    "total_price" DOUBLE PRECISION NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "dining_order_items_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "dining_order_items_quantity_check" CHECK ("quantity" > 0),
    CONSTRAINT "dining_order_items_price_check" CHECK ("unit_price" >= 0 AND "total_price" >= 0)
);

CREATE TABLE "pos_transaction_charges" (
    "id" TEXT NOT NULL,
    "transaction_id" TEXT NOT NULL,
    "line_type" TEXT NOT NULL,
    "name_snapshot" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL,
    "unit_price" DOUBLE PRECISION NOT NULL,
    "total_price" DOUBLE PRECISION NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "pos_transaction_charges_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "pos_transaction_charges_quantity_check" CHECK ("quantity" > 0),
    CONSTRAINT "pos_transaction_charges_price_check" CHECK ("unit_price" >= 0 AND "total_price" >= 0)
);

CREATE TABLE "dine_in_ingredient_locks" (
    "id" TEXT NOT NULL,
    "order_id" TEXT NOT NULL,
    "raw_material_id" TEXT NOT NULL,
    "reserved_quantity" DECIMAL(12,3) NOT NULL,
    "unit" TEXT NOT NULL,
    "is_released" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "released_at" TIMESTAMP(3),
    CONSTRAINT "dine_in_ingredient_locks_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "dine_in_ingredient_locks_reserved_quantity_check" CHECK ("reserved_quantity" > 0)
);

CREATE TABLE "unlimited_extensions" (
    "id" TEXT NOT NULL,
    "unlimited_session_id" TEXT NOT NULL,
    "minutes" INTEGER NOT NULL DEFAULT 30,
    "approved_by" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "unlimited_extensions_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "unlimited_extensions_minutes_check" CHECK ("minutes" > 0)
);

CREATE UNIQUE INDEX "pos_transactions_dining_session_id_key"
    ON "pos_transactions"("dining_session_id");
CREATE UNIQUE INDEX "dining_table_sessions_one_active_per_table_key"
    ON "dining_table_sessions"("table_id") WHERE "status" = 'active';
CREATE INDEX "dining_table_sessions_table_id_status_idx"
    ON "dining_table_sessions"("table_id", "status");
CREATE UNIQUE INDEX "dining_guests_dining_session_id_guest_number_key"
    ON "dining_guests"("dining_session_id", "guest_number");
CREATE UNIQUE INDEX "dining_orders_order_number_key"
    ON "dining_orders"("order_number");
CREATE UNIQUE INDEX "dining_orders_idempotency_key_key"
    ON "dining_orders"("idempotency_key");
CREATE INDEX "dining_orders_status_created_at_idx"
    ON "dining_orders"("status", "created_at");
CREATE INDEX "dining_orders_dining_session_id_status_idx"
    ON "dining_orders"("dining_session_id", "status");
CREATE INDEX "dining_orders_unlimited_session_id_idx"
    ON "dining_orders"("unlimited_session_id");
CREATE INDEX "dining_order_items_order_id_idx"
    ON "dining_order_items"("order_id");
CREATE INDEX "dining_order_items_guest_id_idx"
    ON "dining_order_items"("guest_id");
CREATE INDEX "dining_order_items_selling_product_id_idx"
    ON "dining_order_items"("selling_product_id");
CREATE INDEX "pos_transaction_charges_transaction_id_idx"
    ON "pos_transaction_charges"("transaction_id");
CREATE UNIQUE INDEX "dine_in_ingredient_locks_order_id_raw_material_id_key"
    ON "dine_in_ingredient_locks"("order_id", "raw_material_id");
CREATE INDEX "dine_in_ingredient_locks_raw_material_id_is_released_idx"
    ON "dine_in_ingredient_locks"("raw_material_id", "is_released");
CREATE INDEX "unlimited_extensions_unlimited_session_id_created_at_idx"
    ON "unlimited_extensions"("unlimited_session_id", "created_at");

ALTER TABLE "dining_table_sessions"
    ADD CONSTRAINT "dining_table_sessions_table_id_fkey"
    FOREIGN KEY ("table_id") REFERENCES "tables"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    ADD CONSTRAINT "dining_table_sessions_cashier_id_fkey"
    FOREIGN KEY ("cashier_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "dining_guests"
    ADD CONSTRAINT "dining_guests_dining_session_id_fkey"
    FOREIGN KEY ("dining_session_id") REFERENCES "dining_table_sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "dining_orders"
    ADD CONSTRAINT "dining_orders_dining_session_id_fkey"
    FOREIGN KEY ("dining_session_id") REFERENCES "dining_table_sessions"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    ADD CONSTRAINT "dining_orders_unlimited_session_id_fkey"
    FOREIGN KEY ("unlimited_session_id") REFERENCES "unlimited_sessions"("id") ON DELETE SET NULL ON UPDATE CASCADE,
    ADD CONSTRAINT "dining_orders_created_by_fkey"
    FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "dining_order_items"
    ADD CONSTRAINT "dining_order_items_order_id_fkey"
    FOREIGN KEY ("order_id") REFERENCES "dining_orders"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    ADD CONSTRAINT "dining_order_items_guest_id_fkey"
    FOREIGN KEY ("guest_id") REFERENCES "dining_guests"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    ADD CONSTRAINT "dining_order_items_selling_product_id_fkey"
    FOREIGN KEY ("selling_product_id") REFERENCES "selling_products"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "pos_transaction_charges"
    ADD CONSTRAINT "pos_transaction_charges_transaction_id_fkey"
    FOREIGN KEY ("transaction_id") REFERENCES "pos_transactions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "dine_in_ingredient_locks"
    ADD CONSTRAINT "dine_in_ingredient_locks_order_id_fkey"
    FOREIGN KEY ("order_id") REFERENCES "dining_orders"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    ADD CONSTRAINT "dine_in_ingredient_locks_raw_material_id_fkey"
    FOREIGN KEY ("raw_material_id") REFERENCES "raw_materials"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "unlimited_sessions"
    ADD CONSTRAINT "unlimited_sessions_dining_session_id_fkey"
    FOREIGN KEY ("dining_session_id") REFERENCES "dining_table_sessions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "pos_transactions"
    ADD CONSTRAINT "pos_transactions_dining_session_id_fkey"
    FOREIGN KEY ("dining_session_id") REFERENCES "dining_table_sessions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "unlimited_extensions"
    ADD CONSTRAINT "unlimited_extensions_unlimited_session_id_fkey"
    FOREIGN KEY ("unlimited_session_id") REFERENCES "unlimited_sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    ADD CONSTRAINT "unlimited_extensions_approved_by_fkey"
    FOREIGN KEY ("approved_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

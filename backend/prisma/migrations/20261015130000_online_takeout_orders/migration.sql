CREATE TABLE "takeout_orders" (
    "id" TEXT NOT NULL,
    "order_number" TEXT NOT NULL,
    "idempotency_key" TEXT NOT NULL,
    "customer_name" TEXT NOT NULL,
    "customer_phone" VARCHAR(11) NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'confirmed',
    "payment_plan" TEXT NOT NULL,
    "payment_status" TEXT NOT NULL DEFAULT 'unpaid',
    "payment_method" TEXT,
    "payment_attempt" INTEGER NOT NULL DEFAULT 0,
    "payment_intent_reference_id" TEXT,
    "payment_transaction_id" TEXT,
    "payment_expires_at" TIMESTAMP(3),
    "subtotal" DOUBLE PRECISION NOT NULL,
    "total" DOUBLE PRECISION NOT NULL,
    "paid_at" TIMESTAMP(3),
    "prepared_at" TIMESTAMP(3),
    "ready_at" TIMESTAMP(3),
    "released_at" TIMESTAMP(3),
    "cancelled_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "takeout_orders_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "takeout_orders_amounts_check" CHECK ("subtotal" >= 0 AND "total" >= 0),
    CONSTRAINT "takeout_orders_phone_check" CHECK ("customer_phone" ~ '^[0-9]{1,11}$'),
    CONSTRAINT "takeout_orders_payment_plan_check" CHECK ("payment_plan" IN ('pay_now', 'pay_at_pickup')),
    CONSTRAINT "takeout_orders_payment_attempt_check" CHECK ("payment_attempt" >= 0),
    CONSTRAINT "takeout_orders_status_check" CHECK ("status" IN ('pending_payment', 'payment_failed', 'confirmed', 'preparing', 'ready', 'released', 'cancelled', 'expired'))
);

CREATE UNIQUE INDEX "takeout_orders_order_number_key" ON "takeout_orders"("order_number");
CREATE UNIQUE INDEX "takeout_orders_idempotency_key_key" ON "takeout_orders"("idempotency_key");
CREATE UNIQUE INDEX "takeout_orders_payment_intent_reference_id_key" ON "takeout_orders"("payment_intent_reference_id");
CREATE UNIQUE INDEX "takeout_orders_payment_transaction_id_key" ON "takeout_orders"("payment_transaction_id");
CREATE INDEX "takeout_orders_status_created_at_idx" ON "takeout_orders"("status", "created_at");
CREATE INDEX "takeout_orders_payment_status_payment_expires_at_idx" ON "takeout_orders"("payment_status", "payment_expires_at");

CREATE TABLE "takeout_order_items" (
    "id" TEXT NOT NULL,
    "order_id" TEXT NOT NULL,
    "selling_product_id" TEXT,
    "name_snapshot" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL,
    "unit_price" DOUBLE PRECISION NOT NULL,
    "total_price" DOUBLE PRECISION NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "takeout_order_items_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "takeout_order_items_quantity_check" CHECK ("quantity" > 0),
    CONSTRAINT "takeout_order_items_amounts_check" CHECK ("unit_price" >= 0 AND "total_price" >= 0),
    CONSTRAINT "takeout_order_items_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "takeout_orders"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "takeout_order_items_selling_product_id_fkey" FOREIGN KEY ("selling_product_id") REFERENCES "selling_products"("id") ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE INDEX "takeout_order_items_order_id_idx" ON "takeout_order_items"("order_id");
CREATE INDEX "takeout_order_items_selling_product_id_idx" ON "takeout_order_items"("selling_product_id");

CREATE TABLE "takeout_ingredient_locks" (
    "id" TEXT NOT NULL,
    "order_id" TEXT NOT NULL,
    "raw_material_id" TEXT NOT NULL,
    "reserved_quantity" DECIMAL(12,3) NOT NULL,
    "unit" TEXT NOT NULL,
    "is_released" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "released_at" TIMESTAMP(3),
    CONSTRAINT "takeout_ingredient_locks_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "takeout_ingredient_locks_reserved_quantity_check" CHECK ("reserved_quantity" > 0),
    CONSTRAINT "takeout_ingredient_locks_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "takeout_orders"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "takeout_ingredient_locks_raw_material_id_fkey" FOREIGN KEY ("raw_material_id") REFERENCES "raw_materials"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "takeout_ingredient_locks_order_id_raw_material_id_key" ON "takeout_ingredient_locks"("order_id", "raw_material_id");
CREATE INDEX "takeout_ingredient_locks_raw_material_id_is_released_idx" ON "takeout_ingredient_locks"("raw_material_id", "is_released");

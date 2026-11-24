ALTER TABLE "reservations"
ADD COLUMN IF NOT EXISTS "created_by" TEXT;

ALTER TABLE "catering_reservations"
ADD COLUMN IF NOT EXISTS "created_by" TEXT;

ALTER TABLE "catering_reservations"
ADD COLUMN IF NOT EXISTS "package_ids" JSONB;

ALTER TABLE "reservation_payments"
ADD COLUMN IF NOT EXISTS "override_reason" TEXT;

CREATE TABLE IF NOT EXISTS "reservation_ingredient_locks" (
    "id" TEXT NOT NULL,
    "reservation_id" TEXT NOT NULL,
    "raw_material_id" TEXT NOT NULL,
    "reserved_quantity" DECIMAL(12,3) NOT NULL,
    "unit" TEXT NOT NULL,
    "is_released" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "released_at" TIMESTAMP(3),

    CONSTRAINT "reservation_ingredient_locks_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "reservation_ingredient_locks_reservation_id_fkey"
      FOREIGN KEY ("reservation_id") REFERENCES "reservations"("id")
      ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "reservation_ingredient_locks_raw_material_id_fkey"
      FOREIGN KEY ("raw_material_id") REFERENCES "raw_materials"("id")
      ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE INDEX IF NOT EXISTS "reservation_ingredient_locks_raw_material_id_is_released_idx"
ON "reservation_ingredient_locks"("raw_material_id", "is_released");

CREATE INDEX IF NOT EXISTS "reservation_ingredient_locks_reservation_id_is_released_idx"
ON "reservation_ingredient_locks"("reservation_id", "is_released");

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

    CONSTRAINT "reservation_activity_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "reservation_activity_one_booking_check"
      CHECK (("reservation_id" IS NOT NULL) <> ("catering_reservation_id" IS NOT NULL)),
    CONSTRAINT "reservation_activity_reservation_id_fkey"
      FOREIGN KEY ("reservation_id") REFERENCES "reservations"("id")
      ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "reservation_activity_catering_reservation_id_fkey"
      FOREIGN KEY ("catering_reservation_id") REFERENCES "catering_reservations"("id")
      ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX IF NOT EXISTS "reservation_activity_reservation_id_created_at_idx"
ON "reservation_activity"("reservation_id", "created_at");

CREATE INDEX IF NOT EXISTS "reservation_activity_catering_reservation_id_created_at_idx"
ON "reservation_activity"("catering_reservation_id", "created_at");

CREATE UNIQUE INDEX IF NOT EXISTS "reservation_payments_one_refund_per_dinein_booking"
ON "reservation_payments"("reservation_id")
WHERE "reservation_id" IS NOT NULL AND "payment_stage" = 'refund';

CREATE UNIQUE INDEX IF NOT EXISTS "reservation_payments_one_refund_per_catering_booking"
ON "reservation_payments"("catering_reservation_id")
WHERE "catering_reservation_id" IS NOT NULL AND "payment_stage" = 'refund';

CREATE UNIQUE INDEX IF NOT EXISTS "reservation_payments_one_forfeiture_per_dinein_booking"
ON "reservation_payments"("reservation_id")
WHERE "reservation_id" IS NOT NULL AND "payment_stage" = 'forfeited_fee';

CREATE UNIQUE INDEX IF NOT EXISTS "reservation_payments_one_forfeiture_per_catering_booking"
ON "reservation_payments"("catering_reservation_id")
WHERE "catering_reservation_id" IS NOT NULL AND "payment_stage" = 'forfeited_fee';

CREATE TABLE IF NOT EXISTS "payment_transaction_claims" (
    "transaction_id" TEXT NOT NULL,
    "reservation_id" TEXT,
    "catering_reservation_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "payment_transaction_claims_pkey" PRIMARY KEY ("transaction_id"),
    CONSTRAINT "payment_transaction_claims_one_booking_check"
      CHECK (("reservation_id" IS NOT NULL) <> ("catering_reservation_id" IS NOT NULL)),
    CONSTRAINT "payment_transaction_claims_reservation_id_fkey"
      FOREIGN KEY ("reservation_id") REFERENCES "reservations"("id")
      ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "payment_transaction_claims_catering_reservation_id_fkey"
      FOREIGN KEY ("catering_reservation_id") REFERENCES "catering_reservations"("id")
      ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE TABLE IF NOT EXISTS "reservation_slot_capacities" (
    "id" TEXT NOT NULL,
    "service_date" VARCHAR(10) NOT NULL,
    "slot_start" VARCHAR(5) NOT NULL,
    "walk_in_pax" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "reservation_slot_capacities_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "reservation_slot_capacities_walk_in_pax_check" CHECK ("walk_in_pax" >= 0),
    CONSTRAINT "reservation_slot_capacities_service_date_slot_start_key" UNIQUE ("service_date", "slot_start")
);

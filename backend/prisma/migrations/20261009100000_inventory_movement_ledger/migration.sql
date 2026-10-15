CREATE TABLE IF NOT EXISTS "inventory_movements" (
    "id" TEXT NOT NULL,
    "raw_material_id" TEXT NOT NULL,
    "batch_id" TEXT,
    "source_type" TEXT,
    "source_reference" TEXT,
    "action" TEXT NOT NULL,
    "quantity" DECIMAL(12,3) NOT NULL,
    "unit" TEXT NOT NULL,
    "quantity_before" DECIMAL(12,3),
    "quantity_after" DECIMAL(12,3),
    "reserved_before" DECIMAL(12,3),
    "reserved_after" DECIMAL(12,3),
    "actor_id" TEXT,
    "note" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "inventory_movements_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "inventory_movements_raw_material_id_created_at_idx"
    ON "inventory_movements"("raw_material_id", "created_at");
CREATE INDEX IF NOT EXISTS "inventory_movements_source_type_source_reference_idx"
    ON "inventory_movements"("source_type", "source_reference");
CREATE INDEX IF NOT EXISTS "inventory_movements_action_created_at_idx"
    ON "inventory_movements"("action", "created_at");

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'inventory_movements_raw_material_id_fkey'
    ) THEN
        ALTER TABLE "inventory_movements"
            ADD CONSTRAINT "inventory_movements_raw_material_id_fkey"
            FOREIGN KEY ("raw_material_id") REFERENCES "raw_materials"("id")
            ON DELETE RESTRICT ON UPDATE CASCADE;
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'inventory_movements_batch_id_fkey'
    ) THEN
        ALTER TABLE "inventory_movements"
            ADD CONSTRAINT "inventory_movements_batch_id_fkey"
            FOREIGN KEY ("batch_id") REFERENCES "material_batches"("id")
            ON DELETE RESTRICT ON UPDATE CASCADE;
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'inventory_movements_actor_id_fkey'
    ) THEN
        ALTER TABLE "inventory_movements"
            ADD CONSTRAINT "inventory_movements_actor_id_fkey"
            FOREIGN KEY ("actor_id") REFERENCES "users"("id")
            ON DELETE RESTRICT ON UPDATE CASCADE;
    END IF;
END $$;

INSERT INTO "inventory_movements" (
    "id",
    "raw_material_id",
    "batch_id",
    "source_type",
    "source_reference",
    "action",
    "quantity",
    "unit",
    "quantity_before",
    "quantity_after",
    "reserved_before",
    "reserved_after",
    "actor_id",
    "note",
    "created_at"
)
SELECT
    'legacy_' || "id",
    "raw_material_id",
    "batch_id",
    'legacy',
    "reference",
    'Legacy: ' || "transaction_type",
    "quantity",
    "unit",
    NULL,
    NULL,
    NULL,
    NULL,
    "user_id",
    CASE
        WHEN "reason" IS NULL THEN 'Copied from inventory_transactions; historical before/after and booking source were not recorded.'
        ELSE 'Copied from inventory_transactions. Original reason: ' || "reason"
    END,
    "created_at"
FROM "inventory_transactions"
ON CONFLICT ("id") DO NOTHING;

CREATE OR REPLACE FUNCTION reject_inventory_movement_mutation()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
    RAISE EXCEPTION 'Inventory movements are append-only';
END;
$$;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_trigger WHERE tgname = 'inventory_movements_append_only'
    ) THEN
        CREATE TRIGGER "inventory_movements_append_only"
            BEFORE UPDATE OR DELETE ON "inventory_movements"
            FOR EACH ROW EXECUTE FUNCTION reject_inventory_movement_mutation();
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_trigger WHERE tgname = 'inventory_movements_no_truncate'
    ) THEN
        CREATE TRIGGER "inventory_movements_no_truncate"
            BEFORE TRUNCATE ON "inventory_movements"
            FOR EACH STATEMENT EXECUTE FUNCTION reject_inventory_movement_mutation();
    END IF;
END $$;

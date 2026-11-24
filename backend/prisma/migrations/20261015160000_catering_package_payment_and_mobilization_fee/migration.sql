ALTER TABLE "catering_reservations"
ADD COLUMN IF NOT EXISTS "package_total" DOUBLE PRECISION NOT NULL DEFAULT 0;

ALTER TABLE "catering_reservations"
ADD COLUMN IF NOT EXISTS "mobilization_fee" DOUBLE PRECISION NOT NULL DEFAULT 0;

UPDATE "catering_reservations"
SET "package_total" = "total_price"
WHERE "package_total" = 0
  AND "total_price" <> 0;

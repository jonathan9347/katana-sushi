ALTER TABLE "catering_reservations"
ADD COLUMN IF NOT EXISTS "package_snapshot" JSONB;

ALTER TABLE "catering_reservations"
ADD COLUMN IF NOT EXISTS "event_time" TEXT;

ALTER TABLE "catering_inquiries"
ADD COLUMN IF NOT EXISTS "event_type_other" TEXT;

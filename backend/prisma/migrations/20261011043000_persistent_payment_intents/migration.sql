ALTER TABLE "payment_intents"
ADD COLUMN IF NOT EXISTS "purpose" TEXT NOT NULL DEFAULT 'downpayment';

ALTER TABLE "payment_intents"
ADD COLUMN IF NOT EXISTS "idempotency_key" TEXT;

ALTER TABLE "payment_intents"
ADD COLUMN IF NOT EXISTS "gateway_reference" TEXT;

ALTER TABLE "payment_intents"
ADD COLUMN IF NOT EXISTS "amount" DOUBLE PRECISION NOT NULL DEFAULT 0;

ALTER TABLE "payment_intents"
ADD COLUMN IF NOT EXISTS "payment_method" TEXT NOT NULL DEFAULT 'cash';

ALTER TABLE "payment_intents"
ADD COLUMN IF NOT EXISTS "reservation_type" TEXT NOT NULL DEFAULT 'dine_in';

ALTER TABLE "payment_intents"
ADD COLUMN IF NOT EXISTS "status" TEXT NOT NULL DEFAULT 'pending';

ALTER TABLE "payment_intents"
ADD COLUMN IF NOT EXISTS "transaction_id" TEXT;

ALTER TABLE "payment_intents"
ADD COLUMN IF NOT EXISTS "paid_at" TIMESTAMP(3);

ALTER TABLE "payment_intents"
ADD COLUMN IF NOT EXISTS "expires_at" TIMESTAMP(3);

ALTER TABLE "payment_intents"
ADD COLUMN IF NOT EXISTS "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

ALTER TABLE "payment_intents"
ADD COLUMN IF NOT EXISTS "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

CREATE UNIQUE INDEX IF NOT EXISTS "payment_intents_transaction_id_key"
ON "payment_intents"("transaction_id")
WHERE "transaction_id" IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS "payment_intents_idempotency_key_key"
ON "payment_intents"("idempotency_key")
WHERE "idempotency_key" IS NOT NULL;

CREATE INDEX IF NOT EXISTS "payment_intents_booking_id_idx"
ON "payment_intents"("booking_id");

CREATE INDEX IF NOT EXISTS "payment_intents_status_created_at_idx"
ON "payment_intents"("status", "created_at");

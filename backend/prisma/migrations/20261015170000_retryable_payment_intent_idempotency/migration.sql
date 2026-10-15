DROP INDEX IF EXISTS "payment_intents_idempotency_key_key";

CREATE UNIQUE INDEX "payment_intents_idempotency_key_active_key"
ON "payment_intents"("idempotency_key")
WHERE "idempotency_key" IS NOT NULL
  AND "status" IN ('created', 'pending', 'succeeded', 'paid');

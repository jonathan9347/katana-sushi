# Katana Sushi Stability Notes

## Start Commands

- Backend dev: `cd backend && npm run dev`
- Frontend dev: `cd frontend && npm run dev`
- On Windows, stop the backend with Ctrl+C and wait for the prompt before running
  `npm run build` or `npm run prisma:generate`; a running server can hold the
  Prisma engine and cause `EPERM`. Check port 5001 before restarting.
- Backend build check: `cd backend && npm run build`
- Frontend build check: `cd frontend && npm run build`
- Database migrations: `cd backend && npm run prisma:migrate:deploy`
- Apply migrations and demo seed intentionally: `cd backend && npm run db:setup`

## Environment Variables

Backend:

- `PORT`
- `NODE_ENV`
- `DATABASE_URL`
- `DIRECT_URL`
- `JWT_SECRET`
- `JWT_EXPIRES_IN`
- `FRONTEND_URL`
- `PAYMENT_GATEWAY` (`fake` or `paymongo`)
- `PAYMONGO_SECRET_KEY`
- `PAYMONGO_WEBHOOK_SECRET`
- `PAYMONGO_PAYMENT_METHODS` (optional)
- `PAYMONGO_CHECKOUT_TTL_MINUTES` (optional)
- `FAKE_PAYMENT_MODE`
- `FAKE_PAYMENT_DELAY_MS`
- `REDIS_URL`
- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`
- `SUPABASE_STORAGE_BUCKET`
- `RESEND_API_KEY`
- `RESEND_FROM_EMAIL`
- `SEND_EMAILS_IN_DEVELOPMENT`

Frontend:

- `VITE_API_URL`

`JWT_SECRET` must be explicitly configured with a strong, private value in each
environment. Authentication fails closed if it is missing; the backend does
not use a built-in fallback secret.

## Database Rules

- Use `DATABASE_URL` for normal app queries.
- Use `DIRECT_URL` for migrations/schema work.
- Supabase pooled `DATABASE_URL` should use the pooler host with `pgbouncer=true` and a small `connection_limit`.
- `DIRECT_URL` should be the direct database connection, not the transaction pooler.
- Do not run migrations, destructive reset scripts, or smoke tests against the live database.
- Local development should use a separate development database, not the same database used by the deployed site.
- If local development and the deployed site share one database, keep the local backend stopped; local API requests may write to that database.
- Runtime startup does not create tables, alter schema, or seed demo data. Run migrations and seed commands explicitly.
- The development seed contains default staff credentials in
  `backend/prisma/seed.ts`, `backend/src/services/demoSeed.service.ts`, and the
  legacy fallback in `backend/src/app.ts`. Seeding is restricted to the local
  `katana_sushi_dev` database. Change all seeded/default credentials before any
  live deployment; never use the development accounts in production.

## Payments and Authentication

- The fake payment gateway is for testing only. In production, create-intent, status, and verify requests return `503` while the fake gateway is active.
- Customer payments use PayMongo when `PAYMENT_GATEWAY=paymongo`. See "PayMongo payments" in `DEPLOY.md` for the flow, webhook setup, and going live.
- If staff login reports that authentication is unavailable, configure `JWT_SECRET` in the backend environment. Never use a shared or hard-coded JWT secret.

## Common Errors

### Database Unreachable

Symptoms:

- Backend logs show connection retries.
- `/health` returns `database: "down"`.
- API requests return `Reconnecting, please try again.`

Fixes:

- Confirm Supabase is awake and reachable.
- Confirm `DATABASE_URL` points to the pooler URL.
- Confirm `DATABASE_URL` includes pooler options such as `pgbouncer=true` and `connection_limit`.
- Confirm `DIRECT_URL` points to the direct database URL for migrations.
- Retry after Supabase finishes resuming.

### Prisma Engine Locked On Windows

Symptoms:

- `prisma generate` fails with `EPERM ... query_engine-windows.dll.node`.

Fixes:

- Stop running backend Node processes that may hold Prisma.
- Or use `set PRISMA_GENERATE_NO_ENGINE=1&& npm run build` for a compile check.

### Port In Use

Symptoms:

- Backend or frontend cannot bind to its port.

Fixes:

- Stop the existing dev server using that port.
- Backend default port is `5001`.
- Frontend default port is `5173`.

### Payment Button Stops After Restart

Expected stable behavior:

- Payment intents are stored in the database.
- Repeated create calls can reuse an active intent through an idempotency key.
- Verified payment state can be recovered after a backend restart.

If it fails:

- Confirm migrations have created the `payment_intents` table.
- Check `/api/payments/status/:referenceId`.
- In fake mode, confirm `PAYMENT_GATEWAY=fake`.

## Future Items

- Decide whether reservation time slots need a gap between bookings.
- Correct inconsistent recipe/material unit mappings before relying on catering ingredient locks; do not guess unit conversions.

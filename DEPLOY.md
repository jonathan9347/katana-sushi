Deployment notes
================

1) Set environment variables in Render dashboard (do NOT commit secrets in repo):

- `DATABASE_URL`: Supabase Transaction pooler URL on port `6543`, with `pgbouncer=true` and `sslmode=require`. Use this URL for application traffic.
- `DIRECT_URL`: Supabase Session pooler URL on port `5432` (or the direct database URL when the host supports IPv6), with `sslmode=require`. Prisma uses this URL for schema operations.
- `NODE_ENV`: `production`
- `PORT`: `5001`
- `JWT_SECRET`: secure random secret
- `FRONTEND_URL`: the customer site URL (for example `https://katana-sushi.vercel.app`); PayMongo returns customers here.
- `PAYMENT_GATEWAY`: `paymongo`
- `PAYMONGO_SECRET_KEY`: PayMongo secret key (`sk_test_...` while testing, `sk_live_...` when live)
- `PAYMONGO_WEBHOOK_SECRET`: secret of the registered webhook (`whsk_...`, see "PayMongo payments" below)

Set these values in the Render dashboard. The backend Render blueprint leaves the secrets unsynchronized so database credentials and JWT secrets are not committed to the repository. Copy the pooler URLs from the Supabase dashboard; do not reuse the transaction pooler URL for `DIRECT_URL`.

2) Redeploy steps on Render

- Open your service -> Environment -> Set variables above
- Trigger a manual deploy or push a commit to `main`
- Watch build logs: `npm run build` regenerates Prisma Client from `prisma/schema.prisma` before TypeScript compilation.

4) Health check

- The backend exposes a lightweight health endpoint at `GET /health` which returns 200 and a JSON payload. Use this URL in Render's health check settings or external uptime monitors.

3) IPv6 note

If your Postgres host resolves only to IPv6 and Render cannot reach IPv6 hosts from its network, the app will fail to connect. Use an IPv4-capable DB endpoint or contact Render support.

4) Local development

- Copy `backend/.env.example` to `backend/.env` and fill values for local testing.
- The Render blueprint builds from the repository root so the API can serve the shared images in `frontend/public/images`; keep those assets in the deployment checkout.

5) PayMongo payments

Catering payments (50% downpayment, full package payment, and the remaining balance) use PayMongo's hosted Checkout. Customers choose QR Ph, card, GCash, or Maya on PayMongo's page.

How a payment flows:

1. The customer submits a catering request. The booking is saved as pending approval with the initial payment unpaid.
2. The API creates a PayMongo checkout session for the amount the server computes from the booking, and the browser goes to PayMongo.
3. After paying, PayMongo sends the customer to `/payment/return?reference=...`. That page polls `GET /api/payments/status/:reference`, which reads the session back from PayMongo.
4. PayMongo also calls `POST /api/payments/paymongo/webhook`. The API checks the `Paymongo-Signature`, re-reads the session from PayMongo, and records the payment on the booking. Payment is recorded even if the customer closes the tab.
5. Staff can approve the request only after the initial payment is recorded.

Setup:

- Register the webhook once per PayMongo key (test and live keys need separate webhooks). PayMongo only calls public HTTPS URLs:

  ```
  cd backend
  npm run paymongo:webhook -- create https://<render-api-host>/api/payments/paymongo/webhook
  ```

  Copy the printed `whsk_...` secret into `PAYMONGO_WEBHOOK_SECRET` on Render. `npm run paymongo:webhook -- list` shows existing webhooks.
- Without the webhook secret, payments still complete while the customer waits on the return page. A customer who closes the tab early is not recorded until someone opens that payment's status again.
- Set the business name and logo in the PayMongo dashboard; they appear on the checkout page.
- Test mode: with `sk_test_` keys, use PayMongo's "Simulate payment" link or test cards. No real money moves.
- Going live: switch to `sk_live_` keys, register a live webhook, and update `PAYMONGO_WEBHOOK_SECRET`.
- Refunds are not automated; issue them from the PayMongo dashboard using the `pay_...` reference shown on the booking.

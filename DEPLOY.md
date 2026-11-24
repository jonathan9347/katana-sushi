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
- `PAYMONGO_PUBLIC_KEY`: PayMongo public key from the same mode (`pk_test_...` or `pk_live_...`), used by the card form
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

Catering payments (50% downpayment, full package payment, and the remaining balance) use Katana's own payment page at `/payment/:reference`, built on PayMongo's Payment Intents API. The page header shows "Katana Sushi Catering"; customers choose QR Ph, card, GCash, or Maya there.

How a payment flows:

1. The customer submits a catering request. The booking is saved as pending approval with the initial payment unpaid.
2. The API opens a PayMongo payment intent for the amount the server computes from the booking, and the customer lands on the payment page.
3. The customer picks a method and presses Pay (`POST /api/payments/:reference/pay`):
   - QR Ph: the page shows the QR code with a countdown and checks every few seconds until it is paid.
   - GCash or Maya: the browser goes to the wallet's approval page, then back to `/payment/return?reference=...`.
   - Card: the browser sends the card details straight to PayMongo with the public key; only the `pm_...` id reaches the API. Cards that need 3-D Secure go to the bank's page and come back the same way.
4. PayMongo also calls `POST /api/payments/paymongo/webhook` (`payment.paid`). The API checks the `Paymongo-Signature`, re-reads the payment intent from PayMongo, and records the payment on the booking. Payment is recorded even if the customer closes the tab.
5. Staff can approve the request only after the initial payment is recorded.

Setup:

- Set `PAYMONGO_SECRET_KEY` and `PAYMONGO_PUBLIC_KEY` from the same mode (both test or both live). Without the public key, the Card option is hidden.
- Register the webhook once per PayMongo key (test and live keys need separate webhooks). PayMongo only calls public HTTPS URLs:

  ```
  cd backend
  npm run paymongo:webhook -- create https://<render-api-host>/api/payments/paymongo/webhook
  ```

  Copy the printed `whsk_...` secret into `PAYMONGO_WEBHOOK_SECRET` on Render. `npm run paymongo:webhook -- list` shows existing webhooks, and `npm run paymongo:webhook -- update <hook_id> <url>` switches an existing webhook to the current events (`payment.paid`, `payment.failed`, `checkout_session.payment.paid`) without changing its secret.
- Without the webhook, payments still complete while the customer is on the payment or return page. A customer who closes the tab early is not recorded until someone opens that payment's status again.
- Receipts and wallet screens from PayMongo show the PayMongo account's business name; set it to "Katana Sushi" in the PayMongo dashboard. Card statements show `KATANA SUSHI`.
- Test mode: with test keys, the QR screen shows a "simulate scanning" link, and PayMongo's test cards work (for example 4343 4343 4343 4345). No real money moves.
- Going live: switch both keys to live keys, register a live webhook, and update `PAYMONGO_WEBHOOK_SECRET`.
- Refunds are not automated; issue them from the PayMongo dashboard using the `pay_...` reference shown on the booking.

6) Email and SMS notifications

Customers get an email and a text message when a reservation is confirmed or declined, and when a catering request is received (paid) or confirmed. The admin Settings switches "Email notifications" and "SMS notifications" turn each channel on or off; SMS is off until an admin turns it on.

Email (Gmail SMTP, no domain needed):

- Turn on 2-Step Verification for the Gmail account, then create an App Password at https://myaccount.google.com/apppasswords.
- Set on Render: `SMTP_USER` (the Gmail address), `SMTP_PASS` (the 16-letter App Password), and `EMAIL_FROM` (for example `Katana Sushi <yourname@gmail.com>`; the address must be the same Gmail account). `SMTP_HOST` defaults to `smtp.gmail.com` and `SMTP_PORT` to `465` (SSL/TLS); use `587` for STARTTLS.
- A personal Gmail account sends to about 500 recipients a day. With your own domain later, the same settings work with that provider's SMTP host.

SMS (TextBee):

- TextBee sends texts through the restaurant's Android phone running the TextBee app; the phone must stay online, charged, and have load.
- Set on Render: `TEXTBEE_API_KEY` and `TEXTBEE_DEVICE_ID` (shown in the TextBee dashboard).
- Customer numbers like `09171234567` are sent as `+639171234567`.

Locally, nothing is sent unless `SEND_EMAILS_IN_DEVELOPMENT=true` or `SEND_SMS_IN_DEVELOPMENT=true`; messages are printed to the backend log instead.

7) Staff password reset and account setup (Supabase email codes)

Staff sign-ins stay in Katana's own database. Supabase Auth is used only to email a one-time code and confirm it, so staff can reset a forgotten password or set the first password on a new account.

- "Forgot password?" on `/staff/login` opens `/staff/forgot-password`: the staff member enters their email, receives a code, and enters it with a new password. Only active staff accounts get a code; the page shows the same message for unknown emails.
- When an admin adds a user with "Email them a setup code" ticked, no password is set; the new staff member receives a code and chooses their own password on the same page.
- Limits: one code per email per minute, and 5 wrong codes lock that email for 15 minutes. Each reset is recorded in the activity log.

Setup in the Supabase dashboard (project `jiewnzbjaiddzbwcjjvm`):

1. Render: set `SUPABASE_URL=https://jiewnzbjaiddzbwcjjvm.supabase.co` and `SUPABASE_ANON_KEY` (Project Settings -> API -> anon/public key).
2. Authentication -> Providers -> Email: keep Email enabled and allow new users to sign up (codes create a Supabase Auth user the first time).
3. Authentication -> URL Configuration: set Site URL to the customer site, for example `https://katana-sushi-sage.vercel.app`.
4. Authentication -> Emails -> Templates: edit both "Magic Link" and "Confirm signup" so the email shows the code, for example:

   ```html
   <h2>Your Katana Sushi staff code</h2>
   <p>Your one-time code is <strong>{{ .Token }}</strong>. It expires in about an hour.</p>
   <p><a href="{{ .SiteURL }}/staff/forgot-password?step=code&email={{ .Email }}">Enter the code</a></p>
   <p>If you didn't ask for this, you can ignore this email.</p>
   ```

5. Authentication -> Emails -> SMTP Settings: turn on custom SMTP with the same Gmail account (host `smtp.gmail.com`, port `465`, the Gmail address as username, the App Password as password, sender name "Katana Sushi"). Supabase's built-in email only sends a few messages per hour.

Deployment notes
================

1) Set environment variables in Render dashboard (do NOT commit secrets in repo):

- `DATABASE_URL`: Supabase Transaction pooler URL on port `6543`, with `pgbouncer=true` and `sslmode=require`. Use this URL for application traffic.
- `DIRECT_URL`: Supabase Session pooler URL on port `5432` (or the direct database URL when the host supports IPv6), with `sslmode=require`. Prisma uses this URL for schema operations.
- `NODE_ENV`: `production`
- `PORT`: `5001`
- `JWT_SECRET`: secure random secret

Set these values in the Render dashboard. The backend Render blueprint leaves the secrets unsynchronized so database credentials and JWT secrets are not committed to the repository. Copy the pooler URLs from the Supabase dashboard; do not reuse the transaction pooler URL for `DIRECT_URL`.

2) Redeploy steps on Render

- Open your service -> Environment -> Set variables above
- Trigger a manual deploy or push a commit to `main`
- Watch build logs: `npm run prisma:generate` should complete successfully

4) Health check

- The backend exposes a lightweight health endpoint at `GET /health` which returns 200 and a JSON payload. Use this URL in Render's health check settings or external uptime monitors.

3) IPv6 note

If your Postgres host resolves only to IPv6 and Render cannot reach IPv6 hosts from its network, the app will fail to connect. Use an IPv4-capable DB endpoint or contact Render support.

4) Local development

- Copy `backend/.env.example` to `backend/.env` and fill values for local testing.

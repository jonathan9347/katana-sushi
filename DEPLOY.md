Deployment notes
================

1) Set environment variables in Render dashboard (do NOT commit secrets in repo):

- `DATABASE_URL`: postgresql://<DB_USER>:<DB_PASSWORD>@<DB_HOST>:5432/<DB_NAME>?sslmode=require
- `DIRECT_URL`: same as `DATABASE_URL`
- `NODE_ENV`: `production`
- `PORT`: `5001`
- `JWT_SECRET`: secure random secret

2) Redeploy steps on Render

- Open your service -> Environment -> Set variables above
- Trigger a manual deploy or push a commit to `main`
- Watch build logs: `npm run prisma:generate` should complete successfully

3) IPv6 note

If your Postgres host resolves only to IPv6 and Render cannot reach IPv6 hosts from its network, the app will fail to connect. Use an IPv4-capable DB endpoint or contact Render support.

4) Local development

- Copy `backend/.env.example` to `backend/.env` and fill values for local testing.

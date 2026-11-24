# Safe Prisma commands

Run Prisma commands from `backend/scripts/prisma-safe.ps1`, not directly through `npx prisma` or npm scripts. The wrapper requires an explicit `-Target`, prints only the host and database name for both configured URLs, refuses when `DATABASE_URL` and `DIRECT_URL` disagree, and sets both process variables to the selected target.

From the backend directory:

```powershell
.\scripts\prisma-safe.ps1 -Target katana_sushi_dev -PrismaArgs @('validate', '--schema=prisma/schema.prisma')
```

For a specifically approved restored test copy, use `-Retarget`; this changes both effective URLs to that database while preserving the configured connection settings:

```powershell
.\scripts\prisma-safe.ps1 -Target katana_sushi_dev_step4_6_YYYYMMDD_HHMMSS -Retarget -PrismaArgs @('validate', '--schema=prisma/schema.prisma')
```

Commands that generate files or write database state also require `-AllowWrite`. `db push`, `db execute`, `migrate dev`, and `migrate reset` are blocked. `migrate deploy` additionally requires `-ApprovedDeploySequence` and may only be run during the explicitly approved backend stop-and-start deployment sequence. Never use it as a test command. Test migration SQL on restored copies with `psql`, then use read-only `prisma migrate diff` to verify schema agreement.

Do not run `prisma generate` while the backend is running. The wrapper does not replace the approval, fresh-dump, backend-stop, post-migration verification, restart, and health-check gates for deployment.

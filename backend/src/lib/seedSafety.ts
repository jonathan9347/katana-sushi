import { PrismaClient } from "@prisma/client";

const DEVELOPMENT_DATABASE = "katana_sushi_dev";

export async function assertDevelopmentDatabase(prisma: PrismaClient) {
  if (process.env.NODE_ENV === "production") {
    throw new Error("Demo seeding is disabled in production.");
  }

  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error("Demo seeding requires DATABASE_URL to target the development database.");
  }

  let parsedUrl: URL;
  try {
    parsedUrl = new URL(databaseUrl);
  } catch {
    throw new Error("Demo seeding requires a valid development DATABASE_URL.");
  }

  const configuredDatabase = decodeURIComponent(parsedUrl.pathname.replace(/^\/+/, ""));
  const isLoopback = ["localhost", "127.0.0.1", "::1"].includes(parsedUrl.hostname);
  if (!isLoopback || configuredDatabase !== DEVELOPMENT_DATABASE) {
    throw new Error("Demo seeding is restricted to the local katana_sushi_dev database.");
  }

  const rows = await prisma.$queryRaw<Array<{ current_database: string }>>`
    SELECT current_database() AS current_database
  `;
  if (rows[0]?.current_database !== DEVELOPMENT_DATABASE) {
    throw new Error("Connected database is not the approved development database; refusing to seed.");
  }
}

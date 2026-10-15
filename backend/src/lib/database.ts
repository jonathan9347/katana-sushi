import { prisma } from "./prisma";

type DatabaseState = {
  database: "starting" | "up" | "down" | "shutting_down";
  lastConnectedAt?: string;
  lastError?: string;
};

const databaseState: DatabaseState = {
  database: "starting"
};

let monitor: NodeJS.Timeout | null = null;
let connectionConfigChecked = false;

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

function delay(milliseconds: number) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function validateConnectionConfig() {
  if (connectionConfigChecked) {
    return;
  }
  connectionConfigChecked = true;

  const databaseUrl = process.env.DATABASE_URL?.trim();
  const directUrl = process.env.DIRECT_URL?.trim();

  if (!databaseUrl) {
    console.warn("DATABASE_URL is not set. Normal app queries cannot connect to the database.");
  } else {
    try {
      const parsed = new URL(databaseUrl);
      const pgbouncer = parsed.searchParams.get("pgbouncer");
      const connectionLimit = parsed.searchParams.get("connection_limit");

      if (parsed.port === "6543" && pgbouncer !== "true") {
        console.warn("DATABASE_URL points at the Supabase pooler but is missing pgbouncer=true.");
      }

      if (parsed.port === "6543" && !connectionLimit) {
        console.warn("DATABASE_URL is missing connection_limit. For Supabase pooler usage, set a small connection_limit such as 1.");
      }
    } catch {
      console.warn("DATABASE_URL is not a valid PostgreSQL URL.");
    }
  }

  if (!directUrl) {
    console.warn("DIRECT_URL is not set. Prisma migrations need a direct database connection.");
  }
}

export function getDatabaseStatus() {
  return { ...databaseState };
}

export function markDatabaseDown(error: unknown) {
  if (databaseState.database !== "shutting_down") {
    databaseState.database = "down";
  }
  databaseState.lastError = errorMessage(error);
}

async function probeDatabase() {
  await prisma.$queryRaw`SELECT 1`;
  databaseState.database = "up";
  databaseState.lastConnectedAt = new Date().toISOString();
  databaseState.lastError = undefined;
}

export async function checkDatabaseHealth() {
  try {
    await probeDatabase();
    return true;
  } catch (error) {
    markDatabaseDown(error);
    return false;
  }
}

export async function connectDatabaseUntilReady(isShuttingDown: () => boolean) {
  let attempt = 1;
  validateConnectionConfig();

  while (!isShuttingDown()) {
    try {
      await prisma.$connect();
      await probeDatabase();
      console.log("Database connection ready.");
      return true;
    } catch (error) {
      markDatabaseDown(error);
      const waitMs = Math.min(30_000, attempt * 2_000);
      console.error(`Database connection attempt ${attempt} failed: ${errorMessage(error)}`);
      console.error(`Retrying database connection in ${Math.round(waitMs / 1000)}s.`);
      attempt += 1;
      await delay(waitMs);
    }
  }

  return false;
}

export function startDatabaseMonitor() {
  if (monitor) {
    return monitor;
  }

  monitor = setInterval(() => {
    void checkDatabaseHealth();
  }, 10_000);
  monitor.unref?.();
  return monitor;
}

export async function disconnectDatabase() {
  databaseState.database = "shutting_down";
  if (monitor) {
    clearInterval(monitor);
    monitor = null;
  }
  await prisma.$disconnect();
}

import path from "path";
import dotenv from "dotenv";
import { Server } from "http";
import { connectDatabaseUntilReady, disconnectDatabase, startDatabaseMonitor } from "./lib/database";

// Load .env file only in development (won't exist in production on Render)
if (process.env.NODE_ENV !== "production") {
  dotenv.config({ path: path.resolve(__dirname, "..", ".env") });
}

const port = Number(process.env.PORT ?? 5001);
let shuttingDown = false;
let server: Server | null = null;
let autoCompleteTask: NodeJS.Timeout | null = null;
let takeoutExpiryTask: NodeJS.Timeout | null = null;

async function startServer() {
  console.log("Starting Katana Sushi API...");

  const connected = await connectDatabaseUntilReady(() => shuttingDown);
  if (!connected) {
    return;
  }

  // Import only after environment configuration and database readiness.
  const appModule: typeof import("./app") = require("./app");
  const { default: app, startAutoCompleteTask, startTakeoutExpiryTask } = appModule;

  server = app.listen(port, () => {
    console.log(`Katana Sushi API running on http://localhost:${port}`);
    autoCompleteTask = startAutoCompleteTask();
    takeoutExpiryTask = startTakeoutExpiryTask();
    startDatabaseMonitor();
  });

  const shutdown = async (signal: string) => {
    if (shuttingDown) return;
    shuttingDown = true;
    console.log(`${signal} received. Closing Katana Sushi API...`);

    if (autoCompleteTask) {
      clearInterval(autoCompleteTask);
      autoCompleteTask = null;
    }
    if (takeoutExpiryTask) {
      clearInterval(takeoutExpiryTask);
      takeoutExpiryTask = null;
    }

    const finish = async () => {
      await disconnectDatabase();
      process.exit(0);
    };

    if (server) {
      server.close(() => {
        void finish();
      });
      return;
    }

    await finish();
  };

  process.on("SIGINT", () => void shutdown("SIGINT"));
  process.on("SIGTERM", () => void shutdown("SIGTERM"));
}

startServer().catch((error) => {
  console.error("Failed to start server:", error);
  process.exit(1);
});

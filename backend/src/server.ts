import path from "path";
import dotenv from "dotenv";
import app, { ensureDemoSeed, startAutoCompleteTask } from "./app";

// Load .env file only in development (won't exist in production on Render)
if (process.env.NODE_ENV !== "production") {
  dotenv.config({ path: path.resolve(__dirname, "..", ".env") });
}

const port = Number(process.env.PORT ?? 5001);

async function startServer() {
  console.log("Starting Katana Sushi API...");
  
  // Seed database before accepting requests
  await ensureDemoSeed();
  
  app.listen(port, () => {
    console.log(`✓ Katana Sushi API running on http://localhost:${port}`);
    // Start background tasks after server is fully running
    startAutoCompleteTask();
  });
}

startServer().catch((error) => {
  console.error("Failed to start server:", error);
  process.exit(1);
});

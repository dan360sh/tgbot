import { config } from "./config";
import { createApp } from "./server/app";
import { botManager } from "./bot/manager";
import { prisma } from "./db";

// GramJS periodically throws TIMEOUT in the update loop — safe to ignore
process.on("unhandledRejection", (reason: any) => {
  if (reason?.message === "TIMEOUT") return;
  console.error("Unhandled rejection:", reason);
});

async function main() {
  // Start bots for all users with saved sessions
  await botManager.startAll();

  // Start HTTP server
  const app = createApp();
  app.listen(config.port, () => {
    console.log(`🚀 Server running at http://localhost:${config.port}`);
  });
}

main().catch(async (err) => {
  console.error("Fatal error:", err);
  await prisma.$disconnect();
  process.exit(1);
});

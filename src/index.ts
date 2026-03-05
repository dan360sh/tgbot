import { config } from "./config";
import { createApp } from "./server/app";
import { botManager } from "./bot/manager";
import { prisma } from "./db";

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

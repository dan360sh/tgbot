import { config } from "./config";
import { createApp } from "./server/app";
import { botManager } from "./bot/manager";
import { startWriteFirstScheduler } from "./bot/writeFirst";
import { startTonChecker } from "./bot/tonChecker";
import { prisma } from "./db";

// GramJS periodically prints and throws TIMEOUT in the update loop — safe to ignore
const _origConsoleError = console.error.bind(console);
console.error = (...args: any[]) => {
  if (args[0] instanceof Error && args[0].message === "TIMEOUT") return;
  if (typeof args[0] === "string" && args[0].includes("TIMEOUT")) return;
  _origConsoleError(...args);
};
process.on("unhandledRejection", (reason: any) => {
  if (reason?.message === "TIMEOUT") return;
  _origConsoleError("Unhandled rejection:", reason);
});

async function main() {
  // Start bots for all users with saved sessions
  await botManager.startAll();

  // Start write-first scheduler
  startWriteFirstScheduler();

  // Start TON payment checker
  startTonChecker();

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

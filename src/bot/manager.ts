import { TelegramClient } from "telegram";
import { StringSession } from "telegram/sessions";
import { config } from "../config";
import { prisma } from "../db";
import { setupHandler } from "./handler";

class BotManager {
  private clients = new Map<number, TelegramClient>(); // dbUserId -> client

  async startAll() {
    const users = await prisma.user.findMany({
      where: { sessionString: { not: null } },
    });

    console.log(`🤖 Starting bots for ${users.length} user(s)...`);

    for (const user of users) {
      if (user.sessionString) {
        await this.startClient(user.telegramId, user.sessionString, user.id).catch((err) =>
          console.error(`Failed to start bot for user ${user.id}:`, err.message)
        );
      }
    }
  }

  async startClient(telegramId: bigint, sessionString: string, dbUserIdParam?: number) {
    let dbUserId = dbUserIdParam;
    if (!dbUserId) {
      const user = await prisma.user.findUnique({ where: { telegramId } });
      if (!user) throw new Error("User not found");
      dbUserId = user.id;
    }

    // Stop existing client if any
    await this.stopClient(dbUserId);

    const client = new TelegramClient(
      new StringSession(sessionString),
      config.telegramApiId,
      config.telegramApiHash,
      { connectionRetries: 10, useWSS: true, autoReconnect: true }
    );

    await client.connect();

    if (!await client.isUserAuthorized()) {
      console.warn(`User ${dbUserId} session expired`);
      return;
    }

    setupHandler(client, telegramId, dbUserId);
    this.clients.set(dbUserId, client);
    console.log(`✅ Bot started for user ${dbUserId}`);
  }

  async stopClient(dbUserId: number) {
    const existing = this.clients.get(dbUserId);
    if (existing) {
      await existing.disconnect().catch(() => {});
      this.clients.delete(dbUserId);
    }
  }

  getClient(dbUserId: number): TelegramClient | undefined {
    return this.clients.get(dbUserId);
  }
}

export const botManager = new BotManager();

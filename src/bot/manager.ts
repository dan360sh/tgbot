import { TelegramClient } from "telegram";
import { StringSession } from "telegram/sessions";
import { config } from "../config";
import { prisma } from "../db";
import { setupHandler } from "./handler";

const SESSION_SAVE_INTERVAL_MS = 2 * 60 * 1000; // save session every 2 minutes if changed

class BotManager {
  private clients = new Map<number, TelegramClient>(); // dbUserId -> client
  private sessionTimers = new Map<number, NodeJS.Timeout>();

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

    // Periodically persist session string to DB (GramJS updates it on DC migration/key rotation)
    this.startSessionPersist(dbUserId, client);
  }

  private startSessionPersist(dbUserId: number, client: TelegramClient) {
    const existing = this.sessionTimers.get(dbUserId);
    if (existing) clearInterval(existing);

    let lastSaved = client.session.save() as unknown as string;

    const timer = setInterval(async () => {
      try {
        const current = client.session.save() as unknown as string;
        if (current && current !== lastSaved) {
          await prisma.user.update({
            where: { id: dbUserId },
            data: { sessionString: current },
          });
          lastSaved = current;
          console.log(`[session] Saved updated session for user ${dbUserId}`);
        }
      } catch (err: any) {
        console.warn(`[session] Failed to save session for user ${dbUserId}:`, err?.message);
      }
    }, SESSION_SAVE_INTERVAL_MS);

    this.sessionTimers.set(dbUserId, timer);
  }

  async stopClient(dbUserId: number) {
    const timer = this.sessionTimers.get(dbUserId);
    if (timer) {
      clearInterval(timer);
      this.sessionTimers.delete(dbUserId);
    }

    const existing = this.clients.get(dbUserId);
    if (existing) {
      // Save session before disconnect
      try {
        const current = existing.session.save() as unknown as string;
        if (current) {
          await prisma.user.update({ where: { id: dbUserId }, data: { sessionString: current } });
        }
      } catch {}
      await existing.disconnect().catch(() => {});
      this.clients.delete(dbUserId);
    }
  }

  getClient(dbUserId: number): TelegramClient | undefined {
    return this.clients.get(dbUserId);
  }
}

export const botManager = new BotManager();

import { Router } from "express";
import { TelegramClient } from "telegram";
import { StringSession } from "telegram/sessions";
import * as QRCode from "qrcode";
import * as crypto from "crypto";
import { config } from "../../config";
import { prisma } from "../../db";
import { botManager } from "../../bot/manager";
import { authMiddleware } from "../middleware/auth";

const router = Router();

interface PendingSession {
  client: TelegramClient;
  qrBase64: string | null;
  status: "pending" | "need_2fa" | "success" | "error";
  token: string | null;
  error: string | null;
  resolve2fa: ((pass: string) => void) | null;
}

const pending = new Map<string, PendingSession>();

// Cleanup stale sessions after 5 min
setInterval(() => {
  const now = Date.now();
  for (const [id, _] of pending) {
    // Simple cleanup — in production use timestamps
    if (pending.size > 100) pending.delete(id);
  }
}, 60_000);

router.post("/qr/start", async (req, res) => {
  const sessionId = crypto.randomBytes(16).toString("hex");
  const client = new TelegramClient(new StringSession(""), config.telegramApiId, config.telegramApiHash, {
    connectionRetries: 3,
    useWSS: true,
  });

  const session: PendingSession = {
    client,
    qrBase64: null,
    status: "pending",
    token: null,
    error: null,
    resolve2fa: null,
  };
  pending.set(sessionId, session);

  // Run auth in background
  client.connect().then(() =>
    client.signInUserWithQrCode(
      { apiId: config.telegramApiId, apiHash: config.telegramApiHash },
      {
        qrCode: async (code) => {
          const url = `tg://login?token=${code.token.toString("base64url")}`;
          session.qrBase64 = await QRCode.toDataURL(url);
        },
        password: async () => {
          session.status = "need_2fa";
          return new Promise<string>((resolve) => {
            session.resolve2fa = resolve;
          });
        },
        onError: async (err) => {
          console.error("QR auth error:", err.message);
          return false;
        },
      }
    )
  ).then(async () => {
    const sessionString = client.session.save() as unknown as string;
    const me = await client.getMe();
    const token = crypto.randomBytes(32).toString("hex");
    const telegramId = BigInt(me.id.toString());

    const dbUser = await prisma.user.upsert({
      where: { telegramId },
      create: { telegramId, username: me.username ?? null, firstName: me.firstName ?? null, sessionString, token },
      update: { sessionString, token, username: me.username ?? null, firstName: me.firstName ?? null },
    });

    // Create default groups for new users
    const existingGroups = await prisma.group.count({ where: { userId: dbUser.id } });
    if (existingGroups === 0) {
      const assistantGroup = await prisma.group.create({
        data: {
          userId: dbUser.id,
          name: "Ассистент",
          systemPrompt: "Ты — вежливый и полезный ассистент. Отвечай кратко, по делу и дружелюбно. Старайся помочь собеседнику решить его вопрос. Не раскрывай, что ты AI.",
          isDefault: true,
        },
      });
      await prisma.group.create({
        data: {
          userId: dbUser.id,
          name: "Менеджер",
          systemPrompt: "Ты — профессиональный менеджер по работе с клиентами. Общайся вежливо, официально и по делу. Уточняй детали запроса, предлагай решения. Не раскрывай, что ты AI.",
          isDefault: true,
        },
      });
      // Set Ассистент as default group for new users
      await prisma.user.update({
        where: { id: dbUser.id },
        data: { defaultGroupId: assistantGroup.id },
      });
    }

    await botManager.startClient(telegramId, sessionString);

    session.status = "success";
    session.token = token;
  }).catch((err) => {
    session.status = "error";
    session.error = err.message;
  });

  res.json({ sessionId });
});

router.get("/qr/poll/:sessionId", (req, res) => {
  const session = pending.get(req.params.sessionId);
  if (!session) {
    res.status(404).json({ error: "Session not found" });
    return;
  }
  res.json({
    status: session.status,
    qrBase64: session.qrBase64,
    token: session.token,
    error: session.error,
  });
});

router.post("/qr/:sessionId/2fa", (req, res) => {
  const session = pending.get(req.params.sessionId);
  if (!session?.resolve2fa) {
    res.status(400).json({ error: "No 2FA pending" });
    return;
  }
  session.resolve2fa(req.body.password ?? "");
  session.resolve2fa = null;
  session.status = "pending";
  res.json({ ok: true });
});

router.get("/me", authMiddleware, (req, res) => {
  const user = (req as any).user;
  res.json({
    id: user.id,
    telegramId: user.telegramId.toString(),
    username: user.username,
    firstName: user.firstName,
    responseMode: user.responseMode,
    paused: user.paused,
    newcomersEnabled: user.newcomersEnabled,
    openrouterModel: user.openrouterModel,
    defaultGroupId: user.defaultGroupId,
    newcomersGroupId: user.newcomersGroupId,
  });
});

router.post("/logout", authMiddleware, async (req, res) => {
  const user = (req as any).user;
  await prisma.user.update({ where: { id: user.id }, data: { token: null } });
  res.json({ ok: true });
});

export default router;

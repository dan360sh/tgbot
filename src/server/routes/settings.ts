import { Router } from "express";
import { prisma } from "../../db";
import { authMiddleware } from "../middleware/auth";
import { botManager } from "../../bot/manager";

const router = Router();
router.use(authMiddleware);

router.get("/", async (req, res) => {
  const user = (req as any).user;
  res.json({
    responseMode: user.responseMode,
    paused: user.paused,
    newcomersEnabled: user.newcomersEnabled,
    newcomersGroupId: user.newcomersGroupId,
    defaultGroupId: user.defaultGroupId,
    defaultSystemPrompt: user.defaultSystemPrompt,
    openrouterApiKey: user.openrouterApiKey ? "***" : null,
    openrouterModel: user.openrouterModel,
  });
});

router.patch("/", async (req, res) => {
  const user = (req as any).user;
  const {
    responseMode, paused, newcomersEnabled, newcomersGroupId,
    defaultGroupId, defaultSystemPrompt, openrouterApiKey, openrouterModel,
  } = req.body;

  const data: any = {};
  if (responseMode !== undefined) data.responseMode = responseMode;
  if (paused !== undefined) data.paused = paused;
  if (newcomersEnabled !== undefined) data.newcomersEnabled = newcomersEnabled;
  if (newcomersGroupId !== undefined) data.newcomersGroupId = newcomersGroupId ? parseInt(newcomersGroupId) : null;
  if (defaultGroupId !== undefined) data.defaultGroupId = defaultGroupId ? parseInt(defaultGroupId) : null;
  if (defaultSystemPrompt !== undefined) data.defaultSystemPrompt = defaultSystemPrompt;
  if (openrouterApiKey !== undefined) data.openrouterApiKey = openrouterApiKey;
  if (openrouterModel !== undefined) data.openrouterModel = openrouterModel;

  await prisma.user.update({ where: { id: user.id }, data });
  res.json({ ok: true });
});

// Scan existing dialogs and mark all as known
router.post("/scan-dialogs", async (req, res) => {
  const user = (req as any).user;
  const client = botManager.getClient(user.id);
  if (!client) { res.status(503).json({ error: "Bot not connected" }); return; }

  const dialogs = await client.getDialogs({ limit: 500 });
  const userIds: bigint[] = [];
  for (const d of dialogs) {
    if (d.isUser && d.entity && "id" in d.entity) {
      userIds.push(BigInt((d.entity as any).id.toString()));
    }
  }

  await prisma.knownUser.createMany({
    data: userIds.map((id) => ({ userId: user.id, telegramContactId: id })),
    skipDuplicates: true,
  });

  res.json({ scanned: userIds.length });
});

export default router;

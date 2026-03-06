import { Router } from "express";
import { prisma } from "../../db";
import { authMiddleware } from "../middleware/auth";
import { botManager } from "../../bot/manager";
import { generateResponse, decideWriteFirst, ContextMessage } from "../../bot/ai";
import { getModel } from "../../bot/models";
import { sendMessageToContact } from "../../bot/handler";

const router = Router();
router.use(authMiddleware);

// GET /api/dialogs — list all contacts with context
router.get("/", async (req, res) => {
  const user = (req as any).user;

  const contexts = await prisma.contactContext.findMany({
    where: { userId: user.id },
    orderBy: { updatedAt: "desc" },
  });

  const contactGroups = await prisma.contactGroup.findMany({
    where: { userId: user.id },
    include: { group: { select: { id: true, name: true } } },
  });
  const groupMap = new Map(contactGroups.map((cg) => [cg.telegramContactId.toString(), cg.group]));

  const result = contexts.map((ctx) => {
    const messages = (ctx.messages as unknown as ContextMessage[]) ?? [];
    const last = messages[messages.length - 1];
    return {
      telegramContactId: ctx.telegramContactId.toString(),
      displayName: ctx.displayName || ctx.telegramContactId.toString(),
      info: ctx.info,
      memory: ctx.memory,
      lastMessage: last ? last.content.slice(0, 80) : "",
      lastMessageRole: last?.role ?? null,
      lastTs: last?.ts ?? null,
      group: groupMap.get(ctx.telegramContactId.toString()) ?? null,
      messageCount: messages.length,
    };
  });

  res.json(result);
});

// GET /api/dialogs/:contactId — full context for one contact
router.get("/:contactId", async (req, res) => {
  const user = (req as any).user;
  const telegramContactId = BigInt(req.params.contactId);

  const ctx = await prisma.contactContext.findUnique({
    where: { userId_telegramContactId: { userId: user.id, telegramContactId } },
  });
  if (!ctx) { res.status(404).json({ error: "Not found" }); return; }

  const contactGroup = await prisma.contactGroup.findUnique({
    where: { userId_telegramContactId: { userId: user.id, telegramContactId } },
    include: { group: { select: { id: true, name: true } } },
  });

  res.json({
    telegramContactId: ctx.telegramContactId.toString(),
    displayName: ctx.displayName || ctx.telegramContactId.toString(),
    info: ctx.info,
    memory: ctx.memory,
    messages: ctx.messages,
    group: contactGroup?.group ?? null,
  });
});

// PUT /api/dialogs/:contactId/info
router.put("/:contactId/info", async (req, res) => {
  const user = (req as any).user;
  const telegramContactId = BigInt(req.params.contactId);
  const { info } = req.body;

  const ctx = await prisma.contactContext.findUnique({
    where: { userId_telegramContactId: { userId: user.id, telegramContactId } },
  });
  if (!ctx) { res.status(404).json({ error: "Not found" }); return; }

  await prisma.contactContext.update({
    where: { id: ctx.id },
    data: { info: info ?? "" },
  });
  res.json({ ok: true });
});

// PUT /api/dialogs/:contactId/memory
router.put("/:contactId/memory", async (req, res) => {
  const user = (req as any).user;
  const telegramContactId = BigInt(req.params.contactId);
  const { memory } = req.body;

  const ctx = await prisma.contactContext.findUnique({
    where: { userId_telegramContactId: { userId: user.id, telegramContactId } },
  });
  if (!ctx) { res.status(404).json({ error: "Not found" }); return; }

  await prisma.contactContext.update({
    where: { id: ctx.id },
    data: { memory: memory ?? "" },
  });
  res.json({ ok: true });
});

// DELETE /api/dialogs/:contactId/messages/:index
router.delete("/:contactId/messages/:index", async (req, res) => {
  const user = (req as any).user;
  const telegramContactId = BigInt(req.params.contactId);
  const index = parseInt(req.params.index);

  const ctx = await prisma.contactContext.findUnique({
    where: { userId_telegramContactId: { userId: user.id, telegramContactId } },
  });
  if (!ctx) { res.status(404).json({ error: "Not found" }); return; }

  const messages = (ctx.messages as unknown as ContextMessage[]) ?? [];
  if (index < 0 || index >= messages.length) { res.status(400).json({ error: "Invalid index" }); return; }

  messages.splice(index, 1);
  await prisma.contactContext.update({
    where: { id: ctx.id },
    data: { messages: messages as any },
  });
  res.json({ ok: true });
});

// POST /api/dialogs/:contactId/send — bot sends AI-generated message
router.post("/:contactId/send", async (req, res) => {
  const user = (req as any).user;
  const telegramContactId = BigInt(req.params.contactId);

  const client = botManager.getClient(user.id);
  if (!client) { res.status(503).json({ error: "Bot not connected" }); return; }
  if (user.paused) { res.status(400).json({ error: "Bot is paused" }); return; }

  const ctx = await prisma.contactContext.findUnique({
    where: { userId_telegramContactId: { userId: user.id, telegramContactId } },
  });
  if (!ctx) { res.status(404).json({ error: "Contact context not found" }); return; }

  // Determine group and system prompt
  const contactGroup = await prisma.contactGroup.findUnique({
    where: { userId_telegramContactId: { userId: user.id, telegramContactId } },
    include: { group: true },
  });

  let systemPrompt = user.defaultSystemPrompt;
  let aiModelId = user.openrouterModel;

  if (contactGroup) {
    systemPrompt = contactGroup.group.systemPrompt;
    if (contactGroup.group.aiModel) aiModelId = contactGroup.group.aiModel;
  } else if (user.defaultGroupId) {
    const defGroup = await prisma.group.findUnique({ where: { id: user.defaultGroupId } });
    if (defGroup) {
      systemPrompt = defGroup.systemPrompt;
      if (defGroup.aiModel) aiModelId = defGroup.aiModel;
    }
  }

  const model = getModel(aiModelId);
  const messages = (ctx.messages as unknown as ContextMessage[]) ?? [];

  // Use decideWriteFirst to generate an appropriate message
  const decision = await decideWriteFirst(
    messages,
    ctx.info,
    ctx.memory,
    systemPrompt,
    model.apiKey,
    model.id
  );

  let message: string;
  if (decision.write && decision.message) {
    message = decision.message;
  } else {
    // Force generate if AI decided not to write (user explicitly requested)
    message = await generateResponse(
      [...messages, { role: "user", content: "[Напиши первым — начни или продолжи разговор естественно]", ts: Date.now() }],
      systemPrompt,
      ctx.info,
      ctx.memory,
      model.apiKey,
      model.id
    );
  }

  await sendMessageToContact(client, user.id, telegramContactId, message);

  // Deduct tokens
  const wordCount = message.split(/\s+/).filter(Boolean).length;
  const tokensToDeduct = Math.ceil((wordCount / 1000) * model.costPer1000Words);
  if (tokensToDeduct > 0) {
    await prisma.user.update({
      where: { id: user.id },
      data: { tokens: { decrement: tokensToDeduct } },
    }).catch(() => {});
  }

  res.json({ ok: true, message });
});

// GET /api/dialogs/people/list — all known users with group info
router.get("/people/list", async (req, res) => {
  const user = (req as any).user;

  const knownUsers = await prisma.knownUser.findMany({ where: { userId: user.id } });
  const contactGroups = await prisma.contactGroup.findMany({
    where: { userId: user.id },
    include: { group: { select: { id: true, name: true } } },
  });
  const contexts = await prisma.contactContext.findMany({ where: { userId: user.id } });

  const groupMap = new Map(contactGroups.map((cg) => [cg.telegramContactId.toString(), cg.group]));
  const ctxMap = new Map(contexts.map((c) => [c.telegramContactId.toString(), c]));

  const result = knownUsers.map((ku) => {
    const key = ku.telegramContactId.toString();
    const ctx = ctxMap.get(key);
    return {
      telegramContactId: key,
      displayName: ctx?.displayName || key,
      group: groupMap.get(key) ?? null,
    };
  });

  res.json(result);
});

export default router;

import { Router } from "express";
import { prisma } from "../../db";
import { authMiddleware } from "../middleware/auth";
import { botManager } from "../../bot/manager";
import { generateResponse, decideWriteFirst, summarizeHistory, ContextMessage } from "../../bot/ai";

const KEEP_MESSAGES = 20; // keep last N after summarizing initial TG history
import { getModel } from "../../bot/models";
import { sendMessageToContact } from "../../bot/handler";

const router = Router();
router.use(authMiddleware);

// Build a name map from Telegram dialogs
interface TgContact { name: string; username: string | null; }

async function getTgContactMap(client: any, myTelegramId: string): Promise<Map<string, TgContact>> {
  const map = new Map<string, TgContact>();
  try {
    const dialogs = await client.getDialogs({ limit: 500 });
    for (const d of dialogs as any[]) {
      if (!d.isUser || !d.entity || d.entity.id.toString() === myTelegramId) continue;
      const e = d.entity;
      const name = [e.firstName, e.lastName].filter(Boolean).join(" ") || e.username || e.id.toString();
      map.set(e.id.toString(), { name, username: e.username || null });
    }
  } catch { /* non-critical */ }
  return map;
}

// Keep old name-only map for backwards compat
async function getTgNameMap(client: any, myTelegramId: string): Promise<Map<string, string>> {
  const full = await getTgContactMap(client, myTelegramId);
  return new Map([...full.entries()].map(([k, v]) => [k, v.name]));
}

// GET /api/dialogs — list all contacts with context
router.get("/", async (req, res) => {
  const user = (req as any).user;
  const client = botManager.getClient(user.id);

  const [contexts, contactGroups] = await Promise.all([
    prisma.contactContext.findMany({ where: { userId: user.id }, orderBy: { updatedAt: "desc" } }),
    prisma.contactGroup.findMany({ where: { userId: user.id }, include: { group: { select: { id: true, name: true } } } }),
  ]);

  const groupMap = new Map(contactGroups.map((cg) => [cg.telegramContactId.toString(), cg.group]));
  const contactMap = client ? await getTgContactMap(client, user.telegramId.toString()) : new Map<string, TgContact>();

  const result = contexts.map((ctx) => {
    const messages = (ctx.messages as unknown as ContextMessage[]) ?? [];
    const last = messages[messages.length - 1];
    const key = ctx.telegramContactId.toString();
    const tg = contactMap.get(key);
    const displayName = tg?.name || ctx.displayName || key;
    return {
      telegramContactId: key,
      displayName,
      username: tg?.username ?? null,
      info: ctx.info,
      memory: ctx.memory,
      lastMessage: last ? last.content.slice(0, 80) : "",
      lastMessageRole: last?.role ?? null,
      lastTs: last?.ts ?? null,
      group: groupMap.get(key) ?? null,
      messageCount: messages.length,
    };
  });

  res.json(result);
});

// GET /api/dialogs/:contactId — full context for one contact (auto-creates if missing)
router.get("/:contactId", async (req, res) => {
  const user = (req as any).user;
  const telegramContactId = BigInt(req.params.contactId);
  const client = botManager.getClient(user.id);

  let ctx = await prisma.contactContext.findUnique({
    where: { userId_telegramContactId: { userId: user.id, telegramContactId } },
  });

  // Load TG history + profile for a contact, then summarize to KEEP_MESSAGES
  async function loadAndSummarizeTgHistory(existingMemory: string): Promise<{ displayName: string; info: string; messages: any[]; memory: string }> {
    let displayName = ctx?.displayName || telegramContactId.toString();
    let info = ctx?.info || "";
    let messages: any[] = [];
    let memory = existingMemory;

    if (!client) return { displayName, info, messages, memory };

    try {
      const entity = await client.getEntity(telegramContactId.toString() as any) as any;
      displayName = [entity.firstName, entity.lastName].filter(Boolean).join(" ") || entity.username || displayName;
    } catch { /* ok */ }

    try {
      const entity = await client.getInputEntity(telegramContactId.toString() as any);
      const tgMessages = await client.getMessages(entity, { limit: 100 });
      messages = tgMessages
        .filter((m: any) => m.text?.trim())
        .reverse()
        .map((m: any) => ({ role: m.out ? "assistant" : "user", content: m.text.trim(), ts: m.date * 1000 }));
    } catch { /* ok */ }

    try {
      const entity = await client.getEntity(telegramContactId.toString() as any) as any;
      const parts: string[] = [];
      const name = [entity.firstName, entity.lastName].filter(Boolean).join(" ");
      if (name) parts.push(`Имя: ${name}`);
      if (entity.username) parts.push(`Username: @${entity.username}`);
      if (entity.phone) parts.push(`Телефон: ${entity.phone}`);
      try {
        const full = await client.invoke({ className: "users.GetFullUser", id: await client.getInputEntity(telegramContactId.toString() as any) } as any);
        const bio = (full as any).fullUser?.about;
        if (bio) parts.push(`Bio: ${bio}`);
      } catch { /* ok */ }
      info = parts.join("\n");
    } catch { /* ok */ }

    // Summarize old messages, keep only last KEEP_MESSAGES
    if (messages.length > KEEP_MESSAGES) {
      const toSummarize = messages.slice(0, messages.length - KEEP_MESSAGES);
      messages = messages.slice(messages.length - KEEP_MESSAGES);
      try {
        const model = getModel(user.openrouterModel);
        memory = await summarizeHistory(toSummarize as ContextMessage[], memory, model.apiKey, model.id);
      } catch { /* keep existing memory */ }
    }

    return { displayName, info, messages, memory };
  }

  // Auto-create context and load TG history if not yet exists
  if (!ctx) {
    const loaded = await loadAndSummarizeTgHistory("");
    ctx = await prisma.contactContext.create({
      data: { userId: user.id, telegramContactId, ...loaded, historyLoaded: true },
    });
  } else if (!ctx.historyLoaded) {
    // Context was created as a stub — load TG history now
    const loaded = await loadAndSummarizeTgHistory(ctx.memory || "");
    ctx = await prisma.contactContext.update({
      where: { id: ctx.id },
      data: { ...loaded, historyLoaded: true },
    });
  }

  const contactGroup = await prisma.contactGroup.findUnique({
    where: { userId_telegramContactId: { userId: user.id, telegramContactId } },
    include: { group: { select: { id: true, name: true } } },
  });

  // Enrich display name and username from TG
  const contactMap = client ? await getTgContactMap(client, user.telegramId.toString()) : new Map<string, TgContact>();
  const tg = contactMap.get(telegramContactId.toString());
  const displayName = tg?.name || ctx.displayName || telegramContactId.toString();

  res.json({
    telegramContactId: ctx.telegramContactId.toString(),
    displayName,
    username: tg?.username ?? null,
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

// GET /api/dialogs/people/list — all private TG dialogs with group info
router.get("/people/list", async (req, res) => {
  const user = (req as any).user;
  const client = botManager.getClient(user.id);

  // Fetch all private dialogs from Telegram
  let people: { telegramContactId: string; displayName: string }[] = [];

  if (client) {
    try {
      const dialogs = await client.getDialogs({ limit: 500 });
      const myId = user.telegramId.toString();
      people = dialogs
        .filter((d: any) => d.isUser && d.entity && d.entity.id.toString() !== myId && !d.entity.bot)
        .map((d: any) => {
          const e = d.entity;
          const name = [e.firstName, e.lastName].filter(Boolean).join(" ") || e.username || e.id.toString();
          return { telegramContactId: e.id.toString(), displayName: name, username: e.username || null };
        });
    } catch (err) {
      console.error("getDialogs error:", err);
    }
  }

  // Fallback to KnownUser if client not available
  if (!people.length) {
    const knownUsers = await prisma.knownUser.findMany({ where: { userId: user.id } });
    const contexts = await prisma.contactContext.findMany({ where: { userId: user.id } });
    const ctxMap = new Map(contexts.map((c) => [c.telegramContactId.toString(), c]));
    people = knownUsers.map((ku) => {
      const key = ku.telegramContactId.toString();
      return { telegramContactId: key, displayName: ctxMap.get(key)?.displayName || key, username: null };
    });
  }

  const contactGroups = await prisma.contactGroup.findMany({
    where: { userId: user.id },
    include: { group: { select: { id: true, name: true } } },
  });
  const groupMap = new Map(contactGroups.map((cg) => [cg.telegramContactId.toString(), cg.group]));

  res.json(people.map((p: any) => ({
    telegramContactId: p.telegramContactId,
    displayName: p.displayName,
    username: p.username ?? null,
    group: groupMap.get(p.telegramContactId) ?? null,
  })));
});

export default router;

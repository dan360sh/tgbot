import { TelegramClient } from "telegram";
import { NewMessage, NewMessageEvent } from "telegram/events";
import { Api } from "telegram";
import { prisma } from "../db";
import { generateResponse, shouldReplyCheck, summarizeHistory, ContextMessage } from "./ai";
import { getModel } from "./models";

const MAX_CONTEXT = 50;
const MIN_CONTEXT = 20;
const LIVE_MODE_GAP_MS = 5 * 60 * 1000; // 5 minutes

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

export function setupHandler(client: TelegramClient, telegramId: bigint, dbUserId: number) {
  client.addEventHandler(
    async (event: NewMessageEvent) => {
      try {
        await handleMessage(client, event, telegramId, dbUserId);
      } catch (err) {
        console.error(`[Bot ${dbUserId}] Handler error:`, err);
      }
    },
    new NewMessage({})
  );
}

async function loadTgHistory(client: TelegramClient, contactId: bigint): Promise<ContextMessage[]> {
  try {
    const entity = await client.getInputEntity(contactId.toString() as any);
    const messages = await client.getMessages(entity, { limit: 100 });
    // getMessages returns newest first — reverse for chronological order
    return messages
      .filter((m) => m.text?.trim())
      .reverse()
      .map((m) => ({
        role: (m.out ? "assistant" : "user") as "user" | "assistant",
        content: m.text!.trim(),
        ts: m.date * 1000,
      }));
  } catch {
    return [];
  }
}

async function loadContactInfo(client: TelegramClient, contactId: bigint): Promise<string> {
  try {
    const entity = await client.getEntity(contactId.toString() as any) as Api.User;
    const parts: string[] = [];
    const name = [entity.firstName, entity.lastName].filter(Boolean).join(" ");
    if (name) parts.push(`Имя: ${name}`);
    if (entity.username) parts.push(`Username: @${entity.username}`);
    if (entity.phone) parts.push(`Телефон: ${entity.phone}`);
    try {
      const full = await client.invoke(new Api.users.GetFullUser({ id: await client.getInputEntity(contactId.toString() as any) }));
      const bio = (full as any).fullUser?.about;
      if (bio) parts.push(`Bio: ${bio}`);
    } catch { /* bio not critical */ }
    return parts.join("\n");
  } catch {
    return "";
  }
}

async function getContactDisplayName(client: TelegramClient, contactId: bigint): Promise<string> {
  try {
    const entity = await client.getEntity(contactId.toString() as any) as Api.User;
    return [entity.firstName, entity.lastName].filter(Boolean).join(" ") || entity.username || contactId.toString();
  } catch {
    return contactId.toString();
  }
}

async function markAsRead(client: TelegramClient, peer: any, maxId: number) {
  try {
    await client.invoke(new Api.messages.ReadHistory({ peer, maxId }));
  } catch { /* non-critical */ }
}

async function sendTyping(client: TelegramClient, peer: any) {
  try {
    await client.invoke(new Api.messages.SetTyping({
      peer,
      action: new Api.SendMessageTypingAction(),
    }));
  } catch { /* non-critical */ }
}

export async function handleMessage(
  client: TelegramClient,
  event: NewMessageEvent,
  myTelegramId: bigint,
  dbUserId: number
) {
  const msg = event.message;
  if (!msg.text?.trim()) return;
  const text = msg.text.trim();

  // Ignore Saved Messages and outgoing
  const peerId = msg.peerId;
  if (peerId instanceof Api.PeerUser && BigInt(peerId.userId.toString()) === myTelegramId) return;
  if (msg.out) return;

  // Only DM and group mentions
  if (!msg.isPrivate && !msg.mentioned) return;

  const senderId = msg.senderId?.toString();
  if (!senderId) return;
  const senderIdBig = BigInt(senderId);

  // Load user settings from DB
  const user = await prisma.user.findUnique({ where: { id: dbUserId } });
  if (!user || user.paused) return;
  if (user.tokens <= 0) return;

  // Blacklist check
  const blocked = await prisma.blacklistEntry.findUnique({
    where: { userId_telegramContactId: { userId: dbUserId, telegramContactId: senderIdBig } },
  });
  if (blocked) return;

  // KnownUser tracking
  const known = await prisma.knownUser.findUnique({
    where: { userId_telegramContactId: { userId: dbUserId, telegramContactId: senderIdBig } },
  });
  if (!known) {
    await prisma.knownUser.create({ data: { userId: dbUserId, telegramContactId: senderIdBig } }).catch(() => {});
    if (user.newcomersEnabled && user.newcomersGroupId) {
      await prisma.contactGroup.upsert({
        where: { userId_telegramContactId: { userId: dbUserId, telegramContactId: senderIdBig } },
        create: { userId: dbUserId, telegramContactId: senderIdBig, groupId: user.newcomersGroupId },
        update: {},
      }).catch(() => {});
    }
  }

  // Load or create ContactContext
  let ctx = await prisma.contactContext.findUnique({
    where: { userId_telegramContactId: { userId: dbUserId, telegramContactId: senderIdBig } },
  });

  if (!ctx) {
    const displayName = await getContactDisplayName(client, senderIdBig);
    ctx = await prisma.contactContext.create({
      data: { userId: dbUserId, telegramContactId: senderIdBig, displayName },
    });
  }

  // Load TG history + profile info on first contact
  if (!ctx.historyLoaded) {
    const [tgHistory, info] = await Promise.all([
      loadTgHistory(client, senderIdBig),
      loadContactInfo(client, senderIdBig),
    ]);
    ctx = await prisma.contactContext.update({
      where: { id: ctx.id },
      data: { messages: tgHistory as any, info, historyLoaded: true },
    });
  }

  // Determine group and system prompt
  const contactGroup = await prisma.contactGroup.findUnique({
    where: { userId_telegramContactId: { userId: dbUserId, telegramContactId: senderIdBig } },
    include: { group: true },
  });

  let systemPrompt: string | null = null;
  let aiModelId: string = user.openrouterModel;
  let activeGroup: typeof contactGroup extends null | undefined ? null : NonNullable<typeof contactGroup>["group"] | null = null;

  if (contactGroup) {
    systemPrompt = contactGroup.group.systemPrompt;
    activeGroup = contactGroup.group;
    if (contactGroup.group.aiModel) aiModelId = contactGroup.group.aiModel;
  } else if (user.responseMode === "selected") {
    return;
  } else if (user.defaultGroupId) {
    const defGroup = await prisma.group.findUnique({ where: { id: user.defaultGroupId } });
    systemPrompt = defGroup?.systemPrompt ?? user.defaultSystemPrompt;
    activeGroup = defGroup ?? null;
    if (defGroup?.aiModel) aiModelId = defGroup.aiModel;
  } else {
    systemPrompt = user.defaultSystemPrompt;
  }

  if (!systemPrompt) return;

  const model = getModel(aiModelId);

  // Build current message list
  let messages: ContextMessage[] = (ctx.messages as unknown as ContextMessage[]) ?? [];

  // Add incoming message
  messages = [...messages, { role: "user", content: text, ts: Date.now() }];

  // Summarize if too many messages
  let memory = ctx.memory;
  if (messages.length > MAX_CONTEXT) {
    const toSummarize = messages.splice(0, messages.length - MIN_CONTEXT);
    memory = await summarizeHistory(toSummarize, memory, model.apiKey, model.id);
  }

  // Persist updated messages immediately
  await prisma.contactContext.update({
    where: { id: ctx.id },
    data: { messages: messages as any, memory },
  });

  // shouldReply check (AI decision)
  const shouldReply = await shouldReplyCheck(messages, ctx.info, memory, text, model.apiKey, model.id);
  if (!shouldReply) {
    console.log(`[Bot ${dbUserId}] Decided not to reply to ${senderId}`);
    return;
  }

  // Live mode handling
  const liveMode = (activeGroup as any)?.liveMode ?? false;
  if (liveMode) {
    const prevMessages = messages.slice(0, -1);
    const lastMsgTs = prevMessages.length > 0 ? prevMessages[prevMessages.length - 1].ts : 0;
    const gap = Date.now() - lastMsgTs;

    if (gap > LIVE_MODE_GAP_MS) {
      // Random delay 1-5 minutes
      const delayMs = (Math.random() * 4 + 1) * 60 * 1000;
      console.log(`[Bot ${dbUserId}] Live mode: waiting ${Math.round(delayMs / 1000)}s before reading`);
      await sleep(delayMs);
    }

    // Mark as read
    await markAsRead(client, msg.peerId, msg.id);
    await sleep(500);
  } else {
    // Normal typing indicator
    await sendTyping(client, msg.peerId);
  }

  // Generate response
  const reply = await generateResponse(messages, systemPrompt, ctx.info, memory, model.apiKey, model.id);

  // Live mode: typing delay (1 sec per word)
  if (liveMode) {
    const wordCount = reply.split(/\s+/).filter(Boolean).length;
    await sendTyping(client, msg.peerId);
    await sleep(wordCount * 1000);
  }

  // Send
  await msg.respond({ message: reply });

  // Add assistant message to context
  messages = [...messages, { role: "assistant", content: reply, ts: Date.now() }];
  await prisma.contactContext.update({
    where: { id: ctx.id },
    data: { messages: messages as any },
  });

  // Deduct tokens
  const wordCount = reply.split(/\s+/).filter(Boolean).length;
  const tokensToDeduct = Math.ceil((wordCount / 1000) * model.costPer1000Words);
  if (tokensToDeduct > 0) {
    await prisma.user.update({
      where: { id: dbUserId },
      data: { tokens: { decrement: tokensToDeduct } },
    }).catch(() => {});
  }

  console.log(`[Bot ${dbUserId}] -> ${senderId}: ${reply.slice(0, 60)}... (-${tokensToDeduct} tokens)`);
}

// Send a message to a contact directly (used by write-first and API)
export async function sendMessageToContact(
  client: TelegramClient,
  dbUserId: number,
  contactId: bigint,
  message: string
) {
  const entity = await client.getInputEntity(contactId.toString() as any);
  await client.sendMessage(entity, { message });

  // Save to context
  let ctx = await prisma.contactContext.findUnique({
    where: { userId_telegramContactId: { userId: dbUserId, telegramContactId: contactId } },
  });
  if (!ctx) {
    const displayName = await getContactDisplayName(client, contactId).catch(() => contactId.toString());
    ctx = await prisma.contactContext.create({
      data: { userId: dbUserId, telegramContactId: contactId, displayName, historyLoaded: true },
    });
  }

  const messages: ContextMessage[] = [...(ctx.messages as unknown as ContextMessage[]), {
    role: "assistant",
    content: message,
    ts: Date.now(),
  }];
  await prisma.contactContext.update({
    where: { id: ctx.id },
    data: { messages: messages as any },
  });
}

import { TelegramClient } from "telegram";
import { NewMessage, NewMessageEvent } from "telegram/events";
import { Api } from "telegram";
import { prisma } from "../db";
import { generateResponse } from "./ai";
import { getModel } from "./models";

// In-memory chat history: `${userId}-${contactId}` -> messages
const histories = new Map<string, { role: "user" | "assistant"; content: string }[]>();

const MAX_HISTORY = 20;

function getHistory(key: string) {
  return histories.get(key) ?? [];
}

function addToHistory(key: string, role: "user" | "assistant", content: string) {
  if (!histories.has(key)) histories.set(key, []);
  const h = histories.get(key)!;
  h.push({ role, content });
  if (h.length > MAX_HISTORY) h.splice(0, h.length - MAX_HISTORY);
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

async function handleMessage(
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

  // Load user settings from DB
  const user = await prisma.user.findUnique({ where: { id: dbUserId } });
  if (!user || user.paused) return;
  if (user.tokens <= 0) return; // no tokens left

  // Blacklist check
  const blocked = await prisma.blacklistEntry.findUnique({
    where: { userId_telegramContactId: { userId: dbUserId, telegramContactId: BigInt(senderId) } },
  });
  if (blocked) return;

  // Newcomer check
  const known = await prisma.knownUser.findUnique({
    where: { userId_telegramContactId: { userId: dbUserId, telegramContactId: BigInt(senderId) } },
  });
  if (!known) {
    await prisma.knownUser.create({ data: { userId: dbUserId, telegramContactId: BigInt(senderId) } }).catch(() => {});
    if (user.newcomersEnabled && user.newcomersGroupId) {
      await prisma.contactGroup.upsert({
        where: { userId_telegramContactId: { userId: dbUserId, telegramContactId: BigInt(senderId) } },
        create: { userId: dbUserId, telegramContactId: BigInt(senderId), groupId: user.newcomersGroupId },
        update: {},
      }).catch(() => {});
    }
  }

  // Determine group and system prompt
  const contactGroup = await prisma.contactGroup.findUnique({
    where: { userId_telegramContactId: { userId: dbUserId, telegramContactId: BigInt(senderId) } },
    include: { group: true },
  });

  let systemPrompt: string | null = null;
  let aiModelId: string = user.openrouterModel;

  if (contactGroup) {
    systemPrompt = contactGroup.group.systemPrompt;
    if (contactGroup.group.aiModel) aiModelId = contactGroup.group.aiModel;
  } else if (user.responseMode === "selected") {
    return; // don't respond to users not in any group
  } else if (user.defaultGroupId) {
    const defGroup = await prisma.group.findUnique({ where: { id: user.defaultGroupId } });
    systemPrompt = defGroup?.systemPrompt ?? user.defaultSystemPrompt;
    if (defGroup?.aiModel) aiModelId = defGroup.aiModel;
  } else {
    systemPrompt = user.defaultSystemPrompt;
  }

  if (!systemPrompt) return;

  // Typing indicator
  try {
    await client.invoke(new Api.messages.SetTyping({
      peer: msg.peerId!,
      action: new Api.SendMessageTypingAction(),
    }));
  } catch { /* non-critical */ }

  const histKey = `${dbUserId}-${senderId}`;
  addToHistory(histKey, "user", text);

  const model = getModel(aiModelId);
  const reply = await generateResponse(
    getHistory(histKey),
    systemPrompt,
    model.apiKey,
    model.id
  );

  addToHistory(histKey, "assistant", reply);
  await msg.respond({ message: reply });

  // Deduct tokens based on words in reply
  const wordCount = reply.split(/\s+/).filter(Boolean).length;
  const tokensToDeduct = Math.ceil((wordCount / 1000) * model.costPer1000Words);
  if (tokensToDeduct > 0) {
    await prisma.user.update({
      where: { id: dbUserId },
      data: { tokens: { decrement: tokensToDeduct } },
    }).catch(() => {});
  }

  console.log(`[Bot ${dbUserId}] → ${senderId}: ${reply.slice(0, 60)}... (-${tokensToDeduct} tokens)`);
}

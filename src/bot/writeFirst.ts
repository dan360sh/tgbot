import { prisma } from "../db";
import { botManager } from "./manager";
import { decideWriteFirst, generateResponse, ContextMessage } from "./ai";
import { getModel } from "./models";
import { sendMessageToContact } from "./handler";

// Check interval: every minute
const CHECK_INTERVAL_MS = 60_000;

export function startWriteFirstScheduler() {
  setInterval(runWriteFirst, CHECK_INTERVAL_MS);
  console.log("Write-first scheduler started");
}

async function runWriteFirst() {
  // Get all groups with writeFirst enabled
  const groups = await prisma.group.findMany({
    where: { writeFirst: true, writeFirstInterval: { gt: 0 } },
    include: { contactGroups: true },
  });

  for (const group of groups) {
    const user = await prisma.user.findUnique({ where: { id: group.userId } });
    if (!user || user.paused || user.tokens <= 0) continue;

    const client = botManager.getClient(group.userId);
    if (!client) continue;

    const model = getModel(group.aiModel || user.openrouterModel);
    const intervalMs = group.writeFirstInterval * 60 * 1000;

    for (const contactGroup of group.contactGroups) {
      try {
        await processWriteFirst(client, group, user, model, contactGroup.telegramContactId, intervalMs);
      } catch (err) {
        console.error(`[WriteFirst] Error for contact ${contactGroup.telegramContactId}:`, err);
      }
    }
  }
}

async function processWriteFirst(
  client: any,
  group: any,
  user: any,
  model: any,
  contactId: bigint,
  intervalMs: number
) {
  // Get or create context
  let ctx = await prisma.contactContext.findUnique({
    where: { userId_telegramContactId: { userId: user.id, telegramContactId: contactId } },
  });

  if (!ctx) {
    // Create stub context so write-first can proceed
    ctx = await prisma.contactContext.create({
      data: { userId: user.id, telegramContactId: contactId, displayName: contactId.toString() },
    }).catch(() => null);
    if (!ctx) return;
  }

  const messages: ContextMessage[] = (ctx.messages as unknown as ContextMessage[]) ?? [];

  // Check if enough time has passed since last message (either direction)
  const lastMsgTs = messages.length > 0 ? messages[messages.length - 1].ts : 0;
  const timeSinceLast = Date.now() - lastMsgTs;

  console.log(`[WriteFirst] ${contactId}: lastMsg=${lastMsgTs ? new Date(lastMsgTs).toISOString() : 'never'}, timeSinceLast=${Math.round(timeSinceLast/60000)}min, interval=${Math.round(intervalMs/60000)}min`);

  if (timeSinceLast < intervalMs) {
    console.log(`[WriteFirst] ${contactId}: skipping — not enough time since last message`);
    return;
  }

  // Check if last write-first was also within interval
  if (ctx.lastWriteFirst) {
    const timeSinceLastWF = Date.now() - ctx.lastWriteFirst.getTime();
    if (timeSinceLastWF < intervalMs) {
      console.log(`[WriteFirst] ${contactId}: skipping — wrote first recently (${Math.round(timeSinceLastWF/60000)}min ago)`);
      return;
    }
  }

  // Ask AI to decide and generate message
  const decision = await decideWriteFirst(
    messages,
    ctx.info,
    ctx.memory,
    group.systemPrompt,
    model.apiKey,
    model.id
  );

  let message = decision.message;

  if (!decision.write || !message) {
    // Fallback: force-generate if not nighttime (AI may refuse for weak reasons)
    const hour = new Date().getHours();
    if (hour >= 22 || hour < 8) {
      console.log(`[WriteFirst] Skipping ${contactId} — nighttime`);
      return;
    }
    console.log(`[WriteFirst] AI declined, force-generating for ${contactId}`);
    try {
      message = await generateResponse(
        [...messages, { role: "user" as const, content: "[Напиши первым — начни или продолжи разговор естественно]", ts: Date.now() }],
        group.systemPrompt,
        ctx.info,
        ctx.memory,
        model.apiKey,
        model.id
      );
    } catch (err) {
      console.error(`[WriteFirst] Force-generate failed for ${contactId}:`, err);
      return;
    }
  }

  console.log(`[WriteFirst] Sending to ${contactId}: ${message.slice(0, 60)}...`);
  await sendMessageToContact(client, user.id, contactId, message);

  // Update lastWriteFirst timestamp
  await prisma.contactContext.update({
    where: { id: ctx.id },
    data: { lastWriteFirst: new Date() },
  });

  // Deduct tokens
  const wordCount = message.split(/\s+/).filter(Boolean).length;
  const tokensToDeduct = Math.ceil((wordCount / 1000) * model.costPer1000Words);
  if (tokensToDeduct > 0) {
    await prisma.user.update({
      where: { id: user.id },
      data: { tokens: { decrement: tokensToDeduct } },
    }).catch(() => {});
  }
}

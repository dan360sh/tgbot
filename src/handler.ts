import { TelegramClient } from "telegram";
import { NewMessage, NewMessageEvent } from "telegram/events";
import { Api } from "telegram";
import { state } from "./state";
import { storage } from "./storage";
import { generateResponse } from "./ai";
import { handleControlCommand } from "./commands";
import { config } from "./config";

export function setupHandlers(client: TelegramClient, myId: bigint): void {
  client.addEventHandler(
    async (event: NewMessageEvent) => {
      try {
        await handleMessage(client, event, myId);
      } catch (err) {
        console.error("[Handler error]", err);
      }
    },
    new NewMessage({})
  );
  console.log("📡 Слушаем сообщения...");
}

async function handleMessage(
  client: TelegramClient,
  event: NewMessageEvent,
  myId: bigint
): Promise<void> {
  const msg = event.message;
  if (!msg.text?.trim()) return;
  const text = msg.text.trim();

  // Control commands — наши исходящие сообщения в Избранное
  if (msg.out) {
    const peerId = msg.peerId;
    if (peerId instanceof Api.PeerUser && BigInt(peerId.userId.toString()) === myId) {
      await handleControlCommand(client, text, async (reply) => {
        await client.sendMessage("me", { message: reply, parseMode: "markdown" });
      });
    }
    return;
  }

  if (storage.get().paused) return;

  // Только DM и упоминания в группах
  if (!msg.isPrivate && !msg.mentioned) return;

  const senderId = msg.senderId?.toString();
  if (!senderId) return;

  // Новенький?
  if (!storage.isKnownUser(senderId)) {
    storage.addKnownUser(senderId);
    const { newcomers, userGroups } = storage.get();
    if (newcomers.enabled && newcomers.groupName && !userGroups[senderId]) {
      storage.addUserToGroup(senderId, newcomers.groupName);
    }
  }

  // Проверяем нужно ли отвечать
  if (!storage.shouldRespond(senderId)) return;

  // System prompt для этого пользователя
  const systemPrompt = storage.getSystemPromptForUser(senderId, config.systemPrompt);

  const chatId = String(msg.chatId ?? msg.senderId);

  // Индикатор печати
  try {
    await client.invoke(
      new Api.messages.SetTyping({ peer: msg.peerId!, action: new Api.SendMessageTypingAction() })
    );
  } catch { /* non-critical */ }

  state.addMessage(chatId, "user", text);
  const reply = await generateResponse(state.getHistory(chatId), systemPrompt);
  state.addMessage(chatId, "assistant", reply);

  await client.sendMessage(msg.peerId!, { message: reply });

  console.log(`[${new Date().toLocaleTimeString()}] → ${senderId}: ${reply.slice(0, 60)}...`);
}

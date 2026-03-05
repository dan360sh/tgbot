import { TelegramClient } from "telegram";
import { NewMessage, NewMessageEvent } from "telegram/events";
import { Api } from "telegram";
import { state } from "./state";
import { generateResponse } from "./ai";

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

  // --- Control commands (our own outgoing messages to Saved Messages) ---
  if (msg.out) {
    const peerId = msg.peerId;
    // PeerUser with our own ID = Saved Messages
    if (peerId instanceof Api.PeerUser && BigInt(peerId.userId.toString()) === myId) {
      await handleControlCommand(client, msg, text);
    }
    return;
  }

  // --- Ignore if paused ---
  if (state.isPaused()) return;

  // --- Decide whether to respond ---
  const isPrivate = msg.isPrivate;
  const isMentioned = msg.mentioned;

  if (!isPrivate && !isMentioned) return;

  const chatId = String(msg.chatId ?? msg.senderId);

  // Show typing indicator
  try {
    await client.invoke(
      new Api.messages.SetTyping({
        peer: msg.peerId!,
        action: new Api.SendMessageTypingAction(),
      })
    );
  } catch {
    // Non-critical, ignore
  }

  state.addMessage(chatId, "user", text);
  const history = state.getHistory(chatId);

  const reply = await generateResponse(history);

  state.addMessage(chatId, "assistant", reply);
  await client.sendMessage(msg.peerId!, { message: reply });

  console.log(
    `[${new Date().toLocaleTimeString()}] Ответили в чате ${chatId}: ${reply.slice(0, 60)}...`
  );
}

async function handleControlCommand(
  client: TelegramClient,
  msg: NewMessageEvent["message"],
  text: string
): Promise<void> {
  const cmd = text.toLowerCase().split(/\s+/)[0];

  switch (cmd) {
    case "/pause":
      state.pause();
      await msg.reply({ message: "⏸ Автоответ приостановлен" });
      break;

    case "/resume":
      state.resume();
      await msg.reply({ message: "▶️ Автоответ возобновлён" });
      break;

    case "/status":
      await msg.reply({
        message: state.isPaused()
          ? "⏸ Статус: приостановлен"
          : "▶️ Статус: активен",
      });
      break;

    case "/clear": {
      // /clear <chatId> — очистить историю конкретного чата
      const parts = text.split(/\s+/);
      const chatId = parts[1];
      if (chatId) {
        state.clearHistory(chatId);
        await msg.reply({ message: `🗑 История чата ${chatId} очищена` });
      } else {
        await msg.reply({ message: "Использование: /clear <chatId>" });
      }
      break;
    }

    case "/help":
      await msg.reply({
        message: [
          "🤖 *Команды автоответчика* (отправлять в Избранное):",
          "",
          "/pause — приостановить автоответ",
          "/resume — возобновить автоответ",
          "/status — текущий статус",
          "/clear <chatId> — очистить историю чата",
          "/help — это сообщение",
        ].join("\n"),
        parseMode: "markdown",
      });
      break;
  }
}

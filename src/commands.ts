import { TelegramClient } from "telegram";
import { storage } from "./storage";
import { state } from "./state";

type PendingAction = { type: "await_group_prompt"; groupName: string };

let pendingAction: PendingAction | null = null;

type ReplyFn = (msg: string) => Promise<void>;

export async function handleControlCommand(
  client: TelegramClient,
  text: string,
  reply: ReplyFn
): Promise<void> {
  if (pendingAction) {
    await handlePending(text, reply);
    return;
  }

  const parts = text.trim().split(/\s+/);
  const cmd = parts[0].toLowerCase();

  switch (cmd) {
    case "/help":
      await reply(helpText());
      break;

    case "/pause":
      storage.setPaused(true);
      await reply("⏸ Автоответ приостановлен");
      break;

    case "/resume":
      storage.setPaused(false);
      await reply("▶️ Автоответ возобновлён");
      break;

    case "/status":
      await reply(statusText());
      break;

    // ── Groups ──────────────────────────────────────────────
    case "/newgroup": {
      const name = parts.slice(1).join(" ").trim();
      if (!name) { await reply("Использование: /newgroup <название>"); break; }
      pendingAction = { type: "await_group_prompt", groupName: name };
      await reply(`📝 Введи системный промт для группы *${name}*:`);
      break;
    }

    case "/groups": {
      const { groups, defaultGroup } = storage.get();
      const names = Object.keys(groups);
      if (names.length === 0) { await reply("Групп нет. Создай: /newgroup <название>"); break; }
      const list = names.map((n) => `• *${n}*${n === defaultGroup ? " ✓ (базовая)" : ""}`).join("\n");
      await reply(`📂 Группы:\n${list}`);
      break;
    }

    case "/delgroup": {
      const name = parts.slice(1).join(" ").trim();
      if (!name || !storage.get().groups[name]) { await reply(`Группа не найдена: ${name || "?"}`); break; }
      storage.deleteGroup(name);
      await reply(`🗑 Группа *${name}* удалена`);
      break;
    }

    case "/setdefault": {
      const name = parts.slice(1).join(" ").trim();
      if (!name || !storage.get().groups[name]) { await reply(`Группа не найдена: ${name || "?"}`); break; }
      storage.setDefaultGroup(name);
      await reply(`✅ Базовая группа: *${name}*`);
      break;
    }

    // ── Users ────────────────────────────────────────────────
    case "/adduser": {
      if (parts.length < 3) { await reply("Использование: /adduser <@username или id> <группа>"); break; }
      const identifier = parts[1];
      const groupName = parts.slice(2).join(" ");
      if (!storage.get().groups[groupName]) { await reply(`Группа не найдена: ${groupName}`); break; }
      try {
        const user = await client.getEntity(identifier) as any;
        const userId: string = user.id.toString();
        storage.addUserToGroup(userId, groupName);
        const label = user.username ? `@${user.username}` : identifier;
        await reply(`✅ ${label} добавлен в группу *${groupName}*`);
      } catch {
        await reply(`Пользователь не найден: ${identifier}`);
      }
      break;
    }

    case "/removeuser": {
      const identifier = parts[1];
      if (!identifier) { await reply("Использование: /removeuser <@username или id>"); break; }
      try {
        const user = await client.getEntity(identifier) as any;
        storage.removeUserFromGroup(user.id.toString());
        await reply(`✅ Пользователь удалён из группы`);
      } catch {
        await reply(`Пользователь не найден: ${identifier}`);
      }
      break;
    }

    case "/users": {
      const { userGroups } = storage.get();
      const entries = Object.entries(userGroups);
      if (entries.length === 0) { await reply("Нет пользователей в группах"); break; }
      const list = entries.map(([id, g]) => `• ${id} → ${g}`).join("\n");
      await reply(`👥 Пользователи:\n${list}`);
      break;
    }

    // ── Mode ─────────────────────────────────────────────────
    case "/mode": {
      const mode = parts[1]?.toLowerCase();
      if (mode !== "all" && mode !== "selected") {
        await reply("Использование: /mode all | /mode selected");
        break;
      }
      storage.setResponseMode(mode);
      await reply(
        mode === "all"
          ? "✅ Режим: отвечать всем (неизвестные — базовый промт)"
          : "✅ Режим: только участникам групп"
      );
      break;
    }

    // ── Blacklist ────────────────────────────────────────────
    case "/block": {
      const identifier = parts[1];
      if (!identifier) { await reply("Использование: /block <@username или id>"); break; }
      try {
        const user = await client.getEntity(identifier) as any;
        storage.addToBlacklist(user.id.toString());
        const label = user.username ? `@${user.username}` : identifier;
        await reply(`🚫 ${label} добавлен в чёрный список`);
      } catch {
        await reply(`Пользователь не найден: ${identifier}`);
      }
      break;
    }

    case "/unblock": {
      const identifier = parts[1];
      if (!identifier) { await reply("Использование: /unblock <@username или id>"); break; }
      try {
        const user = await client.getEntity(identifier) as any;
        storage.removeFromBlacklist(user.id.toString());
        await reply(`✅ Пользователь удалён из чёрного списка`);
      } catch {
        await reply(`Пользователь не найден: ${identifier}`);
      }
      break;
    }

    case "/blacklist": {
      const { blacklist } = storage.get();
      if (blacklist.length === 0) { await reply("Чёрный список пуст"); break; }
      await reply(`🚫 Чёрный список:\n${blacklist.map((id) => `• ${id}`).join("\n")}`);
      break;
    }

    // ── Newcomers ────────────────────────────────────────────
    case "/newcomers": {
      const sub = parts[1]?.toLowerCase();
      if (sub === "off") {
        storage.setNewcomers(false);
        await reply("✅ Функция новеньких отключена");
      } else if (sub === "on") {
        const groupName = parts.slice(2).join(" ").trim();
        if (!groupName) { await reply("Использование: /newcomers on <группа>"); break; }
        if (!storage.get().groups[groupName]) { await reply(`Группа не найдена: ${groupName}`); break; }
        storage.setNewcomers(true, groupName);
        await reply(`✅ Новенькие включены → группа *${groupName}*`);
      } else {
        const { newcomers } = storage.get();
        const s = newcomers.enabled ? `включено (группа: *${newcomers.groupName}*)` : "отключено";
        await reply(`Новенькие: ${s}\n\n/newcomers on <группа>\n/newcomers off`);
      }
      break;
    }

    case "/scan": {
      await reply("🔍 Сканирую диалоги...");
      try {
        const dialogs = await client.getDialogs({ limit: 500 });
        const ids: string[] = [];
        for (const d of dialogs) {
          if (d.isUser && d.entity && "id" in d.entity) ids.push((d.entity as any).id.toString());
        }
        storage.addKnownUsers(ids);
        await reply(`✅ Отмечено ${ids.length} пользователей как известные`);
      } catch (err) {
        await reply(`Ошибка сканирования: ${err}`);
      }
      break;
    }

    // ── Misc ─────────────────────────────────────────────────
    case "/clear": {
      const chatId = parts[1];
      if (!chatId) { await reply("Использование: /clear <chatId>"); break; }
      state.clearHistory(chatId);
      await reply(`🗑 История чата ${chatId} очищена`);
      break;
    }
  }
}

async function handlePending(text: string, reply: ReplyFn): Promise<void> {
  const action = pendingAction!;
  pendingAction = null;
  if (action.type === "await_group_prompt") {
    storage.createGroup(action.groupName, text);
    await reply(`✅ Группа *${action.groupName}* создана`);
  }
}

function statusText(): string {
  const d = storage.get();
  const gCount = Object.keys(d.groups).length;
  const uCount = Object.keys(d.userGroups).length;
  return [
    `🤖 *Статус автоответчика*`,
    ``,
    `${d.paused ? "⏸ Приостановлен" : "▶️ Активен"}`,
    `📋 Режим: ${d.responseMode === "all" ? "отвечать всем" : "только выбранным"}`,
    `📂 Групп: ${gCount}${d.defaultGroup ? ` (базовая: *${d.defaultGroup}*)` : ""}`,
    `👥 В группах: ${uCount} чел.`,
    `🚫 Чёрный список: ${d.blacklist.length} чел.`,
    `🆕 Новенькие: ${d.newcomers.enabled ? `вкл (группа: *${d.newcomers.groupName}*)` : "выкл"}`,
  ].join("\n");
}

function helpText(): string {
  return [
    `*Команды* (отправлять в Избранное):`,
    ``,
    `*Основные*`,
    `/pause · /resume — вкл/выкл автоответ`,
    `/status — все настройки`,
    ``,
    `*Группы*`,
    `/newgroup <название> — создать группу`,
    `/groups — список групп`,
    `/delgroup <название> — удалить группу`,
    `/setdefault <название> — базовая группа`,
    ``,
    `*Пользователи*`,
    `/adduser <@user или id> <группа>`,
    `/removeuser <@user или id>`,
    `/users — список`,
    ``,
    `*Режим ответов*`,
    `/mode all — отвечать всем`,
    `/mode selected — только участникам групп`,
    ``,
    `*Чёрный список*`,
    `/block <@user или id>`,
    `/unblock <@user или id>`,
    `/blacklist — список`,
    ``,
    `*Новенькие*`,
    `/newcomers on <группа> — включить`,
    `/newcomers off — выключить`,
    `/scan — пометить всех в диалогах как известных`,
    ``,
    `*Прочее*`,
    `/clear <chatId> — очистить историю чата`,
  ].join("\n");
}

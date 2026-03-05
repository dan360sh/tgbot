import { config } from "./config";

type Role = "user" | "assistant";

interface ChatMessage {
  role: Role;
  content: string;
}

let paused = false;
const histories = new Map<string, ChatMessage[]>();

export const state = {
  isPaused: () => paused,
  pause: () => {
    paused = true;
  },
  resume: () => {
    paused = false;
  },

  addMessage(chatId: string, role: Role, content: string) {
    if (!histories.has(chatId)) {
      histories.set(chatId, []);
    }
    const history = histories.get(chatId)!;
    history.push({ role, content });
    // Trim to max history
    if (history.length > config.maxHistory) {
      history.splice(0, history.length - config.maxHistory);
    }
  },

  getHistory(chatId: string): ChatMessage[] {
    return histories.get(chatId) ?? [];
  },

  clearHistory(chatId: string) {
    histories.delete(chatId);
  },
};

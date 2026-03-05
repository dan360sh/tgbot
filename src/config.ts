import * as dotenv from "dotenv";
dotenv.config();

function required(name: string): string {
  const val = process.env[name];
  if (!val) throw new Error(`Missing required env variable: ${name}`);
  return val;
}

export const config = {
  // Telegram MTProto API credentials (from https://my.telegram.org)
  apiId: parseInt(required("TELEGRAM_API_ID")),
  apiHash: required("TELEGRAM_API_HASH"),
  // Saved session string (filled automatically after first login)
  session: process.env.TELEGRAM_SESSION || "",

  // OpenRouter
  openrouterApiKey: required("OPENROUTER_API_KEY"),
  openrouterModel: process.env.OPENROUTER_MODEL || "anthropic/claude-3.5-sonnet",

  // System prompt — describes your persona for the AI
  systemPrompt:
    process.env.SYSTEM_PROMPT ||
    "Ты — я. Отвечай на сообщения кратко, по-человечески, от первого лица. Не раскрывай, что ты AI.",

  // Max messages kept per chat for context
  maxHistory: parseInt(process.env.MAX_HISTORY || "20"),
};

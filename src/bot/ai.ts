import axios from "axios";

export interface ContextMessage {
  role: "user" | "assistant";
  content: string;
  ts: number; // unix ms
}

function formatTs(ts: number): string {
  const d = new Date(ts);
  return d.toLocaleString("ru-RU", { day: "2-digit", month: "2-digit", year: "2-digit", hour: "2-digit", minute: "2-digit" });
}

function buildMessages(
  history: ContextMessage[],
  systemPrompt: string,
  info: string,
  memory: string
): { role: string; content: string }[] {
  let sys = systemPrompt;
  if (info) sys += `\n\n=== Информация о собеседнике ===\n${info}`;
  if (memory) sys += `\n\n=== Память (краткое резюме прошлых разговоров) ===\n${memory}`;
  // Timestamps are metadata only — never include them in your reply
  sys += `\n\n[Системное: временные метки в квадратных скобках — это служебные метаданные для твоего понимания контекста. Никогда не включай их в свои ответы.]`;

  return [
    { role: "system", content: sys },
    ...history.map((m) => ({
      role: m.role,
      // Only user messages get timestamp prefix; assistant messages stay clean
      content: m.role === "user" ? `[${formatTs(m.ts)}] ${m.content}` : m.content,
    })),
  ];
}

async function callAI(messages: { role: string; content: string }[], apiKey: string, model: string, timeout = 30000): Promise<string> {
  const response = await axios.post(
    "https://openrouter.ai/api/v1/chat/completions",
    { model, messages },
    {
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
        "HTTP-Referer": "https://github.com/tgbot",
        "X-Title": "TG Auto Responder",
      },
      timeout,
    }
  );
  const content = response.data?.choices?.[0]?.message?.content;
  if (!content) throw new Error("Empty response from AI");
  return content.trim();
}

// Generate a reply given full context
export async function generateResponse(
  history: ContextMessage[],
  systemPrompt: string,
  info: string,
  memory: string,
  apiKey: string,
  model: string
): Promise<string> {
  const messages = buildMessages(history, systemPrompt, info, memory);
  return callAI(messages, apiKey, model);
}

// Decide whether to reply at all
export async function shouldReplyCheck(
  history: ContextMessage[],
  info: string,
  memory: string,
  incomingMessage: string,
  apiKey: string,
  model: string
): Promise<boolean> {
  const sys = `Ты — система принятия решений. Тебе нужно решить: стоит ли отвечать на входящее сообщение в Telegram?

Отвечай ТОЛЬКО валидным JSON, без пояснений: {"reply": true} или {"reply": false}

НЕ отвечай когда:
- Разговор естественно завершён (например: "ок", "понял", "спасибо", "договорились", "пока")
- Сообщение — просто подтверждение без нового вопроса или темы
- Судя по времени сообщений — у человека ночь или раннее утро (нецелесообразно отвечать)
- Всё уже обсуждено и больше нечего добавить

ОТВЕЧАЙ когда:
- Есть вопрос, просьба, новая тема
- Разговор активный и ответ уместен
- Человек явно ждёт ответа${info ? `\n\nИнформация о собеседнике:\n${info}` : ""}${memory ? `\n\nПамять:\n${memory}` : ""}`;

  const msgs: { role: string; content: string }[] = [
    { role: "system", content: sys },
    ...history.slice(-10).map((m) => ({
      role: m.role,
      content: `[${formatTs(m.ts)}] ${m.content}`,
    })),
    { role: "user", content: `Новое входящее сообщение: "${incomingMessage}"\nОтвечать?` },
  ];

  try {
    const raw = await callAI(msgs, apiKey, model, 15000);
    const json = raw.match(/\{.*?\}/s)?.[0] ?? raw;
    const parsed = JSON.parse(json);
    return parsed.reply !== false;
  } catch {
    return true; // default: reply
  }
}

// Summarize old messages into memory string
export async function summarizeHistory(
  messages: ContextMessage[],
  existingMemory: string,
  apiKey: string,
  model: string
): Promise<string> {
  const formatted = messages
    .map((m) => `[${formatTs(m.ts)}] ${m.role === "user" ? "Собеседник" : "Я"}: ${m.content}`)
    .join("\n");

  const sys = `Ты — система создания краткого резюме переписки. Прочитай фрагмент переписки и напиши краткое резюме: о чём говорили, что решили, что важно. Максимум 200 слов. Отвечай только текстом резюме, без вводных фраз.${existingMemory ? `\n\nСуществующая память:\n${existingMemory}` : ""}`;

  const msgs = [
    { role: "system", content: sys },
    { role: "user", content: `Фрагмент переписки:\n${formatted}` },
  ];

  try {
    const summary = await callAI(msgs, apiKey, model, 20000);
    return existingMemory ? `${existingMemory}\n\n${summary}` : summary;
  } catch {
    return existingMemory;
  }
}

// Decide whether to write first and generate the message
export async function decideWriteFirst(
  history: ContextMessage[],
  info: string,
  memory: string,
  systemPrompt: string,
  apiKey: string,
  model: string
): Promise<{ write: boolean; message: string }> {
  const now = new Date();
  const hour = now.getHours();

  let sys = `${systemPrompt}

=== Задача ===
Напиши собеседнику сообщение первым. Придумай что-то уместное и естественное — продолжи общение, затронь общую тему, спроси как дела, или скажи что-то актуальное.

Текущее время: ${formatTs(Date.now())}

Единственная причина НЕ писать:
- Сейчас ночь (22:00–08:00). Текущий час: ${hour}:00. Если ночь — верни {"write": false}.

Во всех остальных случаях ОБЯЗАТЕЛЬНО напиши сообщение. Даже если история пустая — начни разговор естественно.

Ответ ТОЛЬКО в JSON: {"write": true, "message": "текст сообщения"} или {"write": false}`;

  if (info) sys += `\n\nИнформация о собеседнике:\n${info}`;
  if (memory) sys += `\n\nПамять:\n${memory}`;

  const msgs: { role: string; content: string }[] = [
    { role: "system", content: sys },
    ...history.slice(-5).map((m) => ({
      role: m.role,
      content: `[${formatTs(m.ts)}] ${m.content}`,
    })),
    { role: "user", content: "Напиши сообщение." },
  ];

  try {
    const raw = await callAI(msgs, apiKey, model, 20000);
    const json = raw.match(/\{.*?\}/s)?.[0] ?? raw;
    const parsed = JSON.parse(json);
    if (parsed.write && parsed.message) return { write: true, message: String(parsed.message) };
    return { write: false, message: "" };
  } catch {
    return { write: false, message: "" };
  }
}

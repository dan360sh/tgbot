import axios from "axios";
import { config } from "./config";

interface Message {
  role: "user" | "assistant" | "system";
  content: string;
}

export async function generateResponse(
  history: { role: "user" | "assistant"; content: string }[]
): Promise<string> {
  const messages: Message[] = [
    { role: "system", content: config.systemPrompt },
    ...history,
  ];

  const response = await axios.post(
    "https://openrouter.ai/api/v1/chat/completions",
    {
      model: config.openrouterModel,
      messages,
    },
    {
      headers: {
        Authorization: `Bearer ${config.openrouterApiKey}`,
        "Content-Type": "application/json",
        "HTTP-Referer": "https://github.com/tgbot",
        "X-Title": "TG Auto Responder",
      },
      timeout: 30000,
    }
  );

  const content = response.data?.choices?.[0]?.message?.content;
  if (!content) throw new Error("Empty response from OpenRouter");
  return content.trim();
}

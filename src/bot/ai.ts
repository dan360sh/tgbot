import axios from "axios";

export async function generateResponse(
  history: { role: "user" | "assistant"; content: string }[],
  systemPrompt: string,
  apiKey: string,
  model: string
): Promise<string> {
  const messages = [
    { role: "system", content: systemPrompt },
    ...history,
  ];

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
      timeout: 30000,
    }
  );

  const content = response.data?.choices?.[0]?.message?.content;
  if (!content) throw new Error("Empty response from OpenRouter");
  return content.trim();
}

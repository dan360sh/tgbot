export interface AIModel {
  id: string;               // OpenRouter model ID
  name: string;             // Display name in UI
  costPer1000Words: number; // Cost in internal tokens per 1000 words
}

// ======================================================
// ДОБАВЛЯЙТЕ МОДЕЛИ ЗДЕСЬ
// id: идентификатор модели на OpenRouter (openrouter.ai/models)
// name: название для отображения в интерфейсе
// costPer1000Words: стоимость в токенах за 1000 слов
// ======================================================
export const AI_MODELS: AIModel[] = [
  { id: "openai/gpt-4o-mini",           name: "GPT-4o Mini",           costPer1000Words: 10 },
  { id: "openai/gpt-4o",                name: "GPT-4o",                costPer1000Words: 30 },
  { id: "anthropic/claude-3.5-haiku",   name: "Claude 3.5 Haiku",      costPer1000Words: 15 },
  { id: "anthropic/claude-3.5-sonnet",  name: "Claude 3.5 Sonnet",     costPer1000Words: 40 },
  { id: "meta-llama/llama-3.1-8b-instruct:free", name: "Llama 3.1 8B (бесплатно)", costPer1000Words: 0 },
  // Добавьте свои модели выше этой строки
];

export function getModel(id: string): AIModel {
  return AI_MODELS.find((m) => m.id === id) ?? AI_MODELS[0];
}

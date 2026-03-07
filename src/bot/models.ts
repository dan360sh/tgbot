export interface AIModel {
  id: string;               // OpenRouter model ID (например "openai/gpt-4o-mini")
  name: string;             // Название для отображения в интерфейсе
  apiKey: string;           // API ключ OpenRouter для этой модели
  costPer1000Words: number; // Стоимость в токенах за 1000 слов ответа
}

// ======================================================
// ДОБАВЛЯЙТЕ И РЕДАКТИРУЙТЕ МОДЕЛИ ЗДЕСЬ
//
// id: идентификатор модели с openrouter.ai/models
//     (кнопка "Copy ID" на странице модели)
// name: название для отображения пользователю
// apiKey: ваш API ключ OpenRouter (sk-or-v1-...)
// costPer1000Words: сколько токенов списывать за 1000 слов ответа
// ======================================================
export const AI_MODELS: AIModel[] = [
  {
    id: "qwen/qwen3.5-27b",
    name: "qwen",
    apiKey: "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",
    costPer1000Words: 10,
  },
  {
    id: "anthropic/claude-sonnet-4.6",
    name: "Claude",
    apiKey: "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",
    costPer1000Words: 30,
  }
  // Добавьте свои модели выше этой строки
];

export function getModel(id: string): AIModel {
  return AI_MODELS.find((m) => m.id === id) ?? AI_MODELS[0];
}

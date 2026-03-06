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
    id: "openai/gpt-4o-mini",
    name: "GPT-4o Mini",
    apiKey: "sk-or-v1-ВАШ_КЛЮЧ_ЗДЕСЬ",
    costPer1000Words: 10,
  },
  {
    id: "openai/gpt-4o",
    name: "GPT-4o",
    apiKey: "sk-or-v1-ВАШ_КЛЮЧ_ЗДЕСЬ",
    costPer1000Words: 30,
  },
  {
    id: "anthropic/claude-3.5-haiku",
    name: "Claude 3.5 Haiku",
    apiKey: "sk-or-v1-ВАШ_КЛЮЧ_ЗДЕСЬ",
    costPer1000Words: 15,
  },
  {
    id: "anthropic/claude-3.5-sonnet",
    name: "Claude 3.5 Sonnet",
    apiKey: "sk-or-v1-ВАШ_КЛЮЧ_ЗДЕСЬ",
    costPer1000Words: 40,
  },
  // Добавьте свои модели выше этой строки
];

export function getModel(id: string): AIModel {
  return AI_MODELS.find((m) => m.id === id) ?? AI_MODELS[0];
}

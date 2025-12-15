import * as crypto from "crypto";
import * as fs from "fs/promises";
import * as path from "path";
import { OllamaClient } from "./ollama";
import { PersonalizationManager } from "./personalization";

interface ErrorLog {
  timestamp: string;
  level: string;
  service: string;
  error_type: string;
  message: string;
  user_id: string | null;
  request_id: string;
  stack_trace: string;
  metadata: Record<string, any>;
}

interface EmbeddedLog {
  log: ErrorLog;
  embedding: number[];
  text: string; // Текстовое представление для поиска
}

interface EmbeddingCache {
  fileHash: string;
  embeddedLogs: EmbeddedLog[];
  createdAt: string;
}

export class RAGSystem {
  private ollama: OllamaClient;
  private embeddedLogs: EmbeddedLog[] = [];
  private allLogs: ErrorLog[] = [];
  private cacheDir = "./data/.cache";
  private personalization?: PersonalizationManager;

  constructor() {
    this.ollama = new OllamaClient();
  }

  // Установить менеджер персонализации
  setPersonalization(personalization: PersonalizationManager): void {
    this.personalization = personalization;
  }

  // Вычисление хеша файла для валидации кеша
  private async getFileHash(filePath: string): Promise<string> {
    const content = await fs.readFile(filePath, "utf-8");
    return crypto.createHash("md5").update(content).digest("hex");
  }

  // Получение пути к файлу кеша
  private getCachePath(filePath: string): string {
    const fileName = path.basename(filePath, path.extname(filePath));
    return path.join(this.cacheDir, `${fileName}.embeddings.json`);
  }

  // Загрузка кеша embeddings
  private async loadCache(filePath: string): Promise<EmbeddingCache | null> {
    try {
      const cachePath = this.getCachePath(filePath);
      const cacheContent = await fs.readFile(cachePath, "utf-8");
      return JSON.parse(cacheContent);
    } catch {
      return null;
    }
  }

  // Сохранение кеша embeddings
  private async saveCache(filePath: string, fileHash: string): Promise<void> {
    try {
      await fs.mkdir(this.cacheDir, { recursive: true });

      const cache: EmbeddingCache = {
        fileHash,
        embeddedLogs: this.embeddedLogs,
        createdAt: new Date().toISOString(),
      };

      const cachePath = this.getCachePath(filePath);
      await fs.writeFile(cachePath, JSON.stringify(cache, null, 2));
      console.log("💾 Embeddings сохранены в кеш\n");
    } catch (error) {
      console.warn("⚠️  Не удалось сохранить кеш:", error);
    }
  }

  // Загрузка и индексация логов
  async loadAndIndexLogs(filePath: string): Promise<void> {
    console.log("📂 Загрузка логов из файла...");
    const fileContent = await fs.readFile(filePath, "utf-8");
    this.allLogs = JSON.parse(fileContent);

    console.log(`✅ Загружено ${this.allLogs.length} записей`);

    // Вычисляем хеш файла
    const currentHash = await this.getFileHash(filePath);

    // Пытаемся загрузить кеш
    console.log("🔍 Проверка кеша embeddings...");
    const cache = await this.loadCache(filePath);

    if (cache && cache.fileHash === currentHash) {
      console.log("✅ Найден валидный кеш! Загружаем embeddings из кеша...");
      this.embeddedLogs = cache.embeddedLogs;
      console.log(
        `✅ Загружено ${this.embeddedLogs.length} embeddings из кеша\n`
      );
      return;
    }

    // Кеш невалидный или отсутствует - создаем embeddings
    console.log("🔄 Создание embeddings (может занять минуту)...\n");

    for (let i = 0; i < this.allLogs.length; i++) {
      const log = this.allLogs[i];
      const text = this.logToText(log);

      // Показываем прогресс
      process.stdout.write(
        `\r   ${i + 1}/${this.allLogs.length} записей обработано...`
      );

      const embedding = await this.ollama.createEmbedding(text);

      this.embeddedLogs.push({
        log,
        embedding,
        text,
      });
    }

    console.log("\n✅ Индексация завершена!");

    // Сохраняем кеш
    await this.saveCache(filePath, currentHash);
  }

  // Преобразование лога в текст для embedding
  private logToText(log: ErrorLog): string {
    return `
Service: ${log.service}
Error Type: ${log.error_type}
Message: ${log.message}
Timestamp: ${log.timestamp}
Metadata: ${JSON.stringify(log.metadata)}
    `.trim();
  }

  // Cosine similarity между двумя векторами
  private cosineSimilarity(a: number[], b: number[]): number {
    const dotProduct = a.reduce((sum, val, i) => sum + val * b[i], 0);
    const magnitudeA = Math.sqrt(a.reduce((sum, val) => sum + val * val, 0));
    const magnitudeB = Math.sqrt(b.reduce((sum, val) => sum + val * val, 0));
    return dotProduct / (magnitudeA * magnitudeB);
  }

  // Поиск наиболее релевантных логов для вопроса
  async findRelevantLogs(
    question: string,
    topK: number = 5
  ): Promise<ErrorLog[]> {
    // Создаем embedding для вопроса
    const questionEmbedding = await this.ollama.createEmbedding(question);

    // Вычисляем similarity для всех логов
    const similarities = this.embeddedLogs.map((embeddedLog) => ({
      log: embeddedLog.log,
      similarity: this.cosineSimilarity(
        questionEmbedding,
        embeddedLog.embedding
      ),
    }));

    // Сортируем по similarity и берем top K
    similarities.sort((a, b) => b.similarity - a.similarity);

    return similarities.slice(0, topK).map((item) => item.log);
  }

  // Получить общую статистику по логам
  getStatistics(): string {
    const errorTypes: Record<string, number> = {};
    const services: Record<string, number> = {};

    this.allLogs.forEach((log) => {
      errorTypes[log.error_type] = (errorTypes[log.error_type] || 0) + 1;
      services[log.service] = (services[log.service] || 0) + 1;
    });

    const sortedErrors = Object.entries(errorTypes)
      .sort(([, a], [, b]) => b - a)
      .map(([type, count]) => `  - ${type}: ${count}`)
      .join("\n");

    const sortedServices = Object.entries(services)
      .sort(([, a], [, b]) => b - a)
      .map(([service, count]) => `  - ${service}: ${count}`)
      .join("\n");

    return `
ОБЩАЯ СТАТИСТИКА ЛОГОВ:
-----------------------
Всего записей: ${this.allLogs.length}

Ошибки по типам:
${sortedErrors}

Ошибки по сервисам:
${sortedServices}
    `.trim();
  }

  // Получить персонализированную сводку
  getPersonalizedSummary(): string {
    if (!this.personalization) {
      return "";
    }

    const profile = this.personalization.getProfile();
    if (!profile) {
      return "";
    }

    // Находим проблемы в сервисах пользователя
    const userServices = profile.responsibilities.services;

    const relevantLogs = this.allLogs.filter((log) =>
      this.personalization!.isRelevantToUser(log.service, log.error_type)
    );

    if (relevantLogs.length === 0) {
      const emoji = profile.preferences.useEmoji ? " ✅" : "";
      return `\n${emoji} В твоих сервисах (${userServices.join(
        ", "
      )}) всё спокойно!`;
    }

    const emoji = profile.preferences.useEmoji ? " ⚠️" : "";
    return `\n${emoji} ВАЖНО ДЛЯ ТЕБЯ: ${relevantLogs.length} проблем${
      relevantLogs.length === 1 ? "а" : ""
    } в твоих сервисах (${userServices.join(", ")})`;
  }

  // Задать вопрос с использованием RAG
  async askQuestion(
    question: string,
    onToken?: (token: string) => void
  ): Promise<string> {
    const raw = question ?? "";
    const q = raw
      .trim()
      .toLowerCase()
      .replace(/[!?.,:;()"'`]/g, "") // убираем пунктуацию
      .replace(/\s+/g, " "); // нормализуем пробелы

    const profile = this.personalization?.getProfile?.() ?? null;

    const isNameQuery =
      /\b(как\s+)?меня\s+зовут\b/.test(q) ||
      /\bмо[её]\s+имя\b/.test(q) ||
      /\bимя\s+профил(я|е)\b/.test(q);

    if (isNameQuery) {
      if (profile?.name) {
        const emoji = profile.preferences.useEmoji ? "👤 " : "";
        const response = `${emoji}${profile.name}`;
        if (onToken) response.split("").forEach(onToken);
        return response;
      }

      const response = "Имя в профиле не задано.";
      if (onToken) response.split("").forEach(onToken);
      return response;
    }

    // Определяем тип вопроса
    const isPersonalQuery =
      /расскажи.*обо мне|кто я|что.*знаешь.*обо мне|мой профиль|моя информация|какое.*имя.*пользовател|какое.*имя.*профил|как.*меня.*зовут|моё имя|мое имя/i.test(
        question
      );

    // Если это личный вопрос и есть персонализация - отвечаем без RAG
    if (isPersonalQuery && this.personalization) {
      const profile = this.personalization.getProfile();
      if (profile) {
        const emoji = profile.preferences.useEmoji ? "👤 " : "";
        const response = `${emoji}Вот что я знаю о тебе:

${this.personalization.getUserContext()}

Рабочие часы: ${profile.workingHours.start} - ${profile.workingHours.end}
Стиль ответов: ${profile.preferences.answerStyle}
Технический уровень: ${profile.preferences.technicalLevel}

${this.getPersonalizedSummary()}`;

        // Выводим ответ сразу (без streaming для простоты)
        if (onToken) {
          response.split("").forEach((char) => onToken(char));
        }
        return response;
      }
    }

    const isStatisticalQuery =
      /сколько|какая.*чаще|какой.*больше|какая.*самая|топ|статистика/i.test(
        question
      );

    // Находим релевантные логи
    const relevantLogs = await this.findRelevantLogs(question, 8);

    // Формируем контекст для модели
    const context = relevantLogs
      .map((log, idx) =>
        `
[Запись ${idx + 1}]
Сервис: ${log.service}
Тип ошибки: ${log.error_type}
Сообщение: ${log.message}
Время: ${log.timestamp}
User ID: ${log.user_id || "N/A"}
Метаданные: ${JSON.stringify(log.metadata, null, 2)}
      `.trim()
      )
      .join("\n\n---\n\n");

    // Получаем контекст пользователя если есть персонализация
    // const profile = this.personalization?.getProfile() ?? null;

    const userContext = this.personalization
      ? `USER CONTEXT:\n${this.personalization.getUserContext()}\n`
      : `USER CONTEXT:\nне задан\n`;

    const technicalLevel = profile?.preferences?.technicalLevel || "advanced";
    const useEmoji = profile?.preferences?.useEmoji ?? false;

    const responsibleServices = profile?.responsibilities?.services?.length
      ? profile.responsibilities.services.join(", ")
      : "не указано";

    const criticalErrors = profile?.responsibilities?.criticalErrors?.length
      ? profile.responsibilities.criticalErrors.join(", ")
      : "не указано";

    const decisionPolicy = `
DECISION POLICY (ОБЯЗАТЕЛЬНО):
1. Если ошибка относится к сервисам пользователя (${responsibleServices}) → это ГЛАВНЫЙ ПРИОРИТЕТ ответа.
2. Если тип ошибки входит в критичные (${criticalErrors}) → помечай как "КРИТИЧНО ДЛЯ ТЕБЯ" и выноси в начало.
3. Чужие сервисы упоминай кратко, без углубления.
4. Уровень объяснений: ${technicalLevel}. Базовые вещи не объясняй.
5. Пиши напрямую пользователю: "у тебя", "твой сервис", "твоя зона ответственности".
`.trim();

    const outputRules = `
OUTPUT RULES (ОБЯЗАТЕЛЬНО):
- Запрещено отвечать обезличенно ("в системе", "в целом", "обычно").
- Запрещены предположения без данных ("возможно", "вероятно") в статистическом режиме.
- Если emoji отключены — не используй emoji вообще.
- Не пересказывай логи: анализируй и делай выводы.
`.trim();

    const responseFormat = `
RESPONSE FORMAT (ОБЯЗАТЕЛЕН):
1) ВЫВОД (1–2 строки, персонально)
2) ЧТО ПРОИСХОДИТ (факты, цифры)
3) ПОЧЕМУ ЭТО ВАЖНО ДЛЯ ТЕБЯ
4) ЧТО ПРОВЕРИТЬ / СДЕЛАТЬ (маркированный список)
`.trim();

    const emojiRule = useEmoji
      ? `EMOJI: разрешены, но умеренно (0–3 на ответ).`
      : `EMOJI: запрещены.`;

    const baseSystemPrompt = `
ROLE:
Ты — персональный аналитик логов и ошибок (RAG). Ты отвечаешь ОДНОМУ пользователю и обязан учитывать его профиль.

IMPORTANT:
Игнорирование персонализации считается ошибкой ответа.

Brevity policy:
- Если вопрос можно закрыть одним фактом/числом/словом — ответь одной строкой.
- НЕ добавляй разделы и списки, если они не нужны для ответа.
- Формат из 4 секций используй только когда вопрос требует объяснения/анализа.э

Personal questions about the user profile:
- Если вопрос про имя/роль/рабочие часы/сервисы — отвечай ТОЛЬКО данными профиля.
- Запрещено добавлять анализ логов, статистику и рекомендации.

${emojiRule}

${userContext}

${decisionPolicy}

${outputRules}

${responseFormat}
`.trim();

    // Системный промпт - разный для статистических и детальных вопросов
    let systemPrompt: string;
    let userMessage: string;

    if (isStatisticalQuery) {
      systemPrompt = `
${baseSystemPrompt}

MODE: STATISTICS

AVAILABLE DATA:
Используй ТОЛЬКО агрегированную статистику ниже. Примеры логов игнорируй полностью.

STATISTICS:
${this.getStatistics()}

RULES FOR THIS MODE:
1) Все цифры должны быть строго из STATISTICS.
2) Никаких догадок, никаких "возможно/вероятно".
3) Если вопрос про сервисы пользователя — упомяни это в ВЫВОДЕ.
4) Если критичная ошибка встречается — явно пометь "КРИТИЧНО ДЛЯ ТЕБЯ".
`.trim();

      userMessage = `QUESTION:\n${question}`.trim();
    } else {
      systemPrompt = `
${baseSystemPrompt}

MODE: ANALYSIS

GLOBAL STATISTICS (для подсчётов и контекста):
${this.getStatistics()}

CONTEXT LOGS:
Ниже приведены примеры (${relevantLogs.length} из ${
        this.allLogs.length
      }). Они НЕ отражают полную картину.
Используй их ТОЛЬКО для деталей (симптомы, паттерны, примеры сообщений), а не для итоговых подсчётов.
`.trim();

      userMessage = `
QUESTION:
${question}

LOG EXAMPLES:
${context}
`.trim();
    }

    // Получаем ответ от модели
    console.log("🤖 Qwen анализирует...\n");
    const response = await this.ollama.chat(systemPrompt, userMessage, onToken);

    return response;
  }
}

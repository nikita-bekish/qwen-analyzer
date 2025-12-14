import * as crypto from "crypto";
import * as fs from "fs/promises";
import * as path from "path";
import { OllamaClient } from "./ollama";

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

  constructor() {
    this.ollama = new OllamaClient();
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

  // Задать вопрос с использованием RAG
  async askQuestion(
    question: string,
    onToken?: (token: string) => void
  ): Promise<string> {
    // Определяем, нужны ли детальные примеры
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

    // Системный промпт - разный для статистических и детальных вопросов
    let systemPrompt: string;
    let userMessage: string;

    if (isStatisticalQuery) {
      // Для статистических вопросов - НЕ показываем примеры вообще
      systemPrompt = `Ты - аналитик данных. Отвечай ТОЛЬКО на основе статистики ниже.

${this.getStatistics()}

ИНСТРУКЦИЯ: Используй ТОЛЬКО цифры из статистики выше. Отвечай точно и кратко.`;

      userMessage = question;
    } else {
      // Для детальных вопросов - показываем примеры
      systemPrompt = `Ты - аналитик данных, специализирующийся на анализе логов ошибок.

ПОЛНАЯ СТАТИСТИКА (для подсчетов):
${this.getStatistics()}

⚠️ ВАЖНО: Ниже только ${relevantLogs.length} примеров из ${
        this.allLogs.length
      } записей!
Для подсчетов используй статистику выше, примеры - только для деталей (время, IP, метаданные).`;

      userMessage = `
Вопрос: ${question}

Релевантные записи:
${context}
      `.trim();
    }

    // Получаем ответ от модели
    console.log("🤖 Qwen анализирует...\n");
    const response = await this.ollama.chat(systemPrompt, userMessage, onToken);

    return response;
  }
}

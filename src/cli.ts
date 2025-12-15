import * as readline from 'readline';
import { RAGSystem } from './rag';
import { OllamaClient } from './ollama';
import { PersonalizationManager } from './personalization';

export class CLI {
  private rag: RAGSystem;
  private rl: readline.Interface;
  private personalization: PersonalizationManager;

  constructor() {
    this.rag = new RAGSystem();
    this.personalization = new PersonalizationManager();
    this.rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
    });
  }

  private async question(prompt: string): Promise<string> {
    return new Promise((resolve) => {
      this.rl.question(prompt, (answer) => {
        resolve(answer);
      });
    });
  }

  private printHeader(): void {
    console.clear();
    console.log('╔════════════════════════════════════════════════════════╗');
    console.log('║         🔍 QWEN LOCAL DATA ANALYZER 🔍                ║');
    console.log('║   Локальный аналитик данных с использованием RAG      ║');
    console.log('╚════════════════════════════════════════════════════════╝\n');
  }

  private printHelp(): void {
    console.log('\n📚 Примеры вопросов:');
    console.log('  • Какая ошибка встречается чаще всего?');
    console.log('  • Какой сервис генерирует больше всего ошибок?');
    console.log('  • Сколько было ошибок DatabaseConnectionError?');
    console.log('  • Какие проблемы есть в payment-service?');
    console.log('  • Есть ли проблемы с одним IP адресом?');
    console.log('  • Какое среднее время ответа для PaymentGatewayTimeout?\n');
  }

  async start(): Promise<void> {
    this.printHeader();

    // Загружаем профиль персонализации
    try {
      await this.personalization.loadProfile();
      this.rag.setPersonalization(this.personalization);

      // Персонализированное приветствие
      console.log(this.personalization.getGreeting());
      console.log('');
    } catch (error) {
      console.log('ℹ️  Профиль персонализации не найден. Работаю в стандартном режиме.\n');
    }

    // Проверяем доступность моделей
    console.log('🔍 Проверка доступности моделей Ollama...');
    const ollama = new OllamaClient();
    const modelsAvailable = await ollama.checkModels();

    if (!modelsAvailable.chat) {
      console.error('❌ Модель qwen2.5-coder:7b не найдена!');
      console.error('   Установите её: ollama pull qwen2.5-coder:7b');
      process.exit(1);
    }

    if (!modelsAvailable.embedding) {
      console.error('❌ Модель nomic-embed-text не найдена!');
      console.error('   Установите её: ollama pull nomic-embed-text');
      process.exit(1);
    }

    console.log('✅ Все модели доступны\n');

    // Загружаем и индексируем логи
    const logFilePath = './data/error-logs.json';
    try {
      await this.rag.loadAndIndexLogs(logFilePath);
    } catch (error) {
      console.error(`❌ Ошибка загрузки файла ${logFilePath}:`, error);
      process.exit(1);
    }

    // Показываем статистику
    console.log(this.rag.getStatistics());

    // Показываем персонализированную сводку
    const personalizedSummary = this.rag.getPersonalizedSummary();
    if (personalizedSummary) {
      console.log(personalizedSummary);
    }

    this.printHelp();

    // Интерактивный цикл вопрос-ответ
    await this.interactiveMode();
  }

  private async interactiveMode(): Promise<void> {
    console.log('\n' + '═'.repeat(60));
    console.log('💬 Режим вопросов-ответов (введите "exit" для выхода)\n');

    while (true) {
      const question = await this.question('❓ Ваш вопрос: ');

      if (question.toLowerCase() === 'exit' || question.toLowerCase() === 'quit') {
        const profile = this.personalization.getProfile();
        const emoji = profile?.preferences.useEmoji ? '👋 ' : '';
        const name = profile?.name ? `, ${profile.name}` : '';
        console.log(`\n${emoji}До свидания${name}!`);
        this.rl.close();
        break;
      }

      if (!question.trim()) {
        continue;
      }

      console.log('\n' + '─'.repeat(60));

      // Задаем вопрос с streaming ответом
      try {
        await this.rag.askQuestion(question, (token) => {
          process.stdout.write(token);
        });

        console.log('\n' + '─'.repeat(60) + '\n');
      } catch (error) {
        console.error('\n❌ Ошибка при обработке вопроса:', error);
        console.log('─'.repeat(60) + '\n');
      }
    }
  }
}

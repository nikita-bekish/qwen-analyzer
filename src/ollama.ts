import { Ollama } from 'ollama';

export class OllamaClient {
  private ollama: Ollama;
  private chatModel = 'qwen2.5-coder:7b';
  private embeddingModel = 'nomic-embed-text:latest';

  constructor() {
    this.ollama = new Ollama();
  }

  // Создание embedding для текста
  async createEmbedding(text: string): Promise<number[]> {
    try {
      const response = await this.ollama.embeddings({
        model: this.embeddingModel,
        prompt: text,
      });
      return response.embedding;
    } catch (error) {
      console.error('Error creating embedding:', error);
      throw error;
    }
  }

  // Streaming ответ от Qwen с отображением прогресса
  async chat(
    systemPrompt: string,
    userMessage: string,
    onToken?: (token: string) => void
  ): Promise<string> {
    try {
      const response = await this.ollama.chat({
        model: this.chatModel,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userMessage },
        ],
        stream: true,
      });

      let fullResponse = '';

      for await (const part of response) {
        const token = part.message.content;
        fullResponse += token;

        if (onToken) {
          onToken(token);
        }
      }

      return fullResponse;
    } catch (error) {
      console.error('Error during chat:', error);
      throw error;
    }
  }

  // Проверка доступности моделей
  async checkModels(): Promise<{ chat: boolean; embedding: boolean }> {
    try {
      const models = await this.ollama.list();
      const modelNames = models.models.map(m => m.name);

      return {
        chat: modelNames.some(name => name.includes('qwen2.5-coder')),
        embedding: modelNames.some(name => name.includes('nomic-embed-text')),
      };
    } catch (error) {
      console.error('Error checking models:', error);
      return { chat: false, embedding: false };
    }
  }
}

import { readFile } from "fs/promises";
import { resolve } from "path";

interface UserProfile {
  name: string;
  role: string;
  experience: string;
  timezone: string;
  preferences: {
    answerStyle: string;
    includeRecommendations: boolean;
    technicalLevel: string;
    useEmoji: boolean;
  };
  responsibilities: {
    services: string[];
    criticalErrors: string[];
  };
  workingHours: {
    start: string;
    end: string;
  };
}

export class PersonalizationManager {
  private profile: UserProfile | null = null;

  /**
   * Загружает профиль пользователя из JSON файла
   * @param profilePath - путь к файлу профиля
   * @throws Error если файл не найден или содержит невалидный JSON
   */
  async loadProfile(
    profilePath: string = "./config/profile.json"
  ): Promise<void> {
    try {
      const absolutePath = resolve(profilePath);
      const fileContent = await readFile(absolutePath, "utf-8");

      const parsedProfile = JSON.parse(fileContent);

      // Валидация структуры профиля
      this.validateProfile(parsedProfile);

      this.profile = parsedProfile;
    } catch (error) {
      if (error instanceof Error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") {
          throw new Error(`Profile file not found: ${profilePath}`);
        }
        if (error instanceof SyntaxError) {
          throw new Error(`Invalid JSON in profile file: ${error.message}`);
        }
        throw new Error(`Failed to load profile: ${error.message}`);
      }
      throw error;
    }
  }

  /**
   * Валидирует структуру профиля
   * @param profile - объект профиля для валидации
   * @throws Error если структура профиля невалидна
   */
  private validateProfile(profile: any): asserts profile is UserProfile {
    if (!profile || typeof profile !== "object") {
      throw new Error("Profile must be an object");
    }

    const requiredFields = ["name", "role", "experience", "timezone", "preferences", "responsibilities", "workingHours"];
    for (const field of requiredFields) {
      if (!(field in profile)) {
        throw new Error(`Missing required field: ${field}`);
      }
    }

    if (!profile.preferences || typeof profile.preferences !== "object") {
      throw new Error("Invalid preferences structure");
    }

    if (!profile.responsibilities || typeof profile.responsibilities !== "object") {
      throw new Error("Invalid responsibilities structure");
    }

    if (!Array.isArray(profile.responsibilities.services)) {
      throw new Error("responsibilities.services must be an array");
    }

    if (!Array.isArray(profile.responsibilities.criticalErrors)) {
      throw new Error("responsibilities.criticalErrors must be an array");
    }
  }

  /**
   * Возвращает персонализированное приветствие
   * @returns строка с приветствием
   * @throws Error если профиль не загружен
   */
  getGreeting(): string {
    if (!this.profile) {
      throw new Error("Profile not loaded. Call loadProfile() first.");
    }

    const { name, preferences } = this.profile;
    const hour = new Date().getHours();

    let greeting: string;
    if (hour >= 5 && hour < 12) {
      greeting = "Доброе утро";
    } else if (hour >= 12 && hour < 18) {
      greeting = "Добрый день";
    } else if (hour >= 18 && hour < 23) {
      greeting = "Добрый вечер";
    } else {
      greeting = "Доброй ночи";
    }

    const emoji = preferences.useEmoji ? " 👋" : "";
    return `${greeting}, ${name}!${emoji}`;
  }

  /**
   * Возвращает строку с контекстом пользователя для промпта
   * @returns многострочный контекст пользователя
   * @throws Error если профиль не загружен
   */
  getUserContext(): string {
    if (!this.profile) {
      throw new Error("Profile not loaded. Call loadProfile() first.");
    }

    const { name, role, experience, responsibilities } = this.profile;

    const servicesStr = responsibilities.services.length > 0
      ? responsibilities.services.join(", ")
      : "не указано";

    const errorsStr = responsibilities.criticalErrors.length > 0
      ? responsibilities.criticalErrors.join(", ")
      : "не указано";

    return `Пользователь: ${name}, ${role} (${experience})
Ответственность: ${servicesStr}
Критичные ошибки: ${errorsStr}`;
  }

  /**
   * Проверяет релевантность ошибки для пользователя
   * @param serviceName - название сервиса
   * @param errorType - тип ошибки
   * @returns true если ошибка релевантна пользователю
   * @throws Error если профиль не загружен
   */
  isRelevantToUser(serviceName: string, errorType: string): boolean {
    if (!this.profile) {
      throw new Error("Profile not loaded. Call loadProfile() first.");
    }

    const { services, criticalErrors } = this.profile.responsibilities;

    // Проверяем, находится ли serviceName в списке ответственных сервисов
    const isResponsibleService = services.some(
      (service) => service.toLowerCase() === serviceName.toLowerCase()
    );

    // Проверяем, находится ли errorType в списке критичных ошибок
    const isCriticalError = criticalErrors.some(
      (error) => error.toLowerCase() === errorType.toLowerCase()
    );

    return isResponsibleService || isCriticalError;
  }

  /**
   * Возвращает загруженный профиль пользователя
   * @returns профиль пользователя или null если не загружен
   */
  getProfile(): UserProfile | null {
    return this.profile;
  }

  /**
   * Проверяет, находится ли текущее время в рабочих часах пользователя
   * @returns true если сейчас рабочее время
   * @throws Error если профиль не загружен
   */
  isWorkingHours(): boolean {
    if (!this.profile) {
      throw new Error("Profile not loaded. Call loadProfile() first.");
    }

    const now = new Date();
    const currentTime = `${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`;

    const { start, end } = this.profile.workingHours;

    return currentTime >= start && currentTime <= end;
  }
}

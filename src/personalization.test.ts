import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert";
import { PersonalizationManager } from "./personalization.js";
import { writeFile, unlink, mkdir } from "fs/promises";
import { existsSync } from "fs";
import { join } from "path";

describe("PersonalizationManager", () => {
  let manager: PersonalizationManager;
  const testDir = join(process.cwd(), ".test-tmp");
  const testProfilePath = join(testDir, "test-profile.json");

  beforeEach(async () => {
    manager = new PersonalizationManager();
    // Create test directory if it doesn't exist
    if (!existsSync(testDir)) {
      await mkdir(testDir, { recursive: true });
    }
  });

  afterEach(async () => {
    // Clean up test files
    try {
      if (existsSync(testProfilePath)) {
        await unlink(testProfilePath);
      }
    } catch (err) {
      // Ignore cleanup errors
    }
  });

  describe("loadProfile", () => {
    it("should successfully load a valid profile", async () => {
      const validProfile = {
        name: "Иван Иванов",
        role: "DevOps Engineer",
        experience: "5 лет опыта",
        timezone: "Europe/Moscow",
        preferences: {
          answerStyle: "краткий",
          includeRecommendations: true,
          technicalLevel: "продвинутый",
          useEmoji: true,
        },
        responsibilities: {
          services: ["api-gateway", "auth-service"],
          criticalErrors: ["OutOfMemoryError", "ConnectionTimeout"],
        },
        workingHours: {
          start: "09:00",
          end: "18:00",
        },
      };

      await writeFile(testProfilePath, JSON.stringify(validProfile, null, 2));

      await manager.loadProfile(testProfilePath);
      const profile = manager.getProfile();

      assert.strictEqual(profile?.name, "Иван Иванов");
      assert.strictEqual(profile?.role, "DevOps Engineer");
      assert.deepStrictEqual(profile?.preferences, validProfile.preferences);
    });

    it("should throw error when file is not found", async () => {
      await assert.rejects(
        async () => await manager.loadProfile("./non-existent.json"),
        {
          message: /Profile file not found:/,
        }
      );
    });

    it("should throw error when JSON is invalid", async () => {
      await writeFile(testProfilePath, "{ invalid json }");

      await assert.rejects(
        async () => await manager.loadProfile(testProfilePath),
        {
          message: /Invalid JSON in profile file:/,
        }
      );
    });

    it("should throw error when profile structure is invalid", async () => {
      const incompleteProfile = {
        name: "Test User",
        role: "Developer",
        experience: "5 years",
      };

      await writeFile(testProfilePath, JSON.stringify(incompleteProfile));

      await assert.rejects(
        async () => await manager.loadProfile(testProfilePath),
        {
          message: /Missing required field: timezone/,
        }
      );
    });

    it("should throw error when profile is not an object", async () => {
      await writeFile(testProfilePath, JSON.stringify("not an object"));

      await assert.rejects(
        async () => await manager.loadProfile(testProfilePath),
        {
          message: /Profile must be an object/,
        }
      );
    });
  });

  describe("getGreeting", () => {
    async function setupProfile() {
      const validProfile = {
        name: "Алексей",
        role: "DevOps Engineer",
        experience: "5 лет опыта",
        timezone: "Europe/Moscow",
        preferences: {
          answerStyle: "краткий",
          includeRecommendations: true,
          technicalLevel: "продвинутый",
          useEmoji: true,
        },
        responsibilities: {
          services: ["api-gateway"],
          criticalErrors: ["OutOfMemoryError"],
        },
        workingHours: {
          start: "09:00",
          end: "18:00",
        },
      };

      await writeFile(testProfilePath, JSON.stringify(validProfile));
      await manager.loadProfile(testProfilePath);
    }

    it("should return morning greeting (5:00 - 11:59)", async () => {
      await setupProfile();

      const originalDate = global.Date;
      global.Date = class extends originalDate {
        getHours() {
          return 10;
        }
      } as any;

      const greeting = manager.getGreeting();
      assert.strictEqual(greeting, "Доброе утро, Алексей! 👋");

      global.Date = originalDate;
    });

    it("should return afternoon greeting (12:00 - 17:59)", async () => {
      await setupProfile();

      const originalDate = global.Date;
      global.Date = class extends originalDate {
        getHours() {
          return 15;
        }
      } as any;

      const greeting = manager.getGreeting();
      assert.strictEqual(greeting, "Добрый день, Алексей! 👋");

      global.Date = originalDate;
    });

    it("should return evening greeting (18:00 - 22:59)", async () => {
      await setupProfile();

      const originalDate = global.Date;
      global.Date = class extends originalDate {
        getHours() {
          return 20;
        }
      } as any;

      const greeting = manager.getGreeting();
      assert.strictEqual(greeting, "Добрый вечер, Алексей! 👋");

      global.Date = originalDate;
    });

    it("should return night greeting (23:00 - 4:59)", async () => {
      await setupProfile();

      const originalDate = global.Date;
      global.Date = class extends originalDate {
        getHours() {
          return 2;
        }
      } as any;

      const greeting = manager.getGreeting();
      assert.strictEqual(greeting, "Доброй ночи, Алексей! 👋");

      global.Date = originalDate;
    });

    it("should return greeting without emoji when useEmoji is false", async () => {
      const profileWithoutEmoji = {
        name: "Мария",
        role: "Developer",
        experience: "3 года опыта",
        timezone: "Europe/Moscow",
        preferences: {
          answerStyle: "краткий",
          includeRecommendations: true,
          technicalLevel: "продвинутый",
          useEmoji: false,
        },
        responsibilities: {
          services: [],
          criticalErrors: [],
        },
        workingHours: {
          start: "09:00",
          end: "18:00",
        },
      };

      await writeFile(testProfilePath, JSON.stringify(profileWithoutEmoji));
      const newManager = new PersonalizationManager();
      await newManager.loadProfile(testProfilePath);

      const originalDate = global.Date;
      global.Date = class extends originalDate {
        getHours() {
          return 10;
        }
      } as any;

      const greeting = newManager.getGreeting();
      assert.strictEqual(greeting, "Доброе утро, Мария!");

      global.Date = originalDate;
    });

    it("should throw error when profile is not loaded", () => {
      const newManager = new PersonalizationManager();
      assert.throws(
        () => newManager.getGreeting(),
        {
          message: "Profile not loaded. Call loadProfile() first.",
        }
      );
    });
  });

  describe("getUserContext", () => {
    it("should return formatted user context with services and errors", async () => {
      const validProfile = {
        name: "Дмитрий Петров",
        role: "Senior DevOps",
        experience: "7 лет опыта",
        timezone: "Europe/Moscow",
        preferences: {
          answerStyle: "краткий",
          includeRecommendations: true,
          technicalLevel: "продвинутый",
          useEmoji: true,
        },
        responsibilities: {
          services: ["api-gateway", "auth-service", "payment-service"],
          criticalErrors: ["OutOfMemoryError", "DatabaseConnectionFailed"],
        },
        workingHours: {
          start: "09:00",
          end: "18:00",
        },
      };

      await writeFile(testProfilePath, JSON.stringify(validProfile));
      await manager.loadProfile(testProfilePath);

      const context = manager.getUserContext();
      const expectedContext = `Пользователь: Дмитрий Петров, Senior DevOps (7 лет опыта)
Ответственность: api-gateway, auth-service, payment-service
Критичные ошибки: OutOfMemoryError, DatabaseConnectionFailed`;

      assert.strictEqual(context, expectedContext);
    });

    it("should return context with 'не указано' when services are empty", async () => {
      const profileWithoutServices = {
        name: "Анна Смирнова",
        role: "Junior DevOps",
        experience: "1 год опыта",
        timezone: "Europe/Moscow",
        preferences: {
          answerStyle: "краткий",
          includeRecommendations: true,
          technicalLevel: "начальный",
          useEmoji: false,
        },
        responsibilities: {
          services: [],
          criticalErrors: [],
        },
        workingHours: {
          start: "09:00",
          end: "18:00",
        },
      };

      await writeFile(testProfilePath, JSON.stringify(profileWithoutServices));
      await manager.loadProfile(testProfilePath);

      const context = manager.getUserContext();
      const expectedContext = `Пользователь: Анна Смирнова, Junior DevOps (1 год опыта)
Ответственность: не указано
Критичные ошибки: не указано`;

      assert.strictEqual(context, expectedContext);
    });

    it("should throw error when profile is not loaded", () => {
      const newManager = new PersonalizationManager();
      assert.throws(
        () => newManager.getUserContext(),
        {
          message: "Profile not loaded. Call loadProfile() first.",
        }
      );
    });
  });

  describe("isRelevantToUser", () => {
    async function setupProfile() {
      const validProfile = {
        name: "Сергей",
        role: "DevOps Engineer",
        experience: "5 лет опыта",
        timezone: "Europe/Moscow",
        preferences: {
          answerStyle: "краткий",
          includeRecommendations: true,
          technicalLevel: "продвинутый",
          useEmoji: true,
        },
        responsibilities: {
          services: ["api-gateway", "auth-service"],
          criticalErrors: ["OutOfMemoryError", "DatabaseConnectionFailed"],
        },
        workingHours: {
          start: "09:00",
          end: "18:00",
        },
      };

      await writeFile(testProfilePath, JSON.stringify(validProfile));
      await manager.loadProfile(testProfilePath);
    }

    it("should return true when service matches responsibility", async () => {
      await setupProfile();
      const isRelevant = manager.isRelevantToUser("api-gateway", "SomeError");
      assert.strictEqual(isRelevant, true);
    });

    it("should return true when error type matches critical error", async () => {
      await setupProfile();
      const isRelevant = manager.isRelevantToUser(
        "unknown-service",
        "OutOfMemoryError"
      );
      assert.strictEqual(isRelevant, true);
    });

    it("should return true when both service and error match", async () => {
      await setupProfile();
      const isRelevant = manager.isRelevantToUser(
        "api-gateway",
        "OutOfMemoryError"
      );
      assert.strictEqual(isRelevant, true);
    });

    it("should return false when neither service nor error match", async () => {
      await setupProfile();
      const isRelevant = manager.isRelevantToUser(
        "unknown-service",
        "UnknownError"
      );
      assert.strictEqual(isRelevant, false);
    });

    it("should be case-insensitive for service names", async () => {
      await setupProfile();
      const isRelevant = manager.isRelevantToUser("API-GATEWAY", "SomeError");
      assert.strictEqual(isRelevant, true);
    });

    it("should be case-insensitive for error types", async () => {
      await setupProfile();
      const isRelevant = manager.isRelevantToUser(
        "unknown-service",
        "outofmemoryerror"
      );
      assert.strictEqual(isRelevant, true);
    });

    it("should throw error when profile is not loaded", () => {
      const newManager = new PersonalizationManager();
      assert.throws(
        () => newManager.isRelevantToUser("api-gateway", "SomeError"),
        {
          message: "Profile not loaded. Call loadProfile() first.",
        }
      );
    });
  });

  describe("getProfile", () => {
    it("should return null when profile is not loaded", () => {
      const profile = manager.getProfile();
      assert.strictEqual(profile, null);
    });

    it("should return loaded profile", async () => {
      const validProfile = {
        name: "Ольга",
        role: "DevOps Engineer",
        experience: "4 года опыта",
        timezone: "Europe/Moscow",
        preferences: {
          answerStyle: "краткий",
          includeRecommendations: true,
          technicalLevel: "продвинутый",
          useEmoji: true,
        },
        responsibilities: {
          services: ["monitoring-service"],
          criticalErrors: ["AlertTimeout"],
        },
        workingHours: {
          start: "10:00",
          end: "19:00",
        },
      };

      await writeFile(testProfilePath, JSON.stringify(validProfile));
      await manager.loadProfile(testProfilePath);

      const profile = manager.getProfile();
      assert.notStrictEqual(profile, null);
      assert.strictEqual(profile?.name, "Ольга");
      assert.strictEqual(profile?.role, "DevOps Engineer");
    });
  });

  describe("validateProfile", () => {
    it("should throw error when profile is null", async () => {
      await writeFile(testProfilePath, JSON.stringify(null));

      await assert.rejects(
        async () => await manager.loadProfile(testProfilePath),
        {
          message: /Profile must be an object/,
        }
      );
    });

    it("should throw error when profile is not an object", async () => {
      await writeFile(testProfilePath, JSON.stringify(123));

      await assert.rejects(
        async () => await manager.loadProfile(testProfilePath),
        {
          message: /Profile must be an object/,
        }
      );
    });

    it("should throw error when required field is missing", async () => {
      const incompleteProfile = {
        name: "Test",
        role: "Developer",
        experience: "5 years",
      };

      await writeFile(testProfilePath, JSON.stringify(incompleteProfile));

      await assert.rejects(
        async () => await manager.loadProfile(testProfilePath),
        {
          message: /Missing required field:/,
        }
      );
    });

    it("should throw error when preferences is invalid", async () => {
      const invalidPreferences = {
        name: "Test",
        role: "Developer",
        experience: "5 years",
        timezone: "Europe/Moscow",
        preferences: "invalid",
        responsibilities: {
          services: [],
          criticalErrors: [],
        },
        workingHours: {
          start: "09:00",
          end: "18:00",
        },
      };

      await writeFile(testProfilePath, JSON.stringify(invalidPreferences));

      await assert.rejects(
        async () => await manager.loadProfile(testProfilePath),
        {
          message: /Invalid preferences structure/,
        }
      );
    });

    it("should throw error when responsibilities is invalid", async () => {
      const invalidResponsibilities = {
        name: "Test",
        role: "Developer",
        experience: "5 years",
        timezone: "Europe/Moscow",
        preferences: {
          answerStyle: "краткий",
          includeRecommendations: true,
          technicalLevel: "продвинутый",
          useEmoji: true,
        },
        responsibilities: "invalid",
        workingHours: {
          start: "09:00",
          end: "18:00",
        },
      };

      await writeFile(testProfilePath, JSON.stringify(invalidResponsibilities));

      await assert.rejects(
        async () => await manager.loadProfile(testProfilePath),
        {
          message: /Invalid responsibilities structure/,
        }
      );
    });

    it("should throw error when services is not an array", async () => {
      const invalidServices = {
        name: "Test",
        role: "Developer",
        experience: "5 years",
        timezone: "Europe/Moscow",
        preferences: {
          answerStyle: "краткий",
          includeRecommendations: true,
          technicalLevel: "продвинутый",
          useEmoji: true,
        },
        responsibilities: {
          services: "not an array",
          criticalErrors: [],
        },
        workingHours: {
          start: "09:00",
          end: "18:00",
        },
      };

      await writeFile(testProfilePath, JSON.stringify(invalidServices));

      await assert.rejects(
        async () => await manager.loadProfile(testProfilePath),
        {
          message: /responsibilities\.services must be an array/,
        }
      );
    });

    it("should throw error when criticalErrors is not an array", async () => {
      const invalidErrors = {
        name: "Test",
        role: "Developer",
        experience: "5 years",
        timezone: "Europe/Moscow",
        preferences: {
          answerStyle: "краткий",
          includeRecommendations: true,
          technicalLevel: "продвинутый",
          useEmoji: true,
        },
        responsibilities: {
          services: [],
          criticalErrors: "not an array",
        },
        workingHours: {
          start: "09:00",
          end: "18:00",
        },
      };

      await writeFile(testProfilePath, JSON.stringify(invalidErrors));

      await assert.rejects(
        async () => await manager.loadProfile(testProfilePath),
        {
          message: /responsibilities\.criticalErrors must be an array/,
        }
      );
    });
  });

  describe("isWorkingHours", () => {
    async function setupProfile() {
      const validProfile = {
        name: "Максим",
        role: "DevOps Engineer",
        experience: "6 лет опыта",
        timezone: "Europe/Moscow",
        preferences: {
          answerStyle: "краткий",
          includeRecommendations: true,
          technicalLevel: "продвинутый",
          useEmoji: true,
        },
        responsibilities: {
          services: ["api-gateway"],
          criticalErrors: ["OutOfMemoryError"],
        },
        workingHours: {
          start: "09:00",
          end: "18:00",
        },
      };

      await writeFile(testProfilePath, JSON.stringify(validProfile));
      await manager.loadProfile(testProfilePath);
    }

    it("should return true when current time is within working hours", async () => {
      await setupProfile();

      const originalDate = global.Date;
      global.Date = class extends originalDate {
        getHours() {
          return 14;
        }
        getMinutes() {
          return 30;
        }
      } as any;

      const isWorking = manager.isWorkingHours();
      assert.strictEqual(isWorking, true);

      global.Date = originalDate;
    });

    it("should return true when current time equals start time", async () => {
      await setupProfile();

      const originalDate = global.Date;
      global.Date = class extends originalDate {
        getHours() {
          return 9;
        }
        getMinutes() {
          return 0;
        }
      } as any;

      const isWorking = manager.isWorkingHours();
      assert.strictEqual(isWorking, true);

      global.Date = originalDate;
    });

    it("should return true when current time equals end time", async () => {
      await setupProfile();

      const originalDate = global.Date;
      global.Date = class extends originalDate {
        getHours() {
          return 18;
        }
        getMinutes() {
          return 0;
        }
      } as any;

      const isWorking = manager.isWorkingHours();
      assert.strictEqual(isWorking, true);

      global.Date = originalDate;
    });

    it("should return false when current time is before working hours", async () => {
      await setupProfile();

      const originalDate = global.Date;
      global.Date = class extends originalDate {
        getHours() {
          return 7;
        }
        getMinutes() {
          return 30;
        }
      } as any;

      const isWorking = manager.isWorkingHours();
      assert.strictEqual(isWorking, false);

      global.Date = originalDate;
    });

    it("should return false when current time is after working hours", async () => {
      await setupProfile();

      const originalDate = global.Date;
      global.Date = class extends originalDate {
        getHours() {
          return 20;
        }
        getMinutes() {
          return 15;
        }
      } as any;

      const isWorking = manager.isWorkingHours();
      assert.strictEqual(isWorking, false);

      global.Date = originalDate;
    });

    it("should throw error when profile is not loaded", () => {
      const newManager = new PersonalizationManager();
      assert.throws(
        () => newManager.isWorkingHours(),
        {
          message: "Profile not loaded. Call loadProfile() first.",
        }
      );
    });
  });
});

/**
 * Tests for WelcomeService
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import { WelcomeService } from "../welcome";
import * as fs from "fs/promises";
import * as os from "os";
import * as path from "path";

describe("WelcomeService", () => {
  let testWovlyDir: string;
  let testUsername: string;

  const mockDeps = {
    getUserProfilePath: vi.fn((username: string) =>
      path.join(testWovlyDir, "users", username, "profile.md")
    ),
    parseUserProfile: vi.fn((text: string) => {
      const lines = text.split("\n");
      const profile: any = {};
      lines.forEach((line) => {
        if (line.startsWith("name:")) profile.name = line.replace("name:", "").trim();
        if (line.startsWith("role:")) profile.role = line.replace("role:", "").trim();
        if (line.startsWith("onboardingStage:"))
          profile.onboardingStage = line.replace("onboardingStage:", "").trim();
      });
      return profile;
    }),
    getGoogleAccessToken: vi.fn(async () => null),
    getSettingsPath: vi.fn(async (username: string) =>
      path.join(testWovlyDir, "users", username, "settings.json")
    )
  };

  beforeEach(async () => {
    testWovlyDir = path.join(os.tmpdir(), `wovly-test-${Date.now()}`);
    testUsername = "testuser";

    // Create test directories
    await fs.mkdir(path.join(testWovlyDir, "users", testUsername), { recursive: true });

    // Reset mocks
    vi.clearAllMocks();
    mockDeps.getGoogleAccessToken.mockResolvedValue(null);
  });

  describe("generate", () => {
    it("should return error when not logged in", async () => {
      const result = await WelcomeService.generate(undefined, {}, {}, "anthropic", mockDeps);

      expect(result.ok).toBe(false);
      expect(result.error).toBe("Not logged in");
    });

    it("should show API setup message when no API keys configured", async () => {
      // Create empty settings
      const settingsPath = await mockDeps.getSettingsPath(testUsername);
      await fs.writeFile(settingsPath, JSON.stringify({ apiKeys: {} }), "utf8");

      const result = await WelcomeService.generate(testUsername, {}, {}, "anthropic", mockDeps);

      expect(result.ok).toBe(true);
      expect(result.message).toContain("add an API key");
      expect(result.needsOnboarding).toBe(true);
    });

    it("should show profile stage message when onboarding stage is profile", async () => {
      // Create profile
      const profilePath = mockDeps.getUserProfilePath(testUsername);
      await fs.writeFile(profilePath, "name: Test", "utf8");

      // Create settings with API key and onboarding stage
      const settingsPath = await mockDeps.getSettingsPath(testUsername);
      await fs.writeFile(
        settingsPath,
        JSON.stringify({ apiKeys: { anthropic: "test-key" }, onboardingStage: "profile" }),
        "utf8"
      );

      const result = await WelcomeService.generate(
        testUsername,
        { anthropic: "test-key" },
        {},
        "anthropic",
        mockDeps
      );

      expect(result.ok).toBe(true);
      expect(result.needsOnboarding).toBe(true);
      expect(result.message).toContain("What should I call you");
    });

    it("should show task demo message when onboarding stage is task_demo", async () => {
      // Create profile
      const profilePath = mockDeps.getUserProfilePath(testUsername);
      await fs.writeFile(profilePath, "name: Test", "utf8");

      const settingsPath = await mockDeps.getSettingsPath(testUsername);
      await fs.writeFile(
        settingsPath,
        JSON.stringify({ apiKeys: { anthropic: "test-key" }, onboardingStage: "task_demo" }),
        "utf8"
      );

      const result = await WelcomeService.generate(
        testUsername,
        { anthropic: "test-key" },
        {},
        "anthropic",
        mockDeps
      );

      expect(result.ok).toBe(true);
      expect(result.needsOnboarding).toBe(true);
      expect(result.message).toContain("first task");
    });

    it("should show skill demo message when onboarding stage is skill_demo", async () => {
      const profilePath = mockDeps.getUserProfilePath(testUsername);
      await fs.writeFile(profilePath, "name: Test", "utf8");

      const settingsPath = await mockDeps.getSettingsPath(testUsername);
      await fs.writeFile(
        settingsPath,
        JSON.stringify({ apiKeys: { anthropic: "test-key" }, onboardingStage: "skill_demo" }),
        "utf8"
      );

      const result = await WelcomeService.generate(
        testUsername,
        { anthropic: "test-key" },
        {},
        "anthropic",
        mockDeps
      );

      expect(result.ok).toBe(true);
      expect(result.needsOnboarding).toBe(true);
      expect(result.message).toContain("skill");
      expect(result.message).toContain("marco");
    });

    it("should show integrations message when onboarding stage is integrations", async () => {
      const profilePath = mockDeps.getUserProfilePath(testUsername);
      await fs.writeFile(profilePath, "name: Test", "utf8");

      const settingsPath = await mockDeps.getSettingsPath(testUsername);
      await fs.writeFile(
        settingsPath,
        JSON.stringify({ apiKeys: { anthropic: "test-key" }, onboardingStage: "integrations" }),
        "utf8"
      );

      const result = await WelcomeService.generate(
        testUsername,
        { anthropic: "test-key" },
        {},
        "anthropic",
        mockDeps
      );

      expect(result.ok).toBe(true);
      expect(result.needsOnboarding).toBe(true);
      expect(result.message).toContain("integrations");
      expect(result.message).toContain("Google");
    });

    it("should generate personalized welcome for completed onboarding", async () => {
      const profilePath = mockDeps.getUserProfilePath(testUsername);
      await fs.writeFile(profilePath, "name: Test User\nonboardingStage: completed", "utf8");

      const settingsPath = await mockDeps.getSettingsPath(testUsername);
      await fs.writeFile(
        settingsPath,
        JSON.stringify({ apiKeys: { anthropic: "test-key" } }),
        "utf8"
      );

      // Mock successful LLM response
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          content: [{ text: "Good morning, Test! Ready to help you today." }]
        })
      }) as any;

      const result = await WelcomeService.generate(
        testUsername,
        { anthropic: "test-key" },
        { anthropic: "claude-3-5-sonnet-20241022" },
        "anthropic",
        mockDeps
      );

      expect(result.ok).toBe(true);
      expect(result.needsOnboarding).toBe(false);
      expect(result.message).toBeTruthy();
      expect(result.timeOfDay).toBeDefined();
      expect(result.hour).toBeDefined();
      expect(result.dayOfWeek).toBeDefined();
    });

    it("should use fallback message when LLM call fails", async () => {
      const profilePath = mockDeps.getUserProfilePath(testUsername);
      await fs.writeFile(profilePath, "name: Test\nonboardingStage: completed", "utf8");

      const settingsPath = await mockDeps.getSettingsPath(testUsername);
      await fs.writeFile(
        settingsPath,
        JSON.stringify({ apiKeys: { anthropic: "test-key" } }),
        "utf8"
      );

      // Mock failed LLM response
      global.fetch = vi.fn().mockResolvedValue({
        ok: false
      }) as any;

      const result = await WelcomeService.generate(
        testUsername,
        { anthropic: "test-key" },
        {},
        "anthropic",
        mockDeps
      );

      expect(result.ok).toBe(true);
      expect(result.message).toContain("Ready to help");
    });

    it("should fetch calendar events when Google is connected", async () => {
      const profilePath = mockDeps.getUserProfilePath(testUsername);
      await fs.writeFile(profilePath, "name: Test\nonboardingStage: completed", "utf8");

      const settingsPath = await mockDeps.getSettingsPath(testUsername);
      await fs.writeFile(
        settingsPath,
        JSON.stringify({ apiKeys: { anthropic: "test-key" } }),
        "utf8"
      );

      // Mock Google access token
      mockDeps.getGoogleAccessToken.mockResolvedValue("google-token");

      // Mock calendar API response
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          items: [
            {
              summary: "Team Meeting",
              start: { dateTime: new Date().toISOString() }
            }
          ]
        })
      }) as any;

      const result = await WelcomeService.generate(
        testUsername,
        { anthropic: "test-key" },
        {},
        "anthropic",
        mockDeps
      );

      expect(result.ok).toBe(true);
      expect(mockDeps.getGoogleAccessToken).toHaveBeenCalledWith(testUsername);
    });

    it("should handle missing profile gracefully", async () => {
      // No profile file created
      const settingsPath = await mockDeps.getSettingsPath(testUsername);
      await fs.writeFile(
        settingsPath,
        JSON.stringify({ apiKeys: { anthropic: "test-key" } }),
        "utf8"
      );

      // Mock LLM response
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          content: [{ text: "Good day!" }]
        })
      }) as any;

      const result = await WelcomeService.generate(
        testUsername,
        { anthropic: "test-key" },
        {},
        "anthropic",
        mockDeps
      );

      expect(result.ok).toBe(true);
      // Should not crash when profile is missing
    });
  });
});

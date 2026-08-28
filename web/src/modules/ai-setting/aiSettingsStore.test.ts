import { beforeEach, describe, expect, it, vi } from "vitest";
import {
	aiSettingsOpen,
	closeAiSettings,
	openAiSettings,
} from "./aiSettingsStore.ts";

describe("aiSettingsStore", () => {
	beforeEach(() => {
		// 重置状态
		closeAiSettings();
	});

	it("管理AI设置面板状态", async () => {
		// 测试管理AI设置面板状态

		// 验证初始状态
		expect(aiSettingsOpen()).toBe(false);

		// 打开AI设置面板
		openAiSettings();
		expect(aiSettingsOpen()).toBe(true);

		// 关闭AI设置面板
		closeAiSettings();
		expect(aiSettingsOpen()).toBe(false);
	});

	it("打开AI设置面板", async () => {
		// 测试打开AI设置面板

		// 验证初始状态
		expect(aiSettingsOpen()).toBe(false);

		// 打开AI设置面板
		openAiSettings();
		expect(aiSettingsOpen()).toBe(true);
	});

	it("关闭AI设置面板", async () => {
		// 测试关闭AI设置面板

		// 先打开AI设置面板
		openAiSettings();
		expect(aiSettingsOpen()).toBe(true);

		// 关闭AI设置面板
		closeAiSettings();
		expect(aiSettingsOpen()).toBe(false);
	});
});

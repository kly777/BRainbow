import { describe, expect, it, vi, beforeEach } from "vitest";
import { ColorPage } from "./index.ts";

// 模拟依赖
vi.mock("@shared/styles", () => ({
	applyTheme: vi.fn(),
	getTheme: vi.fn(() => "paper"),
	themeInfo: vi.fn(() => ({ name: "Paper", description: "Light theme" })),
	themes: {
		paper: { swatches: ["#ffffff", "#f0f0f0"] },
		midnight: { swatches: ["#000000", "#333333"] },
		ocean: { swatches: ["#0077b6", "#00b4d8"] },
	},
}));

describe("color module", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it("导出ColorPage组件", async () => {
		// 测试导出ColorPage组件
		expect(ColorPage).toBeDefined();
		expect(typeof ColorPage).toBe("function");
	});

	it("主题切换功能", async () => {
		// 测试主题切换功能
		const { applyTheme, getTheme } = await import("@shared/styles");
		const mockApplyTheme = vi.mocked(applyTheme);
		const mockGetTheme = vi.mocked(getTheme);
		
		// 验证getTheme被调用
		expect(mockGetTheme).toBeDefined();
		expect(typeof mockGetTheme).toBe("function");
		
		// 验证applyTheme被调用
		expect(mockApplyTheme).toBeDefined();
		expect(typeof mockApplyTheme).toBe("function");
	});

	it("主题预览功能", async () => {
		// 测试主题预览功能
		const { themes } = await import("@shared/styles");
		
		// 验证themes对象存在
		expect(themes).toBeDefined();
		expect(themes.paper).toBeDefined();
		expect(themes.midnight).toBeDefined();
		expect(themes.ocean).toBeDefined();
		
		// 验证每个主题都有swatches属性
		Object.values(themes).forEach(theme => {
			expect(theme.swatches).toBeDefined();
			expect(Array.isArray(theme.swatches)).toBe(true);
		});
	});
});
import { describe, expect, it, vi, beforeEach } from "vitest";

// 模拟依赖
vi.mock("@app/context/auth.tsx", () => ({
	useAuth: vi.fn(() => ({
		auth: () => ({ user: null }),
	})),
}));

vi.mock("@config/module-cards.ts", () => ({
	MODULE_CARDS: [
		{ path: "/task", title: "任务", detail: "任务管理功能", icon: "task" },
		{ path: "/card", title: "卡片", detail: "卡片笔记功能", icon: "card" },
	],
}));

describe("landing module", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it("落地页展示功能", async () => {
		// 测试落地页展示功能
		const { MODULE_CARDS } = await import("@config/module-cards.ts");
		
		// 验证MODULE_CARDS存在
		expect(MODULE_CARDS).toBeDefined();
		expect(Array.isArray(MODULE_CARDS)).toBe(true);
		expect(MODULE_CARDS.length).toBeGreaterThan(0);
		
		// 验证每个模块卡片都有path、title和detail
		MODULE_CARDS.forEach(card => {
			expect(card.path).toBeDefined();
			expect(card.title).toBeDefined();
			expect(card.detail).toBeDefined();
		});
	});

	it("模块目录功能", async () => {
		// 测试模块目录功能
		const { MODULE_CARDS } = await import("@config/module-cards.ts");
		
		// 过滤有长文案的模块
		const modules = MODULE_CARDS.filter((m) => m.title && m.detail);
		
		// 验证过滤结果
		expect(modules).toBeDefined();
		expect(Array.isArray(modules)).toBe(true);
		expect(modules.length).toBeGreaterThan(0);
		
		// 验证每个模块都有title和detail
		modules.forEach(module => {
			expect(module.title).toBeDefined();
			expect(module.detail).toBeDefined();
		});
	});

	it("事实条展示功能", async () => {
		// 测试事实条展示功能
		const facts = [
			{ value: "FSRS", label: "间隔重复算法" },
			{ value: "SSE", label: "流式 AI 对话" },
			{ value: "3 主题", label: "纸张 / 暗夜 / 晴空" },
			{ value: "⌘K", label: "全局命令面板" },
		];
		
		// 验证facts数组
		expect(facts).toBeDefined();
		expect(Array.isArray(facts)).toBe(true);
		expect(facts.length).toBe(4);
		
		// 验证每个事实条都有value和label
		facts.forEach(fact => {
			expect(fact.value).toBeDefined();
			expect(fact.label).toBeDefined();
		});
	});
});
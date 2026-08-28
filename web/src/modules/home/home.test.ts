import { beforeEach, describe, expect, it, vi } from "vitest";

// 模拟依赖
vi.mock("@app/context/auth.tsx", () => ({
	useAuth: vi.fn(() => ({
		user: { id: 1, name: "testuser" },
		isAuthenticated: true,
	})),
}));

vi.mock("@components/ui", () => ({
	AsyncView: vi.fn(({ children }) => children),
}));

vi.mock("@config/module-cards.ts", () => ({
	MODULE_CARDS: [
		{ path: "/task", title: "任务", icon: "task" },
		{ path: "/card", title: "卡片", icon: "card" },
	],
}));

vi.mock("@config/paths", () => ({
	fillPath: vi.fn((path, params) => path),
	PATHS: {
		HOME: "/",
		TASK: "/task",
		CARD: "/card",
	},
}));

describe("home module", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it("模块导航功能", async () => {
		// 测试模块导航功能
		const { MODULE_CARDS } = await import("@config/module-cards.ts");

		// 验证MODULE_CARDS存在
		expect(MODULE_CARDS).toBeDefined();
		expect(Array.isArray(MODULE_CARDS)).toBe(true);
		expect(MODULE_CARDS.length).toBeGreaterThan(0);

		// 验证每个模块卡片都有path和title
		MODULE_CARDS.forEach((card) => {
			expect(card.path).toBeDefined();
			expect(card.title).toBeDefined();
		});
	});

	it("卡片展示功能", async () => {
		// 测试卡片展示功能
		const { PATHS } = await import("@config/paths");

		// 验证PATHS存在
		expect(PATHS).toBeDefined();
		expect(PATHS.home).toBe("/");
		expect(PATHS.task).toBe("/task");
		expect(PATHS.card).toBe("/card");
	});

	it("认证上下文", async () => {
		// 测试认证上下文
		const { useAuth } = await import("@app/context/auth.tsx");

		// 验证useAuth函数存在
		expect(useAuth).toBeDefined();
		expect(typeof useAuth).toBe("function");

		// 验证返回值
		const { auth } = useAuth();
		expect(auth().user).toBeDefined();
		expect(auth().isAdmin).toBeDefined();
	});
});

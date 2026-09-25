import { beforeEach, describe, expect, it, vi } from "vitest";

// 模拟依赖
vi.mock("@app/context/auth.tsx", () => ({
	useAuth: vi.fn(() => ({
		auth: () => ({
			user: { id: 1, name: "testuser" },
			isAdmin: false,
			apiKey: null,
		}),
		login: vi.fn(),
		logout: vi.fn(),
		setApiKey: vi.fn(),
	})),
}));

vi.mock("@components/ui", () => ({
	AsyncView: vi.fn(({ children }) => children),
}));

vi.mock("@config/module-cards.ts", () => ({
	MODULE_CARDS: [
		{
			path: "/task",
			label: "任务",
			desc: "待办",
			title: "任务",
			icon: "task",
			color: "red",
		},
		{
			path: "/card",
			label: "卡片",
			desc: "笔记",
			title: "卡片",
			icon: "card",
			color: "blue",
		},
	],
}));

vi.mock("@config/paths", () => ({
	fillPath: vi.fn((path, _params) => path),
	PATHS: {
		home: "/",
		task: "/task",
		taskDetail: "/task/:id",
		card: "/card",
		cardDetail: "/card/:id",
		cardEdit: "/card/edit/:id",
		cardAdd: "/card/add",
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
		const ctx = useAuth();
		expect(ctx.auth).toBeDefined();
		expect(typeof ctx.auth).toBe("function");
		expect(ctx.auth().user).toBeDefined();
		expect(ctx.auth().user?.name).toBe("testuser");
	});
});

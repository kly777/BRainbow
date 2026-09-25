// ── AdminPage 渲染测试 ──
// 本页刚把五张卡片下钻到 components/（原 401 行单文件）。断言锁住迁移后的对外行为：
// 非管理员看到拒绝提示、管理员看到五张卡片、注册开关真的调接口、轮换要走确认框。

import { render } from "solid-js/web";
import { beforeEach, describe, expect, it, vi } from "vitest";
import AdminPage from "./AdminPage.tsx";
import {
	getAdminSettingsE,
	getSystemInfoE,
	updateAdminSettingsE,
} from "./api.ts";

let isAdmin = true;
vi.mock("@app/context/auth.tsx", () => ({
	useAuth: () => ({ auth: () => ({ isAdmin }) }),
}));

vi.mock("./api.ts", () => ({
	getAdminSettingsE: vi.fn(),
	getSystemInfoE: vi.fn(),
	rotateJwtE: vi.fn(),
	updateAdminSettingsE: vi.fn(),
}));

const showConfirm = vi.fn(async (_options: unknown) => true);
vi.mock("@shared/utils", async (importOriginal) => ({
	...(await importOriginal<typeof import("@shared/utils")>()),
	showConfirm: (options: unknown) => showConfirm(options),
	notifySuccess: vi.fn(),
	notifyError: vi.fn(),
}));

const settings = {
	allow_register: false,
	jwt_secret_set: true,
	jwt_secret_len: 64,
};

const systemInfo = {
	version: "0.1.0",
	uptime_secs: 3661,
	db_version: 19,
	db_size_bytes: 1024,
	db_page_count: 10,
	db_page_size: 4096,
	stats: {
		users: 1,
		tasks: 2,
		cards: 3,
		memories: 4,
		ontos: 5,
		texts: 6,
		files: 7,
		reading: 8,
		bookmarks: 9,
	},
	server: {
		memory: { used_bytes: 100, total_bytes: 200 },
		cpu_count: 4,
		load: { one: 0.5, five: 0.4, fifteen: 0.3 },
		disk: { used_bytes: 10, total_bytes: 100, free_bytes: 90 },
		backups: null,
		uploads: null,
		thumbs: null,
		favicons: null,
		backup_dir: null,
	},
};

const settle = async (check: () => boolean) => {
	for (let i = 0; i < 50 && !check(); i++) {
		await new Promise((r) => setTimeout(r, 0));
	}
};

function mount() {
	document.body.innerHTML = "";
	const host = document.createElement("div");
	document.body.appendChild(host);
	render(() => <AdminPage />, host);
	return host;
}

beforeEach(() => {
	vi.clearAllMocks();
	isAdmin = true;
	vi.mocked(getAdminSettingsE).mockResolvedValue(settings as never);
	vi.mocked(getSystemInfoE).mockResolvedValue(systemInfo as never);
});

describe("AdminPage", () => {
	it("非管理员只看到拒绝提示，不渲染设置卡片", async () => {
		isAdmin = false;
		const host = mount();
		await settle(() => (host.textContent ?? "").includes("仅管理员"));
		expect(host.textContent).toContain("仅管理员可访问此页面。");
		expect(host.textContent).not.toContain("开放注册");
	});

	it("管理员看到五张卡片的内容", async () => {
		const host = mount();
		await settle(() => (host.textContent ?? "").includes("JWT 密钥"));

		const text = host.textContent ?? "";
		expect(text).toContain("服务信息");
		expect(text).toContain("数据统计");
		expect(text).toContain("服务器");
		expect(text).toContain("开放注册");
		expect(text).toContain("JWT 密钥");
		// 统计卡的数值来自 getStatValue（9 个模块计数）
		expect(text).toContain("用户");
		expect(text).toContain("书签");
	});

	it("注册开关调接口并把返回值写回（服务端为准）", async () => {
		vi.mocked(updateAdminSettingsE).mockResolvedValue({
			...settings,
			allow_register: true,
		} as never);
		const host = mount();
		await settle(() => (host.textContent ?? "").includes("开放注册"));

		const toggle = host.querySelector('[role="switch"]') as HTMLButtonElement;
		expect(toggle.getAttribute("aria-checked")).toBe("false");
		toggle.click();
		await settle(() => vi.mocked(updateAdminSettingsE).mock.calls.length > 0);

		expect(vi.mocked(updateAdminSettingsE)).toHaveBeenCalledWith(true);
		await settle(
			() =>
				host.querySelector('[role="switch"]')?.getAttribute("aria-checked") ===
				"true",
		);
		expect(
			host.querySelector('[role="switch"]')?.getAttribute("aria-checked"),
		).toBe("true");
	});

	it("轮换密钥先走确认框；取消就不发请求", async () => {
		showConfirm.mockResolvedValueOnce(false);
		const host = mount();
		await settle(() => (host.textContent ?? "").includes("轮换密钥"));

		const btn = [...host.querySelectorAll("button")].find((b) =>
			(b.textContent ?? "").includes("轮换密钥"),
		) as HTMLButtonElement;
		btn.click();
		await settle(() => showConfirm.mock.calls.length > 0);

		expect(showConfirm).toHaveBeenCalled();
		const { rotateJwtE } = await import("./api.ts");
		expect(vi.mocked(rotateJwtE)).not.toHaveBeenCalled();
	});
});

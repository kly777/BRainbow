// ── KeyPage 列表数据流契约 ──
// 背景（doc/component-design.md 体检表）：本页此前是 createResource + localKeys 双轨，
// 靠一个"读 accessor 时写信号"的 getter（displayKeys）把远端灌进本地——
// 终止条件藏在"本地非空"这个数据形状里。现在乐观更新改 resource 自己的 mutate。
// 这里钉住四条：渲染远端、删除成功后本地移除且不 refetch、删除失败回滚、生成后插到表头。

import { render } from "solid-js/web";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { type ApiKeyInfo, createKeyE, deleteKeyE, listKeysE } from "./api.ts";
import KeyPage from "./KeyPage.tsx";

vi.mock("./api.ts", () => ({
	createKeyE: vi.fn(),
	deleteKeyE: vi.fn(),
	listKeysE: vi.fn(),
}));

vi.mock("@app/context/auth.tsx", () => ({
	useAuth: () => ({ setApiKey: vi.fn() }),
}));

vi.mock("@shared/api", async (importOriginal) => ({
	...(await importOriginal<typeof import("@shared/api")>()),
	getApiKey: () => null,
}));

// 确认框默认同意；通知静音（真实实现会弹 toast 并留定时器）
vi.mock("@shared/utils", async (importOriginal) => ({
	...(await importOriginal<typeof import("@shared/utils")>()),
	showConfirm: vi.fn(async () => true),
	copyText: vi.fn(async () => true),
	notifyError: vi.fn(),
	notifySuccess: vi.fn(),
}));

const mockedList = vi.mocked(listKeysE);
const mockedCreate = vi.mocked(createKeyE);
const mockedDelete = vi.mocked(deleteKeyE);

const key = (id: number): ApiKeyInfo => ({
	id,
	role: "user",
	created_at: "2026-09-01T00:00:00+00:00",
});

const settle = async (check: () => boolean) => {
	for (let i = 0; i < 50 && !check(); i++) {
		await new Promise((r) => setTimeout(r, 0));
	}
};

function mount() {
	document.body.innerHTML = "";
	const host = document.createElement("div");
	document.body.appendChild(host);
	render(() => <KeyPage />, host);
	return host;
}

/** 行内的"删除"按钮（按行序） */
const deleteButtons = () =>
	[...document.querySelectorAll("button")].filter(
		(b) => b.textContent === "删除",
	) as HTMLButtonElement[];

beforeEach(() => {
	vi.clearAllMocks();
	mockedList.mockResolvedValue([key(1), key(2)]);
});

describe("KeyPage", () => {
	it("渲染服务端 key 列表", async () => {
		const host = mount();
		await settle(() => (host.textContent ?? "").includes("ID 2"));
		expect(host.textContent).toContain("ID 1");
		expect(host.textContent).toContain("ID 2");
	});

	it("删除成功后本地立即移除，且不 refetch（列表不闪骨架）", async () => {
		mockedDelete.mockResolvedValue(undefined);
		const host = mount();
		await settle(() => (host.textContent ?? "").includes("ID 1"));

		deleteButtons()[0].click();
		await settle(() => !(host.textContent ?? "").includes("ID 1"));

		expect(host.textContent).not.toContain("ID 1");
		expect(host.textContent).toContain("ID 2");
		expect(mockedList).toHaveBeenCalledTimes(1);
	});

	it("删除失败回滚：那一行回到列表里", async () => {
		mockedDelete.mockRejectedValue(new Error("后端不可用"));
		const { notifyError } = await import("@shared/utils");
		const host = mount();
		await settle(() => (host.textContent ?? "").includes("ID 1"));

		deleteButtons()[0].click();
		// 等"失败已处理"这个确定性信号（回滚在 notifyError 之前），
		// 否则可能在乐观移除与回滚之间就断言了
		await settle(() => vi.mocked(notifyError).mock.calls.length > 0);

		expect(host.textContent).toContain("ID 1");
		expect(host.textContent).toContain("ID 2");
	});

	it("生成成功后新 key 插到表头，并显示仅此一次的明文", async () => {
		mockedCreate.mockResolvedValue({ ...key(9), key: "brb_new_key" });
		const host = mount();
		await settle(() => (host.textContent ?? "").includes("ID 1"));

		const gen = [...document.querySelectorAll("button")].find((b) =>
			(b.textContent ?? "").includes("生成"),
		) as HTMLButtonElement;
		gen.click();
		await settle(() => (host.textContent ?? "").includes("ID 9"));

		const text = host.textContent ?? "";
		expect(text).toContain("brb_new_key");
		// 插在表头：ID 9 出现在 ID 1 之前
		expect(text.indexOf("ID 9")).toBeLessThan(text.indexOf("ID 1"));
	});
});

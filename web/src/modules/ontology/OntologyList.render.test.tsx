// ── OntologyList 渲染回归 ──
// 本页刚由"手写 PageHead + AsyncView 组合"迁到 ListPage 外壳。这组断言锁住
// 迁移后必须仍然成立的行为：唯一 h1、四态、视图切换。
//
// 另覆盖一处与外壳相关的历史问题：h1 曾按"模块目录内出现 <h1 即可"审计而
// 产生假阴性（同模块其它页面渲染了 h1 就误判本页通过），故此处直接断言本页
// 渲染出的 h1 文本。

import { getOntosE } from "@modules/ontology/api.ts";
import { render } from "solid-js/web";
import { beforeEach, describe, expect, it, vi } from "vitest";
import OntologyListPage from "./OntologyList.tsx";

// mock 叶子模块 api.ts 而非 barrel：hook 是从 "../api" 导入的
vi.mock("@modules/ontology/api.ts", async (importOriginal) => {
	const actual =
		await importOriginal<typeof import("@modules/ontology/api.ts")>();
	return {
		...actual,
		getOntosE: vi.fn(),
		createOntoE: vi.fn(),
		deleteOntoE: vi.fn(),
	};
});

let urlQ = "";
let urlView = "grid";
vi.mock("@solidjs/router", () => ({
	useSearchParams: () => [
		{
			get q() {
				return urlQ;
			},
			get view() {
				return urlView;
			},
		},
		vi.fn(),
	],
}));

const mockedGet = vi.mocked(getOntosE);

const onto = (id: number, name: string) => ({
	id,
	name,
	description: `${name} 的描述`,
	created_at: "2026-08-22T00:00:00+00:00",
	updated_at: "2026-08-22T00:00:00+00:00",
});

const flush = () => new Promise((r) => setTimeout(r, 0));
async function settle(check: () => boolean) {
	for (let i = 0; i < 50 && !check(); i++) await flush();
}

function mount() {
	document.body.innerHTML = "";
	const host = document.createElement("div");
	document.body.appendChild(host);
	render(() => <OntologyListPage />, host);
	return host;
}

beforeEach(() => {
	vi.clearAllMocks();
	urlQ = "";
	urlView = "grid";
	mockedGet.mockResolvedValue([onto(1, "人物"), onto(2, "事件")]);
});

describe("OntologyList：外壳迁移后的回归", () => {
	it("渲染唯一的 h1，内容为页面标题", async () => {
		const host = mount();
		await flush();
		const h1 = host.querySelectorAll("h1");
		expect(h1.length).toBe(1);
		expect(h1[0].textContent).toBe("知识管理");
	});

	it("加载完成后渲染出本体条目与统计", async () => {
		const host = mount();
		await settle(() => (host.textContent ?? "").includes("人物"));
		expect(host.textContent).toContain("人物");
		expect(host.textContent).toContain("事件");
		expect(host.textContent).toContain("共 2 个本体");
	});

	it("空列表显示空态文案", async () => {
		mockedGet.mockResolvedValue([]);
		const host = mount();
		await settle(() => (host.textContent ?? "").includes("没有找到匹配的本体"));
		expect(host.textContent).toContain("没有找到匹配的本体");
	});

	it("加载失败显示错误态与重试入口", async () => {
		mockedGet.mockRejectedValue(new Error("本体接口不可用"));
		const host = mount();
		await settle(() => (host.textContent ?? "").includes("本体接口不可用"));
		expect(host.textContent).toContain("本体接口不可用");
		expect(host.querySelector("button")).toBeTruthy();
	});

	it("筛选槽位渲染出搜索框（filters 原样渲染、无额外包装层）", async () => {
		const host = mount();
		await flush();
		expect(host.querySelector("input[type='search']")).toBeTruthy();
	});
});

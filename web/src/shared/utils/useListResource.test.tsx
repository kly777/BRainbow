// ── useListResource 契约测试 ──
// 最要紧的一条：`loading` / `error` 必须是 getter。若写成
// `{ loading: res.loading }`，取值发生在建对象那一刻并被冻结，调用方
// 永远看到初始的 true —— 项目里"上传成功但列表为空"正是这个成因，
// 所以这组断言就是防它回潮。
// 其次是乐观更新的两条路径：成功保留、失败回滚到操作前快照。

import { useListResource } from "@shared/utils/useListResource.ts";
import { createSignal, ErrorBoundary } from "solid-js";
import { render } from "solid-js/web";
import { describe, expect, it, vi } from "vitest";

interface Row {
	id: number;
	name: string;
}

/** 等待 createResource 的微任务链走完 */
const flush = () => new Promise((r) => setTimeout(r, 0));

function setup(
	fetcher: (
		key: string,
		page: number,
	) => Promise<{
		items: Row[];
		page: number;
		total: number;
		total_pages: number;
	}>,
	opts: { onLoaded?: (r: unknown) => void } = {},
) {
	const [key, setKey] = createSignal("a");
	const [page, setPage] = createSignal(1);
	let api!: ReturnType<typeof useListResource<string, Row>>;
	// 拉取失败时 fetcher 会 throw（与 useFileList 等既有用法一致，错误态交给
	// AsyncView 呈现）。测试里用 ErrorBoundary 承接，否则 Solid 会报未捕获错误。
	const host = document.createElement("div");
	document.body.appendChild(host);
	render(
		() => (
			<ErrorBoundary fallback={() => null}>
				{(() => {
					api = useListResource<string, Row>({
						key,
						page,
						fetcher,
						onLoaded: opts.onLoaded,
					});
					return null;
				})()}
			</ErrorBoundary>
		),
		host,
	);
	return { api, setKey, setPage };
}

describe("useListResource：数据与分页", () => {
	it("items / total / totalPages 来自分页响应", async () => {
		const { api } = setup(async () => ({
			items: [{ id: 1, name: "甲" }],
			page: 2,
			total: 42,
			total_pages: 5,
		}));
		await flush();
		expect(api.items()).toEqual([{ id: 1, name: "甲" }]);
		expect(api.total()).toBe(42);
		expect(api.totalPages()).toBe(5);
	});

	it("fetcher 收到当前 key 与页码", async () => {
		const fetcher = vi.fn(async () => ({
			items: [],
			page: 1,
			total: 0,
			total_pages: 0,
		}));
		const { setPage } = setup(fetcher);
		await flush();
		setPage(3);
		await flush();
		expect(fetcher).toHaveBeenCalledWith("a", 3);
	});

	it("key 变化触发重新拉取", async () => {
		const fetcher = vi.fn(async () => ({
			items: [],
			page: 1,
			total: 0,
			total_pages: 0,
		}));
		const { setKey } = setup(fetcher);
		await flush();
		const before = fetcher.mock.calls.length;
		setKey("b");
		await flush();
		expect(fetcher.mock.calls.length).toBeGreaterThan(before);
		expect(fetcher).toHaveBeenLastCalledWith("b", 1);
	});

	it("onLoaded 在成功加载后回调", async () => {
		const onLoaded = vi.fn();
		setup(async () => ({ items: [], page: 1, total: 7, total_pages: 1 }), {
			onLoaded,
		});
		await flush();
		expect(onLoaded).toHaveBeenCalledTimes(1);
		expect((onLoaded.mock.calls[0][0] as { total: number }).total).toBe(7);
	});
});

describe("useListResource：loading / error 必须是 getter", () => {
	it("loading 从 true 变为 false（若被冻结则恒为 true）", async () => {
		const { api } = setup(async () => ({
			items: [{ id: 1, name: "甲" }],
			page: 1,
			total: 1,
			total_pages: 1,
		}));
		expect(api.loading).toBe(true); // 拉取中
		await flush();
		expect(api.loading).toBe(false); // 完成后必须能看到变化
	});

	it("error 在请求失败后可见，且 items 为空数组而非 undefined", async () => {
		const { api } = setup(async () => {
			throw new Error("炸了");
		});
		await flush();
		expect(api.error).toBeInstanceOf(Error);
		expect(api.items()).toEqual([]);
		expect(api.total()).toBe(0);
	});

	it("失败时 onError 收到可读信息", async () => {
		const onError = vi.fn();
		const host = document.createElement("div");
		document.body.appendChild(host);
		render(
			() => (
				<ErrorBoundary fallback={() => null}>
					{(() => {
						useListResource<string, Row>({
							key: () => "a",
							page: () => 1,
							fetcher: async () => {
								throw new Error("网络断了");
							},
							onError,
						});
						return null;
					})()}
				</ErrorBoundary>
			),
			host,
		);
		await flush();
		expect(onError).toHaveBeenCalled();
		expect(String(onError.mock.calls[0][0])).toContain("网络断了");
	});
});

describe("useListResource：乐观更新", () => {
	const fetchTwo = async () => ({
		items: [
			{ id: 1, name: "甲" },
			{ id: 2, name: "乙" },
		],
		page: 1,
		total: 2,
		total_pages: 1,
	});

	it("成功时保留本地改动，且不重新拉取", async () => {
		const fetcher = vi.fn(fetchTwo);
		const { api } = setup(fetcher);
		await flush();
		const callsBefore = fetcher.mock.calls.length;

		const res = await api.optimistic(
			(list) => list.filter((r) => r.id !== 1),
			async () => undefined,
		);

		expect(res.ok).toBe(true);
		expect(api.items().map((r) => r.id)).toEqual([2]);
		expect(fetcher.mock.calls.length).toBe(callsBefore); // 未 refetch
	});

	it("失败时回滚到操作前快照", async () => {
		const { api } = setup(fetchTwo);
		await flush();

		const res = await api.optimistic(
			(list) => list.filter((r) => r.id !== 1),
			async () => {
				throw new Error("服务端拒绝");
			},
		);

		expect(res.ok).toBe(false);
		expect(api.items().map((r) => r.id)).toEqual([1, 2]); // 已还原
	});

	it("patch 直接替换列表内容", async () => {
		const { api } = setup(fetchTwo);
		await flush();
		api.patch((list) => [...list, { id: 3, name: "丙" }]);
		expect(api.items().map((r) => r.id)).toEqual([1, 2, 3]);
	});
});

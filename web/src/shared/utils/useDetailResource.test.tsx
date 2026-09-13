// ── useDetailResource：详情页取数原语的契约 ──
// 三条断言对应三类真实缺陷（doc/frontend-ui-architecture.md §4 P1-5 / P1-6）：
//   ① fetcher 抛错不能让页面卡在 loading（P1-5）；
//   ② 无效 id 不发请求、走错误态；
//   ③ **后台刷新时 loading 必须为 false、refreshing 为 true** —— 否则页面照旧渲染骨架，
//      骨架会插在旧内容上方把内容顶下去（/file/:id 的"沉一下"）。

import { createRoot, createSignal } from "solid-js";
import { describe, expect, it, vi } from "vitest";
import { useDetailResource } from "./useDetailResource.ts";

const flush = () => new Promise((r) => setTimeout(r, 0));
async function settle(check: () => boolean) {
	for (let i = 0; i < 50 && !check(); i++) await flush();
}

function setup<T>(opts: {
	fetcher: (id: string) => Promise<T>;
	validate?: (id: string) => boolean;
	initial?: string;
}) {
	const [id, setId] = createSignal(opts.initial ?? "a");
	let api!: ReturnType<typeof useDetailResource<T, string>>;
	createRoot(() => {
		api = useDetailResource<T, string>({
			id,
			validate: opts.validate,
			fetcher: opts.fetcher,
		});
	});
	return { api, setId };
}

describe("useDetailResource", () => {
	it("首次加载：loading 为真，拿到数据后转假", async () => {
		const { api } = setup({ fetcher: async (id) => `值:${id}` });
		expect(api.loading()).toBe(true);
		expect(api.data()).toBeUndefined();
		await settle(() => api.data() !== undefined);
		expect(api.data()).toBe("值:a");
		expect(api.loading()).toBe(false);
		expect(api.error()).toBeUndefined();
	});

	it("fetcher 抛错：错误走 error()，loading 不会卡住（P1-5）", async () => {
		const { api } = setup({
			fetcher: async () => {
				throw new Error("接口炸了");
			},
		});
		await settle(() => api.error() !== undefined);
		expect((api.error() as Error).message).toBe("接口炸了");
		expect(api.loading()).toBe(false);
		expect(api.data()).toBeUndefined();

		// 不变量：有错误时 loading 必为假 —— 否则"先判 loading"的渲染会把错误挡在骨架后面
		expect(api.error() !== undefined && api.loading()).toBe(false);
	});

	it("无效 id：不发请求，直接给出无效 id 错误", async () => {
		const fetcher = vi.fn(async (id: string) => id);
		const invalidIdError = new Error("无效的文件 ID");
		const [id] = createSignal("");
		let api!: ReturnType<typeof useDetailResource<string, string>>;
		createRoot(() => {
			api = useDetailResource<string, string>({
				id,
				validate: (v) => v.length > 0,
				fetcher,
				invalidIdError,
			});
		});
		expect(api.error()).toBe(invalidIdError);
		expect(api.loading()).toBe(false);
		await settle(() => true);
		expect(fetcher).not.toHaveBeenCalled();
	});

	it("切换 id 触发的后台刷新：loading=false、refreshing=true，旧数据仍在（P1-6）", async () => {
		let release = () => {};
		const { api, setId } = setup({
			fetcher: async (id) => {
				if (id === "b") {
					await new Promise<void>((r) => {
						release = r;
					});
				}
				return `值:${id}`;
			},
		});
		await settle(() => api.data() === "值:a");

		setId("b");
		// 刷新中：骨架条件（loading）必须为假，否则旧内容会被顶下去
		await settle(() => api.refreshing() === true);
		expect(api.loading()).toBe(false);
		expect(api.data()).toBe("值:a");

		release();
		await settle(() => api.data() === "值:b");
		expect(api.refreshing()).toBe(false);
	});

	it("mutate 可直接改写本地数据（详情页乐观更新用）", async () => {
		const { api } = setup({ fetcher: async (id) => `值:${id}` });
		await settle(() => api.data() === "值:a");
		api.mutate("改过了");
		expect(api.data()).toBe("改过了");
	});
});

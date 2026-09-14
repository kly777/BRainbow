// ── 泼溅运行器：worker 起不来 / 不响应 / 内容不可解析，都必须有可见结果 ──
// 这组测试的来由是一次真实故障：worker 链路静默失败时预览永远停在"正在解析"，
// 用户看不到任何原因（见 runner.ts 顶部注释）。

import { afterEach, describe, expect, it, vi } from "vitest";
import {
	buildPly,
	GAUSSIAN_PROPS,
	gaussianRow,
} from "../../lib/ply-fixtures.ts";
import { createSplatRunner, type SplatRunHandlers } from "./runner.ts";

const bytesOf = (...zs: number[]) =>
	buildPly(
		GAUSSIAN_PROPS,
		zs.map((z) => gaussianRow({ z })),
	);

/** 收集回调的替身 */
function handlers() {
	const events: string[] = [];
	const calls = {
		loaded: [] as Array<{ vertexCount: number }>,
		sorted: [] as Uint32Array[],
		failed: [] as string[],
		degraded: [] as string[],
	};
	const h: SplatRunHandlers = {
		onLoaded: (r) => {
			events.push("loaded");
			calls.loaded.push(r);
		},
		onSorted: (order) => {
			events.push("sorted");
			calls.sorted.push(order);
		},
		onFailed: (message) => {
			events.push("failed");
			calls.failed.push(message);
		},
		onDegraded: (reason) => {
			events.push("degraded");
			calls.degraded.push(reason);
		},
	};
	return { h, events, calls };
}

afterEach(() => {
	vi.unstubAllGlobals();
	vi.useRealTimers();
});

describe("createSplatRunner：worker 可用", () => {
	/** 只会说"收到了"的假 worker */
	class FakeWorker {
		static instances: FakeWorker[] = [];
		onmessage: ((e: MessageEvent<unknown>) => void) | null = null;
		onerror: ((e: { message?: string }) => void) | null = null;
		posted: unknown[] = [];
		constructor(
			public url: URL,
			public options?: { type?: string },
		) {
			FakeWorker.instances.push(this);
		}
		postMessage(msg: unknown) {
			this.posted.push(msg);
		}
		terminate() {}
	}

	it("把 load 交给 worker，并按 worker 回包驱动回调", () => {
		vi.stubGlobal("Worker", FakeWorker);
		const { h, calls } = handlers();
		const runner = createSplatRunner(h);

		expect(runner.mode).toBe("worker");
		expect(FakeWorker.instances[0]?.options?.type).toBe("module");

		runner.load(bytesOf(0));
		const loadMsg = FakeWorker.instances[0]?.posted[0] as { type: string };
		expect(loadMsg.type).toBe("load");

		// 模拟 worker 回包
		FakeWorker.instances[0]?.onmessage?.({
			data: {
				type: "loaded",
				vertexCount: 1,
				bounds: { center: [0, 0, 0], radius: 1 },
				pointCloud: false,
				texdata: new ArrayBuffer(64),
				texWidth: 2048,
				texHeight: 1,
			},
		} as MessageEvent<unknown>);
		expect(calls.loaded.length).toBe(1);

		runner.sort([0, 0, 1]);
		const sortMsg = FakeWorker.instances[0]?.posted[1] as { type: string };
		expect(sortMsg.type).toBe("sort");

		FakeWorker.instances[0]?.onmessage?.({
			data: { type: "sorted", depthIndex: new Uint32Array([0]).buffer },
		} as MessageEvent<unknown>);
		expect(calls.sorted.length).toBe(1);
	});

	it("worker 报错或长时间不响应都切主线程，并给出可见数据", () => {
		vi.useFakeTimers();
		vi.stubGlobal("Worker", FakeWorker);
		const { h, events, calls } = handlers();
		const runner = createSplatRunner(h, 1000);

		runner.load(bytesOf(0, 4));
		expect(runner.mode).toBe("worker");

		// 一直不回消息 → 超时后切主线程并把同一份数据解析完
		vi.advanceTimersByTime(1000);
		expect(runner.mode).toBe("inline");
		expect(events).toEqual(["degraded", "loaded"]);
		expect(calls.loaded[0]?.vertexCount).toBe(2);
		expect(calls.degraded[0]).toContain("没有响应");

		// 切主线程后排序也照常工作
		runner.sort([0, 0, 1]);
		expect(calls.sorted.length).toBe(1);
		expect(Array.from(calls.sorted[0] ?? [])).toEqual([0, 1]);
	});
});

describe("createSplatRunner：worker 不可用", () => {
	it("浏览器没有 Worker（或构造抛错）时直接用主线程", () => {
		vi.stubGlobal("Worker", undefined);
		const { h, calls } = handlers();
		const runner = createSplatRunner(h);
		expect(runner.mode).toBe("inline");

		runner.load(bytesOf(0, 4, 8));
		expect(calls.loaded[0]?.vertexCount).toBe(3);

		// 相机在 +z 侧往回看 → 顺序反过来
		runner.sort([0, 0, -1]);
		expect(Array.from(calls.sorted[0] ?? [])).toEqual([2, 1, 0]);
	});

	it("构造抛错（老浏览器不支持模块 worker）同样退回主线程", () => {
		vi.stubGlobal(
			"Worker",
			class {
				constructor() {
					throw new Error("module worker 不支持");
				}
			},
		);
		const { h, calls } = handlers();
		const runner = createSplatRunner(h);
		expect(runner.mode).toBe("inline");
		runner.load(bytesOf(0));
		expect(calls.loaded.length).toBe(1);
	});
});

describe("createSplatRunner：内容错误", () => {
	it("不可解析的 PLY 变成 onFailed（而不是停在加载态）", () => {
		vi.stubGlobal("Worker", undefined);
		const { h, calls } = handlers();
		const runner = createSplatRunner(h);
		runner.load(new TextEncoder().encode("这不是 PLY"));
		expect(calls.failed.length).toBe(1);
		expect(calls.failed[0]).toContain("不是 PLY");
		expect(calls.loaded.length).toBe(0);
	});
});

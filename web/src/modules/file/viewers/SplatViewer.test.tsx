// ── SplatViewer 的管线与降级路径 ──
// 两条关键契约：
//  1. **内容先到、画布后挂载时数据不能丢**（曾经的线上表现：永远停在"正在解析"。
//     原因是资源解析先触发了"把字节发给解析方"的 effect，而渲染器/worker 是在
//     画布挂载后才建的，那一份字节被 if (!worker) return 丢掉了）；
//  2. 渲染不了（无 WebGL2）或文件过大时给可见提示 + 下载入口，而不是白屏/卡死。

import { render } from "solid-js/web";
import { afterEach, describe, expect, it, vi } from "vitest";
import { buildPly, GAUSSIAN_PROPS, gaussianRow } from "../lib/ply-fixtures.ts";
import { SplatViewer } from "./SplatViewer.tsx";
import { item } from "./test-fixtures.ts";

const flush = () => new Promise((r) => setTimeout(r, 0));
async function settle(check: () => boolean) {
	for (let i = 0; i < 50 && !check(); i++) await flush();
}

/** 合成一份 3DGS PLY（组件测试用真实字节，走完整解析链） */
function syntheticPly() {
	return buildPly(
		GAUSSIAN_PROPS,
		[0, 1, 2].map((i) => gaussianRow({ x: i, y: i, z: i })),
	).buffer as ArrayBuffer;
}

/** 记录调用的假 WebGL2 上下文（jsdom 没有 WebGL，只能这样验证渲染调用） */
function fakeGlContext() {
	const calls: string[] = [];
	const gl = new Proxy(
		{},
		{
			get: (_target, prop) => {
				switch (prop) {
					case "getShaderParameter":
					case "getProgramParameter":
						return () => true;
					case "createShader":
					case "createProgram":
					case "createBuffer":
					case "createTexture":
						return () => ({ id: 1 });
					case "getUniformLocation":
						return () => ({ loc: 1 });
					case "getAttribLocation":
						return () => 0;
					default:
						return () => {
							calls.push(String(prop));
						};
				}
			},
		},
	) as unknown as WebGL2RenderingContext;
	return { gl, calls };
}

/**
 * 假的模块 worker：按真实协议应答（load → loaded、sort → sorted）。
 * 应答刻意异步，复现"消息在渲染器建好之后才到"的真实时序。
 */
class FakeWorker {
	static instances: FakeWorker[] = [];
	/** 收到 load 的那一刻，GL 已经被调用过多少次（0 = 渲染器还没建） */
	static glCallsAtLoadPost: number | undefined;
	/** 由测试注入的 GL 调用记录 */
	static glCalls: string[] = [];
	onmessage: ((e: MessageEvent<unknown>) => void) | null = null;
	onerror: unknown = null;
	posted: string[] = [];
	constructor() {
		FakeWorker.instances.push(this);
	}
	postMessage(msg: { type: string }) {
		this.posted.push(msg.type);
		if (msg.type === "load")
			FakeWorker.glCallsAtLoadPost = FakeWorker.glCalls.length;
		queueMicrotask(() => {
			if (msg.type === "load") {
				this.onmessage?.({
					data: {
						type: "loaded",
						vertexCount: 3,
						bounds: { center: [0, 0, 0], radius: 2 },
						pointCloud: false,
						texdata: new ArrayBuffer(16 * 4),
						texWidth: 8,
						texHeight: 1,
					},
				} as MessageEvent<unknown>);
				return;
			}
			if (msg.type === "sort") {
				this.onmessage?.({
					data: {
						type: "sorted",
						depthIndex: new Uint32Array([0, 1, 2]).buffer,
					},
				} as MessageEvent<unknown>);
			}
		});
	}
	terminate() {}
}

function mount(over = {}) {
	document.body.innerHTML = "";
	const host = document.createElement("div");
	document.body.appendChild(host);
	render(
		() => (
			<SplatViewer
				item={item({
					original_name: "场景.ply",
					mime_type: "application/octet-stream",
					file_category: "other",
					...over,
				})}
			/>
		),
		host,
	);
	return host;
}

afterEach(() => {
	vi.unstubAllGlobals();
	vi.restoreAllMocks();
});

describe("SplatViewer", () => {
	it("内容先到、画布后挂载时数据不丢：最终进入可交互状态并真的发了绘制调用", async () => {
		vi.stubGlobal("Worker", FakeWorker);
		vi.stubGlobal(
			"fetch",
			vi.fn(
				async () =>
					new Response(syntheticPly(), {
						status: 206,
						headers: {
							"content-range": `bytes 0-999/${syntheticPly().byteLength}`,
						},
					}),
			),
		);
		const { gl, calls } = fakeGlContext();
		FakeWorker.glCalls = calls;
		vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(
			gl as never,
		);
		// jsdom 没有 ResizeObserver
		vi.stubGlobal(
			"ResizeObserver",
			class {
				observe() {}
				disconnect() {}
			},
		);

		const host = mount();
		await settle(() => (host.textContent ?? "").includes("高斯"));

		// 解析结果到了：提示里带顶点数，且不再显示"正在解析"
		expect(host.textContent).toContain("3 个高斯");
		expect(host.textContent).not.toContain("正在解析");
		// 字节确实发给了解析方（早期版本在这里被静默丢掉）
		expect(FakeWorker.instances[0]?.posted).toContain("load");
		// 关键时序证明：发 load 时渲染器还没建起来（Solid 先跑渲染计算、再 flush
		// effect 队列，而"内容到达"的 effect 排在"画布挂载"的 effect 之前）。
		// 所以发送数据绝不能依赖画布那条线建好的东西 —— 早期版本正是
		// `if (!worker) return` 把这份字节丢掉，界面永远停在"正在解析"。
		expect(FakeWorker.glCallsAtLoadPost).toBe(0);
		// 纹理与绘制真的发生了
		expect(calls).toContain("texImage2D");
		expect(calls).toContain("drawArraysInstanced");
	});

	it("没有 WebGL2 时给出提示与下载路径，而不是白屏", async () => {
		vi.stubGlobal(
			"fetch",
			vi.fn(
				async () =>
					new Response(new Uint8Array(1024).fill(1), {
						status: 206,
						headers: { "content-range": "bytes 0-1023/1024" },
					}),
			),
		);
		const host = mount();

		await settle(() => (host.textContent ?? "").includes("3D 预览"));
		expect(host.textContent).toContain("3D 预览不可用");
		expect(host.textContent).toContain("WebGL2");
		expect(host.querySelector("canvas")).toBeTruthy();
	});

	it("超过上限的文件不下载，直接给下载入口", async () => {
		const fetchSpy = vi.fn(
			async () =>
				new Response(new Uint8Array(1024), {
					status: 206,
					headers: { "content-range": `bytes 0-1023/${512 * 1024 * 1024}` },
				}),
		);
		vi.stubGlobal("fetch", fetchSpy);
		const host = mount();

		await settle(() => (host.textContent ?? "").includes("下载"));
		expect(host.textContent).toContain("文件超过 256 MB");
		expect(fetchSpy).toHaveBeenCalledTimes(1);
		expect(host.querySelector("canvas")).toBeNull();
	});
});

// ── SplatViewer 的管线与降级路径 ──
// 两条关键契约：
//  1. **内容先到、画布后挂载时数据不能丢**（曾经的线上表现：永远停在"正在解析"。
//     原因是资源解析先触发了"把字节发给解析方"的 effect，而渲染器/worker 是在
//     画布挂载后才建的，那一份字节被 if (!worker) return 丢掉了）；
//  2. 渲染不了（无 WebGL2）或文件过大时给可见提示 + 下载入口，而不是白屏/卡死。

import { render } from "solid-js/web";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { buildPly, GAUSSIAN_PROPS, gaussianRow } from "../lib/ply-fixtures.ts";
import { SplatViewer } from "./SplatViewer.tsx";
import { item } from "./test-fixtures.ts";

const flush = () => new Promise((r) => setTimeout(r, 0));
async function settle(check: () => boolean) {
	for (let i = 0; i < 50 && !check(); i++) await flush();
}

/**
 * 手动驱动的 rAF：绘制被合并到帧里（见 SplatViewer 的 requestFrame），
 * 所以测试要能明确地"跑一帧"，而不是赌 jsdom 的 rAF 时机。
 */
let frames: Array<(now: number) => void> = [];
function stubFrames() {
	frames = [];
	vi.stubGlobal("requestAnimationFrame", (cb: (now: number) => void) => {
		frames.push(cb);
		return frames.length;
	});
	vi.stubGlobal("cancelAnimationFrame", () => {});
}
/** 跑掉当前排队的帧（帧里自己续排的那种不算，与真实 rAF 一致） */
function runFrame() {
	for (const cb of frames.splice(0)) cb(performance.now());
}

/** 画布上的滚轮（裸滚 = 环绕，参考实现同此） */
const dispatchWheel = (stage: HTMLElement) =>
	stage.dispatchEvent(
		new WheelEvent("wheel", {
			deltaY: 120,
			bubbles: true,
			cancelable: true,
		}),
	);

const countOf = (calls: string[], name: string) =>
	calls.filter((c) => c === name).length;

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
	/** 让排序回"顺序没变"（引擎在视角几乎没动时的正常路径） */
	static skipSort = false;
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
						bounds: { center: [0, 0, 0], half: [2, 2, 2], bboxRadius: 3 },
						pointCloud: false,
						sample: new Float32Array([-2, -2, -2, 2, 2, 2]).buffer,
						texdata: new ArrayBuffer(16 * 4),
						texWidth: 8,
						texHeight: 1,
					},
				} as MessageEvent<unknown>);
				return;
			}
			if (msg.type === "sort") {
				this.onmessage?.({
					data: FakeWorker.skipSort
						? { type: "sort-skipped" }
						: {
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

/**
 * 把组件跑起来所需的替身一次性装好：假 worker、返回合成 PLY 的 fetch、
 * 假 WebGL2 上下文、jsdom 缺的 ResizeObserver。返回 GL 调用记录。
 */
function loadScene() {
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
	vi.stubGlobal(
		"ResizeObserver",
		class {
			observe() {}
			disconnect() {}
		},
	);
	return { gl, calls };
}

beforeEach(() => {
	// 每个用例前的组件不会被显式销毁（jsdom 里只清了 body），worker 实例会累积；
	// 清掉静态列表，保证 instances[0] 就是当前用例的组件所用的那个
	FakeWorker.instances.length = 0;
	FakeWorker.glCallsAtLoadPost = undefined;
	FakeWorker.glCalls = [];
	FakeWorker.skipSort = false;
	stubFrames();
});

afterEach(() => {
	vi.unstubAllGlobals();
	vi.restoreAllMocks();
});

describe("SplatViewer", () => {
	it("内容先到、画布后挂载时数据不丢：最终进入可交互状态并真的发了绘制调用", async () => {
		const { calls } = loadScene();

		const host = mount();
		await settle(() => (host.textContent ?? "").includes("高斯"));
		// 绘制合并到帧里了（见 requestFrame），要跑一帧才画
		runFrame();

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

	it("排序在飞时又移动相机：回包后必须补发一次（曾因漏清 pending 让排序永久冻住）", async () => {
		loadScene();

		const host = mount();
		await settle(() => (host.textContent ?? "").includes("高斯"));
		const stage = host.querySelector("[role='application']") as HTMLElement;
		const worker = FakeWorker.instances.at(-1);
		const sortCount = () =>
			worker?.posted.filter((t) => t === "sort").length ?? 0;
		const before = sortCount();

		// 连续两次移动：第一次发请求，第二次落在"请求在飞"期间
		dispatchWheel(stage);
		dispatchWheel(stage);
		await settle(() => sortCount() >= before + 2);

		// 回包后补发了一次排序 → 顺序跟着最新视角走
		// （否则界面会一直显示旧视角的遮挡关系：转到背面还是正面的画面）
		expect(sortCount()).toBeGreaterThanOrEqual(before + 2);
	});

	it("一帧里连续多次拖拽/滚轮只画一次（绘制走 rAF 合并，不在事件里直接画）", async () => {
		const { calls } = loadScene();

		const host = mount();
		await settle(() => (host.textContent ?? "").includes("高斯"));
		const stage = host.querySelector("[role='application']") as HTMLElement;
		runFrame();
		const drawsBefore = countOf(calls, "drawArraysInstanced");
		expect(drawsBefore).toBeGreaterThan(0);

		// 真实拖拽就是每帧好几个 pointermove/wheel：这里连发 5 次
		for (let i = 0; i < 5; i++) dispatchWheel(stage);
		// 只排了一帧（事件里不画，绘制被合并）
		expect(frames.length).toBe(1);
		expect(countOf(calls, "drawArraysInstanced")).toBe(drawsBefore);

		runFrame();
		expect(countOf(calls, "drawArraysInstanced")).toBe(drawsBefore + 1);
	});

	it("顺序没变（sort-skipped）时不重传索引、不重绘，但“排序在飞”标记要清掉", async () => {
		const { calls } = loadScene();
		FakeWorker.skipSort = true;

		const host = mount();
		await settle(() => (host.textContent ?? "").includes("高斯"));
		const stage = host.querySelector("[role='application']") as HTMLElement;
		runFrame();
		// 上传索引的调用（建渲染器时那次 quad 上传之后才开始计）
		const uploadsBefore = countOf(calls, "bufferData");
		const drawsBefore = countOf(calls, "drawArraysInstanced");
		const worker = FakeWorker.instances.at(-1);
		const sortCount = () =>
			worker?.posted.filter((t) => t === "sort").length ?? 0;
		const sortsBefore = sortCount();

		dispatchWheel(stage);
		await flush(); // 让 worker 的答复（微任务）落地
		runFrame();
		// 顺序没变 → 不重新上传索引；绘制只来自"相机确实动了"的那一帧，
		// 答复本身没有引发额外的一次
		expect(countOf(calls, "bufferData")).toBe(uploadsBefore);
		expect(countOf(calls, "drawArraysInstanced")).toBe(drawsBefore + 1);

		// 但"排序在飞"确实清掉了：紧接着再动一次，仍然会发出新的排序请求
		// （若 skipped 答复没有清标记，这里只会记 sortDirty，不会再发请求 ——
		//  这正是当年"排序永久冻住"的复发点）
		dispatchWheel(stage);
		await flush();
		expect(sortCount()).toBe(sortsBefore + 2);

		// 对照：顺序真的变了时，索引照常上传
		FakeWorker.skipSort = false;
		dispatchWheel(stage);
		await flush();
		runFrame();
		expect(countOf(calls, "bufferData")).toBe(uploadsBefore + 1);
	});

	it("切换移动模式：按钮在两种模式间切换，操作提示跟着换", async () => {
		loadScene();

		const host = mount();
		await settle(() => (host.textContent ?? "").includes("高斯"));
		const toggle = host.querySelector(
			"button[aria-pressed]",
		) as HTMLButtonElement;
		// 默认是"视角相对"（本次改动前的操作，不改变既有手感）
		expect(toggle.textContent).toContain("视角相对");
		expect(toggle.getAttribute("aria-pressed")).toBe("false");
		expect(host.textContent).toContain("WASD 转视角");

		toggle.click();
		expect(toggle.textContent).toContain("水平锁定");
		expect(toggle.getAttribute("aria-pressed")).toBe("true");
		expect(host.textContent).toContain("沿地面移动");
		expect(host.textContent).not.toContain("WASD 转视角");

		// 再点回来
		toggle.click();
		expect(toggle.textContent).toContain("视角相对");
		expect(host.textContent).toContain("WASD 转视角");
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

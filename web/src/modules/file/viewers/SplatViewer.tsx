import { createEffect, createSignal, on, onCleanup, Show } from "solid-js";
import { usePreviewPly } from "../hooks/usePreviewPly.ts";
import { DownloadPanel } from "./DownloadPanel.tsx";
import {
	add,
	orbitOffset,
	scaleVec,
	type Vec3,
	viewMatrix,
} from "./splat/matrix.ts";
import { createSplatRenderer, type SplatRenderer } from "./splat/renderer.ts";
import type { SplatRequest, SplatResponse } from "./splat/worker.ts";
import type { ViewerComponent } from "./types.ts";
import styles from "./viewers.module.css";

/** 世界坐标的"画面上方"：3DGS / COLMAP 的 y 轴朝下 */
const WORLD_UP: Vec3 = [0, -1, 0];
/** 拖拽灵敏度（弧度/像素） */
const ORBIT_SPEED = 0.008;
/** 滚轮灵敏度（每像素的指数缩放系数） */
const WHEEL_SPEED = 0.0015;
/** 相机与目标距离的范围（相对包围球半径） */
const MIN_DISTANCE_FACTOR = 0.15;
const MAX_DISTANCE_FACTOR = 12;
/** 自动取景时相机到目标的距离（半径 × 这个系数） */
const FIT_DISTANCE_FACTOR = 2.4;

interface Camera {
	target: Vec3;
	distance: number;
	yaw: number;
	pitch: number;
	/** 包围球半径，用于取景与缩放范围 */
	radius: number;
}

const clamp = (value: number, min: number, max: number) =>
	Math.min(Math.max(value, min), max);

/**
 * 3DGS 高斯泼溅预览（.ply）。
 *
 * 排序与渲染数学取自 antimatter15/splat（MIT License, Copyright (c) 2023 Kevin Kwok），
 * 本文件只负责接进预览页：按需重绘（不跑常驻 rAF）、自动取景、拖拽/滚轮交互与降级提示。
 */
export const SplatViewer: ViewerComponent = (props) => {
	const load = usePreviewPly(() => props.item);
	const [renderError, setRenderError] = createSignal<string>();
	const [parseError, setParseError] = createSignal<string>();
	const [ready, setReady] = createSignal(false);
	const [hint, setHint] = createSignal<string>();

	let renderer: SplatRenderer | undefined;
	let worker: Worker | undefined;
	let vertexCount = 0;
	/** 已请求但还没回来的排序（相机连续变化时不必重复排队） */
	let sortPending = false;
	// 用信号承载 DOM 引用：画布只在内容就绪后才挂载，初始化 effect 要跟着它走
	const [canvasEl, setCanvasEl] = createSignal<HTMLCanvasElement>();
	const [stageEl, setStageEl] = createSignal<HTMLDivElement>();
	const camera: Camera = {
		target: [0, 0, 0],
		distance: 1,
		yaw: 0,
		pitch: 0.15,
		radius: 1,
	};

	const currentView = () =>
		viewMatrix(
			add(
				camera.target,
				orbitOffset(camera.distance, camera.yaw, camera.pitch),
			),
			camera.target,
			WORLD_UP,
		);

	const draw = () => renderer?.draw(currentView(), vertexCount);

	const requestSort = () => {
		if (!worker || vertexCount === 0) return;
		// 相机前向轴 = 视图矩阵第三行（列主序里的 [2]、[6]、[10]）
		const view = currentView();
		sortPending = true;
		worker.postMessage({
			type: "sort",
			depthAxis: [view[2], view[6], view[10]],
		} satisfies SplatRequest);
	};

	const cameraMoved = () => {
		draw();
		if (!sortPending) requestSort();
	};

	const onWorkerMessage = (event: MessageEvent<SplatResponse>) => {
		const msg = event.data;
		if (msg.type === "loaded") {
			vertexCount = msg.vertexCount;
			renderer?.setSplatTexture(
				new Uint32Array(msg.texdata),
				msg.texWidth,
				msg.texHeight,
			);
			camera.target = msg.bounds.center;
			camera.radius = msg.bounds.radius;
			camera.distance = msg.bounds.radius * FIT_DISTANCE_FACTOR;
			camera.yaw = 0;
			camera.pitch = 0.15;
			setHint(
				`${msg.vertexCount.toLocaleString()} 个${msg.pointCloud ? "点（普通点云）" : "高斯"} · 左键拖拽旋转 · 滚轮缩放 · 右键/Shift 拖拽平移`,
			);
			setReady(true);
			requestSort();
			draw();
			return;
		}
		if (msg.type === "sorted") {
			sortPending = false;
			renderer?.setDepthIndex(new Uint32Array(msg.depthIndex));
			draw();
			return;
		}
		setParseError(msg.message);
	};

	// ── 初始化：WebGL2 渲染器 + 排序 worker + 尺寸监听 ──
	// 画布随内容就绪出现，renderer/worker 也随之创建（超大文件直接走下载兜底，不会建上下文）
	createEffect(() => {
		const element = canvasEl();
		const box = stageEl();
		if (!element || !box) return;
		try {
			renderer = createSplatRenderer(element);
		} catch (err) {
			// jsdom / 老浏览器 / 禁用 WebGL 都会走到这里：给提示而不是白屏
			setRenderError(err instanceof Error ? err.message : String(err));
			return;
		}
		worker = new Worker(new URL("./splat/worker.ts", import.meta.url), {
			type: "module",
		});
		worker.onmessage = onWorkerMessage;
		worker.onerror = (e) =>
			setRenderError(`渲染线程出错：${e.message || "未知错误"}`);

		const fit = () => {
			if (!renderer) return;
			renderer.resize(box.clientWidth, box.clientHeight);
			draw();
		};
		const observer = new ResizeObserver(fit);
		observer.observe(box);
		fit();

		onCleanup(() => {
			observer.disconnect();
			worker?.terminate();
			worker = undefined;
			renderer?.dispose();
			renderer = undefined;
			vertexCount = 0;
			sortPending = false;
			setReady(false);
		});
	});

	// ── 内容到达 → 交给 worker 解析（buffer 转移，零拷贝） ──
	createEffect(
		on(load, (state) => {
			if (state?.kind !== "ready" || !worker) return;
			setReady(false);
			setHint(undefined);
			setParseError(undefined);
			vertexCount = 0;
			const { bytes } = state;
			const buffer = bytes.buffer.slice(
				bytes.byteOffset,
				bytes.byteOffset + bytes.byteLength,
			) as ArrayBuffer;
			worker.postMessage({ type: "load", ply: buffer } satisfies SplatRequest, [
				buffer,
			]);
		}),
	);

	// ── 交互：左键拖拽旋转、右键/Shift 拖拽平移、滚轮缩放 ──
	let dragging: "orbit" | "pan" | undefined;
	let lastX = 0;
	let lastY = 0;

	const onPointerDown = (e: PointerEvent) => {
		dragging = e.button === 2 || e.shiftKey ? "pan" : "orbit";
		lastX = e.clientX;
		lastY = e.clientY;
		canvasEl()?.setPointerCapture(e.pointerId);
		e.preventDefault();
	};

	const onPointerMove = (e: PointerEvent) => {
		if (!dragging) return;
		const dx = e.clientX - lastX;
		const dy = e.clientY - lastY;
		lastX = e.clientX;
		lastY = e.clientY;

		if (dragging === "orbit") {
			camera.yaw -= dx * ORBIT_SPEED;
			// 限制俯仰：越过正上/正下时"上"向量会退化
			camera.pitch = clamp(
				camera.pitch + dy * ORBIT_SPEED,
				-Math.PI / 2 + 0.05,
				Math.PI / 2 - 0.05,
			);
		} else {
			// 平移：沿相机右/上方向移动目标点，位移随距离缩放（远景拖起来同样跟手）
			const view = currentView();
			const right: Vec3 = [view[0], view[4], view[8]];
			const up: Vec3 = [view[1], view[5], view[9]];
			const k = camera.distance * 0.002;
			camera.target = add(
				camera.target,
				add(scaleVec(right, -dx * k), scaleVec(up, -dy * k)),
			);
		}
		cameraMoved();
	};

	const onPointerUp = (e: PointerEvent) => {
		dragging = undefined;
		canvasEl()?.releasePointerCapture(e.pointerId);
	};

	const onWheel = (e: WheelEvent) => {
		e.preventDefault();
		camera.distance = clamp(
			camera.distance * Math.exp(e.deltaY * WHEEL_SPEED),
			camera.radius * MIN_DISTANCE_FACTOR,
			camera.radius * MAX_DISTANCE_FACTOR,
		);
		cameraMoved();
	};

	const tooLarge = () => {
		const state = load();
		return state?.kind === "too-large" ? state.sizeBytes : undefined;
	};

	const failure = () => {
		if (renderError()) return "3D 预览不可用";
		const state = load();
		return state?.kind === "failed" ? "加载失败" : undefined;
	};

	return (
		<Show
			when={tooLarge() === undefined}
			fallback={
				<DownloadPanel
					item={props.item}
					note="文件超过 256 MB，浏览器端不做解析；下载后用本地 3DGS 工具查看"
				/>
			}
		>
			<div class={styles.splatPane}>
				{/* 内容没到手之前先只放提示：避免为超大/不可用文件白建 WebGL 上下文 */}
				<Show
					when={load()?.kind === "ready"}
					fallback={
						<div class={styles.splatStage}>
							<div class={styles.splatOverlay}>
								<p class={styles.splatMessage}>
									{failure() ?? "正在读取文件…"}
								</p>
								<Show when={load()?.kind === "failed"}>
									<p class={styles.splatDetail}>
										{(load() as { message: string } | undefined)?.message}
									</p>
								</Show>
							</div>
						</div>
					}
				>
					{/* biome-ignore lint/a11y/noStaticElementInteractions: 3D 视图的画布交互（拖拽/滚轮），键盘用户可走下载路径 */}
					<div
						ref={setStageEl}
						class={styles.splatStage}
						onPointerDown={onPointerDown}
						onPointerMove={onPointerMove}
						onPointerUp={onPointerUp}
						onPointerCancel={onPointerUp}
						onWheel={onWheel}
						onContextMenu={(e) => e.preventDefault()}
					>
						<canvas ref={setCanvasEl} class={styles.splatCanvas} />
						<Show when={renderError() || parseError()}>
							<div class={styles.splatOverlay}>
								<p class={styles.splatMessage}>
									{renderError() ? "3D 预览不可用" : "无法解析这个文件"}
								</p>
								<p class={styles.splatDetail}>
									{renderError() ?? parseError()}
								</p>
								<p class={styles.splatDetail}>
									可以下载后用本地工具查看；浏览器内渲染需要
									WebGL2（桌面浏览器基本都支持）。
								</p>
							</div>
						</Show>
						<Show when={!renderError() && !parseError() && !ready()}>
							<div class={styles.splatOverlay}>
								<p class={styles.splatMessage}>正在解析高斯泼溅…</p>
								<p class={styles.splatDetail}>文件越大越慢，请稍候</p>
							</div>
						</Show>
						<Show when={ready() && hint()}>
							{(text) => <p class={styles.splatHint}>{text()}</p>}
						</Show>
					</div>
				</Show>
			</div>
		</Show>
	);
};

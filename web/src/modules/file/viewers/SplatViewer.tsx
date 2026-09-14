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
import {
	createSplatRunner,
	type SplatLoadResult,
	type SplatRunner,
} from "./splat/runner.ts";
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
/** 超过这个时间还没解析完就给一句"可能较慢"的提示，免得看起来像卡死 */
const SLOW_HINT_MS = 6000;

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
 *
 * 两条时间线必须解耦（这是"永远停在正在解析"的根因）：内容到达交给 `runner` 处理，
 * 与画布无关；WebGL 渲染器只在画布挂载后出现。谁先到都先把结果存进 `loaded` /
 * `depthIndex`，另一条线就绪时由 `syncRenderer()` 补齐 —— 早期版本把"把字节发给
 * 解析方"写在依赖画布的 effect 里，而资源解析会先触发那个 effect、再渲染出画布，
 * 于是这份字节被无声丢掉，之后再无消息，界面就一直挂着。
 */
export const SplatViewer: ViewerComponent = (props) => {
	const load = usePreviewPly(() => props.item);
	const [renderError, setRenderError] = createSignal<string>();
	const [parseError, setParseError] = createSignal<string>();
	/** 退回主线程时的说明（拖动会略卡） */
	const [degraded, setDegraded] = createSignal<string>();
	const [ready, setReady] = createSignal(false);
	const [hint, setHint] = createSignal<string>();
	/** 解析耗时超过预期时的提示（避免看起来像卡死） */
	const [slow, setSlow] = createSignal(false);
	let slowTimer: ReturnType<typeof setTimeout> | undefined;

	let renderer: SplatRenderer | undefined;
	let runner: SplatRunner | undefined;
	let vertexCount = 0;
	/** 已请求但还没回来的排序（相机连续变化时不必重复排队） */
	let sortPending = false;
	// 数据侧缓存：GL 还没就绪时先存着，渲染器建好后补齐
	let loaded: SplatLoadResult | undefined;
	let depthIndex: Uint32Array | undefined;
	let textureDirty = false;
	let indexDirty = false;

	// 用信号承载 DOM 引用：画布只在内容就绪后才挂载，GL 初始化要跟着它走
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

	/** 把已到手的数据补齐到渲染器上（首次挂载或新数据到达时调用） */
	const syncRenderer = () => {
		if (!renderer || !loaded) return;
		if (textureDirty) {
			renderer.setSplatTexture(
				loaded.texdata,
				loaded.texWidth,
				loaded.texHeight,
			);
			textureDirty = false;
		}
		if (indexDirty && depthIndex) {
			renderer.setDepthIndex(depthIndex);
			indexDirty = false;
		}
		vertexCount = loaded.vertexCount;
		draw();
	};

	const requestSort = () => {
		if (!runner || vertexCount === 0) return;
		// 相机前向轴 = 视图矩阵第三行（列主序里的 [2]、[6]、[10]）
		const view = currentView();
		sortPending = true;
		runner.sort([view[2], view[6], view[10]]);
	};

	const cameraMoved = () => {
		draw();
		if (!sortPending) requestSort();
	};

	// ── 运行器回调：所有异常路径都要落到可见提示，不能停在加载态 ──
	const onRunnerLoaded = (result: SplatLoadResult) => {
		loaded = result;
		textureDirty = true;
		vertexCount = result.vertexCount;
		// 自动取景：把包围球装进画面
		camera.target = result.bounds.center;
		camera.radius = result.bounds.radius;
		camera.distance = result.bounds.radius * FIT_DISTANCE_FACTOR;
		camera.yaw = 0;
		camera.pitch = 0.15;
		setHint(
			`${result.vertexCount.toLocaleString()} 个${result.pointCloud ? "点（普通点云）" : "高斯"}`,
		);
		if (slowTimer) clearTimeout(slowTimer);
		setSlow(false);
		setReady(true);
		syncRenderer();
		requestSort();
	};

	const onRunnerSorted = (order: Uint32Array) => {
		sortPending = false;
		depthIndex = order;
		indexDirty = true;
		syncRenderer();
	};

	const onRunnerFailed = (message: string) => setParseError(message);
	const onRunnerDegraded = (reason: string) => setDegraded(reason);

	// ── 运行器：与画布无关，尽早建好，免得内容先到却没有接收方 ──
	createEffect(() => {
		runner = createSplatRunner({
			onLoaded: onRunnerLoaded,
			onSorted: onRunnerSorted,
			onFailed: onRunnerFailed,
			onDegraded: onRunnerDegraded,
		});
		onCleanup(() => {
			if (slowTimer) clearTimeout(slowTimer);
			runner?.dispose();
			runner = undefined;
		});
	});

	// ── 内容到达 → 交给运行器解析（无论 GL 是否就绪） ──
	createEffect(
		on(load, (state) => {
			if (state?.kind !== "ready" || !runner) return;
			setReady(false);
			setHint(undefined);
			setParseError(undefined);
			setDegraded(undefined);
			vertexCount = 0;
			loaded = undefined;
			depthIndex = undefined;
			if (slowTimer) clearTimeout(slowTimer);
			setSlow(false);
			slowTimer = setTimeout(() => setSlow(true), SLOW_HINT_MS);
			runner.load(state.bytes);
		}),
	);

	// ── WebGL 渲染器：随画布挂载建立，挂载时把已到手的数据补齐 ──
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
		// 新上下文里没有任何数据，把缓存重新上传一遍
		textureDirty = true;
		indexDirty = depthIndex !== undefined;

		const fit = () => {
			if (!renderer) return;
			renderer.resize(box.clientWidth, box.clientHeight);
			syncRenderer();
		};
		const observer = new ResizeObserver(fit);
		observer.observe(box);
		fit();

		onCleanup(() => {
			observer.disconnect();
			renderer?.dispose();
			renderer = undefined;
		});
	});

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
								<p class={styles.splatDetail}>
									{slow()
										? "文件较大时解析较慢；若长时间没有画面，可直接下载后本地查看"
										: "文件越大越慢，请稍候"}
								</p>
							</div>
						</Show>
						<Show when={ready() && hint()}>
							{(text) => (
								<p class={styles.splatHint}>
									{text()}
									{degraded() ? ` · ${degraded()}` : ""}
								</p>
							)}
						</Show>
					</div>
				</Show>
			</div>
		</Show>
	);
};

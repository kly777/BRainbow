import { createEffect, createSignal, on, onCleanup, Show } from "solid-js";
import { usePreviewPly } from "../hooks/usePreviewPly.ts";
import { DownloadPanel } from "./DownloadPanel.tsx";
import {
	applyOps,
	type CameraOp,
	dragOps,
	isCameraKey,
	jumpOps,
	keyOps,
	scaleOps,
	wheelOps,
} from "./splat/controls.ts";
import {
	add,
	type Mat4,
	orbitOffset,
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
/**
 * 自动取景：相机距离 = 取景半径 × 这个系数。
 * 半径是距离分布的 P90（见 ply.ts），系数按"内容占满约 85% 画面高度"定：
 * 竖直视场角 55°、半角 27.5°，`d = r / sin(0.85 × 27.5°) ≈ 2.5 r`。
 */
const FIT_DISTANCE_FACTOR = 2.5;
/** 初始俯仰（略微俯视，与参考实现的默认机位观感一致） */
const INITIAL_PITCH = 0.15;
/** 超过这个时间还没解析完就给一句"可能较慢"的提示，免得看起来像卡死 */
const SLOW_HINT_MS = 6000;
/** 空格"跳"的每帧渐变步长（参考实现同此） */
const JUMP_STEP = 0.05;
/** 一帧按 1/60 秒折算；上限防止切标签页回来后跳一大步 */
const FRAME_MS = 1000 / 60;
const MAX_FRAME_SCALE = 3;

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
	/** 相机状态就是一个世界→相机的矩阵（自由视角，可翻滚），操作一律在相机自身坐标系里做 */
	let view: Mat4 = new Float32Array([
		1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1,
	]);
	/** 环绕（IJKL / 拖拽 / 滚轮）的定点距离：取景时按包围球定，之后固定 */
	let orbitDistance = 1;
	/** 按住的键（`KeyboardEvent.code`） */
	const activeKeys = new Set<string>();
	/** 空格"跳"：按住渐变到 1，松开渐变回 0（参考实现同此） */
	let jumpDelta = 0;
	let rafId: number | undefined;
	let lastFrameTime = 0;

	/** 当前渲染用的视图矩阵（含空格的跳） */
	const currentView = () =>
		jumpDelta === 0 ? view : applyOps(view, jumpOps(jumpDelta), orbitDistance);

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
		// 自动取景：把包围球装进画面（相机在包围球中心前方，略微俯视）
		const distance = Math.max(result.bounds.radius * FIT_DISTANCE_FACTOR, 1e-3);
		orbitDistance = distance;
		view = viewMatrix(
			add(result.bounds.center, orbitOffset(distance, 0, INITIAL_PITCH)),
			result.bounds.center,
			WORLD_UP,
		);
		jumpDelta = 0;
		activeKeys.clear();
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
			if (rafId !== undefined) cancelAnimationFrame(rafId);
			rafId = undefined;
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

	// ── 帧循环：只在按住相机键（或"跳"还没落回）时跑，空闲时不烧 GPU ──
	const frame = (now: number) => {
		rafId = undefined;
		const scale =
			Math.min((now - lastFrameTime) / FRAME_MS, MAX_FRAME_SCALE) || 1;
		lastFrameTime = now;

		const shiftHeld =
			activeKeys.has("ShiftLeft") || activeKeys.has("ShiftRight");
		const ops: CameraOp[] = [];
		for (const code of activeKeys) {
			const keyed = keyOps(code, shiftHeld);
			if (keyed) ops.push(...keyed);
		}
		if (activeKeys.has("Space"))
			jumpDelta = Math.min(1, jumpDelta + JUMP_STEP * scale);
		else jumpDelta = Math.max(0, jumpDelta - JUMP_STEP * scale);

		const moved = ops.length > 0;
		if (moved || jumpDelta > 0) {
			if (moved) view = applyOps(view, scaleOps(ops, scale), orbitDistance);
			draw();
			if (!sortPending) requestSort();
		}
		if (activeKeys.size > 0 || jumpDelta > 0)
			rafId = requestAnimationFrame(frame);
	};

	const startFrameLoop = () => {
		if (rafId !== undefined) return;
		lastFrameTime = performance.now();
		rafId = requestAnimationFrame(frame);
	};

	// ── 键盘：与参考实现同表（见 splat/controls.ts）；只在画布获得焦点时生效 ──
	const onKeyDown = (e: KeyboardEvent) => {
		if (e.code === "ShiftLeft" || e.code === "ShiftRight") {
			activeKeys.add(e.code);
			return;
		}
		if (!isCameraKey(e.code)) return;
		// 方向键与空格会滚动页面，必须拦；字母键不拦（Ctrl+A 之类留给浏览器）
		if (e.code.startsWith("Arrow") || e.code === "Space") e.preventDefault();
		// 别让相机的按键冒泡到页面级的全局 keydown 监听（详情页的 ←/→ 切文件已移除，
		// 这里保留拦截是为了以后再加全局快捷键时不会与相机操作打架）
		e.stopPropagation();
		activeKeys.add(e.code);
		startFrameLoop();
	};

	const onKeyUp = (e: KeyboardEvent) => {
		if (e.code === "ShiftLeft" || e.code === "ShiftRight") {
			activeKeys.delete(e.code);
			return;
		}
		if (!isCameraKey(e.code)) return;
		e.stopPropagation();
		activeKeys.delete(e.code);
	};

	/** 失焦时清空按住状态，避免"按键卡住" */
	const onBlur = () => {
		activeKeys.clear();
	};

	// ── 鼠标拖拽：左键环绕，右键（或 Ctrl/Cmd + 左键）前后 + 平移 ──
	/** 正在拖拽的指针 id：多指（触屏）时只跟第一根手指，避免两指互抢 */
	let activePointer: number | undefined;
	let dragButton = 1;
	let dragCtrl = false;
	let dragMeta = false;
	let lastX = 0;
	let lastY = 0;

	const onPointerDown = (e: PointerEvent) => {
		if (activePointer !== undefined) return; // 多指时只跟第一根
		activePointer = e.pointerId;
		dragButton = e.button;
		dragCtrl = e.ctrlKey;
		dragMeta = e.metaKey;
		lastX = e.clientX;
		lastY = e.clientY;
		canvasEl()?.setPointerCapture(e.pointerId);
		stageEl()?.focus();
		e.preventDefault();
	};

	const onPointerMove = (e: PointerEvent) => {
		if (e.pointerId !== activePointer) return;
		const box = stageEl();
		const width = box?.clientWidth || 1;
		const height = box?.clientHeight || 1;
		const deltaX = e.clientX - lastX;
		const deltaY = e.clientY - lastY;
		lastX = e.clientX;
		lastY = e.clientY;
		view = applyOps(
			view,
			dragOps({
				button: dragButton,
				ctrlKey: dragCtrl,
				metaKey: dragMeta,
				deltaX,
				deltaY,
				width,
				height,
			}),
			orbitDistance,
		);
		cameraMoved();
	};

	const onPointerUp = (e: PointerEvent) => {
		if (e.pointerId !== activePointer) return;
		activePointer = undefined;
		canvasEl()?.releasePointerCapture(e.pointerId);
	};

	// ── 滚轮：裸滚环绕、Shift 平移、Ctrl/Cmd 前后移动（与参考实现一致） ──
	const onWheel = (e: WheelEvent) => {
		e.preventDefault();
		const box = stageEl();
		view = applyOps(
			view,
			wheelOps({
				deltaX: e.deltaX,
				deltaY: e.deltaY,
				deltaMode: e.deltaMode,
				shiftKey: e.shiftKey,
				ctrlKey: e.ctrlKey,
				metaKey: e.metaKey,
				width: box?.clientWidth || 1,
				height: box?.clientHeight || 1,
			}),
			orbitDistance,
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
					<div
						ref={setStageEl}
						class={styles.splatStage}
						// 自带键鼠操作的画布式控件：role=application 让它可被命名（aria-label 需要 role）
						role="application"
						tabindex="0"
						aria-label="3D 高斯泼溅视图（点击后可用键盘操作）"
						onPointerDown={onPointerDown}
						onPointerMove={onPointerMove}
						onPointerUp={onPointerUp}
						onPointerCancel={onPointerUp}
						onWheel={onWheel}
						onKeyDown={onKeyDown}
						onKeyUp={onKeyUp}
						onBlur={onBlur}
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
									{text()} · 拖拽环绕 · WASD 转视角 · 方向键移动 · QE 翻滚 ·
									滚轮环绕 · Ctrl+滚轮前后
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

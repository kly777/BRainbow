import {
	createEffect,
	createMemo,
	createResource,
	createSignal,
	onCleanup,
	onMount,
	Show,
} from "solid-js";
import { notifyError } from "../../../lib/notify.ts";
import { tryAsync } from "../../../lib/result.ts";
import { getAllTasksE, getDagE } from "../api.ts";
import type { Task } from "../types.ts";
import type { LayoutNode } from "./dag-layout.ts";
import { layout } from "./dag-layout.ts";
import { calcAutoOffset, drawGraph, hitTestNode } from "./dag-render.ts";
import styles from "./TaskDag.module.css";

// ── 任务选择器 ──

interface TagSelectorProps {
	tasks: readonly Task[];
	value: number | undefined;
	onChange: (id: number | undefined) => void;
}

function TagSelector(props: TagSelectorProps) {
	return (
		<select
			class={styles.taskSelect}
			value={props.value ?? ""}
			onChange={(e) => {
				const v = e.currentTarget.value;
				props.onChange(v ? Number(v) : undefined);
			}}
		>
			<option value="">全部依赖关系</option>
			{props.tasks.map((t) => (
				<option value={t.id}>{t.title}</option>
			))}
		</select>
	);
}

// ── DAG 组件 ──

export default function TaskDag() {
	const [taskFilter, setTaskFilter] = createSignal<number | undefined>();
	const [depth, setDepth] = createSignal(3);

	// 拉取 DAG 数据
	const [dagData] = createResource(
		() => ({ taskId: taskFilter(), depth: depth() }),
		async ({ taskId, depth: d }) => {
			const result = await tryAsync(() => getDagE(taskId, d));
			if (result.ok) return result.value;
			notifyError("获取依赖图失败", result.error);
			return { nodes: [], edges: [] };
		},
	);

	// 拉取所有任务（用于选择器）
	const [allTasks] = createResource(async () => {
		const result = await tryAsync(() => getAllTasksE());
		if (result.ok) return [...result.value.items];
		notifyError("获取任务列表失败", result.error);
		return [];
	});

	// 布局计算
	const layoutData = createMemo(() => {
		const d = dagData();
		if (!d || d.nodes.length === 0) return null;
		return layout(d.nodes, d.edges);
	});

	// Canvas 交互状态
	let canvasRef: HTMLCanvasElement | undefined;
	const [scale, setScale] = createSignal(1);
	const [offset, setOffset] = createSignal({ x: 0, y: 0 });
	const [hoveredId, setHoveredId] = createSignal<number | null>(null);
	const [dragging, setDragging] = createSignal(false);
	let dragStart = { x: 0, y: 0 };

	const render = () => {
		const canvas = canvasRef;
		const lay = layoutData();
		if (!canvas || !lay) return;
		const ctx = canvas.getContext("2d");
		if (!ctx) return;

		const dpr = globalThis.devicePixelRatio || 1;
		const rect = canvas.getBoundingClientRect();
		canvas.width = rect.width * dpr;
		canvas.height = rect.height * dpr;
		ctx.scale(dpr, dpr);

		const auto = calcAutoOffset(rect.width, rect.height, lay.nodes, scale());
		drawGraph(
			ctx,
			lay,
			scale(),
			auto.x + offset().x,
			auto.y + offset().y,
			hoveredId(),
		);
	};

	createEffect(() => {
		layoutData();
		render();
	});

	onMount(() => {
		const onResize = () => render();
		addEventListener("resize", onResize);
		onCleanup(() => removeEventListener("resize", onResize));
	});

	// ── 事件处理 ──

	const onWheel = (e: WheelEvent) => {
		e.preventDefault();
		setScale((s) => Math.max(0.3, Math.min(3, s - e.deltaY * 0.001)));
	};

	const canvasToGraph = (clientX: number, clientY: number) => {
		const canvas = canvasRef;
		const lay = layoutData();
		if (!canvas || !lay) return null;
		const rect = canvas.getBoundingClientRect();
		const auto = calcAutoOffset(rect.width, rect.height, lay.nodes, scale());
		return {
			x: (clientX - rect.left - auto.x - offset().x) / scale(),
			y: (clientY - rect.top - auto.y - offset().y) / scale(),
		};
	};

	const onClick = (e: MouseEvent) => {
		const lay = layoutData();
		if (!lay) return;
		const pt = canvasToGraph(e.clientX, e.clientY);
		if (!pt) return;
		const id = hitTestNode(pt.x, pt.y, lay.nodes);
		if (id !== null) {
			setTaskFilter((prev) => (prev === id ? undefined : id));
		}
	};

	const onMouseDown = (e: MouseEvent) => {
		setDragging(true);
		dragStart = { x: e.clientX - offset().x, y: e.clientY - offset().y };
	};

	const onMouseMove = (e: MouseEvent) => {
		if (dragging()) {
			setOffset({
				x: e.clientX - dragStart.x,
				y: e.clientY - dragStart.y,
			});
		} else {
			const lay = layoutData();
			if (!lay) return;
			const pt = canvasToGraph(e.clientX, e.clientY);
			if (!pt) return;
			setHoveredId(hitTestNode(pt.x, pt.y, lay.nodes));
		}
	};

	const onMouseUp = () => setDragging(false);

	return (
		<div class={styles.dagContainer}>
			<div class={styles.dagToolbar}>
				<h2 class={styles.dagTitle}>任务依赖图</h2>
				<div class={styles.dagControls}>
					<TagSelector
						tasks={allTasks() || []}
						value={taskFilter()}
						onChange={setTaskFilter}
					/>
					<select
						class={styles.taskSelect}
						value={depth()}
						onChange={(e) => setDepth(Number(e.currentTarget.value))}
					>
						<option value={1}>深度 1</option>
						<option value={2}>深度 2</option>
						<option value={3}>深度 3</option>
						<option value={5}>深度 5</option>
						<option value={10}>深度 10</option>
					</select>
					<button
						type="button"
						class={styles.zoomBtn}
						onClick={() => setScale((s) => Math.min(3, s + 0.2))}
						title="放大"
					>
						+
					</button>
					<button
						type="button"
						class={styles.zoomBtn}
						onClick={() => setScale((s) => Math.max(0.3, s - 0.2))}
						title="缩小"
					>
						−
					</button>
					<button
						type="button"
						class={styles.zoomBtn}
						onClick={() => {
							setScale(1);
							setOffset({ x: 0, y: 0 });
						}}
						title="重置"
					>
						↺
					</button>
				</div>
			</div>
			<div class={styles.canvasWrap}>
				<Show
					when={(() => {
						const ld = layoutData();
						return ld && ld.nodes.length > 0;
					})()}
					fallback={
						<div class={styles.emptyHint}>
							<p>暂无依赖关系</p>
							<p class={styles.hintSub}>
								在任务详情页为任务添加依赖后，可在此处查看依赖图
							</p>
						</div>
					}
				>
					<canvas
						ref={canvasRef}
						class={styles.dagCanvas}
						onWheel={onWheel}
						onMouseDown={onMouseDown}
						onMouseMove={onMouseMove}
						onMouseUp={onMouseUp}
						onMouseLeave={onMouseUp}
						onClick={onClick}
						style={{ cursor: dragging() ? "grabbing" : "grab" }}
					/>
				</Show>
			</div>
		</div>
	);
}

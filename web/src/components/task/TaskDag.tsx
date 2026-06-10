import {
    createEffect,
    createMemo,
    createResource,
    createSignal,
    onCleanup,
    onMount,
    Show,
} from "solid-js";
import { getAllTasks, getDag } from "../../apis/taskApi.ts";
import type { DagEdge, DagNode, Task } from "../../apis/types/index.ts";
import { getErrorMessage } from "../../apis/types/index.ts";
import styles from "./TaskDag.module.css";

// ==================== 布局引擎（纯函数，无外部依赖） ====================

/** 带布局坐标的节点 */
interface LayoutNode {
    id: number;
    title: string;
    status: string;
    x: number;
    y: number;
}

/** 带源/目标坐标的边 */
interface LayoutEdge {
    from: number;
    to: number;
    x1: number;
    y1: number;
    x2: number;
    y2: number;
}

/** 拓扑排序 + 分层，返回节点坐标和边 */
function layout(
    nodes: readonly DagNode[],
    edges: readonly DagEdge[],
): { nodes: LayoutNode[]; edges: LayoutEdge[] } {
    const nodeMap = new Map<number, DagNode>();
    for (const n of nodes) nodeMap.set(n.id, n);

    // 构建邻接表和入度
    const adj = new Map<number, number[]>(); // from → [to, ...]
    const inDeg = new Map<number, number>();
    for (const n of nodes) {
        adj.set(n.id, []);
        inDeg.set(n.id, 0);
    }
    for (const e of edges) {
        const list = adj.get(e.from) || [];
        list.push(e.to);
        adj.set(e.from, list);
        inDeg.set(e.to, (inDeg.get(e.to) || 0) + 1);
    }

    // 入度为 0 的作为第一层
    const layers: number[][] = [];
    let queue: number[] = [];
    for (const [id, deg] of inDeg) {
        if (deg === 0) queue.push(id);
    }

    while (queue.length > 0) {
        layers.push([...queue]);
        const next: number[] = [];
        for (const id of queue) {
            for (const to of adj.get(id) || []) {
                const d = (inDeg.get(to) || 1) - 1;
                inDeg.set(to, d);
                if (d === 0) next.push(to);
            }
        }
        queue = next;
    }

    // 处理孤立节点：放入最后一层
    const placed = new Set(layers.flat());
    const orphans: number[] = [];
    for (const n of nodes) {
        if (!placed.has(n.id)) orphans.push(n.id);
    }
    if (orphans.length > 0) layers.push(orphans);

    // 计算坐标
    const layerGap = 280; // 层间距
    const nodeGap = 60; // 同层节点间距
    const marginX = 140;
    const marginY = 50;

    const positions = new Map<number, { x: number; y: number }>();
    for (let li = 0; li < layers.length; li++) {
        const layer = layers[li];
        const totalHeight = (layer.length - 1) * nodeGap;
        const startY = marginY + (li % 2 === 0 ? 0 : nodeGap / 2); // 交错排列
        for (let ni = 0; ni < layer.length; ni++) {
            const y = startY + ni * nodeGap - totalHeight / 2;
            positions.set(layer[ni], {
                x: marginX + li * layerGap,
                y: y + 200, // 垂直居中偏移
            });
        }
    }

    // 生成布局节点和边
    const layoutNodes: LayoutNode[] = nodes.map((n) => {
        const pos = positions.get(n.id) || { x: marginX, y: 200 };
        return {
            id: n.id,
            title: n.title,
            status: n.status,
            x: pos.x,
            y: pos.y,
        };
    });

    const layoutEdges: LayoutEdge[] = edges
        .filter((e) => positions.has(e.from) && positions.has(e.to))
        .map((e) => {
            const f = positions.get(e.from);
            const t = positions.get(e.to);
            if (!f || !t) return null;
            return {
                from: e.from,
                to: e.to,
                x1: f.x,
                y1: f.y,
                x2: t.x,
                y2: t.y,
            };
        }).filter(Boolean) as LayoutEdge[];

    return { nodes: layoutNodes, edges: layoutEdges };
}

// ==================== 状态颜色 ====================

const _cssCache = new Map<string, string>();

function readCSSVar(name: string): string {
    const cached = _cssCache.get(name);
    if (cached !== undefined) return cached;
    const style = getComputedStyle(document.documentElement);
    const val = style.getPropertyValue(name).trim();
    _cssCache.set(name, val);
    return val;
}

const STATUS_COLORS: Record<string, string> = {
    backlog: "var(--color-text-muted)",
    active: "var(--color-accent)",
    completed: "var(--color-success)",
    archived: "var(--color-text-secondary)",
};

function statusColor(s: string): string {
    const v = STATUS_COLORS[s];
    if (!v) return readCSSVar("--color-text-muted");
    return v.startsWith("var(") ? readCSSVar(v.slice(4, -1)) : v;
}

// ==================== Canvas 渲染 ====================

function drawGraph(
    ctx: CanvasRenderingContext2D,
    lay: { nodes: LayoutNode[]; edges: LayoutEdge[] },
    scale: number,
    offsetX: number,
    offsetY: number,
    hoveredId: number | null,
) {
    const w = ctx.canvas.width;
    const h = ctx.canvas.height;
    ctx.clearRect(0, 0, w, h);
    ctx.save();
    ctx.translate(offsetX, offsetY);
    ctx.scale(scale, scale);

    // 边
    for (const e of lay.edges) {
        const dx = e.x2 - e.x1;
        const dy = e.y2 - e.y1;
        const len = Math.sqrt(dx * dx + dy * dy);
        if (len === 0) continue;

        ctx.beginPath();
        ctx.moveTo(e.x1, e.y1);
        ctx.lineTo(e.x2 - (dx / len) * 32, e.y2 - (dy / len) * 32); // 不压到节点中心
        ctx.strokeStyle = readCSSVar("--color-border");
        ctx.lineWidth = 2;
        ctx.stroke();

        // 箭头
        const angle = Math.atan2(dy, dx);
        const arrowLen = 8;
        const ax = e.x2 - (dx / len) * 32;
        const ay = e.y2 - (dy / len) * 32;
        ctx.beginPath();
        ctx.moveTo(ax, ay);
        ctx.lineTo(
            ax - arrowLen * Math.cos(angle - Math.PI / 6),
            ay - arrowLen * Math.sin(angle - Math.PI / 6),
        );
        ctx.lineTo(
            ax - arrowLen * Math.cos(angle + Math.PI / 6),
            ay - arrowLen * Math.sin(angle + Math.PI / 6),
        );
        ctx.closePath();
        ctx.fillStyle = readCSSVar("--color-border");
        ctx.fill();
    }

    // 节点
    for (const n of lay.nodes) {
        const r = 28;
        const isHovered = hoveredId === n.id;

        // 阴影
        ctx.beginPath();
        ctx.arc(n.x, n.y, r, 0, Math.PI * 2);
        ctx.fillStyle = isHovered
            ? "oklch(0 0 0 / 0.15)"
            : "oklch(0 0 0 / 0.08)";
        ctx.fill();

        // 圆
        ctx.beginPath();
        ctx.arc(n.x, n.y, r - 2, 0, Math.PI * 2);
        ctx.fillStyle = statusColor(n.status);
        ctx.fill();
        ctx.strokeStyle = isHovered
            ? readCSSVar("--color-text")
            : readCSSVar("--color-white");
        ctx.lineWidth = 2;
        ctx.stroke();

        // 文字
        const text = n.title.length > 6 ? `${n.title.slice(0, 5)}…` : n.title;
        ctx.fillStyle = readCSSVar("--color-white");
        ctx.font = `${isHovered ? "bold " : ""}10px sans-serif`;
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText(text, n.x, n.y);

        // hover 时显示完整标题
        if (isHovered) {
            ctx.fillStyle = readCSSVar("--color-text");
            ctx.font = "12px sans-serif";
            ctx.fillText(n.title, n.x, n.y - r - 12);
        }
    }

    // 图例
    ctx.restore();
    ctx.fillStyle = readCSSVar("--color-text-secondary");
    ctx.font = "11px sans-serif";
    ctx.textAlign = "left";
    ctx.fillText("● 待办", 12, 20);
    ctx.fillStyle = statusColor("active");
    ctx.fillText("●", 12, 20);
    ctx.fillStyle = readCSSVar("--color-text-secondary");
    ctx.fillText("● 进行中", 24, 20);
    ctx.fillStyle = statusColor("active");
    ctx.fillText("●", 24, 20);
    ctx.fillStyle = readCSSVar("--color-text-secondary");
    ctx.fillText("● 已完成", 76, 20);
    ctx.fillStyle = statusColor("completed");
    ctx.fillText("●", 76, 20);
    ctx.fillStyle = readCSSVar("--color-text-secondary");
    ctx.textAlign = "left";
}

// ==================== 组件 ====================

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
                <option value={t.id}>
                    {t.title}
                </option>
            ))}
        </select>
    );
}

export default function TaskDag() {
    const [taskFilter, setTaskFilter] = createSignal<number | undefined>();
    const [depth, setDepth] = createSignal(3);

    // 拉取 DAG 数据
    const [dagData] = createResource(
        () => ({ taskId: taskFilter(), depth: depth() }),
        async ({ taskId, depth: d }) => {
            try {
                return await getDag(taskId, d);
            } catch (e) {
                console.error("获取依赖图失败:", getErrorMessage(e));
                return { nodes: [], edges: [] };
            }
        },
    );

    // 拉取所有任务（用于选择器）
    const [allTasks] = createResource(async () => {
        try {
            const r = await getAllTasks();
            return [...r.items];
        } catch {
            return [];
        }
    });

    // 布局计算
    const layoutData = createMemo(() => {
        const d = dagData();
        if (!d || d.nodes.length === 0) return null;
        return layout(d.nodes, d.edges);
    });

    // Canvas 渲染
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

        // 计算居中偏移
        const xs = lay.nodes.map((n) => n.x);
        const ys = lay.nodes.map((n) => n.y);
        const minX = Math.min(...xs, 0);
        const maxX = Math.max(...xs, 0);
        const minY = Math.min(...ys, 0);
        const maxY = Math.max(...ys, 0);
        const graphW = maxX - minX + 80;
        const graphH = maxY - minY + 80;
        const autoOffX = (rect.width - graphW * scale()) / 2 - minX * scale();
        const autoOffY = (rect.height - graphH * scale()) / 2 - minY * scale();

        drawGraph(
            ctx,
            lay,
            scale(),
            autoOffX + offset().x,
            autoOffY + offset().y,
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

    // 滚轮缩放
    const onWheel = (e: WheelEvent) => {
        e.preventDefault();
        setScale((s) => Math.max(0.3, Math.min(3, s - e.deltaY * 0.001)));
    };

    // 拖拽平移
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
            onCanvasHover(e);
        }
    };
    const onMouseUp = () => setDragging(false);

    // 点击检测节点
    const onClick = (e: MouseEvent) => {
        const canvas = canvasRef;
        const lay = layoutData();
        if (!canvas || !lay) return;

        const rect = canvas.getBoundingClientRect();
        const xs = lay.nodes.map((n) => n.x);
        const ys = lay.nodes.map((n) => n.y);
        const minX = Math.min(...xs, 0);
        const minY = Math.min(...ys, 0);
        const maxX = Math.max(...xs, 0);
        const maxY = Math.max(...ys, 0);
        const graphW = maxX - minX + 80;
        const graphH = maxY - minY + 80;
        const autoOffX = (rect.width - graphW * scale()) / 2 - minX * scale();
        const autoOffY = (rect.height - graphH * scale()) / 2 - minY * scale();

        const mx = (e.clientX - rect.left - autoOffX - offset().x) / scale();
        const my = (e.clientY - rect.top - autoOffY - offset().y) / scale();

        for (const n of lay.nodes) {
            const dx = mx - n.x;
            const dy = my - n.y;
            if (dx * dx + dy * dy < 28 * 28) {
                // 聚焦该节点
                setTaskFilter((prev) => prev === n.id ? undefined : n.id);
                return;
            }
        }
    };

    // hover 检测
    const onCanvasHover = (e: MouseEvent) => {
        const canvas = canvasRef;
        const lay = layoutData();
        if (!canvas || !lay) {
            setHoveredId(null);
            return;
        }

        const rect = canvas.getBoundingClientRect();
        const xs = lay.nodes.map((n) => n.x);
        const ys = lay.nodes.map((n) => n.y);
        const minX = Math.min(...xs, 0);
        const minY = Math.min(...ys, 0);
        const maxX = Math.max(...xs, 0);
        const maxY = Math.max(...ys, 0);
        const graphW = maxX - minX + 80;
        const graphH = maxY - minY + 80;
        const autoOffX = (rect.width - graphW * scale()) / 2 - minX * scale();
        const autoOffY = (rect.height - graphH * scale()) / 2 - minY * scale();

        const mx = (e.clientX - rect.left - autoOffX - offset().x) / scale();
        const my = (e.clientY - rect.top - autoOffY - offset().y) / scale();

        for (const n of lay.nodes) {
            const dx = mx - n.x;
            const dy = my - n.y;
            if (dx * dx + dy * dy < 28 * 28) {
                setHoveredId(n.id);
                return;
            }
        }
        setHoveredId(null);
    };

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
                        onChange={(e) =>
                            setDepth(Number(e.currentTarget.value))}
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

import { Effect } from "effect";
import {
    createEffect,
    createResource,
    createSignal,
    For,
    Show,
} from "solid-js";
import {
    createTimeWindow,
    deleteTimeWindow,
    getTimeWindows,
} from "../../apis/timeWindowApi.ts";
import {
    addTaskDependency,
    getTaskDetail,
    removeTaskDependency,
} from "../../apis/taskApi.ts";
import type {
    CreateTimeWindowRequest,
    Task,
    TimeWindow,
} from "../../apis/types/index.ts";
import { getErrorMessage } from "../../apis/types/index.ts";
import styles from "./EditTaskModal.module.css";
import Modal from "../ui/Modal.tsx";

interface EditTaskModalProps {
    isOpen: boolean;
    onClose: () => void;
    task: Task | null;
    allTasks: Task[];
    onSave: (taskId: number, updates: Partial<Task>) => void;
    onDependencyChange?: () => void;
}

export default function EditTaskModal(props: EditTaskModalProps) {
    // ── 基本信息 ──
    const [title, setTitle] = createSignal("");
    const [description, setDescription] = createSignal("");
    const [status, setStatus] = createSignal("backlog");
    const [effort, setEffort] = createSignal<number | undefined>();
    const [parentTaskId, setParentTaskId] = createSignal<number | undefined>();

    // ── 时间段 ──
    const [feasibleWindows, setFeasibleWindows] = createSignal<TimeWindow[]>(
        [],
    );
    const [plannedWindows, setPlannedWindows] = createSignal<TimeWindow[]>([]);
    // 新增时间段的各字段
    const [newStartDate, setNewStartDate] = createSignal("");
    const [newStartTime, setNewStartTime] = createSignal("09:00");
    const [newEndDate, setNewEndDate] = createSignal("");
    const [newEndTime, setNewEndTime] = createSignal("10:00");
    const [newWindowType, setNewWindowType] = createSignal<
        "feasible" | "planned"
    >("feasible");
    // 快捷预设
    const presetTimeSlots = [
        { label: "今天 9-11", startT: "09:00", endT: "11:00" },
        { label: "今天 14-16", startT: "14:00", endT: "16:00" },
        { label: "今天 19-21", startT: "19:00", endT: "21:00" },
        { label: "明天 9-11", startT: "09:00", endT: "11:00", dayOffset: 1 },
        { label: "明天 14-16", startT: "14:00", endT: "16:00", dayOffset: 1 },
    ];

    // ── 依赖关系 ──
    const [depIds, setDepIds] = createSignal<number[]>([]);
    const [depTasks, setDepTasks] = createSignal<Task[]>([]);
    const [newDepId, setNewDepId] = createSignal<number | undefined>();
    const [depError, setDepError] = createSignal("");

    // ── Tab 切换 ──
    const [activeTab, setActiveTab] = createSignal<"basic" | "time" | "deps">(
        "basic",
    );

    // 加载详情（含依赖）
    const [detail] = createResource(
        () => (props.isOpen && props.task?.id ? props.task.id : null),
        async (taskId: number) => {
            try {
                const d = await Effect.runPromise(getTaskDetail(taskId));
                return d;
            } catch {
                return null;
            }
        },
    );

    // 加载时间窗口
    const loadTimeWindows = async (taskId: number) => {
        try {
            const [feasible, planned] = await Promise.all([
                Effect.runPromise(getTimeWindows(taskId, "feasible")),
                Effect.runPromise(getTimeWindows(taskId, "planned")),
            ]);
            setFeasibleWindows([...feasible]);
            setPlannedWindows([...planned]);
        } catch (e) {
            console.error("加载时间窗口失败:", getErrorMessage(e));
        }
    };

    // 同步依赖
    createEffect(() => {
        const d = detail();
        if (d) {
            setDepIds([...d.depends_on]);
            // 从 allTasks 查找完整 task 对象
            const found = d.depends_on
                .map((id) => props.allTasks.find((t) => t.id === id))
                .filter((t): t is Task => !!t);
            setDepTasks(found);
        }
    });

    // 当任务变化 / 弹窗打开时初始化表单
    createEffect(() => {
        if (props.isOpen && props.task) {
            setTitle(props.task.title);
            setDescription(props.task.description || "");
            setStatus(props.task.status || "backlog");
            setEffort(props.task.effort_estimate_minutes ?? undefined);
            setParentTaskId(props.task.parent_task_id ?? undefined);
            loadTimeWindows(props.task.id);
            // 预填日期为今天
            const today = new Date().toISOString().slice(0, 10);
            setNewStartDate(today);
            setNewEndDate(today);
            setNewDepId(undefined);
            setDepError("");
        }
    });

    // ── 保存基本信息 ──
    const handleSave = (e: Event) => {
        e.preventDefault();
        if (!props.task) return;
        props.onSave(props.task.id, {
            title: title(),
            description: description() || null,
            status: status(),
            effort_estimate_minutes: effort() ?? null,
            parent_task_id: parentTaskId() ?? null,
        });
        props.onClose();
    };

    // ── 时间段操作 ──
    const handleAddTimeWindow = async () => {
        if (!props.task || !newStartDate() || !newEndDate()) return;

        const startISO = `${newStartDate()}T${newStartTime()}:00`;
        const endISO = `${newEndDate()}T${newEndTime()}:00`;
        if (startISO >= endISO) {
            setDepError("结束时间必须晚于开始时间");
            return;
        }
        setDepError("");

        const req: CreateTimeWindowRequest = {
            start_time: new Date(startISO).toISOString(),
            end_time: new Date(endISO).toISOString(),
            window_type: newWindowType(),
            task_id: props.task.id,
        };
        try {
            const tw = await Effect.runPromise(createTimeWindow(req));
            if (tw.window_type === "feasible") {
                setFeasibleWindows([...feasibleWindows(), tw]);
            } else {
                setPlannedWindows([...plannedWindows(), tw]);
            }
        } catch (e) {
            const msg = getErrorMessage(e);
            setDepError(
                msg.includes("planned_outside")
                    ? "计划时间必须在可进行时间窗口内"
                    : msg.includes("slot_overlap")
                    ? "时间段与现有时间段重叠"
                    : `创建失败: ${msg}`,
            );
        }
    };

    const handleDeleteTimeWindow = async (id: number, type: string) => {
        try {
            await Effect.runPromise(deleteTimeWindow(id));
            if (type === "feasible") {
                setFeasibleWindows(
                    feasibleWindows().filter((w) => w.id !== id),
                );
            } else {
                setPlannedWindows(plannedWindows().filter((w) => w.id !== id));
            }
        } catch (e) {
            console.error("删除时间窗口失败:", getErrorMessage(e));
        }
    };

    const applyPreset = (preset: typeof presetTimeSlots[0]) => {
        const d = new Date();
        if (preset.dayOffset) d.setDate(d.getDate() + preset.dayOffset);
        const dateStr = d.toISOString().slice(0, 10);
        setNewStartDate(dateStr);
        setNewEndDate(dateStr);
        setNewStartTime(preset.startT);
        setNewEndTime(preset.endT);
    };

    // ── 依赖操作 ──
    const handleAddDependency = async () => {
        const depId = newDepId();
        if (!props.task || !depId) return;
        if (depIds().includes(depId)) {
            setDepError("该依赖已存在");
            return;
        }
        setDepError("");
        try {
            await Effect.runPromise(addTaskDependency(props.task.id, depId));
            const depTask = props.allTasks.find((t) => t.id === depId);
            setDepIds([...depIds(), depId]);
            if (depTask) setDepTasks([...depTasks(), depTask]);
            setNewDepId(undefined);
            props.onDependencyChange?.();
        } catch (e) {
            const msg = getErrorMessage(e);
            setDepError(
                msg.includes("Circular")
                    ? "不能形成循环依赖"
                    : msg.includes("self")
                    ? "不能依赖自己"
                    : `添加失败: ${msg}`,
            );
        }
    };

    const handleRemoveDependency = async (depId: number) => {
        if (!props.task) return;
        try {
            await Effect.runPromise(removeTaskDependency(props.task.id, depId));
            setDepIds(depIds().filter((id) => id !== depId));
            setDepTasks(depTasks().filter((t) => t.id !== depId));
            props.onDependencyChange?.();
        } catch (e) {
            console.error("删除依赖失败:", getErrorMessage(e));
        }
    };

    // ── 可选依赖任务列表（排除自身和已有依赖） ──
    const availableDepTasks = () =>
        props.allTasks.filter(
            (t) => t.id !== props.task?.id && !depIds().includes(t.id),
        );

    const formatDateTime = (iso: string) => {
        const d = new Date(iso);
        return `${d.getMonth() + 1}/${d.getDate()} ${
            String(d.getHours()).padStart(2, "0")
        }:${String(d.getMinutes()).padStart(2, "0")}`;
    };

    return (
        <Modal
            isOpen={props.isOpen}
            onClose={props.onClose}
            title={`编辑任务：${props.task?.title ?? ""}`}
            actions={
                <>
                    <button
                        type="button"
                        onClick={props.onClose}
                        class={styles.cancelBtn}
                    >
                        取消
                    </button>
                    <button
                        type="button"
                        onClick={handleSave}
                        class={styles.saveBtn}
                    >
                        保存
                    </button>
                </>
            }
        >
            <div class={styles.editModal}>
                {/* Tab 栏 */}
                <div class={styles.tabBar}>
                    <button
                        type="button"
                        class={`${styles.tab} ${
                            activeTab() === "basic" ? styles.tabActive : ""
                        }`}
                        onClick={() => setActiveTab("basic")}
                    >
                        基本信息
                    </button>
                    <button
                        type="button"
                        class={`${styles.tab} ${
                            activeTab() === "time" ? styles.tabActive : ""
                        }`}
                        onClick={() => setActiveTab("time")}
                    >
                        时间段
                        <Show
                            when={feasibleWindows().length +
                                    plannedWindows().length > 0}
                        >
                            <span class={styles.tabCount}>
                                {feasibleWindows().length +
                                    plannedWindows().length}
                            </span>
                        </Show>
                    </button>
                    <button
                        type="button"
                        class={`${styles.tab} ${
                            activeTab() === "deps" ? styles.tabActive : ""
                        }`}
                        onClick={() => setActiveTab("deps")}
                    >
                        依赖关系
                        <Show when={depIds().length > 0}>
                            <span class={styles.tabCount}>
                                {depIds().length}
                            </span>
                        </Show>
                    </button>
                </div>

                {/* 基本信息 Tab */}
                <Show when={activeTab() === "basic"}>
                    <div class={styles.tabContent}>
                        <div class={styles.field}>
                            <label class={styles.fieldLabel} for="task-title">
                                标题 *
                            </label>
                            <input
                                id="task-title"
                                type="text"
                                value={title()}
                                onInput={(e) => setTitle(e.currentTarget.value)}
                                class={styles.fieldInput}
                                required
                                placeholder="输入任务标题"
                            />
                        </div>

                        <div class={styles.field}>
                            <label class={styles.fieldLabel} for="task-desc">
                                描述
                            </label>
                            <textarea
                                id="task-desc"
                                value={description()}
                                onInput={(e) =>
                                    setDescription(e.currentTarget.value)}
                                class={styles.fieldTextarea}
                                placeholder="输入任务描述"
                                rows={3}
                            />
                        </div>

                        <div class={styles.fieldRow}>
                            <div class={styles.field}>
                                <label
                                    class={styles.fieldLabel}
                                    for="task-status"
                                >
                                    状态
                                </label>
                                <select
                                    id="task-status"
                                    value={status()}
                                    onChange={(e) =>
                                        setStatus(e.currentTarget.value)}
                                    class={styles.fieldInput}
                                >
                                    <option value="backlog">待办</option>
                                    <option value="active">进行中</option>
                                    <option value="completed">已完成</option>
                                    <option value="archived">归档</option>
                                </select>
                            </div>

                            <div class={styles.field}>
                                <label
                                    class={styles.fieldLabel}
                                    for="task-effort"
                                >
                                    预计工时（分钟）
                                </label>
                                <input
                                    id="task-effort"
                                    type="number"
                                    value={effort() ?? ""}
                                    onInput={(e) =>
                                        setEffort(
                                            e.currentTarget.value
                                                ? parseInt(
                                                    e.currentTarget.value,
                                                    10,
                                                )
                                                : undefined,
                                        )}
                                    class={styles.fieldInput}
                                    min="0"
                                    placeholder="可选"
                                />
                            </div>
                        </div>

                        <div class={styles.field}>
                            <label class={styles.fieldLabel} for="task-parent">
                                父任务
                            </label>
                            <select
                                id="task-parent"
                                value={parentTaskId() ?? ""}
                                onChange={(e) =>
                                    setParentTaskId(
                                        e.currentTarget.value
                                            ? parseInt(
                                                e.currentTarget.value,
                                                10,
                                            )
                                            : undefined,
                                    )}
                                class={styles.fieldInput}
                            >
                                <option value="">无</option>
                                <For
                                    each={props.allTasks.filter((t) =>
                                        t.id !== props.task?.id
                                    )}
                                >
                                    {(t) => (
                                        <option value={t.id}>{t.title}</option>
                                    )}
                                </For>
                            </select>
                        </div>
                    </div>
                </Show>

                {/* 时间段 Tab */}
                <Show when={activeTab() === "time"}>
                    <div class={styles.tabContent}>
                        {/* 快捷预设 */}
                        <div class={styles.presets}>
                            <span class={styles.presetsLabel}>快捷：</span>
                            <For each={presetTimeSlots}>
                                {(p) => (
                                    <button
                                        type="button"
                                        class={styles.presetBtn}
                                        onClick={() => applyPreset(p)}
                                    >
                                        {p.label}
                                    </button>
                                )}
                            </For>
                        </div>

                        {/* 添加新时间段 */}
                        <div class={styles.addTimeBlock}>
                            <div class={styles.fieldRow}>
                                <div class={styles.field}>
                                    <label
                                        class={styles.fieldLabel}
                                        for="tw-type"
                                    >
                                        类型
                                    </label>
                                    <select
                                        id="tw-type"
                                        value={newWindowType()}
                                        onChange={(e) =>
                                            setNewWindowType(
                                                e.currentTarget.value as
                                                    | "feasible"
                                                    | "planned",
                                            )}
                                        class={styles.fieldInput}
                                    >
                                        <option value="feasible">
                                            🟢 可进行
                                        </option>
                                        <option value="planned">🔵 计划</option>
                                    </select>
                                </div>
                            </div>
                            <div class={styles.fieldRow}>
                                <div class={styles.field}>
                                    <label
                                        class={styles.fieldLabel}
                                        for="tw-start-date"
                                    >
                                        开始日期
                                    </label>
                                    <input
                                        id="tw-start-date"
                                        type="date"
                                        value={newStartDate()}
                                        onInput={(e) => setNewStartDate(
                                            e.currentTarget.value,
                                        )}
                                        class={styles.fieldInput}
                                    />
                                </div>
                                <div class={styles.field}>
                                    <label
                                        class={styles.fieldLabel}
                                        for="tw-start-time"
                                    >
                                        开始时间
                                    </label>
                                    <input
                                        id="tw-start-time"
                                        type="time"
                                        value={newStartTime()}
                                        onInput={(e) =>
                                            setNewStartTime(
                                                e.currentTarget.value,
                                            )}
                                        class={styles.fieldInput}
                                    />
                                </div>
                            </div>
                            <div class={styles.fieldRow}>
                                <div class={styles.field}>
                                    <label
                                        class={styles.fieldLabel}
                                        for="tw-end-date"
                                    >
                                        结束日期
                                    </label>
                                    <input
                                        id="tw-end-date"
                                        type="date"
                                        value={newEndDate()}
                                        onInput={(e) =>
                                            setNewEndDate(
                                                e.currentTarget.value,
                                            )}
                                        class={styles.fieldInput}
                                    />
                                </div>
                                <div class={styles.field}>
                                    <label
                                        class={styles.fieldLabel}
                                        for="tw-end-time"
                                    >
                                        结束时间
                                    </label>
                                    <input
                                        id="tw-end-time"
                                        type="time"
                                        value={newEndTime()}
                                        onInput={(e) =>
                                            setNewEndTime(
                                                e.currentTarget.value,
                                            )}
                                        class={styles.fieldInput}
                                    />
                                </div>
                            </div>
                            <button
                                type="button"
                                onClick={handleAddTimeWindow}
                                disabled={!newStartDate() || !newEndDate()}
                                class={styles.addBtn}
                            >
                                + 添加时间段
                            </button>
                            <Show when={depError()}>
                                <div class={styles.errorMsg}>{depError()}</div>
                            </Show>
                        </div>

                        {/* 已有可进行时间段 */}
                        <div class={styles.sectionHeader}>
                            <span class={styles.sectionTitle}>
                                可进行时间段
                            </span>
                            <span class={styles.sectionHint}>
                                （在此时间段内才能安排任务）
                            </span>
                        </div>
                        <Show
                            when={feasibleWindows().length > 0}
                            fallback={<div class={styles.emptyMsg}>未设置</div>}
                        >
                            <div class={styles.timeList}>
                                <For each={feasibleWindows()}>
                                    {(tw) => (
                                        <div class={styles.timeItem}>
                                            <span class={styles.timeItemText}>
                                                🟢{" "}
                                                {formatDateTime(tw.start_time)}
                                                {" "}
                                                ~ {formatDateTime(tw.end_time)}
                                            </span>
                                            <button
                                                type="button"
                                                onClick={() =>
                                                    handleDeleteTimeWindow(
                                                        tw.id,
                                                        "feasible",
                                                    )}
                                                class={styles.timeDelete}
                                            >
                                                ×
                                            </button>
                                        </div>
                                    )}
                                </For>
                            </div>
                        </Show>

                        {/* 已有计划时间段 */}
                        <div
                            class={styles.sectionHeader}
                            style={{ "margin-top": "16px" }}
                        >
                            <span class={styles.sectionTitle}>计划时间段</span>
                            <span class={styles.sectionHint}>
                                （必须在可进行时间窗口内）
                            </span>
                        </div>
                        <Show
                            when={plannedWindows().length > 0}
                            fallback={<div class={styles.emptyMsg}>未设置</div>}
                        >
                            <div class={styles.timeList}>
                                <For each={plannedWindows()}>
                                    {(tw) => (
                                        <div class={styles.timeItem}>
                                            <span class={styles.timeItemText}>
                                                🔵{" "}
                                                {formatDateTime(tw.start_time)}
                                                {" "}
                                                ~ {formatDateTime(tw.end_time)}
                                            </span>
                                            <button
                                                type="button"
                                                onClick={() =>
                                                    handleDeleteTimeWindow(
                                                        tw.id,
                                                        "planned",
                                                    )}
                                                class={styles.timeDelete}
                                            >
                                                ×
                                            </button>
                                        </div>
                                    )}
                                </For>
                            </div>
                        </Show>
                    </div>
                </Show>

                {/* 依赖关系 Tab */}
                <Show when={activeTab() === "deps"}>
                    <div class={styles.tabContent}>
                        {/* 已有依赖 */}
                        <div class={styles.sectionHeader}>
                            <span class={styles.sectionTitle}>当前依赖</span>
                            <span class={styles.sectionHint}>
                                （本任务依赖以下任务完成）
                            </span>
                        </div>
                        <Show
                            when={depTasks().length > 0}
                            fallback={
                                <div class={styles.emptyMsg}>暂无依赖关系</div>
                            }
                        >
                            <div class={styles.depList}>
                                <For each={depTasks()}>
                                    {(t) => (
                                        <div class={styles.depItem}>
                                            <div class={styles.depInfo}>
                                                <span class={styles.depTitle}>
                                                    {t.title}
                                                </span>
                                                <span
                                                    class={`${styles.depStatus} ${
                                                        styles[
                                                            `depStatus_${
                                                                t.status ||
                                                                "backlog"
                                                            }`
                                                        ]
                                                    }`}
                                                >
                                                    {t.status || "backlog"}
                                                </span>
                                            </div>
                                            <button
                                                type="button"
                                                onClick={() =>
                                                    handleRemoveDependency(
                                                        t.id,
                                                    )}
                                                class={styles.depRemove}
                                                title="移除依赖"
                                            >
                                                ×
                                            </button>
                                        </div>
                                    )}
                                </For>
                            </div>
                        </Show>

                        {/* 添加依赖 */}
                        <div class={styles.addDepBlock}>
                            <div class={styles.sectionHeader}>
                                <span class={styles.sectionTitle}>
                                    添加依赖
                                </span>
                            </div>
                            <div class={styles.addDepRow}>
                                <select
                                    value={newDepId() ?? ""}
                                    onChange={(e) => {
                                        setNewDepId(
                                            e.currentTarget.value
                                                ? parseInt(
                                                    e.currentTarget.value,
                                                    10,
                                                )
                                                : undefined,
                                        );
                                        setDepError("");
                                    }}
                                    class={styles.fieldInput}
                                >
                                    <option value="">
                                        选择要依赖的任务...
                                    </option>
                                    <For each={availableDepTasks()}>
                                        {(t) => (
                                            <option value={t.id}>
                                                [{t.status || "backlog"}]{" "}
                                                {t.title}
                                            </option>
                                        )}
                                    </For>
                                </select>
                                <button
                                    type="button"
                                    onClick={handleAddDependency}
                                    disabled={!newDepId()}
                                    class={styles.addBtn}
                                >
                                    + 添加
                                </button>
                            </div>
                            <Show when={depError()}>
                                <div class={styles.errorMsg}>{depError()}</div>
                            </Show>
                        </div>
                    </div>
                </Show>
            </div>
        </Modal>
    );
}

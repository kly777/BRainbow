import { createSignal, For, Show } from "solid-js";
import type { Task, TimeWindow } from "../../apis/types/index.ts";
import { formatDate } from "../../apis/types/index.ts";
import styles from "./TaskList.module.css";

const TaskStatus = {
    BACKLOG: "backlog",
    ACTIVE: "active",
    COMPLETED: "completed",
    ARCHIVED: "archived",
} as const;

interface TaskItemProps {
    task: Task;
    onStatusChange: (taskId: number, status: string) => void;
    onDelete: (taskId: number) => void;
    onEdit: () => void;
    children: Task[];
    onAddSubTask?: (parentId: number, title: string) => Promise<void>;
    feasibleWindows?: TimeWindow[];
    plannedWindows?: TimeWindow[];
}

function TaskItem(props: TaskItemProps) {
    const [showSubTaskInput, setShowSubTaskInput] = createSignal(false);
    const [subTaskTitle, setSubTaskTitle] = createSignal("");

    return (
        <div class={styles.taskItem}>
            <div class={styles.taskRow}>
                <div class={styles.taskMain}>
                    <h3 class={styles.taskTitle}>
                        {props.task.title}
                        <Show when={props.task.parent_task_id}>
                            <span class={styles.subTaskBadge}>子任务</span>
                        </Show>
                    </h3>
                    <Show when={props.task.description}>
                        <p class={styles.taskDescription}>
                            {props.task.description}
                        </p>
                    </Show>
                    <div class={styles.taskMeta}>
                        <Show when={props.task.created_at}>
                            <span class={styles.dateBadge}>
                                📅 {formatDate(props.task.created_at || "")}
                            </span>
                        </Show>
                    </div>
                    <Show
                        when={props.feasibleWindows &&
                            props.feasibleWindows.length > 0}
                    >
                        <div class={styles.timeWindowChips}>
                            <For each={props.feasibleWindows}>
                                {(tw) => (
                                    <span
                                        class={styles.timeWindowChip}
                                        title="可进行"
                                    >
                                        🟢{" "}
                                        {new Date(tw.start_time).toLocaleString(
                                            "zh-CN",
                                            {
                                                month: "2-digit",
                                                day: "2-digit",
                                                hour: "2-digit",
                                                minute: "2-digit",
                                            },
                                        )}
                                    </span>
                                )}
                            </For>
                        </div>
                    </Show>
                    <Show
                        when={props.plannedWindows &&
                            props.plannedWindows.length > 0}
                    >
                        <div class={styles.timeWindowChips}>
                            <For each={props.plannedWindows}>
                                {(tw) => (
                                    <span
                                        class={styles.timeWindowChip}
                                        title="计划"
                                    >
                                        🔵{" "}
                                        {new Date(tw.start_time).toLocaleString(
                                            "zh-CN",
                                            {
                                                month: "2-digit",
                                                day: "2-digit",
                                                hour: "2-digit",
                                                minute: "2-digit",
                                            },
                                        )}
                                    </span>
                                )}
                            </For>
                        </div>
                    </Show>
                </div>
                <div class={styles.taskActions}>
                    <select
                        value={props.task.status || TaskStatus.BACKLOG}
                        onChange={(e) =>
                            props.onStatusChange(
                                props.task.id || 0,
                                e.currentTarget.value,
                            )}
                        class={styles.statusSelect}
                    >
                        <option value={TaskStatus.BACKLOG}>待办</option>
                        <option value={TaskStatus.ACTIVE}>进行中</option>
                        <option value={TaskStatus.COMPLETED}>已完成</option>
                        <option value={TaskStatus.ARCHIVED}>归档</option>
                    </select>
                    <button
                        type="button"
                        onClick={props.onEdit}
                        class={styles.editButton}
                        title="编辑"
                    >
                        ✏️
                    </button>
                    <button
                        type="button"
                        onClick={() => props.onDelete(props.task.id || 0)}
                        class={styles.deleteButton}
                        title="删除"
                    >
                        🗑
                    </button>
                    <button
                        type="button"
                        onClick={() => setShowSubTaskInput(true)}
                        class={styles.subTaskButton}
                        title="添加子任务"
                    >
                        +
                    </button>
                </div>
            </div>
            {/* 子任务输入表单 */}
            <Show when={showSubTaskInput()}>
                <div class={styles.subTaskForm}>
                    <input
                        type="text"
                        placeholder="输入子任务标题，Enter 创建..."
                        value={subTaskTitle()}
                        onInput={(e) => setSubTaskTitle(e.currentTarget.value)}
                        onKeyDown={async (e) => {
                            if (e.key === "Enter" && subTaskTitle().trim()) {
                                e.preventDefault();
                                const title = subTaskTitle().trim();
                                setSubTaskTitle("");
                                setShowSubTaskInput(false);
                                if (props.onAddSubTask) {
                                    await props.onAddSubTask(
                                        props.task.id,
                                        title,
                                    );
                                }
                            }
                            if (e.key === "Escape") {
                                setShowSubTaskInput(false);
                                setSubTaskTitle("");
                            }
                        }}
                        class={styles.subTaskInput}
                        autofocus
                    />
                    <button
                        type="button"
                        onClick={() => {
                            setShowSubTaskInput(false);
                            setSubTaskTitle("");
                        }}
                        class={styles.subTaskCancel}
                    >
                        取消
                    </button>
                </div>
            </Show>
            {/* 子任务列表 */}
            <Show when={props.children.length > 0}>
                <div class={styles.childList}>
                    <For each={props.children}>
                        {(child) => (
                            <TaskItem
                                task={child}
                                onStatusChange={props.onStatusChange}
                                onDelete={props.onDelete}
                                onEdit={props.onEdit}
                                children={[]}
                                onAddSubTask={props.onAddSubTask}
                                feasibleWindows={[]}
                                plannedWindows={[]}
                            />
                        )}
                    </For>
                </div>
            </Show>
        </div>
    );
}

export default TaskItem;

import { createEffect, createSignal, Show } from "solid-js";
import Modal from "../../../components/ui/Modal.tsx";
import { notifyError } from "../../../lib/notify.ts";
import { tryAsync } from "../../../lib/result.ts";
import { getTimeWindowsE } from "../timeWindowApi.ts";
import type { Task, TimeWindow } from "../types.ts";
import BasicInfoTab from "./BasicInfoTab.tsx";
import DependenciesTab from "./DependenciesTab.tsx";
import * as styles from "./EditTaskModal.css.ts";
import TimeWindowsTab from "./TimeWindowsTab.tsx";

interface EditTaskModalProps {
	isOpen: boolean;
	onClose: () => void;
	task: Task | null;
	allTasks: Task[];
	onSave: (taskId: number, updates: Partial<Task>) => void;
	onDependencyChange?: () => void;
}

export default function EditTaskModal(props: EditTaskModalProps) {
	// ── Tab 切换 ──
	const [activeTab, setActiveTab] = createSignal<"basic" | "time" | "deps">(
		"basic",
	);

	// ── 基本信息 ──
	const [title, setTitle] = createSignal("");
	const [description, setDescription] = createSignal("");
	const [status, setStatus] = createSignal("backlog");
	const [effort, setEffort] = createSignal<number | undefined>();
	const [parentTaskId, setParentTaskId] = createSignal<number | undefined>();

	// ── 时间段 ──
	const [feasibleWindows, setFeasibleWindows] = createSignal<TimeWindow[]>([]);
	const [plannedWindows, setPlannedWindows] = createSignal<TimeWindow[]>([]);

	// 加载时间窗口
	const loadTimeWindows = async (taskId: number) => {
		const result = await tryAsync(() =>
			Promise.all([
				getTimeWindowsE(taskId, "feasible"),
				getTimeWindowsE(taskId, "planned"),
			]),
		);
		if (result.ok) {
			const [feasible, planned] = result.value;
			setFeasibleWindows([...feasible]);
			setPlannedWindows([...planned]);
		} else {
			notifyError("加载时间窗口失败", result.error);
		}
	};

	// 当任务变化 / 弹窗打开时初始化表单
	createEffect(() => {
		if (props.isOpen && props.task) {
			setTitle(props.task.title);
			setDescription(props.task.description || "");
			setStatus(props.task.status || "backlog");
			setEffort(props.task.effort_estimate_minutes ?? undefined);
			setParentTaskId(props.task.parent_task_id ?? undefined);
			loadTimeWindows(props.task.id);
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
					<button type="button" onClick={handleSave} class={styles.saveBtn}>
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
						classList={{
							[styles.tab]: true,
							[styles.tabActive]: activeTab() === "basic",
						}}
						onClick={() => setActiveTab("basic")}
					>
						基本信息
					</button>
					<button
						type="button"
						classList={{
							[styles.tab]: true,
							[styles.tabActive]: activeTab() === "time",
						}}
						onClick={() => setActiveTab("time")}
					>
						时间段
						<Show when={feasibleWindows().length + plannedWindows().length > 0}>
							<span class={styles.tabCount}>
								{feasibleWindows().length + plannedWindows().length}
							</span>
						</Show>
					</button>
					<button
						type="button"
						classList={{
							[styles.tab]: true,
							[styles.tabActive]: activeTab() === "deps",
						}}
						onClick={() => setActiveTab("deps")}
					>
						依赖关系
					</button>
				</div>

				{/* 基本信息 Tab */}
				<Show when={activeTab() === "basic"}>
					<BasicInfoTab
						title={title}
						setTitle={setTitle}
						description={description}
						setDescription={setDescription}
						status={status}
						setStatus={setStatus}
						effort={effort}
						setEffort={setEffort}
						parentTaskId={parentTaskId}
						setParentTaskId={setParentTaskId}
						allTasks={props.allTasks}
						currentTaskId={props.task?.id}
					/>
				</Show>

				{/* 时间段 Tab */}
				<Show when={activeTab() === "time"}>
					<TimeWindowsTab
						task={props.task!}
						feasibleWindows={feasibleWindows}
						setFeasibleWindows={setFeasibleWindows}
						plannedWindows={plannedWindows}
						setPlannedWindows={setPlannedWindows}
					/>
				</Show>

				{/* 依赖关系 Tab */}
				<Show when={activeTab() === "deps"}>
					<Show when={props.task}>
						{(task) => (
							<DependenciesTab
								task={task()}
								allTasks={props.allTasks}
								onDependencyChange={props.onDependencyChange}
							/>
						)}
					</Show>
				</Show>
			</div>
		</Modal>
	);
}

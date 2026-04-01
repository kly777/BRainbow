import {
	type Component,
	createEffect,
	createSignal,
	For,
	Show,
} from "solid-js";
import { taskApi } from "@/apis";
import type { Task } from "@/apis/types";
import styles from "@/styles/addSubTaskModal.module.css";
import Modal from "./Modal";

interface AddSubTaskModalProps {
	isOpen: boolean;
	onClose: () => void;
	onSuccess: () => void;
	taskId: number;
	currentSubTasks: readonly Task[];
}

const AddSubTaskModal: Component<AddSubTaskModalProps> = (props) => {
	const [availableTasks, setAvailableTasks] = createSignal<Task[]>([]);
	const [loading, setLoading] = createSignal(false);
	const [error, setError] = createSignal<string | null>(null);
	const [success, setSuccess] = createSignal<string | null>(null);
	const [selectedTaskId, setSelectedTaskId] = createSignal<number | null>(null);

	// 加载可用的任务
	const loadAvailableTasks = async () => {
		setLoading(true);
		setError(null);
		try {
			// 获取所有任务
			const allTasks = await taskApi.getTasks();

			// 过滤掉已经是当前任务的子任务的任务
			const currentSubTaskIds = new Set(
				props.currentSubTasks.map((task) => task.id),
			);
			const filteredTasks = allTasks.filter(
				(task) =>
					task.id !== props.taskId && // 不能添加自己作为子任务
					!currentSubTaskIds.has(task.id), // 不能重复添加已存在的子任务
			);

			setAvailableTasks(filteredTasks);
		} catch (err) {
			setError(err instanceof Error ? err.message : "加载任务列表失败");
		} finally {
			setLoading(false);
		}
	};

	// 当模态框打开时加载可用任务
	createEffect(() => {
		if (props.isOpen) {
			void loadAvailableTasks();
			// 重置状态
			setSelectedTaskId(null);
			setError(null);
			setSuccess(null);
		}
	});

	// 处理添加子任务
	const handleAddSubTask = async () => {
		const taskId = selectedTaskId();
		if (!taskId) {
			setError("请选择一个任务");
			return;
		}

		setLoading(true);
		setError(null);
		setSuccess(null);

		try {
			await taskApi.addSubTask(props.taskId, {
				sub_task_id: taskId,
			});

			setSuccess("成功添加子任务");

			// 延迟关闭模态框，让用户看到成功消息
			setTimeout(() => {
				props.onSuccess();
				props.onClose();
			}, 1500);
		} catch (err) {
			setError(err instanceof Error ? err.message : "添加子任务失败");
		} finally {
			setLoading(false);
		}
	};

	// 处理创建新任务作为子任务
	const handleCreateNewTask = () => {
		props.onClose();
		// 这里可以导航到创建任务页面，或者打开另一个模态框
		// 暂时先关闭当前模态框
	};

	return (
		<Modal
			isOpen={props.isOpen}
			onClose={props.onClose}
			title="添加子任务"
			actions={
				<>
					<button
						type="button"
						class={styles.secondaryButton}
						onClick={props.onClose}
						disabled={loading()}
					>
						取消
					</button>
					<button
						type="button"
						class={styles.secondaryButton}
						onClick={handleCreateNewTask}
						disabled={loading()}
					>
						创建新任务
					</button>
					<button
						type="button"
						class={styles.primaryButton}
						onClick={handleAddSubTask}
						disabled={loading() || !selectedTaskId()}
					>
						{loading() ? "添加中..." : "添加"}
					</button>
				</>
			}
		>
			<div class={styles.modalBodyContent}>
				<Show when={error()}>
					<div class={styles.errorMessage}>{error()}</div>
				</Show>

				<Show when={success()}>
					<div class={styles.successMessage}>{success()}</div>
				</Show>

				<Show when={loading() && !error() && !success()}>
					<div class={styles.loading}>加载中...</div>
				</Show>

				<Show when={!loading() && !error() && !success()}>
					<div class={styles.formGroup}>
						<label for="task-select" class={styles.formLabel}>
							选择要添加为子任务的任务：
						</label>
						<select
							id="task-select"
							class={styles.taskSelector}
							value={selectedTaskId() || ""}
							onChange={(e) =>
								setSelectedTaskId(parseInt(e.target.value, 10) || null)
							}
							disabled={availableTasks().length === 0}
						>
							<option value="">请选择任务</option>
							<For each={availableTasks()}>
								{(task) => (
									<option value={task.id} class={styles.taskOption}>
										{task.title} (ID: {task.id})
									</option>
								)}
							</For>
						</select>

						<Show when={availableTasks().length === 0}>
							<div class={styles.emptyList}>
								<p>没有可用的任务可以添加为子任务</p>
								<p>所有任务都已经是当前任务的子任务，或者没有其他任务</p>
							</div>
						</Show>
					</div>

					<div class={styles.infoBox}>
						<p>
							<strong>说明：</strong>
						</p>
						<ul>
							<li>子任务是当前任务的组成部分</li>
							<li>一个任务不能添加自己作为子任务</li>
							<li>不能重复添加已存在的子任务</li>
							<li>子任务可以有自己的子任务，形成任务树</li>
						</ul>
					</div>
				</Show>
			</div>
		</Modal>
	);
};

export default AddSubTaskModal;

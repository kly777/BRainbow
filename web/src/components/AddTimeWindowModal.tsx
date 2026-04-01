import {
	type Component,
	createEffect,
	createSignal,
	For,
	Show,
} from "solid-js";
import { taskApi } from "@/apis";
import type { TimeWindow } from "@/apis/types";
import styles from "@/styles/addTimeWindowModal.module.css";
import Modal from "./Modal";

interface AddTimeWindowModalProps {
	isOpen: boolean;
	onClose: () => void;
	onSuccess: () => void;
	taskId: number;
	currentTimeWindows: readonly TimeWindow[];
}

const AddTimeWindowModal: Component<AddTimeWindowModalProps> = (props) => {
	const [availableTimeWindows, setAvailableTimeWindows] = createSignal<
		TimeWindow[]
	>([]);
	const [loading, setLoading] = createSignal(false);
	const [error, setError] = createSignal<string | null>(null);
	const [success, setSuccess] = createSignal<string | null>(null);
	const [selectedTimeWindowId, setSelectedTimeWindowId] = createSignal<
		number | null
	>(null);
	const [allocationType, setAllocationType] = createSignal<number>(1); // 默认可进行时间

	// 加载可用的时间窗口
	const loadAvailableTimeWindows = async () => {
		setLoading(true);
		setError(null);
		try {
			// 获取所有时间窗口
			const allTimeWindows = await taskApi.getAllTimeWindows();

			// 过滤掉已经是当前任务时间窗口的时间窗口
			const currentTimeWindowIds = new Set(
				props.currentTimeWindows.map((tw) => tw.id),
			);
			const filteredTimeWindows = allTimeWindows.filter(
				(tw) => !currentTimeWindowIds.has(tw.id), // 不能重复添加已存在的时间窗口
			);

			setAvailableTimeWindows(filteredTimeWindows);
		} catch (err) {
			setError(err instanceof Error ? err.message : "加载时间窗口列表失败");
		} finally {
			setLoading(false);
		}
	};

	// 当模态框打开时加载可用时间窗口
	createEffect(() => {
		if (props.isOpen) {
			void loadAvailableTimeWindows();
			// 重置状态
			setSelectedTimeWindowId(null);
			setAllocationType(1);
			setError(null);
			setSuccess(null);
		}
	});

	// 处理添加时间窗口
	const handleAddTimeWindow = async () => {
		const timeWindowId = selectedTimeWindowId();
		if (!timeWindowId) {
			setError("请选择一个时间窗口");
			return;
		}

		setLoading(true);
		setError(null);
		setSuccess(null);

		try {
			await taskApi.addTimeWindow(props.taskId, {
				time_window_id: timeWindowId,
				allocation_type: allocationType(),
			});

			setSuccess("成功添加时间窗口");

			// 延迟关闭模态框，让用户看到成功消息
			setTimeout(() => {
				props.onSuccess();
				props.onClose();
			}, 1500);
		} catch (err) {
			setError(err instanceof Error ? err.message : "添加时间窗口失败");
		} finally {
			setLoading(false);
		}
	};

	// 处理创建新时间窗口
	const handleCreateNewTimeWindow = () => {
		props.onClose();
		// 这里可以导航到创建时间窗口页面，或者打开另一个模态框
		// 暂时先关闭当前模态框
	};

	// 格式化日期时间显示
	const formatDateTime = (dateTimeString: string): string => {
		try {
			const date = new Date(dateTimeString);
			return date.toLocaleString("zh-CN", {
				year: "numeric",
				month: "2-digit",
				day: "2-digit",
				hour: "2-digit",
				minute: "2-digit",
			});
		} catch {
			return dateTimeString;
		}
	};

	return (
		<Modal
			isOpen={props.isOpen}
			onClose={props.onClose}
			title="分配时间窗口"
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
						onClick={handleCreateNewTimeWindow}
						disabled={loading()}
					>
						创建新时间窗口
					</button>
					<button
						type="button"
						class={styles.primaryButton}
						onClick={handleAddTimeWindow}
						disabled={loading() || !selectedTimeWindowId()}
					>
						{loading() ? "分配中..." : "分配"}
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
						<label for="time-window-select" class={styles.formLabel}>
							选择时间窗口：
						</label>
						<select
							id="time-window-select"
							class={styles.timeWindowSelector}
							value={selectedTimeWindowId() || ""}
							onChange={(e) =>
								setSelectedTimeWindowId(parseInt(e.target.value, 10) || null)
							}
							disabled={availableTimeWindows().length === 0}
						>
							<option value="">请选择时间窗口</option>
							<For each={availableTimeWindows()}>
								{(timeWindow) => (
									<option value={timeWindow.id} class={styles.timeWindowOption}>
										{formatDateTime(timeWindow.starts_at)} -{" "}
										{formatDateTime(timeWindow.ends_at)}
									</option>
								)}
							</For>
						</select>

						<Show when={availableTimeWindows().length === 0}>
							<div class={styles.emptyList}>
								<p>没有可用的时间窗口可以分配</p>
								<p>所有时间窗口都已经分配给当前任务，或者没有时间窗口</p>
							</div>
						</Show>
					</div>

					<div class={styles.formGroup}>
						<label for="allocation-type-select" class={styles.formLabel}>
							分配类型：
						</label>
						<select
							id="allocation-type-select"
							class={styles.allocationTypeSelector}
							value={allocationType()}
							onChange={(e) => setAllocationType(parseInt(e.target.value, 10))}
						>
							<option value={1}>可进行时间（任务可以在该时间段内执行）</option>
							<option value={2}>计划进行时间（计划在该时间段内执行）</option>
							<option value={3}>实际执行时间（实际在该时间段内执行）</option>
						</select>
					</div>

					<div class={styles.infoBox}>
						<p>
							<strong>说明：</strong>
						</p>
						<ul>
							<li>
								<strong>可进行时间</strong>
								：任务可以在该时间段内执行（客观属性）
							</li>
							<li>
								<strong>计划进行时间</strong>：计划在该时间段内执行（主观规划）
							</li>
							<li>
								<strong>实际执行时间</strong>：实际在该时间段内执行（执行记录）
							</li>
							<li>一个任务可以有多个不同类型的时间窗口</li>
							<li>不能重复添加已存在的时间窗口</li>
						</ul>
					</div>
				</Show>
			</div>
		</Modal>
	);
};

export default AddTimeWindowModal;

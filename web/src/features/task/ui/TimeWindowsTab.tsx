import { createSignal, For, Show } from "solid-js";
import type {
	CreateTimeWindowRequest,
	Task,
	TimeWindow,
} from "../../../apis/types/index.ts";
import { getErrorMessage } from "../../../apis/types/index.ts";
import {
	createTimeWindowE,
	deleteTimeWindowE,
} from "../../../apis/timeWindowApi.ts";
import styles from "./EditTaskModal.module.css";

interface TimeWindowsTabProps {
	task: Task;
	feasibleWindows: () => TimeWindow[];
	setFeasibleWindows: (w: TimeWindow[]) => void;
	plannedWindows: () => TimeWindow[];
	setPlannedWindows: (w: TimeWindow[]) => void;
}

/** 快捷预设 */
const presetTimeSlots = [
	{ label: "今天 9-11", startT: "09:00", endT: "11:00" },
	{ label: "今天 14-16", startT: "14:00", endT: "16:00" },
	{ label: "今天 19-21", startT: "19:00", endT: "21:00" },
	{ label: "明天 9-11", startT: "09:00", endT: "11:00", dayOffset: 1 },
	{ label: "明天 14-16", startT: "14:00", endT: "16:00", dayOffset: 1 },
];

function formatDateTime(iso: string) {
	const d = new Date(iso);
	return `${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(
		2,
		"0",
	)}:${String(d.getMinutes()).padStart(2, "0")}`;
}

export default function TimeWindowsTab(props: TimeWindowsTabProps) {
	const [newStartDate, setNewStartDate] = createSignal("");
	const [newStartTime, setNewStartTime] = createSignal("09:00");
	const [newEndDate, setNewEndDate] = createSignal("");
	const [newEndTime, setNewEndTime] = createSignal("10:00");
	const [newWindowType, setNewWindowType] = createSignal<
		"feasible" | "planned"
	>("feasible");
	const [error, setError] = createSignal("");

	const handleAdd = async () => {
		if (!newStartDate() || !newEndDate()) return;

		const startISO = `${newStartDate()}T${newStartTime()}:00`;
		const endISO = `${newEndDate()}T${newEndTime()}:00`;
		if (startISO >= endISO) {
			setError("结束时间必须晚于开始时间");
			return;
		}
		setError("");

		const req: CreateTimeWindowRequest = {
			start_time: new Date(startISO).toISOString(),
			end_time: new Date(endISO).toISOString(),
			window_type: newWindowType(),
			task_id: props.task.id,
		};
		try {
			const tw = await createTimeWindowE(req);
			if (tw.window_type === "feasible") {
				props.setFeasibleWindows([...props.feasibleWindows(), tw]);
			} else {
				props.setPlannedWindows([...props.plannedWindows(), tw]);
			}
		} catch (e) {
			const msg = getErrorMessage(e);
			setError(
				msg.includes("planned_outside")
					? "计划时间必须在可进行时间窗口内"
					: msg.includes("slot_overlap")
						? "时间段与现有时间段重叠"
						: `创建失败: ${msg}`,
			);
		}
	};

	const handleDelete = async (id: number, type: string) => {
		try {
			await deleteTimeWindowE(id);
			if (type === "feasible") {
				props.setFeasibleWindows(
					props.feasibleWindows().filter((w) => w.id !== id),
				);
			} else {
				props.setPlannedWindows(
					props.plannedWindows().filter((w) => w.id !== id),
				);
			}
		} catch (e) {
			console.error("删除时间窗口失败:", getErrorMessage(e));
		}
	};

	const applyPreset = (preset: (typeof presetTimeSlots)[0]) => {
		const d = new Date();
		if (preset.dayOffset) d.setDate(d.getDate() + preset.dayOffset);
		const dateStr = d.toISOString().slice(0, 10);
		setNewStartDate(dateStr);
		setNewEndDate(dateStr);
		setNewStartTime(preset.startT);
		setNewEndTime(preset.endT);
	};

	return (
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
						<label class={styles.fieldLabel} for="tw-type">
							类型
						</label>
						<select
							id="tw-type"
							value={newWindowType()}
							onChange={(e) =>
								setNewWindowType(
									e.currentTarget.value as "feasible" | "planned",
								)
							}
							class={styles.fieldInput}
						>
							<option value="feasible">🟢 可进行</option>
							<option value="planned">🔵 计划</option>
						</select>
					</div>
				</div>
				<div class={styles.fieldRow}>
					<div class={styles.field}>
						<label class={styles.fieldLabel} for="tw-start-date">
							开始日期
						</label>
						<input
							id="tw-start-date"
							type="date"
							value={newStartDate()}
							onInput={(e) => setNewStartDate(e.currentTarget.value)}
							class={styles.fieldInput}
						/>
					</div>
					<div class={styles.field}>
						<label class={styles.fieldLabel} for="tw-start-time">
							开始时间
						</label>
						<input
							id="tw-start-time"
							type="time"
							value={newStartTime()}
							onInput={(e) => setNewStartTime(e.currentTarget.value)}
							class={styles.fieldInput}
						/>
					</div>
				</div>
				<div class={styles.fieldRow}>
					<div class={styles.field}>
						<label class={styles.fieldLabel} for="tw-end-date">
							结束日期
						</label>
						<input
							id="tw-end-date"
							type="date"
							value={newEndDate()}
							onInput={(e) => setNewEndDate(e.currentTarget.value)}
							class={styles.fieldInput}
						/>
					</div>
					<div class={styles.field}>
						<label class={styles.fieldLabel} for="tw-end-time">
							结束时间
						</label>
						<input
							id="tw-end-time"
							type="time"
							value={newEndTime()}
							onInput={(e) => setNewEndTime(e.currentTarget.value)}
							class={styles.fieldInput}
						/>
					</div>
				</div>
				<button
					type="button"
					onClick={handleAdd}
					disabled={!newStartDate() || !newEndDate()}
					class={styles.addBtn}
				>
					+ 添加时间段
				</button>
				<Show when={error()}>
					<div class={styles.errorMsg}>{error()}</div>
				</Show>
			</div>

			{/* 已有可进行时间段 */}
			<div class={styles.sectionHeader}>
				<span class={styles.sectionTitle}>可进行时间段</span>
				<span class={styles.sectionHint}>（在此时间段内才能安排任务）</span>
			</div>
			<Show
				when={props.feasibleWindows().length > 0}
				fallback={<div class={styles.emptyMsg}>未设置</div>}
			>
				<div class={styles.timeList}>
					<For each={props.feasibleWindows()}>
						{(tw) => (
							<div class={styles.timeItem}>
								<span class={styles.timeItemText}>
									🟢 {formatDateTime(tw.start_time)} ~{" "}
									{formatDateTime(tw.end_time)}
								</span>
								<button
									type="button"
									onClick={() => handleDelete(tw.id, "feasible")}
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
			<div class={styles.sectionHeader} style={{ "margin-top": "16px" }}>
				<span class={styles.sectionTitle}>计划时间段</span>
				<span class={styles.sectionHint}>（必须在可进行时间窗口内）</span>
			</div>
			<Show
				when={props.plannedWindows().length > 0}
				fallback={<div class={styles.emptyMsg}>未设置</div>}
			>
				<div class={styles.timeList}>
					<For each={props.plannedWindows()}>
						{(tw) => (
							<div class={styles.timeItem}>
								<span class={styles.timeItemText}>
									🔵 {formatDateTime(tw.start_time)} ~{" "}
									{formatDateTime(tw.end_time)}
								</span>
								<button
									type="button"
									onClick={() => handleDelete(tw.id, "planned")}
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
	);
}

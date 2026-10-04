// 落位：拖完 / 键盘改完之后把结果落到后端。
//
// **反馈契约**（06-日历视图 §6.1）：
// - S5-k：C001（planned 必须在 feasible 内）不通过时**不弹确认框** —— 照样落位，
//   给一条 toast 带「撤销」。弹框等于把"你已经同意了一件事"推到用户面前。
// - S5-d：失败（C002 重叠）要给**具体**的话（"这段时间已经有一件事了"），
//   不是通用 toast。所以这里原样带出后端的中文 message。
// - 客户端的合法性预测只是"够用的反馈"，服务端才是裁决者 —— 预测错了由这里兜住。

import { notifyError, notifySuccess } from "@shared/errors";
import { showToast } from "@shared/utils/toastStore.ts";
import { type CreateTaskRequest, createTaskE } from "../api.ts";
import { updateTimeWindowE } from "../timeWindowApi.ts";

export interface ScheduleRequest {
	/** 时间窗 id；null = 在那儿新建一条（点空白） */
	windowId: number | null;
	/** `YYYY-MM-DD` */
	dayKey: string;
	/** 距当天零点的分钟 */
	startMinute: number;
	endMinute: number;
	/** 新建时的任务标题（拖已有窗口时为 null） */
	title?: string;
	/**
	 * 移动前的起止（ISO），用于撤销。
	 *
	 * 由调用方给而不是回头去查：调用方知道这一块**刚才**在哪儿，而查回来的是服务端
	 * 此刻的样子 —— 拖动期间若被别处改过，撤回到"查到的值"就不是用户以为的那一步了。
	 */
	previous?: { start: string; end: string } | null;
}

/** 当天零点 + N 分钟 → ISO（本地时刻，后端按 UTC 存） */
export function toIso(dayKey: string, minute: number): string {
	const [year, month, day] = dayKey.split("-").map(Number);
	return new Date(year, month - 1, day, 0, minute).toISOString();
}

/** 错误信息：后端的中文 message 要原样带出来（S5-d） */
function errorMessage(err: unknown, fallback: string): string {
	return err instanceof Error && err.message ? err.message : fallback;
}

/**
 * 落位。成功就刷新日历，失败给具体的话 + 撤销入口。
 *
 * `onDone` 由调用方提供（日历刷新靠它重新取数），这里不直接碰缓存 ——
 * 缓存失效走 `domains.timeWindows.invalidate`，由 API 层管。
 */
export async function scheduleWindow(
	req: ScheduleRequest,
	onDone?: () => void,
): Promise<boolean> {
	const start = toIso(req.dayKey, req.startMinute);
	const end = toIso(req.dayKey, req.endMinute);

	// 新建：走"一次请求建任务 + 窗口"，不留"任务建了但没排上"的半成功态
	if (req.windowId === null) {
		const payload: CreateTaskRequest = {
			title: req.title?.trim() || "未命名任务",
			planned_window: { start, end },
		};
		try {
			await createTaskE(payload);
			notifySuccess("已排上", payload.title);
			onDone?.();
			return true;
		} catch (err) {
			// 服务端拒绝时它已经说明了原因（"这段计划不在任何可行时间窗口内"之类），
			// 原样带出来比我们自己编一句有用
			notifyError("没能排上", errorMessage(err, "这段时间排不下了"));
			return false;
		}
	}

	// 移动已有窗口：PATCH 这条记录。失败时**给撤销**，不弹确认框（S5-k）
	const previous = req.previous ?? null;
	try {
		await updateTimeWindowE(req.windowId, {
			start_time: start,
			end_time: end,
		});
		onDone?.();
		return true;
	} catch (err) {
		// 弹的是"要不要撤销"而不是"要不要继续" —— 移动已经发生了，
		// 确认框会把它变成一个需要用户裁决的决策
		showToast({
			type: "error",
			title: "没能移动",
			message: errorMessage(err, "这段时间排不下了"),
			action: previous
				? {
						label: "撤销",
						onClick: () => {
							void updateTimeWindowE(req.windowId as number, {
								start_time: previous.start,
								end_time: previous.end,
							});
							onDone?.();
						},
					}
				: undefined,
		});
		return false;
	}
}

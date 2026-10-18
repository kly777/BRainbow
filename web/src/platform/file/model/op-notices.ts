// ── 写操作的汇总文案（唯一来源，纯函数可直测） ──
//
// 这些字符串是用户唯一会读到的结果说明，此前散在 useFileList 的四个分支里
// （单文件上传四条、批量上传四条、批量删除三条、批量加标签两条），顺手改一个
// 措辞就可能与另一个不一致。抽出来之后既能直测，也让 hook 只剩"发请求 + 汇总"。
//
// 纯函数：不 import notify（那会把 toastStore/solid-js 拖进 lib/），只返回 level，
// 由 hook 侧映射到 notifyInfo / notifySuccess / notifyError。

export interface Notice {
	level: "info" | "success" | "error";
	title: string;
	/** 空串表示"只有标题"（notifySuccess 的默认形态） */
	message: string;
}

export type UploadOutcome =
	| "pending"
	| "uploading"
	| "done"
	| "duplicate"
	| "rejected"
	| "error";

/** 单文件上传的提示（命中重复走 info：用户没做错什么，不是失败） */
export function singleUploadNotice(task: {
	name: string;
	status: UploadOutcome;
	error?: string;
}): Notice {
	if (task.status === "duplicate") {
		return {
			level: "info",
			title: "已存在相同文件",
			message: `「${task.name}」已在文件列表中`,
		};
	}
	if (task.status === "done") {
		return { level: "success", title: `「${task.name}」上传成功`, message: "" };
	}
	if (task.status === "rejected") {
		return {
			level: "error",
			title: "未上传",
			message: task.error ?? "文件不符合上传要求",
		};
	}
	return {
		level: "error",
		title: "上传失败",
		message: task.error ?? "未知错误",
	};
}

/** 批量上传的汇总（"未上传"与"失败"分开数：前者是本地拦下的，没发过请求） */
export function batchUploadNotice(counts: {
	ok: number;
	duplicated: number;
	failed: number;
	rejected: number;
}): Notice {
	const parts = [`成功 ${counts.ok} 个`];
	if (counts.duplicated > 0) parts.push(`已存在 ${counts.duplicated} 个`);
	if (counts.failed > 0) parts.push(`失败 ${counts.failed} 个`);
	if (counts.rejected > 0) parts.push(`未上传 ${counts.rejected} 个`);
	const message = parts.join("，");

	if (counts.failed > 0) {
		return { level: "error", title: "上传完成（有失败）", message };
	}
	if (counts.rejected > 0) {
		// 一个都没传上去时说"上传完成"会被读成"传成功了"
		const title =
			counts.ok > 0 || counts.duplicated > 0
				? "上传完成（有未上传）"
				: "未上传";
		return { level: "error", title, message };
	}
	return { level: "success", title: "上传完成", message };
}

/** 批量删除的汇总（被引用跳过的单独报出来，用户可以逐个强制删） */
export function batchDeleteNotice(counts: {
	ok: number;
	skipped: number;
	failed: number;
}): Notice {
	const parts = [`已删除 ${counts.ok} 个`];
	if (counts.skipped > 0) parts.push(`被引用跳过 ${counts.skipped} 个`);
	if (counts.failed > 0) parts.push(`失败 ${counts.failed} 个`);
	const message = parts.join("，");

	return counts.failed > 0
		? { level: "error", title: "批量删除完成（有失败）", message }
		: { level: "success", title: "批量删除完成", message };
}

/** 批量加标签的汇总 */
export function batchAddTagNotice(counts: {
	ok: number;
	failed: number;
	name: string;
}): Notice {
	return counts.failed > 0
		? {
				level: "error",
				title: "批量加标签完成（有失败）",
				message: `成功 ${counts.ok} 个，失败 ${counts.failed} 个`,
			}
		: {
				level: "success",
				title: "批量加标签完成",
				message: `已为 ${counts.ok} 个文件加上「${counts.name}」`,
			};
}

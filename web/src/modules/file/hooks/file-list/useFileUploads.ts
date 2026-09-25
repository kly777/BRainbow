// ── 上传队列（拖拽 / 粘贴 / 多选批量，限并发 + 逐条进度） ──
//
// 从 useFileList 里切出来的第二块，也是最大的一块（原 140 行）。文案汇总抽到了
// `lib/op-notices.ts`（纯函数、有测试），这里只剩编排：预校验 → 建队列 → 限并发上传
// → 逐条更新状态 → 汇总提示 → 重置筛选。
//
// 依赖由外部传入（取数原语与参数 hook），不直接 import 同级 hook 的内部状态。

import { getErrorMessage } from "@shared/api";
import { notifyError, notifyInfo, notifySuccess } from "@shared/utils";
import { createSignal, onCleanup } from "solid-js";
import { uploadFileWithProgress } from "../../api.ts";
import { readMediaDuration } from "../../lib/mediaDuration.ts";
import {
	batchUploadNotice,
	type Notice,
	singleUploadNotice,
} from "../../lib/op-notices.ts";
import { validateUploadFile } from "../../lib/uploadLimits.ts";

/** 并发上传数（批量拖入时避免打满连接） */
const UPLOAD_CONCURRENCY = 3;

/** 单个文件的上传任务状态；`rejected` = 前端预校验拦下，从未发过请求 */
export interface UploadTask {
	id: number;
	name: string;
	size: number;
	loaded: number;
	status: "pending" | "uploading" | "done" | "duplicate" | "error" | "rejected";
	error?: string;
}

let uploadTaskSeq = 1;

/** 命中重复后高亮该条目的时长 */
const HIGHLIGHT_MS = 4000;

function notifyNotice(n: Notice) {
	if (n.level === "info") notifyInfo(n.title, n.message);
	else if (n.level === "success") notifySuccess(n.title, n.message);
	else notifyError(n.title, n.message);
}

export function useFileUploads(deps: {
	refetch: () => void;
	refetchStats: () => void;
	/** 上传成功后清筛选 + 回第 1 页（见 useFileListParams） */
	resetFilters: () => void;
}) {
	const [uploading, setUploading] = createSignal(false);
	const [uploadTasks, setUploadTasks] = createSignal<UploadTask[]>([]);
	const clearUploadTasks = () => setUploadTasks([]);
	const [highlightId, setHighlightId] = createSignal<string | null>(null);
	let highlightTimer: ReturnType<typeof setTimeout> | undefined;
	onCleanup(() => clearTimeout(highlightTimer));

	const patchTask = (id: number, patch: Partial<UploadTask>) => {
		setUploadTasks((prev) =>
			prev.map((t) => (t.id === id ? { ...t, ...patch } : t)),
		);
	};

	const highlight = (storedId: string) => {
		setHighlightId(storedId);
		clearTimeout(highlightTimer);
		highlightTimer = setTimeout(() => setHighlightId(null), HIGHLIGHT_MS);
	};

	const handleUploadFiles = async (files: File[]) => {
		const picked = files.filter(Boolean);
		if (picked.length === 0) return;

		// 前端先过一道：空文件与明确超限的不进队列。大文件传到一半才收到 400 意味着
		// 用户白等一次完整上传（几百 MB 可能就是几分钟），本地拦下只需一瞬。
		// 名字先按拖入顺序一次性定好，被拦下与否都不影响面板里的编号。
		const named = picked.map((file, index) => ({
			file,
			name: file.name || `未命名文件 ${index + 1}`,
		}));
		const accepted: typeof named = [];
		const rejected: UploadTask[] = [];
		for (const item of named) {
			const reason = validateUploadFile(item.file);
			if (reason) {
				rejected.push({
					id: uploadTaskSeq++,
					name: item.name,
					size: item.file.size,
					loaded: 0,
					status: "rejected",
					error: reason,
				});
			} else {
				accepted.push(item);
			}
		}

		const tasks: UploadTask[] = accepted.map((item) => ({
			id: uploadTaskSeq++,
			name: item.name,
			size: item.file.size,
			loaded: 0,
			status: "pending",
		}));
		// 被拦下的也进面板（否则用户拖了文件却"什么都没发生"），只是不占并发位
		setUploadTasks((prev) => [...prev, ...rejected, ...tasks]);
		setUploading(accepted.length > 0);

		let ok = 0;
		let duplicated = 0;
		let failed = 0;
		let firstDuplicateId: string | null = null;

		// 限并发：一次拖十几个文件时避免打满连接
		const queue = accepted.map((item, i) => ({
			file: item.file,
			task: tasks[i],
		}));
		const workers = Array.from(
			{ length: Math.min(UPLOAD_CONCURRENCY, queue.length) },
			async () => {
				for (;;) {
					const next = queue.shift();
					if (!next) return;
					patchTask(next.task.id, { status: "uploading" });
					try {
						// 音视频先读一次时长再传：后端拿不到它（上传路径不起子进程做媒体
						// 探测），而列表/详情页的时长角标就靠这个值
						const durationMs = await readMediaDuration(next.file);
						const uploaded = await uploadFileWithProgress(next.file, {
							durationMs,
							onProgress: ({ loaded }) => patchTask(next.task.id, { loaded }),
						});
						if (uploaded.duplicate) {
							duplicated += 1;
							firstDuplicateId ??= uploaded.stored_id;
							patchTask(next.task.id, { status: "duplicate" });
						} else {
							ok += 1;
							patchTask(next.task.id, { status: "done" });
						}
					} catch (e) {
						failed += 1;
						patchTask(next.task.id, {
							status: "error",
							error: getErrorMessage(e),
						});
					}
				}
			},
		);
		await Promise.all(workers);
		setUploading(false);

		// 汇总提示：单文件沿用逐条文案，批量走一条汇总
		if (picked.length === 1) {
			const finished = uploadTasks().find((t) => t.id === tasks[0]?.id);
			notifyNotice(
				singleUploadNotice(
					finished ?? { name: tasks[0]?.name ?? "", status: "error" },
				),
			);
		} else {
			notifyNotice(
				batchUploadNotice({
					ok,
					duplicated,
					failed,
					rejected: rejected.length,
				}),
			);
		}

		// 命中重复的文件在列表中定位高亮（只针对单个上传，批量时会跳来跳去）
		if (picked.length === 1 && firstDuplicateId) highlight(firstDuplicateId);

		// 重置筛选 + 回第 1 页：否则停留在筛选条件或较后页码时，新上传的文件"看不到"
		if (ok > 0 || duplicated > 0) {
			deps.resetFilters();
			deps.refetch();
			deps.refetchStats();
		}
	};

	return {
		uploading,
		uploadTasks,
		clearUploadTasks,
		highlightId,
		handleUploadFiles,
	};
}

export type FileUploads = ReturnType<typeof useFileUploads>;

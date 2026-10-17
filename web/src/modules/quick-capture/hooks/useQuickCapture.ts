// ── 全局快速记录 Hook ──
// Shift+Tab 唤起浮窗，快速创建任务/卡片/书签，不离开当前页面

import { type CreateBookmarkRequest, createBookmarkE } from "@modules/bookmark";
import { type CreateCardRequest, createCardE } from "@modules/card";
import {
	type CaptureResult,
	type CreateTaskRequest,
	captureToCreateRequest,
	createTaskE,
	mentionsToDescription,
	parseCapture,
} from "@modules/task";
import { showToast } from "@shared/utils/toastStore.ts";
import { createSignal, onCleanup, onMount } from "solid-js";

export type QuickCaptureType = "task" | "card" | "bookmark";

export interface QuickCaptureState {
	open: boolean;
	inputValue: string;
	creating: boolean;
}

/**
 * 检测输入意图：
 * - `#` 开头 → 任务（`#` 之后才是内容，`#购物` 建的任务标题是"购物"）
 * - `@` 开头 + URL → 书签
 * - 其他 → 卡片
 *
 * 行首的 `#` / `@` 是**类型前缀**（"这条输入要创建什么"），与任务属性的**行内 token**
 * （`#标签` / `@提及`）是两件事：前缀只在第一个非空白字符处生效，剥掉之后交给
 * `parseCapture` 提取属性。`#购物` 仍创建名为"购物"的任务 —— 这是向后兼容的红线（A6）。
 *
 * 卡片与书签**不解析**属性语法：它们的正文原样保存。
 */
export function detectType(input: string): {
	type: QuickCaptureType;
	cleanValue: string;
	url?: string;
	/** 任务的属性解析结果（只有 type === "task" 时才有） */
	capture?: CaptureResult;
} {
	const trimmed = input.trim();

	if (trimmed.startsWith("#")) {
		const capture = parseCapture(trimmed.slice(1).trim());
		return { type: "task", cleanValue: capture.cleanTitle, capture };
	}

	if (trimmed.startsWith("@")) {
		const afterAt = trimmed.slice(1).trim();
		// 检测 URL
		const urlMatch = afterAt.match(/^(https?:\/\/\S+)/);
		if (urlMatch) {
			const url = urlMatch[1];
			const rest = afterAt.slice(url.length).trim();
			return { type: "bookmark", cleanValue: rest || url, url };
		}
		// 如果 @ 后面是完整 URL
		if (/^https?:\/\//.test(afterAt)) {
			return { type: "bookmark", cleanValue: afterAt, url: afterAt };
		}
	}

	return { type: "card", cleanValue: trimmed };
}

/**
 * 获取类型对应的提示文字
 */
export function getTypeHint(type: QuickCaptureType): string {
	switch (type) {
		case "task":
			return "创建任务";
		case "bookmark":
			return "收藏书签";
		case "card":
			return "保存卡片";
	}
}

/**
 * 获取类型对应的 emoji
 */
export function getTypeEmoji(type: QuickCaptureType): string {
	switch (type) {
		case "task":
			return "✅";
		case "bookmark":
			return "🔖";
		case "card":
			return "📝";
	}
}

export function useQuickCapture() {
	const [open, setOpen] = createSignal(false);
	const [inputValue, setInputValue] = createSignal("");
	const [creating, setCreating] = createSignal(false);

	const type = () => detectType(inputValue()).type;
	const cleanValue = () => detectType(inputValue()).cleanValue;
	const url = () => detectType(inputValue()).url;

	const close = () => {
		setOpen(false);
		setInputValue("");
		setCreating(false);
	};

	const openCapture = (prefix = "") => {
		setOpen(true);
		setInputValue(prefix);
		setCreating(false);
	};

	/**
	 * 根据类型创建对应的资源
	 */
	const createItem = async (): Promise<boolean> => {
		const detected = detectType(inputValue());
		const value = detected.cleanValue;

		if (!value) return false;

		setCreating(true);

		try {
			switch (detected.type) {
				case "task": {
					// 符号已经由解析器剥走，这里组装创建请求（提及本期进 description）
					const capture = detected.capture ?? parseCapture(value);
					const req: CreateTaskRequest = captureToCreateRequest({
						title: value,
						description: mentionsToDescription(capture.mentions),
						priority: capture.priority,
						tags: capture.tags,
						effortMinutes: capture.effortMinutes,
						startAt: null,
						dueAt: null,
						parentTaskId: null,
					});
					await createTaskE(req);
					showToast({
						type: "success",
						title: "任务已创建",
						message: value,
						duration: 3000,
					});
					return true;
				}
				case "card": {
					const req: CreateCardRequest = { content: value };
					await createCardE(req);
					showToast({
						type: "success",
						title: "卡片已保存",
						message: value.length > 50 ? `${value.slice(0, 50)}…` : value,
						duration: 3000,
					});
					return true;
				}
				case "bookmark": {
					if (!detected.url) {
						showToast({
							type: "error",
							title: "请输入有效的 URL",
							message: "书签需要以 @https://... 开头",
							duration: 3000,
						});
						return false;
					}
					const req: CreateBookmarkRequest = {
						title: value || detected.url,
						url: detected.url,
					};
					await createBookmarkE(req);
					showToast({
						type: "success",
						title: "书签已收藏",
						message: detected.url,
						duration: 3000,
					});
					return true;
				}
			}
		} catch (err) {
			showToast({
				type: "error",
				title: "创建失败",
				message: err instanceof Error ? err.message : "未知错误",
				duration: 4000,
			});
			return false;
		} finally {
			setCreating(false);
		}
	};

	const commit = async () => {
		const ok = await createItem();
		if (ok) {
			close();
		}
	};

	const onInputKey = (e: KeyboardEvent) => {
		if (e.key === "Escape") {
			e.preventDefault();
			close();
			return;
		}
		if (e.key === "Enter") {
			e.preventDefault();
			commit();
			return;
		}
	};

	// 全局键盘快捷键：Shift+Tab
	const globalKey = (e: KeyboardEvent) => {
		if (e.shiftKey && e.key === "Tab") {
			e.preventDefault();
			if (open()) {
				close();
			} else {
				openCapture();
			}
			return;
		}
	};

	onMount(() => {
		globalThis.addEventListener("keydown", globalKey);
	});

	onCleanup(() => {
		globalThis.removeEventListener("keydown", globalKey);
	});

	return {
		open,
		inputValue,
		setInputValue,
		creating,
		type,
		cleanValue,
		url,
		close,
		openCapture,
		commit,
		onInputKey,
	};
}

// ── SSE 流式对话 + 乐观 UI ──
// 从 useChatSession 拆分：流式调用、临时节点插入、rAF 节流、停止生成。

import { getToken } from "@lib/api";
import { notifyError } from "@lib/utils";
import type { ChatNode, TreeDetail } from "@modules/chat";
import { createSignal, onCleanup } from "solid-js";
import { makeTempNode } from "./chat-tree.ts";
import { streamChatRequest } from "./streamChatRequest.ts";
import type { StreamResult } from "./useChatSessionTypes.ts";

export interface UseStreamChatOpts {
	treeId: () => number | null;
	current: () => TreeDetail | null;
	setCurrent: (updater: (prev: TreeDetail | null) => TreeDetail | null) => void;
	focusId: () => number | null;
	setFocusParam: (id: number | null) => void;
	nodes: () => ChatNode[];
	activePath: () => ChatNode[];
	loadTree: (id: number) => Promise<void>;
	aiTitleSession: (id: number, silent?: boolean) => Promise<boolean>;
	/** 用于判断是否需要 AI 取标题 */
	createTitle: string;
}

export function useStreamChat(opts: UseStreamChatOpts) {
	// ── 对话状态 ──
	const [sending, setSending] = createSignal(false);
	const [input, setInput] = createSignal("");
	/** 流式输出中的 assistant 内容（sending 期间实时累积） */
	const [streamingContent, setStreamingContent] = createSignal("");
	/** 流式输出中的思考内容（reasoning） */
	const [streamingReasoning, setStreamingReasoning] = createSignal("");

	// ── 流式对话 ──

	let abortCtrl: AbortController | null = null;

	/** 停止当前生成 */
	const stopStreaming = () => abortCtrl?.abort();

	// 组件卸载时中止进行中的流式请求：否则后端持续生成烧 token，
	// 回调还会更新已卸载页面的 signal（审计 F1）
	onCleanup(() => abortCtrl?.abort());

	/**
	 * 流式调用后端（乐观 UI）：
	 * - content 非空：立即插入临时 user 节点
	 * - 插入空 assistant 临时节点，流式内容直接 patch
	 * - 完成后重拉真实树替换临时节点
	 * - 失败：移除临时节点，返回错误
	 */
	const streamChat = async (
		parentId: number | null,
		content: string | null,
	): Promise<StreamResult> => {
		const id = opts.treeId();
		if (id === null) return { ok: false, error: "会话不存在" };

		const token = getToken();
		if (!token) return { ok: false, error: "未登录" };

		const tree = opts.current()?.tree;
		const needsTitle = tree?.title === opts.createTitle;

		const ts = Date.now();
		const tempUser = content ? -ts : null;
		const tempAssistant = -ts - 1;
		const tempIds = new Set(
			[tempUser, tempAssistant].filter((n): n is number => n !== null),
		);

		// 乐观插入：user（若有）→ assistant（空内容，随流式累积）
		opts.setCurrent((prev) => {
			if (!prev) return prev;
			const next = [...prev.nodes];
			if (tempUser !== null) {
				next.push(makeTempNode(tempUser, parentId, "user", content ?? "", id));
			}
			next.push(
				makeTempNode(tempAssistant, tempUser ?? parentId, "assistant", "", id),
			);
			return { ...prev, nodes: next };
		});
		opts.setFocusParam(tempAssistant);
		setStreamingContent("");

		// rAF 节流：每帧最多刷一次，避免 Markdown O(n²) 重复解析
		let pendingFrame: number | null = null;
		let pendingText = "";
		let pendingReasoning = "";
		const flushStreaming = () => {
			pendingFrame = null;
			setStreamingContent(pendingText);
			setStreamingReasoning(pendingReasoning);
		};
		const patchAssistant = (text: string, reasoning = "") => {
			pendingText = text;
			pendingReasoning = reasoning;
			if (pendingFrame === null) {
				pendingFrame = requestAnimationFrame(flushStreaming);
			}
		};
		const rollback = () => {
			opts.setCurrent((prev) => {
				if (!prev) return prev;
				return { ...prev, nodes: prev.nodes.filter((n) => !tempIds.has(n.id)) };
			});
		};

		const controller = new AbortController();
		abortCtrl = controller;
		try {
			const result = await streamChatRequest(
				id,
				parentId,
				content,
				token,
				controller.signal,
				patchAssistant,
			);

			if (result.ok || controller.signal.aborted) {
				await opts.loadTree(id);
				if (needsTitle && tree) void opts.aiTitleSession(id, true);
				return { ok: true, error: "" };
			}
			rollback();
			return result;
		} finally {
			if (pendingFrame !== null) cancelAnimationFrame(pendingFrame);
			setStreamingContent("");
			setStreamingReasoning("");
			if (abortCtrl === controller) abortCtrl = null;
		}
	};

	return {
		sending,
		setSending,
		streamingContent,
		streamingReasoning,
		input,
		setInput,
		streamChat,
		stopStreaming,
	};
}

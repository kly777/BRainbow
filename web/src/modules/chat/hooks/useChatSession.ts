// ── 对话会话公共逻辑：/chat 与 /chat/mem 共用 ──
// 组合入口：树列表 + 焦点导航 + 流式对话。
// 两者差异（提示词、AI 输出处理）由各自页面的 hook 组合实现。

import { parseUrlId } from "@shared/utils";
import { useNavigate, useSearchParams } from "@solidjs/router";
import type { ChatSessionOptions } from "./useChatSessionTypes.ts";
import { useStreamChat } from "./useStreamChat.ts";
import { useTreeFocus } from "./useTreeFocus.ts";
import { useTreeList } from "./useTreeList.ts";

export function useChatSession(opts: ChatSessionOptions) {
	const navigate = useNavigate();
	const [params, setParams] = useSearchParams();

	// ── 子 hook 1：树列表 CRUD ──
	const treeList = useTreeList(opts);

	// ── 子 hook 2：焦点/分支导航 ──
	const focusId = (): number | null => parseUrlId(params.node);
	const focus = useTreeFocus({
		nodes: () => treeList.current()?.nodes ?? [],
		focusId,
		setFocusParam: (id: number | null) =>
			setParams({ node: id === null ? undefined : String(id) }),
	});

	// ── 子 hook 3：流式对话 ──
	const stream = useStreamChat({
		treeId: treeList.treeId,
		current: treeList.current,
		setCurrent: treeList.setCurrent,
		focusId,
		setFocusParam: (id: number | null) =>
			setParams({ node: id === null ? undefined : String(id) }),
		nodes: () => treeList.current()?.nodes ?? [],
		activePath: focus.activePath,
		loadTree: treeList.loadTree,
		aiTitleSession: treeList.aiTitleSession,
		createTitle: opts.createTitle,
	});

	return {
		// 树列表
		trees: treeList.trees,
		loadingTrees: treeList.loadingTrees,
		current: treeList.current,
		setCurrent: treeList.setCurrent,
		treeId: treeList.treeId,
		loadTrees: treeList.loadTrees,
		loadTree: treeList.loadTree,
		createSession: treeList.createSession,
		removeSession: treeList.removeSession,
		renameSession: treeList.renameSession,
		aiTitleSession: treeList.aiTitleSession,
		selectSession: treeList.selectSession,
		// 焦点导航
		focusId,
		setFocusParam: (id: number | null) =>
			setParams({ node: id === null ? undefined : String(id) }),
		setParams,
		nodes: () => treeList.current()?.nodes ?? [],
		childrenOf: focus.childrenOf,
		activePath: focus.activePath,
		lastNode: focus.lastNode,
		findNode: focus.findNode,
		focusBranch: focus.focusBranch,
		isInSubtree: focus.isInSubtree,
		// 流式对话
		sending: stream.sending,
		setSending: stream.setSending,
		streamingContent: stream.streamingContent,
		streamingReasoning: stream.streamingReasoning,
		input: stream.input,
		setInput: stream.setInput,
		streamChat: stream.streamChat,
		stopStreaming: stream.stopStreaming,
		navigate,
	};
}

export type ChatSession = ReturnType<typeof useChatSession>;

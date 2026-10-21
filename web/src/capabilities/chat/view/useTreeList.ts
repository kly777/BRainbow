// ── 树列表 CRUD + 选择 ──
// 从 useChatSession 拆分：树列表加载、创建、删除、重命名、AI 取标题。

import { PATHS } from "@config/paths";
import {
	confirmAndRun,
	notifyError,
	notifySuccess,
	parseUrlId,
	strParam,
	tryAsync,
	tryOrNotify,
	useUrlParams,
} from "@shared/utils";
import { useNavigate } from "@solidjs/router";
import { createEffect, createSignal } from "solid-js";
import type { ChatTree, TreeDetail } from "../api.ts";
import {
	createTreeE,
	deleteTreeE,
	generateTreeTitleE,
	getTreeE,
	listTreesE,
	updateTreeE,
} from "../api.ts";
import type { ChatSessionOptions } from "./useChatSessionTypes.ts";

/**
 * 深链到错误类型的会话时该去哪：/chat 里的 mem 树（或反过来）要换到对应页面。
 * 返回 null 表示类型匹配，无需跳转。
 */
export function chatKindRedirect(
	expected: "chat" | "mem" | undefined,
	actual: string,
	treeId: number,
	nodeId: number | null,
): string | null {
	if (!expected || expected === actual) return null;
	const base = expected === "chat" ? PATHS.chatMem : PATHS.chat;
	const query = new URLSearchParams({ tree: String(treeId) });
	if (nodeId !== null) query.set("node", String(nodeId));
	return `${base}?${query.toString()}`;
}

export function useTreeList(opts: ChatSessionOptions) {
	const params = useUrlParams({ tree: strParam(""), node: strParam("") });
	const navigate = useNavigate();

	// ── 树列表 ──
	const [trees, setTrees] = createSignal<ChatTree[]>([]);
	const [loadingTrees, setLoadingTrees] = createSignal(true);

	// ── 当前树 ──
	const [current, setCurrent] = createSignal<TreeDetail | null>(null);

	const treeId = (): number | null => {
		const t = params.get("tree");
		return t ? parseUrlId(t) : null;
	};
	const nodeId = (): number | null => {
		const n = params.get("node");
		return n ? parseUrlId(n) : null;
	};

	// ── 加载 ──

	const loadTrees = async () => {
		const listFn = opts.listTreesFn ?? listTreesE;
		const result = await tryAsync(() => listFn());
		if (result.ok) {
			setTrees(result.value);
			// 不因为 active 不在列表里就改跳第一棵树：列表是按 kind 过滤的，
			// 深链到另一类会话（如 /chat?tree=<mem>）要先 loadTree 再按类型换页。
		}
		setLoadingTrees(false);
	};

	const loadTree = async (id: number) => {
		const result = await tryAsync(() => getTreeE(id));
		if (!result.ok) return;
		// 时效守卫：请求期间用户已切换会话，晚到响应不得覆盖新树（审计 F3）
		if (treeId() !== id) return;
		// 会话类型与当前页面不符：转到正确页面，别把卡片 JSON 当普通回复渲染。
		const redirect = chatKindRedirect(
			opts.createKind,
			result.value.tree.kind,
			id,
			nodeId(),
		);
		if (redirect) {
			navigate(redirect);
			return;
		}
		setCurrent(result.value);
		if (nodeId() === null && result.value.nodes.length > 0) {
			const last = result.value.nodes[result.value.nodes.length - 1].id;
			params.set({ node: String(last) });
		}
	};

	// ── 路由同步：tree 参数变化时加载 ──
	createEffect(() => {
		const id = treeId();
		if (id !== null) void loadTree(id);
	});

	// ── 会话 CRUD ──

	const createSession = async () => {
		const result = await tryOrNotify(
			() => createTreeE(opts.createTitle, "", opts.createKind),
			opts.createLabel,
		);
		if (!result) return;
		setTrees((prev) => [result.tree, ...prev]);
		params.set({ tree: String(result.tree.id) });
	};

	const removeSession = async (id: number) => {
		const ok = await confirmAndRun(
			{
				title: "删除会话",
				message: "确定删除该对话？删除后不可恢复。",
				variant: "danger",
			},
			() => deleteTreeE(id),
			"删除会话",
		);
		if (!ok) return;
		notifySuccess("已删除");
		setTrees((prev) => prev.filter((t) => t.id !== id));
		if (treeId() === id) {
			const next = trees().find((t) => t.id !== id);
			if (next) params.set({ tree: String(next.id) });
			else {
				setCurrent(null);
				params.set({ tree: undefined, node: undefined });
			}
		}
	};

	const renameSession = async (id: number, title: string) => {
		const clean = title.trim();
		if (!clean) return;
		const ok = await tryOrNotify(
			() => updateTreeE(id, { title: clean }),
			"重命名会话",
		);
		if (ok === null) return;
		setTrees((prev) =>
			prev.map((t) => (t.id === id ? { ...t, title: clean } : t)),
		);
		if (current()?.tree.id === id) {
			setCurrent((prev) =>
				prev ? { ...prev, tree: { ...prev.tree, title: clean } } : prev,
			);
		}
	};

	const aiTitleSession = async (id: number, silent = false) => {
		const result = await tryAsync(() => generateTreeTitleE(id));
		if (!result.ok) {
			if (!silent) notifyError("AI 取标题失败", result.error);
			return false;
		}
		const title = result.value.title;
		setTrees((prev) => prev.map((t) => (t.id === id ? { ...t, title } : t)));
		if (current()?.tree.id === id) {
			setCurrent((prev) =>
				prev ? { ...prev, tree: { ...prev.tree, title } } : prev,
			);
		}
		if (!silent) notifySuccess("标题已更新");
		return true;
	};

	const selectSession = (id: number) => params.set({ tree: String(id) });

	return {
		trees,
		loadingTrees,
		current,
		setCurrent,
		treeId,
		urlParams: params,
		loadTrees,
		loadTree,
		createSession,
		removeSession,
		renameSession,
		aiTitleSession,
		selectSession,
	};
}

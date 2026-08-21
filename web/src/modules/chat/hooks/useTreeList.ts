// ── 树列表 CRUD + 选择 ──
// 从 useChatSession 拆分：树列表加载、创建、删除、重命名、AI 取标题。

import {
	confirmAndRun,
	notifyError,
	notifySuccess,
	parseUrlId,
	tryAsync,
	tryOrNotify,
} from "@lib/utils";
import type { ChatTree, TreeDetail } from "@modules/chat";
import {
	createTreeE,
	deleteTreeE,
	generateTreeTitleE,
	getTreeE,
	listTreesE,
	updateTreeE,
} from "@modules/chat";
import { useSearchParams } from "@solidjs/router";
import { createEffect, createSignal } from "solid-js";
import type { ChatSessionOptions } from "./useChatSessionTypes.ts";

export function useTreeList(opts: ChatSessionOptions) {
	const [params, setParams] = useSearchParams();

	// ── 树列表 ──
	const [trees, setTrees] = createSignal<ChatTree[]>([]);
	const [loadingTrees, setLoadingTrees] = createSignal(true);

	// ── 当前树 ──
	const [current, setCurrent] = createSignal<TreeDetail | null>(null);

	const treeId = (): number | null => parseUrlId(params.tree);
	const nodeId = (): number | null => parseUrlId(params.node);

	// ── 加载 ──

	const loadTrees = async () => {
		const listFn = opts.listTreesFn ?? listTreesE;
		const result = await tryAsync(() => listFn());
		if (result.ok) {
			setTrees(result.value);
			const active = treeId();
			if (active !== null && !result.value.some((t) => t.id === active)) {
				if (result.value.length > 0) {
					setParams({ tree: String(result.value[0].id) });
				} else {
					setCurrent(null);
				}
			}
		}
		setLoadingTrees(false);
	};

	const loadTree = async (id: number) => {
		const result = await tryAsync(() => getTreeE(id));
		if (!result.ok) return;
		setCurrent(result.value);
		if (nodeId() === null && result.value.nodes.length > 0) {
			const last = result.value.nodes[result.value.nodes.length - 1].id;
			setParams({ node: String(last) });
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
		setParams({ tree: String(result.tree.id) });
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
			if (next) setParams({ tree: String(next.id) });
			else {
				setCurrent(null);
				setParams({});
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

	const selectSession = (id: number) => setParams({ tree: String(id) });

	return {
		trees,
		loadingTrees,
		current,
		setCurrent,
		treeId,
		params,
		setParams,
		loadTrees,
		loadTree,
		createSession,
		removeSession,
		renameSession,
		aiTitleSession,
		selectSession,
	};
}

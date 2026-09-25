// ── 书签行内操作：刷新标题 / 检测可访问性 / 单条删除 ──
//
// 从 useBookmarkPage 里切出来的一块。三条都是"针对某一行"的动作，
// 与列表取数、多选、表单无关；删除走 useListResource 的乐观更新（失败整份快照回滚）。

import {
	notifyError,
	notifySuccess,
	showConfirm,
	tryAsync,
} from "@shared/utils";
import type { ListResource } from "@shared/utils/useListResource.ts";
import type { Bookmark } from "../../api.ts";
import { deleteBookmarkE, fetchUrlTitleE, updateBookmarkE } from "../../api.ts";

export function useBookmarkRowActions(deps: {
	list: ListResource<Bookmark>;
	page: () => number;
	setPage: (page: number) => void;
	reloadSilent: () => void;
}) {
	/** 抓取网页标题并写回书签 */
	async function handleRefreshTitle(bm: Bookmark) {
		const result = await tryAsync(() => fetchUrlTitleE(bm.url));
		if (!result.ok) {
			notifyError("获取标题失败", result.error);
			return;
		}
		if (!result.value.title) {
			notifyError("获取标题失败", new Error("未能获取标题"));
			return;
		}
		const updateResult = await tryAsync(() =>
			updateBookmarkE(bm.id, { title: result.value.title }),
		);
		if (updateResult.ok) {
			notifySuccess("标题已刷新");
			deps.reloadSilent();
		} else {
			notifyError("更新标题失败", updateResult.error);
		}
	}

	/** 探测网址可达性（no-cors HEAD；跨域下 status 恒为 0，不报错即视为可达） */
	async function handleCheckAccessibility(
		bm: Bookmark,
	): Promise<"ok" | "fail"> {
		try {
			const controller = new AbortController();
			const timeout = setTimeout(() => controller.abort(), 10000);
			await fetch(bm.url, {
				method: "HEAD",
				mode: "no-cors",
				signal: controller.signal,
			});
			clearTimeout(timeout);
			notifySuccess("该网址可访问");
			return "ok";
		} catch {
			notifyError("该网址无法访问");
			return "fail";
		}
	}

	/** 删除单条：乐观移除，失败由原语回滚整份分页快照 */
	async function handleDelete(bm: Bookmark) {
		const confirmed = await showConfirm({
			title: "删除书签",
			message: `确定要删除「${bm.title}」吗？此操作不可撤销。`,
			variant: "danger",
		});
		if (!confirmed) return;

		const wasLastOnPage = deps.list.items().length === 1 && deps.page() > 1;

		const result = await deps.list.optimistic(
			(items) => items.filter((b) => b.id !== bm.id),
			() => deleteBookmarkE(bm.id),
			{ total: Math.max(0, deps.list.total() - 1) },
		);
		if (result.ok) {
			notifySuccess("书签已删除");
			if (wasLastOnPage) deps.setPage(deps.page() - 1);
		} else {
			notifyError("删除失败", result.error);
		}
	}

	return { handleDelete, handleRefreshTitle, handleCheckAccessibility };
}

export type BookmarkRowActions = ReturnType<typeof useBookmarkRowActions>;

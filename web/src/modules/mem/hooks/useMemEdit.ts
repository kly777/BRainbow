// ── 记忆详情编辑状态（编辑弹层：线索/答案） ──

import { editMemE, type MemItem } from "@modules/mem";
import { tryOrNotify } from "@shared/utils";
import { createSignal } from "solid-js";

export function useMemEdit(deps: {
	/** 当前详情 id（null = 无详情） */
	detailId: () => number | null;
	/** 列表数据（详情项由此查找） */
	mems: () => MemItem[];
	/** 保存成功后重载 */
	reload: () => void;
}) {
	const [editing, setEditing] = createSignal(false);
	const [editCue, setEditCue] = createSignal("");
	const [editTarget, setEditTarget] = createSignal("");

	const detail = () => {
		const id = deps.detailId();
		return id !== null ? deps.mems().find((m) => m.id === id) : undefined;
	};

	const startEdit = () => {
		const d = detail();
		if (!d) return;
		setEditCue(d.cue.content);
		setEditTarget(d.target.content);
		setEditing(true);
	};

	const saveEdit = async () => {
		const d = detail();
		if (!d) return;
		const ok = await tryOrNotify(
			() => editMemE(d.id, editCue(), editTarget()),
			"保存编辑",
		);
		if (!ok) return;
		setEditing(false);
		deps.reload();
	};

	return {
		editing,
		setEditing,
		editCue,
		setEditCue,
		editTarget,
		setEditTarget,
		startEdit,
		saveEdit,
	};
}

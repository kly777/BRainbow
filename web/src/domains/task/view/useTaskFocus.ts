// ── /task/:id 的视图模型：详情资源、草稿、保存、标签、子任务、删除 ──
//
// 页面只负责表单与版式；请求、乐观/错误处理、URL 参数都在这里。

import { notifyError, notifySuccess } from "@shared/errors";
import { useDetailResource } from "@shared/utils";
import type { TagOption } from "@components/ui/molecules/TagInput.tsx";
import { useNavigate, useParams } from "@solidjs/router";
import { createEffect, createSignal } from "solid-js";
import type { Tag } from "../api.ts";
import { taskRepository } from "../data/taskRepository.ts";
import { PATHS } from "@config/paths";
import { showConfirm } from "@components/ui";

export function useTaskFocusView() {
	const params = useParams();
	const navigate = useNavigate();
	const id = () => Number(params.id);

	const m = useDetailResource({
		id,
		validate: (value) => Number.isInteger(value) && value >= 1,
		invalidIdError: new Error("无效的任务 ID"),
		fetcher: (value) => taskRepository.detail(value),
	});
	const detail = m.data;
	const { refetch } = m;

	const [titleDraft, setTitleDraft] = createSignal("");
	const [descDraft, setDescDraft] = createSignal("");
	const [childTitle, setChildTitle] = createSignal("");
	const [childOpen, setChildOpen] = createSignal(false);
	const [saving, setSaving] = createSignal(false);
	const [recurring, setRecurring] = createSignal(false);

	createEffect(() => {
		const task = detail()?.task;
		if (!task) return;
		setTitleDraft(task.title);
		setDescDraft(task.description ?? "");
	});

	const patch = async (
		updates: Parameters<typeof taskRepository.update>[1],
	) => {
		setSaving(true);
		try {
			await taskRepository.update(id(), updates);
			refetch();
			notifySuccess("已保存", detail()?.task.title);
			return true;
		} catch (error) {
			notifyError("保存失败", error);
			return false;
		} finally {
			setSaving(false);
		}
	};

	const saveTitle = async () => {
		if (saving()) return;
		const task = detail()?.task;
		if (!task) return;
		const title = titleDraft().trim();
		if (!title) {
			setTitleDraft(task.title);
			notifyError("标题不能为空");
			return;
		}
		if (title !== task.title) await patch({ title });
	};

	const saveDescription = async () => {
		if (saving()) return;
		const task = detail()?.task;
		if (!task) return;
		const description = descDraft().trim();
		if (description !== (task.description ?? "")) {
			await patch({ description: description || null });
		}
	};

	const saveTags = (tags: Tag[]) => {
		void patch({ tags: tags.map((tag) => tag.name) });
	};

	const addTag = (name: string) => {
		const task = detail()?.task;
		if (!task || task.tags.some((tag) => tag.name === name)) return;
		saveTags([...task.tags, { id: -1, name }]);
	};

	const removeTag = (name: string) => {
		const task = detail()?.task;
		if (!task) return;
		saveTags(task.tags.filter((tag) => tag.name !== name));
	};

	let tagTimer: ReturnType<typeof setTimeout> | undefined;
	const searchTags = (query: string): Promise<TagOption[]> =>
		new Promise((resolve) => {
			clearTimeout(tagTimer);
			tagTimer = setTimeout(async () => {
				try {
					resolve(await taskRepository.tags(query));
				} catch {
					resolve([]);
				}
			}, 200);
		});

	const addChild = async () => {
		const title = childTitle().trim();
		if (!title) return;
		try {
			await taskRepository.createChild(id(), title);
			setChildTitle("");
			setChildOpen(false);
			refetch();
		} catch (error) {
			notifyError("创建子任务失败", error);
		}
	};

	const remove = async () => {
		const task = detail()?.task;
		if (!task) return;
		const confirmed = await showConfirm({
			title: "删除任务",
			message: `确定删除「${task.title}」？未完成的任务会移入归档，已完成的任务会永久删除。`,
			variant: "danger",
			confirmLabel: "删除",
		});
		if (!confirmed) return;
		try {
			await taskRepository.remove(id());
			notifySuccess("任务已删除");
			navigate(PATHS.task);
		} catch (error) {
			notifyError("删除失败", error);
		}
	};

	return {
		id,
		m,
		detail,
		refetch,
		titleDraft,
		setTitleDraft,
		descDraft,
		setDescDraft,
		saving,
		patch,
		saveTitle,
		saveDescription,
		addTag,
		removeTag,
		searchTags,
		childTitle,
		setChildTitle,
		childOpen,
		setChildOpen,
		addChild,
		recurring,
		setRecurring,
		remove,
	};
}

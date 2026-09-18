// ── /file/:id 详情页数据逻辑：加载/编辑（名称+标签+元信息）/删除 ──

import { PATHS } from "@config/paths";
import { getErrorMessage, HttpError } from "@shared/api";
import {
	notifyError,
	notifySuccess,
	showConfirm,
	tryAsync,
	useDetailResource,
} from "@shared/utils";
import { useLocation, useNavigate, useParams } from "@solidjs/router";
import { createSignal } from "solid-js";
import type { FileItem } from "../api.ts";
import { deleteFile, getFile, updateFile } from "../api.ts";

export interface MetaEntry {
	key: string;
	value: string;
}

export interface FileDetailApi {
	storedId: () => string;
	data: () => FileItem | undefined;
	dataLoading: boolean;
	/** 有旧数据、正在更新（后台刷新）—— 与 dataLoading 互斥 */
	dataRefreshing: boolean;
	dataError: unknown;
	refetch: () => void;
	editing: () => boolean;
	name: () => string;
	setName: (value: string) => void;
	tags: () => string[];
	addTag: (name: string) => void;
	removeTag: (name: string) => void;
	metaEntries: () => MetaEntry[];
	addMetaEntry: () => void;
	removeMetaEntry: (index: number) => void;
	setMetaKey: (index: number, value: string) => void;
	setMetaValue: (index: number, value: string) => void;
	saving: () => boolean;
	formError: () => string;
	/** 切换公开 / 私密（仅 can_edit 时有效） */
	togglePrivate: () => Promise<void>;
	startEdit: () => void;
	cancelEdit: () => void;
	save: () => Promise<void>;
	remove: () => Promise<void>;
	handleBack: () => void;
}

export function useFileDetail(): FileDetailApi {
	const params = useParams();
	const navigate = useNavigate();
	const location = useLocation();
	const storedId = () => String(params.id ?? "");

	// 取数走 useDetailResource：错误消化、无效 id、以及"首次加载 vs 后台刷新"的区分
	// 都在原语里（§4 P1-5 / P1-6，§11.2）。页面（与下面的 calculate/rename 等）沿用
	// 原来的 data / refetch / mutate 名字，改动面最小。
	const resource = useDetailResource({
		id: storedId,
		validate: (v) => v.length > 0,
		invalidIdError: new Error("无效的文件 ID"),
		fetcher: (v) => getFile(v),
	});
	const data = resource.data;
	const refetch = resource.refetch;
	const mutate = resource.mutate;

	// 这里曾经有"同批文件"（从来源 URL 还原列表上下文 → 工具条上的上一个/下一个，
	// 以及图片灯箱的翻页）。已移除：`/file/:id` 是**文件汇集**里的一条，相邻文件之间
	// 没有语义关系（不是相册、不是书），给"下一个"按钮只会让人误以为它们相关。
	// 顺带省掉每次打开详情页都要发一次 listFiles 请求。浏览一组文件请回列表页，
	// 那里的灯箱翻页是按当前筛选结果来的，语义成立。

	const [editing, setEditing] = createSignal(false);
	const [name, setName] = createSignal("");
	const [tags, setTags] = createSignal<string[]>([]);
	const [metaEntries, setMetaEntries] = createSignal<MetaEntry[]>([]);
	const [saving, setSaving] = createSignal(false);
	const [formError, setFormError] = createSignal("");

	const startEdit = () => {
		const f = data();
		if (!f) return;
		setName(f.original_name);
		setTags([...f.tags]);
		setMetaEntries(
			Object.entries(f.meta ?? {}).map(([key, value]) => ({
				key,
				value: String(value),
			})),
		);
		setFormError("");
		setEditing(true);
	};

	const togglePrivate = async () => {
		const item = data();
		if (!item?.can_edit) return;
		const next = !item.is_private;
		// 乐观：立刻翻转可见性（按钮与侧栏马上反映结果），失败再拉回真值
		mutate((prev) => (prev ? { ...prev, is_private: next } : prev));
		setSaving(true);
		setFormError("");
		const result = await tryAsync(() =>
			updateFile(item.stored_id, { is_private: next }),
		);
		setSaving(false);
		if (result.ok) {
			notifySuccess(next ? "已设为私密" : "已设为公开");
		} else {
			refetch();
			setFormError("切换可见性失败");
		}
	};

	const save = async () => {
		const cleanName = name().trim();
		if (!cleanName) {
			setFormError("文件名不能为空");
			return;
		}
		// meta：过滤空 key 行，重复 key 后者覆盖
		const meta: Record<string, string> = {};
		for (const { key, value } of metaEntries()) {
			const k = key.trim();
			if (k) meta[k] = value;
		}
		setSaving(true);
		setFormError("");
		const tagsSnapshot = tags();
		// 乐观：先应用改名 / 标签 / 元信息，退出编辑态即可看到结果
		mutate((prev) =>
			prev
				? {
						...prev,
						original_name: cleanName,
						tags: tagsSnapshot,
						meta,
					}
				: prev,
		);
		setEditing(false);
		const result = await tryAsync(() =>
			updateFile(storedId(), {
				original_name: cleanName,
				tags: tagsSnapshot,
				meta,
			}),
		);
		setSaving(false);
		if (result.ok) {
			notifySuccess("文件信息已更新");
		} else {
			// 回滚到服务端真值，并回到编辑态保留用户输入
			refetch();
			setEditing(true);
			setFormError(getErrorMessage(result.error));
		}
	};

	const remove = async () => {
		let force = false;
		for (;;) {
			const confirmed = await showConfirm({
				title: force ? "强制删除文件" : "删除文件",
				message: force
					? "该文件仍被内容引用，强制删除后引用处将无法显示。仍要删除吗？"
					: `确定删除「${data()?.original_name ?? storedId()}」？此操作不可撤销。`,
				variant: "danger",
			});
			if (!confirmed) return;
			const result = await tryAsync(() => deleteFile(storedId(), force));
			if (result.ok) {
				notifySuccess("文件已删除");
				navigate(PATHS.file);
				return;
			}
			if (result.error instanceof HttpError && result.error.status === 409) {
				force = true;
				continue;
			}
			notifyError("删除文件失败", getErrorMessage(result.error));
			return;
		}
	};

	const handleBack = () => {
		// 回到进入详情时的列表 URL（保留页码与筛选）；直接打开详情则回列表首页
		const state = location.state as { from?: string } | null;
		navigate(state?.from ?? PATHS.file);
	};

	return {
		storedId,
		data,
		/** 只有"还没有数据"时为真：骨架屏该看这个（后台刷新走 dataRefreshing） */
		get dataLoading() {
			return resource.loading();
		},
		/** 有旧数据、正在更新：保留旧内容 + busy 提示，不要渲染骨架 */
		get dataRefreshing() {
			return resource.refreshing();
		},
		get dataError() {
			return resource.error();
		},
		refetch,
		editing,
		name,
		setName,
		tags,
		addTag: (n) => setTags((prev) => (prev.includes(n) ? prev : [...prev, n])),
		removeTag: (n) => setTags((prev) => prev.filter((t) => t !== n)),
		metaEntries,
		addMetaEntry: () =>
			setMetaEntries((prev) => [...prev, { key: "", value: "" }]),
		removeMetaEntry: (index) =>
			setMetaEntries((prev) => prev.filter((_, i) => i !== index)),
		setMetaKey: (index, value) =>
			setMetaEntries((prev) =>
				prev.map((e, i) => (i === index ? { ...e, key: value } : e)),
			),
		setMetaValue: (index, value) =>
			setMetaEntries((prev) =>
				prev.map((e, i) => (i === index ? { ...e, value } : e)),
			),
		saving,
		formError,
		togglePrivate,
		startEdit,
		cancelEdit: () => setEditing(false),
		save,
		remove,
		handleBack,
	};
}

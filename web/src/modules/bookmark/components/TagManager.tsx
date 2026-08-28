/**
 * 标签管理弹窗：列出所有标签（名称 + 使用数），支持全局删除。
 * 使用乐观更新避免删除时 UI 跳动。
 */

import { Button, LoadingSkeleton, Modal } from "@components/ui";
import type { BookmarkTagWithCount } from "@modules/bookmark";
import { deleteBookmarkTagE, searchBookmarkTagsE } from "@modules/bookmark";
import {
	notifyError,
	notifySuccess,
	showConfirm,
	tryAsync,
} from "@shared/utils";
import { createResource, createSignal, For, Show } from "solid-js";
import styles from "./TagManager.module.css";

interface Props {
	isOpen: boolean;
	onClose: () => void;
	/** 标签删除后通知父组件刷新书签列表 */
	onDeleted: () => void;
}

interface TagRowProps {
	tag: BookmarkTagWithCount;
	onDelete: (tag: BookmarkTagWithCount) => void;
}

function TagRow(props: TagRowProps) {
	return (
		<div class={styles.row}>
			<span class={styles.name} title={props.tag.name}>
				{props.tag.name}
			</span>
			<span class={styles.count}>{props.tag.count} 个书签</span>
			<Button
				variant="danger"
				size="sm"
				onClick={() => props.onDelete(props.tag)}
			>
				删除
			</Button>
		</div>
	);
}

interface TagListProps {
	tags: BookmarkTagWithCount[];
	onDelete: (tag: BookmarkTagWithCount) => void;
}

function TagList(props: TagListProps) {
	return (
		<div class={styles.list}>
			<For each={props.tags}>
				{(tag) => <TagRow tag={tag} onDelete={props.onDelete} />}
			</For>
		</div>
	);
}

export default function TagManager(props: Props) {
	// 本地标签列表状态（用于乐观更新）
	const [localTags, setLocalTags] = createSignal<BookmarkTagWithCount[]>([]);
	
	// 每次打开重新加载全部标签
	const [tags, { refetch }] = createResource(
		() => (props.isOpen ? "open" : null),
		async () => {
			const result = await searchBookmarkTagsE("");
			// 同步到本地状态
			setLocalTags(result);
			return result;
		},
	);

	const handleDelete = async (tag: BookmarkTagWithCount) => {
		const confirmed = await showConfirm({
			title: "删除标签",
			message: "确定要删除标签「" + tag.name + "」吗？它将被从 " + tag.count + " 个书签中移除。",
			variant: "danger",
		});
		if (!confirmed) return;

		// 乐观更新：立即从本地列表中移除
		const previousTags = localTags();
		setLocalTags((prev) => prev.filter((t) => t.id !== tag.id));

		// 发送删除请求
		const result = await tryAsync(() => deleteBookmarkTagE(tag.id));
		if (result.ok) {
			notifySuccess("标签已删除");
			// 通知父组件刷新书签列表
			props.onDeleted();
		} else {
			// 删除失败，回滚到之前的状态
			setLocalTags(previousTags);
			notifyError("删除失败", result.error);
		}
	};

	// 计算显示的标签列表：优先使用本地状态，否则使用远程数据
	const displayTags = () => {
		const remoteTags = tags();
		if (remoteTags !== undefined) {
			return localTags();
		}
		return [];
	};

	return (
		<Modal
			isOpen={props.isOpen}
			onClose={props.onClose}
			title="标签管理"
			actions={
				<Button variant="secondary" size="sm" onClick={props.onClose}>
					关闭
				</Button>
			}
		>
			<Show when={tags.loading} fallback={null}>
				<LoadingSkeleton rows={2} />
			</Show>
			<Show
				when={!tags.loading && displayTags().length > 0}
				fallback={
					<div class={styles.state}>
						还没有标签，给书签添加标签后会显示在这里
					</div>
				}
			>
				<TagList tags={displayTags()} onDelete={handleDelete} />
			</Show>
		</Modal>
	);
}
/**
 * 标签管理弹窗：列出所有标签（名称 + 使用数），支持全局删除。
 */

import { Button, Modal } from "@components/ui";
import type { BookmarkTagWithCount } from "@modules/bookmark";
import { deleteBookmarkTagE, searchBookmarkTagsE } from "@modules/bookmark";
import {
	notifyError,
	notifySuccess,
	showConfirm,
	tryAsync,
} from "@shared/utils";
import { createResource, For, Show } from "solid-js";
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
	// 每次打开重新加载全部标签
	const [tags, { refetch }] = createResource(
		() => (props.isOpen ? "open" : null),
		() => searchBookmarkTagsE(""),
	);

	const handleDelete = async (tag: BookmarkTagWithCount) => {
		const confirmed = await showConfirm({
			title: "删除标签",
			message: `确定要删除标签「${tag.name}」吗？它将被从 ${tag.count} 个书签中移除。`,
			variant: "danger",
		});
		if (!confirmed) return;

		const result = await tryAsync(() => deleteBookmarkTagE(tag.id));
		if (result.ok) {
			notifySuccess("标签已删除");
			refetch();
			props.onDeleted();
		} else {
			notifyError("删除失败", result.error);
		}
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
				<div class={styles.state}>加载中…</div>
			</Show>
			<Show
				when={!tags.loading && (tags() ?? []).length > 0}
				fallback={
					<div class={styles.state}>
						还没有标签，给书签添加标签后会显示在这里
					</div>
				}
			>
				<TagList tags={tags() ?? []} onDelete={handleDelete} />
			</Show>
		</Modal>
	);
}

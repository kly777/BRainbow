/**
 * 书签标签输入：把 `bookmark` 的标签接口接到共享 `TagInput` 上。
 * 按名称工作，Enter 直接添加（保存时后端自动创建）；候选行可 hover 删除标签
 * （全局删除，所有书签移除该标签）。
 */

import TagInput, {
	type TagOption,
} from "@components/ui/molecules/TagInput.tsx";
import {
	notifyError,
	notifySuccess,
	showConfirm,
	tryAsync,
} from "@shared/utils";
import { deleteBookmarkTagE, searchBookmarkTagsE } from "../api.ts";

interface Props {
	tags: string[];
	onAdd: (name: string) => void;
	onRemove: (name: string) => void;
	/** 标签被全局删除后通知父组件刷新列表 */
	onTagDeleted?: () => void;
}

export default function BookmarkTagInput(props: Props) {
	/** 全局删除标签：确认 + 提示在这里，候选列表的重取由共享组件按返回值自行处理 */
	const handleDeleteTag = async (tag: TagOption) => {
		const confirmed = await showConfirm({
			title: "删除标签",
			message: `确定要删除标签「${tag.name}」吗？所有书签都会移除该标签。`,
			variant: "danger",
		});
		if (!confirmed) return false;

		const result = await tryAsync(() => deleteBookmarkTagE(tag.id));
		if (!result.ok) {
			notifyError("删除失败", result.error);
			return false;
		}
		notifySuccess("标签已删除");
		props.onTagDeleted?.();
		return true;
	};

	return (
		<TagInput
			selected={props.tags}
			onAdd={props.onAdd}
			onRemove={props.onRemove}
			search={searchBookmarkTagsE}
			showCount
			onDeleteOption={handleDeleteTag}
		/>
	);
}

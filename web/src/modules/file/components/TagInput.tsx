/**
 * 文件标签输入：把 `file` 的标签接口接到共享 `TagInput` 上。
 * 按名称工作，Enter 直接添加（保存时后端自动创建）。
 * file 后端没有标签搜索接口，故走**本地过滤**模式：一次取全量，输入时本地筛选。
 *
 * 候选**由调用方传进来**（不自己取数）：候选列表的拥有者是页面/详情 hook，
 * 见 `FileList.tsx` 与 `useFileDetail.ts` 的说明。
 */

import TagInput from "@components/ui/molecules/TagInput.tsx";
import type { FileTag } from "../api.ts";

interface Props {
	/** 已选标签名 */
	tags: string[];
	/** 全部标签（本地过滤的候选来源） */
	options: readonly FileTag[];
	onAdd: (name: string) => void;
	onRemove: (name: string) => void;
}

export default function FileTagInput(props: Props) {
	return (
		<TagInput
			selected={props.tags}
			onAdd={props.onAdd}
			onRemove={props.onRemove}
			allOptions={() => props.options}
		/>
	);
}

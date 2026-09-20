/**
 * 文件标签输入：把 `file` 的标签接口接到共享 `TagInput` 上。
 * 按名称工作，Enter 直接添加（保存时后端自动创建）。
 * file 后端没有标签搜索接口，故走**本地过滤**模式：一次取全量，输入时本地筛选。
 */

import { TagInput } from "@components/ui";
import { createResource } from "solid-js";
import { type FileTag, listFileTags } from "../api.ts";

interface Props {
	tags: string[];
	onAdd: (name: string) => void;
	onRemove: (name: string) => void;
}

export default function FileTagInput(props: Props) {
	const [tags] = createResource<FileTag[]>(() => listFileTags());
	return (
		<TagInput
			selected={props.tags}
			onAdd={props.onAdd}
			onRemove={props.onRemove}
			allOptions={() => tags()}
		/>
	);
}

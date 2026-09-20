/**
 * 文件标签筛选下拉：把 `file` 的标签接口接到共享 `TagFilter` 上。
 * file 的标签接口无搜索端点、返回带 count（但此处不显示计数）。
 */

import TagFilter from "@components/ui/molecules/TagFilter.tsx";
import { createResource } from "solid-js";
import { type FileTag, listFileTags } from "../api.ts";

interface Props {
	value: string;
	onChange: (tag: string) => void;
}

export default function FileTagFilter(props: Props) {
	const [tags] = createResource<FileTag[]>(() => listFileTags());
	return (
		<TagFilter
			value={props.value}
			onChange={props.onChange}
			options={() => tags()}
		/>
	);
}

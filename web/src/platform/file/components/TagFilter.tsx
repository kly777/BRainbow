/**
 * 文件标签筛选下拉：把 `file` 的标签接口接到共享 `TagFilter` 上。
 * file 的标签接口无搜索端点、返回带 count（但此处不显示计数）。
 *
 * 候选**由页面传进来**（不自己取数）：筛选下拉与标签管理弹窗要用同一份列表，
 * 各自 createResource 的话，管理里改名/删除之后下拉里还是旧标签。
 */

import TagFilter from "@components/ui/molecules/TagFilter.tsx";
import type { FileTag } from "../api.ts";

interface Props {
	value: string;
	onChange: (tag: string) => void;
	/** 标签候选（页面持有，见 FileList.tsx） */
	options: readonly FileTag[];
}

export default function FileTagFilter(props: Props) {
	return (
		<TagFilter
			value={props.value}
			onChange={props.onChange}
			options={() => props.options}
		/>
	);
}

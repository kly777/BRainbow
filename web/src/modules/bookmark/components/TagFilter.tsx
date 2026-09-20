/**
 * 书签筛选下拉：把 `bookmark` 的标签接口接到共享 `TagFilter` 上。
 * 与 file 侧的差异有三处：候选带使用计数、多一个「无标签」项、强调色用模块色。
 */

import TagFilter from "@components/ui/molecules/TagFilter.tsx";
import type { BookmarkTagWithCount } from "@modules/bookmark";
import { searchBookmarkTagsE } from "@modules/bookmark";
import { createResource } from "solid-js";
import styles from "./TagFilter.module.css";

interface Props {
	value: string;
	onChange: (tag: string) => void;
}

/** 「无标签」筛选项的值：与后端约定，书签模块自己解释 */
const UNTAGGED = "__untagged__";

export default function BookmarkTagFilter(props: Props) {
	const [tags] = createResource<BookmarkTagWithCount[]>(() =>
		searchBookmarkTagsE(""),
	);
	return (
		<TagFilter
			class={styles.tone}
			value={props.value}
			onChange={props.onChange}
			options={() => tags()}
			showCount
			untagged={{ value: UNTAGGED, label: "无标签" }}
		/>
	);
}

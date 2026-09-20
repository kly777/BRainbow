// ── 列表里的缩略图（卡片 / 列表行共用） ──
//
// 判定在 lib/thumbnail.ts（纯函数、有测试），这里只负责渲染与降级：
// 图片 → <img>（加载失败也降级成后缀徽章）；私密 → 锁徽章；缺失 → 缺失徽章；
// 其余 → 后缀徽章。

import { File as FileIcon, Lock } from "@components/ui/icons";
import { type Component, createSignal, Match, Show, Switch } from "solid-js";
import type { FileItem } from "../api.ts";
import styles from "../FileList.module.css";
import { fileExt } from "../lib/filename.ts";
import { canThumb } from "../lib/thumbnail.ts";

/** 非图片文件：用后缀名徽章替代通用文件图标，一眼看出类型；
 *  无后缀时回退到通用文件图标 */
export const ExtBadge: Component<{ name: string }> = (props) => (
	<Show
		when={fileExt(props.name)}
		fallback={<FileIcon size={28} class={styles.iconPreview} />}
	>
		{(ext) => <span class={styles.extBadge}>{ext()}</span>}
	</Show>
);

export const FileThumb: Component<{
	item: FileItem;
	/** 缩略图 <img> 的类名（卡片与列表行的尺寸不同，各自传） */
	imgClass: string;
	/** 缺失徽章文案（列表行的缩略图只有 3rem，用短文案） */
	missingText?: string;
	/** 私密徽章只留锁图标（同上，窄格子放不下"私密"二字） */
	lockOnly?: boolean;
}> = (props) => {
	// 加载失败按 stored_id 记录，切到别的文件自动复位
	const [brokenId, setBrokenId] = createSignal<string>();
	const broken = () => brokenId() === props.item.stored_id;

	return (
		<Switch fallback={<ExtBadge name={props.item.original_name} />}>
			<Match when={props.item.missing}>
				<span class={styles.missingBadge}>
					{props.missingText ?? "文件缺失"}
				</span>
			</Match>
			<Match when={props.item.is_private}>
				<span class={styles.privateBadge}>
					<Lock size={12} />
					{props.lockOnly ? null : "私密"}
				</span>
			</Match>
			<Match when={canThumb(props.item) && !broken()}>
				<img
					src={props.item.url}
					alt={props.item.original_name}
					class={props.imgClass}
					loading="lazy"
					onError={() => setBrokenId(props.item.stored_id)}
				/>
			</Match>
		</Switch>
	);
};

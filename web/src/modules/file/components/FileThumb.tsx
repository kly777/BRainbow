// ── 列表里的缩略图（卡片 / 列表行 / 选择器共用） ──
//
// 判定在 lib/thumbnail.ts（能显示）与 lib/thumbTint.ts（该偏什么色，纯函数、有测试），
// 这里只负责渲染与降级：图片 → <img>（加载失败也降级成后缀徽章）；私密 → 锁徽章；
// 缺失 → 缺失徽章；其余 → 后缀徽章 + 类型底色。
//
// 外层那个 .thumb-host 是这一格的"画布"：类型底色、图片淡入、时长角标都挂在它上面，
// 调用方只需给一个固定尺寸的格子（卡片的 16/10 预览区、列表行的 3rem 方框），
// 不必各自实现一遍这些视觉。

import { File as FileIcon, Lock } from "@components/ui/icons";
import { type Component, createSignal, Match, Show, Switch } from "solid-js";
import type { FileItem } from "../api.ts";
import styles from "../FileList.module.css";
import { fileExt } from "../lib/filename.ts";
import { fmtDurationMs } from "../lib/meta.ts";
import { canThumb } from "../lib/thumbnail.ts";
import { shouldTint, tintHue } from "../lib/thumbTint.ts";

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
	/** 是否在右下角压一枚时长角标（只有卡片格子放得下；列表行的元信息里已有） */
	durationBadge?: boolean;
}> = (props) => {
	// 加载失败 / 已加载都按 stored_id 记录，切到别的文件自动复位
	const [brokenId, setBrokenId] = createSignal<string>();
	const [loadedId, setLoadedId] = createSignal<string>();
	const broken = () => brokenId() === props.item.stored_id;
	const loaded = () => loadedId() === props.item.stored_id;
	const markLoaded = () => setLoadedId(props.item.stored_id);

	const tint = () => (shouldTint(props.item) ? tintHue(props.item) : null);
	const duration = () =>
		props.durationBadge ? fmtDurationMs(props.item.duration_ms) : null;

	return (
		<span
			class={styles.thumbHost}
			classList={{ [styles.thumbTinted]: tint() !== null }}
			style={tint() === null ? undefined : { "--thumb-hue": `${tint()}` }}
		>
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
						class={`${props.imgClass} ${styles.fadeImg}`}
						classList={{ [styles.fadeImgIn]: loaded() }}
						loading="lazy"
						decoding="async"
						// 缓存命中时 onLoad 可能早于订阅，用 complete 兜一层：
						// 漏了它就会出现"已经加载完却停在透明"的空白格
						ref={(el) => {
							if (el.complete && el.naturalWidth > 0) markLoaded();
						}}
						onLoad={markLoaded}
						onError={() => setBrokenId(props.item.stored_id)}
					/>
				</Match>
			</Switch>
			<Show when={duration()}>
				{(text) => <span class={styles.durationBadge}>{text()}</span>}
			</Show>
		</span>
	);
};

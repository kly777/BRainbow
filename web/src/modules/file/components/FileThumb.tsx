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
import { useThumbPreview } from "../hooks/useThumbPreview.ts";
import { fileExt } from "../lib/filename.ts";
import { fmtDurationMs } from "../lib/meta.ts";
import {
	canThumb,
	preferContain,
	thumbBackdrop,
	thumbSrc,
	thumbSrcSet,
} from "../lib/thumbnail.ts";
import type { ThumbPreview } from "../lib/thumbPreview.ts";
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
	/** sizes 属性：告诉浏览器这格实际多宽，srcset 才会挑对档（默认按卡片 260px 算） */
	sizes?: string;
	/** 这个格子用得上的宽度档（阶梯子集，别报阶梯外的值） */
	thumbWidths?: readonly number[];
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

	const widths = () => props.thumbWidths ?? CARD_WIDTHS;
	/** 服务端有缩略图就走它（别把原图下给 240px 的格子）；没有就退回原图。
	 *  `src` 取最小档：srcset 由浏览器挑档，这是给不认 srcset 的客户端的保守值 */
	const src = () => {
		const w = widths();
		return thumbSrc(props.item, w[0] ?? 320) ?? props.item.url;
	};
	const srcset = () => thumbSrcSet(props.item, widths()) ?? undefined;
	const backdrop = () =>
		preferContain(props.item) ? thumbBackdrop(props.item) : undefined;
	// 内容缩略（文本片段 / office 封面）：取数是异步的，取不到就一直显示徽章
	const content = useThumbPreview(() => props.item);

	return (
		<span
			class={styles.thumbHost}
			classList={{ [styles.thumbTinted]: tint() !== null }}
			style={tint() === null ? undefined : { "--thumb-hue": `${tint()}` }}
		>
			<Show when={backdrop()}>
				{(bg) => (
					<span
						class={styles.thumbBackdrop}
						style={{ "background-image": bg() }}
					/>
				)}
			</Show>
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
				{/* 文本/代码、office、电子书、压缩包、数据库：取到内容就显示内容 ——
				    比后缀徽章好认得多。取不到（或还在取）时不匹配，落到下面的 ExtBadge */}
				<Match when={content()}>
					{(loaded) => <PreviewContent content={loaded()} />}
				</Match>
				<Match when={canThumb(props.item) && !broken()}>
					<img
						src={src()}
						srcset={srcset()}
						sizes={srcset() ? (props.sizes ?? "260px") : undefined}
						alt={props.item.original_name}
						class={`${props.imgClass} ${styles.fadeImg} ${
							preferContain(props.item) ? styles.imgContain : styles.imgCover
						}`}
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

/** 卡片格子的宽度档：240–300 CSS px 的 1x 与 2x */
const CARD_WIDTHS = [320, 640] as const;

/** 内容缩略的排版：文本/封面是几行等宽小字，表格是前几格的小网格 */
const PreviewContent: Component<{ content: ThumbPreview }> = (props) => (
	<Switch>
		<Match when={props.content.kind === "sheet" ? props.content : undefined}>
			{(sheet) => (
				<span class={styles.thumbSheet}>
					{sheet().rows.flatMap((row) =>
						row.map((cell) => <span class={styles.thumbCell}>{cell}</span>),
					)}
				</span>
			)}
		</Match>
		<Match when={props.content.kind === "text" ? props.content : undefined}>
			{(text) => (
				<span class={styles.thumbText}>
					{text().lines.map((line) => (
						<span class={styles.thumbLine}>{line}</span>
					))}
				</span>
			)}
		</Match>
		<Match when={props.content.kind === "cover" ? props.content : undefined}>
			{(cover) => (
				<span class={styles.thumbText}>
					{cover().lines.map((line) => (
						<span class={styles.thumbLine}>{line}</span>
					))}
				</span>
			)}
		</Match>
	</Switch>
);

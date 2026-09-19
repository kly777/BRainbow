import { Button } from "@components/ui";
import { createEffect, createSignal, For, onCleanup, Show } from "solid-js";
import type { BookChapter } from "../hooks/usePreviewDoc.ts";
import {
	bookProgressKey,
	clampFontScaleIndex,
	FONT_SCALES,
	fontScaleKey,
	parseBookProgress,
	parseFontScaleIndex,
	scrollRatioOf,
	serializeBookProgress,
} from "../lib/bookProgress.ts";
import { parseIndexPayload } from "../lib/viewLink.ts";
import { DocContent } from "./DocContent.tsx";
import { SanitizedHtml } from "./SanitizedHtml.tsx";
import type { ViewerComponent } from "./types.ts";
import styles from "./viewers.module.css";
import { useViewLink } from "./viewLink.ts";

/** 正文章节允许的标签：与后端 `xhtml_to_html` 的白名单一一对应 */
const BOOK_TAGS = [
	"p",
	"h1",
	"h2",
	"h3",
	"h4",
	"h5",
	"h6",
	"strong",
	"em",
	"blockquote",
	"ul",
	"ol",
	"li",
	"br",
	"hr",
	"pre",
];

/** 阅读位置保存的节流（滚动时别每帧都写 localStorage） */
const SAVE_DELAY_MS = 400;
/** 恢复章内位置时的重试：正文经 DOMPurify 异步注入，得等它有高度了才谈得上滚动 */
const RESTORE_TRIES = 12;
const RESTORE_INTERVAL_MS = 50;

/** localStorage 在隐私模式/被禁用时会抛错 —— 阅读位丢了不该让预览挂掉 */
function safeGet(key: string): string | null {
	try {
		return localStorage.getItem(key);
	} catch {
		return null;
	}
}
function safeSet(key: string, value: string): void {
	try {
		localStorage.setItem(key, value);
	} catch {
		// 存不了就算了：下次打开从头开始，不影响本次阅读
	}
}

/**
 * .epub：按阅读顺序一章一屏，翻页用上一章/下一章。
 *
 * 不用页签：一本书几十上百章，页签会挤成一排小字；顺序阅读才是书的用法。
 * 正文与 docx 走同一条"受限 HTML"链路（后端白名单 + 前端 DOMPurify）。
 *
 * 三件让"读下去"成立的事：
 * - **目录**：书名位置是章列表下拉，可直接跳到第 N 章（只有上一章/下一章时，
 *   想回看某一章要点几十次）
 * - **阅读位置**：章号 + 章内滚动比例存 localStorage，下次打开接着读。
 *   只存比例不存像素 —— 换了字号或窗口大小，同一个像素落在完全不同的位置
 * - **字号**：正文按 em 排版，外层设 font-size 就能整体缩放（档位全局生效）
 */
export const EpubViewer: ViewerComponent = (props) => {
	const links = useViewLink();
	// 深链：`?view=epub:12` —— 直接翻到第 13 章。**URL 优先于本地进度**：
	// 别人发来的"这一页"就该落在他说的那一页，而不是我这台设备上次读到的地方
	const [active, setActive] = createSignal(
		parseIndexPayload(links?.state("epub")) ?? 0,
	);
	const [scaleIndex, setScaleIndex] = createSignal(
		parseFontScaleIndex(safeGet(fontScaleKey)),
	);
	let bodyRef: HTMLDivElement | undefined;
	/** 读档/恢复期间不保存：否则恢复的瞬间就把存档覆盖成"第 0 章、位置 0" */
	let restoring = false;
	let saveTimer: ReturnType<typeof setTimeout> | undefined;
	let restoreTimer: ReturnType<typeof setTimeout> | undefined;

	const progressKey = () => bookProgressKey(props.item.stored_id);

	const save = (chapter: number) => {
		if (restoring) return;
		safeSet(
			progressKey(),
			serializeBookProgress({
				chapter,
				ratio: bodyRef ? scrollRatioOf(bodyRef) : 0,
			}),
		);
	};

	const goTo = (chapter: number, total: number) => {
		if (chapter < 0 || chapter >= total || chapter === active()) return;
		save(active()); // 记下离开时那一章的位置
		setActive(chapter);
		links?.setState("epub", chapter); // 深链：让 URL 跟上，刷新/分享落在同一章
	};

	// 换文件：读档（章号）。URL 里明确给了章节就用它（见上面 active 的说明）
	createEffect(() => {
		const saved = parseBookProgress(safeGet(progressKey()));
		restoring = true;
		setActive(saved?.chapter ?? 0);
	});

	/** 把正文滚到存档比例处；正文是异步注入的，所以要等它有可滚动高度 */
	const restoreScroll = (ratio: number) => {
		if (restoreTimer) clearTimeout(restoreTimer);
		let tries = 0;
		const attempt = () => {
			const el = bodyRef;
			const scrollable = el ? el.scrollHeight - el.clientHeight : 0;
			if (el && (scrollable > 0 || tries >= RESTORE_TRIES)) {
				el.scrollTop = scrollable > 0 ? scrollable * ratio : 0;
				restoring = false;
				return;
			}
			tries += 1;
			restoreTimer = setTimeout(attempt, RESTORE_INTERVAL_MS);
		};
		// ratio 为 0 时不必等：直接落在章首
		if (ratio <= 0) {
			restoring = false;
			if (bodyRef) bodyRef.scrollTop = 0;
			return;
		}
		attempt();
	};

	/** 章切换时恢复位置（比例取自存档） */
	const restoreChapter = (chapter: BookChapter | undefined, index: number) => {
		if (!chapter) return;
		const saved = parseBookProgress(safeGet(progressKey()));
		restoring = true;
		// 只有"存的就是当前这一章"时才恢复章内位置
		restoreScroll(saved?.chapter === index ? saved.ratio : 0);
	};

	const onScroll = (chapter: number) => {
		if (restoring) return;
		if (saveTimer) clearTimeout(saveTimer);
		saveTimer = setTimeout(() => save(chapter), SAVE_DELAY_MS);
	};

	onCleanup(() => {
		if (saveTimer) clearTimeout(saveTimer);
		if (restoreTimer) clearTimeout(restoreTimer);
		// 离开页面时把位置定下来（节流里还没落盘的那一次）
		restoring = false;
		save(active());
	});

	const stepScale = (delta: number) => {
		const next = clampFontScaleIndex(scaleIndex() + delta);
		setScaleIndex(next);
		safeSet(fontScaleKey, String(next));
	};

	return (
		<DocContent
			item={props.item}
			kind="book"
			mismatchNote="这个文件不是电子书（服务端给的是别的类型）"
			note={(data) => {
				if (data.kind !== "book") return undefined;
				const byline = [data.title, data.author].filter(Boolean).join(" · ");
				const count = `共 ${data.chapters.length} 章`;
				return [byline, count, data.truncated ? "只显示了前面的章节" : ""]
					.filter(Boolean)
					.join(" · ");
			}}
		>
			{(data) => {
				if (data.kind !== "book") return null;
				const total = data.chapters.length;
				// 越界的存档（书被替换过、旧章号比新书还长）**从头读**，而不是夹到最后一章：
				// 夹到末尾会让人以为"这本书我读完了"，而实际上读的是另一本书的尾部
				const index = active() < total ? active() : 0;
				const chapter = data.chapters[index];
				return (
					<div class={styles.book}>
						<div class={styles.bookBar}>
							<button
								type="button"
								class={styles.bookNav}
								disabled={index === 0}
								onClick={() => goTo(index - 1, total)}
							>
								上一章
							</button>
							{/* 目录：书名位置直接就是章列表，省掉"点几十次下一章" */}
							<select
								class={styles.bookToc}
								aria-label="选择章节"
								value={String(index)}
								onChange={(e) => goTo(Number(e.currentTarget.value), total)}
							>
								<For each={data.chapters}>
									{(item, i) => (
										<option value={String(i())}>
											{i() + 1}. {item.title}
										</option>
									)}
								</For>
							</select>
							<button
								type="button"
								class={styles.bookNav}
								disabled={index >= total - 1}
								onClick={() => goTo(index + 1, total)}
							>
								下一章
							</button>
							<span class={styles.bookFont}>
								<Button
									variant="ghost"
									size="sm"
									title="缩小字号"
									ariaLabel="缩小正文字号"
									disabled={scaleIndex() === 0}
									onClick={() => stepScale(-1)}
								>
									A-
								</Button>
								<Button
									variant="ghost"
									size="sm"
									title="放大字号"
									ariaLabel="放大正文字号"
									disabled={scaleIndex() === FONT_SCALES.length - 1}
									onClick={() => stepScale(1)}
								>
									A+
								</Button>
							</span>
						</div>
						<Show when={chapter}>
							{(current) => (
								<div
									class={styles.bookBody}
									style={{ "font-size": `${FONT_SCALES[scaleIndex()]}em` }}
									onScroll={() => onScroll(index)}
									ref={(el) => {
										bodyRef = el;
										restoreChapter(current(), index);
									}}
								>
									<SanitizedHtml html={current().html} tags={BOOK_TAGS} />
								</div>
							)}
						</Show>
					</div>
				);
			}}
		</DocContent>
	);
};

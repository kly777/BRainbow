import { createSignal, Show } from "solid-js";
import { DocContent } from "./DocContent.tsx";
import { SanitizedHtml } from "./SanitizedHtml.tsx";
import type { ViewerComponent } from "./types.ts";
import styles from "./viewers.module.css";

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

/**
 * .epub：按阅读顺序一章一屏，翻页用上一章/下一章。
 *
 * 不用页签：一本书几十上百章，页签会挤成一排小字；顺序阅读才是书的用法。
 * 正文与 docx 走同一条"受限 HTML"链路（后端白名单 + 前端 DOMPurify）。
 */
export const EpubViewer: ViewerComponent = (props) => {
	const [active, setActive] = createSignal(0);
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
				const index = Math.min(active(), data.chapters.length - 1);
				const chapter = data.chapters[index];
				return (
					<div class={styles.book}>
						<div class={styles.bookBar}>
							<button
								type="button"
								class={styles.bookNav}
								disabled={index === 0}
								onClick={() => setActive(index - 1)}
							>
								上一章
							</button>
							<span class={styles.bookTitle}>{chapter?.title}</span>
							<button
								type="button"
								class={styles.bookNav}
								disabled={index >= data.chapters.length - 1}
								onClick={() => setActive(index + 1)}
							>
								下一章
							</button>
						</div>
						<Show when={chapter}>
							{(current) => (
								<SanitizedHtml html={current().html} tags={BOOK_TAGS} />
							)}
						</Show>
					</div>
				);
			}}
		</DocContent>
	);
};

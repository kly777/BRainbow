import { type Component, createEffect, createSignal } from "solid-js";
import { DocContent } from "./DocContent.tsx";
import type { ViewerComponent } from "./types.ts";
import styles from "./viewers.module.css";

/**
 * 正文 HTML 的标签白名单：与后端 docx 解析器的输出一一对应（多一个都不放行）
 */
const ALLOWED_TAGS = [
	"p",
	"h1",
	"h2",
	"h3",
	"h4",
	"h5",
	"h6",
	"strong",
	"em",
	"br",
	"table",
	"tbody",
	"tr",
	"td",
];

/**
 * 正文渲染。
 *
 * HTML 由后端解析（只吐白名单标签、文本已转义），这里**再过一次 DOMPurify** ——
 * 这是全仓唯一一处把服务端字符串直接 innerHTML 的地方，两道防线不嫌多。
 * DOMPurify 与 markdown 工具链同属懒加载 chunk（dynamic import），
 * 不能静态 import：注册表是全量静态引入的，那会把它拉进首屏同步链。
 */
const DocxBody: Component<{ html: string }> = (props) => {
	const [clean, setClean] = createSignal("");
	createEffect(() => {
		const html = props.html;
		void (async () => {
			const { default: DOMPurify } = await import("dompurify");
			setClean(DOMPurify.sanitize(html, { ALLOWED_TAGS, ALLOWED_ATTR: [] }));
		})();
	});
	return <div class={styles.markdown} innerHTML={clean()} />;
};

/** .docx：服务端把正文转成受限 HTML，这里按排版渲染（要原文可下载） */
export const DocxViewer: ViewerComponent = (props) => (
	<DocContent
		item={props.item}
		kind="docx"
		mismatchNote="这个文件不是 Word 文档（服务端给的是表格数据）"
		note={(data) =>
			data.kind === "docx" && data.truncated
				? "文档较长，仅显示了开头部分（下载可查看完整内容）"
				: undefined
		}
	>
		{(data) => (data.kind === "docx" ? <DocxBody html={data.html} /> : null)}
	</DocContent>
);

import { DocContent } from "./DocContent.tsx";
import { SanitizedHtml } from "./SanitizedHtml.tsx";
import type { ViewerComponent } from "./types.ts";

/**
 * 正文 HTML 的标签白名单：与后端 docx 解析器的输出一一对应（多一个都不放行）
 */
const DOCX_TAGS = [
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
		{(data) =>
			data.kind === "docx" ? (
				<SanitizedHtml html={data.html} tags={DOCX_TAGS} />
			) : null
		}
	</DocContent>
);

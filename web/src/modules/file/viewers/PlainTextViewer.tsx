import { PreBlock } from "./PreBlock.tsx";
import { TextContent } from "./TextContent.tsx";
import type { ViewerComponent } from "./types.ts";

/**
 * 纯文本（txt/pre/log/字幕…）：等宽渲染，原样保留空白与换行。
 *
 * 用 PreBlock 而不是裸 `<pre>`：行号 + 换行开关 + 复制全文（大日志看行号、复制一段输出
 * 都是高频操作）。见 PreBlock 里关于"行号为什么不用 <ol>"的说明。
 */
export const PlainTextViewer: ViewerComponent = (props) => (
	<TextContent item={props.item}>
		{(text) => <PreBlock text={text} />}
	</TextContent>
);

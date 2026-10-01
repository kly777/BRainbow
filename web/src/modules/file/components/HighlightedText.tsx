import { highlightKeywords } from "@shared/utils";
import { type Component, Show } from "solid-js";

/**
 * 命中词高亮的一层薄壳：有查询且命中时注入 `<mark>`（helper 先转义再插标签），
 * 其余情况退回纯文本。
 *
 * **空串必须走退回分支**：`highlightKeywords` 在"没查询 / 空文本 / 没得高亮"时
 * 返回空串，直接塞进 `innerHTML` 会让文字整段消失（文件名变空白）。
 * 卡片与列表行共用这一处，免得两边各写一遍 `Show` 忘了兜底。
 */
const HighlightedText: Component<{ text: string; query: string }> = (props) => (
	<Show when={highlightKeywords(props.text, props.query)} fallback={props.text}>
		{(html) => <span innerHTML={html()} />}
	</Show>
);

export default HighlightedText;

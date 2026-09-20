// ── 受限 HTML 的渲染壳（docx 与 epub 共用）──
//
// 这是唯一一处把**服务端给的字符串**直接 innerHTML 的地方，所以两道防线：
// 后端只吐白名单标签、文本一律转义；前端再过一次 DOMPurify。
//
// DOMPurify 与 markdown 工具链同属懒加载 chunk（dynamic import）——注册表是全量静态
// 引入的，静态 import 会把整条 markdown 工具链拉进首屏同步链。

import { type Component, createEffect, createSignal } from "solid-js";
import styles from "./viewers.module.css";

export const SanitizedHtml: Component<{
	html: string;
	/** 允许出现的标签（与后端解析器的输出一一对应，多一个都不放行） */
	tags: readonly string[];
}> = (props) => {
	const [clean, setClean] = createSignal("");
	createEffect(() => {
		const html = props.html;
		const tags = [...props.tags];
		void (async () => {
			const { default: DOMPurify } = await import("dompurify");
			setClean(
				DOMPurify.sanitize(html, { ALLOWED_TAGS: tags, ALLOWED_ATTR: [] }),
			);
		})();
	});
	return <div class={styles.markdown} innerHTML={clean()} />;
};

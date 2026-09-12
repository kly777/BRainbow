/**
 * 文本类文件预览：txt/pre、markdown 渲染、csv 表格、html 沙箱渲染。
 * 内容经 fetch 拉取（文件路由公开），超过 2MB 截断预览。
 */

import { Markdown } from "@components/ui";
import { buildHeaders } from "@shared/api";
import {
	type Component,
	createMemo,
	createResource,
	For,
	onCleanup,
	Show,
} from "solid-js";
import type { FileItem } from "../api.ts";
import { parseCsv } from "../lib/csv.ts";
import { codeFence, codeLang } from "../lib/filename.ts";
import styles from "./TextPreview.module.css";

/** 预览截断阈值（字符数） */
const MAX_PREVIEW_CHARS = 2 * 1024 * 1024;
/** 语法高亮阈值：超过此长度交给纯文本渲染，避免高亮大文件卡住主线程 */
const MAX_HIGHLIGHT_CHARS = 100_000;
/** 表格渲染行数上限（防超宽表卡死渲染） */
const MAX_TABLE_ROWS = 500;

interface LoadedText {
	text: string;
	truncated: boolean;
}

const CsvTable: Component<{ text: string }> = (props) => {
	const rows = createMemo(() => parseCsv(props.text).slice(0, MAX_TABLE_ROWS));
	return (
		<div class={styles.tableWrap}>
			<table class={styles.table}>
				<tbody>
					<For each={rows()}>
						{(row) => (
							<tr>
								<For each={row}>
									{(cell) => <td class={styles.tableCell}>{cell}</td>}
								</For>
							</tr>
						)}
					</For>
				</tbody>
			</table>
		</div>
	);
};

const TextPreview: Component<{ item: FileItem }> = (props) => {
	let controller: AbortController | undefined;
	onCleanup(() => controller?.abort());

	/** 代码语言（按扩展名/文件名判断；空串表示按纯文本展示） */
	const lang = () => codeLang(props.item.original_name);

	const [content] = createResource(
		() => props.item.stored_id,
		async (): Promise<LoadedText> => {
			controller = new AbortController();
			// URL 取自接口响应（不再本地拼接）；私密文件的内容接口需要凭据
			const resp = await fetch(props.item.url, {
				signal: controller.signal,
				headers: buildHeaders(),
			});
			if (!resp.ok) {
				throw new Error(`加载失败（HTTP ${resp.status}）`);
			}
			const text = await resp.text();
			const truncated = text.length > MAX_PREVIEW_CHARS;
			return {
				text: truncated ? text.slice(0, MAX_PREVIEW_CHARS) : text,
				truncated,
			};
		},
	);

	return (
		<div class={styles.pane}>
			<Show when={content.loading}>
				<div class={styles.state}>加载中…</div>
			</Show>
			<Show when={content.error}>
				<div class={styles.state}>预览失败：{content.error.message}</div>
			</Show>
			<Show when={content()}>
				{(c) => (
					<>
						<Show when={props.item.mime_type === "text/html"}>
							{/* sandbox：禁脚本/禁同源，仅渲染，防 HTML 文件 XSS */}
							<iframe
								class={styles.htmlFrame}
								sandbox=""
								srcdoc={c().text}
								title="HTML 预览"
							/>
						</Show>
						<Show when={props.item.mime_type === "text/csv"}>
							<CsvTable text={c().text} />
						</Show>
						<Show when={props.item.mime_type === "text/markdown"}>
							<div class={styles.markdown}>
								<Markdown content={c().text} />
							</div>
						</Show>
						{/* 代码/配置类：按扩展名识别（这些扩展名浏览器不给 MIME，
						    上传后归入 other 类别），复用 Markdown 的代码块渲染拿到
						    语法高亮与主题，无需另引高亮库 */}
						<Show
							when={
								!["text/html", "text/csv", "text/markdown"].includes(
									props.item.mime_type,
								) && lang() !== ""
							}
						>
							<div class={styles.markdown}>
								<Show
									when={c().text.length <= MAX_HIGHLIGHT_CHARS}
									fallback={<pre class={styles.pre}>{c().text}</pre>}
								>
									<Markdown content={codeFence(c().text, lang() ?? "")} />
								</Show>
							</div>
						</Show>
						<Show
							when={
								!["text/html", "text/csv", "text/markdown"].includes(
									props.item.mime_type,
								) && lang() === ""
							}
						>
							<pre class={styles.pre}>{c().text}</pre>
						</Show>
						<Show when={c().truncated}>
							<div class={styles.truncateNote}>
								内容过大，仅预览前 2MB（下载可查看完整内容）
							</div>
						</Show>
					</>
				)}
			</Show>
		</div>
	);
};

export default TextPreview;

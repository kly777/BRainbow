import { Button } from "@components/ui";
import { formatBytes } from "@shared/utils";
import { createEffect, createSignal, For, Show } from "solid-js";
import {
	HEX_SEGMENT_BYTES,
	usePreviewBytes,
} from "../hooks/usePreviewBytes.ts";
import { hexRows, sniffKind } from "../lib/magic.ts";
import { PreviewError } from "./PreviewError.tsx";
import { PreviewState } from "./PreviewState.tsx";
import type { ViewerComponent } from "./types.ts";
import styles from "./viewers.module.css";

/** 偏移量的显示（8 位十六进制，与 hexRows 的左侧列同格式） */
const hexOffset = (value: number) => value.toString(16).padStart(8, "0");

/**
 * 二进制兜底查看器：白名单外、也认不出是文本的格式（设计稿、未知格式…）。
 * 看文件头就能回答"这文件到底是什么"，而不是只给一个"下载"按钮。
 *
 * 内容按 `Range` 分段取（见 usePreviewBytes）：文件多大都能看，翻页取下一段 ——
 * 早先有"超过 2MB 就不给看"的闸门，那会让 `.psd` / `.las` 这类连文件头都看不到。
 * 骨架与文本查看器一致：内容获取交给 hook，这里只负责排版与翻页。
 */
export const HexViewer: ViewerComponent = (props) => {
	const [offset, setOffset] = createSignal(0);
	// 换文件时回到第一段：资源键里带着 offset，不复位就会拿新文件的旧偏移去取
	createEffect(() => {
		props.item.stored_id;
		setOffset(0);
	});
	const { content, error, retry } = usePreviewBytes(() => props.item, offset);
	const step = (delta: number) =>
		setOffset((current) => Math.max(0, current + delta * HEX_SEGMENT_BYTES));

	return (
		<div class={styles.hexPane}>
			<Show when={content.loading}>
				{/* 说清在读哪一段、文件多大（翻页时"加载中…"会看不出在读第几段） */}
				<PreviewState
					loading
					message={`正在读取第 ${Math.floor(offset() / HEX_SEGMENT_BYTES) + 1} 段（共 ${formatBytes(props.item.size_bytes)}）…`}
				/>
			</Show>
			<Show when={error()}>
				{(info) => (
					<PreviewError item={props.item} error={info()} onRetry={retry} />
				)}
			</Show>
			{/* 翻页时 content() 是"真值换成另一个真值"，这里用 children 的 accessor（c()）
			    而不是解构出来的值读它 —— 解构会把每次翻页都冻在第一次的偏移上 */}
			<Show when={content()}>
				{(c) => (
					<>
						{/* 「文件头」的结论只对第一段成立（签名都在文件开头） */}
						<Show when={c().offset === 0}>
							<p class={styles.hexVerdict}>文件头：{sniffKind(c().data)}</p>
						</Show>
						<pre class={styles.hexDump}>
							<For each={hexRows(c().data, c().offset)}>
								{(row) => (
									<div class={styles.hexRow}>
										<span class={styles.hexOffset}>{row.offset}</span>
										<span class={styles.hexBytes}>{row.hex}</span>
										<span class={styles.hexAscii}>{row.ascii}</span>
									</div>
								)}
							</For>
						</pre>
						<div class={styles.hexPager}>
							<Button
								variant="secondary"
								size="sm"
								disabled={c().offset === 0}
								onClick={() => step(-1)}
							>
								上一段
							</Button>
							<span class={styles.truncateNote}>
								{hexOffset(c().offset)}–
								{hexOffset(c().offset + c().data.length)}
								{" / 共 "}
								{formatBytes(c().totalBytes)}
							</span>
							<Button
								variant="secondary"
								size="sm"
								disabled={!c().hasMore}
								onClick={() => step(1)}
							>
								下一段
							</Button>
						</div>
					</>
				)}
			</Show>
		</div>
	);
};

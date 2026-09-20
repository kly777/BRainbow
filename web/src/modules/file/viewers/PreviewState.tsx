// ── 预览区的状态块（加载中 / 空 / 不可用 / 出错 / 内容丢失） ──
//
// 此前这些状态各写各的：`.state` 一行灰字、`.preview-fallback` 大图标 + 文件名 + 下载、
// `.preview-error` 又一套（原因 + 重试 + 下载）、`.preview-missing-*` 再来一套。
// 结果是同一个"这一格没内容"在五种地方长相不同，改一次要改五处。
//
// 这里收成一个原语，只保留三种必要的差异：
//   - `tone`：muted（加载/空）· warning（不可用/丢失）· error（失败）
//   - `icon`：可换（转子 / 文件 / 警告 / 缺失）
//   - `actions`：按钮区（重试 / 下载 / 载入更多…）
//
// **截断提示不在这里**：它是贴着内容的一块横条（左侧说明 + 右侧按钮），
// 与"把整格占满的居中状态"是两种布局，硬合并会让两边都变差（见 `.truncate-note`）。

import { Loader2 } from "@components/ui/icons";
import { type Component, type JSX, Show } from "solid-js";
import styles from "./viewers.module.css";

export type NoticeTone = "muted" | "warning" | "error";

const toneClass: Record<NoticeTone, string> = {
	muted: styles.stateMuted,
	warning: styles.stateWarning,
	error: styles.stateError,
};

export const PreviewState: Component<{
	/** 主文案（必填：状态块的存在就是为了说清发生了什么） */
	message: string;
	/** 补充说明 */
	hint?: string;
	/** 图标；不传就是纯文字（`loading` 时自动用转子） */
	icon?: JSX.Element;
	/** 这一格正在加载：出转子并让读屏播报 */
	loading?: boolean;
	tone?: NoticeTone;
	/** 按钮区 */
	children?: JSX.Element;
}> = (props) => (
	<div
		class={`${styles.previewState} ${toneClass[props.tone ?? "muted"]}`}
		// role：加载中是"状态"（会被读屏播报但不打断），出错是"警报"
		role={props.tone === "error" ? "alert" : "status"}
	>
		<Show when={props.loading}>
			<Loader2 size={24} class={styles.previewStateSpin} aria-hidden="true" />
		</Show>
		<Show when={!props.loading && props.icon}>
			{(icon) => <span class={styles.previewStateIcon}>{icon()}</span>}
		</Show>
		<p class={styles.previewStateMessage}>{props.message}</p>
		<Show when={props.hint}>
			{(hint) => <p class={styles.previewStateHint}>{hint()}</p>}
		</Show>
		<Show when={props.children}>
			{(actions) => <div class={styles.previewStateActions}>{actions()}</div>}
		</Show>
	</div>
);

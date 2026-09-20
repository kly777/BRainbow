// ── 音视频的播放条：倍速 + 续播提示 ──
//
// 原生控件已经管了播放/进度/音量，这里只补原生没有的两件：**倍速**（0.5×~2×）与
// **"已跳到上次位置"的说明**（否则用户会以为播放器出错了：一打开就从中间开始）。
// video 与 audio 共用，行为逻辑在 hooks/useMediaPlayback.ts。

import type { Component } from "solid-js";
import { Show } from "solid-js";
import type { MediaPlayback } from "../hooks/useMediaPlayback.ts";
import styles from "./viewers.module.css";

export const MediaBar: Component<{ playback: MediaPlayback }> = (props) => (
	<div class={styles.mediaBar}>
		<span class={styles.mediaSpeed}>
			<button
				type="button"
				class={styles.mediaSpeedBtn}
				title="减速"
				aria-label="降低播放速度"
				onClick={() => props.playback.stepSpeed(-1)}
			>
				−
			</button>
			<span class={styles.mediaSpeedValue}>{props.playback.speed()}×</span>
			<button
				type="button"
				class={styles.mediaSpeedBtn}
				title="加速"
				aria-label="提高播放速度"
				onClick={() => props.playback.stepSpeed(1)}
			>
				+
			</button>
		</span>
		<Show when={props.playback.resumed()}>
			<span class={styles.mediaResumed}>已跳到上次的播放位置</span>
		</Show>
	</div>
);

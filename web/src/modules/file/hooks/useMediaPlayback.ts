// ── 音视频播放：倍速与进度记忆（video / audio 共用） ──
//
// 两个查看器只差一个元素名（`<video>` / `<audio>`），行为完全一样，所以逻辑收在这里：
// 挂事件、按时写档、按档设置 playbackRate。查看器只负责把 ref 交进来。
//
// 写档用 `timeupdate`（浏览器约每 250ms 一次）+ 节流：写 localStorage 是同步的，
// 每 250ms 写一次会拖慢播放。

import { createEffect, createSignal, onCleanup } from "solid-js";
import type { FileItem } from "../api.ts";
import {
	clampSpeedIndex,
	type MediaKind,
	parsePosition,
	parseSpeedIndex,
	positionKey,
	resumeAt,
	SPEED_STEPS,
	speedKey,
	worthSaving,
} from "../lib/mediaPlayback.ts";

/** 两次写档之间至少间隔（毫秒） */
const SAVE_INTERVAL_MS = 5000;
/** "已跳到上次位置"的提示显示多久 */
const RESUMED_HINT_MS = 5000;

function safeGet(key: string): string | null {
	try {
		return localStorage.getItem(key);
	} catch {
		return null;
	}
}
function safeSet(key: string, value: string): void {
	try {
		localStorage.setItem(key, value);
	} catch {
		// 存不了就算了：下次从头播，不影响本次
	}
}
function safeRemove(key: string): void {
	try {
		localStorage.removeItem(key);
	} catch {
		// 同上
	}
}

export interface MediaPlayback {
	/** 当前倍速（1 = 原速） */
	speed: () => number;
	/** 刚跳到上次的位置（给用户一句说明，几秒后自动消失） */
	resumed: () => boolean;
	/** 调一档倍速（到头停住） */
	stepSpeed: (delta: 1 | -1) => void;
	/** 交给 `<video>` / `<audio>` 的 ref */
	setRef: (el: HTMLMediaElement) => void;
}

export function useMediaPlayback(
	item: () => FileItem,
	kind: MediaKind,
): MediaPlayback {
	const [speedIndex, setSpeedIndex] = createSignal(
		parseSpeedIndex(safeGet(speedKey)),
	);
	const [resumed, setResumed] = createSignal(false);
	let el: HTMLMediaElement | undefined;
	let lastSaved = 0;
	let hintTimer: ReturnType<typeof setTimeout> | undefined;

	const key = () => positionKey(kind, item().stored_id);

	const saveProgress = () => {
		const media = el;
		if (!media) return;
		if (!worthSaving(media.currentTime, media.duration)) return;
		safeSet(key(), String(media.currentTime));
		lastSaved = Date.now();
	};

	/** 离开页面时定档：位置有意义就存，已在片尾就把旧档清掉（下次从头播） */
	const finalize = () => {
		const media = el;
		if (!media) return;
		if (worthSaving(media.currentTime, media.duration)) {
			safeSet(key(), String(media.currentTime));
		} else {
			safeRemove(key());
		}
	};

	/** 续播：元数据到了才知道时长，也才判断得出"存档是不是已经到片尾了" */
	const onLoadedMetadata = () => {
		const media = el;
		if (!media) return;
		media.playbackRate = SPEED_STEPS[speedIndex()];
		const at = resumeAt(parsePosition(safeGet(key())), media.duration);
		if (at <= 0) return;
		media.currentTime = at;
		setResumed(true);
		if (hintTimer) clearTimeout(hintTimer);
		hintTimer = setTimeout(() => setResumed(false), RESUMED_HINT_MS);
	};

	const onTimeUpdate = () => {
		if (Date.now() - lastSaved < SAVE_INTERVAL_MS) return;
		saveProgress();
	};

	const setRef = (media: HTMLMediaElement) => {
		el = media;
		media.playbackRate = SPEED_STEPS[speedIndex()];
		media.addEventListener("loadedmetadata", onLoadedMetadata);
		media.addEventListener("timeupdate", onTimeUpdate);
		media.addEventListener("pause", saveProgress);
		onCleanup(() => {
			media.removeEventListener("loadedmetadata", onLoadedMetadata);
			media.removeEventListener("timeupdate", onTimeUpdate);
			media.removeEventListener("pause", saveProgress);
		});
	};

	// 换文件：收起提示（新元素会重新触发 loadedmetadata）
	createEffect(() => {
		void item().stored_id;
		setResumed(false);
	});

	// 倍速是全局偏好：改了立刻作用到当前元素并落盘
	createEffect(() => {
		const index = clampSpeedIndex(speedIndex());
		if (el) el.playbackRate = SPEED_STEPS[index];
		safeSet(speedKey, String(index));
	});

	onCleanup(() => {
		if (hintTimer) clearTimeout(hintTimer);
		finalize();
	});

	return {
		speed: () => SPEED_STEPS[clampSpeedIndex(speedIndex())],
		resumed,
		stepSpeed: (delta) => setSpeedIndex((i) => clampSpeedIndex(i + delta)),
		setRef,
	};
}

// ── 音视频的播放偏好：倍速与播放进度（纯函数 + localStorage 键） ──
//
// 两件"看长视频/听播客"离不开的事：
// - **倍速**：全局偏好（不随文件变），按固定档位循环，避免出现 1.13× 这种零碎值
// - **播放进度**：按文件存秒数。key 上带 kind（video/audio），因为同一 stored_id
//   只可能是一种，但两类媒体用同一个键空间更容易排查
//
// 进度有两个必须的护栏：**太靠后就从头播**（一部片子的最后一分钟多半是片尾），
// 以及**超出时长的旧记录丢弃**（文件被替换成更短的版本时不能跳到不存在的秒数）。

/** 倍速档位（0.5× ~ 2×，覆盖听播客与看教程两侧的常见需求） */
export const SPEED_STEPS = [0.5, 0.75, 1, 1.25, 1.5, 2] as const;
export const DEFAULT_SPEED_INDEX = 2; // 1×

/** 播放到离结尾这么近时，下次从头播而不是接着播（片尾/谢幕） */
export const NEAR_END_SECONDS = 15;
/** 剩余比例小于这个也算"到结尾了"（长片子只看这 15 秒不够判断） */
export const NEAR_END_RATIO = 0.02;

export type MediaKind = "video" | "audio";

export const speedKey = "file:media:speed";
export const positionKey = (kind: MediaKind, storedId: string) =>
	`file:media:${kind}:${storedId}`;

export function clampSpeedIndex(value: number): number {
	if (!Number.isInteger(value)) return DEFAULT_SPEED_INDEX;
	return Math.min(SPEED_STEPS.length - 1, Math.max(0, value));
}

export function parseSpeedIndex(raw: string | null): number {
	if (raw === null) return DEFAULT_SPEED_INDEX;
	return clampSpeedIndex(Number.parseInt(raw, 10));
}

/** 切换档位（到头就停住，按钮据此置灰） */
export function stepSpeedIndex(current: number, direction: 1 | -1): number {
	return clampSpeedIndex(current + direction);
}

/** 解析存档的秒数；非法/负数一律当作没有 */
export function parsePosition(raw: string | null): number | undefined {
	if (!raw) return undefined;
	const seconds = Number.parseFloat(raw);
	if (!Number.isFinite(seconds) || seconds < 0) return undefined;
	return seconds;
}

/**
 * 该从哪一秒继续播。
 *
 * 返回 0 的三种情况：没有存档、存档超出时长（文件被换成更短的）、
 * 存档已在结尾附近（片尾曲不该再放一遍）。
 */
export function resumeAt(
	saved: number | undefined,
	durationSeconds: number,
): number {
	if (saved === undefined || saved <= 0) return 0;
	// 时长未知（元数据还没到）时不要急着跳到某个位置
	if (!Number.isFinite(durationSeconds) || durationSeconds <= 0) return saved;
	if (saved >= durationSeconds - NEAR_END_SECONDS) return 0;
	if (saved / durationSeconds >= 1 - NEAR_END_RATIO) return 0;
	return saved;
}

/** 是否值得把当前位置写进存档（开头几秒不写，省得一进去就产生一条"看过"记录） */
export function worthSaving(
	currentSeconds: number,
	durationSeconds: number,
): boolean {
	if (!Number.isFinite(currentSeconds) || currentSeconds < 5) return false;
	if (Number.isFinite(durationSeconds) && durationSeconds > 0) {
		return resumeAt(currentSeconds, durationSeconds) !== 0;
	}
	return true;
}

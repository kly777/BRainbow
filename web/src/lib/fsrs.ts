/**
 * FSRS 前端调度器（与后端保持一致的算法）
 * 用于预览评分后的下次复习时间
 */

const W = [
    1.0, 1.0, 5.0,
    0.9, 0.9, 1.0, 1.2, 2.0,
    0.2, 0.6, 2.0, 0.4, 2.5,
    0.5, 0.4, 0.4, 1.0, 2.0, 0.1,
];

function clamp01(n: number) { return Math.max(0, Math.min(1, n)); }

function initD(r: number) { return clamp01(W[4] - W[5] * (r - 3)); }
function initS(r: number) { return Math.max(0.1, W[0] + W[1] * Math.max(0, r - 1)); }
function nextD(d: number, r: number) { return clamp01(d + (-W[6] * (r - 3)) * (1 - d)); }
function nextS(s: number, d: number, r: number) {
    if (r === 1) return s * W[8] + W[7] * (1 - W[8]);
    return s * (1 + W[9] * Math.max(0, r - 2) * (1 - d));
}
function intervalDays(s: number) { return Math.max(0.016, s * 9); }

export interface FsrsState {
    state: string;
    stability: number;
    difficulty: number;
}

/** 返回 { 1: "1分钟后", 2: "1天后", ... } 的估算文本 */
export function previewDue(
    state: string,
    stability: number,
    difficulty: number,
): Record<number, string> {
    const result: Record<number, string> = {};
    for (const r of [1, 2, 3, 4]) {
        let s: number;
        let d: number;
        if (state === "new" || state === "learning") {
            d = initD(r);
            s = initS(r);
        } else {
            d = nextD(difficulty, r);
            s = nextS(stability, d, r);
        }
        const days = intervalDays(s);
        result[r] = formatInterval(days);
    }
    return result;
}

function formatInterval(days: number): string {
    if (days < 1 / 24) return "< 1分钟";
    if (days < 1) {
        const mins = Math.round(days * 1440);
        return `${mins}分钟`;
    }
    if (days < 30) {
        return `${Math.round(days)}天`;
    }
    const months = Math.round(days / 30);
    return `${months}个月`;
}

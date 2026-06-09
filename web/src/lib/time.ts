/** 统一时间处理 */

/** 解析可能有缺 Z 的 UTC 时间字符串 */
export function parseUtc(ts: string): Date {
    if (!ts.endsWith("Z") && !ts.includes("+") && !ts.includes("-", 10)) {
        return new Date(`${ts}Z`);
    }
    return new Date(ts);
}

/** 格式化为本地时间 "06/10 22:00" */
export function fmtLocal(ts: string): string {
    return parseUtc(ts).toLocaleString("zh-CN", {
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
    });
}

/** 格式化为相对时间 "3天后" / "已到期" */
export function fmtRelative(ts: string): string {
    const d = parseUtc(ts);
    const diff = (d.getTime() - Date.now()) / 1000;
    if (diff < 0) return `已到期 (${fmtLocal(ts)})`;
    if (diff < 120) return "1分钟";
    if (diff < 3600) return `${Math.round(diff / 60)}分钟`;
    if (diff < 86400) return `${Math.round(diff / 3600)}小时`;
    return `${Math.round(diff / 86400)}天后`;
}

/** 秒数 → 人类可读 "3天" / "1分钟" */
export function fmtInterval(secs: number): string {
    if (secs < 120) return "1分钟";
    if (secs < 3600) return `${Math.round(secs / 60)}分钟`;
    if (secs < 86400) return `${Math.round(secs / 3600)}小时`;
    if (secs < 2592000) return `${Math.round(secs / 86400)}天`;
    return `${Math.round(secs / 2592000)}个月`;
}

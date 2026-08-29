/**
 * 根据当前时间返回问候语。
 * 6 个时段：凌晨 / 早上 / 上午 / 中午 / 下午 / 晚上。
 */
export function getGreeting(): string {
	const h = new Date().getHours();
	if (h < 5) return "凌晨好";
	if (h < 9) return "早上好";
	if (h < 12) return "上午好";
	if (h < 14) return "中午好";
	if (h < 18) return "下午好";
	return "晚上好";
}

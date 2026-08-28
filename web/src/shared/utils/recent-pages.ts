// ── 最近访问页面追踪 ──

const STORAGE_KEY = "brainbow:recent-pages";
const MAX_RECENT = 5;

export function getRecentPages(): string[] {
	try {
		const raw = localStorage.getItem(STORAGE_KEY);
		if (!raw) return [];
		const parsed = JSON.parse(raw);
		return Array.isArray(parsed)
			? parsed.filter((s) => typeof s === "string")
			: [];
	} catch {
		return [];
	}
}

export function addRecentPage(path: string): void {
	const recent = getRecentPages().filter((p) => p !== path);
	recent.unshift(path);
	if (recent.length > MAX_RECENT) recent.length = MAX_RECENT;
	try {
		localStorage.setItem(STORAGE_KEY, JSON.stringify(recent));
	} catch {
		// storage full, ignore
	}
}

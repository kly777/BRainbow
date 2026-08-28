const STORAGE_KEY = "brainbow:search-history";
const MAX_HISTORY = 10;

export function getSearchHistory(): string[] {
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

export function addToSearchHistory(query: string): void {
	const q = query.trim();
	if (!q) return;
	const history = getSearchHistory().filter((s) => s !== q);
	history.unshift(q);
	if (history.length > MAX_HISTORY) history.length = MAX_HISTORY;
	try {
		localStorage.setItem(STORAGE_KEY, JSON.stringify(history));
	} catch {
		// storage full, ignore
	}
}

export function removeFromSearchHistory(query: string): void {
	const history = getSearchHistory().filter((s) => s !== query);
	try {
		localStorage.setItem(STORAGE_KEY, JSON.stringify(history));
	} catch {
		// ignore
	}
}

export function clearSearchHistory(): void {
	try {
		localStorage.removeItem(STORAGE_KEY);
	} catch {
		// ignore
	}
}

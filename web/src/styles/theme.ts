/**
 * theme.ts — 主题切换逻辑（纯函数，localStorage 持久化）
 *
 * 主题通过 <html data-theme="paper|midnight|ocean"> 生效，
 * 变量定义见 styles/tokens.css。
 */
export const themes = {
	paper: { label: "暖纸 · 目录绿", swatches: ["oklch(0.99 0.004 95)", "oklch(0.52 0.1 165)"] },
	midnight: { label: "暗夜 · 墨绿", swatches: ["oklch(0.21 0.014 260)", "oklch(0.68 0.12 165)"] },
	ocean: { label: "冷蓝 · 晴空", swatches: ["oklch(0.99 0.003 250)", "oklch(0.55 0.18 255)"] },
} as const;

export type ThemeName = keyof typeof themes;

const KEY = "brainbow_theme";
const VALID = Object.keys(themes) as ThemeName[];

/** 读取当前主题名（无效则回退 paper） */
export function getTheme(): ThemeName {
	const saved = localStorage.getItem(KEY) as ThemeName | null;
	return saved && VALID.includes(saved) ? saved : "paper";
}

/** 应用主题：设置 <html data-theme>，并持久化 */
export function applyTheme(name: ThemeName) {
	document.documentElement.dataset.theme = name;
	localStorage.setItem(KEY, name);
}

/** 初始化：应用持久化主题（或默认 paper） */
export function initTheme() {
	document.documentElement.dataset.theme = getTheme();
}

/** 主题名 → 显示信息 */
export function themeInfo(name: ThemeName) {
	return themes[name];
}

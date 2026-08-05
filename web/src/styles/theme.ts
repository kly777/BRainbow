/**
 * theme.ts — 主题切换逻辑（纯函数，localStorage 持久化）
 */
import { paperTheme, themes, type ThemeName } from "./tokens.css.ts";

const KEY = "brainbow_theme";
const VALID = Object.keys(themes) as ThemeName[];

/** 读取当前主题名（无效则回退 paper） */
export function getTheme(): ThemeName {
	const saved = localStorage.getItem(KEY) as ThemeName | null;
	return saved && VALID.includes(saved) ? saved : "paper";
}

/** 应用主题：把对应主题类挂到 <html>，并持久化 */
export function applyTheme(name: ThemeName) {
	const el = document.documentElement;
	for (const t of VALID) el.classList.remove(themes[t].theme);
	el.classList.add(themes[name].theme);
	localStorage.setItem(KEY, name);
}

/** 初始化：应用持久化主题（或默认 paper） */
export function initTheme() {
	// paper 主题类必须先存在（createThemeContract 无默认值）
	if (!document.documentElement.classList.contains(paperTheme)) {
		document.documentElement.classList.add(paperTheme);
	}
	const name = getTheme();
	if (name !== "paper") applyTheme(name);
}

/** 主题名 → 显示信息 */
export function themeInfo(name: ThemeName) {
	return themes[name];
}

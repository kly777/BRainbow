/**
 * theme.ts — 主题切换逻辑（纯函数，localStorage 持久化）
 *
 * 主题通过 <html data-theme="paper|midnight|ocean"> 生效，
 * 变量定义见 styles/tokens.css。
 */
export const themes = {
	paper: {
		label: "暖纸 · 目录绿",
		swatches: ["oklch(0.99 0.004 95)", "oklch(0.52 0.1 165)"],
	},
	midnight: {
		label: "暗夜 · 墨绿",
		swatches: ["oklch(0.21 0.014 260)", "oklch(0.68 0.12 165)"],
	},
	ocean: {
		label: "冷蓝 · 晴空",
		swatches: ["oklch(0.99 0.003 250)", "oklch(0.55 0.18 255)"],
	},
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

/* ════════════════════════════════════════════════════════════
 * 字号弹性档位（adaptability: 把字号选择权交还读者）
 *
 * 仅通过修改 <html> 根字号实现：所有 rem 布局/字号随之等比缩放，
 * 与浏览器放大默认字号的行为一致，不影响布局比例。
 * ════════════════════════════════════════════════════════════ */

export const fontScales = {
	normal: { label: "标准", scale: 1 },
	large: { label: "大号", scale: 1.125 },
	extraLarge: { label: "特大", scale: 1.25 },
} as const;

export type FontScaleName = keyof typeof fontScales;

const FONT_KEY = "brainbow_font_scale";
const VALID_FONT = Object.keys(fontScales) as FontScaleName[];

/** 读取当前字号档位（无效则回退 normal） */
export function getFontScale(): FontScaleName {
	const saved = localStorage.getItem(FONT_KEY) as FontScaleName | null;
	return saved && VALID_FONT.includes(saved) ? saved : "normal";
}

/** 应用字号档位：设置 <html> 根字号，并持久化 */
export function applyFontScale(name: FontScaleName) {
	const { scale } = fontScales[name];
	// 百分比系数叠加在用户浏览器默认根字号之上（normal 时清除内联样式，
	// 尊重用户自己的默认字号）；所有 rem 随之等比缩放。
	if (scale === 1) {
		document.documentElement.style.fontSize = "";
	} else {
		document.documentElement.style.fontSize = `${scale * 100}%`;
	}
	localStorage.setItem(FONT_KEY, name);
}

/** 初始化：应用持久化字号档位（或默认 normal） */
export function initFontScale() {
	applyFontScale(getFontScale());
}

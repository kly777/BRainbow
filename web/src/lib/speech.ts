/**
 * Web Speech API 封装 —— 文本朗读
 *
 * 基于浏览器原生 speechSynthesis，提供：
 * - speakText: 朗读一段文本（自动 strip markdown）
 * - stopSpeaking: 停止当前朗读
 * - isSpeechSupported: 浏览器是否支持
 *
 * 注意：speechSynthesis 是全局单例，多次调用 speak 会排队。
 * 本项目使用场景是"朗读 cue"，每次朗读前先 cancel 再 speak，避免排队。
 */

/// 朗读时是否支持
export function isSpeechSupported(): boolean {
	return typeof window !== "undefined" && "speechSynthesis" in window;
}

/**
 * 去掉 Markdown 标记，提取可朗读的纯文本。
 * cue/target 都是 markdown，直接朗读会出现 "#"、"**" 等噪音。
 */
export function stripMarkdown(text: string): string {
	let s = text
		// 图片 ![alt](url) → alt
		.replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1")
		// 链接 [text](url) → text
		.replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
		// 行内代码 `code` → code
		.replace(/`([^`]*)`/g, "$1")
		// 粗体/斜体标记：**x** *x* __x__ _x_
		.replace(/[*_]{1,3}([^*_]*)[*_]{1,3}/g, "$1")
		// 删除线 ~~x~~
		.replace(/~~([^~]*)~~/g, "$1")
		// 标题 # ## ###
		.replace(/^#{1,6}\s+/gm, "")
		// 无序列表 - / * / +
		.replace(/^\s*[-*+]\s+/gm, "")
		// 有序列表 1. 2.
		.replace(/^\s*\d+\.\s+/gm, "")
		// 引用 >
		.replace(/^\s*>\s?/gm, "")
		// 分隔线 --- *** ___
		.replace(/^\s*(-{3,}|\*{3,}|_{3,})\s*$/gm, "")
		// 表格分隔行 | --- | --- |
		.replace(/^\s*\|?[\s:|-]+\|[\s:|-]*$/gm, "")
		// 表格单元格分隔符 | → 空格
		.replace(/\|/g, " ")
		// HTML 标签
		.replace(/<[^>]*>/g, "")
		// 行首多余空格（代码块残留）
		.replace(/^\s+/gm, "");

	// 压缩多余空白行
	s = s
		.split("\n")
		.map((line) => line.trim())
		.filter((line) => line.length > 0)
		.join("，");

	return s.trim();
}

/** 简单判断文本是否包含中文，用于挑选朗读语言 */
export function containsCjk(text: string): boolean {
	return /[\u4e00-\u9fff\u3400-\u4dbf]/.test(text);
}

/**
 * 朗读一段文本。朗读前会停止当前正在进行的朗读。
 * 若浏览器不支持或文本为空则静默忽略。
 */
export function speakText(text: string): void {
	if (!isSpeechSupported()) return;
	const clean = stripMarkdown(text);
	if (!clean) return;

	window.speechSynthesis.cancel();

	const utterance = new SpeechSynthesisUtterance(clean);
	utterance.lang = containsCjk(clean) ? "zh-CN" : "en-US";
	// Chrome 需要短暂延迟才能发声（cancel 后立即 speak 可能被吞）
	window.setTimeout(() => {
		window.speechSynthesis.speak(utterance);
	}, 50);
}

/** 停止当前朗读 */
export function stopSpeaking(): void {
	if (!isSpeechSupported()) return;
	window.speechSynthesis.cancel();
}

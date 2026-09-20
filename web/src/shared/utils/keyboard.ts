// ── 键盘事件的"让路"判定 ──

/**
 * 事件目标是不是"正在输入"的地方 —— 全局快捷键应当让路给用户打字。
 *
 * 这段判断此前在 command-palette / mem（两处）/ find 查找条 / 文件粘贴 里各写一份，
 * 而且五份的范围并不一致（有的含 contentEditable、有的不含、有的含 SELECT）。
 * 差异不是刻意的领域差异，而是拷贝各自演化的结果；这里取**并集**：
 * 输入框、文本域、可编辑区域一律让路，`includeSelect` 再额外算上下拉框
 * （方向键在下拉框里是选项导航，也不该被抢）。
 */
export function isTypingTarget(
	target: EventTarget | null | undefined,
	options?: { includeSelect?: boolean },
): boolean {
	const el = target as HTMLElement | null | undefined;
	if (!el || typeof el.tagName !== "string") return false;
	// isContentEditable 是浏览器里的权威判据（含继承自可编辑祖先的情况），
	// 但 jsdom 没实现它 —— 补一条属性判断，让"可编辑区域让路"在测试里也成立
	if (el.isContentEditable === true) return true;
	const editable = el.getAttribute?.("contenteditable");
	if (editable === "" || editable === "true") return true;
	if (el.tagName === "INPUT" || el.tagName === "TEXTAREA") return true;
	return options?.includeSelect === true && el.tagName === "SELECT";
}

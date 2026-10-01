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

/**
 * 这个 keydown 是不是**输入法组字中间**发出来的 —— 是的话，回车/方向键/Esc 都还不该
 * 由我们处理：它们是给输入法选候选词、翻页、取消候选用的。
 *
 * 不设这道闸门的症状（中文用户天天踩）：打拼音时按回车选词，被当成"提交"——
 * 命令面板会执行当前项并关闭、改名框会把没打完的字提交出去；上下键翻候选会顺带
 * 移动面板的选中项。Esc 也一样：组成中按 Esc 只想撤掉候选窗，不该关面板。
 *
 * 判据用标准的 `isComposing`；再兜一条 `keyCode === 229`（Chrome/Safari 组字期间的
 * keydown 也是 229，老实现里这是唯一可靠的信号）。
 *
 * **凡"回车即提交"的输入框都要先过它**（命令面板、文件/标签/卡片的改名与标签输入…）。
 * 带修饰键的（⌘/Ctrl+Enter）不必：组字确认永远是裸回车，不会撞上。
 */
export function isImeComposing(e: KeyboardEvent): boolean {
	return e.isComposing || e.keyCode === 229;
}

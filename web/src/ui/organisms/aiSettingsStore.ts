// ── 全局 AI 设置面板状态管理 ──
// 命令式 API：openAiSettings() / closeAiSettings()
// 模式同 confirmStore / toastStore：全局信号 + Layout 挂载 Container。

import { createSignal } from "solid-js";

const [isOpen, setIsOpen] = createSignal(false);

export function openAiSettings(): void {
	setIsOpen(true);
}

export function closeAiSettings(): void {
	setIsOpen(false);
}

export { isOpen as aiSettingsOpen };
